import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, numericId, stableVersion, validateSource, validateUnpublished,
  validateLatestPush, validateOrigin, validateBinding, validateWorkflow, validateStageJobs, validateAncestry, writeOutputs, REPOSITORY, WORKFLOWS } from '../scripts/release-github.mjs';

const sha = 'a'.repeat(40);
const repo = { full_name: REPOSITORY };
const pkg = { name: '@sonnivasquez/gsc-mcp', version: '1.2.3' };
const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha };
const run = (changes = {}) => ({ id: 100, run_attempt: 2, workflow_id: 10, repository: repo, head_repository: repo,
  head_branch: 'main', head_sha: sha, path: '.github/workflows/release-stage.yml',
  event: 'workflow_dispatch', status: 'completed', conclusion: 'success', ...changes });
const push = (changes = {}) => run({ path: WORKFLOWS[0], event: 'push', ...changes });
const candidate = { repository: REPOSITORY, runId: '100', runAttempt: '2', sourceCommit: sha,
  version: '1.2.3', filename: 'sonnivasquez-gsc-mcp-1.2.3.tgz', sha256: 'b'.repeat(64) };

test('stable versions and numeric identifiers reject unsafe values', () => {
  assert.equal(stableVersion('1.2.3'), '1.2.3');
  for (const value of ['v1.2.3', '01.2.3', '1.2.3-beta', '1.2.3+build', '1.2.3\n', '9007199254740992.0.0', null]) {
    assert.throws(() => stableVersion(value));
  }
  assert.equal(numericId('123'), '123');
  for (const value of ['0', '01', '-1', '1/attempts/2', '1\nx=y', 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => numericId(value));
  }
});
test('preflight validates repository, main, HEAD, package and clean checkout', () => {
  assert.deepEqual(validateSource('1.2.3', pkg, env, sha, ''), { version: '1.2.3', 'source-sha': sha });
  for (const changes of [{ GITHUB_REPOSITORY: 'evil/gsc-mcp' }, { GITHUB_REF: 'refs/heads/topic' },
    { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_SHA: undefined }]) {
    assert.throws(() => validateSource('1.2.3', pkg, { ...env, ...changes }, sha, ''));
  }
  assert.throws(() => validateSource('1.2.4', pkg, env, sha, ''));
  assert.throws(() => validateSource('1.2.3', { ...pkg, name: 'other' }, env, sha, ''));
  for (const status of [' M package.json', '?? candidate.json']) {
    assert.throws(() => validateSource('1.2.3', pkg, env, sha, status), /clean/);
  }
});
test('registry rejects published versions and malformed responses', () => {
  assert.equal(validateUnpublished('1.2.3', ['1.2.2']), '1.2.3');
  assert.equal(validateUnpublished('1.2.3', '1.2.2'), '1.2.3');
  for (const versions of [['1.2.3'], '1.2.3', [], null, {}, [123], ['']]) {
    assert.throws(() => validateUnpublished('1.2.3', versions));
  }
});
test('origin requires exact provenance, successful dispatch and valid attempt', () => {
  assert.deepEqual(validateOrigin(run(), '100'), { 'run-id': '100', 'run-attempt': '2',
    'source-sha': sha, 'artifact-name': 'release-candidate-100-2' });
  for (const change of [{ repository: { full_name: 'evil/gsc-mcp' } }, { head_repository: null },
    { head_repository: { full_name: 'evil/gsc-mcp' } }, { head_branch: 'topic' }, { event: 'push' },
    { event: 'pull_request' }, { path: WORKFLOWS[0] }, { id: 101 }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { run_attempt: 0 }, { run_attempt: '2\nx=y' }, { head_sha: 'bad' }]) {
    assert.throws(() => validateOrigin(run(change), '100'));
  }
});
test('latest push cannot fall back to an older success, including reruns', () => {
  assert.equal(validateLatestPush([push({ id: 99, conclusion: 'failure' }), push()], WORKFLOWS[0], sha).id, 100);
  for (const change of [{ conclusion: 'failure' }, { status: 'queued', conclusion: null },
    { status: 'in_progress', conclusion: null }, { conclusion: 'cancelled' }]) {
    assert.throws(() => validateLatestPush([push(), push({ id: 101, ...change })], WORKFLOWS[0], sha));
    assert.throws(() => validateLatestPush([push(), push({ run_attempt: 3, ...change })], WORKFLOWS[0], sha));
  }
  for (const change of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'topic' },
    { path: WORKFLOWS[1] }, { repository: null }]) {
    assert.throws(() => validateLatestPush([push(change)], WORKFLOWS[0], sha));
  }
  assert.throws(() => validateLatestPush([], WORKFLOWS[0], sha));
});
test('binding requires exact verified manifest provenance and safe outputs', () => {
  assert.deepEqual(validateBinding(candidate, '100', '2', sha), { version: '1.2.3',
    filename: candidate.filename, sha256: candidate.sha256, 'source-sha': sha });
  for (const change of [{ repository: 'evil/repo' }, { runId: '101' }, { runAttempt: '1' },
    { sourceCommit: 'b'.repeat(40) }, { filename: '../file.tgz' }, { sha256: 'bad' }, { version: '1.2.3\nx=y' }]) {
    assert.throws(() => validateBinding({ ...candidate, ...change }, '100', '2', sha));
  }
});
const stage = (changes = {}) => ({ name: 'stage', run_id: 100, run_attempt: 2,
  status: 'completed', conclusion: 'success', ...changes });
