import { getSearchConsoleClient, resolveSiteUrl, SearchConsoleClient } from "./auth.js";
import { assertSiteAllowed } from "./profiles.js";
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
  // Fail-closed pull cap: when set, fetchAllRows aborts once the accumulated
  // rows reach this total. A full last page means more data is likely, so it
  // throws REQUEST_BUDGET_EXCEEDED instead of returning partial data.
  maxTotalRows?: number;
  // GSC Search Analytics `type` filter. Values: web (default), image, video,
  // news, discover, googleNews. Added in v2.3 to unlock image-search data.
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function getDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday (latest available)
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

export function getPriorDateRange(days: number): { startDate: string; endDate: string } {
  const currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() - 1);
  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - days + 1);

  const priorEnd = new Date(currentStart);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - days + 1);

  return {
    startDate: formatDate(priorStart),
    endDate: formatDate(priorEnd),
  };
}

/**
 * Fetches all rows from the Search Analytics API with automatic pagination.
 * Uses dataState: 'all' so data matches the GSC dashboard exactly.
 */
export async function fetchAllRows(params: QueryParams, siteUrlOverride?: string, clientOverride?: SearchConsoleClient): Promise<SearchAnalyticsRow[]> {
  const client = clientOverride ?? await getSearchConsoleClient();
  const siteUrl = resolveSiteUrl(siteUrlOverride);
  assertSiteAllowed(siteUrl);
  const allRows: SearchAnalyticsRow[] = [];
  const pageSize = params.rowLimit || 25000;
  let startRow = 0;

  while (true) {
    const response = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        dimensionFilterGroups: params.dimensionFilterGroups,
        rowLimit: pageSize,
        startRow,
        dataState: "all",
        // Pass through the type filter when provided. Defaults server-side to
        // `web` when omitted, matching prior behaviour.
        ...(params.type ? { type: params.type } : {}),
      },
    });

    const rows = response.data.rows;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      allRows.push({
        keys: row.keys || [],
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      });
    }

    if (params.maxTotalRows !== undefined && allRows.length >= params.maxTotalRows) {
      if (rows.length === pageSize) {
        throw new GscError(
          "REQUEST_BUDGET_EXCEEDED",
          `GenAI pull exceeded ${params.maxTotalRows} rows; narrow \`days\` and retry (no partial data returned)`,
          { suggestedAction: "narrow `days` to a smaller window and retry" }
        );
      }
      break;
    }

    if (rows.length < pageSize) break;
    startRow += pageSize;
  }

  return allRows;
}
