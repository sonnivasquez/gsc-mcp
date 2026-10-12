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
exports.WRITE_ENV_KEY = exports.EN_CLIENT_CONFIG_TEXT = exports.REDACTED_VALUE = exports.MERGE_INVALID_MCP_ERROR = exports.MERGE_INVALID_SERVERS_ERROR = exports.MERGE_INVALID_ROOT_ERROR = exports.SETUP_SERVER_NAME = exports.PRINT_TARGETS = exports.CLI_TARGETS = exports.FILE_TARGETS = exports.CLIENT_KINDS = void 0;
exports.currentRuntime = currentRuntime;
exports.setupCommandFor = setupCommandFor;
exports.packageEntrypointPath = packageEntrypointPath;
exports.printClientConfig = printClientConfig;
exports.buildSetupEntry = buildSetupEntry;
exports.buildOpencodeEntry = buildOpencodeEntry;
exports.buildSetupPrintJson = buildSetupPrintJson;
exports.desktopConfigPath = desktopConfigPath;
exports.cursorConfigPath = cursorConfigPath;
exports.opencodeConfigPath = opencodeConfigPath;
exports.piConfigPath = piConfigPath;
exports.resolveFileConfigPath = resolveFileConfigPath;
exports.isFileTarget = isFileTarget;
exports.isCliTarget = isCliTarget;
exports.mergeGscEntry = mergeGscEntry;
exports.mergeOpencodeEntry = mergeOpencodeEntry;
exports.localizeMergeErrorMessage = localizeMergeErrorMessage;
exports.redactEntryForPreview = redactEntryForPreview;
exports.previewEntryChange = previewEntryChange;
exports.backupPathFor = backupPathFor;
exports.tempPathFor = tempPathFor;
exports.applyFileConfig = applyFileConfig;
exports.buildClaudeCodeArgs = buildClaudeCodeArgs;
exports.claudeCodeRemoveArgs = claudeCodeRemoveArgs;
exports.buildCodexArgs = buildCodexArgs;
exports.codexRemoveArgs = codexRemoveArgs;
exports.formatPreviewCommand = formatPreviewCommand;
exports.applyCliConfig = applyCliConfig;
exports.detectFileTarget = detectFileTarget;
exports.readGscEntry = readGscEntry;
exports.updateGscEnvForAccess = updateGscEnvForAccess;
exports.updateGscEnvForWrite = updateGscEnvForWrite;
exports.previewWriteEnvChange = previewWriteEnvChange;
exports.applyWriteFileConfig = applyWriteFileConfig;
// Centralized MCP-client configuration.
// Pure text generation plus safe file/CLI application helpers. No reads of
// secrets, no network, no Google calls — only local config paths and the
// exact argument vectors the user approves.
//
// Setup (`src/setup.ts`) must reuse these builders instead of maintaining
// parallel snippets so every destination shares one preview/merge contract.
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
exports.CLIENT_KINDS = ["desktop", "code", "cursor", "codex", "opencode", "pi", "generic"];
/**
 * File-based destinations. Desktop/cursor/pi share the `mcpServers`
 * merge contract; opencode uses its own global `mcp` key with a
 * `{type:"local", command:[...], environment:{...}, enabled:true}` shape.
 * All four reuse the same preview/backup/atomic-replace machinery.
 */
exports.FILE_TARGETS = ["desktop", "cursor", "opencode", "pi"];
/** CLI-managed destinations are invoked by exact argv, never through a shell. */
exports.CLI_TARGETS = ["code", "codex"];
/** Print-only destinations never touch the filesystem or spawn a process. */
exports.PRINT_TARGETS = ["generic", "print"];
/** Server key used by the guided setup flow. Narrow merges touch only this key. */
exports.SETUP_SERVER_NAME = "gsc";
/**
 * Host runtime detection (same contract as doctor/finish): Bun when the
 * Bun global or process.versions.bun exists, otherwise Node. Setup reuses
 * this so generated entries match the invoking runtime instead of always
 * emitting npx, and an explicit Node invocation keeps Node entries.
 */
