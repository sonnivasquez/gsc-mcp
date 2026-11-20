import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';

const dist = process.env.AUDIT_TEST_DIST || resolve('dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { FetchGscDataSource } = await load('gsc/client.js');
const { gscCapabilities, gscContentDecay, gscPerformanceOverview, gscQueryPages, gscSearchAnalytics } = await load('gsc/tools.js');
const { RequestBudget } = await load('gsc/budget.js');
const { fetchAllRows } = await load('analytics.js');
const { setInstanceAllowlist } = await load('profiles.js');
const SITE = 'sc-domain:example.com';
const range = { startDate: '2026-08-01', endDate: '2026-08-28' };
const provider = { getAccessToken: async () => 'token', describe: () => ({ mode: 'oauth', scopeTier: 'readonly' }) };
const filter = (dimension, expression = 'x', operator = 'equals') => ({ dimension, expression, operator });
const list = (dimension, ...expressions) => ({ dimension, expressions });
const row = (keys, clicks = 1) => ({ keys, clicks, impressions: 4, ctr: clicks / 4, position: 2 });
const metadata = { first_incomplete_date: '2026-08-27' };
function fixture(respond = () => ({ rows: [], responseAggregationType: 'byProperty', metadata })) {
  const calls = [];
  const deps = {
    provider,
    allowlist: [SITE],
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return Response.json(respond(calls.length - 1));
    },
  };
  return { calls, deps, source: new FetchGscDataSource(provider, deps) };
}

test('report and aggregation rules are enforced before transport', async () => {
  const { source, calls } = fixture();
  const cases = [
    { searchType: 'discover', dimensions: ['query'] },
    { searchType: 'discover', dimensions: ['page'], filters: [filter('device')] },
    { searchType: 'googleNews', dimensions: ['query'] },
    { searchType: 'googleNews', dimensions: ['page'], filters: [filter('query')] },
    { dimensions: ['page'], aggregationType: 'byProperty' },
    { dimensions: ['country'], filters: [filter('page')], aggregationType: 'byProperty' },
    { dimensions: ['country'], searchType: 'googleNews', aggregationType: 'byProperty' },
    { dimensions: ['country'], searchType: 'discover', aggregationType: 'byProperty' },
    { dimensions: ['searchAppearance', 'page'] },
    { dimensions: ['page'], filters: [filter('searchAppearance', 'x', 'contains')] },
    { dimensions: ['country'], aggregationType: 'byNewsShowcasePanel', searchType: 'googleNews' },
  ];
  for (const query of cases) await assert.rejects(source.queryAnalytics(SITE, { ...range, ...query }), e => e.code === 'INVALID_ARGUMENT' && !!e.suggestedAction);
  assert.equal(calls.length, 0);
});

test('brand, list and multimodal validation rejects invalid analytics before HTTP', async () => {
  const { calls, deps } = fixture();
  const cases = [
    [{ dimensions: ['brandedClassification'], filters: [filter('query')] }, /query filter/],
    [{ filters: [filter('brandedClassification', 'BRANDED'), filter('query')] }, /query filter/],
    [{ filters: [filter('brandedClassification', 'BRANDED', 'contains')] }, /require equals/],
    [{ filters: [filter('brandedClassification', 'UNKNOWN')] }, /require equals/],
    [{ filterLists: [] }, /must contain/],
    [{ filterLists: null }, /must contain/],
    [{ filterLists: list('device', 'MOBILE') }, /must contain/],
    [{ filterLists: [list('device')] }, /must contain/],
    [{ filterLists: [list('country', 123)] }, /must contain/],
    [{ filterLists: [list('page', 'x')] }, /must contain/],
    [{ filterLists: [{ ...list('device', 'MOBILE'), operator: 'notEquals' }] }, /must contain/],
    [{ filterLists: [list('country', 'PE')] }, /three-letter/],
    [{ filterLists: [list('device', 'WATCH')] }, /DESKTOP, MOBILE, or TABLET/],
    [{ filterLists: [list('country', 'PER')], filters: [filter('country', 'USA')] }, /both filters and filterLists/],
    [{ searchType: 'discover', filterLists: [list('device', 'MOBILE')] }, /discover.*device/],
    [{ searchType: 'webMultimodal', dimensions: ['query'] }, /webMultimodal.*query dimension/],
  ];
  for (const [query, message] of cases) {
    const result = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['date'], ...query }, deps);
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.match(result.error.message, message);
    assert.ok(result.error.suggestedAction);
  }
  assert.deepEqual(calls, []);
});

