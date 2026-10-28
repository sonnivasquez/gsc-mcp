import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolList = JSON.parse(readFileSync(join(root, "fixtures/mcp-tool-list.json"), "utf8"));
const currentToolList = JSON.parse(readFileSync(join(root, "fixtures/mcp-tool-list-current.json"), "utf8"));

const { GUARDRAIL_SUFFIX, VISUAL_SUFFIX, POSITION_CAVEAT, withMeta } = await import("../dist/guardrails.js");
const { getDateRange, getPriorDateRange, fetchAllRows } = await import("../dist/analytics.js");
const { getAuthMode, getConfig, resolveSiteUrl, assertWriteEnabled } = await import("../dist/auth.js");
const { submitSitemap } = await import("../dist/tools/submit-sitemap.js");
const { submitUrl, submitBatch } = await import("../dist/tools/submit-url.js");
const { imagePageAudit } = await import("../dist/tools/image-page-audit.js");
const { classifyQuery, genaiConversationQueries, GENAI_MAX_PULL_ROWS } = await import(
  "../dist/tools/genai-conversation-queries.js"
);
const { setInstanceAllowlist } = await import("../dist/profiles.js");
const oauth = await import("../dist/oauth.js");

const NAMES = [
  "gsc_submit_url",
  "gsc_submit_batch",
  "gsc_submit_sitemap",
  "gsc_genai_conversation_queries",
  "gsc_image_page_audit",
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
  "gsc_check_update_impact",
];

async function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function isoDay(date) {
  return date.toISOString().split("T")[0];
}

function shiftDays(day, delta) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDay(date);
}