function currentRuntime() {
    if (typeof Bun !== "undefined")
        return "bun";
    const holder = globalThis;
    if (holder !== null && typeof holder === "object" && "process" in holder) {
        const proc = holder.process;
        if (proc !== null && typeof proc === "object" && "versions" in proc) {
            const versions = proc.versions;
            if (versions !== null && typeof versions === "object" && "bun" in versions)
                return "bun";
        }
    }
    return "node";
}
/** Runner command used for separately installing the bundled agent skill. */
function setupCommandFor(runtime) {
    return runtime === "bun" ? "bunx" : "npx";
}
/** Absolute entry point inside this installed package (compiled under dist/). */
function packageEntrypointPath() {
    return path.resolve(__dirname, "index.js");
}
function serveArgs(profile) {
    return profile !== undefined && profile !== "" ? ["serve", "--profile", profile] : ["serve"];
}
function mcpServersJson(opts) {
    return JSON.stringify({
        mcpServers: {
            "gsc-local": {
                command: opts.command,
                args: [opts.entrypoint, ...serveArgs(opts.profile)],
                env: {
                    GSC_AUTH_MODE: "oauth",
                    GSC_ACCESS_MODE: "readonly",
                    GSC_SITE_URLS: "sc-domain:example.com",
                },
            },
        },
    }, null, 2);
}
function printClientConfig(client, opts) {
    switch (client) {
        case "desktop":
            return `# Claude Desktop: paste into claude_desktop_config.json (replace the example property)\n${mcpServersJson(opts)}`;
        case "cursor":
            return `# Cursor: Settings > MCP > New MCP Server with this JSON (replace the example property)\n${mcpServersJson(opts)}`;
        case "pi":
            return `# Pi (OhMyPi): paste into ~/.omp/agent/mcp.json (replace the example property)\n${mcpServersJson(opts)}`;
        case "opencode": {
            const entry = {
                type: "local",
                command: [opts.command, opts.entrypoint, ...serveArgs(opts.profile)],
                environment: {
                    GSC_AUTH_MODE: "oauth",
                    GSC_ACCESS_MODE: "readonly",
                    GSC_SITE_URLS: "sc-domain:example.com",
                },
                enabled: true,
            };
            return `# OpenCode: paste into ~/.config/opencode/opencode.json (replace the example property)\n${JSON.stringify({ mcp: { "gsc-local": entry } }, null, 2)}`;
        }
        case "generic":
            return mcpServersJson(opts);
        case "codex": {
            const env = ["--env GSC_AUTH_MODE=oauth", "--env GSC_ACCESS_MODE=readonly", "--env GSC_SITE_URLS=sc-domain:example.com"].join(" ");
            const serverCommand = formatPreviewCommand(opts.command, [opts.entrypoint, ...serveArgs(opts.profile)]);
            return `# Codex (replace the example property)\ncodex mcp add gsc-local ${env} -- ${serverCommand}`;
        }
        case "code": {
            const env = ["-e GSC_AUTH_MODE=oauth", "-e GSC_ACCESS_MODE=readonly", "-e GSC_SITE_URLS=sc-domain:example.com"].join(" ");
            const serverCommand = formatPreviewCommand(opts.command, [opts.entrypoint, ...serveArgs(opts.profile)]);
            return `# Claude Code (replace the example property)\nclaude mcp add gsc-local ${env} -- ${serverCommand}`;
        }
        default:
            throw new Error(`Unknown client "${client}". Supported: ${exports.CLIENT_KINDS.join(", ")}.`);
    }
}
// ---------------------------------------------------------------------------
// Setup-flow builders (single source of truth for `setup` writes)
// ---------------------------------------------------------------------------
/**
 * The MCP server entry written by setup. It launches this global installation
 * directly through the exact runtime that ran setup, so clients never need
 * npx/bunx, a package cache, or PATH lookup after setup completes.
 */
