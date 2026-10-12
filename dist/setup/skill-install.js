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
exports.INVALID_SKILL_SELECTION_ERROR = exports.SKILL_AGENT_MAP = exports.SKILL_INSTALL_PROGRAM = exports.SKILLS_CLI_SPEC = exports.SKILL_NAME = void 0;
exports.skillAgentsForTargets = skillAgentsForTargets;
exports.resolvePackageSkillsDir = resolvePackageSkillsDir;
exports.resolveSkillBundleFile = resolveSkillBundleFile;
exports.hasSkillBundle = hasSkillBundle;
exports.defaultPackageSkillsDir = defaultPackageSkillsDir;
exports.buildSkillInstallArgs = buildSkillInstallArgs;
exports.formatSkillPreviewCommand = formatSkillPreviewCommand;
exports.parseInstallSkillAnswer = parseInstallSkillAnswer;
exports.skillAgentDisplayName = skillAgentDisplayName;
exports.parseSkillSelectionAnswer = parseSkillSelectionAnswer;
exports.installSkill = installSkill;
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
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const client_config_js_1 = require("../client-config.js");
const i18n_js_1 = require("./i18n.js");
/** Canonical skill directory name bundled in the npm package. */
exports.SKILL_NAME = "google-search-console-mcp";
/** Pinned official Skills CLI. Never resolved as latest: reproducibility. */
exports.SKILLS_CLI_SPEC = "skills@1.7.0";
/**
 * Node launcher for the pinned CLI. Bun uses `bunx --bun` via
 * setupCommandFor; this constant preserves the explicit Node secondary.
 * Invoked directly by argv, never a shell.
 */
exports.SKILL_INSTALL_PROGRAM = "npx";
/**
 * Setup targets that claim global skill support, mapped to the Skills CLI
 * `--agent` value. Desktop, generic, and print never appear here.
 */
exports.SKILL_AGENT_MAP = {
    code: "claude-code",
    cursor: "cursor",
    codex: "codex",
};
/**
 * Map resolved setup targets to `--agent` values in first-appearance order,
 * deduplicated. Incompatible targets (desktop, generic, print) contribute
 * nothing, so a print-only run installs no skill and fails nothing.
 */
