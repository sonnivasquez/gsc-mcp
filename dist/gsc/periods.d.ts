export interface DateRange {
    startDate: string;
    endDate: string;
}
export type Preset = "last_7_days" | "last_28_days" | "last_90_days";
export type BaselineMode = "previous_period" | "previous_year";
export interface PeriodSpec {
    preset?: string;
    startDate?: string;
    endDate?: string;
    baseline?: string | DateRange;
}
export interface ResolvedPeriods {
    current: DateRange;
    baseline: DateRange | null;
    resolution: "conservative_lag" | "explicit";
    warnings: string[];
}
export declare function shiftDays(range: DateRange, days: number): DateRange;
export declare function resolvePeriods(spec: PeriodSpec, refNow?: Date): ResolvedPeriods;
