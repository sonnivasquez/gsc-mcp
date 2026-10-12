import type { AnalyticsRow } from "./client.js";
export declare const OPPORTUNITY_RULE_VERSION = "t11.1";
export type OpportunityKind = "low_ctr" | "striking_distance" | "declining" | "ctr_benchmark" | "low_clicks";
export interface Opportunity {
    key: string;
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
    reason: string;
    scenarioExtraClicks?: number;
}
export interface OpportunityResult {
    kind: OpportunityKind;
    ruleVersion: string;
    thresholds: Record<string, number | string>;
    candidates: Opportunity[];
    limitation: string;
}
export interface LowCtrOpts {
    minImpressions?: number;
    minPosition?: number;
    maxPosition?: number;
    maxCtr?: number;
    targetCtr?: number;
}
export declare function lowCtr(rows: AnalyticsRow[], opts?: LowCtrOpts): OpportunityResult;
export interface StrikingDistanceOpts {
    minPosition?: number;
    maxPosition?: number;
    minImpressions?: number;
}
export declare function strikingDistance(rows: AnalyticsRow[], opts?: StrikingDistanceOpts): OpportunityResult;
export interface DecliningOpts {
    windowDays?: number;
    minBaseClicks?: number;
    minDeclinePct?: number;
}
export declare function declining(windows: [AnalyticsRow[], AnalyticsRow[], AnalyticsRow[]], opts?: DecliningOpts): OpportunityResult;
export interface BenchmarkOpts {
    curve?: Array<{
        maxPosition: number;
        expectedCtr: number;
    }>;
    minImpressions?: number;
}
export declare function ctrBenchmark(rows: AnalyticsRow[], opts?: BenchmarkOpts): OpportunityResult;
export interface LowClicksOpts {
    minImpressions?: number;
    maxClicks?: number;
}
export declare function lowClicks(rows: AnalyticsRow[], opts?: LowClicksOpts): OpportunityResult;
export declare function findOpportunities(kind: string, rows: AnalyticsRow[], opts?: LowCtrOpts & StrikingDistanceOpts & DecliningOpts & BenchmarkOpts & LowClicksOpts & {
    windows?: [AnalyticsRow[], AnalyticsRow[], AnalyticsRow[]];
}): OpportunityResult;
