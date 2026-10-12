import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthProvider } from "../auth-provider.js";
import { guardedFetch } from "../fetch-guard.js";
import { RequestBudget } from "../gsc/budget.js";
import type { DatasetStore } from "../gsc/datasets.js";
import { fail, ok } from "../gsc/envelope.js";
import type { ToolEnvelope } from "../gsc/envelope.js";
import { GscError, propertyNotAllowed } from "../gsc/errors.js";
import { resolvePeriods } from "../gsc/periods.js";
import { gscAnalyzeTrafficDrop } from "../gsc/tools.js";
import { dataDir, getInstanceAllowlist, isAllowAllAllowlist } from "../profiles.js";

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

export const UPDATE_FEED_URL = "https://status.search.google.com/en/rss";
export const UPDATE_HISTORY_FLOOR = "2022-12-14";
export const UPDATE_FEED_TIMEOUT_MS = 10_000;
export const UPDATE_FEED_MAX_BYTES = 512 * 1024;
export const UPDATE_FEED_CACHE_TTL_MS = 6 * 3600 * 1000;
export const UPDATE_FEED_CACHE_FILE = "update-feed-cache.json";

export const NON_CAUSALITY_DISCLAIMER =
  "Temporal coincidence only: an overlap means a confirmed ranking update rolled out " +
  "during the drop window. It is not evidence that the update caused the drop. " +
  "Causes stay unverified without page-level inspection and change history " +
  "(consistent with gsc_verify_claim: external causes are out of scope).";

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
  baseline?: string | { startDate: string; endDate: string };
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
  dropWindow: { startDate: string; endDate: string };
  baselinePeriod: { startDate: string; endDate: string } | null;
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
  feedFetch?: (url: string) => Promise<{ status: number; text: string }>;
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
export const CURATED_UPDATES: RankingUpdate[] = [
  {
    name: "November 2023 reviews update",
    type: "reviews",
    startDate: "2023-11-08",
    endDate: "2023-12-07",
    status: "completed",
    url: "https://status.search.google.com/",
  },
  {
    name: "March 2024 core update",
    type: "core",
    startDate: "2024-03-05",
    endDate: "2024-04-19",
    status: "completed",
    url: "https://status.search.google.com/",
  },
  {
    name: "August 2024 core update",
    type: "core",
    startDate: "2024-08-15",
    endDate: "2024-09-03",
    status: "completed",
    url: "https://status.search.google.com/",
  },
  {
    name: "December 2024 spam update",
    type: "spam",
    startDate: "2024-12-19",
    endDate: "2024-12-26",
    status: "completed",
    url: "https://status.search.google.com/",
  },
  {
    name: "March 2025 core update",
    type: "core",
    startDate: "2025-03-13",
    endDate: "2025-03-27",
    status: "completed",
    url: "https://status.search.google.com/",
  },
];

const UPDATE_TYPE_FILTERS: UpdateTypeFilter[] = ["all", "core", "spam", "reviews"];

/** Classify a dashboard incident title into core / spam / reviews / other. */
export function classifyUpdateType(title: string, description = ""): RankingUpdateType {
  const text = `${title} ${description}`.toLowerCase();
  if (/spam update/.test(text)) return "spam";
  if (/review(s)? update/.test(text)) return "reviews";
  if (/core update/.test(text) || /helpful content/.test(text)) return "core";
  return "other";
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractTag(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripCdata(match[1]) : null;
}

function isoDay(value: string): string | null {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Parse the dashboard RSS feed into point updates (announcement day as
 * both start and end). Rollout windows are not in the RSS item fields, so
 * feed entries coincide by announcement day; ranged windows come from the
 * incident pages and the curated snapshot. Unparseable items are skipped,
 * never invented.
 */
export function parseUpdateFeed(xml: string): RankingUpdate[] {
  const updates: RankingUpdate[] = [];
  for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []) {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate") ?? extractTag(item, "pubdate");
    const description = extractTag(item, "description") ?? "";
    if (!title || !link || !pubDate) continue;
    const day = isoDay(pubDate);
    if (!day) continue;
    updates.push({
      name: title,
      type: classifyUpdateType(title, description),
      startDate: day,
      endDate: day,
      status: "announced",
      url: link,
    });
  }
  return updates;
}

interface FeedCache {
  fetchedAt: string;
  items: RankingUpdate[];
}

function readFeedCache(cacheDir: string): FeedCache | null {
  try {
    const raw = fs.readFileSync(path.join(cacheDir, UPDATE_FEED_CACHE_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<FeedCache>;
    if (typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.items)) return null;
    return { fetchedAt: parsed.fetchedAt, items: parsed.items };
  } catch {
    return null;
  }
}

function writeFeedCache(cacheDir: string, items: RankingUpdate[]): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const payload: FeedCache = { fetchedAt: new Date().toISOString(), items };
    fs.writeFileSync(path.join(cacheDir, UPDATE_FEED_CACHE_FILE), JSON.stringify(payload), "utf8");
  } catch {
    // Cache is best-effort: a failed write never fails the tool.
  }
}

