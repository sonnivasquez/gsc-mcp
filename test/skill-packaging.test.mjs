// skill-packaging — T01: bundle and validate the GSC agent skill.
// Deterministic, no network, no Google, no home-directory writes.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmCommand } from "../scripts/npm-command.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "google-search-console-mcp");
const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
const CATALOG_MD = path.join(SKILL_DIR, "references", "tool-catalog.md");

const EXPECTED_29 = [
  "gsc_capabilities",
  "gsc_list_sites",
  "gsc_search_analytics",
  "gsc_inspect_urls",
  "gsc_list_sitemaps",
  "gsc_get_dataset",
  "gsc_performance_overview",
  "gsc_compare_periods",
  "gsc_page_queries",
  "gsc_query_pages",
  "gsc_find_opportunities",
  "gsc_detect_cannibalization",
  "gsc_analyze_segments",
  "gsc_export_dataset",
  "gsc_analyze_traffic_drop",
  "gsc_content_decay",
  "gsc_check_alerts",
  "gsc_content_candidates",
  "gsc_content_recommendations",
  "gsc_multi_site_overview",
  "gsc_generate_report",
  "gsc_verify_claim",
  "gsc_compare_web_image",
  "gsc_submit_url",
  "gsc_submit_batch",
  "gsc_submit_sitemap",
  "gsc_genai_conversation_queries",
  "gsc_image_page_audit",
  "gsc_check_update_impact",
];

// Retired bare legacy names (equivalence map only in compatibility-manifest.json).
// Must not appear as invokable tools: any occurrence must carry the gsc_ prefix.
const STALE_BARE_NAMES = [
  "site_snapshot",
  "quick_wins",
  "ctr_opportunities",
  "traffic_drops",
  "content_gaps",
  "cannibalization_check",
  "topic_cluster_performance",
  "ctr_vs_benchmark",
  "advanced_search_analytics",
  "generate_report",
  "multi_site_dashboard",
  "image_keyword_overview",
  "image_search_quick_wins",
  "compare_web_vs_image",
  "image_pages_overview",
  "image_keyword_trends",
  "image_impressions_no_clicks",
  "image_content_decay",
  "image_page_audit",
  "genai_conversation_queries",
  "submit_url",
  "submit_batch",
  "submit_sitemap",
  "list_sitemaps",
  "verify_claim",
  "inspect_url",
  "check_alerts",
  "content_recommendations",
];

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function parseFrontmatter(text) {
  text = text.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with a YAML frontmatter block");
  const raw = m[1];
  const body = text.slice(m[0].length);
  const get = (key) => {
    const line = raw.split("\n").find((l) => l.startsWith(`${key}:`));
    assert.ok(line, `frontmatter must include ${key}`);
    return line.slice(key.length + 1).trim();
  };
  return { raw, body, get };
}

function gscNames(text) {
  return [...text.matchAll(/\bgsc_[a-z0-9_]+\b/g)].map((m) => m[0]);
}

test("skill frontmatter accepts CRLF while rejecting malformed headers", () => {
  const text = read(SKILL_MD).replace(/\r\n/g, "\n");
  const { get, body } = parseFrontmatter(text.replace(/\n/g, "\r\n"));
  assert.equal(get("name"), "google-search-console-mcp");
  assert.equal(get("license"), "Apache-2.0");
  assert.ok(body.includes("## Activation Contract"));
  assert.throws(() => parseFrontmatter(text.replace(/^---/, "--")), /YAML frontmatter/);
});

test("skill frontmatter follows the LLM-first contract", () => {
  const { raw, get } = parseFrontmatter(read(SKILL_MD));
  assert.equal(get("name"), "google-search-console-mcp");
  const descLine = raw.split("\n").find((l) => l.startsWith("description:"));
  assert.ok(/description: ".*"$/.test(descLine), "description must be one quoted physical line");
  const desc = JSON.parse(descLine.slice("description:".length).trim());
  assert.ok(desc.length <= 250, `description must be <=250 chars (got ${desc.length})`);
  for (const trigger of ["Google Search Console", "GSC"]) {
    assert.ok(desc.includes(trigger), `description must carry trigger word: ${trigger}`);
  }
  assert.equal(get("license"), "Apache-2.0");
  assert.ok(raw.includes('author:'), "frontmatter must include metadata.author");
  assert.ok(raw.includes('version:'), "frontmatter must include metadata.version");
});

