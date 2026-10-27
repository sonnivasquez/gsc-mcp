import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { GUARDRAIL_SUFFIX, VISUAL_SUFFIX, POSITION_CAVEAT, withMeta } from "./guardrails.js";
import { CLI_VERSION } from "./version.js";
import type { ServeOpts } from "./cli.js";
import {
  gscCapabilities,
  gscListSites,
  gscSearchAnalytics,
  gscInspectUrls,
  gscListSitemaps,
  gscGetDataset,
  gscPerformanceOverview,
  gscComparePeriods,
  gscPageQueries,
  gscQueryPages,
  gscFindOpportunities,
  gscDetectCannibalization,
  gscAnalyzeSegments,
  gscExportDataset,
  gscAnalyzeTrafficDrop,
  gscContentDecay,
  gscCheckAlerts,
  gscContentCandidates,
  gscContentRecommendations,
  gscMultiSiteOverview,
  gscGenerateReport,
  gscVerifyClaim,
  gscCompareWebImage,
} from "./gsc/tools.js";
import { registerPrompts } from "./gsc/prompts.js";
import { submitUrl, submitBatch } from "./tools/submit-url.js";
import { submitSitemap } from "./tools/submit-sitemap.js";
import { genaiConversationQueries } from "./tools/genai-conversation-queries.js";
import { imagePageAudit } from "./tools/image-page-audit.js";
import { checkUpdateImpact } from "./tools/update-impact.js";
import { toolDescription } from "./tool-descriptions.js";

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const described = (label: string) => z.string().describe(label);
function indexingAction() {
  return z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe(
    phrase([
      "URL_UPDATED for new/changed content, ",
      "URL_DELETED for removed pages",
    ]),
  );
}

const IMAGE_SOURCE = phrase([
  "Live fetch of the audited pages ",
  "(the user's own site)",
]);

const IMAGE_NOTE = phrase([
  "All findings come from fetching and ",
  "parsing the listed pages and image ",
  "files at call time. Alt text, ",
  "attributes, bytes, and dimensions ",
  "are read values, not estimates. Base ",
  "your analysis only on this data. An ",
  "empty alt (alt=\"\") is correct for ",
  "decorative images; do not report it ",
  "as a defect.",
]);

