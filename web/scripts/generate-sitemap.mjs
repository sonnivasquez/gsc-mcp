// Generates web/public/sitemap.xml from the site's own route list.
//
// Each URL's lastmod is the latest commit date of the source files that
// build that page (`git log -1 --format=%cs -- <files>`), not the clock time
// of this run. Two generations from the same checkout must match.
//
// The route list mirrors web/src/routeTree.gen.ts. That generated module
// imports every route, so it is not dated here: including it would move
// every URL when any one page changes. Shared chrome (root layout, header,
// footer, global CSS, and the assets those pages reference) is dated on
// every URL. README.md and PRIVACY.md are not page sources; the site does
// not render them.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Parent layout, global styles, and assets referenced from every page head.
const SHELL = [
  "web/src/router.tsx",
  "web/src/routes/__root.tsx",
  "web/src/styles.css",
  "web/src/styles/tokens.css",
  "web/src/styles/docs.css",
  "web/src/styles/site-chrome.css",
  "web/src/lib/site.ts",
  "web/src/lib/utils.ts",
  "web/src/components/not-found.tsx",
  "web/src/components/site-footer.tsx",
  "web/src/components/site-header.tsx",
  "web/src/components/brand-mark.tsx",
  "web/src/components/github-icon.tsx",
  "web/src/components/ui/button.tsx",
  "web/public/favicon.svg",
  "web/public/og.png",
];

const DOC_CHROME = [
  "web/src/routes/docs.route.tsx",
  "web/src/components/docs-layout.tsx",
  "web/src/components/doc.tsx",
  "web/src/components/copy-button.tsx",
];

const TABS = ["web/src/components/ui/tabs.tsx"];
const TOOL_CATALOG = ["src/gsc/catalog.ts", "web/src/lib/tools.ts"];

const HOME = [
  ...TOOL_CATALOG,
  "web/src/routes/index.tsx",
  "web/src/lib/install-prompt.ts",
  "web/src/lib/structured-data.ts",
  "web/src/components/agent-install.tsx",
  "web/src/components/client-logo.tsx",
  "web/src/components/copy-button.tsx",
  "web/src/components/conversation-stream.tsx",
  "web/src/components/home-example-data.ts",
  "web/src/components/home-faq.tsx",
  "web/src/components/home-questions.tsx",
  "web/src/components/home-use-cases.tsx",
  "web/src/components/install-workbench.tsx",
  "web/src/components/table-scroll-hint.tsx",
  "web/src/components/ui/tabs.tsx",
  "web/src/components/use-conversation-motion.ts",
];

const EXAMPLES = ["web/src/components/mcp-example.tsx", "web/src/data/examples.json"];

const DOCS_INDEX = [
  "web/src/routes/docs.index.tsx",
  "web/src/components/agent-install.tsx",
  "web/src/lib/install-prompt.ts",
  ...TABS,
];

// Every indexable page, in crawl-priority order. Terms and privacy are real
// pages but carry no search demand, so they stay listed and lowest priority.
const ROUTES = [
  { path: "/", changefreq: "monthly", priority: "1.0", sources: [...SHELL, ...HOME] },
  { path: "/docs", changefreq: "monthly", priority: "0.9", sources: [...SHELL, ...DOC_CHROME, ...DOCS_INDEX] },
  { path: "/docs/credentials", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, "web/src/routes/docs.credentials.tsx"] },
  { path: "/docs/clients", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, ...TABS, "web/src/routes/docs.clients.tsx"] },
  { path: "/docs/commands", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, "web/src/routes/docs.commands.tsx"] },
  { path: "/docs/tools", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, ...TOOL_CATALOG, "web/src/routes/docs.tools.tsx"] },
  { path: "/docs/audits", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, ...EXAMPLES, "web/src/routes/docs.audits.tsx"] },
  { path: "/docs/history", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, ...EXAMPLES, "web/src/routes/docs.history.tsx"] },
  { path: "/docs/analytics", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, ...EXAMPLES, "web/src/routes/docs.analytics.tsx"] },
  { path: "/docs/troubleshooting", changefreq: "monthly", priority: "0.8", sources: [...SHELL, ...DOC_CHROME, "web/src/routes/docs.troubleshooting.tsx"] },
  { path: "/docs/uninstall", changefreq: "monthly", priority: "0.6", sources: [...SHELL, ...DOC_CHROME, ...TABS, "web/src/routes/docs.uninstall.tsx"] },
  { path: "/privacy", changefreq: "yearly", priority: "0.3", sources: [...SHELL, "web/src/routes/privacy.tsx"] },
  { path: "/terms", changefreq: "yearly", priority: "0.3", sources: [...SHELL, "web/src/routes/terms.tsx"] },
];

const SITE_ORIGIN = "https://gscmcp.dev";

function latestCommitDate(files) {
  const unique = [...new Set(files)];
  for (const file of unique) {
    if (!existsSync(path.join(repoRoot, file))) {
      throw new Error(`sitemap source missing: ${file}`);
    }
  }
  let output;
  try {
    output = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...unique], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "git log failed";
    throw new Error(`sitemap lastmod git log failed: ${detail}`);
  }
  const date = output.trim();
  if (!DATE.test(date)) {
    throw new Error(`sitemap lastmod unavailable for ${unique.join(", ")}`);
  }
  return date;
}

const dated = ROUTES.map((route) => ({ ...route, lastmod: latestCommitDate(route.sources) }));

const body = dated.map(
  (route) =>
    `  <url>\n    <loc>${SITE_ORIGIN}${route.path === "/" ? "/" : route.path}</loc>\n    <lastmod>${route.lastmod}</lastmod>\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>`,
).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

writeFileSync(path.join(webRoot, "public/sitemap.xml"), xml, "utf8");
console.log(`sitemap.xml written with ${dated.length} URLs`);
for (const route of dated) {
  console.log(`  ${route.path} ${route.lastmod}`);
}