test("skill sections arrive in contract order and stay within budget", () => {
  const { body } = parseFrontmatter(read(SKILL_MD));
  const order = [
    "Activation Contract",
    "Hard Rules",
    "Decision Gates",
    "Execution Steps",
    "Output Contract",
    "References",
  ];
  let idx = -1;
  for (const h of order) {
    const at = body.indexOf(`## ${h}`);
    assert.ok(at > idx, `missing or misordered section: ## ${h}`);
    idx = at;
  }
  assert.ok(!body.includes("Keywords:"), "skill must not add a Keywords section");
  const tokens = body.split(/\s+/).filter(Boolean).length;
  assert.ok(tokens <= 1000, `skill body must stay within the 1000-token hard max (got ~${tokens})`);
});

test("skill uses only current gsc_* names and current safety gates", () => {
  const skill = read(SKILL_MD);
  const catalog = read(CATALOG_MD);
  const allowed = new Set(EXPECTED_29);
  for (const text of [skill, catalog]) {
    assert.ok(
      !/gsc_[A-Za-z0-9_]+\*/.test(text),
      "wildcard pseudo-name must not appear; use exact gsc_* names"
    );
  }
  for (const text of [skill, catalog]) {
    for (const name of new Set(gscNames(text))) {
      assert.ok(allowed.has(name), `stale or unknown tool name: ${name}`);
    }
  }
  for (const name of EXPECTED_29) {
    assert.ok(
      skill.includes(name) || catalog.includes(name),
      `current tool missing from skill bundle: ${name}`
    );
  }
  for (const stale of STALE_BARE_NAMES) {
    const bare = new RegExp(`(?<!gsc_)\\b${stale}\\b`);
    assert.ok(!bare.test(skill), `stale legacy tool naming in SKILL.md: ${stale}`);
    assert.ok(!bare.test(catalog), `stale legacy tool naming in tool-catalog.md: ${stale}`);
  }
  for (const gate of ["GSC_ACCESS_MODE=full", "GSC_SCOPES=full", "GSC_ENABLE_WRITE=1", "GSC_EXPORTS=1", "write_ops"]) {
    assert.ok(skill.includes(gate) || catalog.includes(gate), `safety gate missing: ${gate}`);
  }
});

test("skill references stay local (no network targets)", () => {
  for (const p of [SKILL_MD, CATALOG_MD]) {
    const text = read(p);
    assert.ok(!/https?:\/\//.test(text), `${path.basename(p)} must not reference network URLs`);
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1];
      assert.ok(
        !/^(https?:)?\/\//.test(target) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target),
        `non-local reference target: ${target}`
      );
    }
  }
  // Every relative .md path mentioned must resolve on disk.
  for (const m of read(SKILL_MD).matchAll(/`((?:[\w.-]+\/)*[\w.-]+\.md)`/g)) {
    const abs = path.resolve(SKILL_DIR, m[1]);
    assert.ok(fs.existsSync(abs), `local reference does not resolve: ${m[1]}`);
  }
});

// npm startup and archive inspection can exceed Bun's default 5s on CI runners.
test("package files include the skill and the packed tarball carries it", { timeout: 30_000 }, () => {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
  assert.ok(Array.isArray(pkg.files), "package.json must declare a files array");
  const covers = (pattern, file) => {
    // Narrow matcher for the fixed skills/** glob shape used here.
    if (pattern.endsWith("/**/*")) {
      return file.startsWith(pattern.slice(0, -"/**/*".length) + "/");
    }
    return file === pattern;
  };
  for (const f of ["skills/google-search-console-mcp/SKILL.md", "skills/google-search-console-mcp/references/tool-catalog.md"]) {
    assert.ok(
      pkg.files.some((pat) => covers(pat, f)),
      `package.json files[] must cover ${f}`
    );
  }
  // Local dry-run only: lists packed entries without contacting the registry.
  // npm prints the tarball contents as `notice` lines on stderr, so read both streams.
  const npm = npmCommand();
  const packed = spawnSync(npm.command, [...npm.args, "pack", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 25_000,
  });
  assert.ifError(packed.error);
  assert.equal(packed.status, 0, "npm pack --dry-run must succeed");
  const out = `${packed.stdout}\n${packed.stderr}`;
  for (const f of ["skills/google-search-console-mcp/SKILL.md", "skills/google-search-console-mcp/references/tool-catalog.md"]) {
    assert.ok(out.includes(f), `packed tarball must include ${f}`);
  }
});
