import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  SETUP_SERVER_NAME,
  buildSetupEntry,
  buildSetupPrintJson,
  packageEntrypointPath,
  desktopConfigPath,
  cursorConfigPath,
  resolveFileConfigPath,
  mergeGscEntry,
  previewEntryChange,
  redactEntryForPreview,
  REDACTED_VALUE,
  tempPathFor,
  backupPathFor,
  applyFileConfig,
  buildClaudeCodeArgs,
  claudeCodeRemoveArgs,
  buildCodexArgs,
  formatPreviewCommand,
  applyCliConfig,
  printClientConfig,
} from '../dist/client-config.js';
import {
  parseClientFlags,
  validateClientTargets,
  parseClientSelectionAnswer,
} from '../dist/setup/clients.js';

const ENV = {
  GSC_AUTH_MODE: 'oauth',
  GSC_SCOPES: 'readonly',
  GSC_SITE_URLS: 'sc-domain:a.example,https://b.example/',
};

test('setup entry launches the installed package through the current absolute runtime', () => {
  const entry = buildSetupEntry(ENV);
  assert.equal(entry.command, process.execPath);
  assert.ok(isAbsolute(entry.args[0]));
  assert.equal(entry.args[0], packageEntrypointPath());
  assert.deepEqual(entry.args.slice(1), ['serve']);
  assert.ok(!entry.command.includes('npx') && !entry.command.includes('bunx'));
  assert.deepEqual(entry.env, ENV);
  const printed = JSON.parse(buildSetupPrintJson(entry));
  assert.equal(printed.mcpServers[SETUP_SERVER_NAME].command, process.execPath);
  assert.equal(printed.mcpServers[SETUP_SERVER_NAME].args[0], packageEntrypointPath());
});

test('file paths stay under an injected home and never touch real config', () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-home-'));
  const desktop = desktopConfigPath(home);
  const cursor = cursorConfigPath(home);
  assert.ok(desktop.startsWith(home), desktop);
  assert.ok(cursor.startsWith(home), cursor);
  assert.equal(resolveFileConfigPath('desktop', home), desktop);
  assert.equal(resolveFileConfigPath('cursor', home), cursor);
  assert.ok(!existsSync(desktop));
  assert.ok(!existsSync(cursor));
});

test('Windows default Desktop path respects APPDATA while explicit home stays isolated', { skip: process.platform !== 'win32' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-explicit-home-'));
  const appData = mkdtempSync(join(tmpdir(), 'gsc-default-appdata-'));
  const previous = process.env.APPDATA;
  process.env.APPDATA = appData;
  try {
    const defaultPath = join(appData, 'Claude', 'claude_desktop_config.json');
    const explicitPath = join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    assert.equal(desktopConfigPath(), defaultPath);
    assert.equal(resolveFileConfigPath('desktop'), defaultPath);
    assert.equal(desktopConfigPath(home), explicitPath);
    assert.equal(resolveFileConfigPath('desktop', home), explicitPath);
  } finally {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
  }
});

test('narrow merge preserves unrelated servers and top-level keys', () => {
  const existing = {
    otherTopLevel: true,
    mcpServers: {
      other: { command: 'other', args: [], env: {} },
      [SETUP_SERVER_NAME]: { command: 'old', args: [], env: {} },
    },
  };
  const next = mergeGscEntry(existing, SETUP_SERVER_NAME, buildSetupEntry(ENV));
  assert.equal(next.otherTopLevel, true);
  assert.deepEqual(next.mcpServers.other, existing.mcpServers.other);
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].command, process.execPath);
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].args[0], packageEntrypointPath());
  assert.throws(() => mergeGscEntry([1, 2], SETUP_SERVER_NAME, buildSetupEntry(ENV)), /not a JSON object/);
  assert.match(previewEntryChange(existing.mcpServers[SETUP_SERVER_NAME], buildSetupEntry(ENV)), /new gsc entry/);
  assert.match(backupPathFor('/tmp/mcp.json', new Date('2026-01-02T03:04:05.000Z')), /\.backup-2026-01-02T03-04-05-000Z/);
});

test('file apply previews without writing on dry-run', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-dry-'));
  const configPath = join(home, '.cursor', 'mcp.json');
  const logs = [];
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: false, dryRun: true,
    confirm: async () => { throw new Error('must not confirm on dry-run'); },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, true);
  assert.ok(!existsSync(configPath));
  assert.ok(logs.join('\n').includes('No file written'));
});

