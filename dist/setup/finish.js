"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAMPLE_QUERY_ROW_LIMIT = exports.SAMPLE_QUERY_DIMENSIONS = exports.SAMPLE_QUERY_WINDOW_DAYS = exports.EXPECTED_TOOL_COUNT = void 0;
exports.runtimeSummary = runtimeSummary;
exports.describeWriteState = describeWriteState;
exports.toolCatalogSummary = toolCatalogSummary;
exports.skillOutcomeSummary = skillOutcomeSummary;
exports.buildFinishReport = buildFinishReport;
exports.summarizeTargetOutcomes = summarizeTargetOutcomes;
exports.formatFinishReport = formatFinishReport;
exports.parseFirstQueryAnswer = parseFirstQueryAnswer;
exports.sampleWindow = sampleWindow;
exports.summarizeSampleRows = summarizeSampleRows;
exports.runSampleQuery = runSampleQuery;
/**
 * Bounded finish stage for the guided setup flow (T04).
 *
 * After successful client configuration, setup prints one finish report that
 * reuses the already-acquired `sites.list` data (no second Google call) and
 * covers runtime, auth, the Search Console API result, the selected exact
 * properties, write-ops state, client targets, and the current tool catalog.
 *
 * The single minimal sample query is strictly opt-in: it runs only after a
 * separate explicit confirmation (interactive prompt) or the non-interactive
 * `--first-query` flag. `--yes` alone never triggers it. The query is bounded
 * to one property, a short 7-day window, the `date` dimension only (no query
 * strings, no bulk), and at most 5 rows. When permission or data is missing
 * the outcome reports honestly instead of declaring success.
 *
 * Everything here is pure or dependency-injected so tests use mocked Google
 * calls and fixtures: no network, no OAuth browser, no user config edits.
 */
const catalog_js_1 = require("../gsc/catalog.js");
const i18n_js_1 = require("./i18n.js");
/** The canonical catalog size. A mismatched reported count fails honestly. */
exports.EXPECTED_TOOL_COUNT = catalog_js_1.CANONICAL_TOOLS.length;
/** Short window for the opt-in sample query (inclusive dates). */
exports.SAMPLE_QUERY_WINDOW_DAYS = 7;
/** Date breakdown only: never exposes query strings or page URLs. */
exports.SAMPLE_QUERY_DIMENSIONS = ["date"];
/** Hard cap on returned rows for the sample query. */
exports.SAMPLE_QUERY_ROW_LIMIT = 5;
/** Runtime line, mirroring the offline doctor format. */
function runtimeSummary() {
    const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
    return `${runtime} on ${process.platform}-${process.arch}`;
}
/**
 * Write-ops line, mirroring the offline doctor wording. The optional
 * locale selects the human-facing rendering only: English stays
 * byte-identical to the historical copy and env/config keys stay exact in
 * every locale.
 */
function describeWriteState(scope, writeEnabled, accessMode, locale = "en") {
    if (accessMode !== undefined) {
        return accessMode === "full"
            ? (0, i18n_js_1.translateSetup)(locale, "finishWriteAccessFull", { mode: accessMode })
            : (0, i18n_js_1.translateSetup)(locale, "finishWriteAccessReadonly", { mode: accessMode });
    }
    return scope === "full" && writeEnabled
        ? (0, i18n_js_1.translateSetup)(locale, "finishWriteLegacyEnabled")
        : (0, i18n_js_1.translateSetup)(locale, "finishWriteLegacyDisabled");
}
/**
 * Current catalog size against the released expectation. The optional
 * locale selects the human-facing rendering only: counts and the `gsc_*`
 * prefix stay exact in every locale.
 */
function toolCatalogSummary(count = catalog_js_1.CANONICAL_TOOLS.length, locale = "en") {
    const ok = count === exports.EXPECTED_TOOL_COUNT;
    return {
        id: "tools",
        ok,
        detail: ok
            ? (0, i18n_js_1.translateSetup)(locale, "finishToolsOk", { count })
            : (0, i18n_js_1.translateSetup)(locale, "finishToolsMismatch", { expected: exports.EXPECTED_TOOL_COUNT, count }),
    };
}
/**
 * Optional skill-installation section. Installed, previewed, and
 * unsupported outcomes are informational (ok); only a failed install
 * fails the report, truthfully, without rewriting the client section.
 */
function skillOutcomeSummary(skill) {
    return {
        id: "skill",
        ok: skill.status !== "failed",
        detail: skill.detail,
    };
}
/**
 * Build the finish report from the setup run's known values. Pure: the API
 * section reuses the supplied `sites.list` entries, the tools section reads
 * the compiled catalog, and nothing here touches the network.
 */
