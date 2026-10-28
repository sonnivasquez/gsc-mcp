export { CANONICAL_TOOLS } from "./catalog.js";
export type { CapabilityKind, CapabilityInfo } from "./catalog.js";
import type { AuthProvider } from "../auth-provider.js";
import { RequestBudget } from "./budget.js";
import type { AnalyticsRow } from "./client.js";
import type { ToolEnvelope } from "./envelope.js";
import type { DatasetStore } from "./datasets.js";
import type { DateRange } from "./periods.js";
import type { OpportunityResult } from "./opportunities.js";
import type { ComparedRow, Totals } from "./compare.js";
import type { CannibalizationCandidate } from "./cannibalization.js";
export interface ToolDeps {
    provider?: AuthProvider;
    fetchImpl?: typeof fetch;
    budget?: RequestBudget;
    allowlist?: string[] | null;
    profileAlias?: string;
    store?: DatasetStore;
}
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
    evidencePreview?: {
        storedCandidates: number;
        encoding: string;
        instructions: string;
    };
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
export declare const SUPPORTED_DIMENSIONS: string[];
export declare const SUPPORTED_SEARCH_TYPES: string[];
export declare function gscCapabilities(deps?: ToolDeps): ToolEnvelope<Record<string, unknown>>;
export declare function gscListSites(deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface SearchAnalyticsInput {
    siteUrl: string;
    startDate?: string;
    endDate?: string;
    preset?: string;
    dimensions: string[];
    filters?: Array<{
        dimension: string;
        operator: string;
        expression: string;
    }>;
    searchType?: string;
    dataState?: string;
    aggregationType?: string;
    sortBy?: string;
    sortDirection?: string;
    resultLimit?: number;
    maxFetchRows?: number;
}
export type SortField = "clicks" | "impressions" | "ctr" | "position";
export declare function gscSearchAnalytics(input: SearchAnalyticsInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface InspectInput {
    siteUrl: string;
    urls: string[];
    languageCode?: string;
}
export interface UrlResult {
    url: string;
    status: "ok" | "error";
    result?: unknown;
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
}
export declare function gscInspectUrls(input: InspectInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export declare function gscListSitemaps(siteUrl: string, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface GetDatasetInput {
    datasetId: string;
    cursor?: string;
    limit?: number;
    columns?: string[];
}
export declare function gscGetDataset(input: GetDatasetInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface PeriodInput {
    preset?: string;
    startDate?: string;
    endDate?: string;
    baseline?: string | {
        startDate: string;
        endDate: string;
    };
}
export interface SearchCommon {
    siteUrl: string;
    searchType?: string;
    dataState?: string;
    filters?: Array<{
        dimension: string;
        operator: string;
        expression: string;
    }>;
    maxFetchRows?: number;
    resultLimit?: number;
}
export interface OverviewInput extends PeriodInput, SearchCommon {
    includeTimeline?: boolean;
    includeComparison?: boolean;
}
export interface OverviewData {
    totals: {
        clicks: number;
        impressions: number;
        ctr: number | null;
        position: number | null;
    };
    timeline?: AnalyticsRow[];
    comparison: unknown;
    period: DateRange;
    resolution: string;
}
export declare function gscPerformanceOverview(input: OverviewInput, deps?: ToolDeps): Promise<ToolEnvelope<OverviewData>>;
export interface CompareInput extends PeriodInput, SearchCommon {
    dimension: string;
    orderBy?: string;
    sortDirection?: string;
}
export declare function gscComparePeriods(input: CompareInput, deps?: ToolDeps): Promise<ToolEnvelope<CompareTotalsData | CompareDimensionalData>>;
export interface PageQueriesInput extends PeriodInput, SearchCommon {
    pageUrl: string;
}
export interface QueryPagesInput extends PeriodInput, SearchCommon {
    query: string;
}
export declare function gscPageQueries(input: PageQueriesInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export declare function gscQueryPages(input: QueryPagesInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
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
    benchmarkCurve?: Array<{
        maxPosition: number;
        expectedCtr: number;
    }>;
}
export declare function gscFindOpportunities(input: OpportunitiesInput, deps?: ToolDeps): Promise<ToolEnvelope<OpportunityResult>>;
export interface CannibalizationInput extends PeriodInput, SearchCommon {
    includeTimeline?: boolean;
    timelineQueryLimit?: number;
    minDailyImpressions?: number;
    minPages?: number;
    minImpressionsPerPage?: number;
    minSharePct?: number;
}
export declare function gscDetectCannibalization(input: CannibalizationInput, deps?: ToolDeps): Promise<ToolEnvelope<CannibalizationData>>;
export interface SegmentsInput extends PeriodInput, SearchCommon {
    segments: Array<{
        id: string;
        label: string;
        brandTerms?: string[];
        pathPrefix?: string;
        country?: string;
        device?: string;
    }>;
}
export declare function gscAnalyzeSegments(input: SegmentsInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface ExportInput {
    datasetId: string;
    format: string;
    name?: string;
}
export declare function gscExportDataset(input: ExportInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
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
export declare function gscAnalyzeTrafficDrop(input: TrafficDropInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface DecayInput extends PeriodInput, SearchCommon {
    dimension?: string;
    windowDays?: number;
    minBaseClicks?: number;
    minDeclinePct?: number;
}
export declare function gscContentDecay(input: DecayInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export declare const ALERT_RULES_VERSION = "t17.1";
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
export declare function gscCheckAlerts(input: AlertsInput, deps?: ToolDeps): Promise<ToolEnvelope<AlertsData>>;
export interface ContentCandidatesInput extends PeriodInput, SearchCommon {
    minImpressions?: number;
    minPosition?: number;
    maxExpand?: number;
}
export declare function gscContentCandidates(input: ContentCandidatesInput, deps?: ToolDeps): Promise<ToolEnvelope<CandidatesData>>;
export interface RecommendationsInput extends PeriodInput, SearchCommon {
    categories?: string[];
    maxRecommendations?: number;
}
export declare function gscContentRecommendations(input: RecommendationsInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface MultiSiteInput extends PeriodInput, Omit<SearchCommon, "siteUrl"> {
    sites: string[];
    includeComparison?: boolean;
}
export declare function gscMultiSiteOverview(input: MultiSiteInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface ReportInput extends PeriodInput, Omit<SearchCommon, "siteUrl"> {
    siteUrl?: string;
    sites?: string[];
    sections?: string[];
    save?: boolean;
    detail?: string;
}
export declare function gscGenerateReport(input: ReportInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface ClaimInput {
    metric: string;
    value: number;
    siteUrl: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    searchType?: string;
    dataState?: string;
    filters?: Array<{
        dimension: string;
        operator: string;
        expression: string;
    }>;
    compareWithBaseline?: boolean;
    toleranceAbs?: number;
    toleranceRel?: number;
}
export declare function gscVerifyClaim(input: ClaimInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
export interface WebImageInput extends PeriodInput, SearchCommon {
    dimension?: string;
    resultLimit?: number;
}
export declare function gscCompareWebImage(input: WebImageInput, deps?: ToolDeps): Promise<ToolEnvelope<unknown>>;
