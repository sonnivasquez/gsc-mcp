export declare const CLIENT_KINDS: readonly ["desktop", "code", "cursor", "codex", "opencode", "pi", "generic"];
export type ClientKind = (typeof CLIENT_KINDS)[number];
/**
 * File-based destinations. Desktop/cursor/pi share the `mcpServers`
 * merge contract; opencode uses its own global `mcp` key with a
 * `{type:"local", command:[...], environment:{...}, enabled:true}` shape.
 * All four reuse the same preview/backup/atomic-replace machinery.
 */
export declare const FILE_TARGETS: readonly ["desktop", "cursor", "opencode", "pi"];
export type FileTarget = (typeof FILE_TARGETS)[number];
/** CLI-managed destinations are invoked by exact argv, never through a shell. */
export declare const CLI_TARGETS: readonly ["code", "codex"];
export type CliTarget = (typeof CLI_TARGETS)[number];
/** Print-only destinations never touch the filesystem or spawn a process. */
export declare const PRINT_TARGETS: readonly ["generic", "print"];
/** Server key used by the guided setup flow. Narrow merges touch only this key. */
export declare const SETUP_SERVER_NAME = "gsc";
/** Local toolchain runtime. Bun is the default; Node stays explicitly selectable. */
export type SetupRuntime = "bun" | "node";
/**
 * Host runtime detection (same contract as doctor/finish): Bun when the
 * Bun global or process.versions.bun exists, otherwise Node. Setup reuses
 * this so generated entries match the invoking runtime instead of always
 * emitting npx, and an explicit Node invocation keeps Node entries.
 */
export declare function currentRuntime(): SetupRuntime;
/** Runner command used for separately installing the bundled agent skill. */
export declare function setupCommandFor(runtime: SetupRuntime): string;
/** Absolute entry point inside this installed package (compiled under dist/). */
export declare function packageEntrypointPath(): string;
export interface ClientConfigOpts {
    command: string;
    entrypoint: string;
    profile?: string;
}
export interface SetupFileEntry {
    command: string;
    args: string[];
    env: Record<string, string>;
}
export declare function printClientConfig(client: string, opts: ClientConfigOpts): string;
/**
 * The MCP server entry written by setup. It launches this global installation
 * directly through the exact runtime that ran setup, so clients never need
 * npx/bunx, a package cache, or PATH lookup after setup completes.
 */
export declare function buildSetupEntry(env: Record<string, string>): SetupFileEntry;
/**
 * OpenCode global entry shape. OpenCode stores servers under the top-level
 * `mcp` key (not `mcpServers`) as `{type:"local", command:[...],
 * environment:{...}, enabled:true}` where command is an argv vector.
 */
export interface OpencodeFileEntry {
    type: "local";
    command: string[];
    environment: Record<string, string>;
    enabled: boolean;
}
export declare function buildOpencodeEntry(env: Record<string, string>): OpencodeFileEntry;
export declare function buildSetupPrintJson(entry: SetupFileEntry, serverName?: string): string;
/** Claude Desktop config path for an explicit home directory (temp-dir safe). */
export declare function desktopConfigPath(homeDir?: string): string;
/** Cursor MCP config path for an explicit home directory (temp-dir safe). */
export declare function cursorConfigPath(homeDir?: string): string;
/** OpenCode global config path for an explicit home directory (temp-dir safe). */
export declare function opencodeConfigPath(homeDir?: string): string;
/** Pi (OhMyPi) global MCP file for an explicit home directory (temp-dir safe). */
export declare function piConfigPath(homeDir?: string): string;
/**
 * Resolve the file path for a file-based setup target.
 * Returns null when the home directory cannot be determined so the caller
 * falls back to generic output instead of guessing a path.
 */
export declare function resolveFileConfigPath(target: FileTarget, homeDir?: string): string | null;
export declare function isFileTarget(value: string): value is FileTarget;
export declare function isCliTarget(value: string): value is CliTarget;
/**
 * English-canonical merge validation failures. The exact strings are
 * part of the historical helper contract: `mergeGscEntry` throws them
 * verbatim and existing callers match on them. Localized rendering must
 * map these exact values (see `ClientConfigText`) and never echo or
 * translate anything else.
 */
export declare const MERGE_INVALID_ROOT_ERROR = "Existing MCP config is not a JSON object; fix it first. Nothing was changed.";
export declare const MERGE_INVALID_SERVERS_ERROR = "Existing MCP config has a non-object \"mcpServers\" key; fix it first. Nothing was changed.";
/**
 * Narrow merge: set only `mcpServers[serverName]`, preserving every
 * unrelated server and every top-level key. Throws on non-object input
 * instead of writing a half-merged file.
 */
export declare function mergeGscEntry(existingConfig: unknown, serverName: string, entry: SetupFileEntry): Record<string, unknown>;
/**
 * English-canonical OpenCode merge failure for the global `mcp` key.
 * Mirrors the `mcpServers` contract with the exact OpenCode key so
 * diagnostics never print the wrong key and never echo file content.
 */
