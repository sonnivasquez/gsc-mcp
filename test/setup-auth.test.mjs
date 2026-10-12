import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideAuth, validateCredentialFile } from '../dist/setup/auth.js';
import { buildEnv } from '../dist/setup.js';
import { embeddedClientAvailable } from '../dist/embedded-client.js';

const prompt = { choose: async (_q, _choices, fallback) => fallback, text: async () => 'n', close() {} };

test('embedded Desktop client availability is a boolean', () => {
  assert.equal(typeof embeddedClientAvailable(), 'boolean');
  assert.equal(embeddedClientAvailable(), true);
});

test('persisted setup environment respects independent scope and write gates', () => {
  const base = { site: 'sc-domain:example.com', secretsPath: null, keyFile: null };
  const shared = buildEnv({ ...base, mode: 'shared', scopes: 'readonly', write: false });
  assert.equal(shared.GSC_AUTH_MODE, 'oauth');
  assert.equal(shared.GSC_SCOPES, 'readonly');
  assert.equal(Object.hasOwn(shared, 'GSC_ENABLE_WRITE'), false);
  const custom = buildEnv({ ...base, mode: 'custom', scopes: 'full', write: false });
  assert.equal(custom.GSC_SCOPES, 'full');
  assert.equal(Object.hasOwn(custom, 'GSC_ENABLE_WRITE'), false);
  const enabled = buildEnv({ ...base, mode: 'service-account', scopes: 'full', write: true });
  assert.equal(enabled.GSC_AUTH_MODE, 'service_account');
  assert.equal(enabled.GSC_ENABLE_WRITE, '1');
  assert.throws(() => buildEnv({ ...base, mode: 'shared', scopes: 'full', write: false }), /readonly-only/);
  assert.throws(() => buildEnv({ ...base, mode: 'shared', scopes: 'readonly', write: true }), /readonly-only/);
});

test('Quick Connect rejects full access and write opt-in', async () => {
  await assert.rejects(decideAuth(prompt, 'shared', 'full', false), /readonly-only/);
  await assert.rejects(decideAuth(prompt, 'shared', 'readonly', true), /readonly-only/);
  assert.deepEqual(await decideAuth(prompt, 'shared', null, false), { mode: 'shared', scope: 'readonly', write: false });
});

test('full scope alone does not enable writes', async () => {
  assert.deepEqual(await decideAuth(prompt, 'custom', 'full', false), { mode: 'custom', scope: 'full', write: false });
  assert.deepEqual(await decideAuth(prompt, 'service-account', 'full', true), { mode: 'service-account', scope: 'full', write: true });
  await assert.rejects(decideAuth(prompt, 'custom', 'readonly', true), /requires --scopes full/);
});

test('step 1 copy is a numbered list with a short Choose prompt (EN/ES)', async () => {
  const { translateSetup } = await import('../dist/setup/i18n.js');
  assert.equal(translateSetup('en', 'authTitle'), 'Authentication?');
  assert.equal(translateSetup('en', 'authOptionShared'), 'Quick Connect (recommended, read-only, no indexing)');
  assert.equal(translateSetup('en', 'authOptionCustom'), 'Custom OAuth (full access, indexing)');
  assert.equal(translateSetup('en', 'authOptionService'), 'Service Account (full access, indexing)');
  assert.equal(translateSetup('en', 'accessTitle'), 'Access level?');
  assert.equal(translateSetup('en', 'accessOptionReadonly'), 'Read only (data only)');
  assert.equal(translateSetup('en', 'accessOptionFullExplained'), 'Full (data + indexing, includes Google writes)');
  assert.equal(translateSetup('en', 'accessOptionFull'), 'Full (data + indexing)');
  assert.equal(translateSetup('en', 'choosePrompt'), 'Choose [1]: ');
  assert.equal(translateSetup('es', 'authTitle'), 'Autenticación?');
  assert.equal(translateSetup('es', 'authOptionShared'), 'Quick Connect (recomendado, solo lectura, sin indexación)');
  assert.equal(translateSetup('es', 'accessTitle'), 'Nivel de acceso?');
  assert.equal(translateSetup('es', 'accessOptionReadonly'), 'Solo lectura (solo datos)');
  assert.equal(translateSetup('es', 'accessOptionFullExplained'), 'Completo (datos + indexación, incluye escrituras de Google)');
  assert.equal(translateSetup('es', 'accessOptionFull'), 'Completo (datos + indexación)');
  assert.equal(translateSetup('es', 'choosePrompt'), 'Elige [1]: ');
});

