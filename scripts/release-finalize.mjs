#!/usr/bin/env node
// CLI: node scripts/release-finalize.mjs finalize <candidate-dir>
// Requires Node >=22, npm and gh on PATH, and GH_TOKEN with release write access.
// The directory is the unchanged external artifact consumed by release-candidate.
// No package code is executed. npm is read-only; all GitHub operations use the fixed repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NAME, REPOSITORY, verify, registry, sha256 } from './release-candidate.mjs';
import { npmCommand } from './npm-command.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class FinalizeError extends Error {}
const check = (ok, message) => { if (!ok) throw new FinalizeError(message); };
const parse = text => {
  try { return JSON.parse(text); } catch { throw new FinalizeError('Invalid command JSON response'); }
};

// Injectable adapter: (command, argv) => { status, stdout, stderr?, error? }.
// Capture, never forward, child output because failures may contain credentials.
export function runCommand(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
}

export function githubApi(endpoint, run = runCommand, allow404 = false) {
  const result = run('gh', ['api', '--hostname', 'github.com', '--include', `repos/${REPOSITORY}/${endpoint}`]);
  const text = String(result.stdout ?? '');
  const header = /^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n/.exec(text);
  check(!result.error && header, 'GitHub API transport failed');
  const status = Number(header[1]);
  if (allow404 && status === 404 && result.status === 1) return null;
  check(result.status === 0 && status >= 200 && status < 300, 'GitHub API request failed');
  return parse(text.slice(header[0].length));
}

export function tagCommit(tag, api) {
  const ref = api(`git/ref/tags/${tag}`, true);
  if (ref === null) return null;
  check(ref?.ref === `refs/tags/${tag}`, 'Unexpected tag reference');
  let object = ref.object;
  let depth = 0;
  while (object?.type === 'tag') {
    check(depth++ < 5, 'Annotated tag depth exceeds five');
    check(/^[a-f0-9]{40}$/.test(object.sha), 'Invalid tag object SHA');
    object = api(`git/tags/${object.sha}`).object;
  }
  check(object?.type === 'commit' && /^[a-f0-9]{40}$/.test(object.sha), 'Tag does not resolve to a commit');
  return object.sha;
}

function releaseIdentity(release, tag, commit) {
  check(release?.tag_name === tag && typeof release.draft === 'boolean' &&
    release.prerelease === false && Number.isSafeInteger(release.id) && release.id > 0,
  'Invalid stable release identity');
  if (release.draft) check(release.target_commitish === commit, 'Draft target must equal candidate source SHA');
}

export function checkAssets(assets, expected) {
  check(Array.isArray(assets), 'Invalid release assets response');
  const missing = [];
  for (const [name, digest] of Object.entries(expected)) {
    const matches = assets.filter(asset => asset?.name === name);
    check(matches.length <= 1, 'Duplicate release asset');
    if (!matches.length) { missing.push(name); continue; }
    check(matches[0].state === 'uploaded' && matches[0].digest === `sha256:${digest}`,
      'Release asset digest mismatch or unavailable');
  }
  return missing;
}

