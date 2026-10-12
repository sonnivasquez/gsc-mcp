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
exports.SHARED_WRITE_REFUSAL = exports.ACCESS_USAGE = exports.WRITE_TOGGLE_USAGE = void 0;
exports.sanitizeSetupFailure = sanitizeSetupFailure;
exports.parseSetupSitesList = parseSetupSitesList;
exports.buildEnv = buildEnv;
exports.applyTargets = applyTargets;
exports.runSetup = runSetup;
exports.classifyWriteTier = classifyWriteTier;
exports.resolveWriteTargets = resolveWriteTargets;
exports.runEnableWriteCommand = runEnableWriteCommand;
exports.runDisableWriteCommand = runDisableWriteCommand;
exports.runAccessCommand = runAccessCommand;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const version_js_1 = require("./version.js");
const flow_js_1 = require("./setup/flow.js");
const oauth_js_1 = require("./oauth.js");
const embedded_client_js_1 = require("./embedded-client.js");
const auth_js_1 = require("./setup/auth.js");
const properties_js_1 = require("./setup/properties.js");
const profiles_js_1 = require("./profiles.js");
const finish_js_1 = require("./setup/finish.js");
const skill_install_js_1 = require("./setup/skill-install.js");
const auth_provider_js_1 = require("./auth-provider.js");
const clients_js_1 = require("./setup/clients.js");
const i18n_js_1 = require("./setup/i18n.js");
const client_config_js_1 = require("./client-config.js");
// Setup help text lives in src/setup/i18n.ts (SETUP_STRINGS). English stays
// the exact default/fallback catalog; Spanish is the localized equivalent.
const KNOWN_CLIENTS = new Set(["desktop", "code", "cursor", "codex", "opencode", "pi", "generic", "print", "both"]);
function needValue(flag, value) {
    if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(`${flag} needs a value. Run with --help for usage.`);
    }
    return value;
}
function parseArgs(argv) {
    const opts = {
        clients: [],
        access: null,
        scopes: null,
        sites: [],
        allSites: false,
        secrets: null,
        keyFile: null,
        auth: null,
        enableWrite: false,
        firstQuery: false,
        installSkill: false,
        reauth: false,
        force: false,
        dryRun: false,
        verbose: false,
        yes: false,
        language: null,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--client": {
                const v = needValue("--client", argv[++i]);
                for (const part of v.split(",")) {
                    const name = part.trim().toLowerCase();
                    if (!KNOWN_CLIENTS.has(name)) {
                        // No input echo: the rejected value may hold sensitive text.
                        throw new Error("Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print, or both (repeatable).");
                    }
                    opts.clients.push(name);
                }
                break;
            }
            case "--access": {
                const value = argv[++i];
                if (value !== "readonly" && value !== "full") {
                    throw new Error("Invalid --access value. Use readonly or full.");
                }
                opts.access = value;
                break;
            }
            case "--scopes": {
                const v = argv[++i];
                if (v === "readonly" || v === "full")
                    opts.scopes = v;
                // No input echo: the rejected value may hold sensitive text.
                else
                    throw new Error("Invalid --scopes value. Use readonly or full.");
                break;
            }
            case "--site": {
                const v = argv[++i];
                if (v === undefined || v === "" || v.startsWith("--")) {
                    throw new Error("--site needs a value. Run with --help for usage.");
                }
                opts.sites.push(v);
                break;
            }
            case "--all-sites":
                opts.allSites = true;
                break;
            case "--auth": {
                const v = argv[++i];
                if (v === "shared" || v === "custom" || v === "service-account")
                    opts.auth = v;
                else
                    throw new Error("Invalid --auth value. Use shared, custom, or service-account.");
                break;
            }
            case "--enable-write":
                opts.enableWrite = true;
                break;
            case "--first-query":
                opts.firstQuery = true;
                break;
            case "--install-skill":
                opts.installSkill = true;
                break;
            case "--key-file":
                opts.keyFile = argv[++i] ?? null;
                break;
            case "--secrets":
                opts.secrets = argv[++i] ?? null;
                break;
            case "--reauth":
                opts.reauth = true;
                break;
            case "--force":
                opts.force = true;
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            case "--verbose":
                opts.verbose = true;
                break;
            case "--yes":
            case "-y":
                opts.yes = true;
                break;
            case "--language":
                // No input echo: the rejected value may hold sensitive text.
                opts.language = (0, i18n_js_1.parseSetupLanguage)(argv[++i]);
                break;
            case "--help":
            case "-h":
                opts.help = true;
                break;
            default:
                // No input echo: the unknown token may hold sensitive text.
                throw new Error("Unknown option. Run with --help for usage.");
        }
    }
    return opts;
}
/**
 * Controlled setup-validation failures: exact enumerated static messages
 * (flag shape, scope/write gates, allowlist shape, credential shape) plus
 * two tightly anchored patterns whose only dynamic part is a numeric range.
 * Full-string matching is deliberate: a prefix/substring rule would pass
 * through forged external text such as "OAuth error: <secret>" from the
 * Google redirect query parameter (src/oauth.ts) or an "Invalid ..."
 * message with attacker input appended. Anything not enumerated is
 * unexpected (usually Google, network, or filesystem) and maps to a stable
 * code plus an action, with no raw exception text that could echo
 * credentials, paths, or upstreams. The optional locale selects the
 * human-facing rendering only: thrown errors stay English-canonical and
 * `en` output is byte-identical to the historical copy.
 */
const CONTROLLED_SETUP_ERROR_MESSAGES = new Set([
    "Unknown option. Run with --help for usage.",
    "--client needs a value. Run with --help for usage.",
    "--site needs a value. Run with --help for usage.",
    "Invalid --client value. Use desktop, code, cursor, codex, generic, print, or both (repeatable).",
    "Invalid --client value. Use desktop, code, cursor, codex, generic, print (repeatable) or both.",
    "Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print, or both (repeatable).",
    "Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print (repeatable) or both.",
    "Invalid --scopes value. Use readonly or full.",
    "Invalid --access value. Use readonly or full.",
    "Invalid --auth value. Use shared, custom, or service-account.",
    i18n_js_1.INVALID_SETUP_LANGUAGE_ERROR,
    i18n_js_1.MISSING_SETUP_LANGUAGE_ERROR,
    `Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}.`,
    `Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`,
    "Quick Connect is unavailable in this build. Choose --auth custom with --secrets instead.",
    "Credential path does not match the selected authentication mode.",
    "Service Account requires --key-file.",
    "Cannot read a valid custom JSON credential file.",
    "Cannot read a valid service-account JSON credential file.",
    "Invalid custom credential shape.",
    "Invalid service-account credential shape.",
    "Custom OAuth requires a Desktop installed client JSON with client_id, client_secret, and loopback redirect_uris.",
    "Service Account requires a service_account JSON with client_email and private_key.",
    "Write enablement requires full access.",
    "--enable-write requires --scopes full and a custom or service-account authentication mode.",
    "Invalid --site value: property must not be empty. Use sc-domain:... or an http(s):// URL.",
    "Invalid --site value. Use sc-domain:... or an http(s):// URL.",
    "Invalid property. Use sc-domain:... or an http(s):// URL.",
    "Invalid setup choice",
    "Invalid setup scope",
    "Invalid setup client",
    "A dashboard property is required",
    "No Search Console properties available",
    "No properties found on this account; --all-sites has nothing to select. Pass --site explicitly once access exists.",
    "No credentials provided. Re-run setup when you have the JSON file.",
    "Secrets file not found. Check the --secrets path and re-run setup.",
    "Secrets file not found. Check the path and re-run setup.",
    "Use either repeatable --site or --all-sites, not both.",
    properties_js_1.MIXED_ALLOW_ALL_ERROR,
    "Use --client print/generic alone: it only prints the config without writing or invoking.",
    "OAuth authentication timed out after 2 minutes",
    auth_provider_js_1.SITES_LIST_SHAPE_ERROR,
]);
const CONTROLLED_SETUP_ERROR_PATTERNS = [
    /^Invalid property selection: (use numbers like 0,1,3 or "all"\.|use "0" alone for all current \+ future properties\.|choose 0-\d+ or "all"\.)$/,
    /^Invalid client selection: (use numbers like 1,3\.|choose 1-\d+\.)$/,
];
function sanitizeSetupFailure(err, locale = "en") {
    const message = err instanceof Error ? err.message : String(err);
    if (CONTROLLED_SETUP_ERROR_MESSAGES.has(message) ||
        CONTROLLED_SETUP_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
        if (locale === "es") {
            const translated = (0, i18n_js_1.localizeSetupErrorMessage)(message, locale);
            // The Spanish table mirrors the controlled gate above; a miss here
            // (drift) still fails closed to the generic localized safe error.
            if (translated !== null)
                return `\nError de configuración: ${translated}`;
        }
        else {
            return `\nSetup failed: ${message}`;
        }
    }
    return `\n${(0, i18n_js_1.translateSetup)(locale, "genericFailure")}`;
}
/**
 * Parse the single live sites.list response through the shared shape gate
 * (same validator doctor/fetchSitesList uses: no second HTTP request).
 * Any malformed 2xx member or wrong-shaped response throws the stable
 * shape error, so setup fails nonzero before client configuration and
 * before an explicit --site can bypass it. Valid responses keep every
 * exact identifier byte-for-byte, including commas inside URL-prefix
 * properties.
 */
