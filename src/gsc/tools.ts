import { CANONICAL_TOOLS } from "./catalog.js";
export { CANONICAL_TOOLS } from "./catalog.js";
export type { CapabilityKind, CapabilityInfo } from "./catalog.js";
import { getAuthProvider } from "../auth-provider.js";
import type { AuthProvider } from "../auth-provider.js";
import { assertWriteEnabled } from "../auth.js";
import { CLI_VERSION } from "../doctor.js";
import { getInstanceAlias, getInstanceAllowlist, isAllowAllAllowlist } from "../profiles.js";
import { RequestBudget } from "./budget.js";
import { FetchGscDataSource } from "./client.js";
import type { AnalyticsQuery, AnalyticsRow } from "./client.js";
import { fail, ok } from "./envelope.js";
import type { Coverage, Provenance, ToolEnvelope } from "./envelope.js";
import { assertSearchAnalyticsRules } from "./analytics-rules.js";
import { GscError } from "./errors.js";
import { datasets } from "./datasets.js";
import type { DatasetStore } from "./datasets.js";
import { resolvePeriods, shiftDays } from "./periods.js";
import type { DateRange, ResolvedPeriods } from "./periods.js";
import { declining, OPPORTUNITY_RULE_VERSION, findOpportunities } from "./opportunities.js";
import type { OpportunityResult } from "./opportunities.js";
import { detectCannibalization, CANNIBALIZATION_RULE_VERSION } from "./cannibalization.js";
import { analyzeSegments, SEGMENTS_RULE_VERSION } from "./segments.js";
import { exportDataset } from "./export.js";
import { dataDir } from "../profiles.js";
import { comparePeriods, sumTotals } from "./compare.js";
import type { CompareOrder, ComparedRow, Totals } from "./compare.js";
import type { CannibalizationCandidate } from "./cannibalization.js";
export interface ToolDeps {
  provider?: AuthProvider;
  fetchImpl?: typeof fetch;
  budget?: RequestBudget;
  allowlist?: string[] | null;
  profileAlias?: string;
  store?: DatasetStore;
}

// --- T01 gsc_capabilities ---

export interface CompareTotalsData {
  current: Totals;
  baseline: Totals;
  deltaClicks: number;
  deltaClicksPct: number | null;
  deltaImpressions: number;
}

export interface CompareDimensionalData {
  compared: ComparedRow[];
  comparedTotal: number;
  notObservedInCurrent: ComparedRow[];
  notObservedInCurrentTotal: number;
  notObservedInBaseline: ComparedRow[];
  notObservedInBaselineTotal: number;
}

export interface CannibalizationData {
  candidates: CannibalizationCandidate[];
  candidatesTotal: number;
  ruleVersion: string;
}
export interface AlertsData {
  alerts: Alert[];
  alertsTotal: number;
  ruleVersion: string;
}
export interface ContentCandidate {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  observedPages: string[];
  contentPresence: string;
  reason: string;
}

export interface CandidatesData {
  candidates: ContentCandidate[];
  candidatesTotal: number;
}

function source(deps: ToolDeps = {}): { ds: FetchGscDataSource; budget: RequestBudget; allowlist: string[] | null } {
  const budget = deps.budget ?? new RequestBudget();
  const allowlist = deps.allowlist !== undefined ? deps.allowlist : getInstanceAllowlist();
  const ds = new FetchGscDataSource(deps.provider ?? getAuthProvider(), {
    budget,
    fetchImpl: deps.fetchImpl,
    allowlist,
  });
  return { ds, budget, allowlist };
}

export const SUPPORTED_DIMENSIONS = ["date", "page", "query", "country", "device", "searchAppearance"];
export const SUPPORTED_SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"];

export function gscCapabilities(deps: ToolDeps = {}): ToolEnvelope<Record<string, unknown>> {
  const allowlist = deps.allowlist !== undefined ? deps.allowlist : getInstanceAllowlist();
  const provider = deps.provider ?? getAuthProvider();
  const described = provider.describe();
  // Explicit allow-all stays exactly `["all"]` in the display: it covers
  // every current + future property and is distinct from an empty allowlist.
  const allowAll = isAllowAllAllowlist(allowlist);
  // The write trio is gated at execution by assertWriteEnabled (full scope
  // plus GSC_ENABLE_WRITE=1): probe that same gate here so capabilities
  // stops claiming them disabled on installs where they actually run.
  let writesDisabled = true;
  try {
    assertWriteEnabled("capabilities probe");
    writesDisabled = false;
  } catch {
    writesDisabled = true;
  }
  return ok(
    {
      version: CLI_VERSION,
      tools: CANONICAL_TOOLS,
      auth: described,
      activeProfileAlias: getInstanceAlias(),
      allowedSites: allowlist,
      limits: {
        resultLimitDefault: 50,
        resultLimitMax: 200,
        maxFetchRowsDefault: 5000,
        maxFetchRowsMax: 50000,
        inspectUrlsMax: 10,
        inspectConcurrency: 3,
        dataAttemptsMax: 12,
        responseBytesTarget: 48 * 1024,
      },
      supportedDimensions: SUPPORTED_DIMENSIONS,
      supportedSearchTypes: SUPPORTED_SEARCH_TYPES,
      dataStates: ["final", "all"],
      disabledCapabilities: [
        ...(writesDisabled ? ["gsc_submit_url", "gsc_submit_batch", "gsc_submit_sitemap"] : []),
        "gsc_image_page_audit",
        "gsc_genai_conversation_queries",
      ],
    },
    { source: "local_status", fetchedAt: null },
    {
      warnings:
        allowlist !== null && !allowAll && allowlist.length === 0
          ? [{ code: "NO_ALLOWLIST", message: "instance allowlist is empty: property tools will refuse every call" }]
          : [],
    }
  );
}

// --- T02 gsc_list_sites ---

export async function gscListSites(deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const { ds, budget, allowlist } = source(deps);
  const fetchedAt = new Date().toISOString();
  try {
    const all = await ds.listSites();
    // The model only ever sees this instance's authorized properties.
    // Explicit allow-all (`["all"]`) returns every visible property with
    // no allowlist truncation; future properties are included automatically.
    const allowAll = isAllowAllAllowlist(allowlist);
    const sites = allowlist === null || allowAll ? all : all.filter((s) => allowlist.includes(s.siteUrl));
    return ok({ sites }, { source: "google_search_console", fetchedAt }, {
      attempts: budget.attemptsUsed,
      coverage: {
        sourceGuarantee: "resource_response",
        apiPaginationComplete: true,
        fetchedRows: all.length,
        returnedRows: sites.length,
        truncatedByProduct: sites.length < all.length,
        stoppedBecause: sites.length < all.length ? ["instance_allowlist"] : [],
      },
    });
  } catch (err) {
    return fail(err);
  }
}

export interface SearchAnalyticsInput {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  preset?: string;
  dimensions: string[];
  filters?: Array<{ dimension: string; operator: string; expression: string }>;
  searchType?: string;
  dataState?: string;
  aggregationType?: string;
  sortBy?: string;
  sortDirection?: string;
  resultLimit?: number;
  maxFetchRows?: number;
}

