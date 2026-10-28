import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { gscPageAudit, gscIndexingAudit, gscInternalLinkAudit, gscChangeImpact, gscMigrationAudit } from '../dist/audits/tools.js';
import { HistoryStore } from '../dist/audits/history.js';
import { AuditSessionStore } from '../dist/audits/sessions.js';
import { AuditContext } from '../dist/audits/context.js';
import { WebReader } from '../dist/audits/web.js';
import { parseSitemap } from '../dist/audits/sitemaps.js';
import { DatasetStore } from '../dist/gsc/datasets.js';
import { RequestBudget } from '../dist/gsc/budget.js';
import { gscGetDataset, gscSearchAnalytics, gscDetectCannibalization, gscCapabilities } from '../dist/gsc/tools.js';
import { temporalEvidence } from '../dist/gsc/cannibalization.js';
const SITE = 'https://example.com/';
const row = (keys = [], clicks = 10, impressions = 1000) => ({ keys, clicks, impressions, ctr: clicks / impressions, position: 5 });
const html = (title, body = '', extra = '') => `<html><head><title>${title}</title><meta name="description" content="description"><link rel="canonical" href="/${title}">${extra}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
function transport(pages = {}, query = () => ({ rows: [row()] }), inspect = url => ({ inspectionResult: { indexStatusResult: { verdict: 'PASS', googleCanonical: url, userCanonical: url } } })) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    url = String(url); const body = init.body ? JSON.parse(init.body) : undefined; calls.push({ url, body, headers: init.headers });
    if (url.includes('/searchAnalytics/query')) return Response.json(query(body));
    if (url.includes('urlInspection/index:inspect')) { const result = inspect(body.inspectionUrl); return result instanceof Response ? result : Response.json(result); }
    if (url === 'https://www.googleapis.com/webmasters/v3/sites') return Response.json({ siteEntry: [{ siteUrl: SITE }] });
    if (url.includes('/sitemaps')) return Response.json({ sitemap: [{ path: `${SITE}sitemap.xml` }] });
    const p = pages[url];
    if (p instanceof Error) throw p;
    if (typeof p === 'function') return p(init);
    if (p instanceof Response) return p.clone();
    if (p === undefined && url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (p !== undefined) return new Response(p, { headers: { 'content-type': /sitemap|\.xml/.test(url) ? 'application/xml' : 'text/html' } });
    return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  return { calls, deps: { provider: { getAccessToken: async () => 'test-token' }, allowlist: [SITE], profileAlias: 'test', resolveHost: async () => ['93.184.216.34'], fetchImpl, store: new DatasetStore() } };
}
async function fullRows(result, deps) {
  let cursor; const parts = [];
  do {
    const page = await gscGetDataset({ datasetId: result.meta.datasetId, cursor, limit: 200 }, deps);
    assert.equal(page.status, 'ok'); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 49152);
    parts.push(...page.data.rows); cursor = page.data.nextCursor;
  } while (cursor);
  const grouped = new Map();
  for (const p of parts) { const a = grouped.get(p.index) ?? []; a[p.part] = p.evidence; grouped.set(p.index, a); }
  return [...grouped.values()].map(a => JSON.parse(a.join('')));
}
const complete = async (fn, input, deps) => {
  let r = await fn(input, deps); let n = 0;
  while (r.data?.nextCursor && n++ < 30) r = await fn({ ...input, cursor: r.data.nextCursor }, deps);
  assert.ok(n < 30, 'audit should finish'); return r;
};

test('page audit joins actual full HTTP text to exact URL queries, no website credentials', async () => {
  const { deps, calls } = transport({ [`${SITE}a`]: html('a', '<p>an observed phrase lives here</p>') }, b => ({ rows: b.dimensions.length ? [row(['observed phrase'])] : [row()] }));
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a#section`] }, deps);
  assert.equal(r.status, 'ok'); assert.equal(r.data.complete, true);
  assert.deepEqual(r.data.results[0].matches[0], { query: 'observed phrase', title: false, h1: false, text: true });
  assert.equal(r.data.results[0].html.value.javascriptContentUnknown, true);
  assert.equal(calls.filter(c => c.body?.dimensionFilterGroups).length, 2);
  assert.ok(calls.filter(c => !c.body).every(c => !('Authorization' in c.headers)));
  assert.equal(calls.find(c => c.body)?.body.dimensionFilterGroups[0].filters[0].expression, `${SITE}a`);
});
test('page audit preserves HTML when Google fails and metrics when HTML fails', async () => {
  const { deps } = transport({ [`${SITE}a`]: html('a'), [`${SITE}b`]: new Error('unreachable') });
  const original = deps.fetchImpl;
  deps.fetchImpl = async (u, i) => String(u).includes('searchAnalytics') && i.body.includes(`${SITE}a`) ? new Response('{}', { status: 403 }) : original(u, i);
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`, `${SITE}b`] }, deps);
  assert.equal(r.status, 'partial');
  assert.equal(r.data.results[0].html.ok, true); assert.equal(r.data.results[0].totals.ok, false);
  assert.equal(r.data.results[1].html.ok, false); assert.equal(r.data.results[1].totals.ok, true);
});
test('page directives and non-HTML are evidence, not semantic verdicts', async () => {
  const { deps } = transport({ [`${SITE}a`]: html('a', '', '<title>another</title><meta name="robots" content="noindex"><meta name="googlebot" content="index">'), [`${SITE}b`]: new Response('pdf', { headers: { 'content-type': 'application/pdf' } }) });
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`, `${SITE}b`] }, deps);
  assert.ok(r.data.results[0].html.value.findings.some(f => f.code === 'TITLE_MULTIPLE'));
  assert.ok(r.data.results[0].html.value.findings.some(f => f.code === 'ROBOTS_CONFLICT'));
  assert.ok(r.data.results[1].html.value.findings.some(f => f.code === 'NON_HTML'));
});
test('explicit URL scope, prefix boundaries and redirected public host authorization', async () => {
  const { deps, calls } = transport({ [`${SITE}a`]: new Response(null, { status: 302, headers: { location: 'https://other.example/a' } }) });
  const denied = await gscPageAudit({ siteUrl: SITE, urls: ['https://other.example/a'] }, deps);
  assert.equal(denied.error.code, 'PROPERTY_NOT_ALLOWED'); assert.equal(calls.length, 0);
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, deps);
  assert.equal(r.data.results[0].html.ok, false); assert.ok(!calls.some(c => c.url.startsWith('https://other')));
});
test('all-properties profile verifies actual GSC property before fetching a website', async () => {
  const { deps, calls } = transport(); deps.allowlist = ['all'];
  const r = await gscPageAudit({ siteUrl: 'https://unauthorized.example/', urls: ['https://unauthorized.example/a'] }, deps);
  assert.equal(r.error.code, 'PROPERTY_PERMISSION_DENIED'); assert.equal(calls.length, 1);
});
test('private DNS is blocked before the page request', async () => {
  const { deps, calls } = transport(); deps.resolveHost = async () => ['127.0.0.1'];
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, deps);
  assert.equal(r.data.results[0].html.ok, false); assert.ok(!calls.some(c => c.url === `${SITE}a`));
});
test('large nested evidence is recoverable in UTF-8 bounded dataset pages', async () => {
  const queries = Array.from({ length: 200 }, (_, i) => row([`${i}漢`.repeat(100)]));
  const { deps } = transport({ [`${SITE}a`]: html('a') }, b => ({ rows: b.dimensions.length ? queries : [row()] }));
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, deps);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 49152);
  assert.equal(r.meta.coverage.returnedRows, r.data.results.length);
  const rows = await fullRows(r, deps); assert.equal(rows[0].queries.value.rows.length, 200);
  assert.equal(rows[0].matches.length, 200);
});
test('budget exhaustion yields a resumable audit and completed steps are not repeated', async () => {
  const { deps, calls } = transport({ [`${SITE}a`]: html('a') });
  const first = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, { ...deps, budget: new RequestBudget(1) });
  assert.equal(first.status, 'partial'); assert.ok(first.data.nextCursor);
  const second = await gscPageAudit({ siteUrl: SITE, cursor: first.data.nextCursor }, deps);
  assert.equal(second.data.complete, true);
  assert.equal(calls.filter(c => c.url === `${SITE}a`).length, 1);
});
test('cursor cannot cross profiles or change original parameters', async () => {
  const { deps } = transport();
  const r = await gscIndexingAudit({ siteUrl: SITE, urls: [`${SITE}a`, `${SITE}b`], inspectLimit: 1 }, deps);
  const denied = await gscIndexingAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, { ...deps, profileAlias: 'other' });
  assert.equal(denied.error.code, 'PROPERTY_NOT_ALLOWED');
  const changed = await gscIndexingAudit({ siteUrl: SITE, cursor: r.data.nextCursor, inspectLimit: 2 }, deps);
  assert.equal(changed.error.code, 'INVALID_ARGUMENT');
});
test('sessions expire lazily and concurrent access is rejected', () => {
  const store = new AuditSessionStore(); const s = store.create('profile', 'page', {}, {});
  assert.throws(() => store.get('profile', 'page', s.cursor, {}), /already running/);
  store.release(s); s.touchedAt = Date.now() - 900001;
  assert.throws(() => store.get('profile', 'page', s.cursor, {}), /expired/);
});
test('namespaced sitemap parser supports CDATA and rejects external entities', () => {
  const parsed = parseSitemap('<s:urlset xmlns:s="urn:test"><s:url><s:loc><![CDATA[https://example.com/a?a=1&b=2]]></s:loc></s:url></s:urlset>', 'source');
  assert.equal(parsed.entries[0].url, `${SITE}a?a=1&b=2`);
  assert.throws(() => parseSitemap('<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><urlset/>', 's'), /entities/);
  assert.throws(() => parseSitemap('<urlset><url></urlset>', 's'), /invalid sitemap/);
});
test('sitemap traversal handles gzip, nested indices, cycles and duplicate URLs', async () => {
  const child = `<urlset><url><loc>${SITE}a</loc><lastmod>2026-01-01</lastmod></url><url><loc>${SITE}a</loc></url></urlset>`;
  const { deps, calls } = transport({ [`${SITE}sitemap.xml`]: `<sitemapindex><sitemap><loc>${SITE}child.xml.gz</loc></sitemap><sitemap><loc>${SITE}sitemap.xml</loc></sitemap></sitemapindex>`, [`${SITE}child.xml.gz`]: new Response(gzipSync(child)) });
  const r = await complete(gscIndexingAudit, { siteUrl: SITE }, deps);
  assert.equal(r.data.complete, true); assert.equal(r.data.summary.discovered, 1); assert.equal(r.data.summary.inspected, 1);
  assert.equal(calls.filter(c => c.url === `${SITE}sitemap.xml`).length, 1);
});
test('sitemap selection is stable and prioritizes valid recent lastmod', async () => {
  const { deps } = transport({ [`${SITE}sitemap.xml`]: `<urlset><url><loc>${SITE}a</loc><lastmod>invalid</lastmod></url><url><loc>${SITE}b</loc><lastmod>2026-05-01</lastmod></url></urlset>` });
  const r = await gscIndexingAudit({ siteUrl: SITE, selection: 'recent_lastmod', inspectLimit: 1 }, deps);
  assert.equal(r.data.results[0].url, `${SITE}b`); assert.ok(r.data.nextCursor);
  const next = await gscIndexingAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, deps);
  assert.equal(next.data.summary.inspected, 2);
});
test('sitemap robots restrictions and per-URL inspection failures remain explicit', async () => {
  const blocked = transport({ [`${SITE}robots.txt`]: 'User-agent: *\nDisallow: /sitemap.xml' });
  const r = await gscIndexingAudit({ siteUrl: SITE }, blocked.deps);
  assert.equal(r.status, 'partial'); assert.equal(r.data.summary.discoveryComplete, false);
  assert.ok(!blocked.calls.some(c => c.url === `${SITE}sitemap.xml`));
  const partial = transport({}, undefined, url => url.endsWith('/a') ? new Response('{}', { status: 403 }) : { inspectionResult: { indexStatusResult: { verdict: 'PASS', userCanonical: url, googleCanonical: `${SITE}canonical` } } });
  const p = await gscIndexingAudit({ siteUrl: SITE, urls: [`${SITE}a`, `${SITE}b`] }, partial.deps);
  assert.equal(p.status, 'partial'); assert.equal(p.data.summary.inspected, 1); assert.equal(p.data.results[1].canonicalDifference.differs, true);
});
test('internal links preserve URL parameters, ignore fragments and suggest only fetched evidence', async () => {
  const { deps } = transport({
    [`${SITE}a`]: html('a', '<p>b subject is useful</p><a href="/b#x">b</a><a href="/a#y">self</a><a href="/q?x=1" rel="nofollow">q</a>'),
    [`${SITE}b`]: html('b subject', '<a href="/missing">broken</a>'),
    [`${SITE}c`]: html('c', '<p>b subject and further reading</p>'),
  }, () => ({ rows: [row([`${SITE}b`]), row([`${SITE}c`])] }));
  const r = await complete(gscInternalLinkAudit, { siteUrl: SITE, startUrls: [`${SITE}a`], maxPages: 10, batchSize: 1 }, deps);
  const rows = await fullRows(r, deps); const b = rows.find(p => p.url === `${SITE}b`);
  assert.equal(b.observedIncomingPages, 1); assert.equal(b.depth, 1);
  assert.ok(b.suggestions.some(s => s.sourceUrl === `${SITE}c`));
  assert.ok(b.linkIssues.some(l => l.status === 404));
  assert.ok(rows.some(p => p.url === `${SITE}q?x=1`));
  assert.equal(rows.find(p => p.url === `${SITE}c`).depth, null);
});
test('bounded internal graph never claims complete coverage at page limit', async () => {
  const { deps } = transport({ [`${SITE}a`]: html('a', '<a href="/b">b</a>') }, () => ({ rows: [] }));
  const r = await gscInternalLinkAudit({ siteUrl: SITE, startUrls: [`${SITE}a`], maxPages: 1 }, deps);
  assert.equal(r.data.complete, true); assert.equal(r.data.summary.graphComplete, false);
  assert.ok(r.meta.warnings.some(w => w.code === 'CRAWL_LIMIT'));
});
test('global deadline aborts an in-flight fetch and no calls start after return', async () => {
  const { deps, calls } = transport();
  deps.fetchImpl = async (url, init) => { calls.push({ url }); await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); };
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, { ...deps, deadlineMs: 20 });
  assert.equal(r.status, 'partial'); const count = calls.length;
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.length, count);
});

