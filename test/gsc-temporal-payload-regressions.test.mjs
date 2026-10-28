import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.env.AUDIT_TEST_DIST || resolve('dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { gscDetectCannibalization, gscGetDataset } = await load('gsc/tools.js');
const { DatasetStore } = await load('gsc/datasets.js');
const SITE = 'https://example.com/';
const row = (keys) => ({ keys, clicks: 10, impressions: 200, ctr: .05, position: 3 });
const sdkBytes = (value) => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }));

test('timeline preview and every dataset page fit SDK response, preserving all evidence and filters', async () => {
  const calls = [];
  const queries = Array.from({ length: 12 }, (_, i) => `consulta-${i}-` + '漢😀'.repeat(45));
  const pages = [0, 1].map(i => `${SITE}${i}/` + 'ñ'.repeat(140));
  const deps = { provider: { getAccessToken: async () => 'token' }, allowlist: [SITE], profileAlias: 'test', store: new DatasetStore(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      const rows = body.dimensions[0] === 'query'
        ? queries.flatMap(q => pages.map(p => row([q, p])))
        : Array.from({ length: 28 }, (_, i) => pages.map(p => row([`2026-01-${String(i + 1).padStart(2, '0')}`, p]))).flat();
      return Response.json({ rows });
    } };
  const input = { siteUrl: SITE, startDate: '2026-01-01', endDate: '2026-01-28', includeTimeline: true, timelineQueryLimit: 10, resultLimit: 12, searchType: 'image', dataState: 'all', filters: [{ dimension: 'country', operator: 'equals', expression: 'per' }] };
  const result = await gscDetectCannibalization(input, deps);
  assert.equal(result.status, 'ok'); assert.ok(result.meta.datasetId); assert.ok(sdkBytes(result) <= 48 * 1024);
  assert.ok(result.meta.warnings.some(w => w.code === 'PREVIEW_TRIMMED'));
  assert.ok(result.data.candidates.length < 12);
  assert.equal(result.data.candidatesTotal, 12);
  assert.equal(result.meta.coverage.sourceGuarantee, 'top_rows_not_exhaustive');
  assert.equal(result.meta.coverage.fetchedRows, 12);
  assert.equal(result.meta.coverage.returnedRows, result.data.candidates.length);
  assert.ok(result.meta.coverage.stoppedBecause.includes('response_bytes'));
  assert.ok(result.meta.coverage.stoppedBecause.includes('timeline_query_limit'));
  for (const call of calls) {
    assert.equal(call.type, 'image'); assert.equal(call.dataState, 'all');
    assert.ok(call.dimensionFilterGroups[0].filters.some(f => f.dimension === 'country' && f.expression === 'per'));
    if (call.dimensions[0] === 'date') assert.ok(call.dimensionFilterGroups[0].filters.some(f => f.dimension === 'query'));
  }
  const chunks = []; let cursor;
  do {
    const page = await gscGetDataset({ datasetId: result.meta.datasetId, cursor, limit: 200 }, deps);
    assert.equal(page.status, 'ok'); assert.ok(sdkBytes(page) <= 48 * 1024); chunks.push(...page.data.rows); cursor = page.data.nextCursor;
  } while (cursor);
  const candidates = queries.map((_, index) => {
    const parts = chunks.filter(r => r.index === index).sort((a, b) => a.part - b.part);
    assert.equal(parts.length, parts[0].parts);
    return JSON.parse(Buffer.from(parts.map(r => r.evidenceBase64).join(''), 'base64').toString('utf8'));
  });
  assert.equal(candidates.length, 12);
  assert.equal(candidates[0].temporal.daily.length, 28);
  assert.deepEqual(candidates[0].temporal.daily[0].pages.map(p => p.page), pages);
  assert.deepEqual(candidates[0].temporalCoverage, { fetchedRows: 56, truncated: false });
  assert.equal(candidates[0].verdict, 'candidate');
  assert.equal(candidates[10].temporalAnalysisStatus, 'pending');
  const plain = await gscDetectCannibalization({ ...input, includeTimeline: false }, deps);
  assert.equal(plain.meta.datasetId, undefined); assert.equal(plain.data.evidencePreview, undefined);
  assert.equal(plain.data.candidates[0].temporal, undefined);
});