export type SortField = "clicks" | "impressions" | "ctr" | "position";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validatedQuery(input: SearchAnalyticsInput): { query: AnalyticsQuery; sortBy: SortField; desc: boolean; limit: number } {
  if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
    throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
  }
  let startDate = input.startDate;
  let endDate = input.endDate;
  if ((startDate === undefined || endDate === undefined) && input.preset !== undefined) {
    const resolved = resolvePeriods({ preset: input.preset });
    startDate = resolved.current.startDate;
    endDate = resolved.current.endDate;
  }
  if (startDate === undefined || endDate === undefined || !validDate(startDate) || !validDate(endDate)) {
    throw new GscError("INVALID_ARGUMENT", "startDate/endDate must be real calendar dates in YYYY-MM-DD (or pass a valid preset)");
  }
  if (startDate > endDate) {
    throw new GscError("INVALID_ARGUMENT", "startDate must not be after endDate");
  }
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) {
    throw new GscError("INVALID_ARGUMENT", "dimensions must be a non-empty list");
  }
  for (const d of input.dimensions) {
    if (!SUPPORTED_DIMENSIONS.includes(d)) {
      throw new GscError("INVALID_ARGUMENT", `dimension "${d}" is not supported (supported: ${SUPPORTED_DIMENSIONS.join(", ")})`);
    }
  }
  const searchType = input.searchType ?? "web";
  if (!SUPPORTED_SEARCH_TYPES.includes(searchType)) {
    throw new GscError("INVALID_ARGUMENT", `searchType "${searchType}" is not supported`);
  }
  const dataState = input.dataState ?? "final";
  if (dataState !== "final" && dataState !== "all") {
    throw new GscError("INVALID_ARGUMENT", 'dataState must be "final" or "all"');
  }
  const sortBy = (input.sortBy ?? "clicks") as SortField;
  if (!["clicks", "impressions", "ctr", "position"].includes(sortBy)) {
    throw new GscError("INVALID_ARGUMENT", "sortBy must be clicks, impressions, ctr or position");
  }
  const desc = (input.sortDirection ?? "desc") !== "asc";
  if (input.sortDirection !== undefined && input.sortDirection !== "asc" && input.sortDirection !== "desc") {
    throw new GscError("INVALID_ARGUMENT", 'sortDirection must be "asc" or "desc"');
  }
  const limit = input.resultLimit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new GscError("INVALID_ARGUMENT", "resultLimit must be an integer between 1 and 200");
  }
  const maxFetchRows = input.maxFetchRows ?? 5000;
  if (!Number.isInteger(maxFetchRows) || maxFetchRows < 1 || maxFetchRows > 50000) {
    throw new GscError("INVALID_ARGUMENT", "maxFetchRows must be an integer between 1 and 50000");
  }
  for (const f of input.filters ?? []) {
    if (typeof f.dimension !== "string" || typeof f.operator !== "string" || typeof f.expression !== "string") {
      throw new GscError("INVALID_ARGUMENT", "filters need string dimension, operator and expression");
    }
  }
  const aggregationType = input.aggregationType === undefined || input.aggregationType === ""
    ? undefined
    : input.aggregationType;
  assertSearchAnalyticsRules({
    dimensions: input.dimensions,
    filters: input.filters,
    searchType,
    aggregationType,
  });
  return {
    query: {
      startDate,
      endDate,
      dimensions: input.dimensions,
      filters: input.filters,
      searchType: searchType as AnalyticsQuery["searchType"],
      dataState: dataState as AnalyticsQuery["dataState"],
      aggregationType,
      maxFetchRows,
    },
    sortBy,
    desc,
    limit,
  };
}

function sortRows(rows: AnalyticsRow[], sortBy: SortField, desc: boolean): AnalyticsRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const diff = (a[sortBy] - b[sortBy]) * dir;
    if (diff !== 0) return diff;
    return a.keys.join("\u0000") < b.keys.join("\u0000") ? -1 : 1;
  });
}

function registerDataset(deps: ToolDeps, dimensions: string[], rows: AnalyticsRow[]): { datasetId: string; datasetExpiresAt: string } {
  const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
  const store = deps.store ?? datasets;
  const columns = [...dimensions, "clicks", "impressions", "ctr", "position"];
  const records = rows.map((r) => {
    const rec: Record<string, number | string | null> = {};
    dimensions.forEach((d, i) => {
      rec[d] = r.keys[i] ?? null;
    });
    rec.clicks = r.clicks;
    rec.impressions = r.impressions;
    rec.ctr = r.ctr;
    rec.position = r.position;
    return rec;
  });
  const created = store.create(alias, columns, records);
  return { datasetId: created.id, datasetExpiresAt: created.expiresAt };
}
export async function gscSearchAnalytics(input: SearchAnalyticsInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    const { query, sortBy, desc, limit } = validatedQuery(input);
    const { ds, budget } = source(deps);
    const result = await ds.queryAnalytics(input.siteUrl, query);
    const sorted = sortRows(result.rows, sortBy, desc);
    const returned = sorted.slice(0, limit);
    const coverage: Coverage = {
      sourceGuarantee: "top_rows_not_exhaustive",
      apiPaginationComplete: !result.truncated,
      fetchedRows: result.rows.length,
      returnedRows: returned.length,
      truncatedByProduct: result.truncated || result.rows.length > limit,
      stoppedBecause: result.truncated ? ["maxFetchRows"] : [],
      sortAppliedTo: "retrieved_dataset",
    };
    const sourceDetails = { fetchedRows: result.rows.length, returnedRows: returned.length, sortedWithin: "retrieved_dataset" };
    const sourceWarning = {
      code: "SOURCE_NOT_EXHAUSTIVE",
      message: "Rows describe what GSC returned for this query, not every search the site could receive.",
      details: sourceDetails,
    };
    return ok(
      { rows: returned, responseAggregationType: "by_row", dimensions: query.dimensions },
      {
        source: "google_search_console",
        fetchedAt,
        siteUrl: input.siteUrl,
        period: { startDate: query.startDate, endDate: query.endDate },
        searchType: query.searchType,
        dataState: query.dataState,
      },
      {
        coverage,
        attempts: budget.attemptsUsed,
        ...registerDataset(deps, query.dimensions, sorted),
        warnings: [sourceWarning],
        shrink: (data) => {
          if (data.rows.length <= 1) return null;
          const smaller = data.rows.slice(0, Math.ceil(data.rows.length / 2));
          coverage.returnedRows = smaller.length;
          sourceDetails.returnedRows = smaller.length;
          coverage.truncatedByProduct = true;
          return { ...data, rows: smaller };
        },
      }
    );
  } catch (err) {
    return fail(err);
  }
}

// --- T08 gsc_inspect_urls ---

export interface InspectInput {
  siteUrl: string;
  urls: string[];
  languageCode?: string;
}