function buildSetupEntry(env) {
    return {
        command: process.execPath,
        args: [packageEntrypointPath(), "serve"],
        env: { ...env },
    };
}
function buildOpencodeEntry(env) {
    return {
        type: "local",
        command: [process.execPath, packageEntrypointPath(), "serve"],
        environment: { ...env },
        enabled: true,
    };
}
function buildSetupPrintJson(entry, serverName = exports.SETUP_SERVER_NAME) {
    return JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2);
}
/** Claude Desktop config path for an explicit home directory (temp-dir safe). */
function desktopConfigPath(homeDir) {
    const home = homeDir ?? os.homedir();
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    if (process.platform === "win32") {
        const appData = (homeDir === undefined ? process.env.APPDATA : undefined) || path.join(home, "AppData", "Roaming");
        return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}
/** Cursor MCP config path for an explicit home directory (temp-dir safe). */
function cursorConfigPath(homeDir = os.homedir()) {
    return path.join(homeDir, ".cursor", "mcp.json");
}
/** OpenCode global config path for an explicit home directory (temp-dir safe). */
function opencodeConfigPath(homeDir) {
    const home = homeDir ?? os.homedir();
    return path.join(home, ".config", "opencode", "opencode.json");
}
/** Pi (OhMyPi) global MCP file for an explicit home directory (temp-dir safe). */
function piConfigPath(homeDir) {
    const home = homeDir ?? os.homedir();
    return path.join(home, ".omp", "agent", "mcp.json");
}
/**
 * Resolve the file path for a file-based setup target.
 * Returns null when the home directory cannot be determined so the caller
 * falls back to generic output instead of guessing a path.
 */
function resolveFileConfigPath(target, homeDir) {
    const home = homeDir ?? safeHome();
    if (!home)
        return null;
    if (target === "desktop")
        return desktopConfigPath(homeDir);
    if (target === "cursor")
        return cursorConfigPath(home);
    if (target === "opencode")
        return opencodeConfigPath(home);
    if (target === "pi")
        return piConfigPath(home);
    return null;
}
function safeHome() {
    try {
        const home = os.homedir();
        return home && home.trim().length > 0 ? home : null;
    }
    catch {
        return null;
    }
}
function isFileTarget(value) {
    return value === "desktop" || value === "cursor" || value === "opencode" || value === "pi";
}
function isCliTarget(value) {
    return value === "code" || value === "codex";
}
/**
 * English-canonical merge validation failures. The exact strings are
 * part of the historical helper contract: `mergeGscEntry` throws them
 * verbatim and existing callers match on them. Localized rendering must
 * map these exact values (see `ClientConfigText`) and never echo or
 * translate anything else.
 */
exports.MERGE_INVALID_ROOT_ERROR = "Existing MCP config is not a JSON object; fix it first. Nothing was changed.";
exports.MERGE_INVALID_SERVERS_ERROR = 'Existing MCP config has a non-object "mcpServers" key; fix it first. Nothing was changed.';
/**
 * Narrow merge: set only `mcpServers[serverName]`, preserving every
 * unrelated server and every top-level key. Throws on non-object input
 * instead of writing a half-merged file.
 */
function mergeGscEntry(existingConfig, serverName, entry) {
    let base;
    if (existingConfig === undefined || existingConfig === null) {
        base = {};
    }
    else if (typeof existingConfig === "object" && !Array.isArray(existingConfig)) {
        base = { ...existingConfig };
    }
    else {
        throw new Error(exports.MERGE_INVALID_ROOT_ERROR);
    }
    const serversRaw = base.mcpServers;
    let servers;
    if (serversRaw === undefined) {
        servers = {};
    }
    else if (typeof serversRaw === "object" && serversRaw !== null && !Array.isArray(serversRaw)) {
        servers = { ...serversRaw };
    }
    else {
        throw new Error(exports.MERGE_INVALID_SERVERS_ERROR);
    }
    servers[serverName] = entry;
    base.mcpServers = servers;
    return base;
}
/**
 * English-canonical OpenCode merge failure for the global `mcp` key.
 * Mirrors the `mcpServers` contract with the exact OpenCode key so
 * diagnostics never print the wrong key and never echo file content.
 */
exports.MERGE_INVALID_MCP_ERROR = 'Existing MCP config has a non-object "mcp" key; fix it first. Nothing was changed.';
/**
 * Narrow OpenCode merge: set only `mcp[serverName]`, preserving every
 * unrelated server and every top-level key. Throws on non-object input
 * instead of writing a half-merged file.
 */
function mergeOpencodeEntry(existingConfig, serverName, entry) {
    let base;
    if (existingConfig === undefined || existingConfig === null) {
        base = {};
    }
    else if (typeof existingConfig === "object" && !Array.isArray(existingConfig)) {
        base = { ...existingConfig };
    }
    else {
        throw new Error(exports.MERGE_INVALID_ROOT_ERROR);
    }
    const serversRaw = base.mcp;
    let servers;
    if (serversRaw === undefined) {
        servers = {};
    }
    else if (typeof serversRaw === "object" && serversRaw !== null && !Array.isArray(serversRaw)) {
        servers = { ...serversRaw };
    }
    else {
        throw new Error(exports.MERGE_INVALID_MCP_ERROR);
    }
    servers[serverName] = entry;
    base.mcp = servers;
    return base;
}
/** Marker substituted for every existing env value shown in a preview. */
exports.REDACTED_VALUE = "[redacted]";
/**
 * Replace every leaf value with a placeholder while preserving structure
 * (object key names, array lengths). Key names are schema, values may be
 * secrets, so no existing value is ever copied to preview output.
 */
function shapeOnly(value) {
    if (Array.isArray(value))
        return value.map(() => exports.REDACTED_VALUE);
    if (typeof value === "object" && value !== null) {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = shapeOnly(value[key]);
        }
        return out;
    }
    return exports.REDACTED_VALUE;
}
/** Canonical English copy: the exact historical helper wording. */
exports.EN_CLIENT_CONFIG_TEXT = {
    configFile: "Config file: {path}",
    previewExisting: "existing gsc entry (values redacted):",
    previewNew: "new gsc entry:",
    noExistingEntry: "(no existing gsc entry)",
    unreadableEntry: "(unreadable entry)",
    dryRunNote: "[dry run] Would merge only mcpServers.{server}; unrelated servers untouched. No file written.",
    confirmOverwrite: "A {server} entry already exists. Overwrite only mcpServers.{server}? [y/N] ",
    confirmNew: "Write a new mcpServers.{server} entry to {path}? [y/N] ",
    skipped: "Skipped writing the config file. Nothing was changed.",
    backup: "Backup: {backup}",
    couldNotRead: "Could not read {path}. Nothing was changed.",
    invalidJson: "Could not parse {path}. The file contains invalid JSON. Fix it first, then re-run setup. Nothing was changed.",
    backupFailed: "Could not create a backup of {path}. Nothing was changed.",
    mkdirFailed: "Could not create the config folder for {path}. No config file was written.",
    stageFailedExisting: "Could not stage the updated config in {dir}. The existing config file was left untouched; a backup was kept at {backup}.",
    stageFailedNew: "Could not stage the new config in {dir}. No config file was written.",
    replaceFailedExisting: "Could not replace {path}. A backup was kept at {backup}; verify the config file before re-running setup.",
    replaceFailedNew: "Could not write {path}. No config entry was committed; verify the folder before re-running setup.",
    mergeInvalidRoot: exports.MERGE_INVALID_ROOT_ERROR,
    mergeInvalidServers: exports.MERGE_INVALID_SERVERS_ERROR,
    mergeInvalidMcp: exports.MERGE_INVALID_MCP_ERROR,
    configured: "Configured {path} (only mcpServers.{server} changed).",
    cliDryRunPreview: "[dry run preview] {command}",
    cliDryRunNote: "[dry run] Would run the exact command above. Nothing was invoked.",
    cliConfirm: "Run this exact command? [y/N] {command} ",
    cliSkipped: "Skipped the CLI-managed destination.",
    cliLaunchFailed: "Could not launch {program}. Run this yourself once it is installed:\n  {command}",
    cliNotFound: "The {program} CLI was not found on PATH. Run this yourself once it is installed:\n  {command}",
    cliAddFailed: "{program} mcp add did not succeed. Nothing was removed automatically. To replace the entry yourself, run:\n{steps}",
    cliConfigured: "Configured {program} ({server}).",
};
/**
 * Map a `mergeGscEntry`/`mergeOpencodeEntry` validation failure to its
 * localized rendering. Only the three exact canonical errors map (to the
 * optional `mergeInvalidRoot` / `mergeInvalidServers` / `mergeInvalidMcp`
 * templates, defaulting to the English-canonical messages when absent, so
 * existing callers stay byte-identical). Returns `null` for anything else
 * so callers fail closed to a static line instead of echoing unknown text.
 */