function buildFinishReport(input) {
    const locale = input.locale ?? "en";
    const sections = [
        { id: "runtime", ok: true, detail: runtimeSummary() },
        { id: "auth", ok: true, detail: (0, i18n_js_1.translateSetup)(locale, "finishAuth", { mode: input.authMode, scope: input.scope }) },
    ];
    if (input.dryRun) {
        sections.push({
            id: "api",
            ok: true,
            detail: (0, i18n_js_1.translateSetup)(locale, "finishApiDryRun"),
        });
    }
    else {
        sections.push({
            id: "api",
            ok: input.siteEntries.length > 0,
            detail: input.siteEntries.length > 1
                ? (0, i18n_js_1.translateSetup)(locale, "finishApiOkMany", { count: input.siteEntries.length })
                : input.siteEntries.length === 1
                    ? (0, i18n_js_1.translateSetup)(locale, "finishApiOkOne")
                    : (0, i18n_js_1.translateSetup)(locale, "finishApiEmpty"),
        });
    }
    const selectedVisible = input.siteEntries.length === 0
        ? input.allowlist.filter(() => false)
        : input.allowlist.filter((site) => input.siteEntries.some((entry) => entry.siteUrl === site));
    sections.push({
        id: "properties",
        ok: !input.dryRun && input.allowlist.length > 0 && selectedVisible.length === input.allowlist.length,
        detail: input.dryRun
            ? input.allowlist.length === 1
                ? (0, i18n_js_1.translateSetup)(locale, "finishPropsPreviewOne")
                : (0, i18n_js_1.translateSetup)(locale, "finishPropsPreviewMany", { count: input.allowlist.length })
            : input.allowlist.length === 0
                ? (0, i18n_js_1.translateSetup)(locale, "finishPropsNone")
                : input.siteEntries.length === 0
                    ? input.allowlist.length === 1
                        ? (0, i18n_js_1.translateSetup)(locale, "finishPropsUnverifiedOne")
                        : (0, i18n_js_1.translateSetup)(locale, "finishPropsUnverifiedMany", { count: input.allowlist.length })
                    : selectedVisible.length === input.allowlist.length
                        ? input.allowlist.length === 1
                            ? (0, i18n_js_1.translateSetup)(locale, "finishPropsAllOne", { sites: input.allowlist.join(", ") })
                            : (0, i18n_js_1.translateSetup)(locale, "finishPropsAllMany", { count: input.allowlist.length, sites: input.allowlist.join(", ") })
                        : (0, i18n_js_1.translateSetup)(locale, "finishPropsPartial", { visible: selectedVisible.length, count: input.allowlist.length }),
    });
    sections.push({
        id: "write_ops",
        ok: true,
        detail: describeWriteState(input.scope, input.writeEnabled, input.accessMode, locale),
    });
    sections.push(summarizeTargetOutcomes(input.clientOutcomes, input.dryRun, locale));
    sections.push(toolCatalogSummary(catalog_js_1.CANONICAL_TOOLS.length, locale));
    if (input.skill !== undefined && input.skill !== null) {
        sections.push(skillOutcomeSummary(input.skill));
    }
    return { ok: sections.every((section) => section.ok), dryRun: input.dryRun, sections, locale };
}
/**
 * Client-target section from structured per-target outcomes. Requested
 * targets are reported exactly as applied, printed fallback, previewed,
 * skipped, or failed: a dry-run preview never claims anything was
 * configured, and a printed manual fallback never claims an install.
 */
function summarizeTargetOutcomes(outcomes, dryRun, locale = "en") {
    if (outcomes.length === 0) {
        return { id: "clients", ok: false, detail: (0, i18n_js_1.translateSetup)(locale, "finishClientsNone") };
    }
    const ok = outcomes.length > 0 &&
        outcomes.every((o) => o.status === "applied" || o.status === "printed" || o.status === "previewed");
    const group = (status) => outcomes.filter((o) => o.status === status).map((o) => o.target);
    if (dryRun) {
        const parts = [];
        const previewed = group("previewed");
        if (previewed.length > 0)
            parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsDryPreviewed", { targets: previewed.join(", ") }));
        const printed = group("printed");
        if (printed.length > 0)
            parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsDryPrinted", { targets: printed.join(", ") }));
        const skipped = group("skipped");
        if (skipped.length > 0)
            parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsDrySkipped", { targets: skipped.join(", ") }));
        const failed = group("failed");
        if (failed.length > 0)
            parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsDryFailed", { targets: failed.join(", ") }));
        const applied = group("applied");
        if (applied.length > 0)
            parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsDryApplied", { targets: applied.join(", ") }));
        return { id: "clients", ok, detail: (0, i18n_js_1.translateSetup)(locale, "finishClientsDryWrap", { parts: parts.join("; ") }) };
    }
    const parts = [];
    const applied = group("applied");
    if (applied.length > 0)
        parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsConfigured", { targets: applied.join(", ") }));
    const printed = group("printed");
    if (printed.length > 0)
        parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsPrinted", { targets: printed.join(", ") }));
    const previewed = group("previewed");
    if (previewed.length > 0)
        parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsPreviewed", { targets: previewed.join(", ") }));
    const skipped = group("skipped");
    if (skipped.length > 0)
        parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsSkipped", { targets: skipped.join(", ") }));
    const failed = group("failed");
    if (failed.length > 0)
        parts.push((0, i18n_js_1.translateSetup)(locale, "finishClientsFailed", { targets: failed.join(", ") }));
    return { id: "clients", ok, detail: parts.join("; ") };
}
/**
 * Human-readable finish lines for the setup terminal output. When the
 * overall configuration failed, the header says so instead of claiming
 * success; the failed/skipped sections carry the truthful detail.
 */