test("registered MCP tools preserve the 29-name snapshot and expose the extended 34-tool contract", async () => {
  assert.equal(toolList.length, 29);
  assert.deepEqual(toolList.map((tool) => tool.name), NAMES);
  const home = mkdtempSync(join(tmpdir(), "gsc-tool-list-"));
  const child = spawn(process.execPath, [join(root, "dist/index.js")], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      GSC_DATA_DIR: join(home, "data"),
      GSC_AUTH_MODE: "oauth",
      LANG: "en_US.UTF-8",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const messages = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) messages.set(message.id, message);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "clean-room-contract", version: "0" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list", params: {} });
    const deadline = Date.now() + 20_000;
    while (!messages.has(2) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(messages.has(2), stderr || "tools/list did not answer");
    assert.equal(messages.get(1).result.serverInfo.name, "gsc-mcp");
    assert.equal(currentToolList.length, 34);
    assert.deepEqual(messages.get(2).result.tools, currentToolList);
    for (const old of toolList) {
      const current = currentToolList.find(t => t.name === old.name);
      assert.ok(current, old.name);
      for (const key of Object.keys(old.inputSchema.properties)) assert.ok(key in current.inputSchema.properties, `${old.name}.${key}`);
      assert.deepEqual(current.inputSchema.required, old.inputSchema.required);
      // Additive analytics inputs and corrected descriptions from PR #5.
      if (!["gsc_search_analytics", "gsc_detect_cannibalization", "gsc_image_page_audit", "gsc_submit_url", "gsc_submit_batch", "gsc_submit_sitemap"].includes(old.name)) assert.deepEqual(current, old);
    }
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});

test("guardrail copy and provenance wrapper stay stable", () => {
  assert.equal(
    GUARDRAIL_SUFFIX,
    " IMPORTANT: Base your analysis ONLY on the data returned. Report exact numbers from the results. Do not speculate about causes (e.g. algorithm updates, competitor actions) unless the data explicitly supports it. If the data does not contain enough information to answer a question, say so clearly rather than guessing."
  );
  assert.equal(
    VISUAL_SUFFIX,
    " PRESENTATION: Always present these results as a rich, interactive visualization using artifacts. Use summary cards for key metrics, colour-coded indicators for severity or change direction (green for positive, red for negative), bar charts or sparklines for comparisons, and tabbed sections to organise different categories of results. Make the output visually scannable and dashboard-like rather than plain text or raw tables."
  );
  assert.equal(
    POSITION_CAVEAT,
    " POSITION: position is an impression-weighted average over real impressions, blended across queries, devices and countries. It is not a rank-tracker rank. Deep positions are only recorded when a user actually reaches that part of the results, so values beyond page one rest on sparse data. Treat absolute positions as directional and prefer position deltas between periods when judging change."
  );
  assert.deepEqual(withMeta({ clicks: 3 }, "gsc_example", { days: 7 }), {
    _meta: {
      source: "Google Search Console API (live data)",
      tool: "gsc_example",
      parameters: { days: 7 },
      note: "All numbers in this response come directly from the Google Search Console API. They are exact values, not estimates. Base your analysis only on this data. Do not invent or assume additional context.",
    },
    data: { clicks: 3 },
  });
  assert.equal(withMeta({}, "t", {}, "custom-source", "custom-note")._meta.source, "custom-source");
  assert.equal(withMeta({}, "t", {}, "custom-source", "custom-note")._meta.note, "custom-note");
});

test("auth mode, site resolution, and write-gate messages stay exact", async () => {
  await withEnv({ GSC_AUTH_MODE: undefined }, () => {
    assert.equal(getAuthMode(), "service_account");
  });
  await withEnv({ GSC_AUTH_MODE: "OAuth" }, () => {
    assert.equal(getAuthMode(), "oauth");
  });
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: undefined, GSC_KEY_FILE: undefined }, () => {
    assert.deepEqual(getConfig(), { keyFile: undefined, siteUrls: [] });
  });
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: undefined }, () => {
    assert.throws(
      () => getConfig(),
      /GSC_KEY_FILE environment variable is required in service_account mode\. Set it to the path of your service account JSON key file, or switch to OAuth by setting GSC_AUTH_MODE=oauth\./
    );
  });
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: join(root, "missing-key.json") }, () => {
    assert.throws(() => getConfig(), /Service account key file not found at: /);
  });
  assert.equal(resolveSiteUrl("  sc-domain:example.com  "), "sc-domain:example.com");
  assert.throws(
    () => resolveSiteUrl("  "),
    /site_url is required for this tool\. Pass the exact Search Console property \(for example, https:\/\/example\.com\/ or sc-domain:example\.com\)\./
  );
  await withEnv({ GSC_ACCESS_MODE: "readonly", GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () => {
    assert.throws(() => assertWriteEnabled("Sitemap submission"), (err) => {
      assert.equal(err.message, "Sitemap submission is disabled in readonly mode. Set GSC_ACCESS_MODE=full to enable Google write operations.");
      return true;
    });
  });
  await withEnv({ GSC_ACCESS_MODE: undefined, GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () => {
    assert.throws(() => assertWriteEnabled("URL submission"), (err) => {
      assert.equal(
        err.message,
        "URL submission needs full access, but this install is in read only mode. Set GSC_ACCESS_MODE=full to enable it explicitly. Legacy configuration requires GSC_SCOPES=full and GSC_ENABLE_WRITE=1."
      );
      return true;
    });
  });
  await withEnv({ GSC_ACCESS_MODE: undefined, GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () => {
    assert.throws(() => assertWriteEnabled("URL submission"), (err) => {
      assert.equal(
        err.message,
        "URL submission is disabled by legacy configuration. Set GSC_ACCESS_MODE=full to enable writes, or retain legacy GSC_ENABLE_WRITE=1."
      );
      return true;
    });
  });
});

test("oauth scope lists, callback constants, and credential precedence stay stable", async () => {
  assert.deepEqual(oauth.scopesForTier("readonly"), ["https://www.googleapis.com/auth/webmasters.readonly"]);
  assert.deepEqual(oauth.scopesForTier("full"), [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/webmasters",
    "https://www.googleapis.com/auth/indexing",
  ]);
  assert.equal(oauth.OAUTH_CALLBACK_HOST, "127.0.0.1");
  assert.equal(oauth.OAUTH_CALLBACK_TIMEOUT_MS, 600_000);
  assert.equal(oauth.tokenPath(), oauth.cachedTokenPath());
  const home = mkdtempSync(join(tmpdir(), "gsc-oauth-contract-"));
  const secrets = join(home, "client.json");
  await withEnv(
    {
      GSC_DATA_DIR: join(home, "data"),
      GSC_OAUTH_SECRETS_FILE: undefined,
      GSC_OAUTH_CLIENT_ID: "env-id",
      GSC_OAUTH_CLIENT_SECRET: "env-secret",
    },
    () => {
      assert.equal(oauth.cachedTokenPath(), join(home, "data", "oauth-token.json"));
      assert.deepEqual(oauth.getOAuthConfig(), { clientId: "env-id", clientSecret: "env-secret" });
    }
  );
  writeFileSync(secrets, JSON.stringify({ web: { client_id: "web-id", client_secret: "web-secret" } }));
  await withEnv({ GSC_OAUTH_SECRETS_FILE: secrets, GSC_OAUTH_CLIENT_ID: "env-id", GSC_OAUTH_CLIENT_SECRET: "env-secret" }, () => {
    assert.throws(() => oauth.getOAuthConfig(), /OAuth secrets file must contain a Desktop installed client\./);
  });
  rmSync(home, { recursive: true, force: true });
});

test("date windows end yesterday and the prior window sits immediately before", () => {
  const RealDate = Date;
  const frozen = new RealDate("2026-06-15T12:00:00.000Z");
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(frozen.getTime());
      else super(...args);
    }
    static now() {
      return frozen.getTime();
    }
  };
  try {
    const current = getDateRange(28);
    const prior = getPriorDateRange(28);
    const yesterday = new RealDate(frozen.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    assert.equal(current.endDate, isoDay(yesterday));
    assert.equal(current.startDate, shiftDays(current.endDate, -27));
    assert.equal(prior.endDate, shiftDays(current.startDate, -1));
    assert.equal(prior.startDate, shiftDays(prior.endDate, -27));
    assert.equal(getDateRange(1).startDate, getDateRange(1).endDate);
  } finally {
    global.Date = RealDate;
  }
});

