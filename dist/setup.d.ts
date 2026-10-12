import { type PromptAdapter } from "./setup/flow.js";
import { ScopeTier } from "./oauth.js";
import { type SetupAuth } from "./setup/auth.js";
import { type SiteEntrySummary, type TargetOutcome } from "./setup/finish.js";
import type { SpawnRunner } from "./client-config.js";
import { type SetupLocale } from "./setup/i18n.js";
import { type FileTarget } from "./client-config.js";
export declare function sanitizeSetupFailure(err: unknown, locale?: SetupLocale): string;
/**
 * Parse the single live sites.list response through the shared shape gate
 * (same validator doctor/fetchSitesList uses: no second HTTP request).
 * Any malformed 2xx member or wrong-shaped response throws the stable
 * shape error, so setup fails nonzero before client configuration and
 * before an explicit --site can bypass it. Valid responses keep every
 * exact identifier byte-for-byte, including commas inside URL-prefix
 * properties.
 */
export declare function parseSetupSitesList(data: unknown): {
    fetched: string[];
    siteEntries: SiteEntrySummary[];
};
export interface RunSetupDeps {
    /** Seam for flow tests: replaces the single live sites.list HTTP call. */
    listSitesRaw?: () => Promise<unknown>;
    /** Seam for write-toggle tests: overrides the home dir for detection. */
    homeDir?: string;
    /** Seam for skill tests: replaces the pinned Skills CLI spawn. */
    skillRunner?: SpawnRunner;
    /** Seam for skill tests: overrides the packaged skills directory source. */
    skillsDir?: string;
    /** Seam for path-resolution tests: overrides file-config path lookup. */
    resolveFileConfigPath?: (target: FileTarget) => string | null;
}
export declare function buildEnv(opts: {
    access?: ScopeTier;
    scopes: ScopeTier;
    site?: string;
    sites?: string[];
    allSites?: boolean;
    secretsPath: string | null;
    keyFile: string | null;
    mode: SetupAuth;
    write: boolean;
}): Record<string, string>;
export interface ApplyTargetsDeps {
    /** Seam for unavailable-path tests. Defaults to the real resolver. */
    resolveFileConfigPath?: (target: FileTarget) => string | null;
    /** Seam for CLI-invocation tests. Defaults to direct spawn. */
    runner?: SpawnRunner;
}
/**
 * Apply one setup entry to every requested target and report a structured
 * per-target outcome: applied (written/invoked), printed (manual fallback
 * or print-only target, nothing installed), previewed (dry-run, nothing
 * configured), skipped (declined or failed file write, nothing changed),
 * or failed (failed CLI invocation with a printed manual fallback).
 * Requested targets are never reported as configured unless applied.
 */
export declare function applyTargets(targets: string[], env: Record<string, string>, prompter: PromptAdapter, opts: {
    force: boolean;
    yes: boolean;
    dryRun: boolean;
    locale?: SetupLocale;
    verbose?: boolean;
}, deps?: ApplyTargetsDeps): Promise<{
    ok: boolean;
    outcomes: TargetOutcome[];
}>;
export declare function runSetup(argv: string[], deps?: RunSetupDeps): Promise<number>;
export declare const WRITE_TOGGLE_USAGE: string;
export declare const ACCESS_USAGE: string;
/** Instance auth tier relevant to full access. Only "shared" refuses writes. */
export type WriteTier = "shared" | "custom" | "service-account";
/**
 * Classify the installed instance by its effective auth signals: the gsc
 * entry env first, process env as fallback for keys the entry omits.
 * Mirrors getAuthMode's default (a missing mode means service_account)
 * and the setup/auth.ts shared gate: oauth without a custom client (a
 * secrets file, or a client id plus secret pair) is Quick Connect
 * (shared) and can never use full access.
 */
export declare function classifyWriteTier(entryEnv: Record<string, unknown>): WriteTier;
/** Static refusal for shared installs; mirrors the setup/auth.ts wording. */
export declare const SHARED_WRITE_REFUSAL: string;
/**
 * Resolve write-toggle targets: explicit --client flags reuse the setup
 * parsing/validation contract (parseClientFlags + validateClientTargets,
 * so both/comma/multiples and print-exclusivity behave identically).
 * Without flags, default to the detected file config (desktop, cursor,
 * opencode, pi order); fail closed when none exists. CLI-managed targets
 * always need --client.
 */
export declare function resolveWriteTargets(rawClients: string[], opts?: {
    homeDir?: string;
}): string[];
export interface WriteCommandDeps {
    /** Temp-dir seam for tests. Defaults to the real home directory. */
    homeDir?: string;
    /** Confirm seam for tests. Defaults to a terminal prompt. */
    confirm?: (question: string) => Promise<string>;
    /** Log seam for tests. Defaults to console.log. */
    log?: (message: string) => void;
}
export declare function runEnableWriteCommand(argv: string[], deps?: WriteCommandDeps): Promise<number>;
export declare function runDisableWriteCommand(argv: string[], deps?: WriteCommandDeps): Promise<number>;
export declare function runAccessCommand(argv: string[], deps?: WriteCommandDeps): Promise<number>;
