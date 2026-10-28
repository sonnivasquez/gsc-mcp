import { type SearchConsoleClient } from "./auth.js";
export interface SearchAnalyticsRow {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface QueryParams {
    startDate: string;
    endDate: string;
    dimensions: string[];
    dimensionFilterGroups?: Array<{
        filters: Array<{
            dimension: string;
            operator: string;
            expression: string;
        }>;
    }>;
    rowLimit?: number;
    maxTotalRows?: number;
    type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
    aggregationType?: string;
}
export declare function getDateRange(days: number): {
    startDate: string;
    endDate: string;
};
export declare function getPriorDateRange(days: number): {
    startDate: string;
    endDate: string;
};
export declare function fetchAllRows(params: QueryParams, siteUrlOverride?: string, clientOverride?: SearchConsoleClient): Promise<SearchAnalyticsRow[]>;
