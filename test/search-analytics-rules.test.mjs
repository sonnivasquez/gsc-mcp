import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.env.AUDIT_TEST_DIST || resolve('dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { FetchGscDataSource } = await load('gsc/client.js');
const { gscSearchAnalytics } = await load('gsc/tools.js');
const { fetchAllRows } = await load('analytics.js');
const { setInstanceAllowlist } = await load('profiles.js');
const SITE = 'sc-domain:example.com';
const range = { startDate: '2026-08-01', endDate: '2026-08-28' };
const provider = { getAccessToken: async () => 'token' };
const filter = (dimension, expression = 'x', operator = 'equals') => ({ dimension, expression, operator });
function fixture() {
  const calls = [];
  const deps = { provider, allowlist: [SITE], fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ rows: [], responseAggregationType: 'byProperty', metadata: { first_incomplete_date: '2026-08-27' } }); } };
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
