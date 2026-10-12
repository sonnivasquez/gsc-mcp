"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serve = serve;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const guardrails_js_1 = require("./guardrails.js");
const version_js_1 = require("./version.js");
const tools_js_1 = require("./gsc/tools.js");
const prompts_js_1 = require("./gsc/prompts.js");
const submit_url_js_1 = require("./tools/submit-url.js");
const submit_sitemap_js_1 = require("./tools/submit-sitemap.js");
// v2.4 generative AI tools — the Generative AI report has no API, but AI Mode
// conversation exhaust leaks into the regular query dimension. See the tool
// file for the mechanism and sources.
const genai_conversation_queries_js_1 = require("./tools/genai-conversation-queries.js");
// v2.5: the bridge from "which pages fail in image search" to "why". Fetches
// the user's own pages and audits the on-page image factors.
const image_page_audit_js_1 = require("./tools/image-page-audit.js");
// Update impact: correlate a traffic-drop window with confirmed Google
// ranking updates from the public Search Status Dashboard. Coincidence
// only, never causal attribution.
const update_impact_js_1 = require("./tools/update-impact.js");
async function serve(opts) {
    const server = new mcp_js_1.McpServer({
        name: "gsc-mcp",
        version: version_js_1.CLI_VERSION,
    });
    (0, prompts_js_1.registerPrompts)(server);
    // 17. Submit URL for Indexing
    server.tool("gsc_submit_url", "Submit a URL to Google's Indexing API to request crawling and indexing. Works for notifying Google of new or updated content. Note: Google officially supports this for JobPosting/BroadcastEvent schema but processes all page types." + guardrails_js_1.GUARDRAIL_SUFFIX, {
        url: zod_1.z.string().describe("The full URL to submit for indexing"),
        action: zod_1.z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe("URL_UPDATED for new/changed content, URL_DELETED for removed pages"),
    }, async ({ url, action }) => {
        const results = await (0, submit_url_js_1.submitUrl)(url, action);
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    });
    // 18. Batch Submit URLs
    server.tool("gsc_submit_batch", "Submit up to 200 URLs to Google's Indexing API in one go. Daily quota is 200 URL notifications. Use for bulk indexing requests after publishing multiple pages or a site-wide update." + guardrails_js_1.GUARDRAIL_SUFFIX, {
        urls: zod_1.z.array(zod_1.z.string()).describe("Array of URLs to submit (max 200)"),
        action: zod_1.z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe("URL_UPDATED for new/changed content, URL_DELETED for removed pages"),
    }, async ({ urls, action }) => {
        const results = await (0, submit_url_js_1.submitBatch)(urls, action);
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    });
    // 19. Submit Sitemap
    server.tool("gsc_submit_sitemap", "Notify Google of a new or updated sitemap. Triggers Google to recrawl the sitemap and discover new pages." + guardrails_js_1.GUARDRAIL_SUFFIX, {
        sitemap_url: zod_1.z.string().optional().describe("Full sitemap URL (defaults to {site_url}/sitemap.xml)"),
        site_url: zod_1.z.string().min(1).describe("GSC property to submit the sitemap for"),
    }, async ({ sitemap_url, site_url }) => {
        const results = await (0, submit_sitemap_js_1.submitSitemap)(sitemap_url, site_url);
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    });
    // ---------------------------------------------------------------------------
    // v2.3 IMAGE SEO TOOLS
    //
    // These tools all pass type=image to the GSC Search Analytics API, which most
    // third-party tools never expose. Paired with the base project's Image SEO
    // technical guide (see NOTICE). All 7 reuse the existing fetchAllRows
    // plumbing; the only meaningfully new logic is the join in compare_web_vs_image.
    // ---------------------------------------------------------------------------
    // 28. Generative AI Conversation Queries
    server.tool("gsc_genai_conversation_queries", "Surface AI-conversation exhaust hiding in your regular query data: bare replies to Google's AI ('yes', 'go on'), 'what about X' pivot follow-ups, conversational questions, AI-visibility tracker probes, and full agent prompts logged as queries. Google counts every AI Mode follow-up as a new query and folds AI Mode/AI Overviews into the web search type, so these fragments carry real impressions, positions and clicks. The dedicated Generative AI report has no query dimension; this is the only query-level AI evidence available anywhere. Classifies every match into seven buckets with landing pages, plus a monthly timeline showing when reply-artefacts first appeared on your site. Treat probe and harness buckets as machine traffic, not demand. Pulls abort over 50k rows per request." + guardrails_js_1.GUARDRAIL_SUFFIX + guardrails_js_1.VISUAL_SUFFIX + guardrails_js_1.POSITION_CAVEAT, {
        days: zod_1.z.number().default(480).describe("Days to analyse (default 480, the full 16 months GSC retains)"),
        min_impressions: zod_1.z.number().default(1).describe("Minimum impressions for a query to be listed (single-impression rows are evidence, not noise, so the default keeps them)"),
        max_rows_per_bucket: zod_1.z.number().default(50).describe("Maximum rows returned per bucket; totals always cover everything"),
        include_timeline: zod_1.z.boolean().default(true).describe("Include the monthly artefact timeline (one extra API call)"),
        site_url: zod_1.z.string().min(1).describe("GSC property to query (e.g. sc-domain:example.com)"),
    }, async ({ days, min_impressions, max_rows_per_bucket, include_timeline, site_url }) => {
        const results = await (0, genai_conversation_queries_js_1.genaiConversationQueries)(days, min_impressions, max_rows_per_bucket, include_timeline, site_url);
        const wrapped = (0, guardrails_js_1.withMeta)(results, "gsc_genai_conversation_queries", { days, min_impressions, max_rows_per_bucket, include_timeline, site_url });
        return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
    });
    // 29. Image Page Audit
    server.tool("gsc_image_page_audit", "Fetches pages from YOUR OWN site and audits every image on them for the on-page factors that drive image-search performance: missing/empty/generic/duplicate alt text, non-descriptive filenames, missing width/height attributes, lazy loading on the LCP candidate, srcset coverage, file format and weight, intrinsic dimensions vs Google's ~250x200 indexing minimum, ImageObject and licensable schema, max-image-preview, inline background images, and the metadata inside the image files (camera EXIF and GPS that should be stripped, IPTC Creator/Copyright/Caption that should survive, XMP DigitalSourceType on AI-generated images). Feed it URLs straight from image_impressions_no_clicks or image_search_quick_wins to turn 'which pages fail' into 'why they fail'. Only fetches the URLs given; no third-party service involved. Pages must belong to the instance allowlist and every fetch stays on public hosts with redirects revalidated (images may come from any public CDN host). Returns a per-image findings table, page-level checks, and an ordered top_fixes list." + guardrails_js_1.GUARDRAIL_SUFFIX + guardrails_js_1.VISUAL_SUFFIX, {
        urls: zod_1.z.array(zod_1.z.string()).min(1).max(5).describe("Page URLs to audit (1-5, from your own site)"),
        fetch_metadata: zod_1.z.boolean().default(true).describe("Also read EXIF/IPTC/XMP metadata from the image files"),
        max_images_per_page: zod_1.z.number().default(12).describe("Maximum images fetched and weighed per page (HTML checks still cover all images)"),
        max_images_reported: zod_1.z.number().default(20).describe("Maximum per-image rows returned per page"),
    }, async ({ urls, fetch_metadata, max_images_per_page, max_images_reported }) => {
        const results = await (0, image_page_audit_js_1.imagePageAudit)(urls, fetch_metadata, max_images_per_page, max_images_reported);
        const wrapped = (0, guardrails_js_1.withMeta)(results, "gsc_image_page_audit", { urls, fetch_metadata, max_images_per_page, max_images_reported }, "Live fetch of the audited pages (the user's own site)", "All findings come from fetching and parsing the listed pages and image files at call time. Alt text, attributes, bytes, and dimensions are read values, not estimates. Base your analysis only on this data. An empty alt (alt=\"\") is correct for decorative images; do not report it as a defect.");
        return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
    });
    // --- Canonical gsc_* tools (readonly core; envelope contract v1.0) ---
    server.tool("gsc_capabilities", "What this server can do: tools, auth state, limits and instance allowlist. Works offline, no credentials needed.", {}, async () => ({
        content: [{ type: "text", text: JSON.stringify((0, tools_js_1.gscCapabilities)(), null, 2) }],
    }));
    server.tool("gsc_list_sites", "GSC properties visible to this instance. Preserves the exact siteUrl identifier.", {}, async () => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscListSites)(), null, 2) }],
    }));
    server.tool("gsc_search_analytics", "Flexible performance query with explicit coverage. Sort applies to the retrieved dataset, not to all Google data.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        startDate: zod_1.z.string().describe("Inclusive start, YYYY-MM-DD"),
        endDate: zod_1.z.string().describe("Inclusive end, YYYY-MM-DD"),
        dimensions: zod_1.z.array(zod_1.z.string()).describe("Subset of date, page, query, country, device"),
        filters: zod_1.z.array(zod_1.z.object({ dimension: zod_1.z.string(), operator: zod_1.z.string(), expression: zod_1.z.string() })).optional(),
        searchType: zod_1.z.string().optional().describe("web, image, video, news, discover, googleNews (default web)"),
        dataState: zod_1.z.string().optional().describe("final or all (default final)"),
        sortBy: zod_1.z.string().optional().describe("clicks, impressions, ctr, position (default clicks)"),
        sortDirection: zod_1.z.string().optional().describe("asc or desc (default desc)"),
        resultLimit: zod_1.z.number().optional().describe("Rows returned, 1-200 (default 50)"),
        maxFetchRows: zod_1.z.number().optional().describe("Rows retrieved, 1-50000 (default 5000)"),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscSearchAnalytics)(args), null, 2) }],
    }));
    server.tool("gsc_inspect_urls", "Index inspection for 1-10 URLs. Per-URL results in input order; one failure never discards the successes.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        urls: zod_1.z.array(zod_1.z.string()).min(1).max(10),
        languageCode: zod_1.z.string().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscInspectUrls)(args), null, 2) }],
    }));
    server.tool("gsc_list_sitemaps", "Registered sitemaps and their reported states. Readonly; never submits.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscListSitemaps)(args.siteUrl), null, 2) }],
    }));
    server.tool("gsc_get_dataset", "Page through a previous result with zero new Google calls. Datasets expire after 15 minutes and never cross profiles.", {
        datasetId: zod_1.z.string().describe("Dataset identifier from a previous tool response"),
        cursor: zod_1.z.string().optional().describe("Opaque cursor from a previous page"),
        limit: zod_1.z.number().optional().describe("Rows per page, 1-200 (default 50)"),
        columns: zod_1.z.array(zod_1.z.string()).optional().describe("Subset of the dataset columns"),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscGetDataset)(args), null, 2) }],
    }));
    server.tool("gsc_performance_overview", "Totals, timeline and optional comparison for a site. Totals come from the aggregate row, never from summing a top.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        preset: zod_1.z.string().optional().describe("last_7_days, last_28_days, last_90_days"),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        searchType: zod_1.z.string().optional(),
        dataState: zod_1.z.string().optional(),
        includeTimeline: zod_1.z.boolean().optional(),
        includeComparison: zod_1.z.boolean().optional(),
        baseline: zod_1.z.string().optional().describe("previous_period, previous_year, or omitted"),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscPerformanceOverview)(args), null, 2) }],
    }));
    server.tool("gsc_compare_periods", "Deterministic period comparison. Absent keys stay in their own blocks, never as zeros.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        dimension: zod_1.z.string().describe("page, query, country, device or none"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        baseline: zod_1.z.string().optional().describe("previous_period (default), previous_year"),
        orderBy: zod_1.z.string().optional(),
        sortDirection: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscComparePeriods)(args), null, 2) }],
    }));
    server.tool("gsc_page_queries", "Observed queries for one exact page URL. No title/H1/intent inference.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        pageUrl: zod_1.z.string(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscPageQueries)(args), null, 2) }],
    }));
    server.tool("gsc_query_pages", "Observed pages for one exact query. Two URLs sharing a query is a candidate, never proof of harm.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        query: zod_1.z.string(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscQueryPages)(args), null, 2) }],
    }));
    server.tool("gsc_find_opportunities", "Review candidates by transparent rule: low_ctr, striking_distance, declining, ctr_benchmark, low_clicks. Heuristics with versioned thresholds, never diagnoses.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        kind: zod_1.z.string(),
        dimension: zod_1.z.string().optional().describe("query or page (default query)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        minImpressions: zod_1.z.number().optional(),
        minPosition: zod_1.z.number().optional(),
        maxPosition: zod_1.z.number().optional(),
        maxCtr: zod_1.z.number().optional(),
        targetCtr: zod_1.z.number().optional().describe("Only then a conditional click scenario is computed"),
        minBaseClicks: zod_1.z.number().optional(),
        minDeclinePct: zod_1.z.number().optional(),
        windowDays: zod_1.z.number().optional(),
        maxClicks: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscFindOpportunities)(args), null, 2) }],
    }));
    server.tool("gsc_detect_cannibalization", "Queries served by several of your own pages. Candidates for editorial review, never consolidation orders.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        minPages: zod_1.z.number().optional(),
        minImpressionsPerPage: zod_1.z.number().optional(),
        minSharePct: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscDetectCannibalization)(args), null, 2) }],
    }));
    server.tool("gsc_analyze_segments", "Compare caller-defined segments (brand terms, folders, countries, devices) over one retrieved dataset. Groups may overlap.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        segments: zod_1.z.array(zod_1.z.object({
            id: zod_1.z.string(),
            label: zod_1.z.string(),
            brandTerms: zod_1.z.array(zod_1.z.string()).optional(),
            pathPrefix: zod_1.z.string().optional(),
            country: zod_1.z.string().optional(),
            device: zod_1.z.string().optional(),
        })).min(1).max(10),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscAnalyzeSegments)(args), null, 2) }],
    }));
    server.tool("gsc_export_dataset", "Export a previous dataset to this machine (json/csv/markdown). Requires GSC_EXPORTS=1. Never overwrites, never uploads.", {
        datasetId: zod_1.z.string(),
        format: zod_1.z.string().describe("json, csv or markdown"),
        name: zod_1.z.string().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscExportDataset)(args), null, 2) }],
    }));
    server.tool("gsc_analyze_traffic_drop", "Traffic-drop decomposition: observed signals, hypotheses and missing evidence. Correlation is not causation.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        baseline: zod_1.z.string().optional(),
        minAbsLoss: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscAnalyzeTrafficDrop)(args), null, 2) }],
    }));
    server.tool("gsc_content_decay", "Three-window decline candidates for web or image. Sustained fall only; anything less is not a finding.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        searchType: zod_1.z.string().optional().describe("web or image (default web)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        windowDays: zod_1.z.number().optional(),
        minBaseClicks: zod_1.z.number().optional(),
        minDeclinePct: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscContentDecay)(args), null, 2) }],
    }));
    server.tool("gsc_check_alerts", "On-demand rule evaluation with stable alert ids. Not continuous monitoring.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        baseline: zod_1.z.string().optional(),
        minClickLoss: zod_1.z.number().optional(),
        ctrDropPpMin: zod_1.z.number().optional(),
        positionWorseByMin: zod_1.z.number().optional(),
        disappearedMinClicks: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscCheckAlerts)(args), null, 2) }],
    }));
    server.tool("gsc_content_candidates", "Observed queries at weak positions with their observed pages. Review, do not auto-create.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        minImpressions: zod_1.z.number().optional(),
        minPosition: zod_1.z.number().optional(),
        maxExpand: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscContentCandidates)(args), null, 2) }],
    }));
    server.tool("gsc_content_recommendations", "Prioritized action candidates with recoverable evidence. Nothing is edited automatically.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        categories: zod_1.z.array(zod_1.z.string()).optional(),
        maxRecommendations: zod_1.z.number().optional(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscContentRecommendations)(args), null, 2) }],
    }));
    server.tool("gsc_multi_site_overview", "Per-property health with isolated failures and a shared budget. Never sums properties.", {
        sites: zod_1.z.array(zod_1.z.string()).min(1).max(5),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        includeComparison: zod_1.z.boolean().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscMultiSiteOverview)(args), null, 2) }],
    }));
    server.tool("gsc_generate_report", "Deterministic markdown report from tool outputs. No model involved; save is export-gated.", {
        siteUrl: zod_1.z.string().optional(),
        sites: zod_1.z.array(zod_1.z.string()).optional(),
        sections: zod_1.z.array(zod_1.z.string()).optional(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        save: zod_1.z.boolean().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscGenerateReport)(args), null, 2) }],
    }));
    server.tool("gsc_verify_claim", "Check one structured claim against comparable evidence: verified, contradicted or unverifiable.", {
        metric: zod_1.z.string(),
        value: zod_1.z.number(),
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        searchType: zod_1.z.string().optional(),
        dataState: zod_1.z.string().optional(),
        toleranceAbs: zod_1.z.number().optional(),
        toleranceRel: zod_1.z.number().optional(),
        compareWithBaseline: zod_1.z.boolean().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscVerifyClaim)(args), null, 2) }],
    }));
    server.tool("gsc_compare_web_image", "Web vs image surfaces joined by key. Separate universes: no audience sums, no CTR transfer.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("query or page (default query)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, tools_js_1.gscCompareWebImage)(args), null, 2) }],
    }));
    server.tool("gsc_check_update_impact", "Correlate a traffic-drop window with confirmed Google ranking updates (core, spam, reviews) from the public Search Status Dashboard. Reports temporal coincidence only, never causation. Dashboard history starts Dec 2022.", {
        siteUrl: zod_1.z.string().describe("Exact GSC property identifier"),
        preset: zod_1.z.string().optional().describe("last_7_days, last_28_days, last_90_days (default last_28_days when no explicit dates)"),
        startDate: zod_1.z.string().optional().describe("Inclusive start, YYYY-MM-DD"),
        endDate: zod_1.z.string().optional().describe("Inclusive end, YYYY-MM-DD"),
        baseline: zod_1.z.string().optional().describe("previous_period (default), previous_year"),
        updateType: zod_1.z.enum(["all", "core", "spam", "reviews"]).optional().describe("Ranking-update family (default all)"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        minAbsLoss: zod_1.z.number().optional().describe("Minimum absolute click loss per key (default 10)"),
        resultLimit: zod_1.z.number().optional().describe("Overlaps returned, 1-200 (default 10)"),
        maxFetchRows: zod_1.z.number().optional().describe("Rows retrieved per GSC window, 1-50000 (default 5000)"),
    }, async (args) => ({
        content: [{ type: "text", text: JSON.stringify(await (0, update_impact_js_1.checkUpdateImpact)(args), null, 2) }],
    }));
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error(`GSC MCP server v${version_js_1.CLI_VERSION} running on stdio (profile: ${opts.profile ?? "default(env)"})`);
}