export declare const MERGE_INVALID_MCP_ERROR = "Existing MCP config has a non-object \"mcp\" key; fix it first. Nothing was changed.";
/**
 * Narrow OpenCode merge: set only `mcp[serverName]`, preserving every
 * unrelated server and every top-level key. Throws on non-object input
 * instead of writing a half-merged file.
 */
export declare function mergeOpencodeEntry(existingConfig: unknown, serverName: string, entry: OpencodeFileEntry): Record<string, unknown>;
/** Marker substituted for every existing env value shown in a preview. */
export declare const REDACTED_VALUE = "[redacted]";
/**
 * Human-facing copy for the first-install file/CLI helpers
 * (`applyFileConfig`, `applyCliConfig`, `previewEntryChange`).
 *
 * English is the canonical default and stays byte-compatible for existing
 * callers (including the access-toggle subcommands, which keep using the
 * English default). Setup builds a locale-specific value from its
 * translation catalog and passes it in; every other caller omits `text`
 * and keeps the historical English output. Placeholders (`{path}`,
 * `{server}`, `{dir}`, `{backup}`, `{command}`, `{program}`, `{steps}`)
 * are substituted with exact machine values and never translated.
 *
 * `mergeInvalidRoot` / `mergeInvalidServers` are optional so existing
 * callers (including `src/setup.ts`, which builds this object from its
 * catalog) keep compiling unchanged: when absent, the English-canonical
 * merge errors render verbatim. Localized first-install runs pass the
 * `fileMergeInvalidRoot` / `fileMergeInvalidServers` catalog entries here
 * (forwarding lives in `src/setup.ts`, outside this seam).
 */
export interface ClientConfigText {
    configFile: string;
    previewExisting: string;
    previewNew: string;
    noExistingEntry: string;
    unreadableEntry: string;
    dryRunNote: string;
    confirmOverwrite: string;
    confirmNew: string;
    skipped: string;
    backup: string;
    couldNotRead: string;
    invalidJson: string;
    backupFailed: string;
    mkdirFailed: string;
    stageFailedExisting: string;
    stageFailedNew: string;
    replaceFailedExisting: string;
    replaceFailedNew: string;
    /**
     * Localized rendering of `MERGE_INVALID_ROOT_ERROR`. Optional: absent
     * means the English-canonical message.
     */
    mergeInvalidRoot?: string;
    /**
     * Localized rendering of `MERGE_INVALID_SERVERS_ERROR`. Optional:
     * absent means the English-canonical message. The `mcpServers` key
     * stays exact in every locale.
     */
    mergeInvalidServers?: string;
    /**
     * Localized rendering of `MERGE_INVALID_MCP_ERROR` for the OpenCode
     * global `mcp` key. Optional: absent means the English-canonical
     * message. The `mcp` key stays exact in every locale.
     */
    mergeInvalidMcp?: string;
    configured: string;
    cliDryRunPreview: string;
    cliDryRunNote: string;
    cliConfirm: string;
    cliSkipped: string;
    cliLaunchFailed: string;
    cliNotFound: string;
    cliAddFailed: string;
    cliConfigured: string;
}
/** Canonical English copy: the exact historical helper wording. */
export declare const EN_CLIENT_CONFIG_TEXT: ClientConfigText;
/**
 * Map a `mergeGscEntry`/`mergeOpencodeEntry` validation failure to its
 * localized rendering. Only the three exact canonical errors map (to the
 * optional `mergeInvalidRoot` / `mergeInvalidServers` / `mergeInvalidMcp`
 * templates, defaulting to the English-canonical messages when absent, so
 * existing callers stay byte-identical). Returns `null` for anything else
 * so callers fail closed to a static line instead of echoing unknown text.
 */
export declare function localizeMergeErrorMessage(message: string, text?: ClientConfigText): string | null;
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
export declare function redactEntryForPreview(entry: unknown, unreadable?: string): unknown;
/**
 * Human-readable preview of the single narrowed change. Existing values
 * are always redacted; only the new entry (built from this setup run's
 * approved inputs) is shown in full. Labels default to English so existing
 * callers stay byte-compatible; first-install setup passes its localized
 * copy while exact paths, JSON, `mcpServers.gsc`, and `[redacted]` stay
 * untouched in every locale.
 */
