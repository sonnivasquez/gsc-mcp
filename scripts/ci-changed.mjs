#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHARED_EXACT = new Set([
  'web/src/lib/site.ts',
  'web/public/install.sh',
  'package.json',
  'package-lock.json',
  'src/version.ts',
  'src/gsc/catalog.ts',
  'manifest.json',
  'CHANGELOG.md',
  'DESIGN.md',
  '.impeccable/design.json',
  'web/src/styles/tokens.css',
  'web/scripts/sync-design-tokens.mjs',
  'scripts/ci-changed.mjs',
  'test/ci-changed.test.mjs',
]);

const WORKFLOWS_PREFIX = '.github/workflows/';
const WEB_PREFIX = 'web/';
const MCP_PREFIXES = ['src/', 'test/', 'scripts/', 'skills/', 'docs/', 'fixtures/'];
const MCP_ROOT_EXACT = new Set([
  'bun.lock',
  'tsconfig.json',
  'compatibility-manifest.json',
  '.mcpbignore',
  'README.md',
  'PRIVACY.md',
  'server.json',
]);

const HEX_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ZERO_SHA = /^0+$/;

function isValidSha(value) {
  return typeof value === 'string' && HEX_SHA.test(value) && !ZERO_SHA.test(value);
}

export function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return { mcp_changed: true, web_changed: true };
  let mcp = false;
  let web = false;
  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) return { mcp_changed: true, web_changed: true };
    if (SHARED_EXACT.has(file) || file.startsWith(WORKFLOWS_PREFIX)) {
      mcp = true;
      web = true;
    } else if (file.startsWith(WEB_PREFIX)) {
      web = true;
    } else if (MCP_PREFIXES.some(prefix => file.startsWith(prefix)) || MCP_ROOT_EXACT.has(file)) {
      mcp = true;
    } else {
      mcp = true;
      web = true;
    }
  }
  if (!mcp && !web) return { mcp_changed: true, web_changed: true };
  return { mcp_changed: mcp, web_changed: web };
}

export function parseNameStatus(raw) {
  if (typeof raw !== 'string') throw new Error('Invalid diff output');
  if (raw === '') return [];
  if (!raw.endsWith('\0')) throw new Error('Invalid diff output');
  const tokens = raw.split('\0');
  tokens.pop();
  const files = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    if (typeof status !== 'string' || status.length === 0 || !'ACDMRTUXB'.includes(status[0])) {
      throw new Error('Invalid diff status');
    }
    const kind = status[0];
    const digits = status.slice(1);
    if (kind === 'R' || kind === 'C') {
      if (!/^[0-9]{1,3}$/.test(digits) || Number(digits) > 100) throw new Error('Invalid diff status');
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (typeof oldPath !== 'string' || oldPath.length === 0 || typeof newPath !== 'string' || newPath.length === 0) {
        throw new Error('Invalid rename entry');
      }
      files.push(oldPath, newPath);
      i += 3;
    } else {
      if (kind === 'M') {
        if (digits.length > 0 && (!/^[0-9]{1,3}$/.test(digits) || Number(digits) > 100)) {
          throw new Error('Invalid diff status');
        }
      } else if (digits.length > 0) {
        throw new Error('Invalid diff status');
      }
      const filePath = tokens[i + 1];
      if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('Invalid diff entry');
      files.push(filePath);
      i += 2;
    }
  }
  return files;
}

export function describeEvent(eventName, eventData) {
  if (eventName === 'pull_request') {
    const base = eventData?.pull_request?.base?.sha;
    const head = eventData?.pull_request?.head?.sha;
    if (!isValidSha(base) || !isValidSha(head)) return { kind: 'conservative' };
    return { kind: 'pull_request', base, head };
  }
  if (eventName === 'push') {
    const before = eventData?.before;
    const after = eventData?.after;
    if (!isValidSha(before) || !isValidSha(after) || before === after) return { kind: 'conservative' };
    return { kind: 'push', before, after };
  }
  return { kind: 'conservative' };
}

function execGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
}

function diffFilesForSpec(spec, exec = execGit) {
  if (spec.kind === 'pull_request') {
    const mergeBase = exec(['merge-base', spec.base, spec.head]).trim();
    if (!isValidSha(mergeBase) && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(mergeBase)) throw new Error('Unresolvable merge base');
    if (ZERO_SHA.test(mergeBase)) throw new Error('Unresolvable merge base');
    const raw = exec(['diff', '--name-status', '-z', mergeBase, spec.head]);
    return parseNameStatus(raw);
  }
  if (spec.kind === 'push') {
    const raw = exec(['diff', '--name-status', '-z', spec.before, spec.after]);
    return parseNameStatus(raw);
  }
  throw new Error('Conservative fallback');
}

export function writeOutputs(values, outputFile) {
  if (typeof outputFile !== 'string' || outputFile.length === 0) throw new Error('GITHUB_OUTPUT is required');
  const lines = `mcp_changed=${values.mcp_changed ? 'true' : 'false'}\nweb_changed=${values.web_changed ? 'true' : 'false'}\n`;
  try {
    fs.appendFileSync(outputFile, lines);
  } catch {
    throw new Error('Cannot write GITHUB_OUTPUT');
  }
}

export async function main(argv = [], deps = {}) {
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? execGit;
  const readEvent = deps.readEvent ?? ((eventPath) => JSON.parse(fs.readFileSync(eventPath, 'utf8')));
  const emit = deps.emit ?? ((values) => writeOutputs(values, env.GITHUB_OUTPUT));
  const eventName = env.GITHUB_EVENT_NAME;
  const eventPath = env.GITHUB_EVENT_PATH;
  let result = { mcp_changed: true, web_changed: true };
  try {
    const data = readEvent(eventPath);
    const spec = describeEvent(eventName, data);
    if (spec.kind !== 'conservative') {
      const files = diffFilesForSpec(spec, exec);
      result = classify(files);
    }
  } catch {
    result = { mcp_changed: true, web_changed: true };
  }
  emit(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`ci-changed: ${error instanceof Error ? error.message : 'Operation failed'}`);
    process.exitCode = 1;
  });
}