function parseSetupSitesList(data) {
    const parsed = (0, auth_provider_js_1.parseSitesListBody)(data);
    const siteEntries = parsed.entries
        .filter((entry) => entry.siteUrl.length > 0)
        .map((entry) => ({
        siteUrl: entry.siteUrl,
        ...(entry.permissionLevel.length > 0 ? { permissionLevel: entry.permissionLevel } : {}),
    }));
    return { fetched: siteEntries.map((entry) => entry.siteUrl), siteEntries };
}
const INTERACTIVE_CLIENT_ORDER = ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"];
/**
 * Display labels for the interactive client list. Internal flag values
 * stay exact (`desktop`, `code`, ...); only the shown label carries the
 * product form. Product names are identical in both locales; only the
 * print-only entry is localized (`JSON output` / `Formato JSON`).
 */
function clientDisplayLabels(locale) {
    return {
        desktop: "Claude Desktop (app)",
        code: "Claude Code (terminal)",
        cursor: "Cursor (editor)",
        codex: "Codex (terminal)",
        opencode: "OpenCode",
        pi: "Pi (OhMyPi)",
        print: (0, i18n_js_1.translateSetup)(locale, "clientPrintLabel"),
        generic: (0, i18n_js_1.translateSetup)(locale, "clientPrintLabel"),
    };
}
/**
 * Best-effort locale for argument-parse failures: an explicit `--language
 * en|es` token on the command line wins when present and valid; otherwise
 * the T01 environment/Intl resolution applies. Never echoes input and never
 * throws: an unreadable value falls back to English.
 */
