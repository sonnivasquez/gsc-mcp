#!/usr/bin/env node
// Staging and comparison only. Hashes detect changes, not authenticity: preserve
// candidate.json as a trusted CI artifact. Pattern scanning is not a privacy proof.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { npmCommand } from './npm-command.mjs';

export const NAME = '@sonnivasquez/gsc-mcp';
export const REPOSITORY = 'sonnivasquez/gsc-mcp';
export const REQUIRED = Object.freeze([
  'package.json', 'README.md', 'PRIVACY.md', 'ROADMAP.md', 'LICENSE', 'NOTICE',
  'CHANGELOG.md', 'docs/tools.md', 'docs/quickstart.md', 'docs/quickstart.es.md',
  'dist/index.js', 'dist/cli.js', 'dist/server.js', 'dist/version.js',
  'scripts/test-mcp.sh', 'skills/google-search-console-mcp/SKILL.md',
  'skills/google-search-console-mcp/references/tool-catalog.md',
]);
// One canonicalizer on both sides of the containment comparison: Bun's
// fs.realpathSync preserves 8.3/casing spellings (C:\Users\RUNNER~1\...),
// while realpathSync.native resolves them (C:\Users\runneradmin\...).
const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const MAX_ARCHIVE = 16 * 1024 * 1024;
const MAX_UNPACKED = 64 * 1024 * 1024;
const check = (ok, message) => { if (!ok) throw new Error(message); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const json = bytes => {
  try { return JSON.parse(bytes.toString()); } catch { throw new Error('Invalid JSON'); }
};
const stable = version => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
const filename = version => `sonnivasquez-gsc-mcp-${version}.tgz`;

export function parsePackJson(text) {
  const value = json(text);
  const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  check(items.length === 1 && items[0]?.name === NAME, 'Unexpected npm pack identity');
  if (!Array.isArray(value)) check(Object.keys(value)[0] === NAME, 'Unexpected npm pack key');
  const item = items[0];
  check(stable(item.version) && item.filename === filename(item.version), 'Unsafe npm pack filename or version');
  return item;
}

export function auditPath(name) {
  check(typeof name === 'string' && name.startsWith('package/'), 'Archive path outside package');
  const parts = name.slice(8).split('/');
  check(parts.every(p => /^[A-Za-z0-9_@.-]+$/.test(p) && p !== '.' && p !== '..' &&
    !p.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), 'Unsafe archive path');
  const lower = parts.map(p => p.toLowerCase());
  check(!lower.some(p => ['.atl', 'screenshots', '.impeccable', '.git', '.github', 'node_modules', 'secrets', 'credentials'].includes(p) ||
    /^\.env(?:\.|$)/.test(p) || /^(?:\.npmrc|\.netrc|id_rsa|id_ed25519)$/.test(p) ||
    /(?:^|[._-])(?:secrets?|credentials?|tokens?)(?:\.|$)/.test(p) || /\.(?:pem|key|p12|pfx)$/.test(p)), 'Forbidden archive path');
  check(!lower.join('/').startsWith('docs/verification'), 'Forbidden verification artifact');
  const relative = parts.join('/');
  check(REQUIRED.includes(relative) || /^(?:dist|skills\/google-search-console-mcp)\//.test(relative), 'Unexpected public file');
  return relative;
}

export function scanSecrets(bytes) {
  const text = bytes.toString('utf8');
  // Public Desktop OAuth client IDs and GOCSPX client constants are intentional.
  const patterns = [
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,})\b/,
    /\b(?:ya29\.[A-Za-z0-9_-]{20,}|1\/\/[A-Za-z0-9_-]{20,})/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\b(?:access_token|refresh_token|private_key|_authToken)\b["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']/i,
    /(?:_authToken|authorization)\s*[:=]\s*["']?(?:Bearer\s+)?[A-Za-z0-9_+\/.=-]{24,}/i,
  ];
  check(!patterns.some(pattern => pattern.test(text)), 'Private credential pattern detected');
}

// Only bounded gzip + regular-file ustar, never extract or execute archive data.
export function readArchive(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length <= MAX_ARCHIVE, 'Archive size limit');
  let tar;
  try { tar = gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED }); }
  catch { throw new Error('Invalid or oversized gzip archive'); }
  check(tar.length % 512 === 0, 'Truncated tar archive');
  const files = new Map();
  const names = new Set();
  const field = (header, start, length) => {
    const slice = header.subarray(start, start + length);
    const end = slice.indexOf(0);
    check(end < 0 || slice.subarray(end).every(b => b === 0), 'Malformed tar string');
    return slice.subarray(0, end < 0 ? length : end).toString('ascii');
  };
  const octal = (header, start, length) => {
    const value = header.subarray(start, start + length).toString('ascii');
    check(/^[0-7]+[\0 ]*$/.test(value), 'Unsupported tar numeric field');
    return parseInt(value, 8);
  };
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every(b => b === 0)) {
      check(tar.length - offset >= 1024 && tar.subarray(offset).every(b => b === 0), 'Invalid tar end marker');
      check(files.size > 0, 'Empty archive');
      return files;
    }
    check(h.every(b => b < 128), 'Non-ASCII tar header');
    const sum = h.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    check(octal(h, 148, 8) === sum, 'Tar checksum mismatch');
    check(h.subarray(257, 265).equals(Buffer.from('ustar\0' + '00')), 'Unsupported tar format');
    check(h[156] === 0 || h[156] === 48, 'Unsupported archive entry type');
    check(field(h, 157, 100) === '', 'Archive links forbidden');
    check((octal(h, 100, 8) & ~0o777) === 0, 'Unsafe archive mode');
    check(h.subarray(500).every(b => b === 0), 'Unsupported tar header extension');
    const prefix = field(h, 345, 155);
    const name = auditPath(`${prefix ? `${prefix}/` : ''}${field(h, 0, 100)}`);
    check(!names.has(name.toLowerCase()), 'Duplicate archive path');
    names.add(name.toLowerCase());
    const size = octal(h, 124, 12);
    const start = offset + 512;
    offset = start + Math.ceil(size / 512) * 512;
    check(offset <= tar.length, 'Truncated archive file');
    check(tar.subarray(start + size, offset).every(b => b === 0), 'Nonzero tar padding');
    const body = tar.subarray(start, start + size);
    scanSecrets(body);
    files.set(name, body);
    check(files.size <= 4096, 'Too many archive entries');
  }
  throw new Error('Missing tar end marker');
}