function localizeMergeErrorMessage(message, text = exports.EN_CLIENT_CONFIG_TEXT) {
    if (message === exports.MERGE_INVALID_ROOT_ERROR)
        return text.mergeInvalidRoot ?? message;
    if (message === exports.MERGE_INVALID_SERVERS_ERROR)
        return text.mergeInvalidServers ?? message;
    if (message === exports.MERGE_INVALID_MCP_ERROR)
        return text.mergeInvalidMcp ?? message;
    return null;
}
/**
 * Substitute `{name}` placeholders with exact machine values. Unknown
 * placeholders are left intact so a missing value stays visible instead
 * of silently vanishing. Each substitution is literal (split/join), so
 * values containing braces or spaces pass through byte-for-byte.
 */
function formatClientTemplate(template, vars = {}) {
    let out = template;
    for (const [name, value] of Object.entries(vars)) {
        out = out.split(`{${name}}`).join(value);
    }
    return out;
}
/**
 * Strip all existing values from an entry before display. Only structural
 * key names survive alongside `[redacted]` placeholders: `command`,
 * `args`, top-level custom fields, and nested env values are never
 * copied. A non-object entry degrades to a placeholder instead of raw
 * output. The narrow merge only ever displays the single gsc entry,
 * never unrelated servers. The placeholder label defaults to English so
 * existing callers (including the access-toggle preview) stay
 * byte-compatible; first-install setup passes its localized label.
 */
function redactEntryForPreview(entry, unreadable = exports.EN_CLIENT_CONFIG_TEXT.unreadableEntry) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return unreadable;
    }
    return shapeOnly(entry);
}
/**
 * Human-readable preview of the single narrowed change. Existing values
 * are always redacted; only the new entry (built from this setup run's
 * approved inputs) is shown in full. Labels default to English so existing
 * callers stay byte-compatible; first-install setup passes its localized
 * copy while exact paths, JSON, `mcpServers.gsc`, and `[redacted]` stay
 * untouched in every locale.
 */