test('history has an independent gate and transient analyze writes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-')); const saved = process.env.GSC_HISTORY; delete process.env.GSC_HISTORY;
  try {
    const { deps } = transport(); deps.historyRoot = root;
    const input = { siteUrl: SITE, change: { date: '2026-01-01', urls: [`${SITE}a`] } };
    const denied = await gscChangeImpact({ ...input, action: 'record' }, deps); assert.match(denied.error.message, /GSC_HISTORY/);
    const r = await gscChangeImpact({ ...input, action: 'analyze' }, deps); assert.equal(r.status, 'ok'); assert.deepEqual(await readdir(root), []);
    const c = r.data.results[0].comparison; assert.equal(c.comparable, true); assert.equal(c.dailyClicksDeltaPct, 0);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});
test('history record idempotency, isolation, snapshots, reload and delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const { deps } = transport(); deps.historyRoot = root;
    const recordInput = { siteUrl: SITE, action: 'record', idempotencyKey: 'same', change: { date: '2026-01-01', label: 'title', urls: [`${SITE}a`] } };
    const first = await gscChangeImpact(recordInput, deps); const again = await gscChangeImpact(recordInput, deps);
    assert.equal(first.data.id, again.data.id);
    const conflict = await gscChangeImpact({ ...recordInput, change: { ...recordInput.change, label: 'other' } }, deps); assert.equal(conflict.error.code, 'INVALID_ARGUMENT');
    const analysis = await gscChangeImpact({ siteUrl: SITE, action: 'analyze', changeId: first.data.id, saveSnapshot: true }, deps);
    assert.equal(analysis.status, 'ok'); assert.ok(analysis.data.summary.snapshotPath);
    const snapshotStat = await stat(analysis.data.summary.snapshotPath);
    assert.ok(snapshotStat.isFile());
    if (process.platform !== 'win32') assert.equal(snapshotStat.mode & 0o777, 0o600);
    const otherStore = new HistoryStore('other', SITE, root); assert.equal((await otherStore.list()).length, 0);
    const reload = new HistoryStore('test', SITE, root); assert.equal((await reload.snapshots(first.data.id)).length, 1);
    await reload.delete(first.data.id); assert.equal((await reload.list()).length, 0);
    assert.equal((await readdir(reload.folder)).length, 0);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});
