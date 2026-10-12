import type { AuthProvider } from "../auth-provider.js";
import { RequestBudget } from "../gsc/budget.js";
import type { DatasetStore } from "../gsc/datasets.js";
import type { ToolEnvelope } from "../gsc/envelope.js";
import { gscAnalyzeTrafficDrop } from "../gsc/tools.js";
/**
 * gsc_check_update_impact — correlate a site's traffic-drop window with
 * confirmed Google ranking updates (core / spam / reviews) and report
 * temporal coincidence, never causal attribution.
 *
 * The drop window comes from the caller (explicit dates or preset) with a
 * `last_28_days` default; the drop evidence itself is produced by the
 * existing traffic-drop engine (`gscAnalyzeTrafficDrop`, reused via
 * injection, never duplicated) inside one shared RequestBudget.
 *
 * Ranking-update data comes from the official Google Search Status
 * Dashboard public feed (no auth): fetched with guardedFetch
 * (public-host policy, redirect revalidation, timeout and size limits)
 * plus a local file cache, with a small bundled curated snapshot as the
 * offline fallback. Dashboard incident history starts in December 2022
 * (UPDATE_HISTORY_FLOOR): earlier updates are outside both the live feed
 * and the snapshot, and the output says so.
 */
export declare const UPDATE_FEED_URL = "https://status.search.google.com/en/rss";
export declare const UPDATE_HISTORY_FLOOR = "2022-12-14";
export declare const UPDATE_FEED_TIMEOUT_MS = 10000;
export declare const UPDATE_FEED_MAX_BYTES: number;
export declare const UPDATE_FEED_CACHE_TTL_MS: number;
export declare const UPDATE_FEED_CACHE_FILE = "update-feed-cache.json";
export declare const NON_CAUSALITY_DISCLAIMER: string;
export type RankingUpdateType = "core" | "spam" | "reviews" | "other";
export type UpdateTypeFilter = "all" | "core" | "spam" | "reviews";
export interface RankingUpdate {
    name: string;
    type: RankingUpdateType;
    /** Inclusive rollout start, YYYY-MM-DD. */
    startDate: string;
    /** Inclusive rollout end, YYYY-MM-DD (point announcements: == startDate). */
    endDate: string;
    status: string;
    url: string;
}
export interface UpdateImpactInput {
    siteUrl: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    baseline?: string | {
        startDate: string;
        endDate: string;
    };
    updateType?: UpdateTypeFilter;
    dimension?: string;
    minAbsLoss?: number;
    resultLimit?: number;
    maxFetchRows?: number;
}
export interface UpdateOverlap {
    name: string;
    type: RankingUpdateType;
    startDate: string;
    endDate: string;
    status: string;
    url: string;
    overlapStart: string;
    overlapEnd: string;
    overlapDays: number;
    confidence: "high" | "medium";
    language: string;
}
export interface UpdateImpactData {
    siteUrl: string;
    dropWindow: {
        startDate: string;
        endDate: string;
    };
    baselinePeriod: {
        startDate: string;
        endDate: string;
    } | null;
    dropsAnalyzed: number;
    updateTypeFilter: UpdateTypeFilter;
    feed: {
        source: "live" | "cache" | "snapshot";
        url: string;
        fetchedAt: string | null;
        historyFloor: string;
        note: string;
    };
    overlaps: UpdateOverlap[];
    overlapsTotal: number;
    disclaimer: string;
}
export interface UpdateImpactDeps {
    provider?: AuthProvider;
    fetchImpl?: typeof fetch;
    budget?: RequestBudget;
    allowlist?: string[] | null;
    profileAlias?: string;
    store?: DatasetStore;
    /** Injected seam: defaults to the real traffic-drop engine. Tests stub it. */
    dropEngine?: typeof gscAnalyzeTrafficDrop;
    /** Injected seam: defaults to a guardedFetch of the dashboard feed. Tests stub it. */
    feedFetch?: (url: string) => Promise<{
        status: number;
        text: string;
    }>;
    /** Offline fallback entries. Defaults to CURATED_UPDATES. */
    curatedUpdates?: RankingUpdate[];
    cacheDir?: string;
    cacheTtlMs?: number;
    /** File cache on/off. Defaults to true; tests disable it. */
    useCache?: boolean;
}
/**
 * Bundled curated snapshot: a small subset of confirmed ranking updates
 * used only when the live dashboard feed (and the local cache) are
 * unavailable. Dates follow the public dashboard; every entry links back
 * to it so readers can verify. The live feed always carries per-incident
 * links; snapshot entries point at the dashboard root.
 */
export declare const CURATED_UPDATES: RankingUpdate[];
/** Classify a dashboard incident title into core / spam / reviews / other. */
export declare function classifyUpdateType(title: string, description?: string): RankingUpdateType;
/**
 * Parse the dashboard RSS feed into point updates (announcement day as
 * both start and end). Rollout windows are not in the RSS item fields, so
 * feed entries coincide by announcement day; ranged windows come from the
 * incident pages and the curated snapshot. Unparseable items are skipped,
 * never invented.
 */
export declare function parseUpdateFeed(xml: string): RankingUpdate[];
export declare function checkUpdateImpact(input: UpdateImpactInput, deps?: UpdateImpactDeps): Promise<ToolEnvelope<UpdateImpactData>>;