function localeForParseError(argv) {
    const flag = argv.indexOf("--language");
    if (flag !== -1) {
        const value = argv[flag + 1];
        if (value === "en" || value === "es")
            return value;
    }
    return (0, i18n_js_1.resolveSetupLocale)(undefined);
}
async function resolveClients(rawClients, prompter, locale = "en") {
    if (rawClients.length > 0) {
        return (0, clients_js_1.validateClientTargets)((0, clients_js_1.parseClientFlags)(rawClients));
    }
    console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "clientTitle")}`);
    const labels = clientDisplayLabels(locale);
    INTERACTIVE_CLIENT_ORDER.forEach((name, i) => console.log(`  [${i + 1}] ${labels[name] ?? name}`));
    const answer = await prompter.text((0, i18n_js_1.translateSetup)(locale, "clientPrompt"), "");
    return (0, clients_js_1.parseClientSelectionAnswer)(answer, INTERACTIVE_CLIENT_ORDER, 0);
}
function buildEnv(opts) {
    const scopes = opts.access ?? opts.scopes;
    const write = opts.access === undefined ? opts.write : opts.access === "full";
    if (opts.mode === "shared" && (scopes !== "readonly" || write)) {
        throw new Error(`Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}.`);
    }
    if (write && scopes !== "full") {
        throw new Error("Write enablement requires full access.");
    }
    const env = {
        GSC_AUTH_MODE: opts.mode === "service-account" ? "service_account" : "oauth",
    };
    if (opts.access !== undefined)
        env.GSC_ACCESS_MODE = opts.access;
    else
        env.GSC_SCOPES = opts.scopes;
    const allSites = opts.allSites ?? false;
    let sites;
    if (opts.sites !== undefined) {
        sites = [...opts.sites];
    }
    else if (opts.site !== undefined) {
        sites = [opts.site];
    }
    else if (allSites) {
        sites = [];
    }
    else {
        throw new Error("A dashboard property is required");
    }
    if (allSites && sites.length > 0) {
        throw new Error("Use either repeatable --site or --all-sites, not both.");
    }
    if (allSites && sites.length === 0) {
        // Explicit all-properties preview without network enumeration (dry-run):
        // omit the allowlist key and let the caller explain that the live run
        // stores the exact discovered identifiers.
    }
    else {
        const validated = (0, properties_js_1.validateAllowlist)(sites);
        // New setup persists a JSON string array: URL-prefix identifiers may
        // contain commas, so comma joining would corrupt the allowlist.
        // The legacy single-site caller keeps its historic raw-string form.
        // The allow-all sentinel stays exactly `["all"]` (validated is
        // `["all"]` canonical); it is never expanded into enumerated
        // identifiers so future properties stay covered.
        env.GSC_SITE_URLS = opts.sites !== undefined ? JSON.stringify(validated) : validated.join(",");
    }
    if (opts.access === undefined && opts.write)
        env.GSC_ENABLE_WRITE = "1";
    if (opts.keyFile)
        env.GSC_KEY_FILE = opts.keyFile;
    if (opts.secretsPath) {
        env.GSC_OAUTH_SECRETS_FILE = opts.secretsPath;
    }
    // With the embedded client, no credential env vars are needed at all.
    return env;
}
/**
 * Build the locale-specific first-install helper copy from the setup
 * translation catalog. The returned templates keep every machine value
 * (`{path}`, `{server}`, `{dir}`, `{backup}`, `{command}`, `{program}`,
 * `{steps}`) as placeholders the helpers substitute exactly; only the
 * surrounding human-facing copy is localized. Structured
 * `TargetOutcome` notes stay English and are never built here.
 */
function clientConfigTextForLocale(locale) {
    return {
        configFile: (0, i18n_js_1.translateSetup)(locale, "fileConfigFile"),
        previewExisting: (0, i18n_js_1.translateSetup)(locale, "filePreviewExisting"),
        previewNew: (0, i18n_js_1.translateSetup)(locale, "filePreviewNew"),
        noExistingEntry: (0, i18n_js_1.translateSetup)(locale, "fileNoExisting"),
        unreadableEntry: (0, i18n_js_1.translateSetup)(locale, "fileUnreadable"),
        dryRunNote: (0, i18n_js_1.translateSetup)(locale, "fileDryRun"),
        confirmOverwrite: (0, i18n_js_1.translateSetup)(locale, "fileConfirmOverwrite"),
        confirmNew: (0, i18n_js_1.translateSetup)(locale, "fileConfirmNew"),
        skipped: (0, i18n_js_1.translateSetup)(locale, "fileSkipped"),
        backup: (0, i18n_js_1.translateSetup)(locale, "fileBackup"),
        couldNotRead: (0, i18n_js_1.translateSetup)(locale, "fileCouldNotRead"),
        invalidJson: (0, i18n_js_1.translateSetup)(locale, "fileInvalidJson"),
        backupFailed: (0, i18n_js_1.translateSetup)(locale, "fileBackupFailed"),
        mkdirFailed: (0, i18n_js_1.translateSetup)(locale, "fileMkdirFailed"),
        stageFailedExisting: (0, i18n_js_1.translateSetup)(locale, "fileStageFailedExisting"),
        stageFailedNew: (0, i18n_js_1.translateSetup)(locale, "fileStageFailedNew"),
        replaceFailedExisting: (0, i18n_js_1.translateSetup)(locale, "fileReplaceFailedExisting"),
        replaceFailedNew: (0, i18n_js_1.translateSetup)(locale, "fileReplaceFailedNew"),
        mergeInvalidRoot: (0, i18n_js_1.translateSetup)(locale, "fileMergeInvalidRoot"),
        mergeInvalidServers: (0, i18n_js_1.translateSetup)(locale, "fileMergeInvalidServers"),
        mergeInvalidMcp: (0, i18n_js_1.translateSetup)(locale, "fileMergeInvalidMcp"),
        configured: (0, i18n_js_1.translateSetup)(locale, "fileConfigured"),
        cliDryRunPreview: (0, i18n_js_1.translateSetup)(locale, "cliDryRunPreview"),
        cliDryRunNote: (0, i18n_js_1.translateSetup)(locale, "cliDryRunNote"),
        cliConfirm: (0, i18n_js_1.translateSetup)(locale, "cliConfirm"),
        cliSkipped: (0, i18n_js_1.translateSetup)(locale, "cliSkipped"),
        cliLaunchFailed: (0, i18n_js_1.translateSetup)(locale, "cliLaunchFailed"),
        cliNotFound: (0, i18n_js_1.translateSetup)(locale, "cliNotFound"),
        cliAddFailed: (0, i18n_js_1.translateSetup)(locale, "cliAddFailed"),
        cliConfigured: (0, i18n_js_1.translateSetup)(locale, "cliConfigured"),
    };
}
/**
 * Confirmation wrapper that records whether the user declined. The file/CLI
 * helpers report decline and failure with the same boolean, so the wrapper
 * tracks the decline signal itself: declined is true only when a prompt was
 * actually asked and not affirmatively answered. Affirmatives go through
 * the locale-aware setup boundary (`isSetupAffirmative`: English `y`/`yes`,
 * Spanish additionally `s`/`si`/`sí`, default-no otherwise) and are
 * normalized to the helpers' canonical `"y"` signal before forwarding,
 * so helpers keep their exact confirmation contract in every locale.
 * Dry-run and --yes/--force paths never ask, so a false result there is
 * always a failure, never a decline.
 */
function trackConfirm(prompter, locale = "en") {
    let declined = false;
    return {
        confirm: async (question) => {
            const answer = await prompter.text(question, "n");
            if (!(0, i18n_js_1.isSetupAffirmative)(answer, locale)) {
                declined = true;
                return answer;
            }
            return "y";
        },
        declined: () => declined,
    };
}
/**
 * Apply one setup entry to every requested target and report a structured
 * per-target outcome: applied (written/invoked), printed (manual fallback
 * or print-only target, nothing installed), previewed (dry-run, nothing
 * configured), skipped (declined or failed file write, nothing changed),
 * or failed (failed CLI invocation with a printed manual fallback).
 * Requested targets are never reported as configured unless applied.
 */
async function applyTargets(targets, env, prompter, opts, deps = {}) {
    const entry = (0, client_config_js_1.buildSetupEntry)(env);
    const locale = opts.locale ?? "en";
    const verbose = opts.verbose ?? true;
    const text = clientConfigTextForLocale(locale);
    const log = (message) => {
        console.log(message);
    };
    const resolvePath = deps.resolveFileConfigPath ?? client_config_js_1.resolveFileConfigPath;
    if (targets.length === 1 && (targets[0] === "print" || targets[0] === "generic")) {
        console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "targetPrintHeading")}`);
        console.log((0, client_config_js_1.buildSetupPrintJson)(entry));
        return {
            ok: true,
            outcomes: [{ target: targets[0], status: "printed", note: "generic JSON printed; configure the client manually" }],
        };
    }
    const outcomes = [];
    let ok = true;
    for (const target of targets) {
        if (target === "desktop" || target === "cursor" || target === "opencode" || target === "pi") {
            const configPath = resolvePath(target);
            if (!configPath) {
                console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "targetConfigUnavailable", { target })}`);
                console.log((0, client_config_js_1.buildSetupPrintJson)(entry));
                outcomes.push({ target, status: "printed", note: "config path unavailable on this machine; generic JSON printed" });
                continue;
            }
            const tracker = trackConfirm(prompter, locale);
            const isOpencode = target === "opencode";
            const applied = await (0, client_config_js_1.applyFileConfig)({
                configPath,
                serverName: client_config_js_1.SETUP_SERVER_NAME,
                entry: isOpencode ? (0, client_config_js_1.buildOpencodeEntry)(env) : entry,
                force: opts.force,
                yes: opts.yes,
                dryRun: opts.dryRun,
                confirm: tracker.confirm,
                log,
                text,
                ...(isOpencode ? { mergeKey: "mcp" } : {}),
                verbose,
            });
            if (applied && opts.dryRun) {
                outcomes.push({ target, status: "previewed", note: "preview only; no file written" });
            }
            else if (applied) {
                if (verbose) {
                    if (target === "desktop")
                        console.log((0, i18n_js_1.translateSetup)(locale, "targetRestartDesktop"));
                    if (target === "cursor")
                        console.log((0, i18n_js_1.translateSetup)(locale, "targetRestartCursor"));
                    if (target === "opencode")
                        console.log((0, i18n_js_1.translateSetup)(locale, "targetRestartOpencode"));
                    if (target === "pi")
                        console.log((0, i18n_js_1.translateSetup)(locale, "targetRestartPi"));
                }
                outcomes.push({ target, status: "applied" });
            }
            else if (tracker.declined()) {
                outcomes.push({ target, status: "skipped", note: "confirmation declined; nothing was changed" });
                ok = false;
            }
            else {
                outcomes.push({ target, status: "failed", note: "helper reported failure; nothing was changed" });
                ok = false;
            }
        }
        else if (target === "code" || target === "codex") {
            const program = target === "code" ? "claude" : "codex";
            const args = target === "code" ? (0, client_config_js_1.buildClaudeCodeArgs)(env) : (0, client_config_js_1.buildCodexArgs)(env);
            const removeArgs = target === "code" ? (0, client_config_js_1.claudeCodeRemoveArgs)() : (0, client_config_js_1.codexRemoveArgs)();
            const tracker = trackConfirm(prompter, locale);
            const applied = await (0, client_config_js_1.applyCliConfig)({
                program,
                args,
                removeArgs,
                force: opts.force,
                yes: opts.yes,
                dryRun: opts.dryRun,
                confirm: tracker.confirm,
                log,
                text,
                verbose,
                ...(deps.runner !== undefined ? { runner: deps.runner } : {}),
            });
            if (applied && opts.dryRun) {
                outcomes.push({ target, status: "previewed", note: "preview only; nothing invoked" });
            }
            else if (applied) {
                outcomes.push({ target, status: "applied" });
            }
            else if (tracker.declined()) {
                outcomes.push({ target, status: "skipped", note: "confirmation declined; nothing was invoked" });
                ok = false;
            }
            else {
                console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "targetCliFallbackHeading")}`);
                console.log((0, client_config_js_1.buildSetupPrintJson)(entry));
                console.log((0, i18n_js_1.translateSetup)(locale, "targetManualCommand", { command: (0, client_config_js_1.formatPreviewCommand)(program, args) }));
                outcomes.push({ target, status: "failed", note: "CLI invocation failed; manual fallback printed, no write performed" });
                ok = false;
            }
        }
        else {
            console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "targetPrintHeading")}`);
            console.log((0, client_config_js_1.buildSetupPrintJson)(entry));
            outcomes.push({ target, status: "printed", note: "generic JSON printed; configure the client manually" });
        }
    }
    return { ok, outcomes };
}
async function runSetup(argv, deps = {}) {
    // Visible write-toggle subcommands share the setup entrypoint but never
    // sign in to Google. Dispatch before main flag parsing (which would
    // reject the subcommand token as an unknown option).
    if (argv[0] === "access") {
        return runAccessCommand(argv.slice(1), { ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}) });
    }
    if (argv[0] === "enable-write") {
        return runEnableWriteCommand(argv.slice(1), { ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}) });
    }
    if (argv[0] === "disable-write") {
        return runDisableWriteCommand(argv.slice(1), { ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}) });
    }
    let opts;
    try {
        opts = parseArgs(argv);
    }
    catch (err) {
        // All parse errors are controlled statics; route through the same
        // sanitizer so no future echo can slip past this boundary. The locale
        // is best-effort here: an explicit --language token wins when valid,
        // otherwise the T01 environment/Intl resolution applies.
        console.error(sanitizeSetupFailure(err, localeForParseError(argv)).trimStart());
        return 1;
    }
    // One locale for the whole core journey: explicit --language first,
    // otherwise the T01 environment/Intl precedence. Help keeps its T01
    // behavior through the same resolution.
    const locale = (0, i18n_js_1.resolveSetupLocale)(opts.language);
    if (opts.help) {
        console.log((0, i18n_js_1.getSetupUsage)(locale, opts.verbose));
        return 0;
    }
    const verbose = opts.verbose === true;
    console.log((0, i18n_js_1.translateSetup)(locale, "welcomeTitle"));
    if (verbose)
        console.log(`${(0, i18n_js_1.translateSetup)(locale, "welcomeSubtitle")}\n`);
    const prompter = (0, flow_js_1.terminalPromptAdapter)(opts.yes);
    try {
        console.log((0, i18n_js_1.translateSetup)(locale, "stageAuth"));
        // Explicit deprecated inputs retain their historical independent controls.
        const legacyAccess = opts.access === null && (opts.scopes !== null || opts.enableWrite);
        const decision = await (0, auth_js_1.decideAuth)(prompter, opts.auth ?? (opts.keyFile ? "service-account" : opts.secrets ? "custom" : null), opts.scopes, opts.enableWrite, legacyAccess ? undefined : opts.access, locale);
        if (opts.secrets && decision.mode !== "custom" || opts.keyFile && decision.mode !== "service-account") {
            throw new Error("Credential path does not match the selected authentication mode.");
        }
        if (decision.mode === "shared" && !(0, embedded_client_js_1.embeddedClientAvailable)() && !opts.dryRun) {
            throw new Error("Quick Connect is unavailable in this build. Choose --auth custom with --secrets instead.");
        }
        // 2. Credentials
        let secretsPath = null;
        let keyFile = null;
        if (decision.mode === "service-account") {
            const input = opts.keyFile ?? await prompter.text((0, i18n_js_1.translateSetup)(locale, "keyFilePrompt"), "");
            if (!input)
                throw new Error("Service Account requires --key-file.");
            keyFile = path.resolve(input.replace(/^~\//, os.homedir() + "/"));
            (0, auth_js_1.validateCredentialFile)(keyFile, "service-account");
        }
        else if (decision.mode === "custom" && opts.secrets) {
            secretsPath = path.resolve(opts.secrets);
            if (!fs.existsSync(secretsPath)) {
                // No path echo: credential paths stay out of diagnostics.
                console.error((0, i18n_js_1.translateSetup)(locale, "secretsNotFoundFlag"));
                return 1;
            }
        }
        else if (decision.mode === "custom" && process.env.GSC_OAUTH_SECRETS_FILE && fs.existsSync(process.env.GSC_OAUTH_SECRETS_FILE)) {
            secretsPath = path.resolve(process.env.GSC_OAUTH_SECRETS_FILE);
            if (verbose)
                console.log((0, i18n_js_1.translateSetup)(locale, "usingOAuthClient", { path: secretsPath }));
        }
        else if (decision.mode === "shared") {
            if (verbose)
                console.log((0, i18n_js_1.translateSetup)(locale, "authSharedNote"));
        }
        else if (decision.mode === "custom" && !opts.dryRun) {
            console.log((0, i18n_js_1.translateSetup)(locale, "customGuideTitle"));
            console.log((0, i18n_js_1.translateSetup)(locale, "customGuideStep1"));
            console.log((0, i18n_js_1.translateSetup)(locale, "customGuideStep2"));
            console.log((0, i18n_js_1.translateSetup)(locale, "customGuideStep3"));
            console.log(`${(0, i18n_js_1.translateSetup)(locale, "customWalkthrough", { url: "docs/quickstart.md (custom OAuth client section)" })}\n`);
            const p = await prompter.text((0, i18n_js_1.translateSetup)(locale, "clientSecretsPrompt"), "");
            if (!p) {
                console.error((0, i18n_js_1.translateSetup)(locale, "noCredentials"));
                return 1;
            }
            secretsPath = path.resolve(p.replace(/^~\//, os.homedir() + "/"));
            if (!fs.existsSync(secretsPath)) {
                // No path echo: credential paths stay out of diagnostics.
                console.error((0, i18n_js_1.translateSetup)(locale, "secretsNotFoundPath"));
                return 1;
            }
        }
        if (decision.mode === "custom" && secretsPath)
            (0, auth_js_1.validateCredentialFile)(secretsPath, "custom");
        const scopes = decision.scope;
        // `full` is explained only where chosen: the recommended readonly path
        // stays first and quiet, matching the access prompt disclosure order.
        // Quiet runs suppress the scope echo; verbose keeps the historical line.
        if (verbose)
            console.log(scopes === "readonly"
                ? (0, i18n_js_1.translateSetup)(locale, "scopeReadonly")
                : (0, i18n_js_1.translateSetup)(locale, "scopeFull"));
        // 3. Exact property allowlist after one sites.list (or dry-run preview).
        // Each explicit --site flag is one identifier boundary; conflict with
        // --all-sites is decided on the explicit flags before any parsing.
        console.log((0, i18n_js_1.translateSetup)(locale, "stageProperties"));
        if (opts.allSites && opts.sites.length > 0) {
            throw new Error("Use either repeatable --site or --all-sites, not both.");
        }
        const requestedSites = (0, properties_js_1.parseSiteFlags)(opts.sites);
        let allowlist;
        let allSitesPreview = false;
        // Reused by the finish stage: the single sites.list result is kept here
        // so verification never makes a second Google call.
        let siteEntries = [];
        let searchConsole = null;
        if (!opts.dryRun) {
            // Authentication must use the selected policy, never conflicting ambient keys.
            if (legacyAccess) {
                delete process.env.GSC_ACCESS_MODE;
                process.env.GSC_SCOPES = scopes;
                if (decision.write)
                    process.env.GSC_ENABLE_WRITE = "1";
                else
                    delete process.env.GSC_ENABLE_WRITE;
            }
            else {
                process.env.GSC_ACCESS_MODE = scopes;
                delete process.env.GSC_SCOPES;
                delete process.env.GSC_ENABLE_WRITE;
            }
            process.env.GSC_AUTH_MODE = decision.mode === "service-account" ? "service_account" : "oauth";
            if (secretsPath)
                process.env.GSC_OAUTH_SECRETS_FILE = secretsPath;
            if (keyFile)
                process.env.GSC_KEY_FILE = keyFile;
            if (decision.mode === "shared") {
                delete process.env.GSC_OAUTH_SECRETS_FILE;
                delete process.env.GSC_OAUTH_CLIENT_ID;
                delete process.env.GSC_OAUTH_CLIENT_SECRET;
            }
            if (opts.reauth && decision.mode !== "service-account")
                (0, oauth_js_1.clearCachedToken)();
            const { google } = await import("googleapis");
            const auth = decision.mode === "service-account"
                ? new google.auth.GoogleAuth({ keyFile: keyFile, scopes: (0, oauth_js_1.scopesForTier)(scopes) })
                : await (0, oauth_js_1.authenticateWithOAuth)();
            const sc = google.searchconsole({ version: "v1", auth });
            searchConsole = sc;
            // One sites.list call only: the raw response is validated by the
            // shared shape gate (malformed members fail here, before client
            // configuration and before an explicit --site can bypass them).
            const rawData = deps.listSitesRaw ? await deps.listSitesRaw() : (await sc.sites.list({})).data;
            const parsedSites = parseSetupSitesList(rawData);
            const fetched = parsedSites.fetched;
            siteEntries = parsedSites.siteEntries;
            if (verbose)
                console.log(fetched.length === 1
                    ? `\n${(0, i18n_js_1.translateSetup)(locale, "connectedOne")}`
                    : `\n${(0, i18n_js_1.translateSetup)(locale, "connectedMany", { count: fetched.length })}`);
            if (opts.allSites) {
                if (fetched.length === 0) {
                    throw new Error("No properties found on this account; --all-sites has nothing to select. Pass --site explicitly once access exists.");
                }
                // Validate every returned siteUrl with the shared predicate before
                // persisting: an unexpected malformed identifier fails closed here.
                allowlist = (0, properties_js_1.validateAllowlist)(fetched);
                if (verbose)
                    console.log((0, i18n_js_1.translateSetup)(locale, "selectedAllCount", { count: allowlist.length }));
            }
            else if (requestedSites.length > 0) {
                if ((0, profiles_js_1.isAllowAllAllowlist)(requestedSites)) {
                    console.log((0, i18n_js_1.translateSetup)(locale, "allowAllWarning"));
                    if (verbose)
                        console.log((0, i18n_js_1.translateSetup)(locale, "allowAllSelected"));
                    allowlist = ["all"];
                }
                else {
                    for (const site of requestedSites) {
                        if (!fetched.includes(site)) {
                            console.log((0, i18n_js_1.translateSetup)(locale, "unlistedWarning", { site, count: fetched.length }));
                        }
                    }
                    allowlist = (0, properties_js_1.validateAllowlist)(requestedSites);
                }
            }
            else if (fetched.length === 0) {
                console.log((0, i18n_js_1.translateSetup)(locale, "noPropertiesManual"));
                const manual = await prompter.text((0, i18n_js_1.translateSetup)(locale, "manualPropertyPrompt"), "");
                if (!manual.trim()) {
                    console.error((0, i18n_js_1.translateSetup)(locale, "manualPropertyRequired"));
                    return 1;
                }
                if ((0, profiles_js_1.isAllowAllAllowlist)([manual.trim()])) {
                    console.log((0, i18n_js_1.translateSetup)(locale, "allowAllWarning"));
                    const confirm = await prompter.text((0, i18n_js_1.translateSetup)(locale, "allowAllConfirm"), "n");
                    if (!(0, i18n_js_1.isSetupAffirmative)(confirm, locale)) {
                        console.error((0, i18n_js_1.translateSetup)(locale, "allowAllNotConfirmed"));
                        return 1;
                    }
                    allowlist = ["all"];
                    if (verbose)
                        console.log((0, i18n_js_1.translateSetup)(locale, "allowAllSelected"));
                }
                else {
                    allowlist = (0, properties_js_1.validateAllowlist)([manual.trim()]);
                }
            }
            else if (fetched.length === 1) {
                allowlist = [fetched[0]];
                if (verbose)
                    console.log((0, i18n_js_1.translateSetup)(locale, "singleProperty", { site: allowlist[0] }));
            }
            else {
                fetched.forEach((site, i) => {
                    const permission = siteEntries[i]?.permissionLevel ? `  (${siteEntries[i].permissionLevel})` : "";
                    console.log(`  [${i + 1}] ${site}${permission}`);
                });
                console.log(`  [0] ${(0, i18n_js_1.translateSetup)(locale, "propertyAllOption")}`);
                const answer = await prompter.text((0, i18n_js_1.translateSetup)(locale, "propertySelect", { count: fetched.length }), "");
                if ((0, properties_js_1.isAllowAllFutureAnswer)(answer)) {
                    console.log((0, i18n_js_1.translateSetup)(locale, "allowAllWarning"));
                    const confirm = await prompter.text((0, i18n_js_1.translateSetup)(locale, "allowAllConfirm"), "n");
                    if (!(0, i18n_js_1.isSetupAffirmative)(confirm, locale)) {
                        console.error((0, i18n_js_1.translateSetup)(locale, "allowAllNotConfirmed"));
                        return 1;
                    }
                    allowlist = ["all"];
                    if (verbose)
                        console.log((0, i18n_js_1.translateSetup)(locale, "allowAllSelected"));
                }
                else {
                    allowlist = (0, properties_js_1.parsePropertySelectionAnswer)(answer, fetched, 0);
                    if (verbose)
                        console.log(allowlist.length === 1
                            ? (0, i18n_js_1.translateSetup)(locale, "selectedCountOne", { sites: allowlist.join(", ") })
                            : (0, i18n_js_1.translateSetup)(locale, "selectedCountMany", { count: allowlist.length, sites: allowlist.join(", ") }));
                }
            }
        }
        else if (opts.allSites) {
            allowlist = [];
            allSitesPreview = true;
            console.log((0, i18n_js_1.translateSetup)(locale, "allSitesPreview"));
        }
        else if (requestedSites.length > 0) {
            allowlist = (0, properties_js_1.validateAllowlist)(requestedSites);
        }
        else {
            allowlist = ["sc-domain:yoursite.com"];
        }
        // 4. Choose where to install (multiple targets where safe)
        console.log((0, i18n_js_1.translateSetup)(locale, "stageClients"));
        const targets = await resolveClients(opts.clients, prompter, locale);
        const env = buildEnv({
            ...(!legacyAccess ? { access: scopes } : {}),
            scopes,
            sites: allowlist,
            allSites: allSitesPreview,
            secretsPath,
            keyFile,
            mode: decision.mode,
            write: decision.write,
        });
        const appliedTargets = await applyTargets(targets, env, prompter, {
            force: opts.force,
            yes: opts.yes,
            dryRun: opts.dryRun,
            locale,
            verbose,
        }, {
            ...(deps.resolveFileConfigPath !== undefined ? { resolveFileConfigPath: deps.resolveFileConfigPath } : {}),
        });
        const ok = appliedTargets.ok;
        // Optional agent-skill installation through the pinned official Skills
        // CLI. Strictly opt-in: an explicit --install-skill flag installs every
        // derived agent without asking, or a separate interactive numbered list.
        // --yes alone never enables it, and selecting nothing (the empty
        // default, least privilege) skips it. --dry-run only previews the exact
        // argv without invoking anything. Compatible setup targets map to
        // global agents (code->claude-code, cursor->cursor, codex->codex);
        // opencode/pi/desktop/generic/print select no skill and fail nothing.
        // A skill failure exits nonzero below without touching the MCP config
        // applied above.
        const finishLog = (message) => {
            console.error(message);
        };
        const skillAgents = (0, skill_install_js_1.skillAgentsForTargets)(targets);
        let selectedSkillAgents = [];
        let skillConfirmed = false;
        if (opts.installSkill) {
            skillConfirmed = true;
            selectedSkillAgents = skillAgents;
        }
        else if (opts.yes || prompter.interactive !== true) {
            // --yes and non-TTY runs never show the screen: same skipped note.
            if (verbose)
                finishLog((0, i18n_js_1.translateSetup)(locale, "skillSkippedFlag"));
        }
        else if (skillAgents.length === 0) {
            // No compatible agent: the current unsupported note, no screen.
            finishLog((0, i18n_js_1.translateSetup)(locale, "skillUnsupported"));
        }
        else {
            console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "skillListTitle")}`);
            console.log(`  [1] ${(0, i18n_js_1.translateSetup)(locale, "skillListAll")}`);
            skillAgents.forEach((agent, i) => console.log(`  [${i + 2}] ${(0, skill_install_js_1.skillAgentDisplayName)(agent, locale)}`));
            console.log(`  [0] ${(0, i18n_js_1.translateSetup)(locale, "skillListSkip")}`);
            const answer = await prompter.text((0, i18n_js_1.translateSetup)(locale, "skillListPrompt"), "");
            try {
                selectedSkillAgents = (0, skill_install_js_1.parseSkillSelectionAnswer)(answer, skillAgents);
            }
            catch {
                // Controlled rejection: static copy, the answer is never echoed.
                console.error((0, i18n_js_1.translateSetup)(locale, "skillInvalidSelection"));
                return 1;
            }
            skillConfirmed = selectedSkillAgents.length > 0;
            if (!skillConfirmed && verbose)
                finishLog((0, i18n_js_1.translateSetup)(locale, "skillSkipped"));
        }
        let skillOutcome = null;
        let skillOk = true;
        if (skillConfirmed) {
            const skillsDir = deps.skillsDir ?? (0, skill_install_js_1.defaultPackageSkillsDir)();
            const installed = await (0, skill_install_js_1.installSkill)({
                skillsDir,
                agents: selectedSkillAgents,
                dryRun: opts.dryRun,
                log: finishLog,
                locale,
                ...(deps.skillRunner !== undefined ? { runner: deps.skillRunner } : {}),
            });
            skillOutcome = { status: installed.status, detail: installed.detail };
            if (installed.status === "failed") {
                skillOk = false;
                finishLog((0, i18n_js_1.translateSetup)(locale, "skillFailed"));
            }
        }
        // Bounded finish stage after client configuration. The API section
        // reuses the single sites.list result kept above; no second Google call
        // is made here. Diagnostics render even when configuration failed, with
        // truthful failed/skipped targets instead of a success claim. Human
        // diagnostics go to stderr so stdout keeps the machine-readable
        // contract: for print targets the generic JSON block stays the last
        // structured stdout content (T03).
        {
            const authLabel = decision.mode === "service-account"
                ? "service_account"
                : decision.mode === "shared"
                    ? "oauth (Quick Connect)"
                    : "oauth (custom client)";
            const report = (0, finish_js_1.buildFinishReport)({
                authMode: authLabel,
                scope: scopes,
                writeEnabled: decision.write,
                ...(!legacyAccess ? { accessMode: scopes } : {}),
                allowlist,
                clientOutcomes: appliedTargets.outcomes,
                siteEntries: opts.dryRun ? [] : siteEntries,
                dryRun: opts.dryRun,
                ...(skillOutcome !== null ? { skill: skillOutcome } : {}),
                locale,
            });
            if (verbose) {
                finishLog("");
                for (const line of (0, finish_js_1.formatFinishReport)(report, { configFailed: !ok, locale }))
                    finishLog(line);
            }
            else {
                // Quiet: one result line (header plus the client-target summary)
                // instead of the full 7-section verification. Failures stay
                // truthful: a failed configuration keeps its failed header.
                const header = opts.dryRun
                    ? (!ok ? (0, i18n_js_1.translateSetup)(locale, "finishHeaderDryRunFailed") : (0, i18n_js_1.translateSetup)(locale, "finishHeaderDryRun"))
                    : (!ok ? (0, i18n_js_1.translateSetup)(locale, "finishHeaderFailed") : (0, i18n_js_1.translateSetup)(locale, "finishHeader"));
                const clients = report.sections.find((s) => s.id === "clients");
                finishLog(clients !== undefined ? `${header} ${clients.detail}` : header);
            }
        }
        // One minimal sample query, strictly opt-in: an explicit --first-query
        // flag, or a separate interactive confirmation. --yes alone never
        // enables it, and --dry-run never calls Google. Allow-all (`all`) skips
        // the sample query: it names no single property to query.
        if (!opts.dryRun && ok && allowlist.length > 0 && searchConsole !== null && (0, profiles_js_1.isAllowAllAllowlist)(allowlist)) {
            if (verbose)
                finishLog((0, i18n_js_1.translateSetup)(locale, "sampleAllowAllSkip"));
        }
        if (!opts.dryRun && ok && allowlist.length > 0 && searchConsole !== null && !(0, profiles_js_1.isAllowAllAllowlist)(allowlist)) {
            const siteUrl = allowlist[0];
            const window = (0, finish_js_1.sampleWindow)();
            let confirmed = opts.firstQuery;
            if (!confirmed) {
                if (opts.yes) {
                    if (verbose)
                        finishLog((0, i18n_js_1.translateSetup)(locale, "sampleSkippedFlag"));
                }
                else {
                    const answer = await prompter.text((0, i18n_js_1.translateSetup)(locale, "sampleConfirm", { site: siteUrl, start: window.startDate, end: window.endDate }), "n");
                    confirmed = (0, finish_js_1.parseFirstQueryAnswer)(answer, locale);
                    if (!confirmed && verbose)
                        finishLog((0, i18n_js_1.translateSetup)(locale, "sampleSkipped"));
                }
            }
            if (confirmed) {
                const client = searchConsole;
                const outcome = await (0, finish_js_1.runSampleQuery)(siteUrl, window, async (site, win) => {
                    const resp = await client.searchanalytics.query({
                        siteUrl: site,
                        requestBody: {
                            startDate: win.startDate,
                            endDate: win.endDate,
                            dimensions: [...finish_js_1.SAMPLE_QUERY_DIMENSIONS],
                            searchType: "web",
                            dataState: "final",
                            rowLimit: finish_js_1.SAMPLE_QUERY_ROW_LIMIT,
                        },
                    });
                    const rows = (resp.data.rows ?? []).map((row) => ({
                        keys: row.keys ?? [],
                        clicks: row.clicks ?? 0,
                        impressions: row.impressions ?? 0,
                    }));
                    return { rows };
                }, locale);
                finishLog((0, i18n_js_1.translateSetup)(locale, "sampleResult", { status: outcome.status, detail: outcome.detail }));
            }
        }
        else if (opts.dryRun && ok) {
            if (opts.firstQuery || verbose)
                finishLog(opts.firstQuery
                    ? (0, i18n_js_1.translateSetup)(locale, "sampleDryRunFlag")
                    : (0, i18n_js_1.translateSetup)(locale, "sampleDryRunSkip"));
        }
        if (!opts.dryRun && ok && skillOk) {
            console.log(`\n${(0, i18n_js_1.translateSetup)(locale, "finishDone")}`);
            if (verbose) {
                console.log((0, i18n_js_1.translateSetup)(locale, "finishToken", { path: (0, oauth_js_1.cachedTokenPath)() }));
                console.log((0, i18n_js_1.translateSetup)(locale, "finishRevoke"));
                console.log((0, i18n_js_1.translateSetup)(locale, "finishReauth"));
            }
        }
        return ok && skillOk ? 0 : 1;
    }
    catch (err) {
        console.error(sanitizeSetupFailure(err, locale));
        return 1;
    }
    finally {
        prompter.close();
    }
}
// ---------------------------------------------------------------------------
// `setup enable-write` / `setup disable-write`: visible write-toggle UX.
//
// Today GSC_ENABLE_WRITE=1 is a hidden env var. These subcommands add or
// remove it in the gsc server env of an MCP client config, reusing the
// safe client-config machinery (redacted preview, unrelated settings
// preserved, timestamped backup, atomic replace, --dry-run, --yes).
// No Google calls, no tokens, no network: only local config files are
// read or written, and secrets are never printed.
// ---------------------------------------------------------------------------
exports.WRITE_TOGGLE_USAGE = `
Usage: gsc setup enable-write [options]
       gsc setup disable-write [options]

Visible opt-in for Google write operations. Adds (enable-write) or removes
(disable-write) GSC_ENABLE_WRITE in the gsc server env of an MCP client
config. File targets (desktop, cursor, opencode, pi) are edited in place;
CLI-managed targets (code, codex) print guided manual steps and are never
mutated automatically; print/generic only print a merge fragment.

enable-write warns first: writes make REAL changes in Google (Indexing API
URL notifications, sitemap submissions), quota is limited (200 URL
notifications/day), and only allowlisted properties can be submitted to.
It requires explicit confirmation (or --yes) and refuses Quick Connect
(shared) installs, which are readonly-only: migrate with --auth custom or
--auth service-account first, then re-run.

Options:
  --client <target>   desktop, cursor, opencode, pi, code, codex (repeatable or
                      comma-separated; both = desktop + code).
                      Default: the detected file config (desktop, cursor, opencode, pi).
  --dry-run           Preview without writing anything
  --yes               Accept the confirmation without prompting
  --force             Same as --yes for these subcommands
  --help              Show this help

Both subcommands print how to verify (restart the client, then gsc
doctor) and never print secrets.
`.trim();
exports.ACCESS_USAGE = `
Usage: gsc setup access readonly|full [--client <target>] [--dry-run] [--yes] [--force]

Set GSC_ACCESS_MODE and remove legacy GSC_SCOPES/GSC_ENABLE_WRITE only from the
selected gsc entry. Full enables Google submissions; Quick Connect is readonly-only.
File targets desktop/cursor/opencode/pi use redacted preview, confirmation,
backup and atomic replacement. Code/codex and print/generic receive manual guidance only.
Restart the client afterward. Changing access can require gsc auth login;
this command never authenticates, invokes a client CLI, or contacts Google.
`.trim();
function parseWriteToggleArgs(argv, command) {
    const opts = { clients: [], force: false, dryRun: false, yes: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--client") {
            const v = needValue("--client", argv[++i]);
            for (const part of v.split(",")) {
                const name = part.trim().toLowerCase();
                if (!KNOWN_CLIENTS.has(name)) {
                    // No input echo: the rejected value may hold sensitive text.
                    throw new Error("Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print, or both (repeatable).");
                }
                opts.clients.push(name);
            }
        }
        else if (a === "--force") {
            opts.force = true;
        }
        else if (a === "--dry-run") {
            opts.dryRun = true;
        }
        else if (a === "--yes" || a === "-y") {
            opts.yes = true;
        }
        else if (a === "--help" || a === "-h") {
            opts.help = true;
        }
        else {
            // No input echo: the unknown token may hold sensitive text.
            throw new Error(`Unknown ${command} option. Run setup ${command} --help for usage.`);
        }
    }
    return opts;
}
/**
 * Classify the installed instance by its effective auth signals: the gsc
 * entry env first, process env as fallback for keys the entry omits.
 * Mirrors getAuthMode's default (a missing mode means service_account)
 * and the setup/auth.ts shared gate: oauth without a custom client (a
 * secrets file, or a client id plus secret pair) is Quick Connect
 * (shared) and can never use full access.
 */
