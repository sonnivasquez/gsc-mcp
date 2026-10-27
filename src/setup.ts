/**
 * `gsc setup` (after global install)
 * Guided setup: authenticates with Google, verifies API access with a live
 * sites.list call, then writes the MCP entry into Claude Desktop and/or
 * Claude Code config for the user. The goal is that nobody ever edits a
 * config file or reads an OAuth tutorial to get started.
 *
 * Privacy model: tokens are cached at ~/.gsc-mcp/ on this machine and every
 * API call goes straight from this machine to Google. Nothing touches any
 * third party server.
 */
import type { searchconsole_v1 } from "googleapis";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CLI_VERSION } from "./version.js";
import { terminalPromptAdapter, type PromptAdapter } from "./setup/flow.js";
import {
  authenticateWithOAuth,
  cachedTokenPath,
  clearCachedToken,
  ScopeTier,
  scopesForTier,
} from "./oauth.js";
import { embeddedClientAvailable } from "./embedded-client.js";
import { decideAuth, validateCredentialFile, type SetupAuth } from "./setup/auth.js";
import { parseSiteFlags, validateAllowlist, parsePropertySelectionAnswer, isAllowAllFutureAnswer, MIXED_ALLOW_ALL_ERROR } from "./setup/properties.js";
import { isAllowAllAllowlist } from "./profiles.js";
import {
  buildFinishReport,
  formatFinishReport,
  parseFirstQueryAnswer,
  runSampleQuery,
  sampleWindow,
  SAMPLE_QUERY_DIMENSIONS,
  SAMPLE_QUERY_ROW_LIMIT,
  type SiteEntrySummary,
  type TargetOutcome,
} from "./setup/finish.js";
import type { ClientConfigText, SpawnRunner } from "./client-config.js";
import {
  defaultPackageSkillsDir,
  installSkill,
  parseSkillSelectionAnswer,
  skillAgentDisplayName,
  skillAgentsForTargets,
} from "./setup/skill-install.js";
import { parseSitesListBody, SITES_LIST_SHAPE_ERROR } from "./auth-provider.js";
import { parseClientFlags, validateClientTargets, parseClientSelectionAnswer } from "./setup/clients.js";
import {
  INVALID_SETUP_LANGUAGE_ERROR,
  MISSING_SETUP_LANGUAGE_ERROR,
  getSetupUsage,
  isSetupAffirmative,
  localizeSetupErrorMessage,
  parseSetupLanguage,
  resolveSetupLocale,
  translateSetup,
  type SetupLocale,
} from "./setup/i18n.js";
import {
  SETUP_SERVER_NAME,
  WRITE_ENV_KEY,
  buildOpencodeEntry,
  buildSetupEntry,
  buildSetupPrintJson,
  resolveFileConfigPath,
  detectFileTarget,
  readGscEntry,
  updateGscEnvForWrite,
  updateGscEnvForAccess,
  applyFileConfig,
  applyWriteFileConfig,
  buildClaudeCodeArgs,
  claudeCodeRemoveArgs,
  buildCodexArgs,
  codexRemoveArgs,
  applyCliConfig,
  formatPreviewCommand,
  isFileTarget,
  isCliTarget,
  type FileTarget,
} from "./client-config.js";

interface SetupOptions {
  clients: string[];
  access: ScopeTier | null;
  scopes: ScopeTier | null;
  sites: string[];
  allSites: boolean;
  secrets: string | null;
  keyFile: string | null;
  auth: SetupAuth | null;
  enableWrite: boolean;
  firstQuery: boolean;
  installSkill: boolean;
  reauth: boolean;
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  yes: boolean;
  language: SetupLocale | null;
  help: boolean;
}

// Setup help text lives in src/setup/i18n.ts (SETUP_STRINGS). English stays
// the exact default/fallback catalog; Spanish is the localized equivalent.

const KNOWN_CLIENTS = new Set(["desktop", "code", "cursor", "codex", "opencode", "pi", "generic", "print", "both"]);

function needValue(flag: string, value: string | undefined): string {
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`${flag} needs a value. Run with --help for usage.`);
  }
  return value;
}

function parseArgs(argv: string[]): SetupOptions {
  const opts: SetupOptions = {
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
        if (v === "readonly" || v === "full") opts.scopes = v;
        // No input echo: the rejected value may hold sensitive text.
        else throw new Error("Invalid --scopes value. Use readonly or full.");
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
        if (v === "shared" || v === "custom" || v === "service-account") opts.auth = v;
        else throw new Error("Invalid --auth value. Use shared, custom, or service-account.");
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
        opts.language = parseSetupLanguage(argv[++i]);
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
const CONTROLLED_SETUP_ERROR_MESSAGES: ReadonlySet<string> = new Set([
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
  INVALID_SETUP_LANGUAGE_ERROR,
  MISSING_SETUP_LANGUAGE_ERROR,
  `Quick Connect is readonly-only in ${CLI_VERSION}.`,
  `Quick Connect is readonly-only in ${CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`,
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
  MIXED_ALLOW_ALL_ERROR,
  "Use --client print/generic alone: it only prints the config without writing or invoking.",
  "OAuth authentication timed out after 2 minutes",
  SITES_LIST_SHAPE_ERROR,
]);

const CONTROLLED_SETUP_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /^Invalid property selection: (use numbers like 0,1,3 or "all"\.|use "0" alone for all current \+ future properties\.|choose 0-\d+ or "all"\.)$/,
  /^Invalid client selection: (use numbers like 1,3\.|choose 1-\d+\.)$/,
];

export function sanitizeSetupFailure(err: unknown, locale: SetupLocale = "en"): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    CONTROLLED_SETUP_ERROR_MESSAGES.has(message) ||
    CONTROLLED_SETUP_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    if (locale === "es") {
      const translated = localizeSetupErrorMessage(message, locale);
      // The Spanish table mirrors the controlled gate above; a miss here
      // (drift) still fails closed to the generic localized safe error.
      if (translated !== null) return `\nError de configuración: ${translated}`;
    } else {
      return `\nSetup failed: ${message}`;
    }
  }
  return `\n${translateSetup(locale, "genericFailure")}`;
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
export function parseSetupSitesList(data: unknown): {
  fetched: string[];
  siteEntries: SiteEntrySummary[];
} {
  const parsed = parseSitesListBody(data);
  const siteEntries: SiteEntrySummary[] = parsed.entries
    .filter((entry) => entry.siteUrl.length > 0)
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      ...(entry.permissionLevel.length > 0 ? { permissionLevel: entry.permissionLevel } : {}),
    }));
  return { fetched: siteEntries.map((entry) => entry.siteUrl), siteEntries };
}

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

