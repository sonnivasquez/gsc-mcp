import { GscError } from "./errors.js";

// Search Analytics request rules, checked before any Google call.
//
// `searchType` is deprecated. Requests send `type`:
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
//
// Discover groups and filters by page, country, appearance, and date. It has
// no query dimension and no device dimension:
// https://support.google.com/webmasters/answer/9216516
//
// Google News (`type=googleNews`) groups by page, country, date, device, and
// appearance. It has no query dimension:
// https://support.google.com/webmasters/answer/10083653
// The News tab (`type=news`) is a separate report type on the query method
// and likewise rejects `query`:
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
//
// `searchAppearance` cannot be a column next to other dimensions. Group by it
// alone, then filter a follow-up query with operator `equals`:
// https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
//
// `aggregationType=byProperty` is not supported for `type=discover` or
// `type=googleNews` (News tab `type=news` may still use it):
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query

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

type ReportType = "web" | "image" | "video" | "news" | "discover" | "googleNews";

const REPORT_TYPES: readonly ReportType[] = ["web", "image", "video", "news", "discover", "googleNews"];

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

export function resolveReportType(input: AnalyticsRuleInput): string {
  return input.searchType ?? input.type ?? "web";
}

function reject(message: string, suggestedAction: string): never {
  throw new GscError("INVALID_ARGUMENT", message, { suggestedAction });
}

function discoverBan(names: readonly string[]): void {
  const blocked = names.filter((name) => name === "query" || name === "device");
  if (blocked.length === 0) return;
  const label = blocked.length === 2 ? "query or device dimensions" : `${blocked[0]} dimension`;
  const listed = blocked.join(" and ");
  reject(
    `type "discover" does not support the ${label}. Remove ${listed} from dimensions and filters. Group Discover by page, country, date, or searchAppearance.`,
    `Remove ${listed} and group Discover by page, country, date, or searchAppearance.`,
  );
}

function newsQueryBan(reportType: "news" | "googleNews", names: readonly string[]): void {
  if (!names.includes("query")) return;
  reject(
    `type "${reportType}" does not support the query dimension. Remove query from dimensions and filters. Group by page, country, device, date, or searchAppearance.`,
    "Remove query and group by page, country, device, date, or searchAppearance.",
  );
}

function appearanceRules(dimensions: readonly string[], filters: readonly AnalyticsRuleFilter[]): void {
  if (dimensions.includes("searchAppearance") && dimensions.length !== 1) {
    reject(
      'searchAppearance cannot be grouped with other dimensions. Group by searchAppearance alone to list the values, then filter with operator "equals" on a second query that groups by the other dimensions.',
      'Group by searchAppearance alone, then filter with operator "equals".',
    );
  }
  const mismatched = filters.find((filter) => filter.dimension === "searchAppearance" && filter.operator !== undefined && filter.operator !== "equals");
  if (mismatched) {
    reject(
      'searchAppearance filters must use operator "equals". Group by searchAppearance alone to learn the values, then filter with equals.',
      'Filter searchAppearance with operator "equals".',
    );
  }
}

function propertyAggregation(reportType: string, aggregationType: string | undefined): void {
  if (aggregationType !== "byProperty") return;
  if (reportType !== "discover" && reportType !== "googleNews") return;
  reject(
    `aggregationType "byProperty" is not supported for type "${reportType}". Use "byPage" or "auto", or omit aggregationType.`,
    'Use aggregationType "byPage" or "auto", or omit aggregationType.',
  );
}

function applyReportRules(reportType: ReportType, names: readonly string[]): void {
  switch (reportType) {
    case "discover":
      discoverBan(names);
      return;
    case "news":
    case "googleNews":
      newsQueryBan(reportType, names);
      return;
    case "web":
    case "image":
    case "video":
      return;
    default: {
      const unexpected: never = reportType;
      reject(`unexpected report type "${unexpected}"`, "use web, image, video, news, discover, or googleNews");
    }
  }
}

export function assertSearchAnalyticsRules(input: AnalyticsRuleInput): void {
  const dimensions = input.dimensions ?? [];
  const filters = input.filters ?? [];
  const names = [...dimensions, ...filters.map((filter) => filter.dimension)];
  const reportType = resolveReportType(input);
  if (isReportType(reportType)) applyReportRules(reportType, names);
  appearanceRules(dimensions, filters);
  propertyAggregation(reportType, input.aggregationType);
}