export function validatePackage(pkg) {
  check(pkg?.name === NAME && stable(pkg.version), 'Invalid package name or stable version');
  check(['https://github.com/sonnivasquez/gsc-mcp', 'https://github.com/sonnivasquez/gsc-mcp.git',
    'git+https://github.com/sonnivasquez/gsc-mcp.git'].includes(pkg.repository?.url), 'Invalid package repository.url');
  check(pkg.main === 'dist/index.js' && pkg.bin?.gsc === pkg.main && pkg.bin?.['gsc-mcp'] === pkg.main,
    'Inconsistent package entrypoints');
  return pkg;
}

export function auditArchive(bytes) {
  const files = readArchive(bytes);
  for (const name of REQUIRED) check(files.get(name)?.length > 0, `Missing required file: ${name}`);
  const pkg = validatePackage(json(files.get('package.json')));
  const versions = [...files.get('dist/version.js').toString().matchAll(/\bCLI_VERSION\s*=\s*["']([^"']+)["']/g)];
  check(versions.length === 1 && versions[0][1] === pkg.version, 'Embedded CLI version mismatch');
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, body]) => ({ path: name, size: body.length, sha256: sha256(body) }));
  return { pkg, entries };
}

export function validateCandidate(manifest, bytes) {
  check(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid candidate manifest');
  const keys = ['name', 'version', 'filename', 'sha256', 'integrity', 'sourceCommit', 'repository', 'runId', 'runAttempt', 'entries'];
  check(Object.keys(manifest).length === keys.length && keys.every(k => Object.hasOwn(manifest, k)), 'Invalid manifest fields');
  check(manifest.name === NAME && stable(manifest.version) && manifest.filename === filename(manifest.version), 'Invalid candidate identity');
  check(manifest.repository === REPOSITORY && typeof manifest.sourceCommit === 'string' &&
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(manifest.sourceCommit), 'Invalid candidate provenance');
  check(typeof manifest.runId === 'string' && /^(?:local|[1-9]\d*)$/.test(manifest.runId) &&
    typeof manifest.runAttempt === 'string' && /^[1-9]\d*$/.test(manifest.runAttempt), 'Invalid candidate run');
  check(manifest.sha256 === sha256(bytes) && manifest.integrity === integrity(bytes), 'Candidate archive hash mismatch');
  const { pkg, entries } = auditArchive(bytes);
  check(pkg.name === manifest.name && pkg.version === manifest.version, 'Candidate package identity mismatch');
  check(Array.isArray(manifest.entries) && manifest.entries.length === entries.length &&
    entries.every((entry, i) => {
      const actual = manifest.entries[i];
      return actual && Object.keys(actual).length === 3 && Object.keys(entry).every(k => entry[k] === actual[k]);
    }), 'Candidate entries mismatch');
  return manifest;
}

export function validateRegistry(response, manifest) {
  // npm 12 (pinned in release workflows) wraps `npm view --json` in a
  // single-element array; normalize it, rejecting anything ambiguous.
  check(!Array.isArray(response) || response.length === 1, 'Ambiguous registry response');
  const metadata = Array.isArray(response) ? response[0] : response;
  check(metadata?.name === manifest.name && metadata.version === manifest.version, 'Registry identity mismatch');
  check(metadata.dist?.integrity === manifest.integrity, 'Registry integrity mismatch');
  const expected = `https://registry.npmjs.org/${NAME}/-/gsc-mcp-${manifest.version}.tgz`;
  // Exact raw URL comparison also rejects normalization tricks and redirects.
  check(metadata.dist.tarball === expected, 'Unsafe registry tarball URL');
  return expected;
}

// Inputs are canonical absolute paths. Inject win32/posix for portable tests;
// relative() handles Windows drive/UNC casing and distinguishes sibling names.
export function isWithinDirectory(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith(`..${paths.sep}`));
}