const INTERACTIVE_CLIENT_ORDER = ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"] as const;

/**
 * Display labels for the interactive client list. Internal flag values
 * stay exact (`desktop`, `code`, ...); only the shown label carries the
 * product form. Product names are identical in both locales; only the
 * print-only entry is localized (`JSON output` / `Formato JSON`).
 */
function clientDisplayLabels(locale: SetupLocale): Record<string, string> {
  return {
    desktop: "Claude Desktop (app)",
    code: "Claude Code (terminal)",
    cursor: "Cursor (editor)",
    codex: "Codex (terminal)",
    opencode: "OpenCode",
    pi: "Pi (OhMyPi)",
    print: translateSetup(locale, "clientPrintLabel"),
    generic: translateSetup(locale, "clientPrintLabel"),
  };
}

/**
 * Best-effort locale for argument-parse failures: an explicit `--language
 * en|es` token on the command line wins when present and valid; otherwise
 * the T01 environment/Intl resolution applies. Never echoes input and never
 * throws: an unreadable value falls back to English.
 */
function localeForParseError(argv: string[]): SetupLocale {
  const flag = argv.indexOf("--language");
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (value === "en" || value === "es") return value;
  }
  return resolveSetupLocale(undefined);
}

async function resolveClients(
  rawClients: string[],
  prompter: PromptAdapter,
  locale: SetupLocale = "en"
): Promise<string[]> {
  if (rawClients.length > 0) {
    return validateClientTargets(parseClientFlags(rawClients));
  }
  console.log(`\n${translateSetup(locale, "clientTitle")}`);
  const labels = clientDisplayLabels(locale);
  INTERACTIVE_CLIENT_ORDER.forEach((name, i) =>
    console.log(`  [${i + 1}] ${labels[name] ?? name}`)
  );
  const answer = await prompter.text(translateSetup(locale, "clientPrompt"), "");
  return parseClientSelectionAnswer(answer, INTERACTIVE_CLIENT_ORDER, 0);
}


export function buildEnv(opts: {
  access?: ScopeTier;
  scopes: ScopeTier;
  site?: string;
  sites?: string[];
  allSites?: boolean;
  secretsPath: string | null;
  keyFile: string | null;
  mode: SetupAuth;
  write: boolean;
}): Record<string, string> {
  const scopes = opts.access ?? opts.scopes;
  const write = opts.access === undefined ? opts.write : opts.access === "full";
  if (opts.mode === "shared" && (scopes !== "readonly" || write)) {
    throw new Error(`Quick Connect is readonly-only in ${CLI_VERSION}.`);
  }
  if (write && scopes !== "full") {
    throw new Error("Write enablement requires full access.");
  }
  const env: Record<string, string> = {
    GSC_AUTH_MODE: opts.mode === "service-account" ? "service_account" : "oauth",
  };
  if (opts.access !== undefined) env.GSC_ACCESS_MODE = opts.access;
  else env.GSC_SCOPES = opts.scopes;
  const allSites = opts.allSites ?? false;
  let sites: string[];
  if (opts.sites !== undefined) {
    sites = [...opts.sites];
  } else if (opts.site !== undefined) {
    sites = [opts.site];
  } else if (allSites) {
    sites = [];
  } else {
    throw new Error("A dashboard property is required");
  }
  if (allSites && sites.length > 0) {
    throw new Error("Use either repeatable --site or --all-sites, not both.");
  }
  if (allSites && sites.length === 0) {
    // Explicit all-properties preview without network enumeration (dry-run):
    // omit the allowlist key and let the caller explain that the live run
    // stores the exact discovered identifiers.
  } else {
    const validated = validateAllowlist(sites);
    // New setup persists a JSON string array: URL-prefix identifiers may
    // contain commas, so comma joining would corrupt the allowlist.
    // The legacy single-site caller keeps its historic raw-string form.
    // The allow-all sentinel stays exactly `["all"]` (validated is
    // `["all"]` canonical); it is never expanded into enumerated
    // identifiers so future properties stay covered.
    env.GSC_SITE_URLS = opts.sites !== undefined ? JSON.stringify(validated) : validated.join(",");
  }
  if (opts.access === undefined && opts.write) env.GSC_ENABLE_WRITE = "1";
  if (opts.keyFile) env.GSC_KEY_FILE = opts.keyFile;
  if (opts.secretsPath) {
    env.GSC_OAUTH_SECRETS_FILE = opts.secretsPath;
  }
  // With the embedded client, no credential env vars are needed at all.
  return env;
}

export interface ApplyTargetsDeps {
  /** Seam for unavailable-path tests. Defaults to the real resolver. */
  resolveFileConfigPath?: (target: FileTarget) => string | null;
  /** Seam for CLI-invocation tests. Defaults to direct spawn. */
  runner?: SpawnRunner;
}

