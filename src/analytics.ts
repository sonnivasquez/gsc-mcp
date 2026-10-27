import { getSearchConsoleClient, resolveSiteUrl, type SearchConsoleClient } from "./auth.js";
import { assertSiteAllowed } from "./profiles.js";
import { assertSearchAnalyticsRules } from "./gsc/analytics-rules.js";
import { GscError } from "./gsc/errors.js";

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryParams {
  startDate: string;
  endDate: string;
  dimensions: string[];
  dimensionFilterGroups?: Array<{
    filters: Array<{
      dimension: string;
      operator: string;
      expression: string;
    }>;
  }>;
  rowLimit?: number;
  maxTotalRows?: number;
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  aggregationType?: string;
}

interface AnalyticsPage {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function moveDays(date: Date, delta: number): Date {
  const moved = new Date(date.getTime());
  moved.setDate(moved.getDate() + delta);
  return moved;
}

function windowEndingYesterday(days: number, extraShift: number): { startDate: string; endDate: string } {
  const end = moveDays(new Date(), -1 + extraShift);
  const start = moveDays(end, 1 - days);
  return { startDate: dayStamp(start), endDate: dayStamp(end) };
}

export function getDateRange(days: number): { startDate: string; endDate: string } {
  return windowEndingYesterday(days, 0);
}

export function getPriorDateRange(days: number): { startDate: string; endDate: string } {
  return windowEndingYesterday(days, -days);
}

function budgetExceeded(limit: number): GscError {
  return new GscError(
    "REQUEST_BUDGET_EXCEEDED",
    phrase([
      "GenAI pull exceeded ",
      String(limit),
      " rows; narrow `days` and retry ",
      "(no partial data returned)",
    ]),
    { suggestedAction: phrase(["narrow `days` to a smaller window ", "and retry"]) },
  );
}

function asRow(raw: AnalyticsPage): SearchAnalyticsRow {
  return {
    keys: raw.keys || [],
    clicks: raw.clicks || 0,
    impressions: raw.impressions || 0,
    ctr: raw.ctr || 0,
    position: raw.position || 0,
  };
}

function requestBody(params: QueryParams, startRow: number, pageSize: number): Record<string, unknown> {
  const filters = (params.dimensionFilterGroups ?? []).flatMap((group) => group.filters);
  assertSearchAnalyticsRules({
    dimensions: params.dimensions,
    filters,
    type: params.type,
    aggregationType: params.aggregationType,
  });
  const body: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions: params.dimensions,
    dimensionFilterGroups: params.dimensionFilterGroups,
    rowLimit: pageSize,
    startRow,
    dataState: "all",
  };
  if (params.type) body.type = params.type;
  if (params.aggregationType) body.aggregationType = params.aggregationType;
  return body;
}

export async function fetchAllRows(
  params: QueryParams,
  siteUrlOverride?: string,
  clientOverride?: SearchConsoleClient,
): Promise<SearchAnalyticsRow[]> {
  const client = clientOverride ?? (await getSearchConsoleClient());
  const siteUrl = resolveSiteUrl(siteUrlOverride);
  assertSiteAllowed(siteUrl);
  const collected: SearchAnalyticsRow[] = [];
  const pageSize = params.rowLimit || 25000;
  let startRow = 0;

  for (;;) {
    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: requestBody(params, startRow, pageSize),
    });
    const page = response.data.rows;
    if (!page || page.length === 0) break;
    for (const raw of page) collected.push(asRow(raw));

    const reachedCap = params.maxTotalRows !== undefined && collected.length >= params.maxTotalRows;
    const fullPage = page.length === pageSize;
    if (reachedCap && fullPage) throw budgetExceeded(params.maxTotalRows as number);
    if (reachedCap || !fullPage) break;
    startRow += pageSize;
  }

  return collected;
}