function previewEntryChange(oldEntry, newEntry, text = exports.EN_CLIENT_CONFIG_TEXT) {
    const oldText = oldEntry === undefined ? text.noExistingEntry : JSON.stringify(redactEntryForPreview(oldEntry, text.unreadableEntry), null, 2);
    return `${text.previewExisting}\n${oldText}\n\n${text.previewNew}\n${JSON.stringify(newEntry, null, 2)}`;
}
function backupPathFor(configPath, now = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    return `${configPath}.backup-${stamp}`;
}
/** Unique staging path in the same directory (same filesystem => atomic rename). */
function tempPathFor(configPath) {
    return `${configPath}.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}
/**
 * Preview (values redacted) -> confirmation -> timestamped backup of the
 * original -> atomic replace via unique temp file plus rename.
 * Confirmation is always requested after the preview unless --yes/--force
 * is explicitly supplied, even when the file or the gsc entry does not
 * exist yet. A decline writes nothing and creates no backup. The merged
 * JSON is staged completely to a unique temp file in the target directory
 * (mode 0o600) and published with one atomic rename, so the destination
 * is never left half-written; the temp file is cleaned up on failure.
 * Failure messages never claim nothing changed once a mutation occurred
 * or the outcome is uncertain. Dry-run only previews and never writes.
 * Returns true when the entry is present afterwards (or would be in dry-run).
 *
 * Merge validation failures (`mergeGscEntry`) are rendered through the
 * optional `mergeInvalidRoot` / `mergeInvalidServers` templates: only the
 * two exact canonical errors map (fail-closed, never echoed); anything
 * else falls back to the static `skipped` line so unknown text — which
 * could carry paths or upstream content — is never printed.
 */
async function applyFileConfig(opts) {
    const serverName = opts.serverName ?? exports.SETUP_SERVER_NAME;
    const text = opts.text ?? exports.EN_CLIENT_CONFIG_TEXT;
    const mergeKey = opts.mergeKey ?? "mcpServers";
    const verbose = opts.verbose ?? true;
    const keyed = (template) => mergeKey === "mcpServers" ? template : template.split("mcpServers").join(mergeKey);
    let existing;
    let rawExists = false;
    if (fs.existsSync(opts.configPath)) {
        rawExists = true;
        let raw;
        try {
            raw = fs.readFileSync(opts.configPath, "utf8");
        }
        catch {
            opts.log(formatClientTemplate(text.couldNotRead, { path: opts.configPath }));
            return false;
        }
        try {
            existing = raw.trim().length > 0 ? JSON.parse(raw) : {};
        }
        catch {
            opts.log(formatClientTemplate(text.invalidJson, { path: opts.configPath }));
            return false;
        }
    }
    else {
        existing = {};
    }
    const servers = typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? existing[mergeKey]
        : undefined;
    const oldEntry = servers !== undefined && typeof servers === "object" && servers !== null ? servers[serverName] : undefined;
    if (verbose) {
        opts.log(`\n${formatClientTemplate(text.configFile, { path: opts.configPath })}`);
        opts.log(previewEntryChange(oldEntry, opts.entry, text));
    }
    if (opts.dryRun) {
        if (verbose)
            opts.log(formatClientTemplate(keyed(text.dryRunNote), { server: serverName }));
        return true;
    }
    if (!opts.force && !opts.yes) {
        const question = oldEntry !== undefined
            ? formatClientTemplate(keyed(text.confirmOverwrite), { server: serverName })
            : formatClientTemplate(keyed(text.confirmNew), { server: serverName, path: opts.configPath });
        const answer = await opts.confirm(question);
        if (answer.trim().toLowerCase() !== "y") {
            if (verbose)
                opts.log(text.skipped);
            return false;
        }
    }
    let next;
    try {
        next =
            mergeKey === "mcp"
                ? mergeOpencodeEntry(existing, serverName, opts.entry)
                : mergeGscEntry(existing, serverName, opts.entry);
    }
    catch (err) {
        // Exact-match mapping only: forged text never maps and unknown errors
        // are never echoed (they could carry paths or upstream content). The
        // merge runs before any backup/mkdir/stage, so the static skipped line
        // is accurate here and nothing was written.
        const message = err instanceof Error ? err.message : String(err);
        opts.log(localizeMergeErrorMessage(message, text) ?? text.skipped);
        return false;
    }
    let backup = null;
    if (rawExists) {
        backup = backupPathFor(opts.configPath);
        try {
            (opts.hooks?.createBackup ?? fs.copyFileSync)(opts.configPath, backup);
            if (verbose)
                opts.log(formatClientTemplate(text.backup, { backup }));
        }
        catch {
            opts.log(formatClientTemplate(text.backupFailed, { path: opts.configPath }));
            return false;
        }
    }
    else {
        try {
            fs.mkdirSync(path.dirname(opts.configPath), { recursive: true });
        }
        catch {
            opts.log(formatClientTemplate(text.mkdirFailed, { path: opts.configPath }));
            return false;
        }
    }
    const stageTemp = opts.hooks?.stageTemp ??
        ((tmpPath, content) => {
            fs.writeFileSync(tmpPath, content, { mode: 0o600 });
        });
    const commitTemp = opts.hooks?.commitTemp ??
        ((tmpPath, destPath) => {
            fs.renameSync(tmpPath, destPath);
        });
    const discardTemp = (tmpPath) => {
        try {
            if (opts.hooks?.discardTemp)
                opts.hooks.discardTemp(tmpPath);
            else
                fs.unlinkSync(tmpPath);
        }
        catch {
            // Temp already gone or still locked; reported by the caller when known.
        }
    };
    const tmpPath = tempPathFor(opts.configPath);
    try {
        stageTemp(tmpPath, JSON.stringify(next, null, 2));
    }
    catch {
        discardTemp(tmpPath);
        if (rawExists) {
            opts.log(formatClientTemplate(text.stageFailedExisting, { dir: path.dirname(opts.configPath), backup: backup ?? "" }));
        }
        else {
            opts.log(formatClientTemplate(text.stageFailedNew, { dir: path.dirname(opts.configPath) }));
        }
        return false;
    }
    try {
        commitTemp(tmpPath, opts.configPath);
    }
    catch {
        discardTemp(tmpPath);
        if (rawExists) {
            opts.log(formatClientTemplate(text.replaceFailedExisting, { path: opts.configPath, backup: backup ?? "" }));
        }
        else {
            opts.log(formatClientTemplate(text.replaceFailedNew, { path: opts.configPath }));
        }
        return false;
    }
    if (verbose)
        opts.log(formatClientTemplate(keyed(text.configured), { path: opts.configPath, server: serverName }));
    return true;
}
// ---------------------------------------------------------------------------
// CLI-managed destinations
// ---------------------------------------------------------------------------
function buildClaudeCodeArgs(env) {
    const args = ["mcp", "add", "--scope", "user"];
    for (const [key, value] of Object.entries(env)) {
        args.push("-e", `${key}=${value}`);
    }
    args.push(exports.SETUP_SERVER_NAME, "--", process.execPath, packageEntrypointPath(), "serve");
    return args;
}
function claudeCodeRemoveArgs() {
    return ["mcp", "remove", "--scope", "user", exports.SETUP_SERVER_NAME];
}
function buildCodexArgs(env) {
    const args = ["mcp", "add", exports.SETUP_SERVER_NAME];
    for (const [key, value] of Object.entries(env)) {
        args.push("--env", `${key}=${value}`);
    }
    args.push("--", process.execPath, packageEntrypointPath(), "serve");
    return args;
}
function codexRemoveArgs() {
    return ["mcp", "remove", exports.SETUP_SERVER_NAME];
}
/** Render a copyable command with quoting for the current user's shell. */
function formatPreviewCommand(program, args) {
    const quote = (value) => {
        if (process.platform === "win32") {
            return /^[A-Za-z0-9_@:/\\.-]+$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
        }
        return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
    };
    return [program, ...args].map(quote).join(" ");
}
const defaultRunner = (program, args, opts) => {
    const result = (0, node_child_process_1.spawnSync)(program, args, { stdio: opts.stdio });
    return { status: result.status, error: result.error };
};
/**
 * Preview the exact argument vector, confirm unless --yes/--force, then
 * invoke the add directly (never through a shell). Setup never removes an
 * existing entry automatically, even with --force (--force only skips
 * confirmation). A failed add fails closed with manual commands, so the
 * previous entry is never left deleted by setup. Dry-run previews only.
 */
async function applyCliConfig(opts) {
    const text = opts.text ?? exports.EN_CLIENT_CONFIG_TEXT;
    const verbose = opts.verbose ?? true;
    const preview = formatPreviewCommand(opts.program, opts.args);
    if (verbose)
        opts.log(`\n${formatClientTemplate(text.cliDryRunPreview, { command: preview })}`);
    if (opts.dryRun) {
        if (verbose)
            opts.log(text.cliDryRunNote);
        return true;
    }
    if (!opts.force && !opts.yes) {
        const answer = await opts.confirm(formatClientTemplate(text.cliConfirm, { command: preview }));
        if (answer.trim().toLowerCase() !== "y") {
            if (verbose)
                opts.log(text.cliSkipped);
            return false;
        }
    }
    const runner = opts.runner ?? defaultRunner;
    let result;
    try {
        result = runner(opts.program, opts.args, { stdio: "inherit" });
    }
    catch (err) {
        opts.log(`\n${formatClientTemplate(text.cliLaunchFailed, { program: opts.program, command: preview })}`);
        void err;
        return false;
    }
    const code = result.error?.code;
    if (result.error && code === "ENOENT") {
        opts.log(`\n${formatClientTemplate(text.cliNotFound, { program: opts.program, command: preview })}`);
        return false;
    }
    if (result.status !== 0) {
        const steps = opts.removeArgs
            ? `  ${formatPreviewCommand(opts.program, opts.removeArgs)}\n  ${preview}`
            : `  ${preview}`;
        opts.log(`\n${formatClientTemplate(text.cliAddFailed, { program: opts.program, steps })}`);
        return false;
    }
    if (verbose)
        opts.log(`\n${formatClientTemplate(text.cliConfigured, { program: opts.program, server: exports.SETUP_SERVER_NAME })}`);
    return true;
}
// ---------------------------------------------------------------------------
// Write-toggle destinations (`setup enable-write` / `setup disable-write`)
// ---------------------------------------------------------------------------
/** Env key that gates Google write operations alongside full scopes. */
exports.WRITE_ENV_KEY = "GSC_ENABLE_WRITE";
/**
 * First file-based target whose config file already exists. Used as the
 * default when `setup enable-write|disable-write` runs without --client:
 * desktop first, then cursor. Returns null when neither config exists so
 * the caller fails closed instead of guessing a path. CLI-managed targets
 * (code, codex) always need an explicit --client flag.
 */
function detectFileTarget(homeDir) {
    for (const target of exports.FILE_TARGETS) {
        const configPath = resolveFileConfigPath(target, homeDir);
        if (configPath !== null) {
            try {
                if (fs.existsSync(configPath))
                    return target;
            }
            catch {
                // Unreadable path: treat as absent and keep probing.
            }
        }
    }
    return null;
}
/**
 * Read the existing gsc server entry from a client config file. Fails
 * closed with actionable messages that never echo env values: a missing
 * or unreadable file, invalid JSON, a non-object config, a missing gsc
 * entry, or a non-object gsc entry all report without writing anything.
 */
function readGscEntry(configPath, serverName = exports.SETUP_SERVER_NAME) {
    let raw;
    try {
        raw = fs.readFileSync(configPath, "utf8");
    }
    catch {
        throw new Error(`No MCP client config at ${configPath}. Run setup first to create it. Nothing was changed.`);
    }
    let parsed;
    try {
        parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
    }
    catch {
        throw new Error(`Could not parse ${configPath}. The file contains invalid JSON. Fix it first, then re-run. Nothing was changed.`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Existing MCP config at ${configPath} is not a JSON object; fix it first. Nothing was changed.`);
    }
    const servers = parsed.mcpServers;
    if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) {
        throw new Error(`Existing MCP config at ${configPath} has a non-object "mcpServers" key; fix it first. Nothing was changed.`);
    }
    const entry = servers?.[serverName];
    if (entry === undefined) {
        throw new Error(`No ${serverName} entry in ${configPath}. Run setup first to create it. Nothing was changed.`);
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(`The ${serverName} entry in ${configPath} is not a JSON object; fix it first. Nothing was changed.`);
    }
    return { config: parsed, entry: entry };
}
/** Copy the installed env without replacing malformed entries or mutating callers. */
function copyGscEnv(oldEnv) {
    let base;
    if (oldEnv === undefined || oldEnv === null) {
        base = {};
    }
    else if (typeof oldEnv === "object" && !Array.isArray(oldEnv)) {
        base = { ...oldEnv };
    }
    else {
        throw new Error("Existing gsc entry has a non-object env; fix it first. Nothing was changed.");
    }
    return base;
}
/** An explicit canonical switch removes only the two obsolete access keys. */
function updateGscEnvForAccess(oldEnv, access) {
    if (access !== "readonly" && access !== "full")
        throw new Error("Invalid access mode; use readonly or full. Nothing was changed.");
    const base = copyGscEnv(oldEnv);
    const changed = base.GSC_ACCESS_MODE !== access || "GSC_SCOPES" in base || exports.WRITE_ENV_KEY in base;
    delete base.GSC_SCOPES;
    delete base[exports.WRITE_ENV_KEY];
    return { env: { ...base, GSC_ACCESS_MODE: access }, changed };
}
/** Preserve legacy toggle semantics; canonical entries require the access command. */
function updateGscEnvForWrite(oldEnv, enable) {
    const base = copyGscEnv(oldEnv);
    if ("GSC_ACCESS_MODE" in base) {
        throw new Error(`This entry uses canonical access. Run gsc setup access ${enable ? "full" : "readonly"} with the same --client. Nothing was changed.`);
    }
    if (enable) {
        if (base[exports.WRITE_ENV_KEY] === "1")
            return { env: base, changed: false };
        return { env: { ...base, [exports.WRITE_ENV_KEY]: "1" }, changed: true };
    }
    if (!(exports.WRITE_ENV_KEY in base))
        return { env: base, changed: false };
    const next = { ...base };
    delete next[exports.WRITE_ENV_KEY];
    return { env: next, changed: true };
}
/**
 * Both preview sides are redacted. Only the selected access mode or legacy
 * flag diff is literal; neither carries secret material.
 */