test('stage job must succeed in the exact latest attempt', () => {
  assert.equal(validateStageJobs([stage()], '100', '2').name, 'stage');
  for (const jobs of [[], [stage({ name: 'rehearsal' })], [stage({ conclusion: 'skipped' })],
    [stage({ conclusion: 'failure' })], [stage({ status: 'in_progress' })],
    [stage({ run_attempt: 1 })], [stage({ run_attempt: undefined })],
    [stage({ run_id: 101 })], [stage(), stage()], null]) {
    assert.throws(() => validateStageJobs(jobs, '100', '2'));
  }
});
test('workflow metadata binds numeric workflow ID and exact requested path', () => {
  const metadata = { id: 10, path: WORKFLOWS[0] };
  assert.deepEqual(validateWorkflow(push(), metadata, WORKFLOWS[0]), metadata);
  for (const changed of [{ ...metadata, id: 11 }, { ...metadata, path: WORKFLOWS[1] },
    { ...metadata, id: '../10' }]) {
    assert.throws(() => validateWorkflow(push(), changed, WORKFLOWS[0]));
  }
  assert.throws(() => validateWorkflow(push({ path: WORKFLOWS[1] }), metadata, WORKFLOWS[0]));
  assert.throws(() => validateWorkflow(push({ workflow_id: undefined }), metadata, WORKFLOWS[0]));
});
function fixture(options = {}) {
  const calls = [];
  const emitted = [];
  let workflow;
  const deps = { env, readPackage: () => pkg, npmCommand: () => ({ command: 'node', args: ['npm-cli.js'] }),
    emit: value => emitted.push(value), verify: async () => candidate,
    run: (command, args) => {
      calls.push([command, args]);
      if (options.fail?.(command, args)) throw new Error('secret credential must not be propagated to CLI');
      if (command === 'git') {
        if (args[0] === 'rev-parse') return sha;
        return '';
      }
      if (command === 'node') return JSON.stringify(options.versions ?? ['1.2.2']);
      const endpoint = args.at(-1);
      if (endpoint.includes('/compare/')) {
        return JSON.stringify(options.comparison ?? { status: 'ahead', merge_base_commit: { sha } });
      }
      if (endpoint.includes('/jobs?')) {
        const ciJobs = [
          { name: 'Node', run_id: 100, run_attempt: 2, head_sha: sha, status: 'completed', conclusion: 'success' },
          { name: 'Bun', run_id: 100, run_attempt: 2, head_sha: sha, status: 'completed', conclusion: 'success' },
          { name: 'Windows Node 22 and Bun 1.4.2', run_id: 100, run_attempt: 2, head_sha: sha, status: 'completed', conclusion: 'success' },
          { name: 'Windows Node 26 and Bun 1.4.2', run_id: 100, run_attempt: 2, head_sha: sha, status: 'completed', conclusion: 'success' },
        ];
        return JSON.stringify(options.jobPages ?? [{ jobs: options.jobs ?? [stage(), ...ciJobs] }]);
      }
      if (endpoint.includes('/workflows/') && !endpoint.includes('/runs?')) {
        workflow = endpoint.endsWith('/10') ? '.github/workflows/release-stage.yml' :
          endpoint.endsWith('/windows-cli-startup.yml') ? WORKFLOWS[1] : WORKFLOWS[0];
        return JSON.stringify({ id: 10, path: workflow, ...options.metadata });
      }
      if (args.includes('--paginate')) {
        return JSON.stringify([{ workflow_runs: [push({ path: workflow, ...options.push })] }]);
      }
      return JSON.stringify(options.detail ?? (WORKFLOWS.includes(workflow) ? push({ path: workflow }) : run()));
    } };
  return { calls, emitted, deps };
}
test('preflight checks both workflows and public npm registry before emitting', async () => {
  const f = fixture();
  await main(['preflight', '1.2.3'], f.deps);
  assert.equal(f.emitted.length, 1);
});
test('pending checks, failed reruns and network failure emit nothing', async () => {
  for (const options of [{ push: { status: 'queued', conclusion: null } },
    { detail: push({ run_attempt: 3, conclusion: 'failure' }) },
    { fail: command => command === 'gh' }]) {
    const f = fixture(options);
    await assert.rejects(main(['preflight', '1.2.3'], f.deps));
    assert.equal(f.emitted.length, 0);
  }
});
test('npm network errors and existing version stop preflight without output', async () => {
  for (const options of [{ versions: ['1.2.3'] }, { fail: c => c === 'node' }]) {
    const f = fixture(options);
    await assert.rejects(main(['preflight', '1.2.3'], f.deps));
    assert.equal(f.emitted.length, 0);
  }
});
test('ancestry requires ahead or identical and the exact source merge base', () => {
  for (const status of ['ahead', 'identical']) {
    assert.equal(validateAncestry({ status, merge_base_commit: { sha } }, sha), sha);
  }
  for (const comparison of [null, {}, { status: 'ahead' },
    { status: 'diverged', merge_base_commit: { sha } },
    { status: 'behind', merge_base_commit: { sha } },
    { status: 'ahead', merge_base_commit: { sha: 'b'.repeat(40) } },
    { status: 'identical', merge_base_commit: { sha: 'b'.repeat(40) } }]) {
    assert.throws(() => validateAncestry(comparison, sha));
  }
});
test('origin uses authenticated fixed-repo compare without invoking git', async () => {
  for (const status of ['ahead', 'identical']) {
    const f = fixture({ comparison: { status, merge_base_commit: { sha } } });
    await main(['origin', '100'], f.deps);
    assert.equal(f.emitted.length, 1);
  }
  for (const options of [
    { comparison: { status: 'diverged', merge_base_commit: { sha } } },
    { comparison: { status: 'behind', merge_base_commit: { sha } } },
    { comparison: { status: 'ahead', merge_base_commit: { sha: 'b'.repeat(40) } } },
    { fail: (c, a) => c === 'gh' && a.at(-1).includes('/compare/') },
  ]) {
    const failed = fixture(options);
    await assert.rejects(main(['origin', '100'], failed.deps));
    assert.equal(failed.emitted.length, 0);
  }
});
test('origin requests attempt-specific jobs and rejects rehearsals before comparison or outputs', async () => {
  const good = fixture({ jobPages: [{ jobs: [{ name: 'rehearsal' }] }, { jobs: [stage()] }] });
  await main(['origin', '100'], good.deps);
  assert.equal(good.emitted.length, 1);
  for (const options of [{ jobs: [] }, { jobs: [stage({ conclusion: 'skipped' })] },
    { jobs: [stage({ conclusion: 'failure' })] }, { jobs: [stage({ run_attempt: 1 })] },
    { jobPages: [{}] }, { fail: (c, args) => c === 'gh' && args.at(-1).includes('/jobs?') }]) {
    const f = fixture(options);
    await assert.rejects(main(['origin', '100'], f.deps));
    assert.equal(f.emitted.length, 0);
  }
});
test('CLI rejects forged workflow metadata and run workflow IDs', async () => {
  for (const command of [['origin', '100'], ['preflight', '1.2.3']]) {
    for (const metadata of [{ id: 11 }, { path: '.github/workflows/other.yml' }]) {
      const f = fixture({ metadata });
      await assert.rejects(main(command, f.deps));
      assert.equal(f.emitted.length, 0);
    }
  }
  for (const options of [{ push: { workflow_id: 11 } }, { detail: push({ workflow_id: 11 }) },
    { push: { path: WORKFLOWS[1] } }]) {
    const f = fixture(options);
    await assert.rejects(main(['preflight', '1.2.3'], f.deps));
    assert.equal(f.emitted.length, 0);
  }
});
test('bind verifies directory first and never emits after failed verification', async () => {
  const f = fixture();
  let verified;
  f.deps.verify = dir => { verified = dir; return candidate; };
  await main(['bind', '/tmp/candidate', '100', '2', sha], f.deps);
  assert.equal(verified, '/tmp/candidate');
  f.emitted.length = 0;
  f.deps.verify = () => { throw new Error('bad archive'); };
  await assert.rejects(main(['bind', '/tmp/candidate', '100', '2', sha], f.deps));
  assert.equal(f.emitted.length, 0);
});
test('outputs append safe single-line values only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-github-'));
  try {
    const file = path.join(dir, 'output');
    writeOutputs({ version: '1.2.3', 'source-sha': sha }, file);
    assert.equal(fs.readFileSync(file, 'utf8'), `version=1.2.3\nsource-sha=${sha}\n`);
    assert.throws(() => writeOutputs({ version: '1.2.3\nforged=true' }, file));
    assert.throws(() => writeOutputs({ version: '1.2.3' }, undefined));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('bind outputs survive the GITHUB_OUTPUT allowlist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-github-'));
  try {
    const file = path.join(dir, 'output');
    writeOutputs(validateBinding(candidate, '100', '2', sha), file);
    assert.equal(fs.readFileSync(file, 'utf8'),
      `version=1.2.3\nfilename=sonnivasquez-gsc-mcp-1.2.3.tgz\nsha256=${'b'.repeat(64)}\nsource-sha=${sha}\n`);
    assert.throws(() => writeOutputs({ 'a=b': '1.2.3' }, file));
    assert.throws(() => writeOutputs({ version: '1.2.3 please' }, file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