test('brand grouping and exact filter preserve query grouping, key order and metrics', async () => {
  const dimensions = ['query', 'brandedClassification'];
  const filters = [filter('brandedClassification', 'BRANDED')];
  const filterLists = [list('country', 'PER', 'MEX'), list('device', 'MOBILE', 'TABLET')];
  const branded = row(['brand example', 'BRANDED'], 2);
  const { calls, deps } = fixture(() => ({ rows: [branded], responseAggregationType: 'byProperty' }));
  const result = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions, filters, filterLists }, deps);
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, [{
    ...range, dimensions, dimensionFilterGroups: [{ filters, filterLists }], type: 'web',
    dataState: 'final', rowLimit: 25000, startRow: 0,
  }]);
  assert.deepEqual(result.data.rows, [branded]);
  assert.deepEqual(result.data.dimensions, dimensions);
  assert.equal(result.data.responseAggregationType, 'by_row');
  assert.equal(result.data.upstreamAggregationType, 'byProperty');
  const capabilities = gscCapabilities(deps).data;
  assert.ok(capabilities.supportedDimensions.includes('brandedClassification'));
  assert.ok(capabilities.supportedSearchTypes.includes('webMultimodal'));
  assert.deepEqual(capabilities.searchAnalyticsFilterListDimensions, ['country', 'device']);
});

test('multimodal lists retain each condition across pages and honor budgets and allowlists', async () => {
  const filterLists = [list('country', 'PER', 'MEX'), list('country', 'PER', 'COL'), list('device', 'MOBILE')];
  const first = row(['one']);
  const second = row(['two']);
  const { calls, deps } = fixture(index => ({ rows: index === 0 ? [first] : [], metadata }));
  const budget = new RequestBudget(2);
  const source = new FetchGscDataSource(provider, { ...deps, budget });
  const query = { ...range, dimensions: ['page'], searchType: 'webMultimodal', filterLists, rowLimit: 1 };
  await assert.rejects(source.queryAnalytics('sc-domain:other.example', query), e => e.code === 'PROPERTY_NOT_ALLOWED');
  assert.deepEqual(calls, []);
  const result = await source.queryAnalytics(SITE, query);
  const expected = {
    ...range, dimensions: ['page'], dimensionFilterGroups: [{ filterLists }], type: 'webMultimodal',
    dataState: 'final', rowLimit: 1, startRow: 0,
  };
  assert.deepEqual(calls, [expected, { ...expected, startRow: 1 }]);
  assert.deepEqual(result.rows, [first]);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.metadata, metadata);
  assert.equal(result.pagesFetched, 2);
  assert.equal(budget.attemptsUsed, 2);
  await assert.rejects(source.queryAnalytics(SITE, query), e => e.code === 'REQUEST_BUDGET_EXCEEDED');
  assert.equal(calls.length, 2);

  const paged = fixture(index => ({ rows: index === 0 ? [first, second] : [] }));
  const capped = await paged.source.queryAnalytics(SITE, { ...query, rowLimit: 2, maxFetchRows: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(paged.calls.length, 1);
});

test('multimodal simple query filters are passed through and missing rows stay empty', async () => {
  const { calls, deps } = fixture(() => ({}));
  const filters = [filter('query', 'example')];
  const result = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['page'], searchType: 'webMultimodal', filters }, deps);
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, [{
    ...range, dimensions: ['page'], dimensionFilterGroups: [{ filters }], type: 'webMultimodal',
    dataState: 'final', rowLimit: 25000, startRow: 0,
  }]);
  assert.deepEqual(result.data.rows, []);
  assert.equal(result.data.responseAggregationType, 'by_row');
  assert.equal(result.data.upstreamAggregationType, undefined);
  assert.equal(result.meta.coverage.sourceGuarantee, 'top_rows_not_exhaustive');
  const brand = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['date'], filters: [filter('brandedClassification', 'NON_BRANDED')] }, deps);
  assert.equal(brand.status, 'ok');
  assert.equal(calls[1].dimensionFilterGroups[0].filters[0].expression, 'NON_BRANDED');
  assert.deepEqual(brand.data.rows, []);
});

