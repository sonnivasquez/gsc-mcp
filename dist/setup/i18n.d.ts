/**
 * Setup locale infrastructure (T01) plus the core guided-journey catalog (T02).
 *
 * English is the canonical language and the complete fallback catalog;
 * Spanish is the supported translation. Machine-facing flags, identifiers,
 * and configuration keys stay in English in every locale.
 *
 * Resolution precedence: an explicit `--language` option first, otherwise
 * the first non-empty process locale environment value in `LC_ALL`,
 * `LC_MESSAGES`, `LANG` order, then the runtime `Intl` default locale only
 * when all three are absent or empty, then English. Spanish language tags
 * select `es`; `C`, `POSIX`, unsupported, and malformed values select `en`.
 *
 * T01 localized only `--help`. T02 migrates the core journey (welcome and
 * privacy introduction, step-oriented authentication/access copy, credential
 * guidance, property selection/warnings/confirmations, client-choice prompt,
 * and controlled failure rendering) onto the translation API provided here.
 * T03 migrates first-install target-application messages (safe preview
 * labels, confirmation prompts, dry-run notices, fallback, restart, and
 * backup guidance) onto the same API. T04 migrates skill-install and
 * sample-query outcome copy, `formatFinishReport`, final target
 * verification details, and concise completion guidance onto the same API.
 */
export type SetupLocale = "en" | "es";
export declare const SETUP_LOCALES: readonly SetupLocale[];
export declare const DEFAULT_SETUP_LOCALE: SetupLocale;
export declare const INVALID_SETUP_LANGUAGE_ERROR = "Invalid --language value. Use en or es.";
/** Static failure for a missing --language value. Never echoes input. */
export declare const MISSING_SETUP_LANGUAGE_ERROR = "--language needs a value. Run with --help for usage.";
/**
 * Map one locale tag or locale form to a supported setup locale.
 * Spanish language tags select `es`; everything else (unsupported, empty,
 * `C`, `POSIX`, malformed, non-string) selects `en`.
 */
export declare function parseLocaleTag(value: unknown): SetupLocale;
/** Explicit `--language` values that count as "not provided". */
export type SetupLanguageOption = SetupLocale | null | undefined;
/**
 * Resolve the setup locale. An explicit `--language` option wins; otherwise
 * the first non-empty environment value in `LC_ALL`, `LC_MESSAGES`,
 * `LANG` order is decisive (`es` for Spanish tags, `en` for `C`, `POSIX`,
 * unsupported, or malformed values, so a present env locale never consults
 * `Intl`). Only when all three variables are absent or empty does the
 * runtime `Intl` default locale apply, and anything else falls back to
 * `en`. The env mapping and the `Intl` locale are injectable so tests stay
 * deterministic regardless of the developer machine locale; pass
 * `undefined` as `systemLocale` to exercise the live `Intl` default.
 */
export declare function resolveSetupLocale(explicit?: SetupLanguageOption, env?: NodeJS.ProcessEnv | Record<string, string | undefined>, systemLocale?: string | null): SetupLocale;
/**
 * Validate one raw `--language` flag value. Returns the locale for `en`
 * and `es`; throws a static, input-free error otherwise (including a
 * missing value) so rejected text is never echoed.
 */
export declare function parseSetupLanguage(value: string | undefined): SetupLocale;
/**
 * Core guided-journey catalog (T02). English is canonical and complete;
 * Spanish translates human-facing core copy only. Flags, option values
 * (`shared`, `custom`, `service-account`, `readonly`, `full`, `all`),
 * URLs, config/env keys, product/package names, property
 * identifiers, and JSON machine output stay exact in both locales.
 * Structured status IDs (`runtime`, `auth`, `api`, `properties`,
 * `write_ops`, `clients`, `tools`, `setup_error`) are never translated.
 * Skill-install, sample-query, finish-verification, and completion copy
 * migrated in T04 lives at the end of this catalog; only the surrounding
 * human-facing copy is localized there.
 */
