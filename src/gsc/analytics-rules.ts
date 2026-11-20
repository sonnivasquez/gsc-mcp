import { z } from "zod";
import { GscError } from "./errors.js";

export const FILTER_LIST_DIMENSIONS = ["country", "device"] as const;
export const analyticsFilterListsSchema = z.array(z.object({
  dimension: z.enum(FILTER_LIST_DIMENSIONS),
  expressions: z.array(z.string()).min(1),
}).strict()).min(1);

export type AnalyticsFilterList = z.infer<typeof analyticsFilterListsSchema>[number];

// Google Search's News tab (news) is distinct from Google News (googleNews).
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
// https://support.google.com/webmasters/answer/9216516
// https://support.google.com/webmasters/answer/10083653
export interface AnalyticsRuleFilter { dimension: string; operator?: string; expression?: string }
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

export function resolveReportType(input: AnalyticsRuleInput): string {
  return input.searchType ?? input.type ?? "web";
}

function reject(message: string, suggestedAction: string): never {
  throw new GscError("INVALID_ARGUMENT", message, { suggestedAction });
}

export function assertSearchAnalyticsRules(input: AnalyticsRuleInput): void {
  const dimensions = input.dimensions ?? [];
  const groups = [input, ...(input.dimensionFilterGroups ?? [])];
  const filters = groups.flatMap(group => group.filters ?? []);
  const filterDimensions = new Set(filters.map(filter => filter.dimension));
  const names = [...dimensions, ...filterDimensions];
  for (const group of groups) {
    if (group.filterLists === undefined) continue;
    const parsed = analyticsFilterListsSchema.safeParse(group.filterLists);
    if (!parsed.success) {
      reject('filterLists must contain country or device entries with non-empty string arrays.', 'Omit filterLists or provide entries with a dimension and one or more expressions.');
    }
    for (const { dimension, expressions } of parsed.data) {
      if (filterDimensions.has(dimension)) {
        reject(`"${dimension}" cannot appear in both filters and filterLists in the same request.`, `Use only filters or only filterLists for "${dimension}".`);
      }
      if (dimension === "country" && expressions.some(value => !/^[a-z]{3}$/i.test(value))) {
        reject('country filterLists require three-letter country codes.', 'Use ISO 3166-1 alpha-3 codes such as PER or USA.');
      }
      if (dimension === "device" && expressions.some(value => !["DESKTOP", "MOBILE", "TABLET"].includes(value))) {
        reject('device filterLists require DESKTOP, MOBILE, or TABLET.', 'Use one or more of DESKTOP, MOBILE, and TABLET.');
      }
      names.push(dimension);
    }
  }
  if ((dimensions.includes("brandedClassification") || filterDimensions.has("brandedClassification")) && filterDimensions.has("query")) {
    reject('brandedClassification cannot be combined with a query filter.', 'Remove the query filter or remove brandedClassification from the request.');
  }
  if (filters.some(f => f.dimension === "brandedClassification" && (f.operator !== "equals" || (f.expression !== "BRANDED" && f.expression !== "NON_BRANDED")))) {
    reject('brandedClassification filters require equals and a supported classification.', 'Use operator "equals" with "BRANDED" or "NON_BRANDED".');
  }
  const reportType = resolveReportType(input);
  if (reportType === "webMultimodal" && dimensions.includes("query")) {
    reject('type "webMultimodal" does not support the query dimension.', 'Group by another dimension such as page, country, or date.');
  }
  if (reportType === "discover") {
    const blocked = ["query", "device"].filter((name) => names.includes(name));
    if (blocked.length) reject(`type "discover" does not support ${blocked.join(" or ")} dimensions or filters.`, `Remove ${blocked.join(" and ")} from dimensions and filters.`);
  }
  if (reportType === "googleNews" && names.includes("query")) {
    reject('type "googleNews" does not support the query dimension or filter.', 'Remove query from dimensions and filters.');
  }
  if (dimensions.includes("searchAppearance") && dimensions.length !== 1) {
    reject('searchAppearance must be queried alone; filter a returned appearance in a second query.', 'Group by searchAppearance alone, then filter with operator "equals".');
  }
  if (filters.some((f) => f.dimension === "searchAppearance" && f.operator !== undefined && f.operator !== "equals")) {
    reject('searchAppearance filters must use operator "equals".', 'Filter searchAppearance with operator "equals".');
  }
  const aggregation = input.aggregationType;
  if (aggregation !== undefined && aggregation !== "" && !["auto", "byPage", "byProperty", "byNewsShowcasePanel"].includes(aggregation)) {
    reject('invalid aggregationType', 'Use auto, byPage, byProperty, or byNewsShowcasePanel.');
  }
  if (aggregation === "byProperty" && (reportType === "discover" || reportType === "googleNews")) {
    reject(`aggregationType "byProperty" is not supported for type "${reportType}".`, 'Use aggregationType "byPage" or "auto".');
  }
  if (aggregation === "byProperty" && names.includes("page")) {
    reject('aggregationType "byProperty" cannot be combined with page dimensions or filters.', 'Remove page or use aggregationType "auto".');
  }
  if (aggregation === "byNewsShowcasePanel") {
    const appearances = filters.filter(f => f.dimension === "searchAppearance");
    if (!["discover", "googleNews"].includes(reportType) || names.includes("page") || appearances.length !== 1 || (appearances[0].operator ?? "equals") !== "equals" || appearances[0].expression !== "NEWS_SHOWCASE") {
      reject('aggregationType "byNewsShowcasePanel" requires discover or googleNews, a NEWS_SHOWCASE equals filter, and no page dimension or filter.', 'Use the NEWS_SHOWCASE filter and remove page, or use auto.');
    }
  }
}