test('history rejects symlink directories, corruption and conflicting concurrent writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-')); const outside = await mkdtemp(join(tmpdir(), 'gsc-outside-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    await symlink(outside, join(root, 'history'), process.platform === 'win32' ? 'junction' : 'dir');
    const h = new HistoryStore('test', SITE, root); await assert.rejects(h.list(), /symbolic/); assert.deepEqual(await readdir(outside), []);
    await rm(join(root, 'history')); await h.list();
    const record = await h.record({ date: '2026-01-01', label: '', description: '', urls: [`${SITE}a`] });
    await writeFile(join(h.folder, `${record.id}.json`), '{invalid'); await assert.rejects(h.list(), /cannot be read/);
    await writeFile(join(h.root, '.write-lock'), 'locked'); await assert.rejects(h.record({ date: '2026-01-01', label: '', description: '', urls: [`${SITE}a`] }), /locked/);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('preliminary impact never invents post-change rows and rejects overlapping controls', async () => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const { deps } = transport();
  const r = await gscChangeImpact({ siteUrl: SITE, action: 'analyze', change: { date, urls: [`${SITE}a`] } }, deps);
  assert.equal(r.data.summary.windows.after, null); assert.equal(r.data.summary.windows.preliminary, true); assert.equal(r.data.results[0].comparison.after, null);
  const bad = await gscChangeImpact({ siteUrl: SITE, action: 'analyze', change: { date, urls: [`${SITE}a`] }, controlUrls: [`${SITE}a`] }, deps);
  assert.equal(bad.error.code, 'INVALID_ARGUMENT');
});
test('migration reads route and domain chains with deduplicated destination metrics', async () => {
  const TARGET = 'https://new.example/';
  const { deps, calls } = transport({
    [`${SITE}a`]: new Response(null, { status: 301, headers: { location: `${TARGET}dest` } }),
    [`${SITE}b`]: new Response(null, { status: 302, headers: { location: `${TARGET}dest` } }),
    [`${TARGET}dest`]: html('dest'),
  }); deps.allowlist.push(TARGET);
  const input = { sourceSiteUrl: SITE, targetSiteUrl: TARGET, migrationDate: '2026-01-01', mappings: [{ oldUrl: `${SITE}a`, newUrl: `${TARGET}dest` }, { oldUrl: `${SITE}b`, newUrl: `${TARGET}dest` }], batchSize: 1 };
  const r = await complete(gscMigrationAudit, input, deps); assert.equal(r.data.complete, true);
  assert.ok(r.data.results[1].findings.some(f => f.code === 'TEMPORARY_REDIRECT'));
  const destQueries = calls.filter(c => c.body?.dimensionFilterGroups?.[0].filters[0].expression === `${TARGET}dest`);
  assert.equal(destQueries.length, 2);
});
test('migration detects wrong destination, old 200 and contradictory maps', async () => {
  const { deps } = transport({ [`${SITE}old`]: html('old'), [`${SITE}new`]: html('new', '', '<meta name="robots" content="noindex">') });
  const base = { sourceSiteUrl: SITE, targetSiteUrl: SITE, migrationDate: '2026-01-01', mappings: [{ oldUrl: `${SITE}old`, newUrl: `${SITE}new` }] };
  const r = await gscMigrationAudit(base, deps); assert.ok(r.data.results[0].findings.some(f => f.code === 'OLD_URL_STILL_200')); assert.ok(r.data.results[0].findings.some(f => f.code === 'NOINDEX'));
  const bad = await gscMigrationAudit({ ...base, mappings: [...base.mappings, { oldUrl: `${SITE}old`, newUrl: `${SITE}different` }] }, deps);
  assert.equal(bad.error.code, 'INVALID_ARGUMENT');
});
test('hourly query keeps incomplete metadata and offset identity; invalid combinations stay offline', async () => {
  const { deps, calls } = transport({}, () => ({ rows: [row(['2026-11-01T01:00:00-07:00']), row(['2026-11-01T01:00:00-08:00'])], responseAggregationType: 'byProperty', metadata: { first_incomplete_hour: '2026-11-01T01:00:00-07:00' } }));
  const base = { siteUrl: SITE, startDate: '2026-11-01', endDate: '2026-11-01' };
  const r = await gscSearchAnalytics({ ...base, dimensions: ['hour'], dataState: 'hourly_all' }, deps);
  assert.equal(r.status, 'ok'); assert.equal(r.data.upstreamAggregationType, 'byProperty'); assert.equal(r.data.rows.length, 2); assert.ok(r.meta.warnings.some(w => w.code === 'PROVISIONAL_DATA'));
  assert.equal(calls[0].body.type, 'web'); assert.equal(calls[0].body.searchType, undefined);
  const before = calls.length;
  for (const args of [{ dimensions: ['date'], dataState: 'hourly_all' }, { dimensions: ['hour'] }, { dimensions: ['searchAppearance', 'page'] }]) {
    assert.equal((await gscSearchAnalytics({ ...base, ...args }, deps)).error.code, 'INVALID_ARGUMENT');
  }
  assert.equal(calls.length, before);
});
test('search appearance is discovered alone, then filtered in a distinct call', async () => {
  const { deps, calls } = transport({}, b => ({ rows: [row([b.dimensions[0] === 'searchAppearance' ? 'TYPE_A' : `${SITE}a`])] }));
  const base = { siteUrl: SITE, startDate: '2026-01-01', endDate: '2026-01-28' };
  const first = await gscSearchAnalytics({ ...base, dimensions: ['searchAppearance'] }, deps); assert.equal(first.data.rows[0].keys[0], 'TYPE_A');
  const second = await gscSearchAnalytics({ ...base, dimensions: ['page'], filters: [{ dimension: 'searchAppearance', operator: 'equals', expression: 'TYPE_A' }] }, deps);
  assert.equal(second.status, 'ok'); assert.equal(calls.length, 2);
});
test('temporal cannibalization needs observed consecutive days; ties and absence are unknown', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row([`2026-01-0${i + 1}`, i < 4 ? 'a' : 'b']));
  const evidence = temporalEvidence(rows); assert.equal(evidence.status, 'analyzed'); assert.deepEqual(evidence.sustainedChanges, [{ date: '2026-01-05', from: 'a', to: 'b' }]);
  const gap = temporalEvidence([row(['2026-01-01', 'a']), row(['2026-01-02', 'a']), row(['2026-01-04', 'a'])]); assert.equal(gap.sustainedChanges.length, 0); assert.equal(gap.status, 'insufficient_data');
  const tie = temporalEvidence([row(['2026-01-01', 'a']), row(['2026-01-01', 'b'])]); assert.equal(tie.daily[0].dominantUrl, null); assert.equal(tie.sameDayOverlap.length, 1);
});
test('temporal opt-in keeps aggregate candidates and handles exhausted budget', async () => {
  const { deps } = transport({}, b => ({ rows: b.dimensions[0] === 'query' ? [row(['q', `${SITE}a`]), row(['q', `${SITE}b`])] : [row(['2026-01-01', `${SITE}a`])] }));
  const base = { siteUrl: SITE, startDate: '2026-01-01', endDate: '2026-01-28', includeTimeline: true };
  const r = await gscDetectCannibalization(base, deps); assert.equal(r.data.candidates[0].verdict, 'candidate'); assert.equal(r.data.candidates[0].temporal.status, 'insufficient_data');
  const partial = await gscDetectCannibalization(base, { ...deps, budget: new RequestBudget(1) });
  assert.equal(partial.status, 'partial'); assert.equal(partial.data.candidates.length, 1); assert.equal(partial.data.candidates[0].temporalAnalysisStatus, 'pending');
});
test('capabilities report all 34 tools and real feature gates offline', () => {
  const c = gscCapabilities({ provider: { describe: () => ({ mode: 'oauth', scopeTier: 'readonly' }) }, allowlist: [] });
  assert.equal(c.data.tools.length, 34); assert.ok(!c.data.disabledCapabilities.includes('gsc_image_page_audit'));
  assert.ok(c.data.supportedDimensions.includes('hour')); assert.ok(c.data.dataStates.includes('hourly_all'));
});