test('file apply confirms, backs up, and merges only gsc', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-file-'));
  const configPath = join(home, 'claude_desktop_config.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: 'keep' }, [SETUP_SERVER_NAME]: { command: 'old' } }, top: 1 }, null, 2));
  const logs = [];
  let confirmed = false;
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: false, dryRun: false,
    confirm: async (q) => { confirmed = true; assert.match(q, /Overwrite only/); return 'y'; },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, true);
  assert.equal(confirmed, true);
  const backups = readdirSync(home).filter((f) => f.includes('.backup-'));
  assert.equal(backups.length, 1);
  const next = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(next.top, 1);
  assert.deepEqual(next.mcpServers.other, { command: 'keep' });
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].command, process.execPath);
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].args[0], packageEntrypointPath());
});

test('file apply respects declines and skips confirmation on yes/force', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-decline-'));
  const configPath = join(home, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({ mcpServers: { [SETUP_SERVER_NAME]: { command: 'old' } } }));
  const declined = await applyFileConfig({
    configPath, entry: buildSetupEntry(ENV), force: false, yes: false, dryRun: false,
    confirm: async () => 'n', log: () => {},
  });
  assert.equal(declined, false);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).mcpServers[SETUP_SERVER_NAME].command, 'old');

  const forced = await applyFileConfig({
    configPath, entry: buildSetupEntry(ENV), force: true, yes: false, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); }, log: () => {},
  });
  assert.equal(forced, true);
  const written = JSON.parse(readFileSync(configPath, 'utf8')).mcpServers[SETUP_SERVER_NAME];
  assert.equal(written.command, process.execPath);
  assert.equal(written.args[0], packageEntrypointPath());
});

test('file apply fails closed on invalid JSON without writing a backup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-bad-'));
  const configPath = join(home, 'mcp.json');
  writeFileSync(configPath, '{not json');
  const logs = [];
  const ok = await applyFileConfig({
    configPath, entry: buildSetupEntry(ENV), force: true, yes: true, dryRun: false,
    confirm: async () => 'y', log: (m) => logs.push(m),
  });
  assert.equal(ok, false);
  assert.ok(logs.join('\n').includes('invalid JSON'));
  assert.equal(readdirSync(home).filter((f) => f.includes('.backup-')).length, 0);
});

test('CLI vectors are exact argv without shell and preview quoting', () => {
  const expectedTail = ['--', process.execPath, packageEntrypointPath(), 'serve'];
  const codeArgs = buildClaudeCodeArgs(ENV);
  assert.deepEqual(codeArgs.slice(0, 4), ['mcp', 'add', '--scope', 'user']);
  assert.ok(codeArgs.includes('gsc'));
  assert.deepEqual(codeArgs.slice(-4), expectedTail);
  const codexArgs = buildCodexArgs(ENV);
  assert.deepEqual(codexArgs.slice(0, 3), ['mcp', 'add', 'gsc']);
  assert.ok(codexArgs.includes('--env'));
  assert.deepEqual(codexArgs.slice(-4), expectedTail);
  assert.match(formatPreviewCommand('claude', ['mcp', 'add', '-e', 'A=B C']), /"B C"|B C/);
  assert.deepEqual(buildClaudeCodeArgs(ENV).slice(-4), expectedTail);
  assert.deepEqual(buildCodexArgs(ENV).slice(-4), expectedTail);
});

test('automatic setup outputs launch the package installed beside this CLI', () => {
  const entry = buildSetupEntry(ENV);
  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args[0], packageEntrypointPath());
  const codeArgs = buildClaudeCodeArgs(ENV);
  const codexArgs = buildCodexArgs(ENV);
  for (const args of [codeArgs, codexArgs]) {
    assert.equal(args.at(-3), process.execPath);
    assert.equal(args.at(-2), packageEntrypointPath());
    assert.equal(args.at(-1), 'serve');
  }
  const serialized = [
    JSON.stringify(entry),
    buildSetupPrintJson(entry),
    formatPreviewCommand('claude', codeArgs),
    formatPreviewCommand('codex', codexArgs),
  ].join('\n');
  assert.ok(serialized.includes(packageEntrypointPath()));
  assert.ok(!serialized.includes('npx') && !serialized.includes('bunx'));
});

