import assert from "node:assert/strict";
import test from "node:test";

const { CANONICAL_TOOLS } = await import("../dist/gsc/tools.js");
const { classifyQuery, genaiConversationQueries, GENAI_MAX_PULL_ROWS } = await import(
  "../dist/tools/genai-conversation-queries.js"
);
const { fetchAllRows } = await import("../dist/analytics.js");
const { setInstanceAllowlist } = await import("../dist/profiles.js");

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

test("legacy contract catalog preserves the original 29 names within the 34-tool catalog", () => {
  assert.equal(CANONICAL_TOOLS.length, 34);
  assert.deepEqual(
    CANONICAL_TOOLS.slice(5).map((t) => t.name),
    EXPECTED_29
  );
  const kinds = new Map(CANONICAL_TOOLS.map((t) => [t.name, t.kind]));
  assert.deepEqual(
    [...kinds.entries()].filter(([, k]) => k === "write").map(([n]) => n).sort(),
    ["gsc_submit_batch", "gsc_submit_sitemap", "gsc_submit_url"]
  );
  assert.equal(kinds.get("gsc_image_page_audit"), "fetch");
  assert.equal(kinds.get("gsc_genai_conversation_queries"), "read");
});

test("classifyQuery covers every bucket plus ordinary queries", () => {
  assert.equal(classifyQuery("yes"), "artefact");
  assert.equal(classifyQuery("Go on!"), "artefact");
  assert.equal(classifyQuery("what about resend"), "pivot");
  assert.equal(classifyQuery("please help me fix my sitemap"), "conversational");
  assert.equal(classifyQuery("is it worth migrating"), "conversational");
  assert.equal(
    classifyQuery("why does my sitemap show errors in search console every single day now"),
    "conversational"
  );
  assert.equal(
    classifyQuery("best crm for startups. my location is Berlin."),
    "tracker_probe"
  );
  assert.equal(classifyQuery("evaluate the acme on pricing"), "tracker_probe");
  assert.equal(
    classifyQuery("search the web for best crm do not invent results"),
    "agent_harness"
  );
  assert.equal(
    classifyQuery("return the 10 most relevant sources include source urls"),
    "agent_harness"
  );
  assert.equal(classifyQuery("a,b,c,d,e,f"), "pasted_string");
  assert.equal(
    classifyQuery("has been captured for this url prefix"),
    "pasted_string"
  );
  assert.equal(
    classifyQuery("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda"),
    "long_uncategorised"
  );
  assert.equal(classifyQuery("best crm software"), null);
});

test("genaiConversationQueries runs bounded on fixtures with include_timeline:false", async () => {
  const fixture = [
    { keys: ["yes", "https://example.com/a"], clicks: 0, impressions: 5, ctr: 0, position: 3 },
    { keys: ["what about resend", "https://example.com/b"], clicks: 1, impressions: 10, ctr: 0.1, position: 4 },
    { keys: ["please help me fix my sitemap", "https://example.com/c"], clicks: 0, impressions: 2, ctr: 0, position: 5 },
    { keys: ["best crm software", "https://example.com/d"], clicks: 5, impressions: 50, ctr: 0.1, position: 2 },
  ];
  const calls = [];
  const fetchRows = async (params, siteUrl) => {
    calls.push({ params, siteUrl });
    return fixture;
  };
  const out = await genaiConversationQueries(7, 1, 50, false, "sc-domain:example.com", fetchRows);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.dimensions, ["query", "page"]);
  assert.equal(calls[0].siteUrl, "sc-domain:example.com");
  assert.equal(out.summary.artefact.queries, 1);
  assert.equal(out.summary.pivot.queries, 1);
  assert.equal(out.summary.conversational.queries, 1);
  assert.equal(out.total_conversation_queries, 3);
  assert.equal(out.excluded_ordinary_matches, 1);
  assert.equal(out.artefact_timeline_monthly, undefined);
  assert.equal(out.buckets.artefact.rows[0].query, "yes");
  assert.deepEqual(out.buckets.artefact.rows[0].top_pages, [
    { page: "https://example.com/a", impressions: 5 },
  ]);
});

test("genaiConversationQueries fails closed over the 50k pull cap (injected seam)", async () => {
  assert.equal(GENAI_MAX_PULL_ROWS, 50_000);
  const big = Array.from({ length: 50_001 }, (_, i) => ({
    keys: ["yes", `https://example.com/${i}`],
    clicks: 0,
    impressions: 1,
    ctr: 0,
    position: 3,
  }));
  const fetchRows = async () => big;
  await assert.rejects(
    genaiConversationQueries(7, 1, 50, false, "sc-domain:example.com", fetchRows),
    /REQUEST_BUDGET_EXCEEDED/
  );
});

test("fetchAllRows aborts at maxTotalRows without fetching a third page", async () => {
  setInstanceAllowlist(null);
  const page = (n) =>
    Array.from({ length: n }, (_, i) => ({
      keys: [`q${i}`, "https://example.com/a"],
      clicks: 0,
      impressions: 1,
      ctr: 0,
      position: 5,
    }));
  let calls = 0;
  const fake = {
    searchanalytics: {
      query: async ({ requestBody }) => {
        calls++;
        const startRow = requestBody.startRow ?? 0;
        if (startRow === 0) return { data: { rows: page(25000) } };
        if (startRow === 25000) return { data: { rows: page(25000) } };
        return { data: { rows: page(1) } };
      },
    },
  };
  await assert.rejects(
    fetchAllRows(
      {
        startDate: "2026-08-01",
        endDate: "2026-08-28",
        dimensions: ["query"],
        rowLimit: 25000,
        maxTotalRows: 50_000,
      },
      "sc-domain:example.com",
      fake
    ),
    /REQUEST_BUDGET_EXCEEDED/
  );
  assert.equal(calls, 2);
  setInstanceAllowlist(null);
});