test('derived tools keep their existing search types and do not forward filter lists', async () => {
  const { calls, deps } = fixture();
  const input = { ...range, siteUrl: SITE, searchType: 'webMultimodal' };
  for (const run of [gscPerformanceOverview, gscContentDecay, gscQueryPages]) {
    const result = await run({ ...input, query: 'example' }, deps);
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.match(result.error.message, /webMultimodal/);
  }
  assert.deepEqual(calls, []);
  const result = await gscQueryPages({ ...input, searchType: 'web', query: 'example', filterLists: [list('device', 'MOBILE')] }, deps);
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls[0].dimensionFilterGroups, [{ filters: [filter('query', 'example')] }]);
});

test('coverage distinguishes discarded rows from an exact limit at the end of pagination', async () => {
  const sample = row(['example']);
  for (const count of [6000, 5000]) {
    const { calls, deps } = fixture(() => ({ rows: Array(count).fill(sample), responseAggregationType: 'byProperty', metadata }));
    const result = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['query'], maxFetchRows: 5000 }, deps);
    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].rowLimit, 25000);
    assert.equal(result.meta.coverage.fetchedRows, 5000);
    assert.equal(result.meta.coverage.returnedRows, 50);
    assert.equal(result.meta.coverage.apiPaginationComplete, count === 5000);
    assert.deepEqual(result.meta.coverage.stoppedBecause, count > 5000 ? ['maxFetchRows'] : []);
    assert.equal(result.meta.coverage.truncatedByProduct, true);
    assert.equal(result.data.responseAggregationType, 'by_row');
    assert.equal(result.data.upstreamAggregationType, 'byProperty');
    assert.deepEqual(result.data.metadata, metadata);
  }
  const { deps } = fixture(() => ({ rows: Array(50).fill(sample) }));
  const exact = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['query'], maxFetchRows: 50, resultLimit: 50 }, deps);
  assert.equal(exact.meta.coverage.apiPaginationComplete, true);
  assert.equal(exact.meta.coverage.truncatedByProduct, false);
});

test('news query and valid aggregation pass through; hourly metadata survives', async () => {
  const { calls, deps } = fixture();
  const result = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['query'], searchType: 'news', aggregationType: 'byProperty' }, deps);
  assert.equal(result.status, 'ok'); assert.equal(calls[0].type, 'news'); assert.equal(calls[0].aggregationType, 'byProperty');
  const hourly = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['hour'], dataState: 'hourly_all' }, deps);
  assert.equal(hourly.status, 'ok'); assert.equal(calls[1].dataState, 'hourly_all'); assert.equal(hourly.data.metadata.first_incomplete_date, '2026-08-27');
  assert.equal(hourly.data.upstreamAggregationType, 'byProperty');
  const valid = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ['country'], searchType: 'googleNews', aggregationType: 'byNewsShowcasePanel', filters: [filter('searchAppearance', 'NEWS_SHOWCASE')] }, deps);
  assert.equal(valid.status, 'ok'); assert.equal(calls[2].aggregationType, 'byNewsShowcasePanel');
});