test('CLI apply dry-run never invokes the runner', async () => {
  let calls = 0;
  const ok = await applyCliConfig({
    program: 'claude', args: buildClaudeCodeArgs(ENV),
    force: false, yes: false, dryRun: true,
    confirm: async () => { throw new Error('must not confirm on dry-run'); },
    log: () => {}, runner: () => { calls++; return { status: 0 }; },
  });
  assert.equal(ok, true);
  assert.equal(calls, 0);
});

test('CLI apply requires confirmation unless yes/force and handles runners', async () => {
  const logs = [];
  const declined = await applyCliConfig({
    program: 'codex', args: buildCodexArgs(ENV),
    force: false, yes: false, dryRun: false,
    confirm: async () => 'n', log: (m) => logs.push(m),
    runner: () => { throw new Error('must not invoke after decline'); },
  });
  assert.equal(declined, false);

  let invoked = [];
  const approved = await applyCliConfig({
    program: 'codex', args: buildCodexArgs(ENV),
    force: false, yes: false, dryRun: false,
    confirm: async () => 'y', log: () => {},
    runner: (program, args) => { invoked.push([program, args]); return { status: 0 }; },
  });
  assert.equal(approved, true);
  assert.deepEqual(invoked[0][0], 'codex');
  assert.ok(Array.isArray(invoked[0][1]));

  const missing = await applyCliConfig({
    program: 'claude', args: buildClaudeCodeArgs(ENV),
    force: true, yes: true, dryRun: false, confirm: async () => 'y', log: () => {},
    runner: () => ({ status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }),
  });
  assert.equal(missing, false);

  const failed = await applyCliConfig({
    program: 'claude', args: buildClaudeCodeArgs(ENV),
    force: false, yes: true, dryRun: false, confirm: async () => 'y', log: () => {},
    runner: () => ({ status: 1 }),
  });
  assert.equal(failed, false);
});

test('client flag parsing supports both, multiples, and print exclusivity', () => {
  assert.deepEqual(parseClientFlags(['both']), ['desktop', 'code']);
  assert.deepEqual(parseClientFlags(['desktop', 'cursor,codex']), ['desktop', 'cursor', 'codex']);
  assert.deepEqual(parseClientFlags(['desktop', 'desktop']), ['desktop']);
  assert.deepEqual(validateClientTargets(['desktop', 'cursor']), ['desktop', 'cursor']);
  assert.throws(() => validateClientTargets(['print', 'desktop']), /alone/);
  assert.throws(() => validateClientTargets(['nope']), /Invalid --client/);
  assert.deepEqual(parseClientSelectionAnswer('', ['desktop', 'code', 'cursor', 'codex', 'print'], 0), ['desktop']);
  assert.deepEqual(parseClientSelectionAnswer('all', ['desktop', 'code', 'cursor', 'codex', 'print'], 0), ['desktop', 'code', 'cursor', 'codex']);
  assert.deepEqual(parseClientSelectionAnswer('1,3', ['desktop', 'code', 'cursor', 'codex', 'print'], 0), ['desktop', 'cursor']);
  assert.throws(() => parseClientSelectionAnswer('9', ['desktop', 'code'], 0), /choose 1-2/);
});

test('file apply on a missing file confirms first; decline writes nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-new-'));
  const configPath = join(home, '.cursor', 'mcp.json');
  const logs = [];
  let question = '';
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: false, dryRun: false,
    confirm: async (q) => { question = q; return 'n'; },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, false);
  assert.match(question, /Write a new/);
  assert.ok(!existsSync(configPath));
  assert.equal(readdirSync(home).filter((f) => f.includes('.backup-')).length, 0);
  assert.ok(logs.join('\n').includes('Nothing was changed'));
});

test('file apply on a missing file with approval writes only gsc and no backup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-new-ok-'));
  const configPath = join(home, '.cursor', 'mcp.json');
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: false, dryRun: false,
    confirm: async () => 'y',
    log: () => {},
  });
  assert.equal(ok, true);
  const next = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].command, process.execPath);
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].args[0], packageEntrypointPath());
  assert.equal(readdirSync(home).filter((f) => f.includes('.backup-')).length, 0);
});

test('file apply without a gsc entry confirms; decline leaves bytes identical', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-nogsc-'));
  const configPath = join(home, 'mcp.json');
  const original = JSON.stringify({ mcpServers: { other: { command: 'keep' } } }, null, 2);
  writeFileSync(configPath, original);
  const declined = await applyFileConfig({
    configPath, entry: buildSetupEntry(ENV), force: false, yes: false, dryRun: false,
    confirm: async () => 'n', log: () => {},
  });
  assert.equal(declined, false);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.equal(readdirSync(home).filter((f) => f.includes('.backup-')).length, 0);

  const applied = await applyFileConfig({
    configPath, entry: buildSetupEntry(ENV), force: false, yes: true, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on yes'); }, log: () => {},
  });
  assert.equal(applied, true);
  const next = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(next.mcpServers.other, { command: 'keep' });
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].command, process.execPath);
  assert.equal(next.mcpServers[SETUP_SERVER_NAME].args[0], packageEntrypointPath());
});