export interface UrlResult {
  url: string;
  status: "ok" | "error";
  result?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

async function inspectOne(
  ds: FetchGscDataSource,
  siteUrl: string,
  url: string,
  languageCode: string | undefined
): Promise<UrlResult> {
  try {
    const result = await ds.inspectUrl(siteUrl, url, languageCode);
    return { url, status: "ok", result };
  } catch (err) {
    if (err instanceof GscError) {
      return { url, status: "error", error: { code: err.code, message: err.message, retryable: err.retryable } };
    }
    return { url, status: "error", error: { code: "UPSTREAM_ERROR", message: String(err), retryable: false } };
  }
}

export async function gscInspectUrls(input: InspectInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 10) {
      throw new GscError("INVALID_ARGUMENT", "urls must hold between 1 and 10 URLs");
    }
    const { ds, budget } = source(deps);
    const results: UrlResult[] = new Array(input.urls.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(3, input.urls.length) }, async () => {
      while (next < input.urls.length) {
        const i = next++;
        results[i] = await inspectOne(ds, input.siteUrl, input.urls[i], input.languageCode);
      }
    });
    await Promise.all(workers);
    const failed = results.filter((r) => r.status === "error").length;
    return ok({ results }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      coverage: {
        sourceGuarantee: "resource_response",
        apiPaginationComplete: true,
        fetchedRows: results.length,
        returnedRows: results.length,
        truncatedByProduct: false,
        stoppedBecause: [],
      },
      warnings:
        failed > 0
          ? [{ code: "PARTIAL", message: `${failed} of ${results.length} inspections failed; successes are preserved` }]
          : [],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T09 gsc_list_sitemaps ---

export async function gscListSitemaps(siteUrl: string, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof siteUrl !== "string" || siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const { ds, budget } = source(deps);
    const sitemaps = await ds.listSitemaps(siteUrl);
    return ok({ sitemaps }, { source: "google_search_console", fetchedAt, siteUrl }, {
      attempts: budget.attemptsUsed,
      coverage: {
        sourceGuarantee: "resource_response",
        apiPaginationComplete: true,
        fetchedRows: sitemaps.length,
        returnedRows: sitemaps.length,
        truncatedByProduct: false,
        stoppedBecause: [],
      },
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T10 gsc_get_dataset ---

export interface GetDatasetInput {
  datasetId: string;
  cursor?: string;
  limit?: number;
  columns?: string[];
}

export async function gscGetDataset(input: GetDatasetInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    if (typeof input.datasetId !== "string" || input.datasetId.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "datasetId is required");
    }
    const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    const store = deps.store ?? datasets;
    const page = store.page(input.datasetId, alias, {
      cursor: input.cursor,
      limit: input.limit,
      columns: input.columns,
    });
    return ok(
      page,
      { source: "local_dataset", fetchedAt: null },
      {
        coverage: {
          sourceGuarantee: "resource_response",
          apiPaginationComplete: null,
          fetchedRows: page.totalRows,
          returnedRows: page.rows.length,
          truncatedByProduct: false,
          stoppedBecause: [],
        },
      }
    );
  } catch (err) {
    return fail(err);
  }
}

// --- Shared period fetching ---

export interface PeriodInput {
  preset?: string;
  startDate?: string;
  endDate?: string;
  baseline?: string | { startDate: string; endDate: string };
}

export interface SearchCommon {
  siteUrl: string;
  searchType?: string;
  dataState?: string;
  filters?: Array<{ dimension: string; operator: string; expression: string }>;
  maxFetchRows?: number;
  resultLimit?: number;
}

interface Windows {
  current: AnalyticsRow[];
  baseline: AnalyticsRow[] | null;
  periods: ResolvedPeriods;
  budget: RequestBudget;
  fetchedAt: string;
}

const REPORT_PAGE_REUSE = Symbol("reportPageReuse");
const RECOMMENDATION_QUERY_REUSE = Symbol("recommendationQueryReuse");
interface ReportPageReuse {
  periodSpecKey: string;
  periods?: ResolvedPeriods;
  requestKey?: string;
  windows?: Windows;
}

interface RecommendationQueryReuse {
  requestKey?: string;
  rows?: AnalyticsRow[];
}

function periodSpecKey(period: PeriodInput): string {
  return JSON.stringify([period.preset, period.startDate, period.endDate, period.baseline]);
}

async function queryRecommendationRows(ds: FetchGscDataSource, siteUrl: string, query: AnalyticsQuery, deps: ToolDeps): Promise<AnalyticsRow[]> {
  const reuse = (deps as ToolDeps & { [RECOMMENDATION_QUERY_REUSE]?: RecommendationQueryReuse })[RECOMMENDATION_QUERY_REUSE];
  if (!reuse || query.dimensions.length !== 1 || query.dimensions[0] !== "query") {
    return (await ds.queryAnalytics(siteUrl, query)).rows;
  }
  const key = JSON.stringify([
    siteUrl, query.startDate, query.endDate, query.dimensions, query.filters ?? [],
    query.searchType ?? "web", query.dataState ?? "final", query.maxFetchRows ?? 5000, query.rowLimit ?? 25000,
  ]);
  if (reuse.requestKey === key && reuse.rows) return reuse.rows;
  const rows = (await ds.queryAnalytics(siteUrl, query)).rows;
  reuse.requestKey = key;
  reuse.rows = rows;
  return rows;
}

async function fetchWindows(
  siteUrl: string,
  dimensions: string[],
  period: PeriodInput,
  common: SearchCommon,
  deps: ToolDeps
): Promise<Windows> {
  const reuse = (deps as ToolDeps & { [REPORT_PAGE_REUSE]?: ReportPageReuse })[REPORT_PAGE_REUSE];
  const canReuse = dimensions.length === 1 && dimensions[0] === "page" && reuse?.periodSpecKey === periodSpecKey(period);
  const periods = canReuse && reuse ? (reuse.periods ??= resolvePeriods(period)) : resolvePeriods(period);
  const searchType = common.searchType ?? "web";
  if (!SUPPORTED_SEARCH_TYPES.includes(searchType)) {
    throw new GscError("INVALID_ARGUMENT", `searchType "${searchType}" is not supported`);
  }
  const dataState = common.dataState ?? "final";
  if (dataState !== "final" && dataState !== "all") {
    throw new GscError("INVALID_ARGUMENT", 'dataState must be "final" or "all"');
  }
  const maxFetchRows = common.maxFetchRows ?? 5000;
  if (!Number.isInteger(maxFetchRows) || maxFetchRows < 1 || maxFetchRows > 50000) {
    throw new GscError("INVALID_ARGUMENT", "maxFetchRows must be an integer between 1 and 50000");
  }
  const requestKey = canReuse ? JSON.stringify([
    siteUrl, dimensions, periods.current, periods.baseline, common.filters ?? [], searchType, dataState, maxFetchRows,
  ]) : null;
  if (requestKey !== null && reuse?.requestKey === requestKey && reuse.windows) return reuse.windows;
  const { ds, budget } = source(deps);
  const fetchedAt = new Date().toISOString();
  const base = {
    dimensions,
    filters: common.filters,
    searchType: searchType as AnalyticsQuery["searchType"],
    dataState: dataState as AnalyticsQuery["dataState"],
    maxFetchRows,
  };
  const current = await queryRecommendationRows(ds, siteUrl, { ...base, startDate: periods.current.startDate, endDate: periods.current.endDate }, deps);
  const baseline =
    periods.baseline === null
      ? null
      : (await ds.queryAnalytics(siteUrl, { ...base, startDate: periods.baseline.startDate, endDate: periods.baseline.endDate })).rows;
  const windows = { current, baseline, periods, budget, fetchedAt };
  if (requestKey !== null && reuse) {
    reuse.requestKey = requestKey;
    reuse.windows = windows;
  }
  return windows;
}

// --- T04 gsc_performance_overview ---

export interface OverviewInput extends PeriodInput, SearchCommon {
  includeTimeline?: boolean;
  includeComparison?: boolean;
}

export interface OverviewData {
  totals: { clicks: number; impressions: number; ctr: number | null; position: number | null };
  timeline?: AnalyticsRow[];
  comparison: unknown;
  period: DateRange;
  resolution: string;
}

export async function gscPerformanceOverview(input: OverviewInput, deps: ToolDeps = {}): Promise<ToolEnvelope<OverviewData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const wantComparison = input.includeComparison ?? false;
    const baseline = wantComparison ? (input.baseline ?? "previous_period") : undefined;
    const budget = deps.budget ?? new RequestBudget();
    const sharedDeps: ToolDeps = { ...deps, budget };
    const totalsWin = await fetchWindows(input.siteUrl, [], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline }, input, sharedDeps);
    const totalsRow = totalsWin.current[0] ?? { keys: [], clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const totalsOut = {
      clicks: totalsRow.clicks,
      impressions: totalsRow.impressions,
      ctr: totalsRow.impressions > 0 ? totalsRow.clicks / totalsRow.impressions : null,
      position: totalsRow.impressions > 0 ? totalsRow.position : null,
    };
    let timeline: AnalyticsRow[] | undefined;
    if (input.includeTimeline ?? true) {
      const timeWin = await fetchWindows(input.siteUrl, ["date"], { preset: input.preset, startDate: input.startDate, endDate: input.endDate }, input, sharedDeps);
      timeline = timeWin.current;
    }
    const sources = [
      { source: "google_search_console" as const, fetchedAt, siteUrl: input.siteUrl, period: totalsWin.periods.current, searchType: input.searchType ?? "web", dataState: input.dataState ?? "final" },
    ];
    const warnings = [...totalsWin.periods.warnings.map((message) => ({ code: "PERIOD_NOTE", message }))];
    let comparison: unknown = null;
    if (wantComparison && totalsWin.baseline !== null && totalsWin.periods.baseline !== null) {
      const baseRow = sumTotals(totalsWin.baseline);
      const curRow = sumTotals([totalsRow]);
      const pct = (c: number, b: number): number | null => (b > 0 ? (100 * (c - b)) / b : null);
      comparison = {
        baselineTotals: baseRow,
        deltaClicks: curRow.clicks - baseRow.clicks,
        deltaClicksPct: pct(curRow.clicks, baseRow.clicks),
        deltaImpressions: curRow.impressions - baseRow.impressions,
        deltaImpressionsPct: pct(curRow.impressions, baseRow.impressions),
        baselinePeriod: totalsWin.periods.baseline,
      };
      sources.push({ source: "google_search_console" as const, fetchedAt, siteUrl: input.siteUrl, period: totalsWin.periods.baseline, searchType: input.searchType ?? "web", dataState: input.dataState ?? "final" });
    }
    return ok({ totals: totalsOut, timeline, comparison, period: totalsWin.periods.current, resolution: totalsWin.periods.resolution }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      sources,
      coverage: {
        sourceGuarantee: "resource_response",
        apiPaginationComplete: true,
        fetchedRows: (timeline ?? []).length + 1,
        returnedRows: (timeline ?? []).length + 1,
        truncatedByProduct: false,
        stoppedBecause: [],
      },
      warnings,
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T05 gsc_compare_periods ---
export interface CompareInput extends PeriodInput, SearchCommon {
  dimension: string;
  orderBy?: string;
  sortDirection?: string;
}

export async function gscComparePeriods(input: CompareInput, deps: ToolDeps = {}): Promise<ToolEnvelope<CompareTotalsData | CompareDimensionalData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    if (!["page", "query", "country", "device", "none"].includes(input.dimension)) {
      throw new GscError("INVALID_ARGUMENT", "dimension must be page, query, country, device or none");
    }
    const orderBy = input.orderBy ?? "deltaClicks";
    if (!["deltaClicks", "deltaImpressions", "deltaCtrPp", "positionImprovement"].includes(orderBy)) {
      throw new GscError("INVALID_ARGUMENT", "orderBy must be deltaClicks, deltaImpressions, deltaCtrPp or positionImprovement");
    }
    const direction = input.sortDirection ?? "asc";
    if (direction !== "asc" && direction !== "desc") {
      throw new GscError("INVALID_ARGUMENT", 'sortDirection must be "asc" or "desc"');
    }
    const limit = input.resultLimit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new GscError("INVALID_ARGUMENT", "resultLimit must be an integer between 1 and 200");
    }
    const baseline = input.baseline ?? "previous_period";
    const dims = input.dimension === "none" ? [] : [input.dimension];
    const win = await fetchWindows(input.siteUrl, dims, { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline }, input, deps);
    if (win.baseline === null || win.periods.baseline === null) {
      throw new GscError("INSUFFICIENT_DATA", "comparison needs a baseline period");
    }
    const sources = [
      { source: "google_search_console" as const, fetchedAt, siteUrl: input.siteUrl, period: win.periods.current },
      { source: "google_search_console" as const, fetchedAt, siteUrl: input.siteUrl, period: win.periods.baseline },
    ];
    const warnings = [...win.periods.warnings.map((message) => ({ code: "PERIOD_NOTE", message }))];
    if (input.dimension === "none") {
      const cur = sumTotals(win.current);
      const base = sumTotals(win.baseline);
      const pct = (c: number, b: number): number | null => (b > 0 ? (100 * (c - b)) / b : null);
      return ok({ current: cur, baseline: base, deltaClicks: cur.clicks - base.clicks, deltaClicksPct: pct(cur.clicks, base.clicks), deltaImpressions: cur.impressions - base.impressions }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
        attempts: win.budget.attemptsUsed,
        sources,
        warnings,
      });
    }
    const cmp = comparePeriods(win.current, win.baseline, orderBy as CompareOrder, direction as "asc" | "desc");
    const data = {
      compared: cmp.compared.slice(0, limit),
      comparedTotal: cmp.compared.length,
      notObservedInCurrent: cmp.notObservedInCurrent.slice(0, limit),
      notObservedInCurrentTotal: cmp.notObservedInCurrent.length,
      notObservedInBaseline: cmp.notObservedInBaseline.slice(0, limit),
      notObservedInBaselineTotal: cmp.notObservedInBaseline.length,
    };
    const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    const store = deps.store ?? datasets;
    const dsColumns = [input.dimension, "observation", "deltaClicks", "deltaClicksPct", "deltaCtrPp", "deltaPosition"];
    const stored = store.create(
      alias,
      dsColumns,
      cmp.compared.map((r) => ({
        [input.dimension]: r.key,
        observation: r.observation,
        deltaClicks: r.deltaClicks,
        deltaClicksPct: r.deltaClicksPct,
        deltaCtrPp: r.deltaCtrPp,
        deltaPosition: r.deltaPosition,
      }))
    );
    return ok(data, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
      sources,
      datasetId: stored.id,
      datasetExpiresAt: stored.expiresAt,
      coverage: {
        sourceGuarantee: "top_rows_not_exhaustive",
        apiPaginationComplete: true,
        fetchedRows: win.current.length + win.baseline.length,
        returnedRows: data.compared.length + data.notObservedInCurrent.length + data.notObservedInBaseline.length,
        truncatedByProduct: cmp.compared.length > limit,
        stoppedBecause: [],
        sortAppliedTo: "retrieved_dataset",
      },
      warnings: [...warnings, { code: "SOURCE_NOT_EXHAUSTIVE", message: "Keys absent from a top-N slice are not observed, not zero." }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T06 gsc_page_queries / T07 gsc_query_pages ---

export interface PageQueriesInput extends PeriodInput, SearchCommon {
  pageUrl: string;
}

export interface QueryPagesInput extends PeriodInput, SearchCommon {
  query: string;
}

export async function gscPageQueries(input: PageQueriesInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    if (typeof input.pageUrl !== "string" || input.pageUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "pageUrl is required: the exact page URL");
    }
    const periods = resolvePeriods(input);
    return gscSearchAnalytics({
      ...input,
      startDate: periods.current.startDate,
      endDate: periods.current.endDate,
      dimensions: ["query"],
      filters: [...(input.filters ?? []), { dimension: "page", operator: "equals", expression: input.pageUrl }],
    }, deps);
  } catch (err) {
    return fail(err);
  }
}

export async function gscQueryPages(input: QueryPagesInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    if (typeof input.query !== "string" || input.query.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "query is required: the exact query string");
    }
    const periods = resolvePeriods(input);
    return gscSearchAnalytics({
      ...input,
      startDate: periods.current.startDate,
      endDate: periods.current.endDate,
      dimensions: ["page"],
      filters: [...(input.filters ?? []), { dimension: "query", operator: "equals", expression: input.query }],
    }, deps);
  } catch (err) {
    return fail(err);
  }
}

