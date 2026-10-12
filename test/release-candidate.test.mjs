import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { npmCommand } from '../scripts/npm-command.mjs';
import {
  NAME, REPOSITORY, REQUIRED, sha256, integrity, parsePackJson, auditPath,
  scanSecrets, readArchive, auditArchive, validatePackage, validateCandidate,
  validateRegistry, downloadRegistryTarball, verify, isWithinDirectory,
} from '../scripts/release-candidate.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'scripts/release-candidate.mjs');
const pkg = () => ({
  name: NAME, version: '1.0.0', repository: { url: `git+https://github.com/${REPOSITORY}.git` },
  main: 'dist/index.js', bin: { gsc: 'dist/index.js', 'gsc-mcp': 'dist/index.js' },
});
const fixture = () => REQUIRED.map(name => ({
  name: `package/${name}`,
  body: name === 'package.json' ? JSON.stringify(pkg()) : name === 'dist/version.js' ?
    'exports.CLI_VERSION = "1.0.0";' : 'public fixture\n',
}));
function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((n, b) => n + b, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
}
function archive(entries = fixture()) {
  const chunks = [];
  for (const { name, body = '', type = '0', link = '', prefix = '', mode = 0o644 } of entries) {
    const h = Buffer.alloc(512);
    const data = Buffer.from(body);
    h.write(name, 0, 100, 'ascii');
    for (const [start, length, value] of [[100, 8, mode], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]]) {
      h.write(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length, 'ascii');
    }
    h.write(type, 156, 1, 'ascii');
    h.write(link, 157, 100, 'ascii');
    h.write('ustar\0' + '00', 257, 8, 'ascii');
    h.write(prefix, 345, 155, 'ascii');
    checksum(h);
    chunks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function candidate(bytes = archive()) {
  return {
    name: NAME, version: '1.0.0', filename: 'sonnivasquez-gsc-mcp-1.0.0.tgz',
    sha256: sha256(bytes), integrity: integrity(bytes), sourceCommit: 'a'.repeat(40),
    repository: REPOSITORY, runId: 'local', runAttempt: '1', entries: auditArchive(bytes).entries,
  };
}
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gsc-candidate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function registryMetadata(manifest = candidate()) {
  return { name: NAME, version: manifest.version, dist: {
    integrity: manifest.integrity,
    tarball: `https://registry.npmjs.org/${NAME}/-/gsc-mcp-${manifest.version}.tgz`,
  } };
}

test('npm pack parses old arrays and npm 12 keyed objects, not ambiguous output', () => {
  const item = { name: NAME, version: '1.0.0', filename: candidate().filename };
  for (const value of [[item], { [NAME]: item }]) assert.deepEqual(parsePackJson(JSON.stringify(value)), item);
  for (const value of [[], [item, item], {}, { wrong: item }, { [NAME]: item, other: item }, null,
    [{ ...item, filename: '../evil.tgz' }], [{ ...item, name: 'other' }], [{ ...item, version: '01.0.0' }]]) {
    assert.throws(() => parsePackJson(JSON.stringify(value)));
  }
  assert.throws(() => parsePackJson('notice\n[]'), /Invalid JSON/);
});

test('regular ustar files and prefix fields are accepted', () => {
  const bytes = archive();
  assert.equal(auditArchive(bytes).entries.length, REQUIRED.length);
  assert.equal(validateCandidate(candidate(bytes), bytes).name, NAME);
  const prefixed = archive([{ name: 'index.js', prefix: 'package/dist', body: 'ok' }]);
  assert.equal(readArchive(prefixed).get('dist/index.js').toString(), 'ok');
});

test('unsafe, private, unexpected and platform-ambiguous archive paths fail closed', () => {
  for (const name of ['../dist/a.js', '/package/dist/a.js', 'package/../dist/a.js',
    'package/dist/../../evil', 'package/dist//a.js', 'package/dist/./a.js',
    'package/dist/a\\b.js', 'package/dist/C:a.js', 'package/dist/a%2fb.js',
    'package/dist/a.', 'package/dist/NUL.js', 'package/dist/COM1',
    'package/.atl/a', 'package/screenshots/a.png', 'package/.impeccable/a',
    'package/docs/verification/results.md', 'package/dist/secrets/a.json',
    'package/dist/credentials.json', 'package/dist/.env.local', 'package/dist/.npmrc',
    'package/dist/key.pem', 'package/dist/tokens.json', 'package/src/index.ts', 'package/dist/']) {
    assert.throws(() => auditPath(name), undefined, name);
    assert.throws(() => readArchive(archive([{ name }])));
  }
  assert.equal(auditPath('package/dist/embedded-client.js'), 'dist/embedded-client.js');
});

test('links, directory/device/FIFO/extended entries, duplicate paths and privileged modes are rejected', () => {
  for (const type of ['1', '2', '3', '4', '5', '6', '7', 'x', 'g', 'L', 'K', 'S']) {
    assert.throws(() => readArchive(archive([{ name: 'package/dist/a.js', type }])), /entry type/);
  }
  assert.throws(() => readArchive(archive([{ name: 'package/dist/a.js', link: 'outside' }])), /links/);
  assert.throws(() => readArchive(archive([{ name: 'package/dist/a.js', mode: 0o4755 }])), /mode/);
  for (const second of ['a.js', 'A.js']) {
    assert.throws(() => readArchive(archive([
      { name: 'package/dist/a.js' }, { name: `package/dist/${second}` },
    ])), /Duplicate/);
  }
});

test('malformed checksums, sizes, padding, format and endings are rejected', () => {
  const original = gunzipSync(archive());
  const mutate = (fn, resign = false) => {
    const tar = Buffer.from(original);
    fn(tar);
    if (resign) checksum(tar.subarray(0, 512));
    assert.throws(() => readArchive(gzipSync(tar)));
  };
  mutate(tar => { tar[0] ^= 1; });
  mutate(tar => { tar[124] = 128; }, true);
  mutate(tar => { tar[257] = 0; }, true);
  mutate(tar => { tar[500] = 1; }, true);
  mutate(tar => { tar[99] = 65; }, true);
  mutate(tar => { tar[511 + Buffer.byteLength(fixture()[0].body) + 1] = 1; });
  mutate(tar => { tar[tar.length - 1] = 1; });
  assert.throws(() => readArchive(gzipSync(original.subarray(0, -1024))), /end marker/);
  assert.throws(() => readArchive(gzipSync(original.subarray(0, -1))), /Truncated/);
  assert.throws(() => readArchive(Buffer.from('not gzip')), /gzip/);
  assert.throws(() => readArchive(Buffer.alloc(16 * 1024 * 1024 + 1)), /size limit/);
  assert.throws(() => readArchive(gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1))), /oversized/);
});

