import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditContext } from '../dist/audits/context.js';
import { WebReader, pageFindings } from '../dist/audits/web.js';

const site = 'https://example.com/';
async function inspect({ meta = '', header, type = 'text/html' } = {}) {
  const body = `<html><head><title>Page</title><meta name="description" content="Description"><link rel="canonical" href="${site}">${meta}</head><body><h1>Page</h1></body></html>`;
  const headers = { 'content-type': type };
  if (header !== undefined) headers['x-robots-tag'] = header;
  const ctx = new AuditContext([site], {
    allowlist: [site], provider: { getAccessToken: async () => 'fixture' },
    resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(body, { headers }),
  });
  const page = await new WebReader(ctx).page(site);
  return { page, findings: pageFindings(page) };
}
const codes = findings => findings.map(f => f.code);

test('parameter values and other crawler scopes are not page noindex', async () => {
  for (const fixture of [
    { meta: '<meta name="robots" content="index, follow, max-image-preview:none">' },
    { header: 'max-image-preview:none, max-snippet:0, noimageindex' },
    { header: 'bingbot: noindex, nofollow' },
    { header: 'googlebot: index, bingbot: noindex' },
    { meta: '<meta name="bingbot" content="noindex">' },
  ]) {
    const { findings } = await inspect(fixture);
    assert.ok(!codes(findings).includes('NOINDEX'), JSON.stringify(fixture));
    assert.ok(!codes(findings).includes('ROBOTS_CONFLICT'), JSON.stringify(fixture));
  }
});

test('bare restrictive rules and conflicts retain raw evidence', async () => {
  for (const fixture of [
    { meta: '<meta name="robots" content="index, NoNe">' },
    { meta: '<meta name="robots" content="index"><meta name="googlebot" content="NOINDEX">' },
    { header: 'bingbot: noindex, googlebot: index, noindex' },
    { meta: '<meta name="robots" content="index">', header: 'noindex' },
  ]) {
    const { page, findings } = await inspect(fixture);
    assert.ok(codes(findings).includes('NOINDEX'), JSON.stringify(fixture));
    assert.ok(codes(findings).includes('ROBOTS_CONFLICT'), JSON.stringify(fixture));
    assert.equal(findings.find(f => f.code === 'NOINDEX').evidence, [...page.robots, page.xRobotsTag ?? ''].join(','));
    assert.equal(page.javascriptContentUnknown, true);
  }
});

test('non-HTML responses evaluate X-Robots-Tag without HTML findings', async () => {
  const { findings } = await inspect({ type: 'application/pdf', header: 'NoIndex' });
  assert.ok(codes(findings).includes('NON_HTML'));
  assert.ok(codes(findings).includes('NOINDEX'));
  assert.ok(!codes(findings).includes('TITLE_MISSING_OR_EMPTY'));
  const other = await inspect({ type: 'application/pdf', header: 'bingbot: noindex' });
  assert.ok(!codes(other.findings).includes('NOINDEX'));
});