function formatFinishReport(report, opts = {}) {
    const locale = opts.locale ?? report.locale ?? "en";
    const header = report.dryRun && opts.configFailed
        ? (0, i18n_js_1.translateSetup)(locale, "finishHeaderDryRunFailed")
        : report.dryRun
            ? (0, i18n_js_1.translateSetup)(locale, "finishHeaderDryRun")
            : opts.configFailed
                ? (0, i18n_js_1.translateSetup)(locale, "finishHeaderFailed")
                : (0, i18n_js_1.translateSetup)(locale, "finishHeader");
    const lines = [header];
    for (const section of report.sections) {
        lines.push(`  [${section.ok ? "ok" : "!!"}] ${section.id}: ${section.detail}`);
    }
    return lines;
}
/**
 * Explicit opt-in only: "y"/"yes" (any case, surrounding whitespace allowed)
 * confirms the single sample query; every other answer declines, including
 * the empty default. `--yes` never flows through here.
 */
/**
 * Explicit opt-in only with an optional locale. English stays canonical
 * (`y`/`yes`); Spanish additionally accepts `s`, `si`, and `sí` through
 * the same setup boundary. The default stays "no" in every locale and
 * `--yes` never flows through here.
 */
function parseFirstQueryAnswer(answer, locale = "en") {
    const normalized = answer.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes")
        return true;
    if (locale === "es" && (normalized === "s" || normalized === "si" || normalized === "sí"))
        return true;
    return false;
}
function isoDateUTC(time) {
    return new Date(time).toISOString().slice(0, 10);
}
/** Short trailing window ending today (UTC), inclusive on both ends. */
function sampleWindow(today = Date.now()) {
    const endDate = isoDateUTC(today);
    const startDate = isoDateUTC(today - (exports.SAMPLE_QUERY_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}
function toFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
/**
 * Totals only: dates and counts, never query strings. Rows use the `date`
 * dimension, so keys hold calendar dates by construction.
 */
function summarizeSampleRows(rows) {
    let clicks = 0;
    let impressions = 0;
    for (const row of rows) {
        clicks += toFiniteNumber(row.clicks);
        impressions += toFiniteNumber(row.impressions);
    }
    return { rowCount: rows.length, clicks, impressions };
}
/**
 * Map a query failure to a stable safe classification. Raw exception text
 * (paths, tokens, upstreams) never reaches the output: only the fixed code
 * and a troubleshooting sentence without interpolated error content.
 */
function classifySampleFailure(err, window, locale = "en") {
    const message = err instanceof Error ? err.message : String(err);
    const range = { start: window.startDate, end: window.endDate };
    if (/403|forbidden|insufficient[_\s]?permission|permission[_\s]?denied|access[_\s]?denied/i.test(message)) {
        return {
            status: "denied",
            code: "permission_denied",
            detail: (0, i18n_js_1.translateSetup)(locale, "sampleDenied", range),
        };
    }
    if (/timeout|timed\s*out|ETIMEDOUT|ECONNABORTED|EAI_AGAIN/i.test(message)) {
        return {
            status: "error",
            code: "timeout",
            detail: (0, i18n_js_1.translateSetup)(locale, "sampleTimeout", range),
        };
    }
    return {
        status: "error",
        code: "query_error",
        detail: (0, i18n_js_1.translateSetup)(locale, "sampleQueryError", range),
    };
}
/**
 * Run the one bounded sample query through an injected query function and
 * report honestly: success with totals, empty data, denied permission, or
 * transport failure. Never throws and never returns row contents.
 */
async function runSampleQuery(siteUrl, window, queryFn, locale = "en") {
    let result;
    try {
        result = await queryFn(siteUrl, window);
    }
    catch (err) {
        return classifySampleFailure(err, window, locale);
    }
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (rows.length === 0) {
        return {
            status: "no_data",
            code: "no_data",
            detail: (0, i18n_js_1.translateSetup)(locale, "sampleNoData", { start: window.startDate, end: window.endDate }),
            summary: { rowCount: 0, clicks: 0, impressions: 0 },
        };
    }
    const summary = summarizeSampleRows(rows);
    return {
        status: "ok",
        code: "ok",
        detail: (0, i18n_js_1.translateSetup)(locale, "sampleOk", {
            start: window.startDate,
            end: window.endDate,
            count: summary.rowCount,
            clicks: summary.clicks,
            impressions: summary.impressions,
        }),
        summary,
    };
}