function skillAgentsForTargets(targets) {
    const seen = new Set();
    const agents = [];
    for (const target of targets) {
        const agent = exports.SKILL_AGENT_MAP[target];
        if (agent === undefined || seen.has(agent))
            continue;
        seen.add(agent);
        agents.push(agent);
    }
    return agents;
}
/** Skills directory for an explicit package root (injection seam for tests). */
function resolvePackageSkillsDir(packageRoot) {
    return path.join(packageRoot, "skills", exports.SKILL_NAME);
}
/** Expected bundled entry point inside a resolved skill source directory. */
function resolveSkillBundleFile(skillsDir) {
    return path.join(skillsDir, "SKILL.md");
}
/** True when the resolved skill source contains the bundled SKILL.md file. */
function hasSkillBundle(skillsDir) {
    try {
        return fs.statSync(resolveSkillBundleFile(skillsDir)).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Packaged skills directory next to this module. `src/setup/` and
 * `dist/setup/` share the same depth, so two levels up reaches the package
 * root in both the checkout and the packed install.
 */
function defaultPackageSkillsDir() {
    return path.resolve(__dirname, "..", "..", "skills", exports.SKILL_NAME);
}
/**
 * The exact pinned argv for the skill installation. Bun uses `bunx --bun`
 * (the flag must precede the package); Node uses npx's own `--yes`.
 * The trailing `--yes` is always the Skills CLI confirmation and is
 * preserved on both runtimes. No shell quoting is applied here: the caller
 * spawns program+argv directly. Defaults to the invoking runtime so an
 * explicit Node invocation keeps Node entries.
 */
function buildSkillInstallArgs(skillsDir, agents, runtime = (0, client_config_js_1.currentRuntime)()) {
    const args = [
        runtime === "bun" ? "--bun" : "--yes",
        exports.SKILLS_CLI_SPEC,
        "add",
        skillsDir,
        "--global",
        "--skill",
        exports.SKILL_NAME,
    ];
    for (const agent of agents) {
        args.push("--agent", agent);
    }
    args.push("--yes");
    return args;
}
/** Human-readable preview of the exact argv (quoting is display-only). */
function formatSkillPreviewCommand(args, runtime = (0, client_config_js_1.currentRuntime)()) {
    return (0, client_config_js_1.formatPreviewCommand)((0, client_config_js_1.setupCommandFor)(runtime), args);
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
function parseInstallSkillAnswer(answer, locale = "en") {
    const normalized = answer.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes")
        return true;
    if (locale === "es" && (normalized === "s" || normalized === "si" || normalized === "sí"))
        return true;
    return false;
}
/**
 * Product display names for the Skills CLI `--agent` values. Product names
 * stay identical in both locales, so one static table covers them.
 */
const SKILL_AGENT_LABELS = {
    "claude-code": "skillAgentClaudeCode",
    cursor: "skillAgentCursor",
    codex: "skillAgentCodex",
};
/**
 * Product display name for one Skills CLI `--agent` value. Unknown values
 * pass through exact.
 */
function skillAgentDisplayName(agent, locale = "en") {
    const key = SKILL_AGENT_LABELS[agent];
    return key === undefined ? agent : (0, i18n_js_1.translateSetup)(locale, key);
}
/** Static, input-free rejection for the interactive skill list. Never echoes input. */
exports.INVALID_SKILL_SELECTION_ERROR = "Invalid skill selection: use numbers like 1,2, \"all\", or 0 to skip.";
/**
 * Parse one interactive skill-list answer against the derived compatible
 * agents. Display numbers are fixed: `1` (or `all`, any case) selects every
 * derived agent, `2..N+1` select individual agents in order, and `0` (or the
 * empty default) skips. A `0` token anywhere skips; a `1` token anywhere
 * selects all. Anything else throws a static, input-free error so rejected
 * text is never echoed. Least privilege: the empty default skips.
 */
function parseSkillSelectionAnswer(answer, availableAgents) {
    if (availableAgents.length === 0)
        throw new Error(exports.INVALID_SKILL_SELECTION_ERROR);
    const trimmed = answer.trim();
    if (trimmed === "" || trimmed === "0")
        return [];
    if (trimmed.toLowerCase() === "all" || trimmed === "1")
        return [...availableAgents];
    const tokens = trimmed.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
    // No input echo: a rejected token may hold sensitive text.
    const picked = [];
    const seen = new Set();
    for (const token of tokens) {
        if (!/^\d+$/.test(token))
            throw new Error(exports.INVALID_SKILL_SELECTION_ERROR);
        const n = Number(token);
        if (n === 0)
            return [];
        if (n === 1)
            return [...availableAgents];
        const agent = availableAgents[n - 2];
        if (agent === undefined)
            throw new Error(exports.INVALID_SKILL_SELECTION_ERROR);
        if (!seen.has(agent)) {
            seen.add(agent);
            picked.push(agent);
        }
    }
    if (picked.length === 0)
        throw new Error(exports.INVALID_SKILL_SELECTION_ERROR);
    return picked;
}
const defaultSkillRunner = (program, args, opts) => {
    const result = (0, node_child_process_1.spawnSync)(program, args, { stdio: opts.stdio });
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
async function installSkill(opts) {
    const agents = [...opts.agents];
    const runtime = opts.runtime ?? (0, client_config_js_1.currentRuntime)();
    const program = (0, client_config_js_1.setupCommandFor)(runtime);
    const args = buildSkillInstallArgs(opts.skillsDir, agents, runtime);
    const command = formatSkillPreviewCommand(args, runtime);
    const locale = opts.locale ?? "en";
    if (opts.dryRun) {
        opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillDryRunPreview", { command })}`);
        opts.log((0, i18n_js_1.translateSetup)(locale, "skillDryRunNote"));
        return {
            status: "previewed",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailPreview", { command }),
            command,
            agents,
        };
    }
    if (agents.length === 0) {
        opts.log((0, i18n_js_1.translateSetup)(locale, "skillUnsupported"));
        return {
            status: "unsupported",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailUnsupported"),
            command,
            agents,
        };
    }
    if (!hasSkillBundle(opts.skillsDir)) {
        const missing = resolveSkillBundleFile(opts.skillsDir);
        opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillMissing", { missing, skill: exports.SKILL_NAME, command })}`);
        return {
            status: "failed",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailMissing"),
            command,
            agents,
        };
    }
    opts.log((0, i18n_js_1.translateSetup)(locale, "skillInstalling", { command }));
    const runner = opts.runner ?? defaultSkillRunner;
    let result;
    try {
        result = runner(program, args, { stdio: "inherit" });
    }
    catch {
        opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillLaunchError", { program, command })}`);
        return {
            status: "failed",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailLaunch"),
            command,
            agents,
        };
    }
    const launchError = result.error;
    let launchCode;
    if (launchError !== undefined && launchError !== null && typeof launchError === "object" && "code" in launchError) {
        const rawCode = launchError.code;
        if (typeof rawCode === "string")
            launchCode = rawCode;
    }
    if (launchError && launchCode === "ENOENT") {
        opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillCliMissing", { program, command })}`);
        return {
            status: "failed",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailCliMissing"),
            command,
            agents,
        };
    }
    if (result.status !== 0) {
        opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillExitNonzero", { command })}`);
        return {
            status: "failed",
            detail: (0, i18n_js_1.translateSetup)(locale, "skillDetailExit"),
            command,
            agents,
        };
    }
    opts.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillInstalled", { skill: exports.SKILL_NAME })}`);
    return {
        status: "installed",
        detail: agents.length > 0
            ? (0, i18n_js_1.translateSetup)(locale, "skillDetailInstalled", { spec: exports.SKILLS_CLI_SPEC, agents: agents.join(", ") })
            : (0, i18n_js_1.translateSetup)(locale, "skillDetailInstalledNoAgents", { spec: exports.SKILLS_CLI_SPEC }),
        command,
        agents,
    };
}
