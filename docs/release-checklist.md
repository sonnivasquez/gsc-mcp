# Release checklist

Use this checklist for a new release of your fork. It describes checks to perform, not the status of a previous release.

## Before building

- Choose your own npm package name and GitHub repository. Review the fork adaptation notes in [release automation](release-automation.md).
- Update the version consistently in `package.json`, `package-lock.json`, `manifest.json`, `src/version.ts`, `web/src/lib/site.ts` and `CHANGELOG.md`.
- Preserve [LICENSE](../LICENSE) and [NOTICE](../NOTICE), and review the package's `files` allowlist.
- Check the public files, Git history and release assets for credentials, real property data, local diagnostics and private documentation. `.gitignore` only affects untracked files.

## Local validation

```bash
npm ci
npm run typecheck:node
npm run test:node
bun --test test
sh scripts/test-mcp.sh dist/index.js node
sh scripts/test-mcp.sh dist/index.js bun
```

The Node test script builds `dist/` before running tests. The MCP smoke checks use local capability discovery; they do not need a Google account.

For the website, run these from `web/`:

```bash
npm ci
npm run typecheck:node
npm run design:check:node
npm run build:node
```

## Candidate and publication

- Require successful CI for the exact release commit, including the actual Node, Bun and Windows jobs.
- Build and review the tarball. Install and test those same bytes before publishing.
- Review the workflow rehearsal with `stage=false` before deliberately enabling publication.
- Configure npm publishing for your own repository and package. Never publish under the original maintainer's namespace.
- Approve publication explicitly. A successful local build or workflow rehearsal is not proof of publication.
- Verify the npm version and integrity, install from the registry, and check the GitHub release points to the same candidate.
- Deploy the website separately with your own Cloudflare account and domain, then verify the actual deployed pages.

If a publication request fails, check whether the exact version already reached npm before retrying. Do not rebuild different bytes under the same release identity.

See [release automation](release-automation.md) for the workflow boundaries and [website development](../web/README.md) for local web checks.
