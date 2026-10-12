import { getSearchConsoleClient } from "../auth.js";
interface SitemapSubmitResult {
    siteUrl: string;
    sitemapUrl: string;
    success: boolean;
    error: string | null;
    note?: string;
}
type SearchConsoleClient = Awaited<ReturnType<typeof getSearchConsoleClient>>;
export declare function submitSitemap(sitemapUrl?: string, siteUrlOverride?: string, clientOverride?: SearchConsoleClient): Promise<SitemapSubmitResult>;
export {};
