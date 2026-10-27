export interface AnalyticsRuleFilter {
    dimension: string;
    operator?: string;
}
export interface AnalyticsRuleInput {
    dimensions?: readonly string[];
    filters?: readonly AnalyticsRuleFilter[];
    /** Tool input name. Mapped to the Google `type` field. */
    searchType?: string;
    /** Already-mapped report type, used by the googleapis helper. */
    type?: string;
    aggregationType?: string;
}
export declare function resolveReportType(input: AnalyticsRuleInput): string;
export declare function assertSearchAnalyticsRules(input: AnalyticsRuleInput): void;
