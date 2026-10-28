import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HistoryStore } from '../dist/audits/history.js';
import { gscChangeImpact } from '../dist/audits/tools.js';
import { GscError } from '../dist/gsc/errors.js';

const site = 'https://example.com/';
const change = { date: '2026-01-01', label: '', description: '', urls: [`${site}a`] };
const deps = root => ({ historyRoot: root, profileAlias: 'test', allowlist: [site], provider: { getAccessToken: async () => 'unused' } });

test('history cancellation prevents pre-aborted record and delete and stops at lock/read boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-cancel-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', site, root); const record = await h.record(change);
    const before = await readdir(h.folder); const controller = new AbortController(); controller.abort();
    for (const input of [{ action: 'record', change }, { action: 'delete', changeId: record.id }, { action: 'list' }]) {
      const r = await gscChangeImpact({ siteUrl: site, ...input }, { ...deps(root), signal: controller.signal });
      assert.equal(r.error.code, 'CANCELLED');
    }
    assert.deepEqual(await readdir(h.folder), before);
    let checks = 0;
    const stopped = new HistoryStore('test', site, root, () => { if (++checks === 8) throw new GscError('CANCELLED', 'test stop'); });
    await assert.rejects(stopped.record({ ...change, label: 'not committed' }), /test stop/);
    assert.deepEqual(await readdir(h.folder), before);
    checks = 0;
    const readStopped = new HistoryStore('test', site, root, () => { if (++checks === 8) throw new GscError('CANCELLED', 'test read stop'); });
    await assert.rejects(readStopped.list(), /test read stop/);
    assert.deepEqual(await readdir(h.folder), before);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});

test('large history is fully recoverable through bounded scoped pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-pages-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', site, root); const c = await h.record({ ...change, idempotencyKey: 'same' });
    assert.equal((await h.record({ ...change, idempotencyKey: 'same' })).id, c.id);
    await assert.rejects(h.record({ ...change, label: 'different', idempotencyKey: 'same' }), /idempotency/);
    const expected = new Map();
    for (let i = 0; i < 4; i++) {
      const file = await h.snapshot(c.id, { i }, { text: String(i).repeat(18 * 1024 * 1024) });
      const bytes = await readFile(file); expected.set(file.split('.snapshot-')[1].slice(0, -5), createHash('sha256').update(bytes).digest('hex'));
    }
    let cursor, firstCursor; const hashes = new Map(); let pages = 0;
    do {
      const p = await h.snapshotPage(c.id, cursor); assert.equal(p.snapshotsTotal, 4);
      const part = p.snapshotChunk; assert.ok(Buffer.from(part.data, 'base64').length <= 24 * 1024);
      const state = hashes.get(part.snapshotId) ?? { hash: createHash('sha256'), offset: 0 };
      assert.equal(part.offset, state.offset); const bytes = Buffer.from(part.data, 'base64'); state.hash.update(bytes); state.offset += bytes.length; hashes.set(part.snapshotId, state);
      cursor = p.nextCursor; firstCursor ??= cursor; pages++;
    } while (cursor);
    assert.ok(pages > 4); assert.equal(hashes.size, 4);
    for (const [id, state] of hashes) assert.equal(state.hash.digest('hex'), expected.get(id));
    const response = await gscChangeImpact({ siteUrl: site, action: 'list', changeId: c.id }, deps(root));
    assert.equal(response.status, 'ok'); assert.ok(Buffer.byteLength(JSON.stringify(response)) < 48 * 1024); assert.equal(response.data.snapshotsTotal, 4);
    const other = new HistoryStore('other', site, root); await other.record(change);
    await assert.rejects(new HistoryStore('other', site, root).snapshotPage(c.id, firstCursor));
    const otherChange = await h.record({ ...change, label: 'other' });
    await assert.rejects(h.snapshotPage(otherChange.id, firstCursor), /cursor/);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});

test('small snapshot compatibility and corrupted history rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-small-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', site, root); const c = await h.record(change);
    const file = await h.snapshot(c.id, {}, { value: 42 });
    const result = await gscChangeImpact({ siteUrl: site, action: 'list', changeId: c.id }, deps(root));
    assert.equal(result.data.snapshots[0].result.value, 42); assert.equal(result.data.snapshotsTotal, 1); assert.equal(result.data.nextCursor, null);
    await writeFile(file, '{broken'); await assert.rejects(h.snapshotPage(c.id), /cannot be read/);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});

test('single large snapshot keeps MCP wrapper bounded and rejects changed or deleted cursor files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-large-one-')); const saved = process.env.GSC_HISTORY; process.env.GSC_HISTORY = '1';
  try {
    const h = new HistoryStore('test', site, root);
    const c = await h.record({ ...change, label: 'ñ'.repeat(200), description: '界'.repeat(2000), urls: Array.from({ length: 100 }, (_, i) => `${site}${i}-${'x'.repeat(200)}`) });
    const file = await h.snapshot(c.id, {}, { text: 'z'.repeat(2 * 1024 * 1024) });
    const response = await gscChangeImpact({ siteUrl: site, action: 'list', changeId: c.id }, deps(root));
    assert.equal(response.status, 'ok'); assert.equal(response.data.snapshotsTotal, 1);
    assert.deepEqual(response.data.change, { id: c.id }); assert.match(response.data.changeDetails, /gsc_get_dataset/);
    const wrapper = { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    assert.ok(Buffer.byteLength(JSON.stringify(wrapper, null, 2)) <= 48 * 1024);
    const cursor = response.data.nextCursor; assert.ok(cursor);
    await writeFile(file, '{"schemaVersion":1}');
    const changed = await gscChangeImpact({ siteUrl: site, action: 'list', changeId: c.id, cursor }, deps(root));
    assert.equal(changed.error.code, 'INVALID_ARGUMENT'); assert.match(changed.error.message, /changed snapshot/);
    await rm(file);
    const deleted = await gscChangeImpact({ siteUrl: site, action: 'list', changeId: c.id, cursor }, deps(root));
    assert.equal(deleted.error.code, 'INVALID_ARGUMENT'); assert.match(deleted.error.message, /missing or changed snapshot/);
  } finally { if (saved === undefined) delete process.env.GSC_HISTORY; else process.env.GSC_HISTORY = saved; await rm(root, { recursive: true, force: true }); }
});