function safeDirectory(dir, create = false) {
  check(typeof dir === 'string' && dir.length > 0, 'Missing candidate directory');
  const absolute = path.resolve(dir);
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  let index = 0;
  // Inspect the original spelling before realpath can hide a symlink/junction.
  // Do not create anything until the nearest existing ancestor is canonicalized.
  for (; index < parts.length; index++) {
    const next = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(next); }
    catch (error) {
      if (error.code === 'ENOENT' && create) break;
      throw error;
    }
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'Candidate directory must not contain symlinks');
    current = next;
  }
  // Same canonicalizer as ROOT: both sides must converge to one spelling family.
  current = fs.realpathSync.native(current);
  const missing = parts.slice(index);
  const destination = path.join(current, ...missing);
  check(!isWithinDirectory(ROOT, destination), 'Candidate directory must be outside the source tree');
  for (const part of missing) {
    current = path.join(current, part);
    fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'Candidate directory must not contain symlinks');
  }
  return destination;
}

function readRegular(file, max) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= max, 'Unsafe candidate file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    check(opened.ino === stat.ino && opened.dev === stat.dev, 'Candidate file changed');
    const bytes = fs.readFileSync(fd);
    check(bytes.length <= max, 'Candidate file size limit');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function npm(args) {
  const command = npmCommand();
  try {
    return execFileSync(command.command, [...command.args, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('npm command failed or registry version unavailable'); }
}

function rootMetadata() {
  const read = name => fs.readFileSync(path.join(ROOT, name));
  const pkg = validatePackage(json(read('package.json')));
  const lock = json(read('package-lock.json'));
  check(lock.version === pkg.version && lock.packages?.['']?.version === pkg.version &&
    lock.name === pkg.name && lock.packages[''].name === pkg.name &&
    json(read('manifest.json')).version === pkg.version, 'Root metadata mismatch');
  for (const name of ['src/version.ts', 'dist/version.js']) {
    const versions = [...read(name).toString().matchAll(/\bCLI_VERSION\s*=\s*["']([^"']+)["']/g)];
    check(versions.length === 1 && versions[0][1] === pkg.version, 'Root CLI version mismatch');
  }
  return pkg;
}

export function prepare(dir) {
  const pkg = rootMetadata();
  check((process.env.GITHUB_REPOSITORY ?? REPOSITORY) === REPOSITORY, 'Unexpected source repository');
  const destination = safeDirectory(dir, true);
  check(fs.readdirSync(destination).length === 0, 'Prepare requires an empty candidate directory');
  const packed = parsePackJson(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination]));
  check(packed.version === pkg.version, 'Packed root version mismatch');
  const bytes = readRegular(path.join(destination, packed.filename), MAX_ARCHIVE);
  const audited = auditArchive(bytes);
  check(packed.integrity === integrity(bytes), 'npm pack integrity mismatch');
  const manifest = {
    name: pkg.name, version: pkg.version, filename: packed.filename,
    sha256: sha256(bytes), integrity: integrity(bytes),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    repository: process.env.GITHUB_REPOSITORY ?? REPOSITORY,
    runId: process.env.GITHUB_RUN_ID ?? 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
    entries: audited.entries,
  };
  validateCandidate(manifest, bytes);
  fs.writeFileSync(path.join(destination, 'candidate.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

export function verify(dir) {
  const destination = safeDirectory(dir);
  const manifest = json(readRegular(path.join(destination, 'candidate.json'), 2 * 1024 * 1024));
  check(stable(manifest?.version) && manifest.filename === filename(manifest.version), 'Unsafe candidate filename');
  return validateCandidate(manifest, readRegular(path.join(destination, manifest.filename), MAX_ARCHIVE));
}

export async function registry(dir) {
  const manifest = verify(dir);
  const metadata = json(npm(['view', `${NAME}@${manifest.version}`, '--json', '--registry=https://registry.npmjs.org/']));
  return downloadRegistryTarball(metadata, manifest);
}

export async function downloadRegistryTarball(metadata, manifest, fetchImpl = fetch) {
  const url = validateRegistry(metadata, manifest);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  check(response.ok && response.body, 'Registry tarball unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    const declared = response.headers.get('content-length');
    check(declared === null || (/^\d+$/.test(declared) && Number(declared) <= MAX_ARCHIVE), 'Registry download size limit');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      check(size <= MAX_ARCHIVE, 'Registry download size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  validateCandidate(manifest, Buffer.concat(chunks));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(Number(process.versions.node.split('.')[0]) >= 22, 'Node >=22 required');
    const [command, dir, ...extra] = process.argv.slice(2);
    check(['prepare', 'verify', 'registry'].includes(command) && dir && extra.length === 0,
      'Usage: node scripts/release-candidate.mjs <prepare|verify|registry> <dir>');
    const result = await ({ prepare, verify, registry })[command](dir);
    console.log(`${command}: ${result.name}@${result.version} ${result.sha256}`);
  } catch (error) {
    // Do not print child-process output, paths, tokens, or parser input.
    console.error(`release-candidate: ${error.code ? 'I/O or network operation failed' : error.message}`);
    process.exitCode = 1;
  }
}