export interface SetupCatalog {
    usage: string;
    /** Full flag reference (`setup --help --verbose`); every documented flag. */
    usageVerbose: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    /** Numbered journey stages: recommended safe default first. */
    stageAuth: string;
    stageProperties: string;
    stageClients: string;
    /** Step 1 lists print numbered rows like steps 2/3; `full` is explained only where chosen. */
    authTitle: string;
    authOptionShared: string;
    authOptionCustom: string;
    authOptionService: string;
    accessTitle: string;
    accessOptionReadonly: string;
    accessOptionFull: string;
    accessOptionFullExplained: string;
    choosePrompt: string;
    writeConfirm: string;
    authSharedNote: string;
    customGuideTitle: string;
    customGuideStep1: string;
    customGuideStep2: string;
    customGuideStep3: string;
    /** `{url}` stays the exact walkthrough URL. */
    customWalkthrough: string;
    secretsPrompt: string;
    keyFilePrompt: string;
    clientSecretsPrompt: string;
    /** `{path}` is the exact resolved path, never translated. */
    usingOAuthClient: string;
    scopeReadonly: string;
    scopeFull: string;
    allSitesPreview: string;
    /** `{count}` is the exact property count. */
    connectedOne: string;
    connectedMany: string;
    selectedAllCount: string;
    allowAllSelected: string;
    noPropertiesManual: string;
    manualPropertyPrompt: string;
    manualPropertyRequired: string;
    /** `{site}` is the exact stored identifier. */
    singleProperty: string;
    /** `{count}` is the exact property count. */
    propertySelect: string;
    /** Label for the `[0]` allow-all row in the interactive property list. */
    propertyAllOption: string;
    selectedCountOne: string;
    selectedCountMany: string;
    /** `{site}`/`{count}` stay exact; only surrounding copy is localized. */
    unlistedWarning: string;
    clientTitle: string;
    clientPrompt: string;
    clientPrintLabel: string;
    allowAllWarning: string;
    allowAllConfirm: string;
    allowAllNotConfirmed: string;
    secretsNotFoundFlag: string;
    secretsNotFoundPath: string;
    noCredentials: string;
    /** Generic fail-closed line for unknown/upstream errors. */
    genericFailure: string;
    /**
     * First-install client-target application copy (T03). English is
     * canonical and byte-identical to the historical helper wording;
     * Spanish translates human-facing terminal copy only. Placeholders
     * (`{target}`, `{path}`, `{server}`, `{dir}`, `{backup}`, `{command}`,
     * `{program}`, `{steps}`) always render exact machine values: paths,
     * commands/argv, JSON, `mcpServers.gsc`, target names, `[redacted]`,
     * package/config keys, and backup paths are never translated.
     * Structured `TargetOutcome.status` values and English internal notes
     * are not part of this catalog and stay unchanged.
     */
    targetPrintHeading: string;
    targetConfigUnavailable: string;
    targetRestartDesktop: string;
    targetRestartCursor: string;
    targetRestartOpencode: string;
    targetRestartPi: string;
    targetCliFallbackHeading: string;
    targetManualCommand: string;
    fileConfigFile: string;
    filePreviewExisting: string;
    filePreviewNew: string;
    fileNoExisting: string;
    fileUnreadable: string;
    fileDryRun: string;
    fileConfirmOverwrite: string;
    fileConfirmNew: string;
    fileSkipped: string;
    fileBackup: string;
    fileCouldNotRead: string;
    fileInvalidJson: string;
    fileBackupFailed: string;
    fileMkdirFailed: string;
    fileStageFailedExisting: string;
    fileStageFailedNew: string;
    fileReplaceFailedExisting: string;
    fileReplaceFailedNew: string;
    /**
     * Localized rendering of the `mergeGscEntry`/`mergeOpencodeEntry`
     * validation failures for first-install Spanish. The setup helper layer
     * forwards these to `ClientConfigText.mergeInvalidRoot` /
     * `mergeInvalidServers` / `mergeInvalidMcp`; only the exact canonical
     * errors map and unknown text stays fail-closed. The `mcpServers` and
     * `mcp` keys stay exact in both locales.
     */
    fileMergeInvalidRoot: string;
    fileMergeInvalidServers: string;
    fileMergeInvalidMcp: string;
    fileConfigured: string;
    cliDryRunPreview: string;
    cliDryRunNote: string;
    cliConfirm: string;
    cliSkipped: string;
    cliLaunchFailed: string;
    cliNotFound: string;
    cliAddFailed: string;
    cliConfigured: string;
    /**
     * Skill-install, sample-query, finish-verification, and completion copy
     * (T04). English is canonical and byte-identical to the historical
     * helper wording; Spanish translates human-facing terminal copy only.
     * Placeholders (`{skill}`, `{spec}`, `{command}`, `{agents}`,
     * `{missing}`, `{program}`, `{site}`, `{start}`, `{end}`, `{status}`,
     * `{detail}`, `{count}`, `{expected}`, `{visible}`, `{clicks}`,
     * `{impressions}`, `{sites}`, `{targets}`, `{parts}`, `{path}`,
     * `{mode}`, `{scope}`) always render exact machine values: skill
     * statuses/codes (`installed`, `previewed`, `failed`, `unsupported`,
     * `missing_bundle`, `launch_error`, `cli_missing`, `exit_nonzero`),
     * sample statuses/codes (`ok`, `no_data`, `permission_denied`,
     * `timeout`, `query_error`), section IDs, `[ok]`/`[!!]` markers,
     * dates/counts, commands/argv, paths, URLs, flags, package/skill names,
     * client/agent names, tool counts, env/config keys, and
     * machine-readable JSON are never translated. Structured
     * `TargetOutcome` notes stay English and are never built here.
     */
    skillConfirm: string;
    skillListTitle: string;
    skillListAll: string;
    skillAgentClaudeCode: string;
    skillAgentCursor: string;
    skillAgentCodex: string;
    skillListSkip: string;
    skillListPrompt: string;
    skillInvalidSelection: string;
    skillSkippedFlag: string;
    skillSkipped: string;
    skillFailed: string;
    skillDryRunPreview: string;
    skillDryRunNote: string;
    skillUnsupported: string;
    skillMissing: string;
    skillLaunchError: string;
    skillCliMissing: string;
    skillExitNonzero: string;
    skillInstalling: string;
    skillInstalled: string;
    skillDetailInstalled: string;
    skillDetailInstalledNoAgents: string;
    skillDetailPreview: string;
    skillDetailUnsupported: string;
    skillDetailMissing: string;
    skillDetailLaunch: string;
    skillDetailCliMissing: string;
    skillDetailExit: string;
    sampleAllowAllSkip: string;
    sampleSkippedFlag: string;
    sampleConfirm: string;
    sampleSkipped: string;
    sampleResult: string;
    sampleDryRunFlag: string;
    sampleDryRunSkip: string;
    sampleOk: string;
    sampleNoData: string;
    sampleDenied: string;
    sampleTimeout: string;
    sampleQueryError: string;
    finishAuth: string;
    finishHeader: string;
    finishHeaderDryRun: string;
    finishHeaderFailed: string;
    finishHeaderDryRunFailed: string;
    finishWriteAccessFull: string;
    finishWriteAccessReadonly: string;
    finishWriteLegacyEnabled: string;
    finishWriteLegacyDisabled: string;
    finishToolsOk: string;
    finishToolsMismatch: string;
    finishApiDryRun: string;
    finishApiOkOne: string;
    finishApiOkMany: string;
    finishApiEmpty: string;
    finishPropsPreviewOne: string;
    finishPropsPreviewMany: string;
    finishPropsNone: string;
    finishPropsUnverifiedOne: string;
    finishPropsUnverifiedMany: string;
    finishPropsAllOne: string;
    finishPropsAllMany: string;
    finishPropsPartial: string;
    finishClientsNone: string;
    finishClientsDryPreviewed: string;
    finishClientsDryPrinted: string;
    finishClientsDrySkipped: string;
    finishClientsDryFailed: string;
    finishClientsDryApplied: string;
    finishClientsDryWrap: string;
    finishClientsConfigured: string;
    finishClientsPrinted: string;
    finishClientsPreviewed: string;
    finishClientsSkipped: string;
    finishClientsFailed: string;
    finishDone: string;
    finishToken: string;
    finishRevoke: string;
    finishReauth: string;
}
export declare const SETUP_STRINGS: Record<SetupLocale, SetupCatalog>;
/** Message keys available on top of the T01 help text. */
export type SetupMessageKey = keyof SetupCatalog;
/**
 * Return localized help text; short by default, full flag reference with
 * `verbose` (`setup --help --verbose`). Only the optional Skills CLI varies
 * by runtime.
 */
