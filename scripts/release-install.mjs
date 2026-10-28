#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verify, NAME } from './release-candidate.mjs';
import { npmCommand } from './npm-command.mjs';
import { homeEnvironment, observeChild, stopChild } from '../test/helpers/subprocess.mjs';
import { createMcpClientRunner } from '../test/helpers/mcp-client.mjs';

const ROOT = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const windows = process.platform === 'win32';
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
// Remove case variants too. No user npm config, runtime injection, or CI credentials.
function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GSC_|npm_config_|BUN_|ACTIONS_|GITHUB_|GH_|RUNNER_)/i.test(key) &&
    !/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY)/i.test(key) &&
    !/^(NODE_OPTIONS|NODE_PATH|SSH_AUTH_SOCK|SSH_AGENT_PID|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|XDG_.*)$/i.test(key)));
}
function environment(base) {
  const home = path.join(base, 'home');
  const env = {
    ...cleanEnvironment(), ...homeEnvironment(home),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    npm_config_cache: path.join(base, 'npm-cache'),
    npm_config_userconfig: path.join(base, 'npmrc'), npm_config_globalconfig: path.join(base, 'global-npmrc'),
    BUN_INSTALL: path.join(base, 'bun-home'), BUN_INSTALL_CACHE_DIR: path.join(base, 'bun-cache'),
    TMPDIR: path.join(base, 'tmp'), TMP: path.join(base, 'tmp'), TEMP: path.join(base, 'tmp'),
  };
  for (const key of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
    fs.mkdirSync(env[key], { recursive: true });
  }
  fs.writeFileSync(env.npm_config_userconfig, '');
  fs.writeFileSync(env.npm_config_globalconfig, '');
  return env;
}
async function run(command, args, cwd, env, timeout = 30_000, extra = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], ...extra });
  const observed = observeChild(child);
  let output = '', bytes = 0, timer;
  let rejectLimit;
  const limit = new Promise((_, reject) => { rejectLimit = reject; });
  for (const [stream, capture] of [[child.stdout, true], [child.stderr, false]]) {
    stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) rejectLimit(new Error('Command output exceeded 4 MiB'));
      else if (capture) output += chunk.toString();
    });
  }
  try {
    await Promise.race([observed.close, limit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
    })]);
    assert.equal(child.exitCode, 0, `${path.basename(command)} failed: exit=${child.exitCode}, signal=${child.signalCode}`);
    return output.trim();
  } finally {
    clearTimeout(timer);
    await stopChild(observed);
  }
}
function aliasCommand(file, args, cwd, env) {
  if (!windows) return run(file, args, cwd, env);
  // Only our generated npm shim and fixed arguments enter cmd.exe. Disable expansion.
  assert(!/["\r\n%!]/.test(file), 'Unsafe generated Windows shim path');
  assert(args.every(arg => /^[a-z-]+$/.test(arg)), 'Unsafe shim argument');
  const comspec = process.env.ComSpec || process.env.COMSPEC || path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
  return run(comspec, ['/d', '/v:off', '/s', '/c', `""${file}" ${args.join(' ')}"`], cwd, env, 30_000,
    { windowsVerbatimArguments: true });
}
async function checkInstall(base, entry, runtime, version, env, aliases) {
  // Single canonicalizer on both sides: temp roots may arrive in 8.3 short
  // spelling (C:\Users\RUNNER~1\...) while the installed CLI reports its
  // own path canonically. realpathSync.native converges both spellings.
  const realEntry = fs.realpathSync.native(entry);
  assert(inside(fs.realpathSync.native(base), realEntry) && !inside(ROOT, realEntry), 'Entrypoint escaped installation');
  // Finalize can run from a newer checkout than the approved candidate.
  // Compare the installed server to its own canonical catalog, not main's.
  const { CANONICAL_TOOLS } = await import(pathToFileURL(path.join(path.dirname(realEntry), 'gsc', 'catalog.js')).href);
  const expectedTools = CANONICAL_TOOLS.map(tool => tool.name).sort();
  assert.equal(new Set(expectedTools).size, expectedTools.length, 'Duplicate canonical tool names');
  const invoke = args => run(runtime, [entry, ...args], base, env);
  assert.equal(await invoke(['--version']), version);
  const commands = aliases.length ? aliases.map(file => args => aliasCommand(file, args, base, env)) : [invoke];
  for (const command of commands) {
    assert.equal(await command(['--version']), version);
    const config = JSON.parse(await command(['config', 'print', '--client', 'generic']));
    const configured = config.mcpServers?.['gsc-local']?.args?.[0];
    assert(typeof configured === 'string' && path.isAbsolute(configured), 'Config entry must be absolute');
    assert(inside(fs.realpathSync.native(base), fs.realpathSync.native(configured)) && !inside(ROOT, fs.realpathSync.native(configured)), 'Config points outside installed prefix');
    assert.equal(fs.realpathSync.native(configured), realEntry);
  }
  const withClient = createMcpClientRunner({
    // Do not spread options.env: the helper merges the parent environment back in.
    makeTransport: options => new StdioClientTransport({
      ...options, command: runtime, args: [entry, 'serve'], cwd: base, env,
    }),
  });
  await withClient({ name: 'release-installed-smoke' }, async (client, options) => {
    assert.equal(client.getServerVersion()?.version, version, 'MCP initialize version');
    const listing = await client.listTools({}, options);
    assert.equal(new Set(listing.tools.map(tool => tool.name)).size, expectedTools.length);
    assert.deepEqual(listing.tools.map(tool => tool.name).sort(), expectedTools);
    assert(!listing.nextCursor, 'Unexpected additional tools');
    assert(listing.tools.some(tool => tool.name === 'gsc_capabilities'));
    const result = await client.callTool({ name: 'gsc_capabilities', arguments: {} }, undefined, options);
    assert(!result.isError, 'Capabilities tool failed');
    const envelope = JSON.parse(result.content.find(item => item.type === 'text')?.text);
    assert.equal(envelope.status, 'ok');
    assert.deepEqual(envelope.data.tools.map(tool => tool.name).sort(), expectedTools);
  }); // Resolves only after the helper confirms transport closure.
  console.log(`${path.basename(runtime)}: installed CLI/config, MCP version, ${expectedTools.length} tools, capabilities, close OK`);
}

let temporary;
try {
  const [directory, ...extra] = process.argv.slice(2);
  assert(directory && extra.length === 0, 'Usage: node scripts/release-install.mjs <candidate-dir>');
  const candidateDir = path.resolve(directory);
  const candidate = verify(candidateDir);
  const tarball = path.join(candidateDir, candidate.filename);
  const npm = npmCommand();
  const searchPath = process.env.PATH ?? process.env.Path ?? '';
  const bun = searchPath.split(path.delimiter).filter(Boolean)
    .map(dir => path.resolve(dir, windows ? 'bun.exe' : 'bun')).find(file => fs.existsSync(file));
  assert(bun, 'Bun must be installed on PATH');
  const tempRoot = fs.realpathSync(os.tmpdir());
  assert(!inside(ROOT, tempRoot), 'Temporary directory must be outside checkout');
  temporary = fs.mkdtempSync(path.join(tempRoot, 'gsc-release-install-'));
  const npmBase = path.join(temporary, 'npm');
  const npmEnv = environment(npmBase);
  await run(npm.command, [...npm.args, 'install', '--global', '--prefix', npmBase,
    '--ignore-scripts', '--no-audit', '--no-fund', tarball], npmBase, npmEnv, 180_000);
  const npmPackage = path.join(npmBase, ...(windows ? [] : ['lib']), 'node_modules', NAME);
  await checkInstall(npmBase, path.join(npmPackage, 'dist', 'index.js'), npm.command, candidate.version, npmEnv,
    ['gsc', 'gsc-mcp'].map(name => path.join(npmBase, ...(windows ? [] : ['bin']), name + (windows ? '.cmd' : ''))));
  const bunBase = path.join(temporary, 'bun');
  const bunEnv = environment(bunBase);
  fs.writeFileSync(path.join(bunBase, 'package.json'), JSON.stringify({ name: 'release-install-private', private: true,
    dependencies: { [NAME]: tarball } }));
  await run(bun, ['install', '--ignore-scripts'], bunBase, bunEnv, 180_000);
  await checkInstall(bunBase, path.join(bunBase, 'node_modules', NAME, 'dist', 'index.js'), bun,
    candidate.version, bunEnv, []);
  assert.deepEqual(verify(candidateDir), candidate, 'Candidate changed during installation checks');
  fs.rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
  console.log(`release-install: ${candidate.name}@${candidate.version} ${candidate.sha256} OK`);
} catch (error) {
  console.error(error);
  if (temporary) console.error(`Retained failed installation: ${temporary}`);
  process.exitCode = 1;
}
