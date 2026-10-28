import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.env.AUDIT_TEST_DIST || resolve('dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discovery, discoverBatch } = await load('audits/sitemaps.js');
const { gscInternalLinkAudit } = await load('audits/tools.js');
const { DatasetStore } = await load('gsc/datasets.js');
const SITE = 'https://example.com/';
const index = (...urls) => `<sitemapindex>${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
const urlset = (...urls) => `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;

function setup(pages, analyticsRows = []) {
  const calls = [];
  return { calls, deps: {
    provider: { getAccessToken: async () => 'fixture' }, allowlist: [SITE], profileAlias: 'discovery-regression',
    store: new DatasetStore(), resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async (raw, init = {}) => {
      const url = String(raw); calls.push(url);
      if (url.includes('searchAnalytics/query')) {
        const body = JSON.parse(init.body);
        return Response.json({ rows: body.dimensions?.[0] === 'page' ? analyticsRows : [] });
      }
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      const value = pages[url];
      if (value instanceof Response) return value.clone();
      if (value === undefined) return new Response('missing', { status: 404 });
      return new Response(value, { headers: { 'content-type': url.endsWith('.xml') ? 'application/xml' : 'text/html', 'content-length': String(Buffer.byteLength(value)) } });
    },
  } };
}
const html = (body = '') => `<html><head><title>Example</title></head><body>${body}</body></html>`;

// Exercise the real bounded HTTP reader and context, including fresh call budgets.
test('sitemap byte allowance resumes pending resource and rejects an oversized resource once', async () => {
  const { AuditContext } = await load('audits/context.js');
  const { WebReader } = await load('audits/web.js');
  const pad = '<!--' + 'x'.repeat(30 * 1024 * 1024) + '-->';
  const { deps } = setup({
    [`${SITE}one.xml`]: `<urlset>${pad}<url><loc>${SITE}one</loc></url></urlset>`,
    [`${SITE}two.xml`]: `<urlset>${pad}<url><loc>${SITE}two</loc></url></urlset>`,
    [`${SITE}large.xml`]: `<urlset><!--${'x'.repeat(51 * 1024 * 1024)}--></urlset>`,
  });
  const state = discovery([`${SITE}one.xml`, `${SITE}two.xml`, `${SITE}large.xml`]);
  const batch = () => discoverBatch(state, new WebReader(new AuditContext([SITE], deps)));
  await batch();
  assert.deepEqual(state.entries.map((e) => e.url), [`${SITE}one`]);
  assert.deepEqual(state.queue, [`${SITE}two.xml`, `${SITE}large.xml`]);
  assert.deepEqual(state.failures, []);
  await batch();
  assert.deepEqual(state.entries.map((e) => e.url), [`${SITE}one`, `${SITE}two`]);
  assert.deepEqual(state.queue, [`${SITE}large.xml`]);
  await batch();
  assert.deepEqual(state.queue, []);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].url, `${SITE}large.xml`);
});

test('invalid sitemap child is isolated from subsequent valid siblings', async () => {
  const { AuditContext } = await load('audits/context.js');
  const { WebReader } = await load('audits/web.js');
  const { deps, calls } = setup({
    [`${SITE}root.xml`]: index('https://outside.example/bad.xml', `${SITE}good.xml`),
    [`${SITE}good.xml`]: urlset(`${SITE}valid`),
  });
  const state = discovery([`${SITE}root.xml`]);
  await discoverBatch(state, new WebReader(new AuditContext([SITE], deps)));
  assert.deepEqual(state.entries.map((e) => e.url), [`${SITE}valid`]);
  assert.equal(state.failures[0].url, 'https://outside.example/bad.xml');
  assert.ok(calls.includes(`${SITE}good.xml`));
});

test('link audit retains sitemap failures as partial after continuation', async () => {
  const { deps, calls } = setup({
    [`${SITE}root.xml`]: index('https://outside.example/bad.xml', `${SITE}good.xml`),
    [`${SITE}good.xml`]: urlset(`${SITE}valid`), [SITE]: html(), [`${SITE}valid`]: html(),
  });
  let r = await gscInternalLinkAudit({ siteUrl: SITE, startUrls: [SITE], sitemapUrls: [`${SITE}root.xml`], batchSize: 1 }, deps);
  assert.ok(r.data.nextCursor);
  for (let i = 0; r.data.nextCursor && i < 10; i++) r = await gscInternalLinkAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, deps);
  assert.equal(r.data.complete, true);
  assert.equal(r.status, 'partial');
  assert.equal(r.data.summary.graphComplete, false);
  assert.equal(r.data.summary.sitemapFailures[0].url, 'https://outside.example/bad.xml');
  assert.ok(calls.includes(`${SITE}good.xml`));
  assert.ok(r.data.results.some((p) => p.url === `${SITE}valid`));
});