export declare function getSetupUsage(locale: SetupLocale, verbose?: boolean): string;
/**
 * Look up one catalog key for a locale with English fallback. Carries an
 * optional `{name}` interpolation payload for T02 messages.
 */
export declare function translateSetup(locale: SetupLocale, key: SetupMessageKey, vars?: Readonly<Record<string, string | number>>): string;
/**
 * Interpolate `{name}` placeholders with the supplied values. Unknown
 * placeholders are left intact so missing values stay visible in tests
 * instead of silently vanishing.
 */
export declare function formatSetupMessage(template: string, vars?: Readonly<Record<string, string | number>>): string;
/**
 * Locale-aware affirmative handling for core journey confirmations
 * (auth/write opt-in and allow-all confirmations). English accepts `y` and
 * `yes`; Spanish additionally accepts `s`, `si`, and `sí`. Matching is
 * case- and whitespace-tolerant. The default stays "no": empty and
 * negative answers decline in both locales. Skill-install and sample-query
 * confirmations keep their English-only parsers until T04.
 */
export declare function isSetupAffirmative(answer: string, locale: SetupLocale): boolean;
/**
 * Localize one controlled static setup error message. Returns the English
 * canonical message for `en`, the Spanish rendering for `es`, and `null`
 * for unknown messages (including the two bounded numeric selection
 * patterns when they do not match their anchored shapes) so callers map
 * them to the generic fail-closed error with no raw text.
 */
export declare function localizeSetupErrorMessage(message: string, locale: SetupLocale): string | null;
