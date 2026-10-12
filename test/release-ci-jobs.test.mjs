import test from 'node:test';
import assert from 'node:assert/strict';
import { main, validateCiJobs, REPOSITORY, WORKFLOWS } from '../scripts/release-github.mjs';

const sha = 'a'.repeat(40);
const pkg = { name: '@sonnivasquez/gsc-mcp', version: '1.2.3' };
const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha };
const repo = { full_name: REPOSITORY };

const push = (changes = {}) => ({ id: 100, run_attempt: 2, workflow_id: 10, repository: repo,
  head_repository: repo, head_branch: 'main', head_sha: sha, path: WORKFLOWS[0],
  event: 'push', status: 'completed', conclusion: 'success', ...changes });

const ciNode = (changes = {}) => ({ name: 'Node', run_id: 100, run_attempt: 2, head_sha: sha,
  status: 'completed', conclusion: 'success', ...changes });
const ciBun = (changes = {}) => ({ name: 'Bun', run_id: 100, run_attempt: 2, head_sha: sha,
  status: 'completed', conclusion: 'success', ...changes });
const win22 = (changes = {}) => ({ name: 'Windows Node 22 and Bun 1.4.2', run_id: 200, run_attempt: 2,
  head_sha: sha, status: 'completed', conclusion: 'success', ...changes });
const win26 = (changes = {}) => ({ name: 'Windows Node 26 and Bun 1.4.2', run_id: 200, run_attempt: 2,
  head_sha: sha, status: 'completed', conclusion: 'success', ...changes });

test('ci validator accepts exactly one successful Node and Bun', () => {
  assert.ok(validateCiJobs([ciNode(), ciBun()], '100', '2', sha, WORKFLOWS[0]));
});

test('ci validator tolerates absent optional run_attempt', () => {
  const jobs = [{ name: 'Node', run_id: 100, head_sha: sha, status: 'completed', conclusion: 'success' },
    { name: 'Bun', run_id: 100, head_sha: sha, status: 'completed', conclusion: 'success' }];
  assert.ok(validateCiJobs(jobs, '100', '2', sha, WORKFLOWS[0]));
});

test('ci validator tolerates absent optional head_sha', () => {
  const jobs = [{ name: 'Node', run_id: 100, run_attempt: 2, status: 'completed', conclusion: 'success' },
    { name: 'Bun', run_id: 100, run_attempt: 2, status: 'completed', conclusion: 'success' }];
  assert.ok(validateCiJobs(jobs, '100', '2', sha, WORKFLOWS[0]));
});

test('ci validator rejects missing, duplicate and unsuccessful jobs', () => {
  assert.throws(() => validateCiJobs([ciNode()], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciNode(), ciBun()], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ conclusion: 'skipped' })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ conclusion: 'failure' })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ conclusion: 'cancelled' })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ status: 'queued', conclusion: null })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ status: 'in_progress', conclusion: null })], '100', '2', sha, WORKFLOWS[0]));
});

test('ci validator rejects wrong run, attempt or sha bindings', () => {
  assert.throws(() => validateCiJobs([ciNode({ run_id: 101 }), ciBun()], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ run_attempt: 1 })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode(), ciBun({ head_sha: 'b'.repeat(40) })], '100', '2', sha, WORKFLOWS[0]));
  assert.throws(() => validateCiJobs([ciNode({ head_sha: 'b'.repeat(40) }), ciBun()], '100', '2', sha, WORKFLOWS[0]));
});

test('ci validator ignores unrelated jobs', () => {
  assert.ok(validateCiJobs([ciNode(), ciBun(), { name: 'Web', run_id: 999, status: 'completed', conclusion: 'success' }], '100', '2', sha, WORKFLOWS[0]));
});

test('windows validator requires both Node 22 and Node 26 exact jobs', () => {
  assert.ok(validateCiJobs([win22(), win26()], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22()], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22(), win22(), win26()], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22(), win26({ conclusion: 'skipped' })], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22(), win26({ conclusion: 'failure' })], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22({ run_id: 201 }), win26()], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22(), win26({ run_attempt: 1 })], '200', '2', sha, WORKFLOWS[1]));
  assert.throws(() => validateCiJobs([win22(), win26({ head_sha: 'b'.repeat(40) })], '200', '2', sha, WORKFLOWS[1]));
});

