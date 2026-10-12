import type { AuthProvider } from "../auth-provider.js";
import { RequestBudget } from "./budget.js";
export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";
export type DataState = "final" | "all";
export interface AnalyticsFilter {
    dimension: string;
    operator: string;
    expression: string;
}
export interface AnalyticsQuery {
    startDate: string;
    endDate: string;
    dimensions: string[];
    filters?: AnalyticsFilter[];
    searchType?: SearchType;
    dataState?: DataState;
    rowLimit?: number;
    maxFetchRows?: number;
}
export interface AnalyticsRow {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface QueryResult {
    rows: AnalyticsRow[];
    pagesFetched: number;
    truncated: boolean;
}
export interface SiteEntry {
    siteUrl: string;
    permissionLevel: string;
}
export interface SitemapEntry {
    path: string;
    lastSubmitted: string | null;
    warnings: number;
    errors: number;
}
export interface DataSourceOpts {
    budget?: RequestBudget;
    fetchImpl?: typeof fetch;
    allowlist?: string[] | null;
    timeoutMs?: number;
}
export declare class FetchGscDataSource {
    private readonly provider;
    private readonly budget;
    private readonly fetchImpl;
    private readonly allowlist;
    private readonly timeoutMs;
    constructor(provider: AuthProvider, opts?: DataSourceOpts);
    private checkSite;
    private fetchOnce;
    private call;
    listSites(): Promise<SiteEntry[]>;
    queryAnalytics(siteUrl: string, q: AnalyticsQuery): Promise<QueryResult>;
    inspectUrl(siteUrl: string, inspectionUrl: string, languageCode?: string): Promise<unknown>;
    listSitemaps(siteUrl: string): Promise<SitemapEntry[]>;
}