async function defaultFeedFetch(url: string): Promise<{ status: number; text: string }> {
  const { response } = await guardedFetch(url, {
    timeoutMs: UPDATE_FEED_TIMEOUT_MS,
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  });
  const text = await response.text();
  if (text.length > UPDATE_FEED_MAX_BYTES) {
    throw new GscError("UPSTREAM_ERROR", `dashboard feed exceeded ${UPDATE_FEED_MAX_BYTES} bytes`, {
      suggestedAction: "retry later; the curated snapshot covers known updates",
    });
  }
  if (!response.ok) {
    throw new GscError("UPSTREAM_ERROR", `dashboard feed answered ${response.status}`, {
      suggestedAction: "retry later; the curated snapshot covers known updates",
    });
  }
  return { status: response.status, text };
}

interface LoadedUpdates {
  updates: RankingUpdate[];
  source: "live" | "cache" | "snapshot";
  fetchedAt: string | null;
  feedFailed: boolean;
}

async function loadRankingUpdates(deps: UpdateImpactDeps): Promise<LoadedUpdates> {
  const feedFetch = deps.feedFetch ?? defaultFeedFetch;
  const useCache = deps.useCache ?? true;
  const cacheDir = deps.cacheDir ?? dataDir();
  const cacheTtlMs = deps.cacheTtlMs ?? UPDATE_FEED_CACHE_TTL_MS;
  try {
    const { text } = await feedFetch(UPDATE_FEED_URL);
    const updates = parseUpdateFeed(text);
    if (useCache) writeFeedCache(cacheDir, updates);
    return { updates, source: "live", fetchedAt: new Date().toISOString(), feedFailed: false };
  } catch {
    if (useCache) {
      const cached = readFeedCache(cacheDir);
      if (cached && Date.now() - Date.parse(cached.fetchedAt) <= cacheTtlMs) {
        return { updates: cached.items, source: "cache", fetchedAt: cached.fetchedAt, feedFailed: true };
      }
    }
    return {
      updates: deps.curatedUpdates ?? CURATED_UPDATES,
      source: "snapshot",
      fetchedAt: null,
      feedFailed: true,
    };
  }
}

function overlapDaysInclusive(aStart: string, aEnd: string, bStart: string, bEnd: string): number | null {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Math.round(ms / 86_400_000) + 1;
}

function buildOverlap(
  update: RankingUpdate,
  window: { startDate: string; endDate: string }
): UpdateOverlap | null {
  const days = overlapDaysInclusive(window.startDate, window.endDate, update.startDate, update.endDate);
  if (days === null) return null;
  const contained =
    (update.startDate >= window.startDate && update.endDate <= window.endDate) ||
    (window.startDate >= update.startDate && window.endDate <= update.endDate);
  const overlapStart = window.startDate > update.startDate ? window.startDate : update.startDate;
  const overlapEnd = window.endDate < update.endDate ? window.endDate : update.endDate;
  return {
    name: update.name,
    type: update.type,
    startDate: update.startDate,
    endDate: update.endDate,
    status: update.status,
    url: update.url,
    overlapStart,
    overlapEnd,
    overlapDays: days,
    confidence: contained ? "high" : "medium",
    language:
      `The drop window ${window.startDate}..${window.endDate} coincides with ` +
      `${update.name} (${update.type}, ${update.startDate}..${update.endDate}, ${update.status}).`,
  };
}