test('history quota and concurrent writers fail explicitly without deleting existing records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', SITE, root); await h.list();
    const records = await Promise.allSettled([h.record({ date: '2026-01-01', label: 'a', description: '', urls: [`${SITE}a`] }), h.record({ date: '2026-01-01', label: 'b', description: '', urls: [`${SITE}b`] })]);
    assert.ok(records.some(r => r.status === 'fulfilled'));
    const { open } = await import('node:fs/promises');
    const fd = await open(join(h.root, 'quota-padding'), 'w'); await fd.truncate(100 * 1024 * 1024); await fd.close();
    await assert.rejects(h.record({ date: '2026-01-01', label: 'quota', description: '', urls: [`${SITE}a`] }), /100 MiB/);
    assert.equal((await h.list()).length, records.filter(r => r.status === 'fulfilled').length);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});
test('snapshot failure retains the successful impact comparison', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  const snapshot = HistoryStore.prototype.snapshot;
  try {
    const { deps } = transport(); deps.historyRoot = root;
    const recorded = await gscChangeImpact({ siteUrl: SITE, action: 'record', change: { date: '2026-01-01', urls: [`${SITE}a`] } }, deps);
    HistoryStore.prototype.snapshot = async () => { throw new Error('disk full'); };
    const r = await gscChangeImpact({ siteUrl: SITE, action: 'analyze', changeId: recorded.data.id, saveSnapshot: true }, deps);
    assert.equal(r.status, 'partial'); assert.equal(r.data.results[0].comparison.comparable, true); assert.ok(r.meta.warnings.some(w => /not saved/.test(w.message)));
  } finally { HistoryStore.prototype.snapshot = snapshot; if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});
