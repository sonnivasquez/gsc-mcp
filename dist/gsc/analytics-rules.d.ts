import { z } from "zod";
export declare const FILTER_LIST_DIMENSIONS: readonly ["country", "device"];
export declare const analyticsFilterListsSchema: z.ZodArray<z.ZodObject<{
    dimension: z.ZodEnum<["country", "device"]>;
    expressions: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    dimension: "country" | "device";
    expressions: string[];
}, {
    dimension: "country" | "device";
    expressions: string[];
}>, "many">;
export type AnalyticsFilterList = z.infer<typeof analyticsFilterListsSchema>[number];
export interface AnalyticsRuleFilter {
    dimension: string;
    operator?: string;
    expression?: string;
}
interface AnalyticsRuleConditions {
    filters?: readonly AnalyticsRuleFilter[];
    filterLists?: readonly AnalyticsFilterList[];
}
export interface AnalyticsRuleInput extends AnalyticsRuleConditions {
    dimensions?: readonly string[];
    dimensionFilterGroups?: readonly AnalyticsRuleConditions[];
    searchType?: string;
    type?: string;
    aggregationType?: string;
}
export declare function resolveReportType(input: AnalyticsRuleInput): string;
export declare function assertSearchAnalyticsRules(input: AnalyticsRuleInput): void;
export {};
