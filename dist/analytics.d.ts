import { type SearchConsoleClient } from "./auth.js";
import { type AnalyticsFilterList } from "./gsc/analytics-rules.js";
import type { AnalyticsFilter, SearchType } from "./gsc/client.js";
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
        groupType?: string;
        filters?: AnalyticsFilter[];
        filterLists?: AnalyticsFilterList[];
    }>;
    rowLimit?: number;
    maxTotalRows?: number;
    type?: SearchType;
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