// --- T11 gsc_find_opportunities ---

export interface OpportunitiesInput extends PeriodInput, SearchCommon {
  kind: string;
  dimension?: string;
  minImpressions?: number;
  minPosition?: number;
  maxPosition?: number;
  maxCtr?: number;
  targetCtr?: number;
  minBaseClicks?: number;
  minDeclinePct?: number;
  windowDays?: number;
  maxClicks?: number;
  benchmarkCurve?: Array<{ maxPosition: number; expectedCtr: number }>;
}

export async function gscFindOpportunities(input: OpportunitiesInput, deps: ToolDeps = {}): Promise<ToolEnvelope<OpportunityResult>> {
  const fetchedAt = new Date().toISOString();
  try {
    const kinds = ["low_ctr", "striking_distance", "declining", "ctr_benchmark", "low_clicks"];
    if (!kinds.includes(input.kind)) {
      throw new GscError("INVALID_ARGUMENT", `kind must be ${kinds.join(", ")}`);
    }
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const dimension = input.dimension ?? "query";
    if (dimension !== "query" && dimension !== "page") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "query" or "page"');
    }
    const { ds, budget } = source(deps);
    const maxFetchRows = input.maxFetchRows ?? 5000;
    const limit = input.resultLimit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new GscError("INVALID_ARGUMENT", "resultLimit must be an integer between 1 and 200");
    }
    const base = {
      dimensions: [dimension],
      filters: input.filters,
      searchType: (input.searchType ?? "web") as AnalyticsQuery["searchType"],
      dataState: (input.dataState ?? "final") as AnalyticsQuery["dataState"],
      maxFetchRows,
    };
    if (input.kind === "declining") {
      const windowDays = input.windowDays ?? 28;
      if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 90) {
        throw new GscError("INVALID_ARGUMENT", "windowDays must be an integer between 7 and 90");
      }
      const ref = resolvePeriods(input);
      const end = ref.current.endDate;
      const recent = { startDate: shiftDays({ startDate: end, endDate: end }, -(windowDays - 1)).startDate, endDate: end };
      const middle = shiftDays(recent, -windowDays);
      const oldest = shiftDays(recent, -2 * windowDays);
      const fetch = (r: { startDate: string; endDate: string }): Promise<AnalyticsRow[]> =>
        ds.queryAnalytics(input.siteUrl, { ...base, startDate: r.startDate, endDate: r.endDate }).then((res) => res.rows);
      const [recentRows, middleRows, oldestRows] = await Promise.all([fetch(recent), fetch(middle), fetch(oldest)]);
      const result = findOpportunities("declining", [], {
        windowDays,
        minBaseClicks: input.minBaseClicks,
        minDeclinePct: input.minDeclinePct,
        windows: [recentRows, middleRows, oldestRows],
      });
      return ok({ ...result, candidates: result.candidates.slice(0, limit) }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
        attempts: budget.attemptsUsed,
        warnings: [{ code: "HEURISTIC", message: `rule ${result.ruleVersion}: ${result.limitation}` }],
      });
    }
    const periods = resolvePeriods(input);
    const rows = await queryRecommendationRows(ds, input.siteUrl, { ...base, startDate: periods.current.startDate, endDate: periods.current.endDate }, deps);
    const result = findOpportunities(input.kind, rows, {
      minImpressions: input.minImpressions,
      minPosition: input.minPosition,
      maxPosition: input.maxPosition,
      maxCtr: input.maxCtr,
      targetCtr: input.targetCtr,
      maxClicks: input.maxClicks,
      curve: input.benchmarkCurve,
    });
    return ok({ ...result, candidates: result.candidates.slice(0, limit) }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      coverage: {
        sourceGuarantee: "top_rows_not_exhaustive",
        apiPaginationComplete: true,
        fetchedRows: rows.length,
        returnedRows: Math.min(limit, result.candidates.length),
        truncatedByProduct: result.candidates.length > limit,
        stoppedBecause: [],
        sortAppliedTo: "retrieved_dataset",
      },
      warnings: [{ code: "HEURISTIC", message: `rule ${result.ruleVersion}: ${result.limitation}` }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T12 gsc_detect_cannibalization ---

export interface CannibalizationInput extends PeriodInput, SearchCommon {
  minPages?: number;
  minImpressionsPerPage?: number;
  minSharePct?: number;
}

export async function gscDetectCannibalization(input: CannibalizationInput, deps: ToolDeps = {}): Promise<ToolEnvelope<CannibalizationData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const limit = input.resultLimit ?? 50;
    const win = await fetchWindows(input.siteUrl, ["query", "page"], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline: undefined }, input, deps);
    const all = detectCannibalization(win.current, {
      minPages: input.minPages,
      minImpressionsPerPage: input.minImpressionsPerPage,
      minSharePct: input.minSharePct,
    });
    return ok({ candidates: all.slice(0, limit), candidatesTotal: all.length, ruleVersion: CANNIBALIZATION_RULE_VERSION }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
      warnings: [{ code: "HEURISTIC", message: "candidates for editorial review, never an order to consolidate; temporal overlap unknown without a timeline" }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T13 gsc_analyze_segments ---

export interface SegmentsInput extends PeriodInput, SearchCommon {
  segments: Array<{ id: string; label: string; brandTerms?: string[]; pathPrefix?: string; country?: string; device?: string }>;
}

export async function gscAnalyzeSegments(input: SegmentsInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 10) {
      throw new GscError("INVALID_ARGUMENT", "segments must hold between 1 and 10 definitions");
    }
    for (const s of input.segments) {
      if (typeof s.id !== "string" || s.id === "" || typeof s.label !== "string" || s.label === "") {
        throw new GscError("INVALID_ARGUMENT", "every segment needs a non-empty id and label");
      }
    }
    const dimensions = ["query", "page"];
    if (input.segments.some((s) => s.country)) dimensions.push("country");
    if (input.segments.some((s) => s.device)) dimensions.push("device");
    const win = await fetchWindows(input.siteUrl, dimensions, { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline: undefined }, input, deps);
    const analysis = analyzeSegments(win.current, dimensions, input.segments);
    return ok({ ...analysis, ruleVersion: SEGMENTS_RULE_VERSION }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
      warnings: analysis.warnings.map((message) => ({ code: "SEGMENT_NOTE", message })),
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T14 gsc_export_dataset ---

export interface ExportInput {
  datasetId: string;
  format: string;
  name?: string;
}

export async function gscExportDataset(input: ExportInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    if (typeof input.datasetId !== "string" || input.datasetId.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "datasetId is required");
    }
    const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    const store = deps.store ?? datasets;
    const full = store.page(input.datasetId, alias, { limit: 200 });
    const all = [full.rows];
    let cursor = full.nextCursor;
    while (cursor !== null) {
      const p = store.page(input.datasetId, alias, { cursor, limit: 200 });
      all.push(p.rows);
      cursor = p.nextCursor;
    }
    const result = exportDataset(dataDir(), input.name ?? "dataset", input.format as "json" | "csv" | "markdown", full.columns, all.flat(), {
      datasetId: input.datasetId,
      columns: full.columns,
      totalRows: full.totalRows,
      exportedAt: new Date().toISOString(),
    });
    return ok({ export: result }, { source: "local_dataset", fetchedAt: null }, {});
  } catch (err) {
    return fail(err);
  }
}


// --- T15 gsc_analyze_traffic_drop ---

export interface TrafficDropInput extends PeriodInput, SearchCommon {
  dimension?: string;
  minAbsLoss?: number;
}

export interface DropAnalysis {
  key: string;
  currentClicks: number;
  baselineClicks: number;
  deltaClicks: number;
  observedSignals: string[];
  hypotheses: string[];
  missingEvidence: string[];
}

const DROP_MISSING_EVIDENCE = [
  "indexation status of affected pages (gsc_inspect_urls with explicit URLs)",
  "SERP competitor or layout changes (no data source in this server)",
  "site changes and deploys in the window (outside GSC)",
];

function analyzeDrop(key: string, cur: number, base: number, row: ComparedRow): DropAnalysis {
  const signals: string[] = [];
  const hypotheses: string[] = [];
  if (row.deltaPosition !== null && row.deltaPosition > 2) {
    signals.push(`average position worsened by ${row.deltaPosition.toFixed(1)} places`);
    hypotheses.push("ranking loss contributes to the click drop; the cause is unknown from GSC alone");
  } else {
    const baseCtr = row.baseline?.ctr ?? 0;
    const relCtr = baseCtr > 0 && row.current ? (row.current.ctr - baseCtr) / baseCtr : 0;
    if (relCtr < -0.3) {
      signals.push(`CTR collapsed ${(100 * relCtr).toFixed(1)}% in relative terms at stable rank`);
      hypotheses.push("presentation/CTR change contributes; title or SERP-feature shifts are unverified");
    } else {
      signals.push("impressions fell at relatively stable rank and CTR");
      hypotheses.push("lower search demand is one hypothesis among others, not a finding");
    }
  }
  return {
    key,
    currentClicks: cur,
    baselineClicks: base,
    deltaClicks: cur - base,
    observedSignals: signals,
    hypotheses,
    missingEvidence: DROP_MISSING_EVIDENCE,
  };
}

export async function gscAnalyzeTrafficDrop(input: TrafficDropInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const dimension = input.dimension ?? "page";
    if (dimension !== "page" && dimension !== "query") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "page" or "query"');
    }
    const minAbsLoss = input.minAbsLoss ?? 10;
    const limit = input.resultLimit ?? 50;
    const baseline = input.baseline ?? "previous_period";
    const win = await fetchWindows(input.siteUrl, [dimension], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline }, input, deps);
    if (win.baseline === null || win.periods.baseline === null) {
      throw new GscError("INSUFFICIENT_DATA", "traffic-drop analysis needs a baseline period");
    }
    const cmp = comparePeriods(win.current, win.baseline, "deltaClicks", "asc");
    const drops = cmp.compared
      .filter((r) => (r.deltaClicks ?? 0) <= -minAbsLoss)
      .slice(0, limit)
      .map((r) => analyzeDrop(r.key, r.current?.clicks ?? 0, r.baseline?.clicks ?? 0, r));
    const vanished = cmp.notObservedInCurrent
      .filter((r) => (r.baseline?.clicks ?? 0) > 5)
      .slice(0, limit)
      .map((r) => ({
        key: r.key,
        currentClicks: 0,
        baselineClicks: r.baseline?.clicks ?? 0,
        deltaClicks: -(r.baseline?.clicks ?? 0),
        observedSignals: ["page not observed in the current window"],
        hypotheses: ["loss of visibility is one hypothesis; desindexation needs inspection evidence"],
        missingEvidence: DROP_MISSING_EVIDENCE,
      }));
    return ok({ drops, vanished, baselinePeriod: win.periods.baseline }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
      sources: [
        { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl, period: win.periods.current },
        { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl, period: win.periods.baseline },
      ],
      warnings: [...win.periods.warnings.map((message) => ({ code: "PERIOD_NOTE", message })), { code: "NO_CAUSALITY", message: "Signals are observed arithmetic; hypotheses are not findings." }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T16 gsc_content_decay ---

export interface DecayInput extends PeriodInput, SearchCommon {
  dimension?: string;
  windowDays?: number;
  minBaseClicks?: number;
  minDeclinePct?: number;
}

export async function gscContentDecay(input: DecayInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const dimension = input.dimension ?? "page";
    if (dimension !== "page" && dimension !== "query") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "page" or "query"');
    }
    const windowDays = input.windowDays ?? 28;
    if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 90) {
      throw new GscError("INVALID_ARGUMENT", "windowDays must be an integer between 7 and 90");
    }
    const searchType = input.searchType ?? "web";
    const minBaseClicks = input.minBaseClicks ?? (searchType === "image" ? 5 : 50);
    const limit = input.resultLimit ?? 50;
    const ref = resolvePeriods({ preset: input.preset, startDate: input.startDate, endDate: input.endDate });
    const end = ref.current.endDate;
    const startOf = (endIso: string): string => shiftDays({ startDate: endIso, endDate: endIso }, -(windowDays - 1)).startDate;
    const w3 = { startDate: startOf(end), endDate: end };
    const w2 = shiftDays(w3, -windowDays);
    const w1 = shiftDays(w3, -2 * windowDays);
    const { ds, budget } = source(deps);
    const base = {
      dimensions: [dimension],
      filters: input.filters,
      searchType: searchType as AnalyticsQuery["searchType"],
      dataState: ((input.dataState ?? "final") as AnalyticsQuery["dataState"]),
      maxFetchRows: input.maxFetchRows ?? 5000,
    };
    const fetch = (r: { startDate: string; endDate: string }): Promise<AnalyticsRow[]> =>
      ds.queryAnalytics(input.siteUrl, { ...base, startDate: r.startDate, endDate: r.endDate }).then((res) => res.rows);
    const [recent, middle, oldest] = await Promise.all([fetch(w3), fetch(w2), fetch(w1)]);
    const result = declining([recent, middle, oldest], { windowDays, minBaseClicks, minDeclinePct: input.minDeclinePct });
    const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    const store = deps.store ?? datasets;
    const stored = store.create(alias, [dimension, "clicks", "trend"], result.candidates.map((c) => ({ [dimension]: c.key, clicks: c.clicks, trend: c.reason })));
    return ok({ candidates: result.candidates.slice(0, limit), candidatesTotal: result.candidates.length, windows: [w1, w2, w3], ruleVersion: OPPORTUNITY_RULE_VERSION }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      datasetId: stored.id,
      datasetExpiresAt: stored.expiresAt,
      warnings: [{ code: "HEURISTIC", message: `rule ${result.ruleVersion}: ${result.limitation}` }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T17 gsc_check_alerts ---

export const ALERT_RULES_VERSION = "t17.1";

export interface AlertsInput extends PeriodInput, SearchCommon {
  dimension?: string;
  minClickLoss?: number;
  ctrDropPpMin?: number;
  positionWorseByMin?: number;
  disappearedMinClicks?: number;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  rule: "click_loss" | "ctr_drop" | "position_drop" | "not_observed";
  entity: string;
  evidence: Record<string, number | string | null>;
  suggestedCheck: string;
}

export async function gscCheckAlerts(input: AlertsInput, deps: ToolDeps = {}): Promise<ToolEnvelope<AlertsData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const dimension = input.dimension ?? "page";
    if (dimension !== "page" && dimension !== "query") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "page" or "query"');
    }
    const minClickLoss = input.minClickLoss ?? 50;
    const ctrDropPpMin = input.ctrDropPpMin ?? 5;
    const positionWorseByMin = input.positionWorseByMin ?? 3;
    const disappearedMinClicks = input.disappearedMinClicks ?? 5;
    const limit = input.resultLimit ?? 50;
    const baseline = input.baseline ?? "previous_period";
    const win = await fetchWindows(input.siteUrl, [dimension], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline }, input, deps);
    if (win.baseline === null || win.periods.baseline === null) {
      throw new GscError("INSUFFICIENT_DATA", "alerts need a baseline period");
    }
    const stamp = win.periods.current.startDate;
    const alerts: Alert[] = [];
    const cmp = comparePeriods(win.current, win.baseline, "deltaClicks", "asc");
    for (const r of cmp.compared) {
      const loss = -(r.deltaClicks ?? 0);
      if (loss >= minClickLoss) {
        alerts.push({ id: `click_loss:${r.key}:${stamp}`, severity: "warning", rule: "click_loss", entity: r.key, evidence: { deltaClicks: r.deltaClicks, currentClicks: r.current?.clicks ?? null }, suggestedCheck: "run gsc_analyze_traffic_drop for signals" });
      }
      if ((r.deltaCtrPp ?? 0) <= -ctrDropPpMin) {
        alerts.push({ id: `ctr_drop:${r.key}:${stamp}`, severity: "info", rule: "ctr_drop", entity: r.key, evidence: { deltaCtrPp: r.deltaCtrPp }, suggestedCheck: "review titles for the affected pages" });
      }
      if ((r.deltaPosition ?? 0) >= positionWorseByMin) {
        alerts.push({ id: `position_drop:${r.key}:${stamp}`, severity: "info", rule: "position_drop", entity: r.key, evidence: { deltaPosition: r.deltaPosition }, suggestedCheck: "run gsc_analyze_traffic_drop for signals" });
      }
    }
    for (const r of cmp.notObservedInCurrent) {
      const prior = r.baseline?.clicks ?? 0;
      if (prior >= disappearedMinClicks) {
        alerts.push({ id: `not_observed:${r.key}:${stamp}`, severity: prior >= 100 ? "critical" : "warning", rule: "not_observed", entity: r.key, evidence: { baselineClicks: prior }, suggestedCheck: "inspect explicit URLs; absence is not confirmed desindexation" });
      }
    }
    const shown = alerts.slice(0, limit);
    return ok({ alerts: shown, alertsTotal: alerts.length, ruleVersion: ALERT_RULES_VERSION }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
      warnings: [{ code: "ON_DEMAND", message: "Evaluation on demand with fixed rule versions, not continuous monitoring." }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T18 gsc_content_candidates ---

export interface ContentCandidatesInput extends PeriodInput, SearchCommon {
  minImpressions?: number;
  minPosition?: number;
  maxExpand?: number;
}

export async function gscContentCandidates(input: ContentCandidatesInput, deps: ToolDeps = {}): Promise<ToolEnvelope<CandidatesData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const minImpressions = input.minImpressions ?? 50;
    const minPosition = input.minPosition ?? 20;
    const maxExpand = input.maxExpand ?? 5;
    if (!Number.isInteger(maxExpand) || maxExpand < 1 || maxExpand > 20) {
      throw new GscError("INVALID_ARGUMENT", "maxExpand must be an integer between 1 and 20");
    }
    const win = await fetchWindows(input.siteUrl, ["query"], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline: undefined }, input, deps);
    const queries = win.current
      .filter((r) => r.impressions >= minImpressions && r.position >= minPosition)
      .sort((a, b) => b.impressions - a.impressions);
    const { ds, budget } = source({ ...deps, budget: win.budget });
    const candidates = [];
    for (const q of queries.slice(0, maxExpand)) {
      const pages = await ds.queryAnalytics(input.siteUrl, {
        dimensions: ["page"],
        filters: [{ dimension: "query", operator: "equals", expression: q.keys[0] }],
        searchType: (input.searchType ?? "web") as AnalyticsQuery["searchType"],
        dataState: (input.dataState ?? "final") as AnalyticsQuery["dataState"],
        startDate: win.periods.current.startDate,
        endDate: win.periods.current.endDate,
        maxFetchRows: 50,
      });
      candidates.push({
        query: q.keys[0],
        clicks: q.clicks,
        impressions: q.impressions,
        position: q.position,
        observedPages: pages.rows.map((p) => p.keys[0]),
        contentPresence: "unknown",
        reason: "observed demand at weak average position; existing content not audited",
      });
    }
    return ok({ candidates, candidatesTotal: queries.length }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      warnings: [{ code: "CANDIDATE", message: "A query at position 25 may already have content: review, do not auto-create." }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T19 gsc_content_recommendations ---

export interface RecommendationsInput extends PeriodInput, SearchCommon {
  categories?: string[];
  maxRecommendations?: number;
}

interface Recommendation {
  actionCandidate: string;
  entity: string;
  reason: string;
  priority: number;
  evidence: string[];
  checksBeforeAction: string[];
}

export async function gscContentRecommendations(input: RecommendationsInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const categories = input.categories ?? ["update", "create", "consolidate"];
    for (const c of categories) {
      if (!["update", "create", "consolidate"].includes(c)) {
        throw new GscError("INVALID_ARGUMENT", "categories must subset update, create, consolidate");
      }
    }
    const maxRecommendations = input.maxRecommendations ?? 20;
    const budget = deps.budget ?? new RequestBudget();
    const shared: ToolDeps & { [RECOMMENDATION_QUERY_REUSE]?: RecommendationQueryReuse } = { ...deps, budget };
    if (categories.includes("update") && categories.includes("create")) shared[RECOMMENDATION_QUERY_REUSE] = {};
    const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    const store = deps.store ?? datasets;
    const recs: Recommendation[] = [];
    const register = (columns: string[], rows: Array<Record<string, number | string | null>>): string => store.create(alias, columns, rows).id;
    if (categories.includes("update")) {
      const opp = await gscFindOpportunities({ ...input, kind: "striking_distance", resultLimit: 10 }, shared);
      if (opp.status === "ok" && opp.data !== null) {
        const data = opp.data;
        const id = register(["query", "impressions", "position"], data.candidates.map((c) => ({ query: c.key, impressions: c.impressions, position: c.position })));
        data.candidates.forEach((c, i) => recs.push({
          actionCandidate: "update",
          entity: c.key,
          reason: `striking-distance query at position ${c.position} with ${c.impressions} impressions`,
          priority: i + 1,
          evidence: [id],
          checksBeforeAction: ["review search intent and current content before editing"],
        }));
      }
    }
    if (categories.includes("create")) {
      const gaps = await gscContentCandidates({ ...input, minPosition: 20, maxExpand: 5 }, shared);
      if (gaps.status === "ok" && gaps.data !== null) {
        const data = gaps.data;
        const id = register(["query", "impressions"], data.candidates.map((c) => ({ query: c.query, impressions: c.impressions })));
        data.candidates.forEach((c, i) => recs.push({
          actionCandidate: "create",
          entity: c.query,
          reason: `observed demand with weak coverage (${c.observedPages.length} observed pages)`,
          priority: 100 + i,
          evidence: [id],
          checksBeforeAction: ["verify no existing content already targets this query"],
        }));
      }
    }
    if (categories.includes("consolidate")) {
      const cann = await gscDetectCannibalization({ ...input }, shared);
      if (cann.status === "ok" && cann.data !== null) {
        const data = cann.data;
        const id = register(["query", "pages"], data.candidates.slice(0, 10).map((c) => ({ query: c.query, pages: c.pages.map((p) => p.page).join(", ") })));
        data.candidates.slice(0, 10).forEach((c, i) => recs.push({
          actionCandidate: "consolidate",
          entity: c.query,
          reason: `${c.pages.length} observed pages share this query; candidate for intent review`,
          priority: 200 + i,
          evidence: [id],
          checksBeforeAction: ["compare intents and canonicals before any merge or redirect"],
        }));
      }
    }
    recs.sort((a, b) => a.priority - b.priority);
    const shown = recs.slice(0, maxRecommendations);
    return ok({ recommendations: shown, recommendationsTotal: recs.length }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      warnings: [{ code: "CANDIDATE", message: "Actions are candidates with recoverable evidence, never automatic edits." }],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T20 gsc_multi_site_overview ---
export interface MultiSiteInput extends PeriodInput, Omit<SearchCommon, "siteUrl"> {
  sites: string[];
  includeComparison?: boolean;
}

export async function gscMultiSiteOverview(input: MultiSiteInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (!Array.isArray(input.sites) || input.sites.length < 1 || input.sites.length > 5) {
      throw new GscError("INVALID_ARGUMENT", "sites must hold between 1 and 5 explicit properties");
    }
    const budget = deps.budget ?? new RequestBudget();
    const shared = { ...deps, budget };
    const uniqueSites = [...new Set(input.sites)];
    const bySite = new Map<string, { status: string; data: unknown; error: unknown }>();
    let next = 0;
    const workers = Array.from({ length: Math.min(3, uniqueSites.length) }, async () => {
      while (next < uniqueSites.length) {
        const i = next++;
        const siteUrl = uniqueSites[i];
        try {
          const over = await gscPerformanceOverview({
            siteUrl,
            preset: input.preset,
            startDate: input.startDate,
            endDate: input.endDate,
            searchType: input.searchType,
            dataState: input.dataState,
            includeTimeline: false,
            includeComparison: input.includeComparison ?? false,
            baseline: typeof input.baseline === "string" ? input.baseline : undefined,
          }, shared);
          bySite.set(siteUrl, { status: over.status, data: over.data, error: over.error ?? null });
        } catch (err) {
          bySite.set(siteUrl, { status: "error", data: null, error: String(err) });
        }
      }
    });
    await Promise.all(workers);
    const results = input.sites.map((siteUrl) => ({ siteUrl, ...bySite.get(siteUrl)! }));
    results.sort((a, b) => (a.siteUrl < b.siteUrl ? -1 : 1));
    const failed = results.filter((r) => r.status !== "ok").length;
    return ok({ sites: results }, { source: "google_search_console", fetchedAt }, {
      attempts: budget.attemptsUsed,
      warnings: failed > 0 ? [{ code: "PARTIAL", message: `${failed} of ${results.length} properties failed; successes preserved` }] : [],
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T21 gsc_generate_report ---

export interface ReportInput extends PeriodInput, Omit<SearchCommon, "siteUrl"> {
  siteUrl?: string;
  sites?: string[];
  sections?: string[];
  save?: boolean;
  detail?: string;
}

const REPORT_SECTIONS = ["summary", "movers", "opportunities", "images", "alerts", "limitations"] as const;

export async function gscGenerateReport(input: ReportInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    const siteUrl = input.sites?.[0] ?? input.siteUrl;
    if (typeof siteUrl !== "string" || siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl (or sites[0]) is required");
    }
    const sections = input.sections ?? [...REPORT_SECTIONS];
    for (const s of sections) {
      if (!(REPORT_SECTIONS as readonly string[]).includes(s)) {
        throw new GscError("INVALID_ARGUMENT", `sections must subset ${REPORT_SECTIONS.join(", ")}`);
      }
    }
    const period = { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline: input.baseline ?? "previous_period" };
    const budget = deps.budget ?? new RequestBudget();
    const shared: ToolDeps & { [REPORT_PAGE_REUSE]?: ReportPageReuse } = { ...deps, budget };
    if (sections.includes("movers") && sections.includes("alerts")) {
      shared[REPORT_PAGE_REUSE] = { periodSpecKey: periodSpecKey(period) };
    }
    const parts: string[] = [`# Performance report: ${siteUrl}`, ""];
    const sources: Array<Omit<Provenance, "servedAt">> = [];
    const collect = (env: ToolEnvelope<unknown>): void => {
      const { servedAt: _servedAt, ...rest } = env.meta.provenance;
      void _servedAt;
      sources.push(rest);
    };
    if (sections.includes("summary")) {
      const over = await gscPerformanceOverview({ siteUrl, ...period, includeTimeline: false }, shared);
      collect(over);
      const t = over.data?.totals;
      parts.push("## Summary", t ? `Clicks ${t.clicks}, impressions ${t.impressions}.` : "Summary unavailable.", "");
    }
    if (sections.includes("movers")) {
      const cmp = await gscComparePeriods({ siteUrl, dimension: "page", ...period, resultLimit: 5 }, shared);
      collect(cmp);
      const d = cmp.data !== null && "compared" in cmp.data ? cmp.data : null;
      parts.push("## Movers", ...(d ? d.compared.map((r) => `- ${r.key}: ${r.deltaClicks ?? "?"} clicks`) : ["Movers unavailable."]), "");
    }
    if (sections.includes("opportunities")) {
      const opp = await gscFindOpportunities({ siteUrl, kind: "striking_distance", ...period, resultLimit: 5 }, shared);
      collect(opp);
      const d = opp.data;
      parts.push("## Opportunities", ...(d ? d.candidates.map((c) => `- ${c.key}`) : ["Opportunities unavailable."]), "");
    }
    if (sections.includes("images")) {
      const img = await gscFindOpportunities({ siteUrl, kind: "low_clicks", searchType: "image", ...period, resultLimit: 5 }, shared);
      collect(img);
      const rows = img.data?.candidates ?? null;
      parts.push("## Images", ...((rows ?? []).slice(0, 5).map((c) => `- ${c.key}`)), "");
    }
    if (sections.includes("alerts")) {
      const al = await gscCheckAlerts({ siteUrl, dimension: "page", ...period }, shared);
      collect(al);
      const d = al.data;
      parts.push("## Alerts", ...(d ? d.alerts.slice(0, 5).map((a) => `- [${a.severity}] ${a.entity}`) : ["Alerts unavailable."]), "");
    }
    if (sections.includes("limitations")) {
      parts.push("## Limitations", "Rows describe retrieved GSC data, not all searches. Positions are impression-weighted averages.", "");
    }
    const content = parts.join("\n");
    if (input.save === true) {
      const alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
      const store = deps.store ?? datasets;
      const created = store.create(alias, ["section", "text"], [{ section: "report", text: content.slice(0, 20000) }]);
      const exported = exportDataset(dataDir(), "report", "markdown", ["section", "text"], [{ section: "report", text: content }], {
        siteUrl,
        sections,
        datasetId: created.id,
        exportedAt: new Date().toISOString(),
      });
      return ok({ content, savedTo: exported.path }, { source: "local_dataset", fetchedAt: null }, { attempts: budget.attemptsUsed, sources });
    }
    return ok({ content }, { source: "local_dataset", fetchedAt: null }, { attempts: budget.attemptsUsed, sources });
  } catch (err) {
    return fail(err);
  }
}

// --- T22 gsc_verify_claim ---

export interface ClaimInput {
  metric: string;
  value: number;
  siteUrl: string;
  preset?: string;
  startDate?: string;
  endDate?: string;
  searchType?: string;
  dataState?: string;
  filters?: Array<{ dimension: string; operator: string; expression: string }>;
  compareWithBaseline?: boolean;
  toleranceAbs?: number;
  toleranceRel?: number;
}

const CLAIM_METRICS = ["clicks", "impressions", "ctr", "position", "deltaClicks"] as const;

export async function gscVerifyClaim(input: ClaimInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (!CLAIM_METRICS.includes(input.metric as (typeof CLAIM_METRICS)[number])) {
      throw new GscError("INVALID_ARGUMENT", `metric must be ${CLAIM_METRICS.join(", ")}`);
    }
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      throw new GscError("INVALID_ARGUMENT", "value must be a finite number");
    }
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required");
    }
    const tolAbs = input.toleranceAbs ?? 0;
    const tolRel = input.toleranceRel ?? 0;
    const win = await fetchWindows(input.siteUrl, [], { preset: input.preset, startDate: input.startDate, endDate: input.endDate, baseline: input.compareWithBaseline ? "previous_period" : undefined }, { siteUrl: input.siteUrl, searchType: input.searchType, dataState: input.dataState, filters: input.filters }, deps);
    const agg = (rows: AnalyticsRow[]): Record<string, number | null> => {
      const t = sumTotals(rows);
      return { clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, position: t.position, deltaClicks: null };
    };
    const cur = agg(win.current);
    if (input.metric === "deltaClicks") {
      if (win.baseline === null) {
        return ok({ verification: { verdict: "unverifiable", reason: "delta needs a baseline period" } }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {});
      }
      const base = agg(win.baseline);
      cur.deltaClicks = (cur.clicks ?? 0) - (base.clicks ?? 0);
    }
    const observed = cur[input.metric];
    if (observed === null || observed === undefined) {
      return ok({ verification: { verdict: "unverifiable", reason: "no comparable observations in scope" } }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {});
    }
    const diff = Math.abs(observed - input.value);
    const rel = input.value !== 0 ? diff / Math.abs(input.value) : (diff === 0 ? 0 : Infinity);
    const verified = diff <= tolAbs || rel <= tolRel;
    return ok({
      verification: {
        verdict: verified ? "verified" : "contradicted",
        observed,
        expected: input.value,
        difference: observed - input.value,
        toleranceAbs: tolAbs,
        toleranceRel: tolRel,
      },
    }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: win.budget.attemptsUsed,
    });
  } catch (err) {
    return fail(err);
  }
}

// --- T23 gsc_compare_web_image ---

export interface WebImageInput extends PeriodInput, SearchCommon {
  dimension?: string;
  resultLimit?: number;
}

export async function gscCompareWebImage(input: WebImageInput, deps: ToolDeps = {}): Promise<ToolEnvelope<unknown>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const dimension = input.dimension ?? "query";
    if (dimension !== "query" && dimension !== "page") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "query" or "page"');
    }
    const limit = input.resultLimit ?? 50;
    const budget = deps.budget ?? new RequestBudget();
    const shared = { ...deps, budget };
    const period = { preset: input.preset, startDate: input.startDate, endDate: input.endDate };
    const [web, image] = await Promise.all([
      fetchWindows(input.siteUrl, [dimension], period, { ...input, searchType: "web" }, shared),
      fetchWindows(input.siteUrl, [dimension], period, { ...input, searchType: "image" }, shared),
    ]);
    const keyOf = (keys: string[]): string => keys.join(" ");
    const webMap = new Map(web.current.map((r) => [keyOf(r.keys), r]));
    const imgMap = new Map(image.current.map((r) => [keyOf(r.keys), r]));
    const keys = [...new Set([...webMap.keys(), ...imgMap.keys()])];
    const rows = keys.map((key) => {
      const w = webMap.get(key) ?? null;
      const m = imgMap.get(key) ?? null;
      const ratio = w && m && w.impressions > 0 ? m.impressions / w.impressions : null;
      return {
        key,
        web: w ? { clicks: w.clicks, impressions: w.impressions, ctr: w.ctr, position: w.position } : null,
        image: m ? { clicks: m.clicks, impressions: m.impressions, ctr: m.ctr, position: m.position } : null,
        imageVsWebImpressionsRatio: ratio,
      };
    }).sort((a, b) => (b.image?.impressions ?? 0) - (a.image?.impressions ?? 0));
    return ok({ rows: rows.slice(0, limit), rowsTotal: rows.length }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl }, {
      attempts: budget.attemptsUsed,
      coverage: {
        sourceGuarantee: "top_rows_not_exhaustive",
        apiPaginationComplete: true,
        fetchedRows: web.current.length + image.current.length,
        returnedRows: Math.min(limit, rows.length),
        truncatedByProduct: rows.length > limit,
        stoppedBecause: [],
        sortAppliedTo: "retrieved_dataset",
      },
      warnings: [{ code: "SURFACES", message: "Web and image are separate universes: no unique-audience sums, no cross-surface CTR transfer." }],
    });
  } catch (err) {
    return fail(err);
  }
}
