import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TEST_TIMEOUT_MS, withMcpClient } from "./helpers/mcp-client.mjs";

test("resolveSiteUrl requires an explicit property and trims it", async () => {
  process.env.GSC_AUTH_MODE = "oauth";
  process.env.GSC_SITE_URLS = "sc-domain:first.example, https://second.example/";

  const { getConfig, resolveSiteUrl } = await import("../dist/auth.js");

  assert.equal(resolveSiteUrl("  https://selected.example/  "), "https://selected.example/");
  assert.throws(() => resolveSiteUrl(), /site_url is required/);
  assert.throws(() => resolveSiteUrl("   "), /site_url is required/);
  assert.deepEqual(getConfig().siteUrls, ["sc-domain:first.example", "https://second.example/"]);
  assert.ok(!("siteUrl" in getConfig()));
});

test("submitSitemap sends the selected property to the Sitemaps API", async () => {
  const calls = [];
  const fakeClient = {
    sitemaps: {
      submit: async (request) => {
        calls.push(request);
      },
    },
  };
  const { submitSitemap } = await import("../dist/tools/submit-sitemap.js");

  process.env.GSC_SCOPES = "full";
  process.env.GSC_ENABLE_WRITE = "1";
  try {
    await submitSitemap("https://selected.example/sitemap.xml", "sc-domain:selected.example", fakeClient);
  } finally {
    delete process.env.GSC_SCOPES;
    delete process.env.GSC_ENABLE_WRITE;
  }

  assert.deepEqual(calls, [{ siteUrl: "sc-domain:selected.example", feedpath: "https://selected.example/sitemap.xml" }]);
});
test("every Search Console property-bound MCP tool exposes a property selector", { timeout: MCP_TEST_TIMEOUT_MS }, async () => {
  await withMcpClient({
    name: "multi-site-contract-test",
    env: { GSC_SITE_URLS: "sc-domain:first.example,https://second.example/" },
  }, async (client, options) => {
    const { tools } = await client.listTools(undefined, options);

    const names = new Set(tools.map((tool) => tool.name));
    const schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema.properties ?? {}]));

    // Extended public catalog retains all original tools.
    assert.equal(tools.length, 34);

    // The 24 retired equivalents must be gone from the public registry.
    const retired = [
      "quick_wins", "ctr_opportunities", "traffic_drops", "content_gaps",
      "site_snapshot", "inspect_url", "cannibalization_check", "content_decay",
      "topic_cluster_performance", "ctr_vs_benchmark", "verify_claim",
      "advanced_search_analytics", "check_alerts", "content_recommendations",
      "generate_report", "multi_site_dashboard", "list_sitemaps",
      "image_keyword_overview", "image_search_quick_wins", "compare_web_vs_image",
      "image_pages_overview", "image_keyword_trends", "image_impressions_no_clicks",
      "image_content_decay",
    ];
    assert.equal(retired.length, 24);
    for (const name of retired) {
      assert.ok(!names.has(name), `${name} must not be publicly registered`);
    }

    // Write ops keep their legacy schemas unchanged (out of the readonly edition's scope).
    const legacyWrite = new Set(["gsc_submit_url", "gsc_submit_batch", "gsc_submit_sitemap"]);
    const canonicalWithSite = new Set(["gsc_page_audit", "gsc_indexing_audit", "gsc_internal_link_audit", "gsc_change_impact", "gsc_search_analytics", "gsc_inspect_urls", "gsc_list_sitemaps", "gsc_performance_overview", "gsc_compare_periods", "gsc_page_queries", "gsc_query_pages", "gsc_find_opportunities", "gsc_detect_cannibalization", "gsc_analyze_segments", "gsc_analyze_traffic_drop", "gsc_content_decay", "gsc_check_alerts", "gsc_content_candidates", "gsc_content_recommendations", "gsc_verify_claim", "gsc_compare_web_image", "gsc_check_update_impact"]);
    for (const tool of tools) {
      const properties = schemas.get(tool.name);
      const required = new Set(tool.inputSchema.required ?? []);
      if (tool.name === "gsc_migration_audit") {
        assert.ok(required.has("sourceSiteUrl") && required.has("targetSiteUrl"));
      } else if (tool.name === "gsc_multi_site_overview") {
        assert.ok("sites" in properties, `${tool.name} must expose sites`);
      } else if (canonicalWithSite.has(tool.name)) {
        assert.ok("siteUrl" in properties, `${tool.name} must expose siteUrl`);
        assert.ok(required.has("siteUrl"), `${tool.name} must require siteUrl`);
      } else if (tool.name === "gsc_submit_sitemap" || tool.name === "gsc_genai_conversation_queries") {
        assert.ok("site_url" in properties, `${tool.name} keeps its legacy site_url`);
        assert.ok(required.has("site_url"), `${tool.name} keeps it required`);
      } else if (tool.name === "gsc_submit_url" || tool.name === "gsc_submit_batch") {
        assert.ok(!required.has("siteUrl"), `${tool.name} must not require siteUrl`);
      } else {
        assert.ok(!required.has("siteUrl"), `${tool.name} must not require siteUrl`);
        assert.ok(!required.has("site_url"), `${tool.name} must not require site_url`);
      }
    }
  });
});
