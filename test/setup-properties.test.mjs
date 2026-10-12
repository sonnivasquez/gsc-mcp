import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseSiteFlags,
  validateAllowlist,
  parsePropertySelectionAnswer,
  selectProperties,
  isPropertyIdentifier,
} from '../dist/setup/properties.js';
import { buildEnv } from '../dist/setup.js';
import { envAllowlist } from '../dist/profiles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'dist/index.js');

test('repeatable --site flags are each one exact identifier and never comma-split', () => {
  const exact = ['sc-domain:Example.COM', 'https://example.com/', 'http://legacy.example/'];
  assert.deepEqual(parseSiteFlags(exact), exact);
  // A comma inside a URL-prefix property is one identifier, preserved exactly.
  assert.deepEqual(parseSiteFlags(['https://example.com/a,b']), ['https://example.com/a,b']);
  assert.deepEqual(parseSiteFlags(['sc-domain:a.example', 'https://b.example/x,y']), ['sc-domain:a.example', 'https://b.example/x,y']);
});

test('shared predicate accepts exact identifiers and rejects whitespace plus malformed hosts', () => {
  // Accepted: exact originals survive, including comma URLs, case, ports, paths.
  for (const good of ['sc-domain:Example.COM', 'https://example.com/a,b', 'https://example.com/', 'http://legacy.example/', 'https://example.com:8443/search?q=1']) {
    assert.equal(isPropertyIdentifier(good), true, `identifier ${good}`);
  }
  // Accepted URL hosts: IPv4/IPv6 literals and localhost, ports/paths intact.
  for (const good of ['http://127.0.0.1/', 'http://[::1]/', 'https://[2001:db8::1]:8443/x', 'http://localhost:3000/']) {
    assert.equal(isPropertyIdentifier(good), true, `identifier ${good}`);
  }
  // Rejected: any whitespace, empty hosts, malformed hosts, wrong prefixes.
  for (const bad of ['https:// ', 'sc-domain:foo bar', 'sc-domain:foo\tbar', 'https://exa mple.com/', 'https://', 'http://', 'sc-domain:', 'sc-domain:-bad.com', 'sc-domain:bad_.com', 'https://[::1', 'example.com', 'ftp://example.com/']) {
    assert.equal(isPropertyIdentifier(bad), false, `identifier ${JSON.stringify(bad)}`);
  }
  // Rejected URL hosts: parseable URLs with invalid DNS labels fail the shared label rule.
  for (const bad of ['https://bad_host.com/', 'https://-bad.com/', 'https://bad-.com/', 'http://bad_host.example:8080/x']) {
    assert.equal(isPropertyIdentifier(bad), false, `identifier ${bad}`);
  }
});

test('property flags reject empty and structurally invalid values instead of falling back', () => {
  for (const bad of ['', '  ', 'example.com', 'ftp://example.com/', 'sc-domain:', 'https://', 'http://', 'https:// ', 'sc-domain:foo bar', 'https://exa mple.com/', 'sc-domain:-bad.com']) {
    assert.throws(() => parseSiteFlags([bad]), /Invalid --site value/, `flag ${JSON.stringify(bad)}`);
  }
  // Leading/trailing whitespace is not trimmed: it fails the shape check.
  assert.throws(() => parseSiteFlags(['  sc-domain:a.example  ']), /Invalid --site value/);
  assert.throws(() => parseSiteFlags(['sc-domain:a.example', 'not-a-property']), /Invalid --site value/);
});

test('allowlist validation is fail-closed and copies without normalization', () => {
  const exact = ['sc-domain:Example.COM', 'https://example.com/a,b'];
  const validated = validateAllowlist(exact);
  assert.deepEqual(validated, exact);
  assert.notEqual(validated, exact);
  assert.throws(() => validateAllowlist([]), /property is required/);
  assert.throws(() => validateAllowlist(['  ']), /property is required/);
  assert.throws(() => validateAllowlist(['example.com']), /Invalid property/);
  assert.throws(() => validateAllowlist(['sc-domain:a.example', 'bogus']), /Invalid property/);
});

test('interactive property answers support default, all, 0-allow-all, and multi-select', () => {
  const fetched = ['sc-domain:a.example', 'https://b.example/', 'sc-domain:C.example'];
  assert.deepEqual(parsePropertySelectionAnswer('', fetched, 0), ['sc-domain:a.example']);
  assert.deepEqual(parsePropertySelectionAnswer('all', fetched, 0), ['all']);
  assert.deepEqual(parsePropertySelectionAnswer('ALL', fetched, 0), ['all']);
  assert.deepEqual(parsePropertySelectionAnswer('0', fetched, 0), ['all']);
  assert.deepEqual(parsePropertySelectionAnswer('1,3', fetched, 0), ['sc-domain:a.example', 'sc-domain:C.example']);
  assert.deepEqual(parsePropertySelectionAnswer('3, 1, 1', fetched, 0), ['sc-domain:C.example', 'sc-domain:a.example']);
  assert.throws(() => parsePropertySelectionAnswer('0,1', fetched, 0), /"0" alone/);
  assert.throws(() => parsePropertySelectionAnswer('4', fetched, 0), /choose 0-3/);
  assert.throws(() => parsePropertySelectionAnswer('abc', fetched, 0), /numbers like/);
  assert.throws(() => parsePropertySelectionAnswer('', [], 0), /No Search Console properties/);
});

