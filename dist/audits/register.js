"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAudits = registerAudits;
const zod_1 = require("zod");
const tools_js_1 = require("./tools.js");
const tool_descriptions_js_1 = require("../tool-descriptions.js");
const common = {
    siteUrl: zod_1.z.string().min(1).describe("Exact GSC property identifier; URLs must belong to this property"),
    preset: zod_1.z.enum(["last_7_days", "last_28_days", "last_90_days"]).optional(),
    startDate: zod_1.z.string().optional(), endDate: zod_1.z.string().optional(),
    resultLimit: zod_1.z.number().int().min(1).max(200).optional(),
    cursor: zod_1.z.string().optional().describe("Continue an in-memory audit explicitly; expires after 15 idle minutes. Resend original parameters unchanged."),
};
const range = zod_1.z.object({ startDate: zod_1.z.string(), endDate: zod_1.z.string() });
const urls = (max) => zod_1.z.array(zod_1.z.string()).min(1).max(max);
function registerAudits(server, deps = {}) {
    const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
    server.tool("gsc_page_audit", (0, tool_descriptions_js_1.toolDescription)("gsc_page_audit"), { ...common, urls: urls(5).optional() }, async (input, extra) => result(await (0, tools_js_1.gscPageAudit)(input, { ...deps, signal: extra.signal })));
    server.tool("gsc_indexing_audit", (0, tool_descriptions_js_1.toolDescription)("gsc_indexing_audit"), { ...common, urls: urls(10000).optional(), sitemapUrls: urls(100).optional(), selection: zod_1.z.enum(["sitemap_order", "recent_lastmod"]).optional(), inspectLimit: zod_1.z.number().int().min(1).max(10).optional() }, async (input, extra) => result(await (0, tools_js_1.gscIndexingAudit)(input, { ...deps, signal: extra.signal })));
    server.tool("gsc_internal_link_audit", (0, tool_descriptions_js_1.toolDescription)("gsc_internal_link_audit"), { ...common, startUrls: urls(100).optional(), sitemapUrls: urls(100).optional(), maxPages: zod_1.z.number().int().min(1).max(500).optional(), batchSize: zod_1.z.number().int().min(1).max(50).optional() }, async (input, extra) => result(await (0, tools_js_1.gscInternalLinkAudit)(input, { ...deps, signal: extra.signal })));
    server.tool("gsc_change_impact", (0, tool_descriptions_js_1.toolDescription)("gsc_change_impact"), {
        ...common, cursor: zod_1.z.string().optional().describe("For analyze, continue the in-memory audit. For list with changeId, continue the persisted snapshot byte stream using nextCursor."), action: zod_1.z.enum(["record", "list", "analyze", "delete"]),
        change: zod_1.z.object({ date: zod_1.z.string(), label: zod_1.z.string().max(200).optional(), description: zod_1.z.string().max(2000).optional(), urls: urls(100) }).optional(),
        changeId: zod_1.z.string().optional(), idempotencyKey: zod_1.z.string().max(200).optional(), saveSnapshot: zod_1.z.boolean().optional(),
        before: range.optional(), after: range.optional(), controlUrls: urls(3).optional(), batchSize: zod_1.z.number().int().min(1).max(3).optional(),
    }, async (input, extra) => result(await (0, tools_js_1.gscChangeImpact)(input, { ...deps, signal: extra.signal })));
    const { siteUrl: _siteUrl, ...migrationCommon } = common;
    server.tool("gsc_migration_audit", (0, tool_descriptions_js_1.toolDescription)("gsc_migration_audit"), { ...migrationCommon, sourceSiteUrl: zod_1.z.string().min(1), targetSiteUrl: zod_1.z.string().min(1), mappings: zod_1.z.array(zod_1.z.object({ oldUrl: zod_1.z.string(), newUrl: zod_1.z.string() })).min(1).max(500).optional(), migrationDate: zod_1.z.string().optional(), batchSize: zod_1.z.number().int().min(1).max(5).optional(), before: range.optional(), after: range.optional() }, async (input, extra) => result(await (0, tools_js_1.gscMigrationAudit)(input, { ...deps, signal: extra.signal })));
}
