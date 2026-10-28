import { type AuditDeps } from "./context.js";
import { type ToolEnvelope } from "../gsc/envelope.js";
import { type DateRange } from "../gsc/periods.js";
interface Common {
    siteUrl: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    resultLimit?: number;
    cursor?: string;
}
export interface PageAuditInput extends Common {
    urls?: string[];
}
export declare function gscPageAudit(input: PageAuditInput, deps?: AuditDeps): Promise<ToolEnvelope<unknown>>;
export interface IndexAuditInput extends Common {
    urls?: string[];
    sitemapUrls?: string[];
    selection?: "sitemap_order" | "recent_lastmod";
    inspectLimit?: number;
}
export declare function gscIndexingAudit(input: IndexAuditInput, deps?: AuditDeps): Promise<ToolEnvelope<unknown>>;
export interface InternalLinkInput extends Common {
    startUrls?: string[];
    sitemapUrls?: string[];
    maxPages?: number;
    batchSize?: number;
}
export declare function gscInternalLinkAudit(input: InternalLinkInput, deps?: AuditDeps): Promise<ToolEnvelope<unknown>>;
interface ChangeInput {
    date: string;
    label?: string;
    description?: string;
    urls: string[];
}
export interface ImpactInput extends Common {
    action: "record" | "list" | "analyze" | "delete";
    change?: ChangeInput;
    changeId?: string;
    idempotencyKey?: string;
    saveSnapshot?: boolean;
    before?: DateRange;
    after?: DateRange;
    controlUrls?: string[];
    batchSize?: number;
}
export declare function gscChangeImpact(input: ImpactInput, deps?: AuditDeps): Promise<ToolEnvelope<unknown>>;
export interface MigrationInput extends Omit<Common, "siteUrl"> {
    sourceSiteUrl: string;
    targetSiteUrl: string;
    mappings?: Array<{
        oldUrl: string;
        newUrl: string;
    }>;
    migrationDate?: string;
    batchSize?: number;
    before?: DateRange;
    after?: DateRange;
}
export declare function gscMigrationAudit(input: MigrationInput, deps?: AuditDeps): Promise<ToolEnvelope<unknown>>;
export {};
