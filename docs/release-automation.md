# Release automation

The repository contains a staged npm release workflow and a separate finalization workflow. Neither runs merely because you push a commit. Their publication steps require a deliberate workflow dispatch.

## Adapt a fork first

The release automation is intentionally bound to the original project. It will reject another repository until you adapt its identity checks. Do not remove those checks just to bypass a failure.

Review these places together:

- `package.json`, `package-lock.json`, `bun.lock`, `manifest.json` and `web/src/lib/site.ts` for package and version identity.
- `scripts/release-candidate.mjs` for `NAME`, `REPOSITORY`, expected tarball names, npm URLs and repository validation.
- `scripts/release-github.mjs` for repository identity, package validation and candidate filenames.
- `scripts/release-finalize.mjs` for expected candidate filenames. It imports package/repository identity from the candidate script.
- The release tests for their expected identities and artifact names.
- `.github/workflows/release-stage.yml` and `release-finalize.yml` for branch, runtime and publishing assumptions.

Choose your own npm scope, configure publishing permission for that package and repository, and keep the artifact checks consistent. Consult the current [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for account setup.

This guide does not configure a publisher or grant publishing permissions.

## Stage workflow

`release-stage.yml` accepts a committed stable version and a boolean `stage` input, which defaults to `false`.

The workflow checks the `main` branch, an unpublished version and successful push CI for the exact source commit. It builds one candidate tarball and a manifest, then tests the installed package on Linux and Windows with Node 22 and 26 and Bun 1.4.2.

The manifest binds the candidate to its source commit, workflow run, attempt and file hashes. The package audit rejects unexpected paths and known credential patterns; it does not replace a review of the actual public content.

With `stage=false`, the publishing job is skipped. With `stage=true`, the workflow deliberately attempts npm publication of the tested tarball using OIDC. Follow the account-side approval process if npm requires it.

Use the Actions form to select the branch and inputs. Review the exact candidate before approving a publication run. Never treat the default rehearsal as permission to publish.

## Finalization workflow

`release-finalize.yml` takes `source_run_id` from a successful stage run. It validates the run, attempt, workflow and ancestry, downloads the bound candidate and checks that its approved bytes are available from npm.

It tests that package again, then finalizes the GitHub release with the verified artifact. It does not create a replacement npm package to hide a failed check.

Artifacts are retained for 30 days. If the verified artifact is unavailable, stop and recover the original bytes and manifest rather than assuming a rebuild is identical.

## CI and retries

`scripts/ci-changed.mjs` routes MCP and web checks according to the changed paths. Empty, invalid, or unreadable change information runs both groups. A path runs the web job only when it affects the website (`web/**`, `DESIGN.md`, `.impeccable/design.json`, `web/src/lib/site.ts`, or `.github/workflows/ci.yml`). Other paths, including `README.md` and `PRIVACY.md`, run the MCP jobs only. The release preflight requires actual successful Node, Bun and Windows jobs for the relevant attempt, not just a successful workflow containing skipped jobs.

For a candidate workflow retry, rerun all jobs so the artifact is rebuilt and bound to the new attempt. For an uncertain npm publication, first check the exact version in the registry; a network error does not prove that npm rejected it.

## Website deployment

Website deployment is separate from npm publication. Adapt `web/wrangler.jsonc`, the domain/package references in `web/src/lib/site.ts`, public metadata and installer URLs for your fork. Use your own Cloudflare account and credentials.

The release workflows do not deploy the website, make the repository public, or remove private Git history or older release assets.

See the [release checklist](release-checklist.md) and [website guide](../web/README.md).
