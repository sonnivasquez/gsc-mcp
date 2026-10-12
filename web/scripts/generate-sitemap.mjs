// Generates web/public/sitemap.xml from the site's own route list.
//
// Why generate instead of committing a static file: lastmod is only honest if
// it moves with the build. A committed sitemap silently goes stale, and a
// stale lastmod is worse than no lastmod because Google trusts it.
//
// The route list below mirrors web/src/routeTree.gen.ts. Keep them in sync
// when a page is added; `bun run sitemap:check` fails the build if they drift.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Every indexable page, in crawl-priority order. Terms and privacy are real
// pages but carry no search demand, so they stay listed and lowest priority.
const ROUTES = [
  { path: "/", changefreq: "monthly", priority: "1.0" },
  { path: "/docs", changefreq: "monthly", priority: "0.9" },
  { path: "/docs/credentials", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/clients", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/commands", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/troubleshooting", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/uninstall", changefreq: "monthly", priority: "0.6" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

const SITE_ORIGIN = "https://gscmcp.dev";

const lastmod = new Date().toISOString().slice(0, 10);

const body = ROUTES.map(
  (route) =>
    `  <url>\n    <loc>${SITE_ORIGIN}${route.path === "/" ? "/" : route.path}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>`,
).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

writeFileSync(`${root}public/sitemap.xml`, xml, "utf8");
console.log(`sitemap.xml written with ${ROUTES.length} URLs (lastmod ${lastmod})`);
