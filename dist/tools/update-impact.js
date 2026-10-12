"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURATED_UPDATES = exports.NON_CAUSALITY_DISCLAIMER = exports.UPDATE_FEED_CACHE_FILE = exports.UPDATE_FEED_CACHE_TTL_MS = exports.UPDATE_FEED_MAX_BYTES = exports.UPDATE_FEED_TIMEOUT_MS = exports.UPDATE_HISTORY_FLOOR = exports.UPDATE_FEED_URL = void 0;
exports.classifyUpdateType = classifyUpdateType;
exports.parseUpdateFeed = parseUpdateFeed;
exports.checkUpdateImpact = checkUpdateImpact;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fetch_guard_js_1 = require("../fetch-guard.js");
const budget_js_1 = require("../gsc/budget.js");
const envelope_js_1 = require("../gsc/envelope.js");
const errors_js_1 = require("../gsc/errors.js");
const periods_js_1 = require("../gsc/periods.js");
const tools_js_1 = require("../gsc/tools.js");
const profiles_js_1 = require("../profiles.js");
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
exports.UPDATE_FEED_URL = "https://status.search.google.com/en/rss";
exports.UPDATE_HISTORY_FLOOR = "2022-12-14";
exports.UPDATE_FEED_TIMEOUT_MS = 10_000;
exports.UPDATE_FEED_MAX_BYTES = 512 * 1024;
exports.UPDATE_FEED_CACHE_TTL_MS = 6 * 3600 * 1000;
exports.UPDATE_FEED_CACHE_FILE = "update-feed-cache.json";
exports.NON_CAUSALITY_DISCLAIMER = "Temporal coincidence only: an overlap means a confirmed ranking update rolled out " +
    "during the drop window. It is not evidence that the update caused the drop. " +
    "Causes stay unverified without page-level inspection and change history " +
    "(consistent with gsc_verify_claim: external causes are out of scope).";
/**
 * Bundled curated snapshot: a small subset of confirmed ranking updates
 * used only when the live dashboard feed (and the local cache) are
 * unavailable. Dates follow the public dashboard; every entry links back
 * to it so readers can verify. The live feed always carries per-incident
 * links; snapshot entries point at the dashboard root.
 */