export declare function previewEntryChange(oldEntry: unknown, newEntry: SetupFileEntry | OpencodeFileEntry, text?: ClientConfigText): string;
export declare function backupPathFor(configPath: string, now?: Date): string;
/** Unique staging path in the same directory (same filesystem => atomic rename). */
export declare function tempPathFor(configPath: string): string;
export interface FileCommitHooks {
    /** Copy the original before staging changes. Default: fs.copyFileSync. */
    createBackup?: (sourcePath: string, backupPath: string) => void;
    /** Stage complete content to a temp path. Default: write with mode 0o600. */
    stageTemp?: (tmpPath: string, content: string) => void;
    /** Atomically publish staged temp over the destination. Default: rename. */
    commitTemp?: (tmpPath: string, destPath: string) => void;
    /** Best-effort temp cleanup after a failed stage/commit. Default: unlink if present. */
    discardTemp?: (tmpPath: string) => void;
}
export interface ApplyFileConfigOpts {
    configPath: string;
    serverName?: string;
    entry: SetupFileEntry | OpencodeFileEntry;
    force: boolean;
    yes: boolean;
    dryRun: boolean;
    confirm: (question: string) => Promise<string>;
    log: (message: string) => void;
    /** Localized human-facing copy. Defaults to English for existing callers. */
    text?: ClientConfigText;
    /** Fault-injection seam for backup/write/rename failure tests. Defaults to real fs. */
    hooks?: FileCommitHooks;
    /**
     * Merge key for the destination file. Desktop/cursor/pi use `mcpServers`;
     * the OpenCode global file uses `mcp`. Defaults to `mcpServers` so
     * existing callers stay byte-compatible.
     */
    mergeKey?: "mcpServers" | "mcp";
    /**
     * Quiet switch for the guided setup flow. When false, informational
     * lines (config file, preview, dry-run note, backup, configured,
     * skipped) are suppressed; failures still log. Defaults to true so
     * existing callers and tests keep their historical output.
     */
    verbose?: boolean;
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
export declare function applyFileConfig(opts: ApplyFileConfigOpts): Promise<boolean>;
export declare function buildClaudeCodeArgs(env: Record<string, string>): string[];
export declare function claudeCodeRemoveArgs(): string[];
export declare function buildCodexArgs(env: Record<string, string>): string[];
export declare function codexRemoveArgs(): string[];
/** Render a copyable command with quoting for the current user's shell. */
export declare function formatPreviewCommand(program: string, args: string[]): string;
export type SpawnRunner = (program: string, args: string[], opts: {
    stdio: "inherit" | "ignore" | "pipe";
}) => {
    status: number | null;
    error?: NodeJS.ErrnoException | Error;
};
export interface ApplyCliConfigOpts {
    program: "claude" | "codex";
    args: string[];
    /**
     * Rendered only inside the manual fallback message. Setup never executes
     * a remove automatically, so a failed add can never delete the previous
     * entry on its own.
     */
    removeArgs?: string[];
    force: boolean;
    yes: boolean;
    dryRun: boolean;
    confirm: (question: string) => Promise<string>;
    log: (message: string) => void;
    /** Localized human-facing copy. Defaults to English for existing callers. */
    text?: ClientConfigText;
    runner?: SpawnRunner;
    /**
     * Quiet switch for the guided setup flow. When false, informational
     * lines (preview, dry-run note, configured, skipped) are suppressed;
     * failures still log. Defaults to true so existing callers keep output.
     */
    verbose?: boolean;
}
/**
 * Preview the exact argument vector, confirm unless --yes/--force, then
 * invoke the add directly (never through a shell). Setup never removes an
 * existing entry automatically, even with --force (--force only skips
 * confirmation). A failed add fails closed with manual commands, so the
 * previous entry is never left deleted by setup. Dry-run previews only.
 */
export declare function applyCliConfig(opts: ApplyCliConfigOpts): Promise<boolean>;
/** Env key that gates Google write operations alongside full scopes. */
export declare const WRITE_ENV_KEY = "GSC_ENABLE_WRITE";
/**
 * First file-based target whose config file already exists. Used as the
 * default when `setup enable-write|disable-write` runs without --client:
 * desktop first, then cursor. Returns null when neither config exists so
 * the caller fails closed instead of guessing a path. CLI-managed targets
 * (code, codex) always need an explicit --client flag.
 */
export declare function detectFileTarget(homeDir?: string): FileTarget | null;
/**
 * Read the existing gsc server entry from a client config file. Fails
 * closed with actionable messages that never echo env values: a missing
 * or unreadable file, invalid JSON, a non-object config, a missing gsc
 * entry, or a non-object gsc entry all report without writing anything.
 */
export declare function readGscEntry(configPath: string, serverName?: string): {
    config: Record<string, unknown>;
    entry: Record<string, unknown>;
};
/** An explicit canonical switch removes only the two obsolete access keys. */
export declare function updateGscEnvForAccess(oldEnv: unknown, access: "readonly" | "full"): {
    env: Record<string, unknown>;
    changed: boolean;
};
/** Preserve legacy toggle semantics; canonical entries require the access command. */
export declare function updateGscEnvForWrite(oldEnv: unknown, enable: boolean): {
    env: Record<string, unknown>;
    changed: boolean;
};
/**
 * Both preview sides are redacted. Only the selected access mode or legacy
 * flag diff is literal; neither carries secret material.
 */
export declare function previewWriteEnvChange(oldEntry: unknown, newEntry: Record<string, unknown>, enable: boolean, access?: "readonly" | "full"): string;
export interface ApplyWriteFileConfigOpts {
    configPath: string;
    serverName?: string;
    enable: boolean;
    access?: "readonly" | "full";
    force: boolean;
    yes: boolean;
    dryRun: boolean;
    confirm: (question: string) => Promise<string>;
    log: (message: string) => void;
    hooks?: FileCommitHooks;
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
export declare function applyWriteFileConfig(opts: ApplyWriteFileConfigOpts): Promise<boolean>;
