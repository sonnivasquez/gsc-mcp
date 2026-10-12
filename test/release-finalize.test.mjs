import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAME, REPOSITORY, sha256 } from '../scripts/release-candidate.mjs';
import { finalize, main, githubApi, tagCommit } from '../scripts/release-finalize.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'finalize-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Orchestration tests inject candidate verification; these bytes are never executed.
  const tar = Buffer.from('offline immutable tarball');
  const candidate = { name: NAME, repository: REPOSITORY, version: '1.2.3',
    filename: 'sonnivasquez-gsc-mcp-1.2.3.tgz', sourceCommit: SHA, sha256: sha256(tar) };
  fs.writeFileSync(path.join(dir, candidate.filename), tar);
  fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify(candidate));
  const expected = Object.entries({ [candidate.filename]: tar, 'candidate.json': Buffer.from(JSON.stringify(candidate)) })
    .map(([name, bytes]) => ({ name, digest: `sha256:${sha256(bytes)}`, state: 'uploaded' }));
  const state = { release: options.existing ? { id: 123, tag_name: 'v1.2.3', draft: !!options.draft,
    prerelease: false, target_commitish: options.target ?? SHA } : null,
  tag: options.tag ?? (options.existing && !options.draft ? SHA : null),
  assets: options.assets ?? (options.existing ? structuredClone(expected) : []),
  writes: [], calls: [], order: [], notes: null, snapshot: null, latestChecks: 0 };
  const response = (data, status = 200) => ({ status: status === 200 ? 0 : 1,
    stdout: `HTTP/2.0 ${status} Status\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}` });
  const deps = {
    verify: d => { assert.equal(d, dir); state.order.push('verify'); return candidate; },
    registry: async d => {
      assert.equal(d, dir); state.order.push('registry');
      if (options.unpublished) throw new Error('Version unavailable');
    },
    npmCommand: () => ({ command: 'offline-node', args: ['npm-cli.js'] }),
    run: (bin, args) => {
      state.calls.push([bin, args]);
      if (bin === 'offline-node') {
        assert.deepEqual(args, ['npm-cli.js', 'view', NAME, 'dist-tags.latest', '--json', '--registry=https://registry.npmjs.org/']);
        state.order.push('latest');
        state.latestChecks++;
        return { status: 0, stdout: JSON.stringify(
          state.latestChecks > 1 ? options.latestAtPublish ?? options.latest ?? candidate.version : options.latest ?? candidate.version) };
      }
      assert.equal(bin, 'gh');
      if (args[0] === 'api') {
        assert.deepEqual(args.slice(0, 4), ['api', '--hostname', 'github.com', '--include']);
        assert.ok(args[4].startsWith(`repos/${REPOSITORY}/`));
        const endpoint = args[4].slice(`repos/${REPOSITORY}/`.length);
        if (options.apiError === endpoint) return options.apiResponse ?? { status: 1, stdout: '', stderr: 'sensitive failure' };
        if (endpoint === 'git/ref/tags/v1.2.3') {
          state.order.push('tag');
          return state.tag ? response({ ref: 'refs/tags/v1.2.3', object: { type: 'commit', sha: state.tag } }) : response({}, 404);
        }
        if (endpoint === 'releases/tags/v1.2.3') {
          return state.release && !state.release.draft ? response(state.release) : response({}, 404);
        }
        if (endpoint.startsWith('releases?per_page=100&page=')) {
          const page = Number(endpoint.split('page=').at(-1));
          const releases = [...(options.leadingReleases ?? []), ...(state.release ? [state.release] : []),
            ...(options.extraReleases ?? [])];
          return response(releases.slice((page - 1) * 100, page * 100));
        }
        if (endpoint === 'releases/123') return state.release ? response(state.release) : response({}, 404);
        if (endpoint === 'releases/123/assets?per_page=100&page=1') return response(state.assets);
        assert.fail(`Unexpected endpoint ${endpoint}`);
      }
      assert.equal(args[0], 'release');
      assert.deepEqual(args.slice(-2), ['--repo', `github.com/${REPOSITORY}`]);
      assert.ok(!args.includes('--clobber'));
      assert.ok(state.order.includes('registry') && state.order.includes('latest') && state.order.includes('tag'));
      state.writes.push(args);
      const operation = args[1];
      if (operation === 'create') {
        assert.ok(args.includes('--draft'));
        assert.equal(args[args.indexOf('--target') + 1], SHA);
        const notes = args[args.indexOf('--notes-file') + 1];
        assert.ok(!notes.startsWith(ROOT));
        state.notes = fs.readFileSync(notes, 'utf8');
        state.snapshot = path.dirname(notes);
        state.release = { id: 123, tag_name: 'v1.2.3', draft: true, prerelease: false, target_commitish: SHA };
        if (options.interruptCreation) return { status: 1, stdout: '' };
      } else if (operation === 'upload') {
        const file = args[3];
        assert.ok(!file.startsWith(ROOT));
        state.snapshot = path.dirname(file);
        const name = path.basename(file);
        assert.ok(!state.assets.some(asset => asset.name === name));
        state.assets.push({ name, digest: `sha256:${sha256(fs.readFileSync(file))}`, state: 'uploaded' });
        if (options.badUpload) state.assets.at(-1).digest = `sha256:${'0'.repeat(64)}`;
      } else if (operation === 'edit') {
        assert.deepEqual(args.slice(2, -2), ['v1.2.3', '--draft=false', '--latest']);
        assert.deepEqual(state.assets, expected);
        if (!options.staysDraft) state.release.draft = false;
        state.tag = options.finalTag ?? SHA;
      } else assert.fail(`Unexpected write ${operation}`);
      return { status: 0, stdout: '' };
    },
  };
  return { dir, candidate, expected, state, deps };
}

