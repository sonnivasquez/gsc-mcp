import type { AnalyticsRow } from "./client.js";
export declare const CANNIBALIZATION_RULE_VERSION = "t12.1";
export interface CannibalizationCandidate {
    query: string;
    pages: Array<{
        page: string;
        clicks: number;
        impressions: number;
        position: number;
        sharePct: number;
    }>;
    totalImpressions: number;
    verdict: "candidate";
    temporalOverlap: "unknown";
}
export interface CannibalizationOpts {
    minPages?: number;
    minImpressionsPerPage?: number;
    minSharePct?: number;
}
export declare function detectCannibalization(rows: AnalyticsRow[], opts?: CannibalizationOpts): CannibalizationCandidate[];
