import { GscError } from "./errors.js";

// Google Search's News tab (news) is distinct from Google News (googleNews).
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
// https://support.google.com/webmasters/answer/9216516
// https://support.google.com/webmasters/answer/10083653
export interface AnalyticsRuleFilter { dimension: string; operator?: string; expression?: string }
export interface AnalyticsRuleInput {
  dimensions?: readonly string[];
  filters?: readonly AnalyticsRuleFilter[];
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
  const filters = input.filters ?? [];
  const names = [...dimensions, ...filters.map((filter) => filter.dimension)];
  const reportType = resolveReportType(input);
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
