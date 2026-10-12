/**
 * Safe agent-skill installation for the guided setup flow (T02).
 *
 * The official `skills@1.7.0` package exposes a CLI binary and no public
 * package exports/API, so setup integrates through the documented local-path
 * source and global agent targeting as the integration boundary:
 *
 *   bunx --bun skills@1.7.0 add <package skills dir> --global \
 *     --skill google-search-console-mcp [--agent X]* --yes (Bun default;
 *   Node uses npx --yes instead of bunx --bun, trailing --yes kept both)
 *
 * Safety contract (mirrors the MCP client-config machinery):
 * - Explicit opt-in only. The caller decides confirmation (a `--install-skill`
 *   flag or a separate interactive prompt); `--yes` alone never flows here.
 * - Dry-run only previews the exact argv and never invokes anything.
 * - Invocation is one direct spawn by argv, never through a shell.
 * - Only compatible setup targets claim skill support and map to a
 *   `--agent` value: `code` -> `claude-code`, `cursor` -> `cursor`,
 *   `codex` -> `codex`. Desktop, generic, and print targets are ignored.
 * - Outcomes are structured (installed/previewed/failed/unsupported) so the
 *   finish stage reports truthfully. A skill failure never touches the MCP
 *   client config; the caller exits nonzero without rolling anything back.
 * - A live install verifies the resolved skill source contains SKILL.md
 *   before spawning anything; a missing bundle fails without invocation.
 *
 * Pure except for the injected runner: tests substitute the spawn seam and
 * the skills-dir source, so no test invokes the network or writes anywhere.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { currentRuntime, formatPreviewCommand, setupCommandFor, type SetupRuntime, type SpawnRunner } from "../client-config.js";
import { translateSetup, type SetupLocale, type SetupMessageKey } from "./i18n.js";

/** Canonical skill directory name bundled in the npm package. */
export const SKILL_NAME = "google-search-console-mcp";

/** Pinned official Skills CLI. Never resolved as latest: reproducibility. */
export const SKILLS_CLI_SPEC = "skills@1.7.0";

/**
 * Node launcher for the pinned CLI. Bun uses `bunx --bun` via
 * setupCommandFor; this constant preserves the explicit Node secondary.
 * Invoked directly by argv, never a shell.
 */
export const SKILL_INSTALL_PROGRAM = "npx";
/**
 * Setup targets that claim global skill support, mapped to the Skills CLI
 * `--agent` value. Desktop, generic, and print never appear here.
 */
export const SKILL_AGENT_MAP: Readonly<Record<string, string>> = {
  code: "claude-code",
  cursor: "cursor",
  codex: "codex",
};

/**
 * Map resolved setup targets to `--agent` values in first-appearance order,
 * deduplicated. Incompatible targets (desktop, generic, print) contribute
 * nothing, so a print-only run installs no skill and fails nothing.
 */
export function skillAgentsForTargets(targets: readonly string[]): string[] {
  const seen = new Set<string>();
  const agents: string[] = [];
  for (const target of targets) {
    const agent = SKILL_AGENT_MAP[target];
    if (agent === undefined || seen.has(agent)) continue;
    seen.add(agent);
    agents.push(agent);
  }
  return agents;
}

/** Skills directory for an explicit package root (injection seam for tests). */
export function resolvePackageSkillsDir(packageRoot: string): string {
  return path.join(packageRoot, "skills", SKILL_NAME);
}

/** Expected bundled entry point inside a resolved skill source directory. */
export function resolveSkillBundleFile(skillsDir: string): string {
  return path.join(skillsDir, "SKILL.md");
}

/** True when the resolved skill source contains the bundled SKILL.md file. */
export function hasSkillBundle(skillsDir: string): boolean {
  try {
    return fs.statSync(resolveSkillBundleFile(skillsDir)).isFile();
  } catch {
    return false;
  }
}

/**
 * Packaged skills directory next to this module. `src/setup/` and
 * `dist/setup/` share the same depth, so two levels up reaches the package
 * root in both the checkout and the packed install.
 */
export function defaultPackageSkillsDir(): string {
  return path.resolve(__dirname, "..", "..", "skills", SKILL_NAME);
}

/**
 * The exact pinned argv for the skill installation. Bun uses `bunx --bun`
 * (the flag must precede the package); Node uses npx's own `--yes`.
 * The trailing `--yes` is always the Skills CLI confirmation and is
 * preserved on both runtimes. No shell quoting is applied here: the caller
 * spawns program+argv directly. Defaults to the invoking runtime so an
 * explicit Node invocation keeps Node entries.
 */
export function buildSkillInstallArgs(skillsDir: string, agents: readonly string[], runtime: SetupRuntime = currentRuntime()): string[] {
  const args: string[] = [
    runtime === "bun" ? "--bun" : "--yes",
    SKILLS_CLI_SPEC,
    "add",
    skillsDir,
    "--global",
    "--skill",
    SKILL_NAME,
  ];
  for (const agent of agents) {
    args.push("--agent", agent);
  }
  args.push("--yes");
  return args;
}

/** Human-readable preview of the exact argv (quoting is display-only). */
export function formatSkillPreviewCommand(args: string[], runtime: SetupRuntime = currentRuntime()): string {
  return formatPreviewCommand(setupCommandFor(runtime), args);
}

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
export function parseInstallSkillAnswer(answer: string, locale: SetupLocale = "en"): boolean {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") return true;
  if (locale === "es" && (normalized === "s" || normalized === "si" || normalized === "sí")) return true;
  return false;
}

/**
 * Product display names for the Skills CLI `--agent` values. Product names
 * stay identical in both locales, so one static table covers them.
 */
