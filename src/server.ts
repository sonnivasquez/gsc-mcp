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
// v2.4 generative AI tools — the Generative AI report has no API, but AI Mode
// conversation exhaust leaks into the regular query dimension. See the tool
// file for the mechanism and sources.
import { genaiConversationQueries } from "./tools/genai-conversation-queries.js";
// v2.5: the bridge from "which pages fail in image search" to "why". Fetches
// the user's own pages and audits the on-page image factors.
import { imagePageAudit } from "./tools/image-page-audit.js";
// Update impact: correlate a traffic-drop window with confirmed Google
// ranking updates from the public Search Status Dashboard. Coincidence
// only, never causal attribution.
import { checkUpdateImpact } from "./tools/update-impact.js";

export async function serve(opts: ServeOpts): Promise<void> {
  const server = new McpServer({
    name: "gsc-mcp",
    version: CLI_VERSION,
  });

  registerPrompts(server);

  // 17. Submit URL for Indexing
  server.tool(
    "gsc_submit_url",
    "Submit a URL to Google's Indexing API to request crawling and indexing. Works for notifying Google of new or updated content. Note: Google officially supports this for JobPosting/BroadcastEvent schema but processes all page types." + GUARDRAIL_SUFFIX,
    {
      url: z.string().describe("The full URL to submit for indexing"),
      action: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe("URL_UPDATED for new/changed content, URL_DELETED for removed pages"),
    },
    async ({ url, action }) => {
      const results = await submitUrl(url, action);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // 18. Batch Submit URLs
  server.tool(
    "gsc_submit_batch",
    "Submit up to 200 URLs to Google's Indexing API in one go. Daily quota is 200 URL notifications. Use for bulk indexing requests after publishing multiple pages or a site-wide update." + GUARDRAIL_SUFFIX,
    {
      urls: z.array(z.string()).describe("Array of URLs to submit (max 200)"),
      action: z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe("URL_UPDATED for new/changed content, URL_DELETED for removed pages"),
    },
    async ({ urls, action }) => {
      const results = await submitBatch(urls, action);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // 19. Submit Sitemap
  server.tool(
    "gsc_submit_sitemap",
    "Notify Google of a new or updated sitemap. Triggers Google to recrawl the sitemap and discover new pages." + GUARDRAIL_SUFFIX,
    {
      sitemap_url: z.string().optional().describe("Full sitemap URL (defaults to {site_url}/sitemap.xml)"),
      site_url: z.string().min(1).describe("GSC property to submit the sitemap for"),
    },
    async ({ sitemap_url, site_url }) => {
      const results = await submitSitemap(sitemap_url, site_url);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // v2.3 IMAGE SEO TOOLS
  //
  // These tools all pass type=image to the GSC Search Analytics API, which most
  // third-party tools never expose. Paired with the base project's Image SEO
  // technical guide (see NOTICE). All 7 reuse the existing fetchAllRows
  // plumbing; the only meaningfully new logic is the join in compare_web_vs_image.
  // ---------------------------------------------------------------------------

  // 28. Generative AI Conversation Queries
  server.tool(
    "gsc_genai_conversation_queries",
    "Surface AI-conversation exhaust hiding in your regular query data: bare replies to Google's AI ('yes', 'go on'), 'what about X' pivot follow-ups, conversational questions, AI-visibility tracker probes, and full agent prompts logged as queries. Google counts every AI Mode follow-up as a new query and folds AI Mode/AI Overviews into the web search type, so these fragments carry real impressions, positions and clicks. The dedicated Generative AI report has no query dimension; this is the only query-level AI evidence available anywhere. Classifies every match into seven buckets with landing pages, plus a monthly timeline showing when reply-artefacts first appeared on your site. Treat probe and harness buckets as machine traffic, not demand. Pulls abort over 50k rows per request." + GUARDRAIL_SUFFIX + VISUAL_SUFFIX + POSITION_CAVEAT,
    {
      days: z.number().default(480).describe("Days to analyse (default 480, the full 16 months GSC retains)"),
      min_impressions: z.number().default(1).describe("Minimum impressions for a query to be listed (single-impression rows are evidence, not noise, so the default keeps them)"),
      max_rows_per_bucket: z.number().default(50).describe("Maximum rows returned per bucket; totals always cover everything"),
      include_timeline: z.boolean().default(true).describe("Include the monthly artefact timeline (one extra API call)"),
      site_url: z.string().min(1).describe("GSC property to query (e.g. sc-domain:example.com)"),
    },
    async ({ days, min_impressions, max_rows_per_bucket, include_timeline, site_url }) => {
      const results = await genaiConversationQueries(days, min_impressions, max_rows_per_bucket, include_timeline, site_url);
      const wrapped = withMeta(results, "gsc_genai_conversation_queries", { days, min_impressions, max_rows_per_bucket, include_timeline, site_url });
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );

  // 29. Image Page Audit
  server.tool(
    "gsc_image_page_audit",
    "Fetches pages from YOUR OWN site and audits every image on them for the on-page factors that drive image-search performance: missing/empty/generic/duplicate alt text, non-descriptive filenames, missing width/height attributes, lazy loading on the LCP candidate, srcset coverage, file format and weight, intrinsic dimensions vs Google's ~250x200 indexing minimum, ImageObject and licensable schema, max-image-preview, inline background images, and the metadata inside the image files (camera EXIF and GPS that should be stripped, IPTC Creator/Copyright/Caption that should survive, XMP DigitalSourceType on AI-generated images). Feed it URLs straight from image_impressions_no_clicks or image_search_quick_wins to turn 'which pages fail' into 'why they fail'. Only fetches the URLs given; no third-party service involved. Pages must belong to the instance allowlist and every fetch stays on public hosts with redirects revalidated (images may come from any public CDN host). Returns a per-image findings table, page-level checks, and an ordered top_fixes list." + GUARDRAIL_SUFFIX + VISUAL_SUFFIX,
    {
      urls: z.array(z.string()).min(1).max(5).describe("Page URLs to audit (1-5, from your own site)"),
      fetch_metadata: z.boolean().default(true).describe("Also read EXIF/IPTC/XMP metadata from the image files"),
      max_images_per_page: z.number().default(12).describe("Maximum images fetched and weighed per page (HTML checks still cover all images)"),
      max_images_reported: z.number().default(20).describe("Maximum per-image rows returned per page"),
    },
    async ({ urls, fetch_metadata, max_images_per_page, max_images_reported }) => {
      const results = await imagePageAudit(urls, fetch_metadata, max_images_per_page, max_images_reported);
      const wrapped = withMeta(
        results,
        "gsc_image_page_audit",
        { urls, fetch_metadata, max_images_per_page, max_images_reported },
        "Live fetch of the audited pages (the user's own site)",
        "All findings come from fetching and parsing the listed pages and image files at call time. Alt text, attributes, bytes, and dimensions are read values, not estimates. Base your analysis only on this data. An empty alt (alt=\"\") is correct for decorative images; do not report it as a defect."
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );

  // --- Canonical gsc_* tools (readonly core; envelope contract v1.0) ---

  server.tool(
    "gsc_capabilities",
    "What this server can do: tools, auth state, limits and instance allowlist. Works offline, no credentials needed.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(gscCapabilities(), null, 2) }],
    })
  );

  server.tool(
    "gsc_list_sites",
    "GSC properties visible to this instance. Preserves the exact siteUrl identifier.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await gscListSites(), null, 2) }],
    })
  );

  server.tool(
    "gsc_search_analytics",
    "Flexible performance query with explicit coverage. Sort applies to the retrieved dataset, not to all Google data.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      startDate: z.string().describe("Inclusive start, YYYY-MM-DD"),
      endDate: z.string().describe("Inclusive end, YYYY-MM-DD"),
      dimensions: z.array(z.string()).describe("Subset of date, page, query, country, device"),
      filters: z.array(z.object({ dimension: z.string(), operator: z.string(), expression: z.string() })).optional(),
      searchType: z.string().optional().describe("web, image, video, news, discover, googleNews (default web)"),
      dataState: z.string().optional().describe("final or all (default final)"),
      sortBy: z.string().optional().describe("clicks, impressions, ctr, position (default clicks)"),
      sortDirection: z.string().optional().describe("asc or desc (default desc)"),
      resultLimit: z.number().optional().describe("Rows returned, 1-200 (default 50)"),
      maxFetchRows: z.number().optional().describe("Rows retrieved, 1-50000 (default 5000)"),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscSearchAnalytics(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_inspect_urls",
    "Index inspection for 1-10 URLs. Per-URL results in input order; one failure never discards the successes.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      urls: z.array(z.string()).min(1).max(10),
      languageCode: z.string().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscInspectUrls(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_list_sitemaps",
    "Registered sitemaps and their reported states. Readonly; never submits.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscListSitemaps(args.siteUrl), null, 2) }],
    })
  );

  server.tool(
    "gsc_get_dataset",
    "Page through a previous result with zero new Google calls. Datasets expire after 15 minutes and never cross profiles.",
    {
      datasetId: z.string().describe("Dataset identifier from a previous tool response"),
      cursor: z.string().optional().describe("Opaque cursor from a previous page"),
      limit: z.number().optional().describe("Rows per page, 1-200 (default 50)"),
      columns: z.array(z.string()).optional().describe("Subset of the dataset columns"),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscGetDataset(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_performance_overview",
    "Totals, timeline and optional comparison for a site. Totals come from the aggregate row, never from summing a top.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      preset: z.string().optional().describe("last_7_days, last_28_days, last_90_days"),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      searchType: z.string().optional(),
      dataState: z.string().optional(),
      includeTimeline: z.boolean().optional(),
      includeComparison: z.boolean().optional(),
      baseline: z.string().optional().describe("previous_period, previous_year, or omitted"),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscPerformanceOverview(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_compare_periods",
    "Deterministic period comparison. Absent keys stay in their own blocks, never as zeros.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      dimension: z.string().describe("page, query, country, device or none"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      baseline: z.string().optional().describe("previous_period (default), previous_year"),
      orderBy: z.string().optional(),
      sortDirection: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscComparePeriods(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_page_queries",
    "Observed queries for one exact page URL. No title/H1/intent inference.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      pageUrl: z.string(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscPageQueries(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_query_pages",
    "Observed pages for one exact query. Two URLs sharing a query is a candidate, never proof of harm.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      query: z.string(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscQueryPages(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_find_opportunities",
    "Review candidates by transparent rule: low_ctr, striking_distance, declining, ctr_benchmark, low_clicks. Heuristics with versioned thresholds, never diagnoses.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
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
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscFindOpportunities(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_detect_cannibalization",
    "Queries served by several of your own pages. Candidates for editorial review, never consolidation orders.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minPages: z.number().optional(),
      minImpressionsPerPage: z.number().optional(),
      minSharePct: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscDetectCannibalization(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_analyze_segments",
    "Compare caller-defined segments (brand terms, folders, countries, devices) over one retrieved dataset. Groups may overlap.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
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
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscAnalyzeSegments(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_export_dataset",
    "Export a previous dataset to this machine (json/csv/markdown). Requires GSC_EXPORTS=1. Never overwrites, never uploads.",
    {
      datasetId: z.string(),
      format: z.string().describe("json, csv or markdown"),
      name: z.string().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscExportDataset(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_analyze_traffic_drop",
    "Traffic-drop decomposition: observed signals, hypotheses and missing evidence. Correlation is not causation.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      dimension: z.string().optional().describe("page or query (default page)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      baseline: z.string().optional(),
      minAbsLoss: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscAnalyzeTrafficDrop(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_content_decay",
    "Three-window decline candidates for web or image. Sustained fall only; anything less is not a finding.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
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
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscContentDecay(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_check_alerts",
    "On-demand rule evaluation with stable alert ids. Not continuous monitoring.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
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
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscCheckAlerts(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_content_candidates",
    "Observed queries at weak positions with their observed pages. Review, do not auto-create.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      minImpressions: z.number().optional(),
      minPosition: z.number().optional(),
      maxExpand: z.number().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscContentCandidates(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_content_recommendations",
    "Prioritized action candidates with recoverable evidence. Nothing is edited automatically.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      categories: z.array(z.string()).optional(),
      maxRecommendations: z.number().optional(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscContentRecommendations(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_multi_site_overview",
    "Per-property health with isolated failures and a shared budget. Never sums properties.",
    {
      sites: z.array(z.string()).min(1).max(5),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      includeComparison: z.boolean().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscMultiSiteOverview(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_generate_report",
    "Deterministic markdown report from tool outputs. No model involved; save is export-gated.",
    {
      siteUrl: z.string().optional(),
      sites: z.array(z.string()).optional(),
      sections: z.array(z.string()).optional(),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      save: z.boolean().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscGenerateReport(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_verify_claim",
    "Check one structured claim against comparable evidence: verified, contradicted or unverifiable.",
    {
      metric: z.string(),
      value: z.number(),
      siteUrl: z.string().describe("Exact GSC property identifier"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      searchType: z.string().optional(),
      dataState: z.string().optional(),
      toleranceAbs: z.number().optional(),
      toleranceRel: z.number().optional(),
      compareWithBaseline: z.boolean().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscVerifyClaim(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_compare_web_image",
    "Web vs image surfaces joined by key. Separate universes: no audience sums, no CTR transfer.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      dimension: z.string().optional().describe("query or page (default query)"),
      preset: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      resultLimit: z.number().optional(),
      maxFetchRows: z.number().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await gscCompareWebImage(args), null, 2) }],
    })
  );

  server.tool(
    "gsc_check_update_impact",
    "Correlate a traffic-drop window with confirmed Google ranking updates (core, spam, reviews) from the public Search Status Dashboard. Reports temporal coincidence only, never causation. Dashboard history starts Dec 2022.",
    {
      siteUrl: z.string().describe("Exact GSC property identifier"),
      preset: z.string().optional().describe("last_7_days, last_28_days, last_90_days (default last_28_days when no explicit dates)"),
      startDate: z.string().optional().describe("Inclusive start, YYYY-MM-DD"),
      endDate: z.string().optional().describe("Inclusive end, YYYY-MM-DD"),
      baseline: z.string().optional().describe("previous_period (default), previous_year"),
      updateType: z.enum(["all", "core", "spam", "reviews"]).optional().describe("Ranking-update family (default all)"),
      dimension: z.string().optional().describe("page or query (default page)"),
      minAbsLoss: z.number().optional().describe("Minimum absolute click loss per key (default 10)"),
      resultLimit: z.number().optional().describe("Overlaps returned, 1-200 (default 10)"),
      maxFetchRows: z.number().optional().describe("Rows retrieved per GSC window, 1-50000 (default 5000)"),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await checkUpdateImpact(args), null, 2) }],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`GSC MCP server v${CLI_VERSION} running on stdio (profile: ${opts.profile ?? "default(env)"})`);
}
