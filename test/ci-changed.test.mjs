import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseNameStatus, describeEvent, main } from '../scripts/ci-changed.mjs';

test('ordinary web files route to web only', () => {
  assert.deepEqual(classify(['web/src/routes/index.tsx']), { mcp_changed: false, web_changed: true });
  assert.deepEqual(classify(['web/vite.config.ts', 'web/wrangler.jsonc']), { mcp_changed: false, web_changed: true });
});

test('mcp files route to mcp only', () => {
  assert.deepEqual(classify(['src/server.ts']), { mcp_changed: true, web_changed: false });
  assert.deepEqual(classify(['test/cli.test.mjs', 'scripts/test-mcp.sh', 'skills/google-search-console-mcp/SKILL.md', 'docs/tools.md', 'fixtures/pagination.json', 'tsconfig.json']), { mcp_changed: true, web_changed: false });
});

test('shared version metadata routes to both', () => {
  for (const file of ['package.json', 'package-lock.json', 'src/version.ts', 'manifest.json', 'CHANGELOG.md', 'web/src/lib/site.ts', 'web/public/install.sh']) {
    assert.deepEqual(classify([file]), { mcp_changed: true, web_changed: true }, file);
  }
});

test('shared design inputs route to both', () => {
  for (const file of ['DESIGN.md', '.impeccable/design.json', 'web/src/styles/tokens.css', 'web/scripts/sync-design-tokens.mjs']) {
    assert.deepEqual(classify([file]), { mcp_changed: true, web_changed: true }, file);
  }
});

test('shared workflow, classifier and site mirror routes to both', () => {
  for (const file of ['.github/workflows/ci.yml', 'scripts/ci-changed.mjs', 'test/ci-changed.test.mjs', 'src/gsc/catalog.ts']) {
    assert.deepEqual(classify([file]), { mcp_changed: true, web_changed: true }, file);
  }
});

test('readme and privacy docs route to mcp only', () => {
  for (const file of ['README.md', 'PRIVACY.md']) {
    assert.deepEqual(classify([file]), { mcp_changed: true, web_changed: false }, file);
  }
});

test('unknown paths are conservative both', () => {
  assert.deepEqual(classify(['newdir/file.txt']), { mcp_changed: true, web_changed: true });
});

test('mixed and empty inputs are conservative', () => {
  assert.deepEqual(classify(['src/server.ts', 'web/src/routes/index.tsx']), { mcp_changed: true, web_changed: true });
  assert.deepEqual(classify([]), { mcp_changed: true, web_changed: true });
});

test('name-status parses renames as old and new, deletions included', () => {
  const raw = 'M\0src/server.ts\0R100\0web/src/old.tsx\0web/src/new.tsx\0D\0docs/old.md\0';
  assert.deepEqual(parseNameStatus(raw), ['src/server.ts', 'web/src/old.tsx', 'web/src/new.tsx', 'docs/old.md']);
});

test('name-status rejects malformed input', () => {
  assert.throws(() => parseNameStatus('M src/server.ts\n'));
  assert.throws(() => parseNameStatus('M\0'));
  assert.throws(() => parseNameStatus('R100\0only-old\0'));
  assert.throws(() => parseNameStatus('??\0file\0'));
});

test('pull request uses event base and head, never GITHUB_SHA', () => {
  const spec = describeEvent('pull_request', { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } });
  assert.equal(spec.kind, 'pull_request');
  assert.equal(spec.base, 'a'.repeat(40));
  assert.equal(spec.head, 'b'.repeat(40));
});

test('push uses exact before and after range', () => {
  const spec = describeEvent('push', { before: 'a'.repeat(40), after: 'b'.repeat(40) });
  assert.equal(spec.kind, 'push');
  assert.equal(spec.before, 'a'.repeat(40));
  assert.equal(spec.after, 'b'.repeat(40));
});

test('first push, missing, zero and unknown events fall back conservative', () => {
  assert.equal(describeEvent('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }).kind, 'conservative');
  assert.equal(describeEvent('push', { after: 'b'.repeat(40) }).kind, 'conservative');
  assert.equal(describeEvent('push', {}).kind, 'conservative');
  assert.equal(describeEvent('schedule', {}).kind, 'conservative');
  assert.equal(describeEvent('pull_request', {}).kind, 'conservative');
});

test('unknown root files route to both, not mcp only', () => {
  assert.deepEqual(classify(['new-shared.config.json']), { mcp_changed: true, web_changed: true });
  assert.deepEqual(classify(['some-unknown-root.json']), { mcp_changed: true, web_changed: true });
  assert.deepEqual(classify(['Dockerfile']), { mcp_changed: true, web_changed: true });
});

test('known root mcp build files route to mcp only', () => {
  for (const file of ['bun.lock', 'tsconfig.json', 'compatibility-manifest.json', '.mcpbignore', 'server.json']) {
    assert.deepEqual(classify([file]), { mcp_changed: true, web_changed: false }, file);
  }
});

test('name-status requires NUL termination for nonempty output', () => {
  assert.throws(() => parseNameStatus('M\0src/server.ts'));
  assert.throws(() => parseNameStatus('M\0src/server.ts\0R100\0a\0b'));
});

test('name-status rejects scores on statuses without scores', () => {
  assert.throws(() => parseNameStatus('A999\0src/server.ts\0'));
  assert.throws(() => parseNameStatus('D050\0docs/old.md\0'));
  assert.throws(() => parseNameStatus('T10\0src/server.ts\0'));
});

test('name-status rejects out-of-range similarity scores', () => {
  assert.throws(() => parseNameStatus('R101\0a\0b\0'));
  assert.throws(() => parseNameStatus('R999\0a\0b\0'));
  assert.throws(() => parseNameStatus('C101\0a\0b\0'));
  assert.throws(() => parseNameStatus('M101\0src/server.ts\0'));
});

test('name-status accepts scored M rewrite output', () => {
  assert.deepEqual(parseNameStatus('M90\0src/server.ts\0'), ['src/server.ts']);
  assert.deepEqual(parseNameStatus('M100\0src/server.ts\0'), ['src/server.ts']);
  assert.deepEqual(parseNameStatus('M\0src/server.ts\0'), ['src/server.ts']);
});

test('name-status preserves renames, deletions and unusual names', () => {
  const raw = 'R100\0old name with spaces\0new name with spaces\0D\0docs/gone.md\0M\0unicode-\u00f1e-\u65e5\u672c\u8a9e.md\0A\0dir/with newline\nfile.txt\0';
  assert.deepEqual(parseNameStatus(raw), [
    'old name with spaces',
    'new name with spaces',
    'docs/gone.md',
    'unicode-\u00f1e-\u65e5\u672c\u8a9e.md',
    'dir/with newline\nfile.txt',
  ]);
});

test('main falls back conservative on truncated and malformed diff', async () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  for (const bad of ['M\0src/server.ts', 'A999\0src/server.ts\0']) {
    let emitted;
    const result = await main([], {
      env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: 'event.json' },
      readEvent: () => ({ pull_request: { base: { sha: base }, head: { sha: head } } }),
      exec: (args) => (args[0] === 'merge-base' ? `${base}\n` : bad),
      emit: (values) => { emitted = values; },
    });
    assert.deepEqual(result, { mcp_changed: true, web_changed: true }, bad);
    assert.deepEqual(emitted, { mcp_changed: true, web_changed: true }, bad);
  }
});