function classifyWriteTier(entryEnv) {
    const pick = (key) => {
        const fromEntry = entryEnv[key];
        if (typeof fromEntry === "string" && fromEntry.trim() !== "")
            return fromEntry;
        const fromProcess = process.env[key];
        return typeof fromProcess === "string" && fromProcess.trim() !== "" ? fromProcess : undefined;
    };
    if ((pick("GSC_AUTH_MODE") ?? "").toLowerCase() === "oauth") {
        if (pick("GSC_OAUTH_SECRETS_FILE") !== undefined)
            return "custom";
        if (pick("GSC_OAUTH_CLIENT_ID") !== undefined && pick("GSC_OAUTH_CLIENT_SECRET") !== undefined) {
            return "custom";
        }
        return "shared";
    }
    return "service-account";
}
/** Static refusal for shared installs; mirrors the setup/auth.ts wording. */
exports.SHARED_WRITE_REFUSAL = `Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}. This install uses Quick Connect (shared OAuth), which cannot use full access. ` +
    "To enable Google write operations, migrate first: re-run setup with --auth custom plus --secrets, or --auth service-account plus --key-file, " +
    "using --scopes full, then run setup enable-write again. Nothing was changed.";
/**
 * Resolve write-toggle targets: explicit --client flags reuse the setup
 * parsing/validation contract (parseClientFlags + validateClientTargets,
 * so both/comma/multiples and print-exclusivity behave identically).
 * Without flags, default to the detected file config (desktop, cursor,
 * opencode, pi order); fail closed when none exists. CLI-managed targets
 * always need --client.
 */
