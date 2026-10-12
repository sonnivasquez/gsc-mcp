import { type SetupRuntime, type SpawnRunner } from "../client-config.js";
import { type SetupLocale } from "./i18n.js";
/** Canonical skill directory name bundled in the npm package. */
export declare const SKILL_NAME = "google-search-console-mcp";
/** Pinned official Skills CLI. Never resolved as latest: reproducibility. */
export declare const SKILLS_CLI_SPEC = "skills@1.7.0";
/**
 * Node launcher for the pinned CLI. Bun uses `bunx --bun` via
 * setupCommandFor; this constant preserves the explicit Node secondary.
 * Invoked directly by argv, never a shell.
 */
export declare const SKILL_INSTALL_PROGRAM = "npx";
/**
 * Setup targets that claim global skill support, mapped to the Skills CLI
 * `--agent` value. Desktop, generic, and print never appear here.
 */
export declare const SKILL_AGENT_MAP: Readonly<Record<string, string>>;
/**
 * Map resolved setup targets to `--agent` values in first-appearance order,
 * deduplicated. Incompatible targets (desktop, generic, print) contribute
 * nothing, so a print-only run installs no skill and fails nothing.
 */
export declare function skillAgentsForTargets(targets: readonly string[]): string[];
/** Skills directory for an explicit package root (injection seam for tests). */
export declare function resolvePackageSkillsDir(packageRoot: string): string;
/** Expected bundled entry point inside a resolved skill source directory. */
export declare function resolveSkillBundleFile(skillsDir: string): string;
/** True when the resolved skill source contains the bundled SKILL.md file. */
export declare function hasSkillBundle(skillsDir: string): boolean;
/**
 * Packaged skills directory next to this module. `src/setup/` and
 * `dist/setup/` share the same depth, so two levels up reaches the package
 * root in both the checkout and the packed install.
 */
export declare function defaultPackageSkillsDir(): string;
/**
 * The exact pinned argv for the skill installation. Bun uses `bunx --bun`
 * (the flag must precede the package); Node uses npx's own `--yes`.
 * The trailing `--yes` is always the Skills CLI confirmation and is
 * preserved on both runtimes. No shell quoting is applied here: the caller
 * spawns program+argv directly. Defaults to the invoking runtime so an
 * explicit Node invocation keeps Node entries.
 */
export declare function buildSkillInstallArgs(skillsDir: string, agents: readonly string[], runtime?: SetupRuntime): string[];
/** Human-readable preview of the exact argv (quoting is display-only). */
export declare function formatSkillPreviewCommand(args: string[], runtime?: SetupRuntime): string;
/**
 * Explicit opt-in only: "y"/"yes" (any case, surrounding whitespace allowed)
 * confirms the skill installation; every other answer declines, including
 * the empty default. `--yes` never flows through here.
 */
/**
 * Explicit opt-in only with an optional locale. English stays canonical
 * (`y`/`yes`); Spanish additionally accepts `s`, `si`, and `sí` through
 * the same setup boundary. The default stays "no" in every locale and
 * `--yes` never flows through here.
 */
export declare function parseInstallSkillAnswer(answer: string, locale?: SetupLocale): boolean;
/**
 * Product display name for one Skills CLI `--agent` value. Unknown values
 * pass through exact.
 */
export declare function skillAgentDisplayName(agent: string, locale?: SetupLocale): string;
/** Static, input-free rejection for the interactive skill list. Never echoes input. */
export declare const INVALID_SKILL_SELECTION_ERROR = "Invalid skill selection: use numbers like 1,2, \"all\", or 0 to skip.";
/**
 * Parse one interactive skill-list answer against the derived compatible
 * agents. Display numbers are fixed: `1` (or `all`, any case) selects every
 * derived agent, `2..N+1` select individual agents in order, and `0` (or the
 * empty default) skips. A `0` token anywhere skips; a `1` token anywhere
 * selects all. Anything else throws a static, input-free error so rejected
 * text is never echoed. Least privilege: the empty default skips.
 */
export declare function parseSkillSelectionAnswer(answer: string, availableAgents: readonly string[]): string[];
export type SkillInstallStatus = "installed" | "previewed" | "failed" | "unsupported";
export interface SkillInstallOutcome {
    status: SkillInstallStatus;
    /** Stable safe detail (never raw spawn text, paths excepted as inputs). */
    detail: string;
    /** Exact preview of the argv that ran or would run. */
    command: string;
    /** `--agent` values carried by the command (possibly empty). */
    agents: string[];
}
export interface InstallSkillOpts {
    skillsDir: string;
    agents: readonly string[];
    dryRun: boolean;
    log: (message: string) => void;
    /** Fault-injection seam. Defaults to a direct spawn (never a shell). */
    runner?: SpawnRunner;
    /**
     * Optional human-copy locale. Defaults to English so existing callers
     * stay byte-compatible; commands, paths, skill names, agent names, and
     * structured status codes stay exact in every locale.
     */
    locale?: SetupLocale;
    /**
     * Explicit launcher runtime. Defaults to the invoking runtime so Bun
     * setups emit bunx and Node setups keep npx without extra flags.
     */
    runtime?: SetupRuntime;
}
/**
 * Install the bundled skill through the pinned Skills CLI.
 *
 * The caller owns confirmation: this function assumes an explicit opt-in
 * already happened. Dry-run previews the exact command and returns
 * `previewed` without invoking anything. An empty agent list returns
 * `unsupported` without invoking anything. A live install with compatible
 * agents first verifies the resolved skill source contains `SKILL.md`;
 * a missing bundle returns `failed` without invoking the runner.
 * Otherwise the pinned argv is
 * spawned exactly once by program+argv (no shell); any launch error,
 * missing binary, or nonzero exit returns `failed` with a stable code.
 * Nothing here reads or writes MCP client config.
 */
export declare function installSkill(opts: InstallSkillOpts): Promise<SkillInstallOutcome>;
