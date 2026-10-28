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
    temporal?: TemporalEvidence;
    temporalAnalysisStatus?: "pending" | "analyzed" | "insufficient_data" | "error";
    temporalError?: string;
    temporalPendingReason?: "query_limit" | "request_budget";
    temporalCoverage?: {
        fetchedRows: number;
        truncated: boolean;
    };
}
export interface CannibalizationOpts {
    minPages?: number;
    minImpressionsPerPage?: number;
    minSharePct?: number;
}
export declare function detectCannibalization(rows: AnalyticsRow[], opts?: CannibalizationOpts): CannibalizationCandidate[];
export interface TemporalEvidence {
    status: "insufficient_data" | "analyzed";
    observedDays: number;
    sameDayOverlap: string[];
    daily: Array<{
        date: string;
        dominantUrl: string | null;
        pages: Array<{
            page: string;
            clicks: number;
            impressions: number;
        }>;
    }>;
    sustainedChanges: Array<{
        date: string;
        from: string;
        to: string;
    }>;
    ruleVersion: "temporal.1";
}
export declare function temporalEvidence(rows: AnalyticsRow[], minDailyImpressions?: number): TemporalEvidence;