export async function serve(opts: ServeOpts): Promise<void> {
  const server = new McpServer({ name: "gsc-mcp", version: CLI_VERSION });
  registerPrompts(server);

  server.tool(
    "gsc_submit_url",
    toolDescription("gsc_submit_url", GUARDRAIL_SUFFIX),
    {
      url: described("The full URL to submit for indexing"),
      action: indexingAction(),
    },
    async ({ url, action }) => textResult(await submitUrl(url, action)),
  );

  server.tool(
    "gsc_submit_batch",
    toolDescription("gsc_submit_batch", GUARDRAIL_SUFFIX),
    {
      urls: z.array(z.string()).describe(
        phrase(["Array of URLs to submit ", "(max 200)"]),
      ),
      action: indexingAction(),
    },
    async ({ urls, action }) => textResult(await submitBatch(urls, action)),
  );

  server.tool(
    "gsc_submit_sitemap",
    toolDescription("gsc_submit_sitemap", GUARDRAIL_SUFFIX),
    {
      sitemap_url: z.string().optional().describe(
        phrase(["Full sitemap URL (defaults to ", "{site_url}/sitemap.xml)"]),
      ),
      site_url: z.string().min(1).describe("GSC property to submit the sitemap for"),
    },
    async ({ sitemap_url, site_url }) => textResult(await submitSitemap(sitemap_url, site_url)),
  );

  server.tool(
    "gsc_genai_conversation_queries",
    toolDescription("gsc_genai_conversation_queries", GUARDRAIL_SUFFIX + VISUAL_SUFFIX + POSITION_CAVEAT),
    {
      days: z.number().default(480).describe(
        phrase(["Days to analyse (default 480, the ", "full 16 months GSC retains)"]),
      ),
      min_impressions: z.number().default(1).describe(
        phrase([
          "Minimum impressions for a query to ",
          "be listed (single-impression rows ",
          "are evidence, not noise, so the ",
          "default keeps them)",
        ]),
      ),
      max_rows_per_bucket: z.number().default(50).describe(
        phrase(["Maximum rows returned per bucket; ", "totals always cover everything"]),
      ),
      include_timeline: z.boolean().default(true).describe(
        phrase(["Include the monthly artefact ", "timeline (one extra API call)"]),
      ),
      site_url: z.string().min(1).describe(
        phrase(["GSC property to query ", "(e.g. sc-domain:example.com)"]),
      ),
    },
    async (input) => {
      const days = input.days;
      const min_impressions = input.min_impressions;
      const max_rows_per_bucket = input.max_rows_per_bucket;
      const include_timeline = input.include_timeline;
      const site_url = input.site_url;
      const results = await genaiConversationQueries(
        days,
        min_impressions,
        max_rows_per_bucket,
        include_timeline,
        site_url,
      );
      return textResult(withMeta(results, "gsc_genai_conversation_queries", {
        days,
        min_impressions,
        max_rows_per_bucket,
        include_timeline,
        site_url,
      }));
    },
  );

  server.tool(
    "gsc_image_page_audit",
    toolDescription("gsc_image_page_audit", GUARDRAIL_SUFFIX + VISUAL_SUFFIX),
    {
      urls: z.array(z.string()).min(1).max(5).describe(
        phrase(["Page URLs to audit ", "(1-5, from your own site)"]),
      ),
      fetch_metadata: z.boolean().default(true).describe(
        phrase(["Also read EXIF/IPTC/XMP metadata ", "from the image files"]),
      ),
      max_images_per_page: z.number().default(12).describe(
        phrase([
          "Maximum images fetched and weighed ",
          "per page (HTML checks still cover ",
          "all images)",
        ]),
      ),
      max_images_reported: z.number().default(20).describe(
        phrase(["Maximum per-image rows ", "returned per page"]),
      ),
    },
    async (input) => {
      const urls = input.urls;
      const fetch_metadata = input.fetch_metadata;
      const max_images_per_page = input.max_images_per_page;
      const max_images_reported = input.max_images_reported;
      const results = await imagePageAudit(
        urls,
        fetch_metadata,
        max_images_per_page,
        max_images_reported,
      );
      return textResult(withMeta(
        results,
        "gsc_image_page_audit",
        {
          urls,
          fetch_metadata,
          max_images_per_page,
          max_images_reported,
        },
        IMAGE_SOURCE,
        IMAGE_NOTE,
      ));
    },
  );

  server.tool(
    "gsc_capabilities",
    toolDescription("gsc_capabilities"),
    {},
    async () => textResult(gscCapabilities()),
  );

  server.tool(
    "gsc_list_sites",
    toolDescription("gsc_list_sites"),
    {},
    async () => textResult(await gscListSites()),
  );

  server.tool(
    "gsc_search_analytics",
    toolDescription("gsc_search_analytics"),
    {
      siteUrl: described("Exact GSC property identifier"),
      startDate: described("Inclusive start, YYYY-MM-DD"),
      endDate: described("Inclusive end, YYYY-MM-DD"),
      dimensions: z.array(z.string()).describe("Subset of date, page, query, country, device"),
      filters: z.array(z.object({
        dimension: z.string(),
        operator: z.string(),
        expression: z.string(),
      })).optional(),
      searchType: z.string().optional().describe(
        phrase(["web, image, video, news, discover, ", "googleNews (default web)"]),
      ),
      dataState: z.string().optional().describe("final or all (default final)"),
      sortBy: z.string().optional().describe(
        phrase(["clicks, impressions, ctr, position ", "(default clicks)"]),
      ),
      sortDirection: z.string().optional().describe("asc or desc (default desc)"),
      resultLimit: z.number().optional().describe("Rows returned, 1-200 (default 50)"),
      maxFetchRows: z.number().optional().describe("Rows retrieved, 1-50000 (default 5000)"),
    },
    async (args) => textResult(await gscSearchAnalytics(args)),
  );

  server.tool(
    "gsc_inspect_urls",
    toolDescription("gsc_inspect_urls"),
    {
      siteUrl: described("Exact GSC property identifier"),
      urls: z.array(z.string()).min(1).max(10),
      languageCode: z.string().optional(),
    },
    async (args) => textResult(await gscInspectUrls(args)),
  );

  server.tool(
    "gsc_list_sitemaps",
    toolDescription("gsc_list_sitemaps"),
    { siteUrl: described("Exact GSC property identifier") },
    async (args) => textResult(await gscListSitemaps(args.siteUrl)),
  );

  server.tool(
    "gsc_get_dataset",
    toolDescription("gsc_get_dataset"),
    {
      datasetId: described("Dataset identifier from a previous tool response"),
      cursor: z.string().optional().describe("Opaque cursor from a previous page"),
      limit: z.number().optional().describe("Rows per page, 1-200 (default 50)"),
      columns: z.array(z.string()).optional().describe("Subset of the dataset columns"),
    },
    async (args) => textResult(await gscGetDataset(args)),
  );

  server.tool(
    "gsc_performance_overview",
    toolDescription("gsc_performance_overview"),
    {
      siteUrl: described("Exact GSC property identifier"),
      preset: z.string().optional().describe("last_7_days, last_28_days, last_90_days"),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      searchType: z.string().optional(),
      dataState: z.string().optional(),
      includeTimeline: z.boolean().optional(),
      includeComparison: z.boolean().optional(),
      baseline: z.string().optional().describe("previous_period, previous_year, or omitted"),
    },
    async (args) => textResult(await gscPerformanceOverview(args)),
  );

  server.tool(
    "gsc_compare_periods",
    toolDescription("gsc_compare_periods"),
    {
      siteUrl: described("Exact GSC property identifier"),
      dimension: described("page, query, country, device or none"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      baseline: z.string().optional().describe("previous_period (default), previous_year"),
      orderBy: z.string().optional(),
      sortDirection: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscComparePeriods(args)),
  );

  server.tool(
    "gsc_page_queries",
    toolDescription("gsc_page_queries"),
    {
      siteUrl: described("Exact GSC property identifier"),
      pageUrl: z.string(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscPageQueries(args)),
  );

  server.tool(
    "gsc_query_pages",
    toolDescription("gsc_query_pages"),
    {
      siteUrl: described("Exact GSC property identifier"),
      query: z.string(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscQueryPages(args)),
  );

  server.tool(
    "gsc_find_opportunities",
    toolDescription("gsc_find_opportunities"),
    {
      siteUrl: described("Exact GSC property identifier"),
      kind: z.string(),
      dimension: z.string().optional().describe("query or page (default query)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minImpressions: z.number().optional(),
      minPosition: z.number().optional(),
      maxPosition: z.number().optional(),
      maxCtr: z.number().optional(),
      targetCtr: z.number().optional().describe("Only then a conditional click scenario is computed"),
      minBaseClicks: z.number().optional(),
      minDeclinePct: z.number().optional(),
      windowDays: z.number().optional(),
      maxClicks: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscFindOpportunities(args)),
  );

  server.tool(
    "gsc_detect_cannibalization",
    toolDescription("gsc_detect_cannibalization"),
    {
      siteUrl: described("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minPages: z.number().optional(),
      minImpressionsPerPage: z.number().optional(),
      minSharePct: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscDetectCannibalization(args)),
  );

  server.tool(
    "gsc_analyze_segments",
    toolDescription("gsc_analyze_segments"),
    {
      siteUrl: described("Exact GSC property identifier"),
      segments: z.array(z.object({
        id: z.string(),
        label: z.string(),
        brandTerms: z.array(z.string()).optional(),
        pathPrefix: z.string().optional(),
        country: z.string().optional(),
        device: z.string().optional(),
      })).min(1).max(10),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscAnalyzeSegments(args)),
  );

  server.tool(
    "gsc_export_dataset",
    toolDescription("gsc_export_dataset"),
    {
      datasetId: z.string(),
      format: described("json, csv or markdown"),
      name: z.string().optional(),
    },
    async (args) => textResult(await gscExportDataset(args)),
  );

  server.tool(
    "gsc_analyze_traffic_drop",
    toolDescription("gsc_analyze_traffic_drop"),
    {
      siteUrl: described("Exact GSC property identifier"),
      dimension: z.string().optional().describe("page or query (default page)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      baseline: z.string().optional(),
      minAbsLoss: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscAnalyzeTrafficDrop(args)),
  );

  server.tool(
    "gsc_content_decay",
    toolDescription("gsc_content_decay"),
    {
      siteUrl: described("Exact GSC property identifier"),
      dimension: z.string().optional().describe("page or query (default page)"),
      searchType: z.string().optional().describe("web or image (default web)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      windowDays: z.number().optional(),
      minBaseClicks: z.number().optional(),
      minDeclinePct: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscContentDecay(args)),
  );

  server.tool(
    "gsc_check_alerts",
    toolDescription("gsc_check_alerts"),
    {
      siteUrl: described("Exact GSC property identifier"),
      dimension: z.string().optional().describe("page or query (default page)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      baseline: z.string().optional(),
      minClickLoss: z.number().optional(),
      ctrDropPpMin: z.number().optional(),
      positionWorseByMin: z.number().optional(),
      disappearedMinClicks: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscCheckAlerts(args)),
  );

  server.tool(
    "gsc_content_candidates",
    toolDescription("gsc_content_candidates"),
    {
      siteUrl: described("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minImpressions: z.number().optional(),
      minPosition: z.number().optional(),
      maxExpand: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscContentCandidates(args)),
  );

  server.tool(
    "gsc_content_recommendations",
    toolDescription("gsc_content_recommendations"),
    {
      siteUrl: described("Exact GSC property identifier"),
      categories: z.array(z.string()).optional(),
      maxRecommendations: z.number().optional(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscContentRecommendations(args)),
  );

  server.tool(
    "gsc_multi_site_overview",
    toolDescription("gsc_multi_site_overview"),
    {
      sites: z.array(z.string()).min(1).max(5),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      includeComparison: z.boolean().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscMultiSiteOverview(args)),
  );

  server.tool(
    "gsc_generate_report",
    toolDescription("gsc_generate_report"),
    {
      siteUrl: z.string().optional(),
      sites: z.array(z.string()).optional(),
      sections: z.array(z.string()).optional(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      save: z.boolean().optional(),
    },
    async (args) => textResult(await gscGenerateReport(args)),
  );

  server.tool(
    "gsc_verify_claim",
    toolDescription("gsc_verify_claim"),
    {
      metric: z.string(),
      value: z.number(),
      siteUrl: described("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      searchType: z.string().optional(),
      dataState: z.string().optional(),
      toleranceAbs: z.number().optional(),
      toleranceRel: z.number().optional(),
      compareWithBaseline: z.boolean().optional(),
    },
    async (args) => textResult(await gscVerifyClaim(args)),
  );

  server.tool(
    "gsc_compare_web_image",
    toolDescription("gsc_compare_web_image"),
    {
      siteUrl: described("Exact GSC property identifier"),
      dimension: z.string().optional().describe("query or page (default query)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => textResult(await gscCompareWebImage(args)),
  );

  server.tool(
    "gsc_check_update_impact",
    toolDescription("gsc_check_update_impact"),
    {
      siteUrl: described("Exact GSC property identifier"),
      preset: z.string().optional().describe(
        phrase([
          "last_7_days, last_28_days, ",
          "last_90_days (default last_28_days ",
          "when no explicit dates)",
        ]),
      ),
      startDate: z.string().optional().describe("Inclusive start, YYYY-MM-DD"),
      endDate: z.string().optional().describe("Inclusive end, YYYY-MM-DD"),
      baseline: z.string().optional().describe("previous_period (default), previous_year"),
      updateType: z.enum(["all", "core", "spam", "reviews"]).optional().describe(
        "Ranking-update family (default all)",
      ),
      dimension: z.string().optional().describe("page or query (default page)"),
      minAbsLoss: z.number().optional().describe(
        phrase(["Minimum absolute click loss per ", "key (default 10)"]),
      ),
      resultLimit: z.number().optional().describe("Overlaps returned, 1-200 (default 10)"),
      maxFetchRows: z.number().optional().describe(
        phrase(["Rows retrieved per GSC window, ", "1-50000 (default 5000)"]),
      ),
    },
    async (args) => textResult(await checkUpdateImpact(args)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const profile = opts.profile ?? "default(env)";
  console.error(phrase(["GSC MCP server v", CLI_VERSION, " running on stdio (profile: ", profile, ")"]));
}