test("fetchAllRows builds the Search Analytics request and maps missing metrics", async () => {
  setInstanceAllowlist(null);
  const calls = [];
  const client = {
    searchanalytics: {
      query: async (args) => {
        calls.push(args);
        if (args.requestBody.startRow === 0) {
          return {
            data: {
              rows: [
                { keys: ["q"], clicks: 2, impressions: 4, ctr: 0.5, position: 3 },
                {},
              ],
            },
          };
        }
        return { data: { rows: [{ keys: ["tail"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] } };
      },
    },
  };
  const rows = await fetchAllRows(
    {
      startDate: "2026-01-01",
      endDate: "2026-01-07",
      dimensions: ["query"],
      dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: "yes" }] }],
      rowLimit: 2,
      type: "image",
    },
    "sc-domain:example.com",
    client
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].siteUrl, "sc-domain:example.com");
  assert.deepEqual(calls[0].requestBody, {
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    dimensions: ["query"],
    dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression: "yes" }] }],
    rowLimit: 2,
    startRow: 0,
    dataState: "all",
    type: "image",
  });
  assert.equal(calls[1].requestBody.startRow, 2);
  assert.equal(Object.hasOwn(calls[1].requestBody, "type"), true);
  const plain = await fetchAllRows(
    { startDate: "2026-01-01", endDate: "2026-01-02", dimensions: ["page"] },
    "https://example.com/",
    {
      searchanalytics: {
        query: async (args) => {
          assert.equal(args.requestBody.rowLimit, 25000);
          assert.equal(args.requestBody.dataState, "all");
          assert.equal(Object.hasOwn(args.requestBody, "type"), false);
          return { data: { rows: [] } };
        },
      },
    }
  );
  assert.deepEqual(plain, []);
  assert.deepEqual(rows[1], { keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 });
  setInstanceAllowlist(null);
});