test('CLI force never removes: failed add invokes only add and fails closed', async () => {
  const addArgs = buildClaudeCodeArgs(ENV);
  const removeArgs = claudeCodeRemoveArgs();
  const calls = [];
  const logs = [];
  const ok = await applyCliConfig({
    program: 'claude', args: addArgs, removeArgs,
    force: true, yes: false, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); },
    log: (m) => logs.push(m),
    runner: (program, args) => { calls.push([program, [...args]]); return { status: 1 }; },
  });
  assert.equal(ok, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['claude', addArgs]);
  const text = logs.join('\n');
  assert.match(text, /Nothing was removed automatically/);
  assert.ok(text.includes(formatPreviewCommand('claude', removeArgs)));
  assert.ok(text.includes(formatPreviewCommand('claude', addArgs)));
});

test('CLI force success invokes add exactly once without a remove', async () => {
  const addArgs = buildCodexArgs(ENV);
  const calls = [];
  const ok = await applyCliConfig({
    program: 'codex', args: addArgs, removeArgs: ['mcp', 'remove', 'gsc'],
    force: true, yes: false, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); },
    log: () => {},
    runner: (program, args) => { calls.push([program, [...args]]); return { status: 0 }; },
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['codex', addArgs]);
});

test('preview never displays secret-bearing values from existing config', async () => {
  const unrelatedSecret = 'SENTINEL_UNRELATED_9f8e7d6c5b4a';
  const oldGscSecret = 'SENTINEL_OLDGSC_1a2b3c4d5e6f';
  const home = mkdtempSync(join(tmpdir(), 'gsc-redact-'));
  const configPath = join(home, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      other: { command: 'other', args: [], env: { OTHER_TOKEN: unrelatedSecret } },
      [SETUP_SERVER_NAME]: { command: 'old', args: [], env: { GSC_OAUTH_CLIENT_SECRET: oldGscSecret } },
    },
  }));
  const logs = [];
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: false, dryRun: true,
    confirm: async () => { throw new Error('must not confirm on dry-run'); },
    log: (m) => logs.push(m),
  });
  assert.equal(ok, true);
  const text = logs.join('\n');
  assert.ok(!text.includes(unrelatedSecret), 'unrelated server secret leaked into preview');
  assert.ok(!text.includes(oldGscSecret), 'existing gsc secret leaked into preview');
  assert.ok(text.includes(REDACTED_VALUE));
  assert.ok(text.includes('GSC_OAUTH_CLIENT_SECRET'), 'redacted preview keeps key names');
  assert.ok(text.includes(`"command": ${JSON.stringify(process.execPath)}`), 'new entry still shown in full');
  const direct = previewEntryChange({ env: { K: oldGscSecret } }, buildSetupEntry(ENV));
  assert.ok(!direct.includes(oldGscSecret));
  assert.equal(redactEntryForPreview('raw-string'), '(unreadable entry)');

  // Verifier hardening: sentinels in every existing-value position stay out.
  const cmdSentinel = 'SENTINEL_CMD_aa11bb22';
  const argSentinel = 'SENTINEL_ARG_cc33dd44';
  const nestedSentinel = 'SENTINEL_NESTED_ee55ff66';
  const customSentinel = 'SENTINEL_CUSTOM_77889900';
  const shaped = redactEntryForPreview({
    command: cmdSentinel,
    args: ['-y', argSentinel],
    env: { PLAIN: oldGscSecret, NESTED: { deep: nestedSentinel } },
    customField: customSentinel,
  });
  const shapedText = JSON.stringify(shaped);
  for (const s of [cmdSentinel, argSentinel, nestedSentinel, customSentinel, oldGscSecret]) {
    assert.ok(!shapedText.includes(s), `existing value leaked: ${s}`);
  }
  assert.ok(shapedText.includes('command') && shapedText.includes('customField'));
  const shapedPreview = previewEntryChange(
    { command: cmdSentinel, args: [argSentinel], customField: customSentinel },
    buildSetupEntry(ENV)
  );
  for (const s of [cmdSentinel, argSentinel, customSentinel]) {
    assert.ok(!shapedPreview.includes(s), `preview leaked: ${s}`);
  }
  assert.ok(!existsSync(configPath + '.backup-anything'));
});