test('legacy client applies the same rules before querying and passes valid aggregation', async () => {
  setInstanceAllowlist(null); let calls = 0; let body;
  const client = { searchanalytics: { query: async request => { calls++; body = request.requestBody; return { data: { rows: [] } }; } } };
  await assert.rejects(fetchAllRows({ ...range, dimensions: ['page'], aggregationType: 'byProperty' }, SITE, client), e => e.code === 'INVALID_ARGUMENT');
  assert.equal(calls, 0);
  await fetchAllRows({ ...range, dimensions: ['query'], type: 'news', aggregationType: 'byProperty' }, SITE, client);
  assert.equal(calls, 1); assert.equal(body.type, 'news'); assert.equal(body.aggregationType, 'byProperty');
});

test('legacy validation sees filter groups together and rejects before SDK calls', async () => {
  const calls = [];
  const client = { searchanalytics: { query: async request => calls.push(request) } };
  const cases = [
    { dimensionFilterGroups: [{ filters: [filter('brandedClassification', 'BRANDED')] }, { filters: [filter('query')] }] },
    { dimensions: ['brandedClassification'], dimensionFilterGroups: [{ filterLists: [list('device', 'MOBILE')] }, { filters: [filter('query')] }] },
    { dimensionFilterGroups: [{ filterLists: [list('country', 'PER')] }, { filters: [filter('country', 'PER')] }] },
    { dimensionFilterGroups: [{ filters: [filter('country', 'PER')] }, { filterLists: [list('country', 'PER')] }] },
    { dimensionFilterGroups: [{ filterLists: [] }, { filterLists: [list('country', 'PER')] }] },
    { dimensionFilterGroups: [{ filterLists: [list('device')] }] },
    { dimensionFilterGroups: [{ filterLists: [list('device', 'UNKNOWN')] }] },
    { type: 'discover', dimensionFilterGroups: [{ filterLists: [list('device', 'MOBILE')] }] },
    { type: 'webMultimodal', dimensions: ['query'] },
  ];
  for (const query of cases) {
    await assert.rejects(fetchAllRows({ ...range, dimensions: ['date'], ...query }, SITE, client), e => e.code === 'INVALID_ARGUMENT' && !!e.suggestedAction);
  }
  assert.deepEqual(calls, []);
});

test('legacy googleapis serializes list-only groups and preserves the payload across pages', async () => {
  const bodies = [];
  const sample = row(['https://example.com/']);
  const client = google.searchconsole({
    version: 'v1',
    fetchImplementation: async (url, init) => {
      assert.ok(String(url).endsWith('/sites/sc-domain%3Aexample.com/searchAnalytics/query'));
      assert.equal(init.method, 'POST');
      bodies.push(JSON.parse(init.body));
      return Response.json(bodies.length === 1 ? { rows: [sample] } : {});
    },
  });
  const dimensionFilterGroups = [
    { groupType: 'and', filterLists: [list('country', 'PER', 'MEX'), list('country', 'PER', 'COL')] },
    { filters: [filter('page', 'https://example.com/')], filterLists: [list('device', 'MOBILE')] },
  ];
  const params = { ...range, dimensions: ['page'], dimensionFilterGroups, rowLimit: 1 };
  const rows = await fetchAllRows({ ...params, type: 'webMultimodal', aggregationType: 'auto' }, SITE, client);
  const expected = { ...params, dataState: 'all', startRow: 0, type: 'webMultimodal', aggregationType: 'auto' };
  assert.deepEqual(bodies, [expected, { ...expected, startRow: 1 }]);
  assert.deepEqual(rows, [sample]);

  const brand = {
    ...range, dimensions: ['brandedClassification', 'query'],
    dimensionFilterGroups: [{ filters: [filter('brandedClassification', 'NON_BRANDED')] }],
  };
  assert.deepEqual(await fetchAllRows(brand, SITE, client), []);
  assert.deepEqual(bodies[2], { ...brand, rowLimit: 25000, startRow: 0, dataState: 'all' });
});