test('every required public file must exist and be nonempty', () => {
  for (const name of REQUIRED) {
    assert.throws(() => auditArchive(archive(fixture().filter(f => f.name !== `package/${name}`))), /Missing required/);
    assert.throws(() => auditArchive(archive(fixture().map(f => f.name === `package/${name}` ? { ...f, body: '' } : f))), /Missing required/);
  }
});

test('stable version, fixed repository and CLI entrypoint consistency are mandatory', () => {
  for (const version of ['v1.0.0', '1.0', '1.0.0-rc.1', '1.0.0+build', '01.0.0', '1.00.0', '1.0.0\n', 1]) {
    assert.throws(() => validatePackage({ ...pkg(), version }));
  }
  for (const url of [undefined, 'https://github.com/other/repo.git',
    'https://github.com/sonnivasquez/gsc-mcp.git?x=1', 'git+https://user@github.com/sonnivasquez/gsc-mcp.git']) {
    assert.throws(() => validatePackage({ ...pkg(), repository: { url } }), /repository/);
  }
  assert.throws(() => validatePackage({ ...pkg(), name: 'evil' }), /name/);
  assert.throws(() => validatePackage({ ...pkg(), bin: { gsc: 'dist/other.js' } }), /entrypoints/);
  assert.throws(() => auditArchive(archive(fixture().map(f => f.name === 'package/dist/version.js' ?
    { ...f, body: 'exports.CLI_VERSION = "2.0.0";' } : f))), /CLI version/);
  assert.throws(() => auditArchive(archive(fixture().map(f => f.name === 'package/package.json' ?
    { ...f, body: JSON.stringify({ ...pkg(), repository: {} }) } : f))), /repository/);
});

