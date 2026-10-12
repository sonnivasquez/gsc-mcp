#!/usr/bin/env node
// Node-only supervisor. CLI deadlines are per invocation; suite deadlines cover
// all 112 tests, not each test/callback. Cleanup shares one additional 5s budget.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 2 * 1024 * 1024;
const CLEANUP_MS = 5_000;
export const TESTS = ['cli-startup', 'cli', 'doctor-online', 'auth', 'setup-localized-flow', 'setup-finish'].map(name => `test/${name}.test.mjs`);
const ENV_KEYS = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'COMSPEC', 'PATHEXT', 'SYSTEMDRIVE', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']);

export async function isolation() {
  const base = await mkdtemp(join(tmpdir(), 'gsc-cli-validation-'));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (ENV_KEYS.has(key.toUpperCase())) env[key] = value;
  const home = join(base, 'home');
  const cache = join(base, 'bun-cache');
  await Promise.all([home, cache, join(home, 'appdata'), join(home, 'localappdata')].map(path => mkdir(path, { recursive: true })));
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'), XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), GSC_DATA_DIR: join(home, 'data'), GSC_AUTH_MODE: 'service_account', BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache, NODE_ENV: 'test' });
  return { base, env };
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// No shell and no inherited credential/startup environment. Capture prefixes by
// bytes (not characters); total bytes and overflow remain visible in the report.
export async function supervise(command, args, { env, deadlineMs, cwd = ROOT, limit = LIMIT } = {}) {
  assert.ok(deadlineMs > 0);
  const started = performance.now();
  const row = { startedAt: new Date().toISOString(), finishedAt: null, status: null, signal: null, error: null, exit: false, close: false, outputLimit: false, timedOut: false, terminationConfirmed: false, elapsedMs: 0, stdoutBytes: 0, stderrBytes: 0, stdout: '', stderr: '', cleanupError: null };
  const chunks = { stdout: [], stderr: [] };
  const retained = { stdout: 0, stderr: 0 };
  let child;
  let deadline;
  let cleanup;
  let escalation;
  let poll;
  let killer;
  let stopping = false;
  let cleanupStarted;
  let taskkillDone = false;
  return await new Promise(resolveResult => {
    let finished = false;
    const finish = confirmed => {
      if (finished) return;
      finished = true;
      for (const timer of [deadline, cleanup, escalation, poll]) clearTimeout(timer);
      if (killer && !taskkillDone) { killer.kill(); killer.unref(); }
      if (!confirmed) {
        // Unknown termination must not hold the supervisor open indefinitely.
        // Detach observation only; the private root is deliberately retained.
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();
      }
      row.terminationConfirmed = confirmed;
      row.finishedAt = new Date().toISOString();
      row.elapsedMs = Math.round(performance.now() - started);
      row.cleanupElapsedMs = cleanupStarted === undefined ? 0 : Math.ceil(performance.now() - cleanupStarted);
      for (const stream of ['stdout', 'stderr']) row[stream] = Buffer.concat(chunks[stream]).toString('utf8');
      resolveResult(row);
    };
    const check = () => {
      if (finished) return;
      // ENOENT has error+close but no exit event and no spawned process.
      if (row.close && !child.pid) return finish(true);
      if (row.close && row.exit) {
        if (process.platform === 'win32') {
          if (!stopping || taskkillDone) return finish(true);
        } else if (!groupAlive(child.pid)) return finish(true);
        else stop();
      }
      poll = setTimeout(check, 20);
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      cleanupStarted = performance.now();
      clearTimeout(deadline);
      cleanup = setTimeout(() => { row.cleanupError = 'Termination unconfirmed within 5s; private HOME/cache retained'; finish(false); }, CLEANUP_MS);
      if (!child.pid) return;
      if (process.platform === 'win32') {
        killer = spawn(join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { env, stdio: 'ignore', windowsHide: true });
        killer.on('error', error => { row.cleanupError = `taskkill error: ${error.code || error.name}`; });
        killer.on('close', code => { taskkillDone = code === 0; if (!taskkillDone) row.cleanupError = `taskkill exit ${code}; tree termination unknown`; });
      } else {
        const signal = name => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') row.cleanupError = `group signal error: ${error.code || error.name}`; } };
        signal('SIGTERM');
        escalation = setTimeout(() => signal('SIGKILL'), 2_500);
      }
    };
    child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.on('error', error => { row.error = { code: error.code || null, name: error.name }; });
    child.on('exit', (status, signal) => { row.exit = true; row.status = status; row.signal = signal; });
    child.on('close', (status, signal) => { row.close = true; row.status = status; row.signal = signal; });
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      row[`${stream}Bytes`] += chunk.length;
      const room = Math.max(0, limit - retained[stream]);
      if (room) { const prefix = chunk.subarray(0, room); chunks[stream].push(prefix); retained[stream] += prefix.length; }
      if (row[`${stream}Bytes`] > limit) { row.outputLimit = true; stop(); }
    });
    deadline = setTimeout(() => { row.timedOut = true; stop(); }, deadlineMs);
    check();
  });
}