test('windows validator tolerates absent optional fields but rejects mismatches', () => {
  const jobs = [{ name: 'Windows Node 22 and Bun 1.4.2', run_id: 200, status: 'completed', conclusion: 'success' },
    { name: 'Windows Node 26 and Bun 1.4.2', run_id: 200, status: 'completed', conclusion: 'success' }];
  assert.ok(validateCiJobs(jobs, '200', '2', sha, WORKFLOWS[1]));
});

function preflightFixture(options = {}) {
  const emitted = [];
  let detailCalls = 0;
  const deps = { env, readPackage: () => pkg, npmCommand: () => ({ command: 'node', args: ['npm-cli.js'] }),
    emit: value => emitted.push(value),
    run: (command, args) => {
      if (command === 'git') {
        if (args[0] === 'rev-parse') return sha;
        return '';
      }
      if (command === 'node') return JSON.stringify(['1.2.2']);
      const endpoint = args.at(-1);
      if (endpoint.includes('/compare/')) {
        return JSON.stringify({ status: 'ahead', merge_base_commit: { sha } });
      }
      if (endpoint.includes('/jobs?')) {
        const pages = options.jobPages ?? [{ jobs: options.jobs ?? [] }];
        return JSON.stringify(pages);
      }
      if (endpoint.includes('/workflows/') && !endpoint.includes('/runs?')) {
        const workflow = endpoint.endsWith('/windows-cli-startup.yml') ? WORKFLOWS[1] : WORKFLOWS[0];
        return JSON.stringify({ id: 10, path: workflow });
      }
      if (args.includes('--paginate')) {
        const workflow = endpoint.includes('windows-cli-startup.yml') ? WORKFLOWS[1] : WORKFLOWS[0];
        const id = workflow === WORKFLOWS[1] ? 200 : 100;
        return JSON.stringify([{ workflow_runs: [push({ id, path: workflow })] }]);
      }
      detailCalls += 1;
      const isFinal = detailCalls % 2 === 0;
      if (isFinal && options.final !== undefined) {
        if (options.final instanceof Error) throw options.final;
        return JSON.stringify(options.final);
      }
      if (options.detail !== undefined && !isFinal) return JSON.stringify(options.detail);
      if (options.detail !== undefined && isFinal && options.final === undefined) return JSON.stringify(options.detail);
      const id = detailCalls <= 2 ? 100 : 200;
      const workflow = detailCalls <= 2 ? WORKFLOWS[0] : WORKFLOWS[1];
      return JSON.stringify(push({ id, path: workflow }));
    } };
  return { emitted, deps };
}

const bothJobs = [ciNode(), ciBun(), win22(), win26()];

test('preflight accepts complete exact proof across pagination', async () => {
  const f = preflightFixture({ jobPages: [{ jobs: [ciNode()] }, { jobs: [ciBun(), win22(), win26()] }] });
  await main(['preflight', '1.2.3'], f.deps);
  assert.equal(f.emitted.length, 1);
});

test('preflight accepts complete exact proof', async () => {
  const f = preflightFixture({ jobs: bothJobs });
  await main(['preflight', '1.2.3'], f.deps);
  assert.equal(f.emitted.length, 1);
});

test('preflight rejects skipped jobs without emitting', async () => {
  const f = preflightFixture({ jobs: [ciNode(), ciBun({ conclusion: 'skipped' }), win22(), win26()] });
  await assert.rejects(main(['preflight', '1.2.3'], f.deps));
  assert.equal(f.emitted.length, 0);
});

test('preflight rejects failed jobs without emitting', async () => {
  const f = preflightFixture({ jobs: [ciNode(), ciBun(), win22(), win26({ conclusion: 'failure' })] });
  await assert.rejects(main(['preflight', '1.2.3'], f.deps));
  assert.equal(f.emitted.length, 0);
});

test('preflight rejects missing jobs without emitting', async () => {
  const f = preflightFixture({ jobs: [ciNode(), win22(), win26()] });
  await assert.rejects(main(['preflight', '1.2.3'], f.deps));
  assert.equal(f.emitted.length, 0);
});

test('preflight rejects rerun race where final attempt changed', async () => {
  const f = preflightFixture({ jobs: bothJobs, final: push({ id: 100, path: WORKFLOWS[0], run_attempt: 3, status: 'queued', conclusion: null }) });
  await assert.rejects(main(['preflight', '1.2.3'], f.deps));
  assert.equal(f.emitted.length, 0);
});