test('creates draft, uploads verified snapshots, publishes, then reruns without edits', async t => {
  const f = fixture(t);
  const result = await main(['finalize', f.dir], f.deps);
  assert.equal(result.draft, false);
  assert.deepEqual(f.state.writes.map(a => a[1]), ['create', 'upload', 'upload', 'edit']);
  assert.equal(f.state.notes, `${NAME} 1.2.3\n\nSource commit: ${SHA}\nTarball SHA-256: ${f.candidate.sha256}\n`);
  assert.equal(fs.existsSync(f.state.snapshot), false);
  f.state.writes.length = 0;
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes, []);
});

test('existing valid public release succeeds without writes', async t => {
  const f = fixture(t, { existing: true });
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes, []);
});

test('valid published release ignores newer npm latest without writes or latest lookup', async t => {
  const f = fixture(t, { existing: true, latest: '1.2.4' });
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.latestChecks, 0);
});

test('latest accepts npm 12 single-element array form and rejects ambiguity', async t => {
  const ok = fixture(t, { latest: ['1.2.3'] });
  await main(['finalize', ok.dir], ok.deps);
  assert.equal(ok.state.writes.map(a => a[1]).at(-1), 'edit');
  for (const bad of [[], ['1.2.3', '1.2.4']]) {
    const f = fixture(t, { latest: bad });
    await assert.rejects(finalize(f.dir, f.deps), /Ambiguous registry latest/);
  }
});

test('interrupted creation resumes pending-tag draft through listing and ID, not tags endpoint', async t => {
  const f = fixture(t, { interruptCreation: true });
  await assert.rejects(finalize(f.dir, f.deps), /External command failed/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.state.tag, null);
  assert.equal(fs.existsSync(f.state.snapshot), false);
  assert.equal(githubApi('releases/tags/v1.2.3', f.deps.run, true), null);
  f.state.calls.length = 0;
  f.state.writes.length = 0;
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes.map(a => a[1]), ['upload', 'upload', 'edit']);
  assert.ok(f.state.calls.some(([, args]) => args[4] === `repos/${REPOSITORY}/releases/123`));
  assert.ok(!f.state.calls.some(([, args]) => args[4] === `repos/${REPOSITORY}/releases/tags/v1.2.3`));
});

test('finds pending-tag draft on a later page and ignores nonmatching tags', async t => {
  const leadingReleases = Array.from({ length: 100 }, (_, i) => ({ id: i + 1000, tag_name: `v0.0.${i}` }));
  const f = fixture(t, { existing: true, draft: true, leadingReleases });
  assert.equal(githubApi('releases/tags/v1.2.3', f.deps.run, true), null);
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes.map(a => a[1]), ['edit']);
  assert.ok(f.state.calls.some(([, args]) => args[4] === `repos/${REPOSITORY}/releases?per_page=100&page=2`));
});

test('rejects matching releases on different pages before writes', async t => {
  const leadingReleases = [{ id: 999, tag_name: 'v1.2.3' },
    ...Array.from({ length: 99 }, (_, i) => ({ id: i + 1000, tag_name: `v0.0.${i}` }))];
  const f = fixture(t, { existing: true, draft: true, leadingReleases });
  await assert.rejects(finalize(f.dir, f.deps), /Ambiguous release tag/);
  assert.deepEqual(f.state.writes, []);
});

test('rechecks latest immediately before publishing draft', async t => {
  const f = fixture(t, { latestAtPublish: '1.2.4' });
  await assert.rejects(finalize(f.dir, f.deps), /Registry latest/);
  assert.equal(f.state.latestChecks, 2);
  assert.deepEqual(f.state.writes.map(a => a[1]), ['create', 'upload', 'upload']);
  assert.equal(f.state.release.draft, true);
});

test('resumes draft uploading only missing assets', async t => {
  const f = fixture(t, { existing: true, draft: true });
  f.state.assets.pop();
  await finalize(f.dir, f.deps);
  assert.deepEqual(f.state.writes.map(a => a[1]), ['upload', 'edit']);
  assert.equal(path.basename(f.state.writes[0][3]), 'candidate.json');
});