test('atomic replace preserves destination bytes when staging fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-stagefail-'));
  const configPath = join(home, 'mcp.json');
  const original = JSON.stringify({ mcpServers: { other: { command: 'keep' } } }, null, 2);
  writeFileSync(configPath, original);
  const logs = [];
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: true, yes: true, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); },
    log: (m) => logs.push(m),
    hooks: { stageTemp: () => { throw new Error('disk full'); } },
  });
  assert.equal(ok, false);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  const backups = readdirSync(home).filter((f) => f.includes('.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(home, backups[0]), 'utf8'), original);
  assert.equal(readdirSync(home).filter((f) => f.includes('.tmp-')).length, 0);
  const text = logs.join('\n');
  assert.ok(!text.includes('Nothing was changed'));
  assert.match(text, /left untouched/);
});

test('failed rename keeps backup, cleans temp, and never claims nothing changed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-renamefail-'));
  const configPath = join(home, 'mcp.json');
  const original = JSON.stringify({ mcpServers: { [SETUP_SERVER_NAME]: { command: 'old' } } });
  writeFileSync(configPath, original);
  const logs = [];
  let staged = 0;
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: true, yes: true, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); },
    log: (m) => logs.push(m),
    hooks: {
      stageTemp: (tmp, content) => { staged++; writeFileSync(tmp, content, 'utf8'); },
      commitTemp: () => { throw new Error('rename blocked'); },
    },
  });
  assert.equal(ok, false);
  assert.equal(staged, 1);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  const backups = readdirSync(home).filter((f) => f.includes('.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(home, backups[0]), 'utf8'), original);
  assert.equal(readdirSync(home).filter((f) => f.includes('.tmp-')).length, 0);
  const text = logs.join('\n');
  assert.ok(!text.includes('Nothing was changed'));
  assert.match(text, /verify the config file/);
});

test('staging failure on a missing file writes no config and no backup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-newfail-'));
  const configPath = join(home, '.cursor', 'mcp.json');
  const logs = [];
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: true, yes: true, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on force'); },
    log: (m) => logs.push(m),
    hooks: { stageTemp: () => { throw new Error('EACCES'); } },
  });
  assert.equal(ok, false);
  assert.ok(!existsSync(configPath));
  assert.match(logs.join('\n'), /No config file was written/);
});

test('successful replace stages with safe permissions and leaves no temp files', async () => {
  const home = mkdtempSync(join(tmpdir(), 'gsc-mode-'));
  const configPath = join(home, '.cursor', 'mcp.json');
  assert.ok(tempPathFor(configPath).startsWith(home));
  const ok = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(ENV),
    force: false, yes: true, dryRun: false,
    confirm: async () => { throw new Error('must not confirm on yes'); },
    log: () => {},
  });
  assert.equal(ok, true);
  const written = JSON.parse(readFileSync(configPath, 'utf8')).mcpServers[SETUP_SERVER_NAME];
  assert.equal(written.command, process.execPath);
  assert.equal(written.args[0], packageEntrypointPath());
  assert.equal(readdirSync(join(home, '.cursor')).filter((f) => f.includes('.tmp-')).length, 0);
  if (process.platform !== 'win32') {
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
  }
});

test('dev print snippet covers codex without secrets', () => {
  const out = printClientConfig('codex', { command: '/abs/node', entrypoint: '/abs/dist/index.js', profile: 'work' });
  assert.match(out, /codex mcp add/);
  assert.match(out, /\/abs\/dist\/index\.js/);
  assert.ok(!out.includes('refresh_token'));
  mkdirSync(join(tmpdir(), 'gsc-unused'), { recursive: true });
});

test('manual CLI snippets quote installed runtime and entry point paths with spaces', () => {
  const command = join(tmpdir(), 'Program Files', 'node');
  const entrypoint = join(tmpdir(), 'Application Support', 'gsc-mcp', 'dist', 'index.js');
  for (const client of ['code', 'codex']) {
    const out = printClientConfig(client, { command, entrypoint });
    const expected = formatPreviewCommand(command, [entrypoint, 'serve']);
    assert.ok(out.includes(`-- ${expected}`), `${client} snippet preserves path argument boundaries`);
  }
});