test('deterministic selection prefers flags and rejects ambiguous input', () => {
  const fetched = ['sc-domain:a.example', 'https://b.example/'];
  assert.deepEqual(selectProperties({ allSites: true, requested: [], fetched }), fetched);
  assert.deepEqual(selectProperties({ allSites: false, requested: ['https://b.example/'], fetched }), ['https://b.example/']);
  assert.deepEqual(selectProperties({ allSites: false, requested: [], fetched, interactiveAnswer: '2', defaultIndex: 0 }), ['https://b.example/']);
  assert.deepEqual(selectProperties({ allSites: false, requested: [], fetched, interactiveAnswer: '', defaultIndex: 1 }), ['https://b.example/']);
  assert.throws(() => selectProperties({ allSites: true, requested: ['sc-domain:a.example'], fetched }), /not both/);
});

test('buildEnv persists new allowlists as a JSON string array', () => {
  const base = { secretsPath: null, keyFile: null, mode: 'custom', scopes: 'readonly', write: false };
  const many = buildEnv({ ...base, sites: ['sc-domain:a.example', 'https://b.example/'] });
  assert.deepEqual(JSON.parse(many.GSC_SITE_URLS), ['sc-domain:a.example', 'https://b.example/']);
  const commaUrl = buildEnv({ ...base, sites: ['https://example.com/a,b'] });
  assert.deepEqual(JSON.parse(commaUrl.GSC_SITE_URLS), ['https://example.com/a,b']);
  const preview = buildEnv({ ...base, sites: [], allSites: true });
  assert.equal(Object.hasOwn(preview, 'GSC_SITE_URLS'), false);
  assert.throws(() => buildEnv({ ...base, sites: [], allSites: false }), /property is required/);
  assert.throws(() => buildEnv({ ...base, sites: ['sc-domain:a.example'], allSites: true }), /not both/);
  assert.throws(() => buildEnv({ ...base, sites: ['not-a-property'] }), /Invalid property/);
});

test('buildEnv keeps the legacy single-site raw-string form', () => {
  const single = buildEnv({ secretsPath: null, keyFile: null, mode: 'custom', scopes: 'readonly', write: false, site: 'sc-domain:Example.COM' });
  assert.equal(single.GSC_SITE_URLS, 'sc-domain:Example.COM');
});

test('JSON allowlist with a comma-containing URL round-trips through the env contract exactly', () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    const env = buildEnv({
      secretsPath: null, keyFile: null, mode: 'custom', scopes: 'readonly', write: false,
      sites: ['sc-domain:Example.COM', 'https://shop.example/sale,2026/'],
    });
    process.env.GSC_SITE_URLS = env.GSC_SITE_URLS;
    assert.deepEqual(envAllowlist(), ['sc-domain:Example.COM', 'https://shop.example/sale,2026/']);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test('envAllowlist retains legacy comma-separated input compatibility', () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = 'sc-domain:a.example, https://b.example/ ';
    assert.deepEqual(envAllowlist(), ['sc-domain:a.example', 'https://b.example/']);
    delete process.env.GSC_SITE_URLS;
    assert.deepEqual(envAllowlist(), []);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test('dry-run with --all-sites and print succeeds without inventing identifiers', { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, 'setup', '--language', 'en', '--dry-run', '--yes', '--auth', 'shared', '--all-sites', '--client', 'print'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /mcpServers/);
  assert.match(r.stdout + r.stderr, /no allowlist to preview without network/);
  assert.ok(!r.stdout.includes('GSC_SITE_URLS'), 'dry-run --all-sites must omit enumeration, not invent identifiers');
});

test('dry-run with repeatable --site preserves exact identifiers including commas', { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, 'setup', '--dry-run', '--yes', '--auth', 'shared',
    '--site', 'sc-domain:Example.COM', '--site', 'https://shop.example/sale,2026/', '--client', 'print'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes('sc-domain:Example.COM'), `stdout: ${r.stdout}`);
  assert.ok(r.stdout.includes('https://shop.example/sale,2026/'), `stdout: ${r.stdout}`);
  const printed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.deepEqual(JSON.parse(printed.mcpServers.gsc.env.GSC_SITE_URLS),
    ['sc-domain:Example.COM', 'https://shop.example/sale,2026/']);
});

test('dry-run with a structurally invalid --site fails closed', { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, 'setup', '--language', 'en', '--dry-run', '--yes', '--auth', 'shared',
    '--site', 'not-a-property', '--client', 'print'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Invalid --site value/);
});

test('conflicting --site and --all-sites fails closed on explicit flags', { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, 'setup', '--language', 'en', '--dry-run', '--yes', '--auth', 'shared',
    '--site', 'sc-domain:a.example', '--all-sites', '--client', 'print'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /not both/);
});