function previewWriteEnvChange(oldEntry, newEntry, enable, access) {
    const oldText = JSON.stringify(redactEntryForPreview(oldEntry), null, 2);
    const newText = JSON.stringify(redactEntryForPreview(newEntry), null, 2);
    const diff = access !== undefined
        ? `env change: GSC_ACCESS_MODE=${access}; remove legacy GSC_SCOPES and ${exports.WRITE_ENV_KEY}`
        : enable ? `env change: + ${exports.WRITE_ENV_KEY}=1` : `env change: - ${exports.WRITE_ENV_KEY} (removed)`;
    return `existing gsc entry (values redacted):\n${oldText}\n\nnew gsc entry (values redacted):\n${newText}\n\n${diff}`;
}
/**
 * In-place access edit or legacy write toggle for one file-based client config. Same safety
 * contract as applyFileConfig: redacted preview, confirmation unless
 * --yes/--force, timestamped backup, atomic replace via a unique temp file
 * plus rename (mode 0o600), temp cleanup on failure. Only the gsc entry's
 * env changes: command, args, custom fields, unrelated servers, and
 * top-level keys are preserved exactly. Already-correct state succeeds
 * without writing, backing up, or prompting. Dry-run previews only and
 * never writes. Returns true when the entry is correct afterwards (or
 * would be in dry-run).
 */