function resolveWriteTargets(rawClients, opts = {}) {
    if (rawClients.length > 0)
        return (0, clients_js_1.validateClientTargets)((0, clients_js_1.parseClientFlags)(rawClients));
    const detected = (0, client_config_js_1.detectFileTarget)(opts.homeDir);
    if (detected !== null)
        return [detected];
    throw new Error("No desktop, cursor, opencode, or pi MCP config found. Pass --client explicitly (desktop, code, cursor, codex, opencode, pi) or run setup first. Nothing was changed.");
}
const ENABLE_WRITE_WARNING = [
    "Warning: this enables REAL Google submissions for the gsc server.",
    "- Indexing API URL notifications and sitemap submissions change Google state; they cannot be undone from here.",
    "- Quota is limited (200 URL notifications/day, shared by this instance).",
    "- Only properties in this instance's allowlist can be submitted to; every other property is refused locally.",
].join("\n");
const SCOPES_FULL_NOTE = "Note: Google write operations also need GSC_SCOPES=full in the same env. Without it the flag alone keeps writes disabled; " +
    "re-run setup with --scopes full or update the scope manually, then restart the client.";
const CLIENT_LABELS = {
    desktop: "Claude Desktop (app)",
    cursor: "Cursor (editor)",
    code: "Claude Code (terminal)",
    codex: "Codex (terminal)",
    opencode: "OpenCode",
    pi: "Pi (OhMyPi)",
};
function verifyHint(clientLabel) {
    return (`Verify: restart ${clientLabel} to pick up the change, then run \`gsc doctor\` (offline write_ops check). ` +
        "Doctor reflects the current shell env; the MCP client uses the edited file after restart.");
}
function printWriteManualFragment(enable) {
    const action = enable
        ? `Merge "${client_config_js_1.WRITE_ENV_KEY}": "1" into the gsc server env, keeping every other setting:`
        : `Delete the "${client_config_js_1.WRITE_ENV_KEY}" key from the gsc server env, keeping every other setting:`;
    const fragment = enable
        ? JSON.stringify({ mcpServers: { [client_config_js_1.SETUP_SERVER_NAME]: { env: { [client_config_js_1.WRITE_ENV_KEY]: "1" } } } }, null, 2)
        : [
            "{",
            '  "mcpServers": {',
            `    "${client_config_js_1.SETUP_SERVER_NAME}": {`,
            '      "env": {',
            `        "${client_config_js_1.WRITE_ENV_KEY}": "<delete this key>",`,
            '        "...": "(keep every other key unchanged)"',
            "      }",
            "    }",
            "  }",
            "}",
        ].join("\n");
    return `\n${action}\n${fragment}`;
}
/**
 * Guided manual steps for CLI-managed entries (code, codex). Setup never
 * edits these in place: it cannot read-modify-write them without risking
 * an automatic remove, so it prints the safe paths instead. Nothing is
 * invoked and nothing is changed.
 */
