import test from 'node:test';
import assert from 'node:assert/strict';
import { gscIndexingAudit, gscPageAudit } from '../dist/audits/tools.js';
import { RequestBudget } from '../dist/gsc/budget.js';
import { DatasetStore } from '../dist/gsc/datasets.js';
const SITE = 'https://example.com/';
function setup() {
  const calls = [];
  return { calls, deps: {
    provider: { getAccessToken: async () => 'fixture' }, allowlist: [SITE], profileAlias: 'status-regression', store: new DatasetStore(), resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async (raw, init = {}) => {
      const url = String(raw); calls.push(url);
      if (url.includes('urlInspection')) {
        const input = JSON.parse(init.body);
        return input.inspectionUrl.endsWith('/bad') ? new Response('{}', { status: 403 }) : Response.json({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });
      }
      if (url.includes('searchAnalytics')) return Response.json({ rows: [] });
      if (url.endsWith('/bad')) throw new Error('unreachable HTML');
      return new Response('<html><head><title>Page</title></head><body><h1>Page</h1></body></html>', { headers: { 'content-type': 'text/html' } });
    },
  }};
}
test('stored inspection failures keep final status partial without reissuing failed steps', async () => {
  const { deps, calls } = setup();
  const first = await gscIndexingAudit({ siteUrl: SITE, urls: [`${SITE}bad`, `${SITE}good`], inspectLimit: 1 }, deps);
  assert.equal(first.status, 'partial'); assert.ok(first.data.nextCursor);
  const last = await gscIndexingAudit({ siteUrl: SITE, cursor: first.data.nextCursor }, deps);
  assert.equal(last.status, 'partial'); assert.equal(last.data.complete, true); assert.equal(last.data.nextCursor, null);
  assert.equal(last.data.results[0].inspection.ok, false);
  assert.ok(last.meta.warnings.some(w => w.details?.persistentAuditFailure && w.code === 'PARTIAL'));
  assert.equal(calls.filter(u => u.includes('urlInspection')).length, 2);
});
test('HTML failure persists across budget resumption but progress-only partial clears after success', async () => {
  const bad = setup();
  const first = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}bad`] }, { ...bad.deps, budget: new RequestBudget(1) });
  const last = await gscPageAudit({ siteUrl: SITE, cursor: first.data.nextCursor }, bad.deps);
  assert.equal(last.status, 'partial'); assert.equal(last.data.complete, true); assert.equal(last.data.results[0].html.ok, false);
  assert.equal(bad.calls.filter(u => u === `${SITE}bad`).length, 1);
  const good = setup();
  const partial = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}good`] }, { ...good.deps, budget: new RequestBudget(1) });
  assert.equal(partial.status, 'partial');
  const ok = await gscPageAudit({ siteUrl: SITE, cursor: partial.data.nextCursor }, good.deps);
  assert.equal(ok.status, 'ok'); assert.equal(ok.data.complete, true);
  assert.equal(ok.meta.warnings.some(w => w.code === 'PARTIAL'), false);
});