test('interactive step 1 prints numbered lists like steps 2/3 with numeric parsing', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => void lines.push(args.join(' '));
  try {
    const answers = ['2', '2', 'n'];
    const interactive = {
      interactive: true,
      choose: async (_q, _choices, fallback) => fallback,
      text: async (q) => {
        if (q === 'Choose [1]: ') return answers.shift() ?? '';
        return 'n';
      },
      close() {},
    };
    assert.deepEqual(await decideAuth(interactive, null, null, false), { mode: 'custom', scope: 'full', write: false });
  } finally {
    console.log = originalLog;
  }
  assert.ok(lines.some((l) => l.includes('Authentication?')), `auth title: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('[1] Quick Connect (recommended, read-only, no indexing)')), `auth list: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('[2] Custom OAuth')), `auth list: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('[3] Service Account')), `auth list: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('Access level?')), `access title: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('[1] Read only (data only)')), `access list: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes('[2] Full')), `access list: ${JSON.stringify(lines)}`);
});

test('interactive step 1 defaults on Enter and rejects bad tokens without echo', async () => {
  const silent = [];
  const originalLog = console.log;
  console.log = (...args) => void silent.push(args.join(' '));
  try {
    const enter = { interactive: true, choose: async (_q, _c, fallback) => fallback, text: async () => '', close() {} };
    assert.deepEqual(await decideAuth(enter, null, null, false), { mode: 'shared', scope: 'readonly', write: false });
    const bad = { interactive: true, choose: async (_q, _c, fallback) => fallback, text: async () => 'zzz-secret-token', close() {} };
    await assert.rejects(decideAuth(bad, null, null, false), (err) => {
      assert.equal(err.message, 'Invalid setup choice');
      assert.ok(!err.message.includes('zzz-secret-token'), 'rejected input is never echoed');
      return true;
    });
    const outOfRange = { interactive: true, choose: async (_q, _c, fallback) => fallback, text: async () => '9', close() {} };
    await assert.rejects(decideAuth(outOfRange, null, null, false), /Invalid setup choice/);
  } finally {
    console.log = originalLog;
  }
});

test('non-interactive step 1 stays quiet with shared/readonly defaults', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => void lines.push(args.join(' '));
  try {
    const quiet = { choose: async (_q, _choices, fallback) => fallback, text: async () => 'n', close() {} };
    assert.deepEqual(await decideAuth(quiet, null, null, false), { mode: 'shared', scope: 'readonly', write: false });
  } finally {
    console.log = originalLog;
  }
  assert.equal(lines.length, 0, `quiet step 1 prints no lists: ${JSON.stringify(lines)}`);
});
test('credential shape validation rejects web clients and malformed service accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gsc-shape-'));
  const file = join(dir, 'credential.json');
  writeFileSync(file, JSON.stringify({ web: { client_id: 'example', client_secret: 'example' } }));
  assert.throws(() => validateCredentialFile(file, 'custom'), /Desktop installed/);
  writeFileSync(file, JSON.stringify({ type: 'service_account', client_email: 'example' }));
  assert.throws(() => validateCredentialFile(file, 'service-account'), /Service Account requires/);
  writeFileSync(file, JSON.stringify({ installed: { client_id: 'example', client_secret: 'example', redirect_uris: ['http://127.0.0.1'] } }));
  assert.doesNotThrow(() => validateCredentialFile(file, 'custom'));
});
