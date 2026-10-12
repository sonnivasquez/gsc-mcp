import type { AnalyticsRow } from "./client.js";
export type Observation = "observed_in_both" | "not_observed_in_current" | "not_observed_in_baseline";
export interface Metrics {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface ComparedRow {
    key: string;
    observation: Observation;
    current: Metrics | null;
    baseline: Metrics | null;
    deltaClicks: number | null;
    deltaClicksPct: number | null;
    deltaClicksPctReason?: "ZERO_BASELINE";
    deltaImpressions: number | null;
    deltaImpressionsPct: number | null;
    deltaImpressionsPctReason?: "ZERO_BASELINE";
    deltaCtrPp: number | null;
    deltaPosition: number | null;
    positionImprovement: number | null;
}
export interface Comparison {
    compared: ComparedRow[];
    notObservedInCurrent: ComparedRow[];
    notObservedInBaseline: ComparedRow[];
}
export type CompareOrder = "deltaClicks" | "deltaImpressions" | "deltaCtrPp" | "positionImprovement";
export declare function comparePeriods(currentRows: AnalyticsRow[], baselineRows: AnalyticsRow[], orderBy?: CompareOrder, direction?: "asc" | "desc"): Comparison;
export interface Totals {
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
}
export declare function sumTotals(rows: AnalyticsRow[]): Totals;
