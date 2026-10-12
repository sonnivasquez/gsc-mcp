#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { npmCommand } from './npm-command.mjs';

export const REPOSITORY = 'sonnivasquez/gsc-mcp';
export const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/windows-cli-startup.yml'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class ValidationError extends Error {}
const check = (ok, message) => { if (!ok) throw new ValidationError(message); };
export function numericId(value) {
  check((typeof value === 'string' || Number.isSafeInteger(value)) && /^[1-9]\d*$/.test(String(value)), 'Invalid run ID or attempt');
  return String(value);
}
export function sourceSha(value) {
  check(typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value), 'Invalid source SHA');
  return value;
}
export function stableVersion(value) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split('.').every(n => Number.isSafeInteger(Number(n))), 'Expected stable semver version');
  return value;
}
export function validateSource(version, pkg, env, head, status) {
  stableVersion(version);
  check(pkg?.name === '@sonnivasquez/gsc-mcp' && pkg.version === version, 'Package version or name mismatch');
  check(env.GITHUB_REPOSITORY === REPOSITORY, 'Unexpected source repository');
  check(env.GITHUB_REF === 'refs/heads/main', 'Source must be main');
  check(sourceSha(env.GITHUB_SHA) === head, 'HEAD does not match GITHUB_SHA');
  check(status === '', 'Source checkout must be clean');
  return { version, 'source-sha': head };
}
export function validateUnpublished(version, versions) {
  stableVersion(version);
  const list = typeof versions === 'string' ? [versions] : versions;
  check(Array.isArray(list) && list.length > 0 && list.every(v => typeof v === 'string' && v.length > 0), 'Invalid registry versions response');
  check(!list.includes(version), 'Version is already published');
  return version;
}
function identity(run, workflow, event, sha) {
  check(run?.repository?.full_name === REPOSITORY && run?.head_repository?.full_name === REPOSITORY, 'Unexpected run repository');
  check(run.path === workflow && run.event === event && run.head_branch === 'main', 'Unexpected run workflow, event or branch');
  check(sourceSha(run.head_sha) === sha, 'Run source SHA mismatch');
  numericId(run.id);
  numericId(run.run_attempt);
}
export function validateWorkflow(run, metadata, expectedPath) {
  check(metadata?.path === expectedPath && run?.path === expectedPath, 'Workflow path mismatch');
  check(numericId(run?.workflow_id) === numericId(metadata?.id), 'Workflow ID mismatch');
  return metadata;
}
export function validateStageJobs(jobs, runId, attempt) {
  const id = numericId(runId);
  const runAttempt = numericId(attempt);
  check(Array.isArray(jobs), 'Invalid jobs response');
  const stages = jobs.filter(job => job?.name === 'stage');
  check(stages.length === 1, 'Missing or ambiguous stage job');
  const stage = stages[0];
  check(numericId(stage.run_id) === id && numericId(stage.run_attempt) === runAttempt, 'Stage job run or attempt mismatch');
  check(stage.status === 'completed' && stage.conclusion === 'success', 'Stage job did not complete successfully');
  return stage;
}
export const CI_REQUIRED_JOBS = {
  '.github/workflows/ci.yml': ['Node', 'Bun'],
  '.github/workflows/windows-cli-startup.yml': ['Windows Node 22 and Bun 1.4.2', 'Windows Node 26 and Bun 1.4.2'],
};
export function validateCiJobs(jobs, runId, attempt, sha, workflow) {
  const id = numericId(runId);
  const runAttempt = numericId(attempt);
  const expectedSha = sourceSha(sha);
  check(WORKFLOWS.includes(workflow), 'Unexpected required workflow');
  check(Array.isArray(jobs), 'Invalid jobs response');
  const expected = CI_REQUIRED_JOBS[workflow];
  check(Array.isArray(expected), 'Unexpected required workflow');
  const found = [];
  for (const name of expected) {
    const matches = jobs.filter(job => job?.name === name);
    check(matches.length === 1, `Missing or ambiguous required job: ${name}`);
    const job = matches[0];
    check(numericId(job.run_id) === id, `Required job run mismatch: ${name}`);
    if (job.run_attempt !== undefined && job.run_attempt !== null) {
      check(numericId(job.run_attempt) === runAttempt, `Required job attempt mismatch: ${name}`);
    }
    if (job.head_sha !== undefined && job.head_sha !== null) {
      check(sourceSha(job.head_sha) === expectedSha, `Required job SHA mismatch: ${name}`);
    }
    check(job.status === 'completed' && job.conclusion === 'success', `Required job did not complete successfully: ${name}`);
    found.push(job);
  }
  return found;
}
function success(run) {
  check(run.status === 'completed' && run.conclusion === 'success', 'Required run is not completed successfully');
}
export function validateLatestPush(runs, workflow, sha) {
  sourceSha(sha);
  check(WORKFLOWS.includes(workflow), 'Unexpected required workflow');
  check(Array.isArray(runs) && runs.length > 0, 'Missing required push run');
  for (const run of runs) identity(run, workflow, 'push', sha);
  const latest = runs.reduce((a, b) => BigInt(b.id) > BigInt(a.id) ||
    (String(b.id) === String(a.id) && BigInt(b.run_attempt) > BigInt(a.run_attempt)) ? b : a);
  success(latest);
  return latest;
}
export function validateOrigin(run, runId) {
  const id = numericId(runId);
  identity(run, '.github/workflows/release-stage.yml', 'workflow_dispatch', sourceSha(run?.head_sha));
  check(numericId(run.id) === id, 'Origin run ID mismatch');
  success(run);
  const attempt = numericId(run.run_attempt);
  return { 'run-id': id, 'run-attempt': attempt, 'source-sha': run.head_sha,
    'artifact-name': `release-candidate-${id}-${attempt}` };
}
export function validateAncestry(comparison, sha) {
  sourceSha(sha);
  check(comparison?.merge_base_commit?.sha === sha &&
    ['ahead', 'identical'].includes(comparison?.status), 'Source is not an ancestor of main');
  return sha;
}
export function validateBinding(candidate, runId, attempt, sha) {
  const id = numericId(runId);
  const runAttempt = numericId(attempt);
  sourceSha(sha);
  check(candidate?.repository === REPOSITORY && candidate.runId === id &&
    candidate.runAttempt === runAttempt && candidate.sourceCommit === sha, 'Candidate provenance mismatch');
  const version = stableVersion(candidate.version);
  check(candidate.filename === `sonnivasquez-gsc-mcp-${version}.tgz` &&
    typeof candidate.sha256 === 'string' && /^[a-f0-9]{64}$/.test(candidate.sha256), 'Invalid candidate output');
  return { version, filename: candidate.filename, sha256: candidate.sha256, 'source-sha': sha };
}
function execute(command, args) {
  try { return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim(); }
  catch { throw new ValidationError('External command failed; check git, GitHub access or public registry connectivity'); }
}
function parse(text) {
  try { return JSON.parse(text); } catch { throw new Error('Invalid external JSON response'); }
}
export function writeOutputs(values, outputFile) {
  check(typeof outputFile === 'string' && outputFile.length > 0, 'GITHUB_OUTPUT is required');
  // Keys allow digits (e.g. sha256): injection safety comes from excluding
  // newlines, '=' and shell metacharacters, not from excluding digits.
  check(Object.entries(values).every(([k, v]) => /^[a-z0-9-]+$/.test(k) && typeof v === 'string' && /^[A-Za-z0-9.-]+$/.test(v)), 'Unsafe workflow output');
  try { fs.appendFileSync(outputFile, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join('')); }
  catch { throw new Error('Cannot write GITHUB_OUTPUT'); }
}
// Dependency injection keeps command sequencing and network failures testable offline.
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const run = deps.run ?? execute;
  const readPackage = deps.readPackage ?? (() => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
  const npm = deps.npmCommand ?? npmCommand;
  const emit = deps.emit ?? (values => writeOutputs(values, env.GITHUB_OUTPUT));
  const api = endpoint => parse(run('gh', ['api', '--hostname', 'github.com', endpoint]));
  const [command, ...args] = argv;
  let outputs;
  if (command === 'preflight' && args.length === 1) {
    const pkg = readPackage();
    outputs = validateSource(args[0], pkg, env, run('git', ['rev-parse', 'HEAD']),
      run('git', ['status', '--porcelain=v1', '--untracked-files=all']));
    for (const workflow of WORKFLOWS) {
      const metadata = api(`repos/${REPOSITORY}/actions/workflows/${path.posix.basename(workflow)}`);
      check(metadata?.path === workflow, 'Requested CI workflow path mismatch');
      numericId(metadata?.id);
      const endpoint = `repos/${REPOSITORY}/actions/workflows/${path.posix.basename(workflow)}/runs?branch=main&event=push&head_sha=${outputs['source-sha']}&per_page=100`;
      const pages = parse(run('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', endpoint]));
      check(Array.isArray(pages) && pages.length > 0 && pages.every(p => Array.isArray(p?.workflow_runs)), 'Invalid workflow runs response');
      const runs = pages.flatMap(p => p.workflow_runs);
      for (const item of runs) validateWorkflow(item, metadata, workflow);
      const latest = validateLatestPush(runs, workflow, outputs['source-sha']);
      // Re-read the run to catch a rerun started after the list response.
      const current = api(`repos/${REPOSITORY}/actions/runs/${numericId(latest.id)}`);
      check(numericId(current?.id) === numericId(latest.id) && BigInt(numericId(current?.run_attempt)) >= BigInt(numericId(latest.run_attempt)), 'Run changed unexpectedly');
      validateWorkflow(current, metadata, workflow);
      validateLatestPush([current], workflow, outputs['source-sha']);
      const attempt = numericId(current.run_attempt);
      const jobsEndpoint = `repos/${REPOSITORY}/actions/runs/${numericId(current.id)}/attempts/${attempt}/jobs?per_page=100`;
      const jobPages = parse(run('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', jobsEndpoint]));
      check(Array.isArray(jobPages) && jobPages.length > 0 && jobPages.every(p => Array.isArray(p?.jobs)), 'Invalid jobs response');
      validateCiJobs(jobPages.flatMap(p => p.jobs), numericId(current.id), attempt, outputs['source-sha'], workflow);
      // Re-read after jobs so a queued rerun or changed attempt cannot authorize stale proof.
      const final = api(`repos/${REPOSITORY}/actions/runs/${numericId(current.id)}`);
      check(numericId(final?.id) === numericId(current.id) && numericId(final?.run_attempt) === attempt, 'Run changed unexpectedly');
      validateWorkflow(final, metadata, workflow);
      validateLatestPush([final], workflow, outputs['source-sha']);
    }
    const { command: npmBin, args: npmArgs } = npm();
    validateUnpublished(args[0], parse(run(npmBin, [...npmArgs, 'view', pkg.name, 'versions', '--json', '--registry=https://registry.npmjs.org/'])));
  } else if (command === 'origin' && args.length === 1) {
    const id = numericId(args[0]);
    const current = api(`repos/${REPOSITORY}/actions/runs/${id}`);
    outputs = validateOrigin(current, id);
    const metadata = api(`repos/${REPOSITORY}/actions/workflows/${numericId(current.workflow_id)}`);
    validateWorkflow(current, metadata, '.github/workflows/release-stage.yml');
    const attempt = outputs['run-attempt'];
    const endpoint = `repos/${REPOSITORY}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`;
    const pages = parse(run('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', endpoint]));
    check(Array.isArray(pages) && pages.length > 0 && pages.every(p => Array.isArray(p?.jobs)), 'Invalid jobs response');
    validateStageJobs(pages.flatMap(p => p.jobs), id, attempt);
    // gh authenticates private-repository access without changing local refs.
    const sha = outputs['source-sha'];
    validateAncestry(api(`repos/${REPOSITORY}/compare/${sha}...main`), sha);
  } else if (command === 'bind' && args.length === 4) {
    numericId(args[1]); numericId(args[2]); sourceSha(args[3]);
    const verify = deps.verify ?? (await import('./release-candidate.mjs')).verify;
    outputs = validateBinding(await verify(args[0]), args[1], args[2], args[3]);
  } else {
    throw new ValidationError('Usage: release-github.mjs preflight <version> | origin <run_id> | bind <candidate-dir> <run_id> <attempt> <sha>');
  }
  emit(outputs);
  return outputs;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Only locally authored validation messages are safe to print.
    console.error(`release-github: ${error instanceof ValidationError ? error.message : 'Operation failed; check git, GitHub access, public registry connectivity and candidate validity. External error details suppressed.'}`);
    process.exitCode = 1;
  });
}