test('explicit controls compare daily percentage changes without causal labels', async () => {
  const { deps } = transport({}, b => {
    const url = b.dimensionFilterGroups?.[0].filters[0].expression;
    const before = b.startDate < '2026-01-01';
    return { rows: [row(b.dimensions.length ? ['q'] : [], url.endsWith('control') ? (before ? 50 : 100) : (before ? 100 : 150))] };
  });
  const r = await gscChangeImpact({ siteUrl: SITE, action: 'analyze', change: { date: '2026-01-01', urls: [`${SITE}a`] }, controlUrls: [`${SITE}control`] }, deps);
  assert.ok(Math.abs(r.data.results[0].controlRelativeDeltaPp + 50) < 1e-9);
  assert.match(r.data.summary.note, /not causal/);
});
test('automatic redirect targets are checked against robots before they are fetched', async () => {
  const { deps, calls } = transport({ [`${SITE}robots.txt`]: 'User-agent: *\nDisallow: /blocked', [`${SITE}a`]: new Response(null, { status: 301, headers: { location: '/blocked' } }), [`${SITE}blocked`]: html('blocked') }, () => ({ rows: [] }));
  const r = await complete(gscInternalLinkAudit, { siteUrl: SITE, startUrls: [`${SITE}a`] }, deps);
  assert.equal(r.data.results[0].page.ok, false); assert.ok(!calls.some(c => c.url === `${SITE}blocked`));
});
test('cancelled caller aborts Google work and leaves explicit pending steps', async () => {
  const { deps, calls } = transport({ [`${SITE}a`]: html('a') }); const controller = new AbortController(); controller.abort();
  const r = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, { ...deps, signal: controller.signal });
  assert.equal(r.status, 'partial'); assert.equal(calls.length, 0); assert.equal(r.data.complete, false);
});
test('stored change measurements survive a separate Node process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gsc-history-process-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', SITE, root); const change = await h.record({ date: '2026-01-01', label: 'persist', description: '', urls: [`${SITE}a`] });
    await h.snapshot(change.id, { before: 'known' }, { clicks: 17 });
    const { execFileSync } = await import('node:child_process');
    const code = 'const {HistoryStore}=await import(process.argv[1]); const h=new HistoryStore("test",process.argv[3],process.argv[2]); const r=await h.snapshots(process.argv[4]); process.stdout.write(JSON.stringify(r));';
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', code, new URL('../dist/audits/history.js', import.meta.url).href, root, SITE, change.id], { encoding: 'utf8', env: { ...process.env, GSC_HISTORY: '1' } });
    assert.equal(JSON.parse(output)[0].result.clicks, 17);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});

