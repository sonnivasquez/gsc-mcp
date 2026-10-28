import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const tools = await import("../dist/gsc/tools.js");

const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};

const SITE = "sc-domain:example.com";
const baseQuery = {
  siteUrl: SITE,
  startDate: "2026-08-01",
  endDate: "2026-08-28",
  dimensions: ["query"],
};

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    keys: [`q${i + 1}`],
    clicks: (i + 1) * 10,
    impressions: (i + 1) * 100,
    ctr: 0.1,
    position: 4 + i,
  }));
}

function analyticsFetch(dataset, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const start = body.startRow ?? 0;
    const limit = body.rowLimit ?? 25000;
    return new Response(JSON.stringify({ rows: dataset.slice(start, start + limit) }), { status: 200 });
  };
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("gsc_capabilities works offline with limits and disabled list", () => {
  const env = tools.gscCapabilities({ provider, allowlist: [] });
  assert.equal(env.schemaVersion, "1.0");
  assert.equal(env.status, "ok");
  assert.deepEqual(env.data.tools.slice(5).map((t) => t.name), [
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
  ]);
  const byKind = new Map(env.data.tools.map((t) => [t.name, t.kind]));
  assert.deepEqual(
    env.data.tools.filter((t) => t.kind === "write").map((t) => t.name).sort(),
    ["gsc_submit_batch", "gsc_submit_sitemap", "gsc_submit_url"]
  );
  assert.equal(byKind.get("gsc_image_page_audit"), "fetch");
  assert.equal(byKind.get("gsc_export_dataset"), "local");
  assert.equal(byKind.get("gsc_generate_report"), "local");
  assert.ok(env.data.tools.every((t) => ["read", "write", "fetch", "local"].includes(t.kind)));
  assert.ok(env.data.limits.resultLimitMax === 200);
  assert.ok(env.data.disabledCapabilities.includes("gsc_submit_url"));
  assert.ok(env.meta.warnings.some((w) => w.code === "NO_ALLOWLIST"));
});

test("gsc_capabilities mirrors the write gate in disabledCapabilities", async () => {
  const names = (caps) => caps.data.disabledCapabilities;
  await withEnv({ GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () => {
    const off = names(tools.gscCapabilities({ provider, allowlist: [] }));
    assert.ok(off.includes("gsc_submit_url"));
    assert.ok(off.includes("gsc_submit_batch"));
    assert.ok(off.includes("gsc_submit_sitemap"));
  });
  await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () => {
    const half = names(tools.gscCapabilities({ provider, allowlist: [] }));
    assert.ok(half.includes("gsc_submit_url"));
  });
  await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () => {
    const on = names(tools.gscCapabilities({ provider, allowlist: [] }));
    assert.ok(!on.includes("gsc_submit_url"));
    assert.ok(!on.includes("gsc_submit_batch"));
    assert.ok(!on.includes("gsc_submit_sitemap"));
    assert.ok(!on.includes("gsc_image_page_audit"));
    assert.ok(!on.includes("gsc_genai_conversation_queries"));
  });
});

test("gsc_search_analytics accepts preset without explicit dates", async () => {
  const calls = [];
  const env = await tools.gscSearchAnalytics(
    { siteUrl: SITE, preset: "last_7_days", dimensions: ["query"] },
    { provider, fetchImpl: analyticsFetch(rows(3), calls) }
  );
  assert.equal(env.status, "ok");
  assert.match(calls[0].startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(calls[0].startDate <= calls[0].endDate);
  assert.equal(env.meta.provenance.period.startDate, calls[0].startDate);
});

test("gsc_search_analytics rejects invalid input before any fetch", async () => {
  const bad = [
    { ...baseQuery, dimensions: ["query", "nope"] },
    { ...baseQuery, startDate: "2026-13-01" },
    { ...baseQuery, startDate: "2026-08-28", endDate: "2026-08-01" },
    { ...baseQuery, resultLimit: 201 },
    { ...baseQuery, sortBy: "bounce" },
    { ...baseQuery, siteUrl: " " },
  ];
  for (const input of bad) {
    let calls = 0;
    const env = await tools.gscSearchAnalytics(input, {
      provider,
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(env.status, "error", JSON.stringify(input));
    assert.equal(env.error.code, "INVALID_ARGUMENT");
    assert.equal(calls, 0);
  }
});

test("gsc_search_analytics returns sorted envelope with coverage", async () => {
  const calls = [];
  const env = await tools.gscSearchAnalytics(
    { ...baseQuery, resultLimit: 3 },
    { provider, fetchImpl: analyticsFetch(rows(5), calls) }
  );
  assert.equal(env.status, "ok");
  assert.deepEqual(env.data.rows.map((r) => r.keys[0]), ["q5", "q4", "q3"]);
  assert.equal(env.meta.coverage.fetchedRows, 5);
  assert.equal(env.meta.coverage.returnedRows, 3);
  assert.equal(env.meta.coverage.sortAppliedTo, "retrieved_dataset");
  assert.equal(env.meta.coverage.sourceGuarantee, "top_rows_not_exhaustive");
  assert.ok(env.meta.warnings.some((w) => w.code === "SOURCE_NOT_EXHAUSTIVE"));
  assert.equal(env.meta.provenance.siteUrl, SITE);
  assert.ok(env.meta.provenance.fetchedAt);
  assert.ok(env.meta.requestId);
});

test("gsc_search_analytics honors ascending position sort", async () => {
  const env = await tools.gscSearchAnalytics(
    { ...baseQuery, sortBy: "position", sortDirection: "asc" },
    { provider, fetchImpl: analyticsFetch(rows(3)) }
  );
  assert.deepEqual(env.data.rows.map((r) => r.keys[0]), ["q1", "q2", "q3"]);
});

test("gsc_list_sites filters to the instance allowlist", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/sites")
      ? new Response(JSON.stringify({ siteEntry: [{ siteUrl: SITE }, { siteUrl: "sc-domain:other.example" }] }), { status: 200 })
      : new Response("{}", { status: 404 });
  const full = await tools.gscListSites({ provider, fetchImpl, allowlist: null });
  assert.equal(full.data.sites.length, 2);
  const filtered = await tools.gscListSites({ provider, fetchImpl, allowlist: [SITE] });
  assert.deepEqual(filtered.data.sites.map((s) => s.siteUrl), [SITE]);
  assert.deepEqual(filtered.meta.coverage.stoppedBecause, ["instance_allowlist"]);
});

test("gsc_inspect_urls keeps order and partial successes", async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.inspectionUrl.endsWith("/bad")) {
      return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 });
    }
    return new Response(JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }), { status: 200 });
  };
  const env = await tools.gscInspectUrls(
    { siteUrl: SITE, urls: ["https://example.com/a", "https://example.com/bad", "https://example.com/c"] },
    { provider, fetchImpl }
  );
  assert.equal(env.status, "partial");
  assert.deepEqual(env.data.results.map((r) => r.url), [
    "https://example.com/a",
    "https://example.com/bad",
    "https://example.com/c",
  ]);
  assert.deepEqual(env.data.results.map((r) => r.status), ["ok", "error", "ok"]);
  assert.equal(env.data.results[1].error.code, "INVALID_ARGUMENT");
});