// Dependencies are injectable for offline tests. Returns the final REST release
// (draft:false is GitHub REST's equivalent of gh's isDraft:false).
export async function finalize(dir, deps = {}) {
  const run = deps.run ?? runCommand;
  const candidate = await (deps.verify ?? verify)(dir);
  check(candidate?.name === NAME && candidate.repository === REPOSITORY &&
    /^\d+\.\d+\.\d+$/.test(candidate.version) &&
    candidate.filename === `sonnivasquez-gsc-mcp-${candidate.version}.tgz` &&
    /^[a-f0-9]{40}$/.test(candidate.sourceCommit), 'Invalid candidate identity');
  await (deps.registry ?? registry)(dir);
  const api = (endpoint, optional = false) => githubApi(endpoint, run, optional);
  const command = (bin, args) => {
    const result = run(bin, args);
    check(!result.error && result.status === 0, 'External command failed');
    return result.stdout;
  };
  const latest = () => {
    const npm = (deps.npmCommand ?? npmCommand)();
    const parsed = parse(command(npm.command, [...npm.args, 'view', NAME, 'dist-tags.latest', '--json',
      '--registry=https://registry.npmjs.org/']));
    // npm 12 (pinned in release workflows) wraps scalars in a single-element array.
    check(!Array.isArray(parsed) || parsed.length === 1, 'Ambiguous registry latest');
    check((Array.isArray(parsed) ? parsed[0] : parsed) === candidate.version,
    'Registry latest must equal candidate version');
  };
  const tag = `v${candidate.version}`;
  const checkTag = required => {
    const commit = tagCommit(tag, api);
    check(commit === candidate.sourceCommit || (!required && commit === null), 'Remote tag source SHA mismatch or missing');
  };
  checkTag(false);
  const readRelease = id => {
    check(Number.isSafeInteger(id) && id > 0, 'Invalid release ID');
    const found = api(`releases/${id}`);
    releaseIdentity(found, tag, candidate.sourceCommit);
    check(found.id === id, 'Release identity changed');
    return found;
  };
  const findRelease = () => {
    // Pending tags on drafts are not found by GET /releases/tags/{tag}.
    // Authenticated listing includes drafts. Scan every page for ambiguity.
    const matches = [];
    for (let page = 1; ; page++) {
      const batch = api(`releases?per_page=100&page=${page}`);
      check(Array.isArray(batch), 'Invalid releases response');
      matches.push(...batch.filter(item => item?.tag_name === tag));
      check(matches.length <= 1, 'Ambiguous release tag');
      if (batch.length < 100) break;
      check(page < 100, 'Too many release pages');
    }
    return matches.length ? readRelease(matches[0].id) : null;
  };
  let release = findRelease();
  if (release !== null) {
    releaseIdentity(release, tag, candidate.sourceCommit);
    if (!release.draft) checkTag(true);
  }
  const tarball = fs.readFileSync(path.join(dir, candidate.filename));
  const manifest = fs.readFileSync(path.join(dir, 'candidate.json'));
  check(sha256(tarball) === candidate.sha256 &&
    JSON.stringify(parse(manifest)) === JSON.stringify(candidate), 'Local candidate changed after verification');
  const expected = { [candidate.filename]: candidate.sha256, 'candidate.json': sha256(manifest) };
  const assets = () => {
    const all = [];
    for (let page = 1; ; page++) {
      const batch = api(`releases/${release.id}/assets?per_page=100&page=${page}`);
      check(Array.isArray(batch), 'Invalid release assets response');
      all.push(...batch);
      if (batch.length < 100) return all;
      check(page < 100, 'Too many release asset pages');
    }
  };
  let missing = release === null ? Object.keys(expected) : checkAssets(assets(), expected);
  // A verified public release is a no-op even when npm latest has moved on.
  // Gate creation, draft resumption and any missing-asset uploads before writes.
  if (release === null || release.draft || missing.length) latest();
  const gh = args => command('gh', ['release', ...args, '--repo', `github.com/${REPOSITORY}`]);
  let temporary;
  try {
    if (release === null || missing.length) {
      // Use a private snapshot, outside the worktree, for both notes and assets.
      const base = fs.realpathSync(os.tmpdir());
      const root = fs.realpathSync(ROOT);
      check(base !== root && !base.startsWith(`${root}${path.sep}`), 'Temporary directory must be outside worktree');
      temporary = fs.mkdtempSync(path.join(base, 'gsc-finalize-'));
      for (const [name, bytes] of [[candidate.filename, tarball], ['candidate.json', manifest]]) {
        fs.writeFileSync(path.join(temporary, name), bytes, { flag: 'wx', mode: 0o600 });
      }
      if (release === null) {
        const notes = path.join(temporary, 'notes.md');
        fs.writeFileSync(notes, `${NAME} ${candidate.version}\n\nSource commit: ${candidate.sourceCommit}\nTarball SHA-256: ${candidate.sha256}\n`, { flag: 'wx', mode: 0o600 });
        gh(['create', tag, '--draft', '--target', candidate.sourceCommit, '--title', tag, '--notes-file', notes]);
        release = findRelease();
        check(release !== null, 'Created draft not found');
        releaseIdentity(release, tag, candidate.sourceCommit);
        check(release.draft, 'New release must remain a draft');
        checkTag(false);
        missing = checkAssets(assets(), expected);
      }
      for (const name of missing) gh(['upload', tag, path.join(temporary, name)]);
    }
    check(checkAssets(assets(), expected).length === 0, 'Release assets are missing');
    // Re-read before publishing; do not edit an already-public valid release.
    const current = readRelease(release.id);
    releaseIdentity(current, tag, candidate.sourceCommit);
    check(current.id === release.id, 'Release identity changed');
    release = current;
    checkTag(!release.draft);
    if (release.draft) {
      latest();
      gh(['edit', tag, '--draft=false', '--latest']);
    }
    const final = readRelease(release.id);
    releaseIdentity(final, tag, candidate.sourceCommit);
    check(final.id === release.id && !final.draft, 'Release is not published');
    release = final;
    checkTag(true);
    check(checkAssets(assets(), expected).length === 0, 'Published release assets are missing');
    return final;
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export async function main(argv, deps = {}) {
  check(argv.length === 2 && argv[0] === 'finalize' && argv[1],
    'Usage: node scripts/release-finalize.mjs finalize <candidate-dir>');
  return finalize(argv[1], deps);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(Number(process.versions.node.split('.')[0]) >= 22, 'Node >=22 required');
    const result = await main(process.argv.slice(2));
    console.log(`finalize: ${result.tag_name} published and verified`);
  } catch (error) {
    console.error(`release-finalize: ${error instanceof FinalizeError ? error.message : 'Operation failed; external error details suppressed'}`);
    process.exitCode = 1;
  }
}