test('all five audit tools complete through the actual MCP SDK protocol', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { registerAudits } = await import('../dist/audits/register.js');
  const root = await mkdtemp(join(tmpdir(), 'gsc-audit-mcp-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  const { deps, calls } = transport({ [`${SITE}a`]: html('a'), [`${SITE}old`]: new Response(null, { status: 301, headers: { location: `${SITE}a` } }) }, () => ({ rows: [] })); deps.historyRoot = root;
  const server = new McpServer({ name: 'audits-test', version: '1.0.0' }); registerAudits(server, deps);
  const client = new Client({ name: 'audit-client', version: '1.0.0' }); const [c, s] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(s); await client.connect(c);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError);
      const envelope = JSON.parse(result.content[0].text); assert.notEqual(envelope.status, 'error', JSON.stringify(envelope)); return envelope;
    };
    assert.equal((await call('gsc_page_audit', { siteUrl: SITE, urls: [`${SITE}a`] })).data.complete, true);
    assert.equal((await call('gsc_indexing_audit', { siteUrl: SITE, urls: [`${SITE}a`] })).data.complete, true);
    assert.equal((await call('gsc_internal_link_audit', { siteUrl: SITE, startUrls: [`${SITE}a`] })).data.complete, true);
    const record = await call('gsc_change_impact', { siteUrl: SITE, action: 'record', change: { date: '2026-01-01', urls: [`${SITE}a`] } });
    const analyzed = await call('gsc_change_impact', { siteUrl: SITE, action: 'analyze', changeId: record.data.id, saveSnapshot: true }); assert.ok(analyzed.data.summary.snapshotPath);
    assert.equal((await call('gsc_change_impact', { siteUrl: SITE, action: 'list', changeId: record.data.id })).data.snapshotsTotal, 1);
    await call('gsc_change_impact', { siteUrl: SITE, action: 'delete', changeId: record.data.id });
    assert.equal((await call('gsc_migration_audit', { sourceSiteUrl: SITE, targetSiteUrl: SITE, migrationDate: '2026-01-01', mappings: [{ oldUrl: `${SITE}old`, newUrl: `${SITE}a` }] })).data.complete, true);
    const count = calls.length; await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(calls.length, count);
  } finally { await client.close(); await server.close(); if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});