test('private credential patterns are rejected without disclosing values; public OAuth constants remain allowed', () => {
  const secrets = [
    '-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN OPENSSH PRIVATE KEY-----',
    `ghp_${'A'.repeat(36)}`, `github_pat_${'a'.repeat(60)}`, `npm_${'a'.repeat(36)}`,
    `ya29.${'a'.repeat(40)}`, `1//${'a'.repeat(40)}`, `AKIA${'A'.repeat(16)}`,
    `{"refresh_token":"${'x'.repeat(40)}"}`, `{"access_token":"${'x'.repeat(40)}"}`,
    `//registry.npmjs.org/:_authToken=${'x'.repeat(40)}`,
    `const refresh_token = "${'x'.repeat(40)}";`,
  ];
  for (const secret of secrets) {
    assert.throws(() => scanSecrets(Buffer.from(secret)), error => {
      assert.equal(error.message, 'Private credential pattern detected');
      assert.ok(!error.message.includes(secret));
      return true;
    });
    assert.throws(() => readArchive(archive([{ name: 'package/dist/a.js', body: secret }])), /credential pattern/);
  }
  for (const publicText of ['client_secret = "GOCSPX-public-desktop-client"',
    '123456789.apps.googleusercontent.com', 'refresh_token: process.env.REFRESH_TOKEN',
    'This document discusses secrets, tokens and private keys.']) scanSecrets(Buffer.from(publicText));
});

test('manifest and tarball tampering fail, including rehashed altered package identity', () => {
  const bytes = archive();
  const valid = candidate(bytes);
  for (const patch of [
    { name: 'other' }, { version: '2.0.0' }, { filename: '../evil.tgz' },
    { repository: 'other/repo' }, { sourceCommit: 'not-a-commit' }, { sourceCommit: 1 },
    { runId: '../1' }, { runAttempt: '0' }, { sha256: '0'.repeat(64) }, { integrity: 'sha512-wrong' },
    { entries: [] }, { extra: true }, { entries: valid.entries.map((e, i) => i ? e : { ...e, sha256: 'f'.repeat(64) }) },
    { entries: valid.entries.map((e, i) => i ? e : { ...e, path: '../evil' }) },
  ]) assert.throws(() => validateCandidate({ ...valid, ...patch }, bytes));
  const altered = archive(fixture().map(f => f.name === 'package/README.md' ? { ...f, body: 'modified' } : f));
  assert.throws(() => validateCandidate(valid, altered), /hash mismatch/);
  assert.throws(() => validateCandidate({ ...valid, sha256: sha256(altered), integrity: integrity(altered) }, altered), /entries mismatch/);
  const renamed = archive(fixture().map(f => f.name === 'package/package.json' ?
    { ...f, body: JSON.stringify({ ...pkg(), name: 'attacker' }) } : f));
  assert.throws(() => validateCandidate({ ...valid, sha256: sha256(renamed), integrity: integrity(renamed) }, renamed), /package name/);
});

test('registry requires exact identity, integrity and canonical HTTPS tarball URL', () => {
  const manifest = candidate();
  const metadata = registryMetadata(manifest);
  assert.equal(validateRegistry(metadata, manifest), metadata.dist.tarball);
  for (const url of [
    metadata.dist.tarball.replace('https:', 'http:'),
    metadata.dist.tarball.replace('registry.npmjs.org', 'registry.npmjs.org.evil.test'),
    metadata.dist.tarball.replace('registry.npmjs.org', 'user:pass@registry.npmjs.org'),
    metadata.dist.tarball.replace('registry.npmjs.org', 'registry.npmjs.org:443'),
    metadata.dist.tarball.replace('1.0.0', '2.0.0'),
    metadata.dist.tarball.replace('/-/gsc', '/-/../-/gsc'),
    metadata.dist.tarball.replace('@sonnivasquez', '%40sonnivasquez'),
    `${metadata.dist.tarball}?token=x`, `${metadata.dist.tarball}#fragment`,
    'file:///tmp/a.tgz', '//registry.npmjs.org/a.tgz', undefined,
  ]) assert.throws(() => validateRegistry({ ...metadata, dist: { ...metadata.dist, tarball: url } }, manifest), /URL/);
  for (const patch of [{ name: 'other' }, { version: '2.0.0' }, { dist: {} }]) {
    assert.throws(() => validateRegistry({ ...metadata, ...patch }, manifest));
  }
});

test('registry accepts the single-element array form of npm 12 view output', () => {
  const manifest = candidate();
  const metadata = registryMetadata(manifest);
  assert.equal(validateRegistry([metadata], manifest), metadata.dist.tarball);
  assert.throws(() => validateRegistry([], manifest), /Ambiguous registry response/);
  assert.throws(() => validateRegistry([metadata, metadata], manifest), /Ambiguous registry response/);
});