exports.CURATED_UPDATES = [
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
const UPDATE_TYPE_FILTERS = ["all", "core", "spam", "reviews"];
/** Classify a dashboard incident title into core / spam / reviews / other. */
function classifyUpdateType(title, description = "") {
    const text = `${title} ${description}`.toLowerCase();
    if (/spam update/.test(text))
        return "spam";
    if (/review(s)? update/.test(text))
        return "reviews";
    if (/core update/.test(text) || /helpful content/.test(text))
        return "core";
    return "other";
}
function stripCdata(value) {
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}
function extractTag(item, tag) {
    const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match ? stripCdata(match[1]) : null;
}
function isoDay(value) {
    const time = Date.parse(value);
    if (Number.isNaN(time))
        return null;
    return new Date(time).toISOString().slice(0, 10);
}
/**
 * Parse the dashboard RSS feed into point updates (announcement day as
 * both start and end). Rollout windows are not in the RSS item fields, so
 * feed entries coincide by announcement day; ranged windows come from the
 * incident pages and the curated snapshot. Unparseable items are skipped,
 * never invented.
 */
function parseUpdateFeed(xml) {
    const updates = [];
    for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []) {
        const title = extractTag(item, "title");
        const link = extractTag(item, "link");
        const pubDate = extractTag(item, "pubDate") ?? extractTag(item, "pubdate");
        const description = extractTag(item, "description") ?? "";
        if (!title || !link || !pubDate)
            continue;
        const day = isoDay(pubDate);
        if (!day)
            continue;
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
function readFeedCache(cacheDir) {
    try {
        const raw = fs.readFileSync(path.join(cacheDir, exports.UPDATE_FEED_CACHE_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.items))
            return null;
        return { fetchedAt: parsed.fetchedAt, items: parsed.items };
    }
    catch {
        return null;
    }
}
function writeFeedCache(cacheDir, items) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        const payload = { fetchedAt: new Date().toISOString(), items };
        fs.writeFileSync(path.join(cacheDir, exports.UPDATE_FEED_CACHE_FILE), JSON.stringify(payload), "utf8");
    }
    catch {
        // Cache is best-effort: a failed write never fails the tool.
    }
}
async function defaultFeedFetch(url) {
    const { response } = await (0, fetch_guard_js_1.guardedFetch)(url, {
        timeoutMs: exports.UPDATE_FEED_TIMEOUT_MS,
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    const text = await response.text();
    if (text.length > exports.UPDATE_FEED_MAX_BYTES) {
        throw new errors_js_1.GscError("UPSTREAM_ERROR", `dashboard feed exceeded ${exports.UPDATE_FEED_MAX_BYTES} bytes`, {
            suggestedAction: "retry later; the curated snapshot covers known updates",
        });
    }
    if (!response.ok) {
        throw new errors_js_1.GscError("UPSTREAM_ERROR", `dashboard feed answered ${response.status}`, {
            suggestedAction: "retry later; the curated snapshot covers known updates",
        });
    }
    return { status: response.status, text };
}
async function loadRankingUpdates(deps) {
    const feedFetch = deps.feedFetch ?? defaultFeedFetch;
    const useCache = deps.useCache ?? true;
    const cacheDir = deps.cacheDir ?? (0, profiles_js_1.dataDir)();
    const cacheTtlMs = deps.cacheTtlMs ?? exports.UPDATE_FEED_CACHE_TTL_MS;
    try {
        const { text } = await feedFetch(exports.UPDATE_FEED_URL);
        const updates = parseUpdateFeed(text);
        if (useCache)
            writeFeedCache(cacheDir, updates);
        return { updates, source: "live", fetchedAt: new Date().toISOString(), feedFailed: false };
    }
    catch {
        if (useCache) {
            const cached = readFeedCache(cacheDir);
            if (cached && Date.now() - Date.parse(cached.fetchedAt) <= cacheTtlMs) {
                return { updates: cached.items, source: "cache", fetchedAt: cached.fetchedAt, feedFailed: true };
            }
        }
        return {
            updates: deps.curatedUpdates ?? exports.CURATED_UPDATES,
            source: "snapshot",
            fetchedAt: null,
            feedFailed: true,
        };
    }
}
function overlapDaysInclusive(aStart, aEnd, bStart, bEnd) {
    const start = aStart > bStart ? aStart : bStart;
    const end = aEnd < bEnd ? aEnd : bEnd;
    if (start > end)
        return null;
    const ms = Date.parse(end) - Date.parse(start);
    return Math.round(ms / 86_400_000) + 1;
}
function buildOverlap(update, window) {
    const days = overlapDaysInclusive(window.startDate, window.endDate, update.startDate, update.endDate);
    if (days === null)
        return null;
    const contained = (update.startDate >= window.startDate && update.endDate <= window.endDate) ||
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
        language: `The drop window ${window.startDate}..${window.endDate} coincides with ` +
            `${update.name} (${update.type}, ${update.startDate}..${update.endDate}, ${update.status}).`,
    };
}
async function checkUpdateImpact(input, deps = {}) {
    const fetchedAt = new Date().toISOString();
    try {
        if (typeof input.siteUrl !== "string" || input.siteUrl.trim() === "") {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "siteUrl is required: the exact GSC property identifier");
        }
        const updateType = input.updateType ?? "all";
        if (!UPDATE_TYPE_FILTERS.includes(updateType)) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", `updateType must be ${UPDATE_TYPE_FILTERS.join(", ")}`);
        }
        const dimension = input.dimension ?? "page";
        if (dimension !== "page" && dimension !== "query") {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", 'dimension must be "page" or "query"');
        }
        const minAbsLoss = input.minAbsLoss ?? 10;
        if (typeof minAbsLoss !== "number" || !Number.isFinite(minAbsLoss) || minAbsLoss < 0) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "minAbsLoss must be a finite number >= 0");
        }
        const resultLimit = input.resultLimit ?? 10;
        if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 200) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "resultLimit must be an integer between 1 and 200");
        }
        const maxFetchRows = input.maxFetchRows ?? 5000;
        if (!Number.isInteger(maxFetchRows) || maxFetchRows < 1 || maxFetchRows > 50000) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "maxFetchRows must be an integer between 1 and 50000");
        }
        // Instance allowlist first: no GSC call and no feed fetch for a
        // non-member property. Null (library/test use) skips enforcement,
        // matching assertSiteAllowed; empty denies every property.
        const allowlist = deps.allowlist !== undefined ? deps.allowlist : (0, profiles_js_1.getInstanceAllowlist)();
        if (allowlist !== null && !(0, profiles_js_1.isAllowAllAllowlist)(allowlist) && !allowlist.includes(input.siteUrl)) {
            throw (0, errors_js_1.propertyNotAllowed)(input.siteUrl, allowlist.length);
        }
        const hasPreset = input.preset !== undefined;
        const hasExplicit = input.startDate !== undefined || input.endDate !== undefined;
        const periods = (0, periods_js_1.resolvePeriods)(hasPreset || hasExplicit
            ? { preset: input.preset, startDate: input.startDate, endDate: input.endDate }
            : { preset: "last_28_days" });
        const window = periods.current;
        // One shared budget for the whole call: the drop engine reuses this
        // instance, so its Google attempts count against the same ceiling.
        // The public dashboard feed never consumes Google data attempts.
        const budget = deps.budget ?? new budget_js_1.RequestBudget();
        const dropEngine = deps.dropEngine ?? tools_js_1.gscAnalyzeTrafficDrop;
        const dropEnv = await dropEngine({
            siteUrl: input.siteUrl,
            preset: input.preset,
            startDate: input.startDate,
            endDate: input.endDate,
            baseline: input.baseline,
            dimension: dimension,
            minAbsLoss,
            maxFetchRows,
        }, {
            provider: deps.provider,
            fetchImpl: deps.fetchImpl,
            budget,
            allowlist,
            ...(deps.profileAlias !== undefined ? { profileAlias: deps.profileAlias } : {}),
            ...(deps.store !== undefined ? { store: deps.store } : {}),
        });
        if (dropEnv.status === "error" || dropEnv.data === null) {
            const err = dropEnv.error;
            throw new errors_js_1.GscError(err?.code ?? "UPSTREAM_ERROR", err?.message ?? "traffic-drop analysis failed", { retryable: err?.retryable ?? false, suggestedAction: err?.suggestedAction });
        }
        const dropData = dropEnv.data;
        const dropsAnalyzed = (Array.isArray(dropData.drops) ? dropData.drops.length : 0) +
            (Array.isArray(dropData.vanished) ? dropData.vanished.length : 0);
        const baselinePeriod = dropData.baselinePeriod ?? null;
        const loaded = await loadRankingUpdates(deps);
        const considered = updateType === "all" ? loaded.updates : loaded.updates.filter((u) => u.type === updateType);
        const overlaps = considered
            .map((u) => buildOverlap(u, window))
            .filter((o) => o !== null)
            .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
        const warnings = [{ code: "NO_CAUSALITY", message: exports.NON_CAUSALITY_DISCLAIMER }];
        for (const w of dropEnv.meta.warnings) {
            if (w.code !== "NO_CAUSALITY" && !warnings.some((seen) => seen.message === w.message)) {
                warnings.push(w);
            }
        }
        if (loaded.feedFailed) {
            warnings.push({
                code: "FEED_FALLBACK",
                message: loaded.source === "cache"
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
        return (0, envelope_js_1.ok)({
            siteUrl: input.siteUrl,
            dropWindow: window,
            baselinePeriod,
            dropsAnalyzed,
            updateTypeFilter: updateType,
            feed: {
                source: loaded.source,
                url: exports.UPDATE_FEED_URL,
                fetchedAt: loaded.fetchedAt,
                historyFloor: exports.UPDATE_HISTORY_FLOOR,
                note: "Dashboard incident history starts in December 2022; earlier updates are " +
                    "outside both the live feed and the snapshot.",
            },
            overlaps: overlaps.slice(0, resultLimit),
            overlapsTotal: overlaps.length,
            disclaimer: exports.NON_CAUSALITY_DISCLAIMER,
        }, { source: "google_search_console", fetchedAt, siteUrl: input.siteUrl, period: window }, {
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
        });
    }
    catch (err) {
        return (0, envelope_js_1.fail)(err);
    }
}