function cliWriteGuidance(target, enable) {
    const program = CLIENT_LABELS[target] ?? target;
    const action = enable ? `add ${client_config_js_1.WRITE_ENV_KEY}=1 to the gsc env` : `remove ${client_config_js_1.WRITE_ENV_KEY} from the gsc env`;
    const regen = enable ? " plus --scopes full --enable-write" : "";
    return [
        `\nThe ${target} entry is CLI-managed and cannot be safely edited in place; setup never removes it automatically.`,
        `To ${action} there, re-run the guided setup for that target with your usual --auth and --site flags${regen} (requires Google sign-in),`,
        `or ${action} in the ${program} MCP settings UI and restart ${program}.`,
        "Nothing was changed.",
    ].join("\n");
}
function accessManualGuidance(access) {
    return `Manually set GSC_ACCESS_MODE=${access} in the gsc entry and remove GSC_SCOPES and GSC_ENABLE_WRITE. ` +
        "Keep all other settings. Full is unavailable for Quick Connect. Nothing was changed.";
}
async function runEnableWriteCommand(argv, deps = {}) {
    return runWriteToggleCommand(true, argv, deps);
}
async function runDisableWriteCommand(argv, deps = {}) {
    return runWriteToggleCommand(false, argv, deps);
}
async function runAccessCommand(argv, deps = {}) {
    if (argv[0] === "--help" || argv[0] === "-h") {
        (deps.log ?? console.log)(exports.ACCESS_USAGE);
        return 0;
    }
    const access = argv[0];
    if (access !== "readonly" && access !== "full") {
        (deps.log ?? console.error)("Invalid access mode. Use gsc setup access readonly|full. Nothing was changed.");
        return 1;
    }
    return runWriteToggleCommand(access === "full", argv.slice(1), deps, access);
}
async function runWriteToggleCommand(enable, argv, deps, access) {
    const command = access !== undefined ? "access" : enable ? "enable-write" : "disable-write";
    let opts;
    try {
        opts = parseWriteToggleArgs(argv, command);
    }
    catch {
        // Static message only: the rejected token may hold sensitive text.
        console.error(`Setup failed: unknown or invalid ${command} option. Run setup ${command} --help for usage.`);
        return 1;
    }
    if (opts.help) {
        console.log(access !== undefined ? exports.ACCESS_USAGE : exports.WRITE_TOGGLE_USAGE);
        return 0;
    }
    const log = deps.log ?? ((message) => console.log(message));
    let prompter = null;
    let confirm = deps.confirm;
    if (!confirm) {
        // terminalPromptAdapter(opts.yes) with --yes never prompts (returns the
        // fallback), so holding one adapter for the whole command is inert.
        prompter = (0, flow_js_1.terminalPromptAdapter)(opts.yes);
        const active = prompter;
        confirm = (question) => active.text(question, "n");
    }
    try {
        let targets;
        try {
            targets = resolveWriteTargets(opts.clients, { ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}) });
        }
        catch (err) {
            console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
        if (targets.length === 1 && (targets[0] === "print" || targets[0] === "generic")) {
            log(access !== undefined ? accessManualGuidance(access) : printWriteManualFragment(enable));
            log(verifyHint("your MCP client"));
            return 0;
        }
        let ok = true;
        for (const target of targets) {
            if ((0, client_config_js_1.isFileTarget)(target) && target !== "opencode") {
                const configPath = (0, client_config_js_1.resolveFileConfigPath)(target, deps.homeDir);
                if (!configPath) {
                    log(`\nCannot safely locate the ${target} config on this machine; falling back to manual steps.`);
                    log(access !== undefined ? accessManualGuidance(access) : printWriteManualFragment(enable));
                    continue;
                }
                let entryEnv;
                try {
                    const rawEnv = (0, client_config_js_1.readGscEntry)(configPath).entry.env;
                    if (rawEnv === undefined || rawEnv === null) {
                        entryEnv = {};
                    }
                    else if (typeof rawEnv === "object" && !Array.isArray(rawEnv)) {
                        entryEnv = rawEnv;
                    }
                    else {
                        throw new Error("Existing gsc entry has a non-object env; fix it first. Nothing was changed.");
                    }
                }
                catch (err) {
                    log(err instanceof Error ? err.message : String(err));
                    ok = false;
                    continue;
                }
                let changed;
                try {
                    changed = (access !== undefined ? (0, client_config_js_1.updateGscEnvForAccess)(entryEnv, access) : (0, client_config_js_1.updateGscEnvForWrite)(entryEnv, enable)).changed;
                }
                catch (err) {
                    log(err instanceof Error ? err.message : "Cannot update access. Nothing was changed.");
                    ok = false;
                    continue;
                }
                if (enable && classifyWriteTier(entryEnv) === "shared") {
                    log(`\n${exports.SHARED_WRITE_REFUSAL}`);
                    ok = false;
                    continue;
                }
                if (enable && changed) {
                    log(`\n${ENABLE_WRITE_WARNING}`);
                    const scopes = typeof entryEnv.GSC_SCOPES === "string" ? entryEnv.GSC_SCOPES : (process.env.GSC_SCOPES ?? "");
                    if (access === undefined && scopes.toLowerCase() !== "full")
                        log(SCOPES_FULL_NOTE);
                }
                const applied = await (0, client_config_js_1.applyWriteFileConfig)({
                    configPath,
                    serverName: client_config_js_1.SETUP_SERVER_NAME,
                    enable,
                    ...(access !== undefined ? { access } : {}),
                    force: opts.force,
                    yes: opts.yes,
                    dryRun: opts.dryRun,
                    confirm,
                    log,
                });
                if (applied && !opts.dryRun && changed) {
                    if (access !== undefined)
                        log("The access change may require gsc auth login with the same client settings; readonly rejects tokens with write grants.");
                    log(verifyHint(CLIENT_LABELS[target] ?? target));
                }
                if (!applied)
                    ok = false;
            }
            else if (target === "opencode") {
                log(access !== undefined
                    ? `opencode stores the entry under the global "mcp" key with an "environment" map; edit ~/.config/opencode/opencode.json manually. ${accessManualGuidance(access)}\n${verifyHint(CLIENT_LABELS[target] ?? target)}`
                    : printWriteManualFragment(enable));
            }
            else if ((0, client_config_js_1.isCliTarget)(target)) {
                log(access !== undefined
                    ? `${target} is CLI-managed; no command is invoked. ${accessManualGuidance(access)}\n${verifyHint(CLIENT_LABELS[target] ?? target)}`
                    : cliWriteGuidance(target, enable));
            }
            else {
                log(access !== undefined ? accessManualGuidance(access) : printWriteManualFragment(enable));
                log(verifyHint("your MCP client"));
            }
        }
        return ok ? 0 : 1;
    }
    finally {
        prompter?.close();
    }
}