test('global deadline also bounds unresolved DNS and OAuth providers', { timeout: 2000 }, async (t) => {
  // AbortSignal.timeout intentionally does not keep Node's event loop alive.
  // These fake providers have no I/O handles, unlike a live stdio MCP server.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const dns = transport(); dns.deps.resolveHost = () => new Promise(() => {});
  const first = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, { ...dns.deps, deadlineMs: 20 });
  assert.equal(first.status, 'partial'); assert.equal(dns.calls.length, 0);
  const auth = transport({ [`${SITE}a`]: html('a') }); auth.deps.provider = { getAccessToken: () => new Promise(() => {}) };
  const second = await gscPageAudit({ siteUrl: SITE, urls: [`${SITE}a`] }, { ...auth.deps, deadlineMs: 20 });
  assert.equal(second.status, 'partial'); assert.equal(second.data.complete, false); assert.equal(auth.calls.filter(c => c.body).length, 0);
});

test('internal suggestions can use actual observed queries absent from destination headings', async () => {
  const { deps } = transport({ [`${SITE}a`]: html('source heading', '<p>specific observed phrase in context</p>'), [`${SITE}b`]: html('different destination heading') }, b => ({ rows: b.dimensions[0] === 'page' ? [row([`${SITE}b`])] : b.dimensions[0] === 'query' ? [row(['specific observed phrase'])] : [row()] }));
  const r = await complete(gscInternalLinkAudit, { siteUrl: SITE, startUrls: [`${SITE}a`] }, deps);
  const target = r.data.results.find(p => p.url === `${SITE}b`);
  assert.ok(target.suggestions.some(s => s.sourceUrl === `${SITE}a` && s.basis === 'observed_query'));
  assert.equal(r.data.summary.contextQueryPagesCompleted, 2);
});
