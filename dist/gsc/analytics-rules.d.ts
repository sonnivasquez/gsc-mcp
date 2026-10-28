export interface AnalyticsRuleFilter {
    dimension: string;
    operator?: string;
    expression?: string;
}
export interface AnalyticsRuleInput {
    dimensions?: readonly string[];
    filters?: readonly AnalyticsRuleFilter[];
    searchType?: string;
    type?: string;
    aggregationType?: string;
}
export declare function resolveReportType(input: AnalyticsRuleInput): string;
export declare function assertSearchAnalyticsRules(input: AnalyticsRuleInput): void;
