import { WebReader } from "./web.js";
export interface SitemapEntry {
    url: string;
    sitemap: string;
    lastmod: string | null;
}
export interface Discovery {
    queue: string[];
    visited: string[];
    entries: SitemapEntry[];
    failures: Array<{
        url: string;
        error: string;
    }>;
    capped: boolean;
}
export declare function discovery(roots?: string[]): Discovery;
export declare function parseSitemap(xml: string, source: string): {
    sitemaps: string[];
    entries: SitemapEntry[];
};
export declare function discoverBatch(state: Discovery, web: WebReader): Promise<void>;