test('registry downloads are bounded, redirect-disabled and byte-identical', async () => {
  const bytes = archive();
  const manifest = candidate(bytes);
  const metadata = registryMetadata(manifest);
  const download = response => downloadRegistryTarball(metadata, manifest, async (url, options) => {
    assert.equal(url, metadata.dist.tarball);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response;
  });
  assert.deepEqual(await download(new Response(bytes)), manifest);
  await assert.rejects(download(new Response('unavailable', { status: 404 })), /unavailable/);
  await assert.rejects(download(new Response('changed')), /hash mismatch/);
  await assert.rejects(download(new Response(bytes, { headers: { 'content-length': String(17 * 1024 * 1024) } })), /size limit/);
  await assert.rejects(download(new Response(Buffer.alloc(16 * 1024 * 1024 + 1))), /size limit/);
  await assert.rejects(downloadRegistryTarball(metadata, manifest, async () => { throw new Error('redirect refused'); }), /redirect refused/);
  let fetched = false;
  await assert.rejects(downloadRegistryTarball({ ...metadata, dist: { ...metadata.dist, tarball: 'https://evil.test' } }, manifest,
    async () => { fetched = true; }), /URL/);
  assert.equal(fetched, false);
});

test('containment handles Windows casing, drives, UNC roots and sibling boundaries on every OS', () => {
  const windows = [
    ['C:\\work\\Source', 'c:\\WORK\\source', true],
    ['C:\\work\\Source', 'c:\\WORK\\source\\dist\\staging', true],
    ['C:\\work\\Source', 'C:/work/SOURCE/dist/new/staging', true],
    ['C:\\work\\Source', 'C:\\work\\source-other\\staging', false],
    ['C:\\work\\Source', 'C:\\work\\source2', false],
    ['C:\\work\\Source', 'C:\\work', false],
    ['C:\\work\\Source', 'D:\\work\\Source\\staging', false],
    ['C:\\work\\Source', 'C:\\work\\Source\\..\\outside', false],
    ['C:\\work\\Source', 'C:\\work\\Source\\..cache', true],
    ['\\\\server\\share\\Source', '\\\\SERVER\\SHARE\\source\\staging', true],
    ['\\\\server\\share\\Source', '\\\\server\\other\\Source\\staging', false],
    ['C:\\', 'c:\\staging', true],
  ];
  for (const [root, candidate, expected] of windows) {
    assert.equal(isWithinDirectory(root, candidate, path.win32), expected, candidate);
  }
  for (const [candidate, expected] of [
    ['/work/source', true], ['/work/source/dist/new', true], ['/work/source-other', false],
    ['/work/Source', false], ['/work', false], ['/elsewhere', false],
  ]) assert.equal(isWithinDirectory('/work/source', candidate, path.posix), expected, candidate);
});

test('prepare and verify work in an isolated checkout without changing package inputs', { timeout: 30_000 }, t => {
  const base = temporary(t);
  const root = path.join(base, 'source');
  fs.mkdirSync(root);
  for (const entry of fixture()) {
    const file = path.join(root, entry.name.slice(8));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entry.body);
  }
  const packageJson = { ...pkg(), files: ['dist', 'docs', 'skills', 'scripts/test-mcp.sh', ...REQUIRED.filter(f => !f.includes('/'))] };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    name: NAME, version: '1.0.0', lockfileVersion: 3, packages: { '': { name: NAME, version: '1.0.0' } },
  }));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/version.ts'), 'export const CLI_VERSION = "1.0.0";');
  for (const name of ['release-candidate.mjs', 'npm-command.mjs']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', name), path.join(root, 'scripts', name));
  }
  // A symbolic HEAD with an existing-looking object ID is enough for rev-parse;
  // no commits are created, even in this disposable fixture.
  fs.mkdirSync(path.join(root, '.git/objects'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git/refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git/refs/heads/main'), `${'a'.repeat(40)}\n`);
  const dest = path.join(base, 'candidate');
  const env = { ...process.env, GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  const run = (command, directory = dest, overrides = {}) => spawnSync(process.execPath,
    [path.join(root, 'scripts/release-candidate.mjs'), command, directory],
    { cwd: root, encoding: 'utf8', timeout: 25_000, env: { ...env, ...overrides } });
  const before = fs.readFileSync(path.join(root, 'package.json'));
  const prepared = run('prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(run('verify').status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'candidate.json')));
  assert.equal(manifest.runId, '123');
  assert.equal(manifest.runAttempt, '2');
  assert.equal(manifest.sourceCommit, 'a'.repeat(40));
  assert.deepEqual(fs.readFileSync(path.join(root, 'package.json')), before);
  assert.equal(run('prepare').status, 1, 'must not overwrite a candidate');
  assert.equal(run('prepare', path.join(base, 'fork'), { GITHUB_REPOSITORY: 'other/repo' }).status, 1);
  const snapshot = directory => fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name);
    return fs.lstatSync(file).isDirectory() ? [[file, 'directory'], ...snapshot(file)] : [[file, sha256(fs.readFileSync(file))]];
  });
  const originalTree = snapshot(root);
  const insideRoot = [root, path.join(root, 'dist'), path.join(root, 'dist/staging'),
    path.join(root, 'new-parent/nested/staging')];
  if (process.platform === 'win32') {
    insideRoot.push(path.join(base, 'SOURCE', 'dist', 'case-staging'));
  }
  for (const destination of insideRoot) {
    const rejected = run('prepare', destination);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /outside the source tree/);
    assert.deepEqual(snapshot(root), originalTree, 'rejection must not create directories or change source files');
  }
  const target = path.join(base, 'link-target');
  const alias = path.join(base, 'directory-alias');
  fs.mkdirSync(target);
  fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = run('prepare', path.join(alias, 'new-parent/staging'));
  assert.equal(linked.status, 1, linked.stderr);
  assert.match(linked.stderr, /symlinks/);
  assert.deepEqual(fs.readdirSync(target), [], 'must not create through a symlink or junction');
  fs.writeFileSync(path.join(root, 'src/version.ts'), 'export const CLI_VERSION = "2.0.0";');
  const mismatch = run('prepare', path.join(base, 'mismatch'));
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /Root CLI version mismatch/);
});