test("fetchAllRows returns a short final page that lands on the cap", async () => {
  setInstanceAllowlist(null);
  let calls = 0;
  const rows = await fetchAllRows(
    {
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      dimensions: ["query"],
      rowLimit: 2,
      maxTotalRows: 3,
    },
    "sc-domain:example.com",
    {
      searchanalytics: {
        query: async () => {
          calls += 1;
          return {
            data: {
              rows: [
                { keys: ["a"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
                { keys: ["b"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
                { keys: ["c"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
              ].slice(0, calls === 1 ? 2 : 1),
            },
          };
        },
      },
    }
  );
  assert.equal(calls, 2);
  assert.equal(rows.length, 3);
  setInstanceAllowlist(null);
});

const WRITE = { GSC_ACCESS_MODE: undefined, GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" };

test("submitSitemap builds property candidates, default feeds, and failure hints", async () => {
  const calls = [];
  const client = {
    sitemaps: {
      submit: async (request) => {
        calls.push(request);
        if (request.siteUrl === "sc-domain:example.com") throw new Error("domain denied");
      },
    },
  };
  const fallback = await withEnv(WRITE, () => submitSitemap(undefined, "sc-domain:example.com", client));
  assert.deepEqual(calls, [
    { siteUrl: "sc-domain:example.com", feedpath: "https://example.com/sitemap.xml" },
    { siteUrl: "https://example.com/", feedpath: "https://example.com/sitemap.xml" },
  ]);
  assert.equal(fallback.success, true);
  assert.equal(fallback.siteUrl, "https://example.com/");
  assert.equal(fallback.sitemapUrl, "https://example.com/sitemap.xml");
  assert.equal(
    fallback.note,
    "The configured property (sc-domain:example.com) rejected the call, so the URL-prefix property (https://example.com/) was used instead. The results belong to that property, which may differ from the domain property's own sitemap list."
  );

  calls.length = 0;
  const prefix = await withEnv(WRITE, () => submitSitemap(undefined, "https://example.com/", client));
  assert.deepEqual(calls, [{ siteUrl: "https://example.com/", feedpath: "https://example.com/sitemap.xml" }]);
  assert.equal(prefix.success, true);
  assert.equal(prefix.note, undefined);

  const denied = {
    sitemaps: {
      submit: async () => {
        throw new Error("no permission");
      },
    },
  };
  const failed = await withEnv(WRITE, () => submitSitemap("https://cdn.example/map.xml", "sc-domain:example.com", denied));
  assert.equal(failed.success, false);
  assert.equal(failed.siteUrl, "sc-domain:example.com");
  assert.equal(failed.sitemapUrl, "https://cdn.example/map.xml");
  assert.equal(
    failed.error,
    "no permission Tried: sc-domain:example.com, https://example.com/, https://www.example.com/. Check that the authenticated account has sitemap permission on the property in Search Console."
  );

  const gated = await withEnv({ GSC_ACCESS_MODE: "readonly", GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () =>
    submitSitemap(undefined, "sc-domain:example.com", client)
  );
  assert.deepEqual(
    { siteUrl: gated.siteUrl, sitemapUrl: gated.sitemapUrl, success: gated.success },
    { siteUrl: "", sitemapUrl: "", success: false }
  );
});

test("submitUrl and submitBatch build Indexing API arguments and quota notes", async () => {
  const calls = [];
  const client = {
    urlNotifications: {
      publish: async (args) => {
        calls.push(args);
        return { data: { urlNotificationMetadata: { latestUpdate: { notifyTime: "2026-02-02T00:00:00Z" } } } };
      },
    },
  };
  setInstanceAllowlist(null);
  const one = await withEnv(WRITE, () => submitUrl("https://example.com/a", "URL_DELETED", client));
  assert.deepEqual(calls, [{ requestBody: { url: "https://example.com/a", type: "URL_DELETED" } }]);
  assert.equal(one.notifyTime, "2026-02-02T00:00:00Z");
  assert.equal(
    one.note,
    "Google has been notified. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages."
  );
  const failed = await withEnv(WRITE, () =>
    submitUrl("https://example.com/b", "URL_UPDATED", {
      urlNotifications: {
        publish: async () => {
          throw new Error("denied");
        },
      },
    })
  );
  assert.equal(
    failed.note,
    "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console."
  );
  await assert.rejects(
    () => submitBatch(Array.from({ length: 201 }, (_, index) => `https://example.com/${index}`)),
    (err) => {
      assert.equal(
        err.message,
        "Google's Indexing API has a daily quota of 200 requests. You provided 201 URLs. Please reduce to 200 or fewer."
      );
      return true;
    }
  );

  setInstanceAllowlist(["https://example.com/"]);
  calls.length = 0;
  const started = Date.now();
  const batch = await withEnv(WRITE, () =>
    submitBatch(["https://example.com/ok", "https://other.example/no"], "URL_UPDATED", client)
  );
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(calls, [{ requestBody: { url: "https://example.com/ok", type: "URL_UPDATED" } }]);
  assert.equal(batch.results[1].success, false);
  assert.match(batch.results[1].error, /PROPERTY_NOT_ALLOWED/);
  assert.equal(batch.summary.total, 2);
  assert.equal(batch.summary.succeeded, 1);
  assert.equal(batch.summary.failed, 1);
  assert.equal(batch.summary.note, "Daily quota is 200 URL notifications. 1 submitted successfully, 1 failed.");
  setInstanceAllowlist(null);
});

test("image page audit classifies markup and reports the same finding fields", async () => {
  const pageUrl = "https://example.com/gallery";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const html = [
    "<!doctype html><html><head>",
    '<meta name="googlebot" content="max-image-preview:large">',
    '<script type="application/ld+json">{"@type":"ImageObject","license":"https://example.com/license","creditText":"Ada"}</script>',
    '<script type="application/ld+json">{bad</script>',
    "</head><body>",
    '<div style="background-image: url(hero.png)"></div>',
    '<picture><source type="image/avif" srcset="/a.avif"></picture>',
    '<img src="https://cdn.example.net/shutterstock_10.jpg" alt="image" width="800" height="600" loading="lazy">',
    '<img src="/photo-of-harbor.jpg" alt="photo of harbor">',
    '<img data-src="/lazy-subject.jpg" alt="">',
    '<img src="data:image/gif;base64,AAAA" data-src="/real-subject.jpg" alt="A real subject on the page">',
    '<img src="/icons/logo.svg" alt="missing dimensions logo" width="400" height="400">',
    '<img src="/aaaaaaaaaaaaaaaa.jpg" alt="hash name alt text here">',
    '<img src="/same.jpg" alt="shared label">',
    '<img src="/same-two.jpg" alt="shared label">',
    "</body></html>",
  ].join("");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === pageUrl) return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    if (String(url) === "https://cdn.example.net/pixel.png") {
      return new Response(png, { status: 200, headers: { "content-type": "image/png; charset=binary" } });
    }
    return new Response("nope", { status: 404 });
  };
  try {
    setInstanceAllowlist(null);
    const audited = await imagePageAudit(
      [pageUrl, "https://example.com/2", "https://example.com/3", "https://example.com/4", "https://example.com/5", "https://example.com/6"],
      true,
      0,
      20,
      { resolveHost: async () => ["93.184.216.34"] }
    );
    assert.equal(audited.audits.length, 5);
    assert.equal(audited.audits[0].status, "ok");
    const checks = audited.audits[0].page_checks;
    assert.equal(checks.max_image_preview, "large");
    assert.equal(checks.image_object_schema_count, 1);
    assert.equal(checks.has_licensable_fields, true);
    assert.equal(checks.inline_background_images, 1);
    assert.equal(checks.modern_format_sources, true);
    assert.equal(checks.total_img_tags, 8);
    assert.equal(checks.content_images, 7);
    assert.equal(checks.images_fetched, 0);
    assert.equal(audited.audits[0].images_not_reported, 0);
    assert.equal(audited.audits[0].images.length, 7);
    const bySrc = Object.fromEntries(audited.audits[0].images.map((image) => [image.src, image]));
    const stock = bySrc["https://cdn.example.net/shutterstock_10.jpg"];
    assert.equal(stock.alt_status, "generic");
    assert.equal(stock.filename_status, "generic_or_nondescriptive");
    assert.ok(stock.issues.includes("generic alt text"));
    assert.equal(stock.loading, "lazy");
    assert.equal(checks.lcp_candidate_src, stock.src);
    assert.equal(checks.lcp_candidate_lazy_loaded, true);
    assert.ok(audited.audits[0].top_fixes.some((line) => line.includes('loading="lazy"')));
    const named = audited.audits[0].images.find((image) => image.src.endsWith("/photo-of-harbor.jpg"));
    assert.equal(named.alt_status, "filename_as_alt");
    assert.ok(named.issues.includes("no width/height attributes (layout shift)"));
    assert.equal(bySrc["https://example.com/lazy-subject.jpg"].loading, "lazy");
    assert.equal(bySrc["https://example.com/lazy-subject.jpg"].alt_status, "empty");
    assert.equal(bySrc["https://example.com/real-subject.jpg"].loading, "lazy");
    assert.equal(bySrc["https://example.com/aaaaaaaaaaaaaaaa.jpg"].filename_status, "hash_or_id");
    assert.equal(bySrc["https://example.com/same.jpg"].alt_status, "duplicate");
    assert.equal(bySrc["https://example.com/same-two.jpg"].alt_status, "duplicate");
    assert.equal(bySrc["https://example.com/lazy-subject.jpg"].issues.includes("alt attribute missing"), false);
    assert.equal(audited.overall.note, 'empty alt (alt="") is correct for decorative images; it is reported but not counted as an issue.');
    assert.ok(audited.audits[0].top_fixes.some((line) => line.includes("Rewrite alt text")));
    assert.equal(calls.includes("https://example.com/6"), false);

    calls.length = 0;
    const pixelPage = "https://example.com/pixel";
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url) === pixelPage) {
        return new Response(
          '<img src="https://cdn.example.net/pixel.png" alt="A tiny calibration swatch for tests" width="800" height="600">',
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      if (String(url) === "https://cdn.example.net/pixel.png") {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(String(url));
    };
    const pixels = await imagePageAudit([pixelPage], true, 2, 5, { resolveHost: async () => ["93.184.216.34"] });
    const pixel = pixels.audits[0].images[0];
    assert.equal(pixel.fetched, true);
    assert.equal(pixel.format, "image/png");
    assert.equal(pixel.intrinsic_width, 1);
    assert.equal(pixel.intrinsic_height, 1);
    assert.equal(pixel.below_indexing_minimum, true);
    assert.equal(pixel.weight_status, "ok");
    assert.equal(pixel.png_likely_photo, false);
    assert.deepEqual(pixel.metadata, {
      camera_exif_present: false,
      gps_present: false,
      iptc_creator: false,
      iptc_copyright: false,
      iptc_caption: false,
      digital_source_type: null,
    });
    assert.ok(pixel.issues.includes("below Google's ~250x200 indexing minimum"));
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});

test("genai conversation queries aggregate, rank, and timeline the fixture rows", async () => {
  assert.equal(GENAI_MAX_PULL_ROWS, 50_000);
  assert.equal(classifyQuery("  YES. "), "artefact");
  assert.equal(classifyQuery("how about the other plan"), "pivot");
  const calls = [];
  const fetchRows = async (params, siteUrl) => {
    calls.push({ params, siteUrl });
    if (params.dimensions[0] === "date") {
      return [
        { keys: ["2026-01-15"], clicks: 1, impressions: 4, ctr: 0, position: 1 },
        { keys: ["2026-01-20"], clicks: 0, impressions: 2, ctr: 0, position: 1 },
        { keys: ["2025-12-02"], clicks: 0, impressions: 1, ctr: 0, position: 1 },
      ];
    }
    return [
      { keys: ["yes", "https://example.com/a"], clicks: 1, impressions: 4, ctr: 0, position: 2 },
      { keys: ["yes", "https://example.com/b"], clicks: 1, impressions: 6, ctr: 0, position: 8 },
      { keys: ["go on", "https://example.com/a"], clicks: 0, impressions: 0, ctr: 0, position: 1 },
      { keys: ["what about resend", "https://example.com/c"], clicks: 0, impressions: 3, ctr: 0, position: 5 },
      { keys: ["best crm software"], clicks: 9, impressions: 90, ctr: 0.1, position: 2 },
    ];
  };
  const out = await genaiConversationQueries(14, 2, 1, true, "sc-domain:example.com", fetchRows);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.type, "web");
  assert.equal(calls[0].params.rowLimit, 25000);
  assert.equal(calls[0].params.maxTotalRows, 50_000);
  assert.deepEqual(calls[0].params.dimensions, ["query", "page"]);
  assert.equal(calls[0].params.dimensionFilterGroups[0].filters[0].operator, "includingRegex");
  assert.match(calls[0].params.dimensionFilterGroups[0].filters[0].expression, /go on/);
  assert.deepEqual(calls[1].params.dimensions, ["date"]);
  assert.equal(calls[1].params.dimensionFilterGroups[0].filters[0].expression.includes("thank you"), true);
  assert.equal(out.period.startDate < out.period.endDate, true);
  assert.equal(out.summary.artefact.queries, 1);
  assert.equal(out.summary.artefact.impressions, 10);
  assert.equal(out.summary.artefact.clicks, 2);
  assert.equal(out.buckets.artefact.total_matched, 1);
  assert.equal(out.buckets.artefact.rows.length, 1);
  assert.equal(out.buckets.artefact.rows[0].query, "yes");
  assert.equal(out.buckets.artefact.rows[0].ctr, 20);
  assert.equal(out.buckets.artefact.rows[0].position, 5.6);
  assert.deepEqual(out.buckets.artefact.rows[0].top_pages, [
    { page: "https://example.com/b", impressions: 6 },
    { page: "https://example.com/a", impressions: 4 },
  ]);
  assert.equal(out.summary.pivot.queries, 1);
  assert.equal(out.excluded_ordinary_matches, 1);
  assert.equal(out.total_conversation_queries, 2);
  assert.equal(out.total_conversation_impressions, 13);
  assert.deepEqual(out.artefact_timeline_monthly, [
    { month: "2025-12", impressions: 1, clicks: 0 },
    { month: "2026-01", impressions: 6, clicks: 1 },
  ]);
  assert.equal(out.buckets.artefact.meaning.includes("AI-block positions"), true);
  assert.equal(out.what_this_cannot_see.length, 5);
});

test("compatibility manifest records this package instead of another revision", () => {
  const manifest = JSON.parse(readFileSync(join(root, "compatibility-manifest.json"), "utf8"));
  assert.equal(manifest.base.version, "1.0.0");
  assert.equal(manifest.base.package, "@sonnivasquez/gsc-mcp");
  assert.equal(manifest.base.liveToolCount, 29);
  assert.equal("revision" in manifest.base, false);
  assert.equal(JSON.stringify(manifest).includes("426a7c7653b27e595893ed34dc46e329388d08e7"), false);
  assert.equal(JSON.stringify(manifest).includes("2.5.1"), false);
});