/**
 * Build the locale-specific first-install helper copy from the setup
 * translation catalog. The returned templates keep every machine value
 * (`{path}`, `{server}`, `{dir}`, `{backup}`, `{command}`, `{program}`,
 * `{steps}`) as placeholders the helpers substitute exactly; only the
 * surrounding human-facing copy is localized. Structured
 * `TargetOutcome` notes stay English and are never built here.
 */
function clientConfigTextForLocale(locale: SetupLocale): ClientConfigText {
  return {
    configFile: translateSetup(locale, "fileConfigFile"),
    previewExisting: translateSetup(locale, "filePreviewExisting"),
    previewNew: translateSetup(locale, "filePreviewNew"),
    noExistingEntry: translateSetup(locale, "fileNoExisting"),
    unreadableEntry: translateSetup(locale, "fileUnreadable"),
    dryRunNote: translateSetup(locale, "fileDryRun"),
    confirmOverwrite: translateSetup(locale, "fileConfirmOverwrite"),
    confirmNew: translateSetup(locale, "fileConfirmNew"),
    skipped: translateSetup(locale, "fileSkipped"),
    backup: translateSetup(locale, "fileBackup"),
    couldNotRead: translateSetup(locale, "fileCouldNotRead"),
    invalidJson: translateSetup(locale, "fileInvalidJson"),
    backupFailed: translateSetup(locale, "fileBackupFailed"),
    mkdirFailed: translateSetup(locale, "fileMkdirFailed"),
    stageFailedExisting: translateSetup(locale, "fileStageFailedExisting"),
    stageFailedNew: translateSetup(locale, "fileStageFailedNew"),
    replaceFailedExisting: translateSetup(locale, "fileReplaceFailedExisting"),
    replaceFailedNew: translateSetup(locale, "fileReplaceFailedNew"),
    mergeInvalidRoot: translateSetup(locale, "fileMergeInvalidRoot"),
    mergeInvalidServers: translateSetup(locale, "fileMergeInvalidServers"),
    mergeInvalidMcp: translateSetup(locale, "fileMergeInvalidMcp"),
    configured: translateSetup(locale, "fileConfigured"),
    cliDryRunPreview: translateSetup(locale, "cliDryRunPreview"),
    cliDryRunNote: translateSetup(locale, "cliDryRunNote"),
    cliConfirm: translateSetup(locale, "cliConfirm"),
    cliSkipped: translateSetup(locale, "cliSkipped"),
    cliLaunchFailed: translateSetup(locale, "cliLaunchFailed"),
    cliNotFound: translateSetup(locale, "cliNotFound"),
    cliAddFailed: translateSetup(locale, "cliAddFailed"),
    cliConfigured: translateSetup(locale, "cliConfigured"),
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
function trackConfirm(prompter: PromptAdapter, locale: SetupLocale = "en"): {
  confirm: (question: string) => Promise<string>;
  declined: () => boolean;
} {
  let declined = false;
  return {
    confirm: async (question: string) => {
      const answer = await prompter.text(question, "n");
      if (!isSetupAffirmative(answer, locale)) {
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
export async function applyTargets(
  targets: string[],
  env: Record<string, string>,
  prompter: PromptAdapter,
  opts: { force: boolean; yes: boolean; dryRun: boolean; locale?: SetupLocale; verbose?: boolean },
  deps: ApplyTargetsDeps = {}
): Promise<{ ok: boolean; outcomes: TargetOutcome[] }> {
  const entry = buildSetupEntry(env);
  const locale = opts.locale ?? "en";
  const verbose = opts.verbose ?? true;
  const text = clientConfigTextForLocale(locale);
  const log = (message: string): void => {
    console.log(message);
  };
  const resolvePath = deps.resolveFileConfigPath ?? resolveFileConfigPath;

  if (targets.length === 1 && (targets[0] === "print" || targets[0] === "generic")) {
    console.log(`\n${translateSetup(locale, "targetPrintHeading")}`);
    console.log(buildSetupPrintJson(entry));
    return {
      ok: true,
      outcomes: [{ target: targets[0], status: "printed", note: "generic JSON printed; configure the client manually" }],
    };
  }

  const outcomes: TargetOutcome[] = [];
  let ok = true;
  for (const target of targets) {
    if (target === "desktop" || target === "cursor" || target === "opencode" || target === "pi") {
      const configPath = resolvePath(target as FileTarget);
      if (!configPath) {
        console.log(`\n${translateSetup(locale, "targetConfigUnavailable", { target })}`);
        console.log(buildSetupPrintJson(entry));
        outcomes.push({ target, status: "printed", note: "config path unavailable on this machine; generic JSON printed" });
        continue;
      }
      const tracker = trackConfirm(prompter, locale);
      const isOpencode = target === "opencode";
      const applied = await applyFileConfig({
        configPath,
        serverName: SETUP_SERVER_NAME,
        entry: isOpencode ? buildOpencodeEntry(env) : entry,
        force: opts.force,
        yes: opts.yes,
        dryRun: opts.dryRun,
        confirm: tracker.confirm,
        log,
        text,
        ...(isOpencode ? { mergeKey: "mcp" as const } : {}),
        verbose,
      });
      if (applied && opts.dryRun) {
        outcomes.push({ target, status: "previewed", note: "preview only; no file written" });
      } else if (applied) {
        if (verbose) {
          if (target === "desktop") console.log(translateSetup(locale, "targetRestartDesktop"));
          if (target === "cursor") console.log(translateSetup(locale, "targetRestartCursor"));
          if (target === "opencode") console.log(translateSetup(locale, "targetRestartOpencode"));
          if (target === "pi") console.log(translateSetup(locale, "targetRestartPi"));
        }
        outcomes.push({ target, status: "applied" });
      } else if (tracker.declined()) {
        outcomes.push({ target, status: "skipped", note: "confirmation declined; nothing was changed" });
        ok = false;
      } else {
        outcomes.push({ target, status: "failed", note: "helper reported failure; nothing was changed" });
        ok = false;
      }
    } else if (target === "code" || target === "codex") {
      const program = target === "code" ? "claude" : "codex";
      const args = target === "code" ? buildClaudeCodeArgs(env) : buildCodexArgs(env);
      const removeArgs = target === "code" ? claudeCodeRemoveArgs() : codexRemoveArgs();
      const tracker = trackConfirm(prompter, locale);
      const applied = await applyCliConfig({
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
      } else if (applied) {
        outcomes.push({ target, status: "applied" });
      } else if (tracker.declined()) {
        outcomes.push({ target, status: "skipped", note: "confirmation declined; nothing was invoked" });
        ok = false;
      } else {
        console.log(`\n${translateSetup(locale, "targetCliFallbackHeading")}`);
        console.log(buildSetupPrintJson(entry));
        console.log(translateSetup(locale, "targetManualCommand", { command: formatPreviewCommand(program, args) }));
        outcomes.push({ target, status: "failed", note: "CLI invocation failed; manual fallback printed, no write performed" });
        ok = false;
      }
    } else {
      console.log(`\n${translateSetup(locale, "targetPrintHeading")}`);
      console.log(buildSetupPrintJson(entry));
      outcomes.push({ target, status: "printed", note: "generic JSON printed; configure the client manually" });
    }
  }
  return { ok, outcomes };
}

export async function runSetup(argv: string[], deps: RunSetupDeps = {}): Promise<number> {
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
  let opts: SetupOptions;
  try {
    opts = parseArgs(argv);
  } catch (err: any) {
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
  const locale = resolveSetupLocale(opts.language);

  if (opts.help) {
    console.log(getSetupUsage(locale, opts.verbose));
    return 0;
  }

  const verbose = opts.verbose === true;

  console.log(translateSetup(locale, "welcomeTitle"));
  if (verbose) console.log(`${translateSetup(locale, "welcomeSubtitle")}\n`);

  const prompter = terminalPromptAdapter(opts.yes);
  try {
    console.log(translateSetup(locale, "stageAuth"));
    // Explicit deprecated inputs retain their historical independent controls.
    const legacyAccess = opts.access === null && (opts.scopes !== null || opts.enableWrite);
    const decision = await decideAuth(prompter, opts.auth ?? (opts.keyFile ? "service-account" : opts.secrets ? "custom" : null),
      opts.scopes, opts.enableWrite, legacyAccess ? undefined : opts.access, locale);
    if (opts.secrets && decision.mode !== "custom" || opts.keyFile && decision.mode !== "service-account") {
      throw new Error("Credential path does not match the selected authentication mode.");
    }
    if (decision.mode === "shared" && !embeddedClientAvailable() && !opts.dryRun) {
      throw new Error("Quick Connect is unavailable in this build. Choose --auth custom with --secrets instead.");
    }
    // 2. Credentials
    let secretsPath: string | null = null;
    let keyFile: string | null = null;
    if (decision.mode === "service-account") {
      const input = opts.keyFile ?? await prompter.text(translateSetup(locale, "keyFilePrompt"), "");
      if (!input) throw new Error("Service Account requires --key-file.");
      keyFile = path.resolve(input.replace(/^~\//, os.homedir() + "/"));
      validateCredentialFile(keyFile, "service-account");
    } else if (decision.mode === "custom" && opts.secrets) {
      secretsPath = path.resolve(opts.secrets);
      if (!fs.existsSync(secretsPath)) {
        // No path echo: credential paths stay out of diagnostics.
        console.error(translateSetup(locale, "secretsNotFoundFlag"));
        return 1;
      }
    } else if (decision.mode === "custom" && process.env.GSC_OAUTH_SECRETS_FILE && fs.existsSync(process.env.GSC_OAUTH_SECRETS_FILE)) {
      secretsPath = path.resolve(process.env.GSC_OAUTH_SECRETS_FILE);
      if (verbose) console.log(translateSetup(locale, "usingOAuthClient", { path: secretsPath }));
    } else if (decision.mode === "shared") {
      if (verbose) console.log(translateSetup(locale, "authSharedNote"));
    } else if (decision.mode === "custom" && !opts.dryRun) {
      console.log(translateSetup(locale, "customGuideTitle"));
      console.log(translateSetup(locale, "customGuideStep1"));
      console.log(translateSetup(locale, "customGuideStep2"));
      console.log(translateSetup(locale, "customGuideStep3"));
      console.log(`${translateSetup(locale, "customWalkthrough", { url: "docs/quickstart.md (custom OAuth client section)" })}\n`);
      const p = await prompter.text(translateSetup(locale, "clientSecretsPrompt"), "");
      if (!p) {
        console.error(translateSetup(locale, "noCredentials"));
        return 1;
      }
      secretsPath = path.resolve(p.replace(/^~\//, os.homedir() + "/"));
      if (!fs.existsSync(secretsPath)) {
        // No path echo: credential paths stay out of diagnostics.
        console.error(translateSetup(locale, "secretsNotFoundPath"));
        return 1;
      }
    }

    if (decision.mode === "custom" && secretsPath) validateCredentialFile(secretsPath, "custom");
    const scopes = decision.scope;
    // `full` is explained only where chosen: the recommended readonly path
    // stays first and quiet, matching the access prompt disclosure order.
    // Quiet runs suppress the scope echo; verbose keeps the historical line.
    if (verbose) console.log(scopes === "readonly"
      ? translateSetup(locale, "scopeReadonly")
      : translateSetup(locale, "scopeFull"));

    // 3. Exact property allowlist after one sites.list (or dry-run preview).
    // Each explicit --site flag is one identifier boundary; conflict with
    // --all-sites is decided on the explicit flags before any parsing.
    console.log(translateSetup(locale, "stageProperties"));
    if (opts.allSites && opts.sites.length > 0) {
      throw new Error("Use either repeatable --site or --all-sites, not both.");
    }
    const requestedSites = parseSiteFlags(opts.sites);
    let allowlist: string[];
    let allSitesPreview = false;
    // Reused by the finish stage: the single sites.list result is kept here
    // so verification never makes a second Google call.
    let siteEntries: SiteEntrySummary[] = [];
    let searchConsole: searchconsole_v1.Searchconsole | null = null;
    if (!opts.dryRun) {
      // Authentication must use the selected policy, never conflicting ambient keys.
      if (legacyAccess) {
        delete process.env.GSC_ACCESS_MODE;
        process.env.GSC_SCOPES = scopes;
        if (decision.write) process.env.GSC_ENABLE_WRITE = "1";
        else delete process.env.GSC_ENABLE_WRITE;
      } else {
        process.env.GSC_ACCESS_MODE = scopes;
        delete process.env.GSC_SCOPES;
        delete process.env.GSC_ENABLE_WRITE;
      }
      process.env.GSC_AUTH_MODE = decision.mode === "service-account" ? "service_account" : "oauth";
      if (secretsPath) process.env.GSC_OAUTH_SECRETS_FILE = secretsPath;
      if (keyFile) process.env.GSC_KEY_FILE = keyFile;
      if (decision.mode === "shared") {
        delete process.env.GSC_OAUTH_SECRETS_FILE;
        delete process.env.GSC_OAUTH_CLIENT_ID;
        delete process.env.GSC_OAUTH_CLIENT_SECRET;
      }
      if (opts.reauth && decision.mode !== "service-account") clearCachedToken();

      const { google } = await import("googleapis");
      const auth = decision.mode === "service-account"
        ? new google.auth.GoogleAuth({ keyFile: keyFile!, scopes: scopesForTier(scopes) })
        : await authenticateWithOAuth();

      const sc = google.searchconsole({ version: "v1", auth });
      searchConsole = sc;
      // One sites.list call only: the raw response is validated by the
      // shared shape gate (malformed members fail here, before client
      // configuration and before an explicit --site can bypass them).
      const rawData: unknown = deps.listSitesRaw ? await deps.listSitesRaw() : (await sc.sites.list({})).data;
      const parsedSites = parseSetupSitesList(rawData);
      const fetched = parsedSites.fetched;
      siteEntries = parsedSites.siteEntries;
      if (verbose) console.log(fetched.length === 1
        ? `\n${translateSetup(locale, "connectedOne")}`
        : `\n${translateSetup(locale, "connectedMany", { count: fetched.length })}`);

      if (opts.allSites) {
        if (fetched.length === 0) {
          throw new Error("No properties found on this account; --all-sites has nothing to select. Pass --site explicitly once access exists.");
        }
        // Validate every returned siteUrl with the shared predicate before
        // persisting: an unexpected malformed identifier fails closed here.
        allowlist = validateAllowlist(fetched);
        if (verbose) console.log(translateSetup(locale, "selectedAllCount", { count: allowlist.length }));
      } else if (requestedSites.length > 0) {
        if (isAllowAllAllowlist(requestedSites)) {
          console.log(translateSetup(locale, "allowAllWarning"));
          if (verbose) console.log(translateSetup(locale, "allowAllSelected"));
          allowlist = ["all"];
        } else {
          for (const site of requestedSites) {
            if (!fetched.includes(site)) {
              console.log(translateSetup(locale, "unlistedWarning", { site, count: fetched.length }));
            }
          }
          allowlist = validateAllowlist(requestedSites);
        }
      } else if (fetched.length === 0) {
        console.log(translateSetup(locale, "noPropertiesManual"));
        const manual = await prompter.text(translateSetup(locale, "manualPropertyPrompt"), "");
        if (!manual.trim()) {
          console.error(translateSetup(locale, "manualPropertyRequired"));
          return 1;
        }
        if (isAllowAllAllowlist([manual.trim()])) {
          console.log(translateSetup(locale, "allowAllWarning"));
          const confirm = await prompter.text(translateSetup(locale, "allowAllConfirm"), "n");
          if (!isSetupAffirmative(confirm, locale)) {
            console.error(translateSetup(locale, "allowAllNotConfirmed"));
            return 1;
          }
          allowlist = ["all"];
          if (verbose) console.log(translateSetup(locale, "allowAllSelected"));
        } else {
          allowlist = validateAllowlist([manual.trim()]);
        }
      } else if (fetched.length === 1) {
        allowlist = [fetched[0]];
        if (verbose) console.log(translateSetup(locale, "singleProperty", { site: allowlist[0] }));
      } else {
        fetched.forEach((site, i) => {
          const permission = siteEntries[i]?.permissionLevel ? `  (${siteEntries[i].permissionLevel})` : "";
          console.log(`  [${i + 1}] ${site}${permission}`);
        });
        console.log(`  [0] ${translateSetup(locale, "propertyAllOption")}`);
        const answer = await prompter.text(
          translateSetup(locale, "propertySelect", { count: fetched.length }),
          ""
        );
        if (isAllowAllFutureAnswer(answer)) {
          console.log(translateSetup(locale, "allowAllWarning"));
          const confirm = await prompter.text(translateSetup(locale, "allowAllConfirm"), "n");
          if (!isSetupAffirmative(confirm, locale)) {
            console.error(translateSetup(locale, "allowAllNotConfirmed"));
            return 1;
          }
          allowlist = ["all"];
          if (verbose) console.log(translateSetup(locale, "allowAllSelected"));
        } else {
          allowlist = parsePropertySelectionAnswer(answer, fetched, 0);
          if (verbose) console.log(allowlist.length === 1
            ? translateSetup(locale, "selectedCountOne", { sites: allowlist.join(", ") })
            : translateSetup(locale, "selectedCountMany", { count: allowlist.length, sites: allowlist.join(", ") }));
        }
      }
    } else if (opts.allSites) {
      allowlist = [];
      allSitesPreview = true;
      console.log(translateSetup(locale, "allSitesPreview"));
    } else if (requestedSites.length > 0) {
      allowlist = validateAllowlist(requestedSites);
    } else {
      allowlist = ["sc-domain:yoursite.com"];
    }

    // 4. Choose where to install (multiple targets where safe)
    console.log(translateSetup(locale, "stageClients"));
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
    const finishLog = (message: string): void => {
      console.error(message);
    };
    const skillAgents = skillAgentsForTargets(targets);
    let selectedSkillAgents: string[] = [];
    let skillConfirmed = false;
    if (opts.installSkill) {
      skillConfirmed = true;
      selectedSkillAgents = skillAgents;
    } else if (opts.yes || prompter.interactive !== true) {
      // --yes and non-TTY runs never show the screen: same skipped note.
      if (verbose) finishLog(translateSetup(locale, "skillSkippedFlag"));
    } else if (skillAgents.length === 0) {
      // No compatible agent: the current unsupported note, no screen.
      finishLog(translateSetup(locale, "skillUnsupported"));
    } else {
      console.log(`\n${translateSetup(locale, "skillListTitle")}`);
      console.log(`  [1] ${translateSetup(locale, "skillListAll")}`);
      skillAgents.forEach((agent, i) =>
        console.log(`  [${i + 2}] ${skillAgentDisplayName(agent, locale)}`)
      );
      console.log(`  [0] ${translateSetup(locale, "skillListSkip")}`);
      const answer = await prompter.text(translateSetup(locale, "skillListPrompt"), "");
      try {
        selectedSkillAgents = parseSkillSelectionAnswer(answer, skillAgents);
      } catch {
        // Controlled rejection: static copy, the answer is never echoed.
        console.error(translateSetup(locale, "skillInvalidSelection"));
        return 1;
      }
      skillConfirmed = selectedSkillAgents.length > 0;
      if (!skillConfirmed && verbose) finishLog(translateSetup(locale, "skillSkipped"));
    }
    let skillOutcome: { status: "installed" | "previewed" | "failed" | "unsupported"; detail: string } | null = null;
    let skillOk = true;
    if (skillConfirmed) {
      const skillsDir = deps.skillsDir ?? defaultPackageSkillsDir();
      const installed = await installSkill({
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
        finishLog(translateSetup(locale, "skillFailed"));
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
      const authLabel =
        decision.mode === "service-account"
          ? "service_account"
          : decision.mode === "shared"
            ? "oauth (Quick Connect)"
            : "oauth (custom client)";
      const report = buildFinishReport({
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
        for (const line of formatFinishReport(report, { configFailed: !ok, locale })) finishLog(line);
      } else {
        // Quiet: one result line (header plus the client-target summary)
        // instead of the full 7-section verification. Failures stay
        // truthful: a failed configuration keeps its failed header.
        const header = opts.dryRun
          ? (!ok ? translateSetup(locale, "finishHeaderDryRunFailed") : translateSetup(locale, "finishHeaderDryRun"))
          : (!ok ? translateSetup(locale, "finishHeaderFailed") : translateSetup(locale, "finishHeader"));
        const clients = report.sections.find((s) => s.id === "clients");
        finishLog(clients !== undefined ? `${header} ${clients.detail}` : header);
      }
    }

    // One minimal sample query, strictly opt-in: an explicit --first-query
    // flag, or a separate interactive confirmation. --yes alone never
    // enables it, and --dry-run never calls Google. Allow-all (`all`) skips
    // the sample query: it names no single property to query.
    if (!opts.dryRun && ok && allowlist.length > 0 && searchConsole !== null && isAllowAllAllowlist(allowlist)) {
      if (verbose) finishLog(translateSetup(locale, "sampleAllowAllSkip"));
    }
    if (!opts.dryRun && ok && allowlist.length > 0 && searchConsole !== null && !isAllowAllAllowlist(allowlist)) {
      const siteUrl = allowlist[0];
      const window = sampleWindow();
      let confirmed = opts.firstQuery;
      if (!confirmed) {
        if (opts.yes) {
          if (verbose) finishLog(translateSetup(locale, "sampleSkippedFlag"));
        } else {
          const answer = await prompter.text(
            translateSetup(locale, "sampleConfirm", { site: siteUrl, start: window.startDate, end: window.endDate }),
            "n"
          );
          confirmed = parseFirstQueryAnswer(answer, locale);
          if (!confirmed && verbose) finishLog(translateSetup(locale, "sampleSkipped"));
        }
      }
      if (confirmed) {
        const client = searchConsole;
        const outcome = await runSampleQuery(siteUrl, window, async (site, win) => {
          const resp = await client.searchanalytics.query({
            siteUrl: site,
            requestBody: {
              startDate: win.startDate,
              endDate: win.endDate,
              dimensions: [...SAMPLE_QUERY_DIMENSIONS],
              type: "web",
              dataState: "final",
              rowLimit: SAMPLE_QUERY_ROW_LIMIT,
            },
          });
          const rows = (resp.data.rows ?? []).map((row) => ({
            keys: row.keys ?? [],
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
          }));
          return { rows };
        }, locale);
        finishLog(translateSetup(locale, "sampleResult", { status: outcome.status, detail: outcome.detail }));
      }
    } else if (opts.dryRun && ok) {
      if (opts.firstQuery || verbose) finishLog(
        opts.firstQuery
          ? translateSetup(locale, "sampleDryRunFlag")
          : translateSetup(locale, "sampleDryRunSkip")
      );
    }

    if (!opts.dryRun && ok && skillOk) {
      console.log(`\n${translateSetup(locale, "finishDone")}`);
      if (verbose) {
        console.log(translateSetup(locale, "finishToken", { path: cachedTokenPath() }));
        console.log(translateSetup(locale, "finishRevoke"));
        console.log(translateSetup(locale, "finishReauth"));
      }
    }
    return ok && skillOk ? 0 : 1;
  } catch (err: any) {
    console.error(sanitizeSetupFailure(err, locale));
    return 1;
  } finally {
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

export const WRITE_TOGGLE_USAGE = `
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

export const ACCESS_USAGE = `
Usage: gsc setup access readonly|full [--client <target>] [--dry-run] [--yes] [--force]

Set GSC_ACCESS_MODE and remove legacy GSC_SCOPES/GSC_ENABLE_WRITE only from the
selected gsc entry. Full enables Google submissions; Quick Connect is readonly-only.
File targets desktop/cursor/opencode/pi use redacted preview, confirmation,
backup and atomic replacement. Code/codex and print/generic receive manual guidance only.
Restart the client afterward. Changing access can require gsc auth login;
this command never authenticates, invokes a client CLI, or contacts Google.
`.trim();

interface WriteToggleOptions {
  clients: string[];
  force: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

function parseWriteToggleArgs(argv: string[], command: string): WriteToggleOptions {
  const opts: WriteToggleOptions = { clients: [], force: false, dryRun: false, yes: false, help: false };
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
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--yes" || a === "-y") {
      opts.yes = true;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      // No input echo: the unknown token may hold sensitive text.
      throw new Error(`Unknown ${command} option. Run setup ${command} --help for usage.`);
    }
  }
  return opts;
}

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
export function classifyWriteTier(entryEnv: Record<string, unknown>): WriteTier {
  const pick = (key: string): string | undefined => {
    const fromEntry = entryEnv[key];
    if (typeof fromEntry === "string" && fromEntry.trim() !== "") return fromEntry;
    const fromProcess = process.env[key];
    return typeof fromProcess === "string" && fromProcess.trim() !== "" ? fromProcess : undefined;
  };
  if ((pick("GSC_AUTH_MODE") ?? "").toLowerCase() === "oauth") {
    if (pick("GSC_OAUTH_SECRETS_FILE") !== undefined) return "custom";
    if (pick("GSC_OAUTH_CLIENT_ID") !== undefined && pick("GSC_OAUTH_CLIENT_SECRET") !== undefined) {
      return "custom";
    }
    return "shared";
  }
  return "service-account";
}

/** Static refusal for shared installs; mirrors the setup/auth.ts wording. */
export const SHARED_WRITE_REFUSAL =
  `Quick Connect is readonly-only in ${CLI_VERSION}. This install uses Quick Connect (shared OAuth), which cannot use full access. ` +
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
export function resolveWriteTargets(rawClients: string[], opts: { homeDir?: string } = {}): string[] {
  if (rawClients.length > 0) return validateClientTargets(parseClientFlags(rawClients));
  const detected = detectFileTarget(opts.homeDir);
  if (detected !== null) return [detected];
  throw new Error(
    "No desktop, cursor, opencode, or pi MCP config found. Pass --client explicitly (desktop, code, cursor, codex, opencode, pi) or run setup first. Nothing was changed."
  );
}

const ENABLE_WRITE_WARNING = [
  "Warning: this enables REAL Google submissions for the gsc server.",
  "- Indexing API URL notifications and sitemap submissions change Google state; they cannot be undone from here.",
  "- Quota is limited (200 URL notifications/day, shared by this instance).",
  "- Only properties in this instance's allowlist can be submitted to; every other property is refused locally.",
].join("\n");

const SCOPES_FULL_NOTE =
  "Note: Google write operations also need GSC_SCOPES=full in the same env. Without it the flag alone keeps writes disabled; " +
  "re-run setup with --scopes full or update the scope manually, then restart the client.";

const CLIENT_LABELS: Record<string, string> = {
  desktop: "Claude Desktop (app)",
  cursor: "Cursor (editor)",
  code: "Claude Code (terminal)",
  codex: "Codex (terminal)",
  opencode: "OpenCode",
  pi: "Pi (OhMyPi)",
};

function verifyHint(clientLabel: string): string {
  return (
    `Verify: restart ${clientLabel} to pick up the change, then run \`gsc doctor\` (offline write_ops check). ` +
    "Doctor reflects the current shell env; the MCP client uses the edited file after restart."
  );
}

function printWriteManualFragment(enable: boolean): string {
  const action = enable
    ? `Merge "${WRITE_ENV_KEY}": "1" into the gsc server env, keeping every other setting:`
    : `Delete the "${WRITE_ENV_KEY}" key from the gsc server env, keeping every other setting:`;
  const fragment = enable
    ? JSON.stringify({ mcpServers: { [SETUP_SERVER_NAME]: { env: { [WRITE_ENV_KEY]: "1" } } } }, null, 2)
    : [
        "{",
        '  "mcpServers": {',
        `    "${SETUP_SERVER_NAME}": {`,
        '      "env": {',
        `        "${WRITE_ENV_KEY}": "<delete this key>",`,
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
function cliWriteGuidance(target: string, enable: boolean): string {
  const program = CLIENT_LABELS[target] ?? target;
  const action = enable ? `add ${WRITE_ENV_KEY}=1 to the gsc env` : `remove ${WRITE_ENV_KEY} from the gsc env`;
  const regen = enable ? " plus --scopes full --enable-write" : "";
  return [
    `\nThe ${target} entry is CLI-managed and cannot be safely edited in place; setup never removes it automatically.`,
    `To ${action} there, re-run the guided setup for that target with your usual --auth and --site flags${regen} (requires Google sign-in),`,
    `or ${action} in the ${program} MCP settings UI and restart ${program}.`,
    "Nothing was changed.",
  ].join("\n");
}

function accessManualGuidance(access: "readonly" | "full"): string {
  return `Manually set GSC_ACCESS_MODE=${access} in the gsc entry and remove GSC_SCOPES and GSC_ENABLE_WRITE. ` +
    "Keep all other settings. Full is unavailable for Quick Connect. Nothing was changed.";
}

export interface WriteCommandDeps {
  /** Temp-dir seam for tests. Defaults to the real home directory. */
  homeDir?: string;
  /** Confirm seam for tests. Defaults to a terminal prompt. */
  confirm?: (question: string) => Promise<string>;
  /** Log seam for tests. Defaults to console.log. */
  log?: (message: string) => void;
}

export async function runEnableWriteCommand(argv: string[], deps: WriteCommandDeps = {}): Promise<number> {
  return runWriteToggleCommand(true, argv, deps);
}

export async function runDisableWriteCommand(argv: string[], deps: WriteCommandDeps = {}): Promise<number> {
  return runWriteToggleCommand(false, argv, deps);
}

export async function runAccessCommand(argv: string[], deps: WriteCommandDeps = {}): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    (deps.log ?? console.log)(ACCESS_USAGE);
    return 0;
  }
  const access = argv[0];
  if (access !== "readonly" && access !== "full") {
    (deps.log ?? console.error)("Invalid access mode. Use gsc setup access readonly|full. Nothing was changed.");
    return 1;
  }
  return runWriteToggleCommand(access === "full", argv.slice(1), deps, access);
}

async function runWriteToggleCommand(enable: boolean, argv: string[], deps: WriteCommandDeps, access?: "readonly" | "full"): Promise<number> {
  const command = access !== undefined ? "access" : enable ? "enable-write" : "disable-write";
  let opts: WriteToggleOptions;
  try {
    opts = parseWriteToggleArgs(argv, command);
  } catch {
    // Static message only: the rejected token may hold sensitive text.
    console.error(`Setup failed: unknown or invalid ${command} option. Run setup ${command} --help for usage.`);
    return 1;
  }
  if (opts.help) {
    console.log(access !== undefined ? ACCESS_USAGE : WRITE_TOGGLE_USAGE);
    return 0;
  }
  const log = deps.log ?? ((message: string): void => console.log(message));
  let prompter: PromptAdapter | null = null;
  let confirm = deps.confirm;
  if (!confirm) {
    // terminalPromptAdapter(opts.yes) with --yes never prompts (returns the
    // fallback), so holding one adapter for the whole command is inert.
    prompter = terminalPromptAdapter(opts.yes);
    const active: PromptAdapter = prompter;
    confirm = (question: string): Promise<string> => active.text(question, "n");
  }
  try {
    let targets: string[];
    try {
      targets = resolveWriteTargets(opts.clients, { ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}) });
    } catch (err) {
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
      if (isFileTarget(target) && target !== "opencode") {
        const configPath = resolveFileConfigPath(target, deps.homeDir);
        if (!configPath) {
          log(`\nCannot safely locate the ${target} config on this machine; falling back to manual steps.`);
          log(access !== undefined ? accessManualGuidance(access) : printWriteManualFragment(enable));
          continue;
        }
        let entryEnv: Record<string, unknown>;
        try {
          const rawEnv: unknown = readGscEntry(configPath).entry.env;
          if (rawEnv === undefined || rawEnv === null) {
            entryEnv = {};
          } else if (typeof rawEnv === "object" && !Array.isArray(rawEnv)) {
            entryEnv = rawEnv as Record<string, unknown>;
          } else {
            throw new Error("Existing gsc entry has a non-object env; fix it first. Nothing was changed.");
          }
        } catch (err) {
          log(err instanceof Error ? err.message : String(err));
          ok = false;
          continue;
        }
        let changed: boolean;
        try {
          changed = (access !== undefined ? updateGscEnvForAccess(entryEnv, access) : updateGscEnvForWrite(entryEnv, enable)).changed;
        } catch (err) {
          log(err instanceof Error ? err.message : "Cannot update access. Nothing was changed.");
          ok = false;
          continue;
        }
        if (enable && classifyWriteTier(entryEnv) === "shared") {
          log(`\n${SHARED_WRITE_REFUSAL}`);
          ok = false;
          continue;
        }
        if (enable && changed) {
          log(`\n${ENABLE_WRITE_WARNING}`);
          const scopes = typeof entryEnv.GSC_SCOPES === "string" ? entryEnv.GSC_SCOPES : (process.env.GSC_SCOPES ?? "");
          if (access === undefined && scopes.toLowerCase() !== "full") log(SCOPES_FULL_NOTE);
        }
        const applied = await applyWriteFileConfig({
          configPath,
          serverName: SETUP_SERVER_NAME,
          enable,
          ...(access !== undefined ? { access } : {}),
          force: opts.force,
          yes: opts.yes,
          dryRun: opts.dryRun,
          confirm,
          log,
        });
        if (applied && !opts.dryRun && changed) {
          if (access !== undefined) log("The access change may require gsc auth login with the same client settings; readonly rejects tokens with write grants.");
          log(verifyHint(CLIENT_LABELS[target] ?? target));
        }
        if (!applied) ok = false;
      } else if (target === "opencode") {
        log(access !== undefined
          ? `opencode stores the entry under the global "mcp" key with an "environment" map; edit ~/.config/opencode/opencode.json manually. ${accessManualGuidance(access)}\n${verifyHint(CLIENT_LABELS[target] ?? target)}`
          : printWriteManualFragment(enable));
      } else if (isCliTarget(target)) {
        log(access !== undefined
          ? `${target} is CLI-managed; no command is invoked. ${accessManualGuidance(access)}\n${verifyHint(CLIENT_LABELS[target] ?? target)}`
          : cliWriteGuidance(target, enable));
      } else {
        log(access !== undefined ? accessManualGuidance(access) : printWriteManualFragment(enable));
        log(verifyHint("your MCP client"));
      }
    }
    return ok ? 0 : 1;
  } finally {
    prompter?.close();
  }
}