test('verify uses only safe regular candidate files and rejects unsafe directories', t => {
  const dir = temporary(t);
  const bytes = archive();
  const manifest = candidate(bytes);
  const mf = path.join(dir, 'candidate.json');
  const tgz = path.join(dir, manifest.filename);
  fs.writeFileSync(mf, JSON.stringify(manifest));
  fs.writeFileSync(tgz, bytes);
  assert.deepEqual(verify(dir), manifest);
  fs.writeFileSync(mf, JSON.stringify({ ...manifest, filename: '../escape.tgz' }));
  assert.throws(() => verify(dir), /filename/);
  fs.writeFileSync(mf, JSON.stringify(manifest));
  fs.renameSync(tgz, `${tgz}.real`);
  fs.symlinkSync(`${tgz}.real`, tgz);
  assert.throws(() => verify(dir), /Unsafe candidate file/);
  fs.unlinkSync(tgz);
  fs.linkSync(`${tgz}.real`, tgz);
  assert.throws(() => verify(dir), /Unsafe candidate file/);
  fs.unlinkSync(tgz);
  fs.renameSync(`${tgz}.real`, tgz);
  fs.renameSync(mf, `${mf}.real`);
  fs.symlinkSync(`${mf}.real`, mf);
  assert.throws(() => verify(dir), /Unsafe candidate file/);
  fs.symlinkSync(dir, path.join(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verify(path.join(dir, 'alias')), /symlinks/);
  assert.throws(() => verify(ROOT), /outside the source tree/);
});

test('CLI verifies fixtures and fails invalid commands without printing credential content', t => {
  const dir = temporary(t);
  const bytes = archive();
  const manifest = candidate(bytes);
  fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, manifest.filename), bytes);
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(run('verify', dir).status, 0);
  assert.equal(run('publish', dir).status, 1);
  assert.equal(run('verify', dir, 'extra').status, 1);
  assert.equal(run().status, 1);
  fs.writeFileSync(path.join(dir, 'candidate.json'), `npm_${'x'.repeat(36)}`);
  const result = run('verify', dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON/);
  assert.ok(!result.stderr.includes('x'.repeat(36)));
});

test('actual npm pack uses supported tar headers and passes public-file and credential audits', { timeout: 30_000 }, t => {
  const dir = temporary(t);
  const npm = npmCommand();
  const packed = parsePackJson(execFileSync(npm.command, [...npm.args, 'pack', '--json', '--ignore-scripts', '--pack-destination', dir], {
    cwd: ROOT, encoding: 'utf8', timeout: 25_000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const bytes = fs.readFileSync(path.join(dir, packed.filename));
  const files = readArchive(bytes);
  for (const name of REQUIRED) assert.ok(files.get(name)?.length, name);
  assert.equal(integrity(bytes), packed.integrity);
  // Root repository metadata is maintained by the parent task, not this test.
});