test('capped discovery terminates across calls with incomplete graph coverage', async () => {
  const urls = Array.from({ length: 10000 }, (_, i) => `${SITE}p${i}`);
  const emptyMaps = Array.from({ length: 10 }, (_, i) => `${SITE}empty${i}.xml`);
  const { deps } = setup({
    [`${SITE}root.xml`]: index(...emptyMaps, `${SITE}one.xml`, `${SITE}two.xml`),
    ...Object.fromEntries(emptyMaps.map((url) => [url, urlset()])),
    [`${SITE}one.xml`]: urlset(...urls), [`${SITE}two.xml`]: urlset(`${SITE}last`), [SITE]: html(),
  });
  let r = await gscInternalLinkAudit({ siteUrl: SITE, startUrls: [SITE], sitemapUrls: [`${SITE}root.xml`], maxPages: 1, batchSize: 1 }, deps);
  assert.ok(r.data.nextCursor);
  for (let i = 0; r.data.nextCursor && i < 10; i++) r = await gscInternalLinkAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, deps);
  assert.equal(r.data.complete, true);
  assert.equal(r.data.nextCursor, null);
  assert.equal(r.data.summary.discoveryCapped, true);
  assert.equal(r.data.summary.remainingSitemaps, 1);
  assert.equal(r.data.summary.graphComplete, false);
});

test('redirect aliases do not count twice as incoming pages', async () => {
  const rows = [`${SITE}new`, `${SITE}target`].map((url) => ({ keys: [url], clicks: 1, impressions: 10, ctr: 0.1, position: 1 }));
  const { deps } = setup({
    [`${SITE}old`]: new Response(null, { status: 301, headers: { location: `${SITE}new` } }),
    [`${SITE}new`]: html('<a href="/target">target</a>'), [`${SITE}target`]: html(),
  }, rows);
  let r = await gscInternalLinkAudit({ siteUrl: SITE, startUrls: [`${SITE}old`], maxPages: 10 }, deps);
  for (let i = 0; r.data.nextCursor && i < 10; i++) r = await gscInternalLinkAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, deps);
  assert.equal(r.data.complete, true);
  assert.equal(r.data.results.find((p) => p.url === `${SITE}target`).observedIncomingPages, 1);
  const old = r.data.results.find((p) => p.url === `${SITE}old`);
  assert.equal(old.page.url, `${SITE}old`);
  assert.equal(old.page.finalUrl, `${SITE}new`);
  assert.equal(old.page.redirects.length, 1);
});

test('suggestions deduplicate redirect aliases and exclude effective self-links', async () => {
  const rows = [`${SITE}new`, `${SITE}target`].map((url) => ({ keys: [url], clicks: 1, impressions: 10, ctr: 0.1, position: 1 }));
  const { deps } = setup({
    [`${SITE}old`]: new Response(null, { status: 301, headers: { location: `${SITE}new` } }),
    [`${SITE}new`]: html('<main>Example subject appears here.</main>'),
    [`${SITE}target`]: html('<main>Unrelated body.</main>'),
  }, rows);
  let r = await gscInternalLinkAudit({ siteUrl: SITE, startUrls: [`${SITE}old`], maxPages: 10 }, deps);
  for (let i = 0; r.data.nextCursor && i < 10; i++) r = await gscInternalLinkAudit({ siteUrl: SITE, cursor: r.data.nextCursor }, deps);
  assert.equal(r.data.complete, true);
  const target = r.data.results.find((p) => p.url === `${SITE}target`);
  assert.deepEqual(target.suggestions.map((s) => s.sourceUrl), [`${SITE}new`]);
  for (const url of [`${SITE}old`, `${SITE}new`]) {
    const page = r.data.results.find((p) => p.url === url);
    assert.ok(page.suggestions.every((s) => s.sourceUrl !== `${SITE}new`));
  }
});