function completed(row) { return row.terminationConfirmed && row.close && !row.error && !row.signal && !row.timedOut && !row.outputLimit && !row.cleanupError; }

async function isolatedRun(command, args, deadlineMs, options = {}) {
  const privateRoot = await isolation();
  const row = await supervise(command, args, { env: privateRoot.env, deadlineMs, ...options });
  // Never remove a private root that may still belong to a live process.
  if (row.terminationConfirmed) {
    let timer;
    const remaining = Math.max(0, CLEANUP_MS - row.cleanupElapsedMs);
    try {
      await Promise.race([
        rm(privateRoot.base, { recursive: true, force: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Private-root cleanup exceeded shared 5s budget')), remaining); }),
      ]);
    } catch (error) { row.cleanupError = error.message; }
    finally { clearTimeout(timer); }
  }
  return row;
}

export async function selfcheck() {
  const cases = [
    ['success', process.execPath, ['-e', 'process.stdout.write("ok")'], 30_000, row => completed(row) && row.status === 0 && row.stdout === 'ok'],
    ['nonzero', process.execPath, ['-e', 'process.exit(7)'], 30_000, row => completed(row) && row.status === 7],
    ['enoent', join(tmpdir(), 'gsc-no-such-executable-validation'), [], 30_000, row => row.error?.code === 'ENOENT' && row.close && row.terminationConfirmed],
    ['output-cap', process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(3*1024*1024,0x78));setInterval(()=>{},1000)'], 30_000, row => row.outputLimit && Buffer.byteLength(row.stdout) === LIMIT && row.exit && row.close && row.terminationConfirmed],
    ['artificial-timeout', process.execPath, ['-e', 'setInterval(()=>{},1000)'], 300, row => row.timedOut && row.exit && row.close && row.terminationConfirmed],
  ];
  const rows = [];
  for (const [id, command, args, budget, validate] of cases) {
    const row = await isolatedRun(command, args, budget);
    row.id = id;
    row.passed = Boolean(validate(row));
    rows.push(row);
    if (!row.terminationConfirmed) break;
  }
  return { rows, passed: rows.length === cases.length && rows.every(row => row.passed), note: 'Artificial timeout is a harmless supervisor test, not an application failure.' };
}

export function validateCli(row, kind) {
  assert.ok(completed(row), 'CLI child did not complete normally');
  assert.equal(row.status, 0);
  assert.equal(row.stderr, '');
  if (kind === 'doctor') {
    const report = JSON.parse(row.stdout);
    assert.ok(Array.isArray(report.checks));
    const byId = id => report.checks.find(check => check.id === id);
    assert.equal(byId('auth_mode')?.detail, 'service_account');
    assert.equal(byId('service_key')?.ok, false);
    assert.equal(byId('service_key')?.detail, 'GSC_KEY_FILE is not set');
    assert.equal(byId('api')?.ok, false);
    assert.match(byId('api')?.detail || '', /AUTH_REQUIRED/);
    assert.equal(byId('properties')?.ok, false);
    assert.match(byId('properties')?.detail || '', /skipped.*API check failed/i);
    assert.equal(byId('tools')?.ok, true);
  } else {
    // config print intentionally includes comment-prefixed guidance before JSON.
    assert.match(row.stdout, /^# Claude Desktop:/m);
    const body = row.stdout.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
    const config = JSON.parse(body);
    assert.ok(config.mcpServers?.['gsc-local']?.command);
    assert.ok(Array.isArray(config.mcpServers['gsc-local'].args));
  }
}

export function validateSuite(row, runtime) {
  assert.ok(completed(row), 'Suite child did not complete normally');
  assert.equal(row.status, 0);
  const text = row.stdout + '\n' + row.stderr;
  // Includes regressions for Windows home isolation and MCP wait cleanup.
  if (runtime === 'node') {
    for (const [key, count] of [['tests', 112], ['pass', 112], ['fail', 0], ['cancelled', 0], ['skipped', 0], ['todo', 0]]) assert.match(text, new RegExp(`^# ${key} ${count}\\s*$`, 'm'));
  } else {
    assert.match(text, /^\s*112 pass\s*$/m);
    assert.match(text, /^\s*0 fail\s*$/m);
    assert.match(text, /Ran 112 tests across 6 files/);
    assert.doesNotMatch(text, /(?:\b[1-9]\d* skip|\(skip\)|\(todo\))/i);
  }
  return { tests: 112, pass: 112, fail: 0, skipped: 0 };
}

export async function verify(outputDir) {
  await mkdir(outputDir, { recursive: true });
  const report = { startedAt: new Date().toISOString(), commit: null, platform: process.platform, arch: process.arch, supervisorNode: process.version, versions: {}, constraints: { cliDeadlineMs: 30_000, suiteAggregateDeadlineMs: 180_000, cleanupMs: CLEANUP_MS, perStreamLimitBytes: LIMIT, nodeEnv: 'test (controlled comparison; not an inherited production environment)', bunCache: 'Fresh separate empty OS-temp cache per invocation; zero files is not an error', windowsBaseline: 'None; no Windows before baseline is inferred', privacy: 'Only report, logs and allowlisted metadata; private HOME/cache contents are never copied' }, rows: [], passed: false, incomplete: false };
  const save = async () => { await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n'); };
  const record = async row => {
    assert.match(row.id, /^[a-z0-9-]+$/);
    await writeFile(join(outputDir, `${row.id}.stdout.log`), row.stdout);
    await writeFile(join(outputDir, `${row.id}.stderr.log`), row.stderr);
    const { stdout, stderr, ...metadata } = row;
    report.rows.push(metadata);
    if (!row.terminationConfirmed) report.incomplete = true;
    await save();
  };
  await save();
  for (const [id, command, args] of [['git-sha', 'git', ['rev-parse', 'HEAD']], ['node-version', process.execPath, ['--version']], ['bun-version', 'bun', ['--version']]]) {
    const row = await isolatedRun(command, args, 30_000);
    row.id = id;
    row.passed = completed(row) && row.status === 0;
    if (id === 'git-sha') { row.passed &&= /^[0-9a-f]{40}\s*$/.test(row.stdout); report.commit = row.passed ? row.stdout.trim() : null; }
    else report.versions[id] = row.stdout.trim();
    await record(row);
    if (report.incomplete) return report;
  }
  for (const [runtime, command] of [['node', process.execPath], ['bun', 'bun']]) {
    for (const kind of ['doctor', 'config']) for (let sample = 1; sample <= 3; sample++) {
      const args = kind === 'doctor' ? ['doctor', '--online'] : ['config', 'print', '--client', 'desktop'];
      const row = await isolatedRun(command, [join(ROOT, 'dist', 'index.js'), ...args], 30_000);
      row.id = `${runtime}-${kind}-${sample}`;
      try { validateCli(row, kind); row.passed = true; } catch (error) { row.passed = false; row.validationError = error.message; }
      await record(row);
      if (report.incomplete) return report;
    }
  }
  // Observed failures never hide the other runtime's suite. Only unknown
  // termination stops the command loop, retaining partial evidence and roots.
  for (const [runtime, command] of [['node', process.execPath], ['bun', 'bun']]) {
    const row = await isolatedRun(command, runtime === 'node' ? ['--test', '--test-reporter=tap', ...TESTS] : ['test', ...TESTS.map(file => `./${file}`)], 180_000);
    row.id = `${runtime}-suite`;
    try { row.summary = validateSuite(row, runtime); row.passed = true; } catch (error) { row.passed = false; row.validationError = error.message; }
    await record(row);
    if (report.incomplete) return report;
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.rows.every(row => row.passed) && report.rows.length === 17;
  await save();
  return report;
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(process.release.name, 'node', 'Run this supervisor with Node, not Bun');
  const mode = args[0];
  assert.ok(['--selfcheck', '--verify'].includes(mode), 'Usage: node scripts/verify-cli-startup.mjs --selfcheck|--verify [artifact-directory]');
  const outputDir = resolve(args[1] || join(ROOT, '.atl', 'windows-cli-startup', mode.slice(2)));
  const privateArea = resolve(ROOT, '.atl', 'cli-startup');
  assert.ok(outputDir !== privateArea && !outputDir.startsWith(privateArea + sep) && outputDir !== resolve(tmpdir()) && !outputDir.startsWith(resolve(tmpdir()) + sep), 'Artifact directory must not contain private roots');
  if (mode === '--selfcheck') {
    const report = await selfcheck();
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'selfcheck.json'), JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.passed ? 0 : 1;
  } else {
    const report = await verify(outputDir);
    process.exitCode = report.passed ? 0 : 1;
  }
}

// Import-safe: importing validation helpers never starts children or writes files.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
