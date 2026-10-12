import type { QueryParams, SearchAnalyticsRow } from "../analytics.js";
export declare const GENAI_MAX_PULL_ROWS = 50000;
/** Narrow injected seam for mocked contract tests (no Google). */
export type GenaiFetchRows = (params: QueryParams, siteUrl?: string) => Promise<SearchAnalyticsRow[]>;
export type Bucket = "artefact" | "pivot" | "conversational" | "tracker_probe" | "agent_harness" | "pasted_string" | "long_uncategorised";
export declare function classifyQuery(query: string): Bucket | null;
interface BucketRow {
    query: string;
    impressions: number;
    clicks: number;
    ctr: number;
    position: number;
    top_pages: Array<{
        page: string;
        impressions: number;
    }>;
}
export declare function genaiConversationQueries(days?: number, minImpressions?: number, maxRowsPerBucket?: number, includeTimeline?: boolean, siteUrl?: string, fetchRowsOverride?: GenaiFetchRows): Promise<{
    period: {
        startDate: string;
        endDate: string;
    };
    summary: Record<string, {
        queries: number;
        impressions: number;
        clicks: number;
    }>;
    total_conversation_queries: number;
    total_conversation_impressions: number;
    excluded_ordinary_matches: number;
    buckets: {
        [k: string]: {
            meaning: string;
            total_matched: number;
            rows: BucketRow[];
        };
    };
    artefact_timeline_monthly: {
        month: string;
        impressions: number;
        clicks: number;
    }[] | undefined;
    what_this_cannot_see: string[];
}>;
export {};