export async function checkUpdateImpact(
  input: UpdateImpactInput,
  deps: UpdateImpactDeps = {}
): Promise<ToolEnvelope<UpdateImpactData>> {
  const fetchedAt = new Date().toISOString();
  try {
    if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
      throw new GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
    }
    const updateType = input.updateType ?? "all";
    if (!UPDATE_TYPE_FILTERS.includes(updateType)) {
      throw new GscError("INVALID_ARGUMENT", `updateType must be ${UPDATE_TYPE_FILTERS.join(", ")}`);
    }
    const dimension = input.dimension ?? "page";
    if (dimension !== "page" && dimension !== "query") {
      throw new GscError("INVALID_ARGUMENT", 'dimension must be "page" or "query"');
    }
    const minAbsLoss = input.minAbsLoss ?? 10;
    if (typeof minAbsLoss !== "number" || !Number.isFinite(minAbsLoss) || minAbsLoss < 0) {
      throw new GscError("INVALID_ARGUMENT", "minAbsLoss must be a finite number >= 0");
    }
    const resultLimit = input.resultLimit ?? 10;
    if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 200) {
      throw new GscError("INVALID_ARGUMENT", "resultLimit must be an integer between 1 and 200");
    }
    const maxFetchRows = input.maxFetchRows ?? 5000;
    if (!Number.isInteger(maxFetchRows) || maxFetchRows < 1 || maxFetchRows > 50000) {
      throw new GscError("INVALID_ARGUMENT", "maxFetchRows must be an integer between 1 and 50000");
    }

    // Instance allowlist first: no GSC call and no feed fetch for a
    // non-member property. Null (library/test use) skips enforcement,
    // matching assertSiteAllowed; empty denies every property.
    const allowlist = deps.allowlist !== undefined ? deps.allowlist : getInstanceAllowlist();
    if (allowlist !== null && !isAllowAllAllowlist(allowlist) && !allowlist.includes(input.siteUrl)) {
      throw propertyNotAllowed(input.siteUrl, allowlist.length);
    }

    const hasPreset = input.preset !== undefined;
    const hasExplicit = input.startDate !== undefined || input.endDate !== undefined;
    const periods = resolvePeriods(
      hasPreset || hasExplicit
        ? { preset: input.preset, startDate: input.startDate, endDate: input.endDate }
        : { preset: "last_28_days" }
    );
    const window = periods.current;

    // One shared budget for the whole call: the drop engine reuses this
    // instance, so its Google attempts count against the same ceiling.
    // The public dashboard feed never consumes Google data attempts.
    const budget = deps.budget ?? new RequestBudget();
    const dropEngine = deps.dropEngine ?? gscAnalyzeTrafficDrop;
    const dropEnv = await dropEngine(
      {
        siteUrl: input.siteUrl,
        preset: input.preset,
        startDate: input.startDate,
        endDate: input.endDate,
        baseline: input.baseline,
        dimension: dimension as "page" | "query",
        minAbsLoss,
        maxFetchRows,
      },
      {
        provider: deps.provider,
        fetchImpl: deps.fetchImpl,
        budget,
        allowlist,
        ...(deps.profileAlias !== undefined ? { profileAlias: deps.profileAlias } : {}),
        ...(deps.store !== undefined ? { store: deps.store } : {}),
      }
    );
    if (dropEnv.status === "error" || dropEnv.data === null) {
      const err = dropEnv.error;
      throw new GscError(
        (err?.code as GscError["code"]) ?? "UPSTREAM_ERROR",
        err?.message ?? "traffic-drop analysis failed",
        { retryable: err?.retryable ?? false, suggestedAction: err?.suggestedAction }
      );
    }
    const dropData = dropEnv.data as {
      drops?: unknown;
      vanished?: unknown;
      baselinePeriod?: { startDate: string; endDate: string } | null;
    };
    const dropsAnalyzed =
      (Array.isArray(dropData.drops) ? dropData.drops.length : 0) +
      (Array.isArray(dropData.vanished) ? dropData.vanished.length : 0);
    const baselinePeriod = dropData.baselinePeriod ?? null;

    const loaded = await loadRankingUpdates(deps);
    const considered =
      updateType === "all" ? loaded.updates : loaded.updates.filter((u) => u.type === updateType);
    const overlaps = considered
      .map((u) => buildOverlap(u, window))
      .filter((o): o is UpdateOverlap => o !== null)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

    const warnings = [{ code: "NO_CAUSALITY", message: NON_CAUSALITY_DISCLAIMER }];
    for (const w of dropEnv.meta.warnings) {
      if (w.code !== "NO_CAUSALITY" && !warnings.some((seen) => seen.message === w.message)) {
        warnings.push(w);
      }
    }
    if (loaded.feedFailed) {
      warnings.push({
        code: "FEED_FALLBACK",
        message:
          loaded.source === "cache"
            ? "The live dashboard feed was unreachable; results use the local cache instead."
            : "The live dashboard feed was unreachable; results use the bundled curated snapshot instead.",
      });
    }
    if (overlaps.length === 0) {
      warnings.push({
        code: "NO_OVERLAP",
        message: "No confirmed ranking updates coincide with this drop window.",
      });
    }

    return ok(
      {
        siteUrl: input.siteUrl,
        dropWindow: window,
        baselinePeriod,
        dropsAnalyzed,
        updateTypeFilter: updateType,
        feed: {
          source: loaded.source,
          url: UPDATE_FEED_URL,
          fetchedAt: loaded.fetchedAt,
          historyFloor: UPDATE_HISTORY_FLOOR,
          note:
            "Dashboard incident history starts in December 2022; earlier updates are " +
            "outside both the live feed and the snapshot.",
        },
        overlaps: overlaps.slice(0, resultLimit),
        overlapsTotal: overlaps.length,
        disclaimer: NON_CAUSALITY_DISCLAIMER,
      },
      { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl, period: window },
      {
        attempts: budget.attemptsUsed,
        coverage: {
          sourceGuarantee: "resource_response",
          apiPaginationComplete: true,
          fetchedRows: considered.length,
          returnedRows: Math.min(resultLimit, overlaps.length),
          truncatedByProduct: overlaps.length > resultLimit,
          stoppedBecause: updateType === "all" ? [] : ["type_filter"],
        },
        warnings,
      }
    );
  } catch (err) {
    return fail(err);
  }
}
