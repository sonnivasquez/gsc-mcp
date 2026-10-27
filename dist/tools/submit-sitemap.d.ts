import { getSearchConsoleClient } from "../auth.js";
export interface SitemapSubmitResult {
    siteUrl: string;
    sitemapUrl: string;
    success: boolean;
    error: string | null;
    note?: string;
}
type SitemapClient = Awaited<ReturnType<typeof getSearchConsoleClient>>;
export declare function submitSitemap(sitemapUrl?: string, siteUrlOverride?: string, clientOverride?: SitemapClient): Promise<SitemapSubmitResult>;
export {};
