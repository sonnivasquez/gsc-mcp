# GSC MCP website

The `web/` application contains the homepage and setup documentation for the local MCP server. It uses TanStack Start with SSR, Vite, React and Tailwind, with a Cloudflare Workers deployment target. It does not execute Search Console queries or collect Google credentials.

## Local development

Run these commands from `web/` with Node.js 22 or newer:

```bash
npm ci
npm run dev
```

The development server uses port 3000. Both `dev` and `preview` explicitly run Vite with Node, even when invoked through Bun.

Before building:

```bash
npm run typecheck:node
npm run design:check:node
npm run build:node
```

Bun alternatives are `bun install --frozen-lockfile`, `bun run typecheck`, `bun run design:check` and `bun run build`. Build regenerates `src/routeTree.gen.ts`; do not edit that generated file manually.

`npm run preview` starts the local preview on port 4173. Starting a process is not enough to verify it; check that the page actually responds in your environment.

## Adapt the website for a fork

Before deployment, review:

- `wrangler.jsonc`: replace the original account ID, Worker name and custom-domain route with your own deployment settings.
- `src/lib/site.ts`: update the package, repository, version and website references.
- `public/install.sh`: adapt the npm package and download URLs if your fork uses another package identity.
- `public/robots.txt`, `public/sitemap.xml` and `scripts/generate-sitemap.mjs`: use your own canonical domain. Each URL `lastmod` is the latest `git log -1 --format=%cs` date of the source files that build that page, so generation needs the git history of those files.
- `src/routes/privacy.tsx` and `terms.tsx`: review the statements and maintainer contact for your fork.
- Branding, icons and public metadata: preserve required attribution and avoid implying Google endorsement.

Do not deploy this checkout into the original maintainer's Cloudflare account or domain. The server and website have separate runtimes; no Google credentials are needed for the website build.

## Documentation routes

The site includes `/docs`, `/docs/credentials`, `/docs/clients`, `/docs/commands`, `/docs/troubleshooting` and `/docs/uninstall`, plus `/privacy` and `/terms`.

To add a page:

1. Create `src/routes/docs.<slug>.tsx` with the matching `/docs/<slug>` route.
2. Add the entry to `DOC_NAV` in `src/lib/site.ts`.
3. Use the shared documentation primitives in `src/components/doc.tsx`.
4. Rebuild to regenerate the route tree and check navigation.

Unknown documentation paths use the documentation 404; other unknown routes use the global 404. Route errors use the root error component.

## Design and example data

[DESIGN.md](../DESIGN.md) describes the design system. Runtime tokens live in `src/styles/tokens.css`. Use `npm run design:sync:node` to refresh token exports and `npm run design:check:node` to check them.

Keep the `.impeccable` design configuration required by the sync script. Generated audits and screenshots are local artifacts, not build inputs.

The homepage conversations are illustrative data from `HOME_EXAMPLES`; they do not call Google or an AI model. Preserve the example labels, keyboard access, visible focus, narrow-screen layouts and reduced-motion behavior when modifying them.

See the root [README](../README.md), [tool catalog](../docs/tools.md) and [release checklist](../docs/release-checklist.md).