test("gsc_inspect_urls rejects empty and oversized batches", async () => {
  let calls = 0;
  const deps = { provider, fetchImpl: async () => (calls++, new Response("{}", { status: 200 })) };
  assert.equal((await tools.gscInspectUrls({ siteUrl: SITE, urls: [] }, deps)).error.code, "INVALID_ARGUMENT");
  assert.equal(
    (await tools.gscInspectUrls({ siteUrl: SITE, urls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`) }, deps)).error.code,
    "INVALID_ARGUMENT"
  );
  assert.equal(calls, 0);
});

test("gsc_list_sitemaps succeeds with injected canonical deps", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.match(url, /sitemaps$/);
    return new Response(
      JSON.stringify({
        sitemap: [
          { path: "https://example.com/sitemap.xml", lastSubmitted: "2026-08-01T00:00:00Z", warnings: 0, errors: 1 },
          { path: "https://example.com/news-sitemap.xml", warnings: 2, errors: 0 },
        ],
      }),
      { status: 200 }
    );
  };
  const env = await tools.gscListSitemaps(SITE, { provider, fetchImpl, allowlist: null });
  assert.equal(env.status, "ok");
  assert.equal(env.data.sitemaps.length, 2);
  assert.equal(env.data.sitemaps[0].path, "https://example.com/sitemap.xml");
  assert.equal(env.data.sitemaps[0].lastSubmitted, "2026-08-01T00:00:00Z");
  assert.equal(env.data.sitemaps[0].errors, 1);
  assert.equal(env.data.sitemaps[1].lastSubmitted, null);
  assert.equal(env.meta.provenance.siteUrl, SITE);
  assert.equal(env.meta.coverage.fetchedRows, 2);
  assert.equal(env.meta.coverage.returnedRows, 2);
  assert.equal(env.meta.coverage.sourceGuarantee, "resource_response");
  assert.equal(calls.length, 1);
});

test("gsc_list_sitemaps enforces the instance allowlist before any fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ sitemap: [] }), { status: 200 });
  };
  const env = await tools.gscListSitemaps(SITE, { provider, fetchImpl, allowlist: ["sc-domain:other.example"] });
  assert.equal(env.status, "error");
  assert.equal(env.error.code, "PROPERTY_NOT_ALLOWED");
  assert.equal(calls, 0);
});

test("gsc_list_sitemaps maps upstream and invalid input to errors without network surprises", async () => {
  const failing = await tools.gscListSitemaps(SITE, {
    provider,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 }),
    allowlist: null,
  });
  assert.equal(failing.status, "error");
  assert.equal(failing.error.code, "PROPERTY_PERMISSION_DENIED");

  let calls = 0;
  const invalid = await tools.gscListSitemaps("   ", {
    provider,
    fetchImpl: async () => (calls++, new Response("{}", { status: 200 })),
    allowlist: null,
  });
  assert.equal(invalid.status, "error");
  assert.equal(invalid.error.code, "INVALID_ARGUMENT");
  assert.equal(calls, 0);
});

test("gsc_capabilities answers over MCP without credentials", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  const child = spawn(process.execPath, [entry], { env, stdio: ["pipe", "pipe", "pipe"] });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "gsc_capabilities", arguments: {} } });
  let stdout = "";
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("capabilities call timed out")), 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('"id":3')) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    child.on("error", rejectPromise);
  });
  child.kill();
  const byId = {};
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.id !== undefined) byId[msg.id] = msg;
  }
  const text = JSON.parse(byId[3].result.content[0].text);
  assert.equal(text.data.tools.length, 34);
  const list = byId[2].result.tools.map((t) => t.name);
  assert.ok(list.includes("gsc_search_analytics"));
  assert.ok(list.includes("gsc_check_update_impact"));
  assert.equal(list.length, 34);
});
