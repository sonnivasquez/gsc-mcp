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
const genai_conversation_queries_js_1 = require("./tools/genai-conversation-queries.js");
const image_page_audit_js_1 = require("./tools/image-page-audit.js");
const update_impact_js_1 = require("./tools/update-impact.js");
const register_js_1 = require("./audits/register.js");
const tool_descriptions_js_1 = require("./tool-descriptions.js");
function phrase(parts) {
    return parts.join("");
}
function textResult(value) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
}
const described = (label) => zod_1.z.string().describe(label);
function indexingAction() {
    return zod_1.z.enum(["URL_UPDATED", "URL_DELETED"]).default("URL_UPDATED").describe(phrase([
        "URL_UPDATED for new/changed content, ",
        "URL_DELETED for removed pages",
    ]));
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
async function serve(opts) {
    const server = new mcp_js_1.McpServer({ name: "gsc-mcp", version: version_js_1.CLI_VERSION });
    (0, prompts_js_1.registerPrompts)(server);
    (0, register_js_1.registerAudits)(server);
    server.tool("gsc_submit_url", (0, tool_descriptions_js_1.toolDescription)("gsc_submit_url", guardrails_js_1.GUARDRAIL_SUFFIX), {
        url: described("The full URL to submit for indexing"),
        action: indexingAction(),
    }, async ({ url, action }) => textResult(await (0, submit_url_js_1.submitUrl)(url, action)));
    server.tool("gsc_submit_batch", (0, tool_descriptions_js_1.toolDescription)("gsc_submit_batch", guardrails_js_1.GUARDRAIL_SUFFIX), {
        urls: zod_1.z.array(zod_1.z.string()).describe(phrase(["Array of URLs to submit ", "(max 200)"])),
        action: indexingAction(),
    }, async ({ urls, action }) => textResult(await (0, submit_url_js_1.submitBatch)(urls, action)));
    server.tool("gsc_submit_sitemap", (0, tool_descriptions_js_1.toolDescription)("gsc_submit_sitemap", guardrails_js_1.GUARDRAIL_SUFFIX), {
        sitemap_url: zod_1.z.string().optional().describe(phrase(["Full sitemap URL (defaults to ", "{site_url}/sitemap.xml)"])),
        site_url: zod_1.z.string().min(1).describe("GSC property to submit the sitemap for"),
    }, async ({ sitemap_url, site_url }) => textResult(await (0, submit_sitemap_js_1.submitSitemap)(sitemap_url, site_url)));
    server.tool("gsc_genai_conversation_queries", (0, tool_descriptions_js_1.toolDescription)("gsc_genai_conversation_queries", guardrails_js_1.GUARDRAIL_SUFFIX + guardrails_js_1.VISUAL_SUFFIX + guardrails_js_1.POSITION_CAVEAT), {
        days: zod_1.z.number().default(480).describe(phrase(["Days to analyse (default 480, the ", "full 16 months GSC retains)"])),
        min_impressions: zod_1.z.number().default(1).describe(phrase([
            "Minimum impressions for a query to ",
            "be listed (single-impression rows ",
            "are evidence, not noise, so the ",
            "default keeps them)",
        ])),
        max_rows_per_bucket: zod_1.z.number().default(50).describe(phrase(["Maximum rows returned per bucket; ", "totals always cover everything"])),
        include_timeline: zod_1.z.boolean().default(true).describe(phrase(["Include the monthly artefact ", "timeline (one extra API call)"])),
        site_url: zod_1.z.string().min(1).describe(phrase(["GSC property to query ", "(e.g. sc-domain:example.com)"])),
    }, async (input) => {
        const days = input.days;
        const min_impressions = input.min_impressions;
        const max_rows_per_bucket = input.max_rows_per_bucket;
        const include_timeline = input.include_timeline;
        const site_url = input.site_url;
        const results = await (0, genai_conversation_queries_js_1.genaiConversationQueries)(days, min_impressions, max_rows_per_bucket, include_timeline, site_url);
        return textResult((0, guardrails_js_1.withMeta)(results, "gsc_genai_conversation_queries", {
            days,
            min_impressions,
            max_rows_per_bucket,
            include_timeline,
            site_url,
        }));
    });
    server.tool("gsc_image_page_audit", (0, tool_descriptions_js_1.toolDescription)("gsc_image_page_audit", guardrails_js_1.GUARDRAIL_SUFFIX + guardrails_js_1.VISUAL_SUFFIX), {
        urls: zod_1.z.array(zod_1.z.string()).min(1).max(5).describe(phrase(["Page URLs to audit ", "(1-5, from your own site)"])),
        fetch_metadata: zod_1.z.boolean().default(true).describe(phrase(["Also read EXIF/IPTC/XMP metadata ", "from the image files"])),
        max_images_per_page: zod_1.z.number().default(12).describe(phrase([
            "Maximum images fetched and weighed ",
            "per page (HTML checks still cover ",
            "all images)",
        ])),
        max_images_reported: zod_1.z.number().default(20).describe(phrase(["Maximum per-image rows ", "returned per page"])),
    }, async (input) => {
        const urls = input.urls;
        const fetch_metadata = input.fetch_metadata;
        const max_images_per_page = input.max_images_per_page;
        const max_images_reported = input.max_images_reported;
        const results = await (0, image_page_audit_js_1.imagePageAudit)(urls, fetch_metadata, max_images_per_page, max_images_reported);
        return textResult((0, guardrails_js_1.withMeta)(results, "gsc_image_page_audit", {
            urls,
            fetch_metadata,
            max_images_per_page,
            max_images_reported,
        }, IMAGE_SOURCE, IMAGE_NOTE));
    });
    server.tool("gsc_capabilities", (0, tool_descriptions_js_1.toolDescription)("gsc_capabilities"), {}, async () => textResult((0, tools_js_1.gscCapabilities)()));
    server.tool("gsc_list_sites", (0, tool_descriptions_js_1.toolDescription)("gsc_list_sites"), {}, async () => textResult(await (0, tools_js_1.gscListSites)()));
    server.tool("gsc_search_analytics", (0, tool_descriptions_js_1.toolDescription)("gsc_search_analytics"), {
        siteUrl: described("Exact GSC property identifier"),
        startDate: described("Inclusive start, YYYY-MM-DD"),
        endDate: described("Inclusive end, YYYY-MM-DD"),
        dimensions: zod_1.z.array(zod_1.z.string()).describe("Subset of date, page, query, country, device, hour, searchAppearance (appearance alone)"),
        filters: zod_1.z.array(zod_1.z.object({
            dimension: zod_1.z.string(),
            operator: zod_1.z.string(),
            expression: zod_1.z.string(),
        })).optional(),
        searchType: zod_1.z.string().optional().describe(phrase(["web, image, video, news, discover, ", "googleNews (default web)"])),
        aggregationType: zod_1.z.enum(["auto", "byPage", "byProperty", "byNewsShowcasePanel"]).optional()
            .describe("Google aggregation; page grouping/filtering excludes byProperty"),
        dataState: zod_1.z.string().optional().describe("final, all, hourly_all (requires hour); default final"),
        sortBy: zod_1.z.string().optional().describe(phrase(["clicks, impressions, ctr, position ", "(default clicks)"])),
        sortDirection: zod_1.z.string().optional().describe("asc or desc (default desc)"),
        resultLimit: zod_1.z.number().optional().describe("Rows returned, 1-200 (default 50)"),
        maxFetchRows: zod_1.z.number().optional().describe("Rows retrieved, 1-50000 (default 5000)"),
    }, async (args) => textResult(await (0, tools_js_1.gscSearchAnalytics)(args)));
    server.tool("gsc_inspect_urls", (0, tool_descriptions_js_1.toolDescription)("gsc_inspect_urls"), {
        siteUrl: described("Exact GSC property identifier"),
        urls: zod_1.z.array(zod_1.z.string()).min(1).max(10),
        languageCode: zod_1.z.string().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscInspectUrls)(args)));
    server.tool("gsc_list_sitemaps", (0, tool_descriptions_js_1.toolDescription)("gsc_list_sitemaps"), { siteUrl: described("Exact GSC property identifier") }, async (args) => textResult(await (0, tools_js_1.gscListSitemaps)(args.siteUrl)));
    server.tool("gsc_get_dataset", (0, tool_descriptions_js_1.toolDescription)("gsc_get_dataset"), {
        datasetId: described("Dataset identifier from a previous tool response"),
        cursor: zod_1.z.string().optional().describe("Opaque cursor from a previous page"),
        limit: zod_1.z.number().optional().describe("Rows per page, 1-200 (default 50)"),
        columns: zod_1.z.array(zod_1.z.string()).optional().describe("Subset of the dataset columns"),
    }, async (args) => textResult(await (0, tools_js_1.gscGetDataset)(args)));
    server.tool("gsc_performance_overview", (0, tool_descriptions_js_1.toolDescription)("gsc_performance_overview"), {
        siteUrl: described("Exact GSC property identifier"),
        preset: zod_1.z.string().optional().describe("last_7_days, last_28_days, last_90_days"),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        searchType: zod_1.z.string().optional(),
        dataState: zod_1.z.string().optional(),
        includeTimeline: zod_1.z.boolean().optional(),
        includeComparison: zod_1.z.boolean().optional(),
        baseline: zod_1.z.string().optional().describe("previous_period, previous_year, or omitted"),
    }, async (args) => textResult(await (0, tools_js_1.gscPerformanceOverview)(args)));
    server.tool("gsc_compare_periods", (0, tool_descriptions_js_1.toolDescription)("gsc_compare_periods"), {
        siteUrl: described("Exact GSC property identifier"),
        dimension: described("page, query, country, device or none"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        baseline: zod_1.z.string().optional().describe("previous_period (default), previous_year"),
        orderBy: zod_1.z.string().optional(),
        sortDirection: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscComparePeriods)(args)));
    server.tool("gsc_page_queries", (0, tool_descriptions_js_1.toolDescription)("gsc_page_queries"), {
        siteUrl: described("Exact GSC property identifier"),
        pageUrl: zod_1.z.string(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscPageQueries)(args)));
    server.tool("gsc_query_pages", (0, tool_descriptions_js_1.toolDescription)("gsc_query_pages"), {
        siteUrl: described("Exact GSC property identifier"),
        query: zod_1.z.string(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscQueryPages)(args)));
    server.tool("gsc_find_opportunities", (0, tool_descriptions_js_1.toolDescription)("gsc_find_opportunities"), {
        siteUrl: described("Exact GSC property identifier"),
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
    }, async (args) => textResult(await (0, tools_js_1.gscFindOpportunities)(args)));
    server.tool("gsc_detect_cannibalization", (0, tool_descriptions_js_1.toolDescription)("gsc_detect_cannibalization"), {
        includeTimeline: zod_1.z.boolean().optional(),
        timelineQueryLimit: zod_1.z.number().int().min(1).max(10).optional(),
        minDailyImpressions: zod_1.z.number().int().min(1).optional(),
        siteUrl: described("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        minPages: zod_1.z.number().optional(),
        minImpressionsPerPage: zod_1.z.number().optional(),
        minSharePct: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscDetectCannibalization)(args)));
    server.tool("gsc_analyze_segments", (0, tool_descriptions_js_1.toolDescription)("gsc_analyze_segments"), {
        siteUrl: described("Exact GSC property identifier"),
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
    }, async (args) => textResult(await (0, tools_js_1.gscAnalyzeSegments)(args)));
    server.tool("gsc_export_dataset", (0, tool_descriptions_js_1.toolDescription)("gsc_export_dataset"), {
        datasetId: zod_1.z.string(),
        format: described("json, csv or markdown"),
        name: zod_1.z.string().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscExportDataset)(args)));
    server.tool("gsc_analyze_traffic_drop", (0, tool_descriptions_js_1.toolDescription)("gsc_analyze_traffic_drop"), {
        siteUrl: described("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        baseline: zod_1.z.string().optional(),
        minAbsLoss: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscAnalyzeTrafficDrop)(args)));
    server.tool("gsc_content_decay", (0, tool_descriptions_js_1.toolDescription)("gsc_content_decay"), {
        siteUrl: described("Exact GSC property identifier"),
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
    }, async (args) => textResult(await (0, tools_js_1.gscContentDecay)(args)));
    server.tool("gsc_check_alerts", (0, tool_descriptions_js_1.toolDescription)("gsc_check_alerts"), {
        siteUrl: described("Exact GSC property identifier"),
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
    }, async (args) => textResult(await (0, tools_js_1.gscCheckAlerts)(args)));
    server.tool("gsc_content_candidates", (0, tool_descriptions_js_1.toolDescription)("gsc_content_candidates"), {
        siteUrl: described("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        minImpressions: zod_1.z.number().optional(),
        minPosition: zod_1.z.number().optional(),
        maxExpand: zod_1.z.number().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscContentCandidates)(args)));
    server.tool("gsc_content_recommendations", (0, tool_descriptions_js_1.toolDescription)("gsc_content_recommendations"), {
        siteUrl: described("Exact GSC property identifier"),
        categories: zod_1.z.array(zod_1.z.string()).optional(),
        maxRecommendations: zod_1.z.number().optional(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscContentRecommendations)(args)));
    server.tool("gsc_multi_site_overview", (0, tool_descriptions_js_1.toolDescription)("gsc_multi_site_overview"), {
        sites: zod_1.z.array(zod_1.z.string()).min(1).max(5),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        includeComparison: zod_1.z.boolean().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscMultiSiteOverview)(args)));
    server.tool("gsc_generate_report", (0, tool_descriptions_js_1.toolDescription)("gsc_generate_report"), {
        siteUrl: zod_1.z.string().optional(),
        sites: zod_1.z.array(zod_1.z.string()).optional(),
        sections: zod_1.z.array(zod_1.z.string()).optional(),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        save: zod_1.z.boolean().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscGenerateReport)(args)));
    server.tool("gsc_verify_claim", (0, tool_descriptions_js_1.toolDescription)("gsc_verify_claim"), {
        metric: zod_1.z.string(),
        value: zod_1.z.number(),
        siteUrl: described("Exact GSC property identifier"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        searchType: zod_1.z.string().optional(),
        dataState: zod_1.z.string().optional(),
        toleranceAbs: zod_1.z.number().optional(),
        toleranceRel: zod_1.z.number().optional(),
        compareWithBaseline: zod_1.z.boolean().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscVerifyClaim)(args)));
    server.tool("gsc_compare_web_image", (0, tool_descriptions_js_1.toolDescription)("gsc_compare_web_image"), {
        siteUrl: described("Exact GSC property identifier"),
        dimension: zod_1.z.string().optional().describe("query or page (default query)"),
        preset: zod_1.z.string().optional(),
        startDate: zod_1.z.string().optional(),
        endDate: zod_1.z.string().optional(),
        resultLimit: zod_1.z.number().optional(),
        maxFetchRows: zod_1.z.number().optional(),
    }, async (args) => textResult(await (0, tools_js_1.gscCompareWebImage)(args)));
    server.tool("gsc_check_update_impact", (0, tool_descriptions_js_1.toolDescription)("gsc_check_update_impact"), {
        siteUrl: described("Exact GSC property identifier"),
        preset: zod_1.z.string().optional().describe(phrase([
            "last_7_days, last_28_days, ",
            "last_90_days (default last_28_days ",
            "when no explicit dates)",
        ])),
        startDate: zod_1.z.string().optional().describe("Inclusive start, YYYY-MM-DD"),
        endDate: zod_1.z.string().optional().describe("Inclusive end, YYYY-MM-DD"),
        baseline: zod_1.z.string().optional().describe("previous_period (default), previous_year"),
        updateType: zod_1.z.enum(["all", "core", "spam", "reviews"]).optional().describe("Ranking-update family (default all)"),
        dimension: zod_1.z.string().optional().describe("page or query (default page)"),
        minAbsLoss: zod_1.z.number().optional().describe(phrase(["Minimum absolute click loss per ", "key (default 10)"])),
        resultLimit: zod_1.z.number().optional().describe("Overlaps returned, 1-200 (default 10)"),
        maxFetchRows: zod_1.z.number().optional().describe(phrase(["Rows retrieved per GSC window, ", "1-50000 (default 5000)"])),
    }, async (args) => textResult(await (0, update_impact_js_1.checkUpdateImpact)(args)));
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    const profile = opts.profile ?? "default(env)";
    console.error(phrase(["GSC MCP server v", version_js_1.CLI_VERSION, " running on stdio (profile: ", profile, ")"]));
}