const SKILL_AGENT_LABELS: Record<string, SetupMessageKey> = {
  "claude-code": "skillAgentClaudeCode",
  cursor: "skillAgentCursor",
  codex: "skillAgentCodex",
};

/**
 * Product display name for one Skills CLI `--agent` value. Unknown values
 * pass through exact.
 */
export function skillAgentDisplayName(agent: string, locale: SetupLocale = "en"): string {
  const key = SKILL_AGENT_LABELS[agent];
  return key === undefined ? agent : translateSetup(locale, key);
}

/** Static, input-free rejection for the interactive skill list. Never echoes input. */
export const INVALID_SKILL_SELECTION_ERROR =
  "Invalid skill selection: use numbers like 1,2, \"all\", or 0 to skip.";

/**
 * Parse one interactive skill-list answer against the derived compatible
 * agents. Display numbers are fixed: `1` (or `all`, any case) selects every
 * derived agent, `2..N+1` select individual agents in order, and `0` (or the
 * empty default) skips. A `0` token anywhere skips; a `1` token anywhere
 * selects all. Anything else throws a static, input-free error so rejected
 * text is never echoed. Least privilege: the empty default skips.
 */
export function parseSkillSelectionAnswer(answer: string, availableAgents: readonly string[]): string[] {
  if (availableAgents.length === 0) throw new Error(INVALID_SKILL_SELECTION_ERROR);
  const trimmed = answer.trim();
  if (trimmed === "" || trimmed === "0") return [];
  if (trimmed.toLowerCase() === "all" || trimmed === "1") return [...availableAgents];
  const tokens = trimmed.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
  // No input echo: a rejected token may hold sensitive text.
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) throw new Error(INVALID_SKILL_SELECTION_ERROR);
    const n = Number(token);
    if (n === 0) return [];
    if (n === 1) return [...availableAgents];
    const agent = availableAgents[n - 2];
    if (agent === undefined) throw new Error(INVALID_SKILL_SELECTION_ERROR);
    if (!seen.has(agent)) {
      seen.add(agent);
      picked.push(agent);
    }
  }
  if (picked.length === 0) throw new Error(INVALID_SKILL_SELECTION_ERROR);
  return picked;
}

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

const defaultSkillRunner: SpawnRunner = (program, args, opts) => {
  const result = nodeSpawnSync(program, args, { stdio: opts.stdio });
  return { status: result.status, error: result.error };
};

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
export async function installSkill(opts: InstallSkillOpts): Promise<SkillInstallOutcome> {
  const agents = [...opts.agents];
  const runtime = opts.runtime ?? currentRuntime();
  const program = setupCommandFor(runtime);
  const args = buildSkillInstallArgs(opts.skillsDir, agents, runtime);
  const command = formatSkillPreviewCommand(args, runtime);
  const locale = opts.locale ?? "en";

  if (opts.dryRun) {
    opts.log(`\n${translateSetup(locale, "skillDryRunPreview", { command })}`);
    opts.log(translateSetup(locale, "skillDryRunNote"));
    return {
      status: "previewed",
      detail: translateSetup(locale, "skillDetailPreview", { command }),
      command,
      agents,
    };
  }

  if (agents.length === 0) {
    opts.log(translateSetup(locale, "skillUnsupported"));
    return {
      status: "unsupported",
      detail: translateSetup(locale, "skillDetailUnsupported"),
      command,
      agents,
    };
  }

  if (!hasSkillBundle(opts.skillsDir)) {
    const missing = resolveSkillBundleFile(opts.skillsDir);
    opts.log(
      `\n${translateSetup(locale, "skillMissing", { missing, skill: SKILL_NAME, command })}`
    );
    return {
      status: "failed",
      detail: translateSetup(locale, "skillDetailMissing"),
      command,
      agents,
    };
  }

  opts.log(translateSetup(locale, "skillInstalling", { command }));
  const runner = opts.runner ?? defaultSkillRunner;
  let result: { status: number | null; error?: Error };
  try {
    result = runner(program, args, { stdio: "inherit" });
  } catch {
    opts.log(
      `\n${translateSetup(locale, "skillLaunchError", { program, command })}`
    );
    return {
      status: "failed",
      detail: translateSetup(locale, "skillDetailLaunch"),
      command,
      agents,
    };
  }
  const launchError = result.error;
  let launchCode: string | undefined;
  if (launchError !== undefined && launchError !== null && typeof launchError === "object" && "code" in launchError) {
    const rawCode = launchError.code;
    if (typeof rawCode === "string") launchCode = rawCode;
  }
  if (launchError && launchCode === "ENOENT") {
    opts.log(
      `\n${translateSetup(locale, "skillCliMissing", { program, command })}`
    );
    return {
      status: "failed",
      detail: translateSetup(locale, "skillDetailCliMissing"),
      command,
      agents,
    };
  }
  if (result.status !== 0) {
    opts.log(
      `\n${translateSetup(locale, "skillExitNonzero", { command })}`
    );
    return {
      status: "failed",
      detail: translateSetup(locale, "skillDetailExit"),
      command,
      agents,
    };
  }
  opts.log(`\n${translateSetup(locale, "skillInstalled", { skill: SKILL_NAME })}`);
  return {
    status: "installed",
    detail:
      agents.length > 0
        ? translateSetup(locale, "skillDetailInstalled", { spec: SKILLS_CLI_SPEC, agents: agents.join(", ") })
        : translateSetup(locale, "skillDetailInstalledNoAgents", { spec: SKILLS_CLI_SPEC }),
    command,
    agents,
  };
}