async function applyWriteFileConfig(opts) {
    const serverName = opts.serverName ?? exports.SETUP_SERVER_NAME;
    let config;
    let oldEntry;
    try {
        const read = readGscEntry(opts.configPath, serverName);
        config = read.config;
        oldEntry = read.entry;
    }
    catch (err) {
        opts.log(err instanceof Error ? err.message : String(err));
        return false;
    }
    let nextEnv;
    try {
        const updated = opts.access !== undefined
            ? updateGscEnvForAccess(oldEntry.env, opts.access)
            : updateGscEnvForWrite(oldEntry.env, opts.enable);
        if (!updated.changed) {
            opts.log(opts.access !== undefined
                ? `GSC_ACCESS_MODE=${opts.access} is already set without legacy access keys. Nothing was changed.`
                : opts.enable
                    ? `${exports.WRITE_ENV_KEY}=1 is already set in mcpServers.${serverName} (${opts.configPath}). Nothing was changed.`
                    : `${exports.WRITE_ENV_KEY} is already absent from mcpServers.${serverName} (${opts.configPath}). Nothing was changed.`);
            return true;
        }
        nextEnv = updated.env;
    }
    catch (err) {
        opts.log(err instanceof Error ? err.message : String(err));
        return false;
    }
    // Preserve the installed entry exactly (command, args, custom fields):
    // only its env is replaced. The cast is runtime-neutral; mergeGscEntry
    // stores the object verbatim and JSON keeps every carried-over value.
    const newEntry = { ...oldEntry, env: nextEnv };
    opts.log(`\nConfig file: ${opts.configPath}`);
    opts.log(previewWriteEnvChange(oldEntry, newEntry, opts.enable, opts.access));
    if (opts.dryRun) {
        opts.log(`[dry run] Would change only mcpServers.${serverName}.env; unrelated servers untouched. No file written.`);
        return true;
    }
    if (!opts.force && !opts.yes) {
        const question = opts.access !== undefined
            ? `Set GSC_ACCESS_MODE=${opts.access} and remove legacy access keys in ${opts.configPath}? [y/N] `
            : opts.enable
                ? `Add ${exports.WRITE_ENV_KEY}=1 to mcpServers.${serverName}.env in ${opts.configPath}? [y/N] `
                : `Remove ${exports.WRITE_ENV_KEY} from mcpServers.${serverName}.env in ${opts.configPath}? [y/N] `;
        const answer = await opts.confirm(question);
        if (answer.trim().toLowerCase() !== "y") {
            opts.log("Skipped writing the config file. Nothing was changed.");
            return false;
        }
    }
    let next;
    try {
        next = mergeGscEntry(config, serverName, newEntry);
    }
    catch (err) {
        opts.log(err instanceof Error ? err.message : String(err));
        return false;
    }
    const backup = backupPathFor(opts.configPath);
    try {
        fs.copyFileSync(opts.configPath, backup);
        opts.log(`Backup: ${backup}`);
    }
    catch {
        opts.log(`Could not create a backup of ${opts.configPath}. Nothing was changed.`);
        return false;
    }
    const stageTemp = opts.hooks?.stageTemp ??
        ((tmpPath, content) => {
            fs.writeFileSync(tmpPath, content, { mode: 0o600 });
        });
    const commitTemp = opts.hooks?.commitTemp ??
        ((tmpPath, destPath) => {
            fs.renameSync(tmpPath, destPath);
        });
    const discardTemp = (tmpPath) => {
        try {
            if (opts.hooks?.discardTemp)
                opts.hooks.discardTemp(tmpPath);
            else
                fs.unlinkSync(tmpPath);
        }
        catch {
            // Temp already gone or still locked; reported by the caller when known.
        }
    };
    const tmpPath = tempPathFor(opts.configPath);
    try {
        stageTemp(tmpPath, JSON.stringify(next, null, 2));
    }
    catch {
        discardTemp(tmpPath);
        opts.log(`Could not stage the updated config in ${path.dirname(opts.configPath)}. ` +
            `The existing config file was left untouched; a backup was kept at ${backup}.`);
        return false;
    }
    try {
        commitTemp(tmpPath, opts.configPath);
    }
    catch {
        discardTemp(tmpPath);
        opts.log(`Could not replace ${opts.configPath}. ` +
            `A backup was kept at ${backup}; verify the config file before re-running.`);
        return false;
    }
    opts.log(`Updated ${opts.configPath} (only mcpServers.${serverName}.env changed).`);
    return true;
}
