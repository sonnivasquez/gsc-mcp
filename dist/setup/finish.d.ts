import type { SkillInstallStatus } from "./skill-install.js";
import { type SetupLocale } from "./i18n.js";
/** The canonical catalog size. A mismatched reported count fails honestly. */
export declare const EXPECTED_TOOL_COUNT: number;
/** Short window for the opt-in sample query (inclusive dates). */
export declare const SAMPLE_QUERY_WINDOW_DAYS = 7;
/** Date breakdown only: never exposes query strings or page URLs. */
export declare const SAMPLE_QUERY_DIMENSIONS: readonly ["date"];
/** Hard cap on returned rows for the sample query. */
export declare const SAMPLE_QUERY_ROW_LIMIT = 5;
export interface SiteEntrySummary {
    siteUrl: string;
    permissionLevel?: string;
}
export type TargetOutcomeStatus = "applied" | "printed" | "previewed" | "skipped" | "failed";
export interface TargetOutcome {
    target: string;
    status: TargetOutcomeStatus;
    note?: string;
}
/** Optional skill-installation outcome for the finish stage. */
export interface SkillFinishOutcome {
    status: SkillInstallStatus;
    detail: string;
}
export interface FinishStageInput {
    authMode: string;
    scope: string;
    writeEnabled: boolean;
    accessMode?: "readonly" | "full";
    allowlist: string[];
    /** Per-target outcomes: requested targets are never reported as configured unless applied. */
    clientOutcomes: TargetOutcome[];
    /** Already-acquired sites.list entries, reused verbatim (no second call). */
    siteEntries: SiteEntrySummary[];
    dryRun: boolean;
    /**
     * Optional skill outcome. Absent when the skill install was never
     * attempted (declined or skipped without --install-skill): no skill
     * section renders and existing 7-section reports stay unchanged.
     */
    skill?: SkillFinishOutcome | null;
    /**
     * Optional report locale. Defaults to English so existing callers stay
     * byte-compatible; human-facing section details localize, while section
     * IDs, `[ok]`/`[!!]` markers, and every structured value stay exact.
     */
    locale?: SetupLocale;
}
export interface FinishSection {
    id: string;
    ok: boolean;
    detail: string;
}
export interface FinishReport {
    ok: boolean;
    dryRun: boolean;
    sections: FinishSection[];
    /** Locale the human-facing details were rendered in (default English). */
    locale?: SetupLocale;
}
/** Runtime line, mirroring the offline doctor format. */
export declare function runtimeSummary(): string;
/**
 * Write-ops line, mirroring the offline doctor wording. The optional
 * locale selects the human-facing rendering only: English stays
 * byte-identical to the historical copy and env/config keys stay exact in
 * every locale.
 */
export declare function describeWriteState(scope: string, writeEnabled: boolean, accessMode?: "readonly" | "full", locale?: SetupLocale): string;
/**
 * Current catalog size against the released expectation. The optional
 * locale selects the human-facing rendering only: counts and the `gsc_*`
 * prefix stay exact in every locale.
 */
export declare function toolCatalogSummary(count?: number, locale?: SetupLocale): FinishSection;
/**
 * Optional skill-installation section. Installed, previewed, and
 * unsupported outcomes are informational (ok); only a failed install
 * fails the report, truthfully, without rewriting the client section.
 */
export declare function skillOutcomeSummary(skill: SkillFinishOutcome): FinishSection;
/**
 * Build the finish report from the setup run's known values. Pure: the API
 * section reuses the supplied `sites.list` entries, the tools section reads
 * the compiled catalog, and nothing here touches the network.
 */
export declare function buildFinishReport(input: FinishStageInput): FinishReport;
/**
 * Client-target section from structured per-target outcomes. Requested
 * targets are reported exactly as applied, printed fallback, previewed,
 * skipped, or failed: a dry-run preview never claims anything was
 * configured, and a printed manual fallback never claims an install.
 */
export declare function summarizeTargetOutcomes(outcomes: TargetOutcome[], dryRun: boolean, locale?: SetupLocale): FinishSection;
/**
 * Human-readable finish lines for the setup terminal output. When the
 * overall configuration failed, the header says so instead of claiming
 * success; the failed/skipped sections carry the truthful detail.
 */
export declare function formatFinishReport(report: FinishReport, opts?: {
    configFailed?: boolean;
    locale?: SetupLocale;
}): string[];
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
export declare function parseFirstQueryAnswer(answer: string, locale?: SetupLocale): boolean;
export interface SampleWindow {
    startDate: string;
    endDate: string;
}
/** Short trailing window ending today (UTC), inclusive on both ends. */
export declare function sampleWindow(today?: number): SampleWindow;
export interface SampleRow {
    keys: string[];
    clicks: number;
    impressions: number;
}
export interface SampleSummary {
    rowCount: number;
    clicks: number;
    impressions: number;
}
/**
 * Totals only: dates and counts, never query strings. Rows use the `date`
 * dimension, so keys hold calendar dates by construction.
 */
export declare function summarizeSampleRows(rows: SampleRow[]): SampleSummary;
export type SampleQueryStatus = "ok" | "no_data" | "denied" | "error" | "skipped";
export interface SampleQueryOutcome {
    status: SampleQueryStatus;
    /** Stable safe classification (never raw exception text). */
    code: string;
    detail: string;
    summary?: SampleSummary;
}
export type SampleQueryFn = (siteUrl: string, window: SampleWindow) => Promise<{
    rows: SampleRow[];
}>;
/**
 * Run the one bounded sample query through an injected query function and
 * report honestly: success with totals, empty data, denied permission, or
 * transport failure. Never throws and never returns row contents.
 */
export declare function runSampleQuery(siteUrl: string, window: SampleWindow, queryFn: SampleQueryFn, locale?: SetupLocale): Promise<SampleQueryOutcome>;