for (const [label, options, pattern] of [
  ['wrong tag without release', { tag: OTHER }, /tag source SHA/],
  ['wrong published tag', { existing: true, tag: OTHER }, /tag source SHA/],
  ['draft branch instead of SHA', { existing: true, draft: true, target: 'main' }, /Draft target/],
  ['not published on npm', { unpublished: true }, /unavailable/],
  ['older candidate', { latest: '1.2.4' }, /Registry latest/],
  ['stale existing draft', { existing: true, draft: true, latest: '1.2.4' }, /Registry latest/],
  ['release lookup network error', { apiError: 'releases?per_page=100&page=1' }, /transport failed/],
  ['release ID lookup network error', { existing: true, apiError: 'releases/123' }, /transport failed/],
  ['tag lookup network error', { apiError: 'git/ref/tags/v1.2.3' }, /transport failed/],
  ['release lookup forbidden', { apiError: 'releases?per_page=100&page=1', apiResponse: { status: 1, stdout: 'HTTP/2.0 403 Forbidden\r\n\r\n{}' } }, /request failed/],
  ['release listing 404', { apiError: 'releases?per_page=100&page=1', apiResponse: { status: 1, stdout: 'HTTP/2.0 404 Not Found\r\n\r\n{}' } }, /request failed/],
  ['known release ID 404', { existing: true, apiError: 'releases/123', apiResponse: { status: 1, stdout: 'HTTP/2.0 404 Not Found\r\n\r\n{}' } }, /request failed/],
]) {
  test(`${label} fails before writes`, async t => {
    const f = fixture(t, options);
    await assert.rejects(finalize(f.dir, f.deps), pattern);
    assert.deepEqual(f.state.writes, []);
  });
}

for (const name of ['sonnivasquez-gsc-mcp-1.2.3.tgz', 'candidate.json']) {
  test(`mismatched ${name} cannot be overwritten`, async t => {
    const f = fixture(t, { existing: true, draft: true });
    f.state.assets.find(a => a.name === name).digest = `sha256:${'0'.repeat(64)}`;
    await assert.rejects(finalize(f.dir, f.deps), /digest mismatch/);
    assert.deepEqual(f.state.writes, []);
  });
}

test('missing digest fails closed', async t => {
  const f = fixture(t, { existing: true });
  delete f.state.assets[0].digest;
  await assert.rejects(finalize(f.dir, f.deps), /digest mismatch/);
  assert.deepEqual(f.state.writes, []);
});

test('changed local tarball fails before writes', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.dir, f.candidate.filename), 'changed');
  await assert.rejects(finalize(f.dir, f.deps), /Local candidate changed/);
  assert.deepEqual(f.state.writes, []);
});

test('bad uploaded digest leaves draft unpublished and cleans temporary files', async t => {
  const f = fixture(t, { badUpload: true });
  await assert.rejects(finalize(f.dir, f.deps), /digest mismatch/);
  assert.equal(f.state.release.draft, true);
  assert.ok(!f.state.writes.some(a => a[1] === 'edit'));
  assert.equal(fs.existsSync(f.state.snapshot), false);
});

test('final read must report published release', async t => {
  const f = fixture(t, { staysDraft: true });
  await assert.rejects(finalize(f.dir, f.deps), /not published/);
});

test('final tag is verified after publishing', async t => {
  const f = fixture(t, { finalTag: OTHER });
  await assert.rejects(finalize(f.dir, f.deps), /tag source SHA/);
});

test('peels at most five annotated tags and rejects non-commits', () => {
  for (const depth of [0, 1, 5, 6]) {
    let calls = 0;
    const api = () => {
      const current = calls++;
      return current === 0 ? { ref: 'refs/tags/v1.2.3', object: { type: depth ? 'tag' : 'commit', sha: SHA } } :
        { object: { type: current < depth ? 'tag' : 'commit', sha: SHA } };
    };
    if (depth <= 5) assert.equal(tagCommit('v1.2.3', api), SHA);
    else assert.throws(() => tagCommit('v1.2.3', api), /depth/);
    assert.ok(calls <= 6);
  }
  assert.throws(() => tagCommit('v1.2.3', () => ({ ref: 'refs/tags/v1.2.3', object: { type: 'tree', sha: SHA } })), /commit/);
});

test('only explicit HTTP 404 is absence, never stderr text or JSON status', () => {
  const response = status => ({ status: 1, stdout: `HTTP/2.0 ${status} Error\n\n{"status":404}` });
  assert.equal(githubApi('releases/tags/v1.2.3', () => response(404), true), null);
  for (const status of [401, 403, 429, 500, 503]) {
    assert.throws(() => githubApi('releases/tags/v1.2.3', () => response(status), true));
  }
  assert.throws(() => githubApi('releases/tags/v1.2.3', () => ({ status: 1, stdout: '', stderr: 'HTTP 404' }), true));
  assert.throws(() => githubApi('releases/tags/v1.2.3', () => response(404)));
});

test('strict CLI interface and real verifier reject invalid candidates offline', async t => {
  const f = fixture(t);
  await assert.rejects(main([f.dir], f.deps), /Usage:/);
  await assert.rejects(main(['finalize', f.dir, 'extra'], f.deps), /Usage:/);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/release-finalize.mjs'), 'finalize', f.dir], {
    encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'do-not-print-this-test-value' },
  });
  assert.equal(result.status, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('do-not-print-this-test-value'));
  assert.match(result.stderr, /release-finalize:/);
  assert.deepEqual(f.state.calls, []);
});
