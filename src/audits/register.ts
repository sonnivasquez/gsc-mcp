import type { AuditDeps } from "./context.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gscPageAudit, gscIndexingAudit, gscInternalLinkAudit, gscChangeImpact, gscMigrationAudit } from "./tools.js";
import { toolDescription } from "../tool-descriptions.js";
const common = {
  siteUrl: z.string().min(1).describe("Exact GSC property identifier; URLs must belong to this property"),
  preset: z.enum(["last_7_days", "last_28_days", "last_90_days"]).optional(),
  startDate: z.string().optional(), endDate: z.string().optional(),
  resultLimit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional().describe("Continue an in-memory audit explicitly; expires after 15 idle minutes. Resend original parameters unchanged."),
};
const range = z.object({ startDate: z.string(), endDate: z.string() });
const urls = (max: number) => z.array(z.string()).min(1).max(max);
export function registerAudits(server: McpServer, deps: AuditDeps = {}): void {
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
  server.tool("gsc_page_audit", toolDescription("gsc_page_audit"), { ...common, urls: urls(5).optional() }, async (input, extra) => result(await gscPageAudit(input, { ...deps, signal: extra.signal })));
  server.tool("gsc_indexing_audit", toolDescription("gsc_indexing_audit"), { ...common, urls: urls(10000).optional(), sitemapUrls: urls(100).optional(), selection: z.enum(["sitemap_order", "recent_lastmod"]).optional(), inspectLimit: z.number().int().min(1).max(10).optional() }, async (input, extra) => result(await gscIndexingAudit(input, { ...deps, signal: extra.signal })));
  server.tool("gsc_internal_link_audit", toolDescription("gsc_internal_link_audit"), { ...common, startUrls: urls(100).optional(), sitemapUrls: urls(100).optional(), maxPages: z.number().int().min(1).max(500).optional(), batchSize: z.number().int().min(1).max(50).optional() }, async (input, extra) => result(await gscInternalLinkAudit(input, { ...deps, signal: extra.signal })));
  server.tool("gsc_change_impact", toolDescription("gsc_change_impact"), {
    ...common, cursor: z.string().optional().describe("For analyze, continue the in-memory audit. For list with changeId, continue the persisted snapshot byte stream using nextCursor."), action: z.enum(["record", "list", "analyze", "delete"]),
    change: z.object({ date: z.string(), label: z.string().max(200).optional(), description: z.string().max(2000).optional(), urls: urls(100) }).optional(),
    changeId: z.string().optional(), idempotencyKey: z.string().max(200).optional(), saveSnapshot: z.boolean().optional(),
    before: range.optional(), after: range.optional(), controlUrls: urls(3).optional(), batchSize: z.number().int().min(1).max(3).optional(),
  }, async (input, extra) => result(await gscChangeImpact(input, { ...deps, signal: extra.signal })));
  const { siteUrl: _siteUrl, ...migrationCommon } = common;
  server.tool("gsc_migration_audit", toolDescription("gsc_migration_audit"), { ...migrationCommon, sourceSiteUrl: z.string().min(1), targetSiteUrl: z.string().min(1), mappings: z.array(z.object({ oldUrl: z.string(), newUrl: z.string() })).min(1).max(500).optional(), migrationDate: z.string().optional(), batchSize: z.number().int().min(1).max(5).optional(), before: range.optional(), after: range.optional() }, async (input, extra) => result(await gscMigrationAudit(input, { ...deps, signal: extra.signal })));
}
