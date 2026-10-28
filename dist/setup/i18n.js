"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETUP_STRINGS = exports.MISSING_SETUP_LANGUAGE_ERROR = exports.INVALID_SETUP_LANGUAGE_ERROR = exports.DEFAULT_SETUP_LOCALE = exports.SETUP_LOCALES = void 0;
exports.parseLocaleTag = parseLocaleTag;
exports.resolveSetupLocale = resolveSetupLocale;
exports.parseSetupLanguage = parseSetupLanguage;
exports.getSetupUsage = getSetupUsage;
exports.translateSetup = translateSetup;
exports.formatSetupMessage = formatSetupMessage;
exports.isSetupAffirmative = isSetupAffirmative;
exports.localizeSetupErrorMessage = localizeSetupErrorMessage;
// Reuse runtime detection only for the optional, separately installed Skills CLI.
const client_config_js_1 = require("../client-config.js");
const version_js_1 = require("../version.js");
exports.SETUP_LOCALES = ["en", "es"];
exports.DEFAULT_SETUP_LOCALE = "en";
exports.INVALID_SETUP_LANGUAGE_ERROR = "Invalid --language value. Use en or es.";
/** Static failure for a missing --language value. Never echoes input. */
exports.MISSING_SETUP_LANGUAGE_ERROR = "--language needs a value. Run with --help for usage.";
/**
 * Extract the primary language subtag from a locale tag or locale form.
 * Handles `es`, `es-ES`, `es_ES`, `es_ES.UTF-8`, `es-419`, `es@modifier`,
 * and case variants. Returns the lowercased primary subtag (`""` when none).
 */
function primaryLanguageSubtag(value) {
    const withoutModifier = value.split("@")[0] ?? "";
    const withoutEncoding = withoutModifier.split(".")[0] ?? "";
    const primary = withoutEncoding.split(/[_-]/)[0] ?? "";
    return primary.trim().toLowerCase();
}
/**
 * Map one locale tag or locale form to a supported setup locale.
 * Spanish language tags select `es`; everything else (unsupported, empty,
 * `C`, `POSIX`, malformed, non-string) selects `en`.
 */
function parseLocaleTag(value) {
    if (typeof value !== "string")
        return exports.DEFAULT_SETUP_LOCALE;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "C" || trimmed === "POSIX")
        return exports.DEFAULT_SETUP_LOCALE;
    return primaryLanguageSubtag(trimmed) === "es" ? "es" : exports.DEFAULT_SETUP_LOCALE;
}
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
function resolveSetupLocale(explicit, env = process.env, systemLocale) {
    if (explicit === "en" || explicit === "es")
        return explicit;
    for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
        const raw = env[key];
        if (typeof raw !== "string")
            continue;
        if (raw.trim() === "")
            continue;
        return parseLocaleTag(raw);
    }
    return parseLocaleTag(systemLocale === undefined ? readSystemLocale() : systemLocale);
}
/**
 * Read the runtime default locale without touching the process environment.
 * Never throws: an unreadable `Intl` default resolves to `undefined` so the
 * caller falls back to English.
 */
function readSystemLocale() {
    try {
        const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
        return typeof tag === "string" && tag.trim() !== "" ? tag : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Validate one raw `--language` flag value. Returns the locale for `en`
 * and `es`; throws a static, input-free error otherwise (including a
 * missing value) so rejected text is never echoed.
 */
function parseSetupLanguage(value) {
    if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(exports.MISSING_SETUP_LANGUAGE_ERROR);
    }
    if (value !== "en" && value !== "es") {
        throw new Error(exports.INVALID_SETUP_LANGUAGE_ERROR);
    }
    return value;
}
const USAGE_EN = `
Usage: gsc setup [options]

Guided setup for the GSC MCP server. Signs you in with Google, checks the
connection works, and writes the config for a supported MCP client.

Options:
  --client <target>   Where to install (repeatable or comma-separated):
                      desktop, code, cursor, codex, opencode, pi, generic, print, both
                      (both = desktop + code; print/generic only print JSON)
                      Labels: Claude Desktop (app), Claude Code (terminal),
                      Cursor (editor), Codex (terminal), OpenCode, Pi (OhMyPi).
  --access <mode>     readonly (default) or full (includes Google write operations)
                      Quick Connect supports readonly only.
  --scopes <tier>     Deprecated legacy scope selection; prefer --access.
  --site <property>   Exact Search Console property (repeatable; each flag is
                      one identifier and is never comma-split). Accepted forms
                      are sc-domain:... or an http(s):// URL, or 'all' alone
                      for all current + future properties (explicit opt-in,
                      e.g. --site all; mixed 'all' with identifiers is rejected).
                      Identifiers are stored byte-for-byte, e.g.
                      sc-domain:example.com or https://example.com/
  --first-query       After setup, run one minimal sample query on the first
                      selected property (last 7 days, date breakdown, up to 5
                      rows). Explicit opt-in only: --yes never enables it.
                      Skipped in --dry-run.
  --install-skill     Install the google-search-console-mcp agent skill
                      globally with the pinned Skills CLI (npx --yes
                      skills@1.7.0 add <skills-dir> --global
                      --skill google-search-console-mcp [--agent X]* --yes).
                      Explicit opt-in only: --yes never enables it.
                      In --dry-run the exact command is previewed and nothing
                      is invoked. Maps compatible targets: code->claude-code,
                      cursor->cursor, codex->codex (opencode/pi/desktop/generic/
                      print select no skill and fail nothing). A skill failure
                      exits nonzero without changing the MCP config.
  --all-sites         Select every property from one sites.list call.
                      Use either --site or --all-sites, not both. In --dry-run
                      the allowlist cannot be enumerated without network, so
                      the preview omits GSC_SITE_URLS and says so.
  --auth <mode>       shared (Quick Connect), custom, or service-account
  --secrets <path>    Path to your Desktop OAuth client JSON (--auth custom)
  --key-file <path>   Path to your service account JSON (--auth service-account)
  --enable-write      Deprecated legacy write opt-in; ignored with --access.
  --reauth            Discard the cached token and sign in again
  --force             Overwrite an existing gsc entry without asking
  --dry-run           Show what would be written without signing in or writing
  --verbose           Show full detail (JSON entries, paths, finish
                      verification, skill/sample notes). Default is quiet:
                      title, one line per step, one result line.
  --yes               Accept defaults for any prompt not covered by a flag
  --language <locale> en (default) or es. Flag values stay in English.
                      Invalid values fail without echoing input.
                      Overrides LC_ALL/LC_MESSAGES/LANG detection.
  --help              Show this help

Subcommands (visible write opt-in; no Google sign-in needed):
  setup access readonly|full  Set one access mode on an existing client entry
  setup enable-write  Deprecated: add legacy GSC_ENABLE_WRITE=1
                      (warns, confirms, refuses Quick Connect installs)
  setup disable-write Deprecated: remove legacy GSC_ENABLE_WRITE
                      (confirms; no warning beyond the confirm)
  All accept --client/--dry-run/--yes/--force. Run with --help for details.

Property allowlist: one default property, repeatable --site for many exact
identifiers, '--site all' alone for all current + future properties
(explicit opt-in covering future properties; mixed 'all' is rejected), or
--all-sites for every discovered property enumerated once. Interactively the
list shows [1..N] plus [0] All current + future (explicit opt-in, warned and
double-confirmed); Enter selects [1] (least privilege). Stored as a
JSON-string-array GSC_SITE_URLS so identifiers containing commas survive
exactly (the allow-all sentinel stays exactly '["all"]'); legacy
comma-separated values are still read. Bare 'all' is also read (any
case/whitespace) as the same sentinel.
File destinations (desktop, cursor, opencode, pi) preview the change, confirm,
keep a timestamped backup, and merge only the destination key
(mcpServers.gsc for desktop/cursor/pi; mcp.gsc for the OpenCode global file
~/.config/opencode/opencode.json with {type:local, command:[...],
environment:{...}, enabled:true}; Pi uses the global ~/.omp/agent/mcp.json).
CLI destinations (code, codex) preview the exact argv and never run through
a shell. When a target cannot be safely configured, setup falls back to
printed generic JSON.

Quiet by default (title, one line per step, one result line); --verbose
shows full detail (JSON entries, paths, finish verification, skill/sample
notes). Finish verification reuses the single sites.list call (no second
Google call) and reports runtime, auth, API reachability, selected
properties, write state, client targets, and the 34-tool catalog. The sample
query is never bulk and never prints query strings; without permission or
data it reports honestly instead of claiming success.

Google API requests run on this machine; tool responses go to your MCP client
and its AI provider. Review https://gscmcp.dev/privacy and their retention and
training settings before connecting. Quick Connect is read-only; writes require
Custom OAuth or a service account. Tokens are cached locally in ~/.gsc-mcp/
and sent to Google for authentication.
`.trim();
const USAGE_ES = `
Usage: gsc setup [options]

Configuración guiada del servidor GSC MCP. Inicia sesión con Google, comprueba
que la conexión funciona y escribe la configuración para un cliente MCP compatible.

Opciones:
  --client <target>   Dónde instalar (repetible o separado por comas):
                      desktop, code, cursor, codex, opencode, pi, generic, print, both
                      (both = desktop + code; print/generic solo imprimen JSON)
                      Etiquetas: Claude Desktop (app), Claude Code (terminal),
                      Cursor (editor), Codex (terminal), OpenCode, Pi (OhMyPi).
  --access <mode>     readonly (predeterminado) o full (incluye operaciones de escritura de Google)
                      Quick Connect solo admite readonly.
  --scopes <tier>     Selección de alcance heredada y obsoleta; prefiera --access.
  --site <property>   Propiedad exacta de Search Console (repetible; cada indicador es
                      un identificador y nunca se divide por comas). Las formas aceptadas
                      son sc-domain:... o una URL http(s)://, o 'all' por sí solo
                      para todas las propiedades actuales y futuras (aceptación explícita,
                      p. ej. --site all; 'all' combinado con identificadores se rechaza).
                      Los identificadores se almacenan byte por byte, p. ej.
                      sc-domain:example.com o https://example.com/
  --first-query       Después de la configuración, ejecuta una consulta mínima de muestra en la
                      primera propiedad seleccionada (últimos 7 días, desglose por fecha, hasta 5
                      filas). Solo con aceptación explícita: --yes nunca la activa.
                      Se omite en --dry-run.
  --install-skill     Instala la agent skill google-search-console-mcp
                      globalmente con el Skills CLI fijado (npx --yes
                      skills@1.7.0 add <skills-dir> --global
                      --skill google-search-console-mcp [--agent X]* --yes).
                      Solo con aceptación explícita: --yes nunca la activa.
                      En --dry-run se previsualiza el comando exacto y no se
                      invoca nada. Asigna los destinos compatibles: code->claude-code,
                      cursor->cursor, codex->codex (opencode/pi/desktop/generic/
                      print no seleccionan skill y no fallan). Si la skill falla, el proceso
                      termina con un código distinto de cero sin cambiar la configuración MCP.
  --all-sites         Selecciona cada propiedad a partir de una llamada sites.list.
                      Use --site o --all-sites, no ambos. En --dry-run
                      la lista no se puede enumerar sin red, por lo que
                      la previsualización omite GSC_SITE_URLS y lo indica.
  --auth <mode>       shared (Quick Connect), custom, o service-account
  --secrets <path>    Ruta al JSON del cliente OAuth de escritorio (--auth custom)
  --key-file <path>   Ruta al JSON de la cuenta de servicio (--auth service-account)
  --enable-write      Aceptación de escritura heredada y obsoleta; se ignora con --access.
  --reauth            Descarta el token almacenado e inicia sesión de nuevo
  --force             Sobrescribe una entrada gsc existente sin preguntar
  --dry-run           Muestra lo que se escribiría sin iniciar sesión ni escribir
  --verbose           Muestra el detalle completo (entradas JSON, rutas,
                      verificación final, notas de skill/muestra). Por defecto
                      es silencioso: título, una línea por paso, una línea de resultado.
  --yes               Acepta los valores predeterminados de cualquier pregunta no cubierta por un indicador
  --language <locale> en (predeterminado) o es. Los valores del indicador siguen en
                      inglés. Los valores no válidos fallan sin repetir la entrada.
                      Tiene prioridad sobre la detección LC_ALL/LC_MESSAGES/LANG.
  --help              Muestra esta ayuda

Subcomandos (aceptación de escritura visible; no se necesita inicio de sesión en Google):
  setup access readonly|full  Establece un modo de acceso en una entrada de cliente existente
  setup enable-write  Obsoleto: añade el heredado GSC_ENABLE_WRITE=1
                      (advierte, confirma, rechaza instalaciones Quick Connect)
  setup disable-write Obsoleto: elimina el heredado GSC_ENABLE_WRITE
                      (confirma; sin más avisos además de la confirmación)
  Todos aceptan --client/--dry-run/--yes/--force. Ejecute con --help para más detalles.

Propiedades permitidas: una propiedad predeterminada, --site repetible para muchos identificadores
exactos, '--site all' por sí solo para todas las propiedades actuales y futuras
(aceptación explícita que cubre las propiedades futuras; 'all' combinado se rechaza), o
--all-sites para cada propiedad descubierta enumerada una vez. En modo interactivo la
lista muestra [1..N] más [0] Todas las actuales y futuras (aceptación explícita,
con aviso y doble confirmación); Enter selecciona [1] (mínimo privilegio). Se almacena
como arreglo JSON en GSC_SITE_URLS para que los identificadores que contienen comas
sobrevivan exactamente (el centinela de permitir todo sigue siendo exactamente '["all"]');
los valores heredados separados por comas aún se leen. 'all' simple también se lee
(cualquier mayúscula o espacio) como el mismo centinela.
Los destinos de archivo (desktop, cursor, opencode, pi) previsualizan el cambio,
confirman, conservan una copia de seguridad con marca de tiempo y combinan solo la
clave del destino (mcpServers.gsc para desktop/cursor/pi; mcp.gsc para el archivo
global de OpenCode ~/.config/opencode/opencode.json con {type:local, command:[...],
environment:{...}, enabled:true}; Pi usa el global ~/.omp/agent/mcp.json).
Los destinos CLI (code, codex) previsualizan el argv exacto y nunca pasan por un
shell. Cuando un destino no se puede configurar de forma segura, la configuración
recurre al JSON genérico impreso.

Silencioso por defecto (título, una línea por paso, una línea de resultado);
--verbose muestra el detalle completo (entradas JSON, rutas, verificación final,
notas de skill/muestra). La verificación final reutiliza la única llamada sites.list
(sin segunda llamada a Google) e informa el tiempo de ejecución, la autenticación,
el alcance de la API, las propiedades seleccionadas, el estado de escritura, los
destinos de cliente y el catálogo de 34 herramientas. La consulta de muestra nunca
es masiva y nunca imprime cadenas de consulta; sin permiso o sin datos, lo informa
honestamente en lugar de afirmar éxito.

Las solicitudes a Google se ejecutan en esta máquina; las respuestas llegan a
su cliente MCP y su proveedor de IA. Antes de conectar, revise
https://gscmcp.dev/privacy y sus ajustes de retención y entrenamiento.
Quick Connect solo permite lectura; las escrituras requieren OAuth propio o
service account. Los tokens se guardan en ~/.gsc-mcp/ y se envían a Google
para la autenticación.
`.trim();
const USAGE_SHORT_EN = `
Usage: gsc setup [options]

Guided setup in 3 steps: sign in with Google, choose Search Console
properties, and choose where to install. Quiet by default.

Options:
  --client <target>   Where to install (repeatable or comma-separated):
                      desktop, code, cursor, codex, opencode, pi, generic, print, both
  --access <mode>     readonly (default) or full (includes Google write operations)
  --site <property>   Exact Search Console property (repeatable), or 'all' alone
                      for all current + future properties (explicit opt-in)
  --all-sites         Select every property from one sites.list call
  --auth <mode>       shared (Quick Connect), custom, or service-account
  --secrets <path>    Desktop OAuth client JSON (--auth custom)
  --key-file <path>   Service account JSON (--auth service-account)
  --dry-run           Preview without signing in or writing
  --verbose           Show full detail (JSON, paths, verification)
  --yes               Accept defaults (never enables writes, skill, or sample query)
  --language <locale> en (default) or es
  --help              Show this help (add --verbose for every flag)

Examples:
  gsc setup
  gsc setup --client code --dry-run

Subcommands: setup access readonly|full, setup enable-write, setup disable-write.
`.trim();
const USAGE_SHORT_ES = `
Usage: gsc setup [options]

Configuración guiada en 3 pasos: inicia sesión con Google, elige las
propiedades de Search Console y elige dónde instalar. Silencioso por defecto.

Opciones:
  --client <target>   Dónde instalar (repetible o separado por comas):
                      desktop, code, cursor, codex, opencode, pi, generic, print, both
  --access <mode>     readonly (predeterminado) o full (incluye operaciones de escritura de Google)
  --site <property>   Propiedad exacta de Search Console (repetible), o 'all' por sí solo
                      para todas las propiedades actuales y futuras (aceptación explícita)
  --all-sites         Selecciona cada propiedad a partir de una llamada sites.list
  --auth <mode>       shared (Quick Connect), custom, o service-account
  --secrets <path>    JSON del cliente OAuth de escritorio (--auth custom)
  --key-file <path>   JSON de la cuenta de servicio (--auth service-account)
  --dry-run           Previsualiza sin iniciar sesión ni escribir
  --verbose           Muestra el detalle completo (JSON, rutas, verificación)
  --yes               Acepta los valores predeterminados (nunca activa escrituras, skill ni consulta de muestra)
  --language <locale> en (predeterminado) o es
  --help              Muestra esta ayuda (añade --verbose para todos los indicadores)

Ejemplos:
  gsc setup
  gsc setup --client code --dry-run

Subcomandos: setup access readonly|full, setup enable-write, setup disable-write.
`.trim();
const CORE_EN = {
    welcomeTitle: "GSC MCP Local setup",
    welcomeSubtitle: "Free and open source. Google API requests run on this machine; tool responses go to your MCP client and its AI provider. Before connecting, review https://gscmcp.dev/privacy and their retention and training settings. Quick Connect is read-only; writes require Custom OAuth or a service account.",
    stageAuth: "Step 1 of 3 — Sign in (recommended: Quick Connect, read-only)",
    stageProperties: "Step 2 of 3 — Choose Search Console properties",
    stageClients: "Step 3 of 3 — Choose where to install",
    authTitle: "Authentication?",
    authOptionShared: "Quick Connect (recommended, read-only, no indexing)",
    authOptionCustom: "Custom OAuth (full access, indexing)",
    authOptionService: "Service Account (full access, indexing)",
    accessTitle: "Access level?",
    accessOptionReadonly: "Read only (data only)",
    accessOptionFull: "Full (data + indexing)",
    accessOptionFullExplained: "Full (data + indexing, includes Google writes)",
    choosePrompt: "Choose [1]: ",
    writeConfirm: "Enable Google write operations separately? [y/N] ",
    authSharedNote: "Using the built in Google sign in. No Google Cloud setup needed.",
    customGuideTitle: "This build has no embedded OAuth client yet, so you need your own (5 minutes, one time):",
    customGuideStep1: "  1. console.cloud.google.com > create a project > enable the Search Console API",
    customGuideStep2: "  2. Credentials > Create credentials > OAuth client ID > Desktop app",
    customGuideStep3: "  3. Download the JSON file",
    customWalkthrough: "Full walkthrough: {url}",
    secretsPrompt: "Path to your client secrets JSON file: ",
    keyFilePrompt: "Path to service account JSON file: ",
    clientSecretsPrompt: "Path to your client secrets JSON file: ",
    usingOAuthClient: "Using OAuth client from {path}.",
    scopeReadonly: "Read only access. The consent screen will show a single view permission.",
    scopeFull: "Full access. Includes sitemap submission and the Indexing API.",
    allSitesPreview: "[dry run] --all-sites: the live setup stores every exact identifier from one sites.list call; no allowlist to preview without network.",
    connectedOne: "Connected. Your Google account has 1 Search Console property.",
    connectedMany: "Connected. Your Google account has {count} Search Console properties.",
    selectedAllCount: "Selected all {count} properties.",
    allowAllSelected: 'Selected all current + future properties (explicit opt-in: "all").',
    noPropertiesManual: "No properties found on this account. You can still set one manually.",
    manualPropertyPrompt: "Dashboard property (e.g. sc-domain:yoursite.com): ",
    manualPropertyRequired: "A dashboard property is required. Re-run setup once the Google account has GSC access.",
    singleProperty: "Dashboard property: {site}",
    propertySelect: 'Select properties: numbers comma-separated (e.g. 1,3), "0" or "all" for all current + future properties (explicit opt-in), or Enter for default [1]: ',
    propertyAllOption: "All current + future properties (explicit opt-in)",
    selectedCountOne: "Selected 1 property: {sites}",
    selectedCountMany: "Selected {count} properties: {sites}",
    unlistedWarning: 'Warning: "{site}" is not in the {count} listed properties; storing the exact value anyway.',
    clientTitle: "Install where?",
    clientPrompt: 'Select targets: numbers comma-separated (e.g. 1,3), "all" for every installer, or Enter for default [1]: ',
    clientPrintLabel: "JSON output",
    allowAllWarning: 'Warning: "All current + future sites" lets this agent query ANY current or future Search Console property visible to the credential ' +
        "(agent may query any current/future property). An explicit allowlist is preferred; use allow-all only if you understand the scope. " +
        "Future properties are included automatically.",
    allowAllConfirm: "Allow all current + future properties? Confirm explicitly [y/N]: ",
    allowAllNotConfirmed: "Allow-all not confirmed; re-run setup and choose explicit properties or confirm explicitly. Nothing was changed.",
    secretsNotFoundFlag: "Secrets file not found. Check the --secrets path and re-run setup.",
    secretsNotFoundPath: "Secrets file not found. Check the path and re-run setup.",
    noCredentials: "No credentials provided. Re-run setup when you have the JSON file.",
    genericFailure: "Setup failed (setup_error): an unexpected error stopped setup; re-run with --dry-run to verify flags, then retry. Raw details are withheld to avoid leaking credentials.",
    // --- T03 first-install target-application copy (English canonical) ---
    targetPrintHeading: "Add this to your MCP client config:",
    targetConfigUnavailable: "Cannot safely locate the {target} config on this machine; falling back to generic output.",
    targetRestartDesktop: "Restart Claude Desktop to pick it up.",
    targetRestartCursor: "Restart Cursor to pick it up.",
    targetRestartOpencode: "Restart OpenCode to pick it up.",
    targetRestartPi: "Restart Pi (OhMyPi) to pick it up.",
    targetCliFallbackHeading: "Copy-paste fallback (generic JSON, no write performed):",
    targetManualCommand: "Manual command: {command}",
    fileConfigFile: "Config file: {path}",
    filePreviewExisting: "existing gsc entry (values redacted):",
    filePreviewNew: "new gsc entry:",
    fileNoExisting: "(no existing gsc entry)",
    fileUnreadable: "(unreadable entry)",
    fileDryRun: "[dry run] Would merge only mcpServers.{server}; unrelated servers untouched. No file written.",
    fileConfirmOverwrite: "A {server} entry already exists. Overwrite only mcpServers.{server}? [y/N] ",
    fileConfirmNew: "Write a new mcpServers.{server} entry to {path}? [y/N] ",
    fileSkipped: "Skipped writing the config file. Nothing was changed.",
    fileBackup: "Backup: {backup}",
    fileCouldNotRead: "Could not read {path}. Nothing was changed.",
    fileInvalidJson: "Could not parse {path}. The file contains invalid JSON. Fix it first, then re-run setup. Nothing was changed.",
    fileBackupFailed: "Could not create a backup of {path}. Nothing was changed.",
    fileMkdirFailed: "Could not create the config folder for {path}. No config file was written.",
    fileStageFailedExisting: "Could not stage the updated config in {dir}. The existing config file was left untouched; a backup was kept at {backup}.",
    fileStageFailedNew: "Could not stage the new config in {dir}. No config file was written.",
    fileReplaceFailedExisting: "Could not replace {path}. A backup was kept at {backup}; verify the config file before re-running setup.",
    fileReplaceFailedNew: "Could not write {path}. No config entry was committed; verify the folder before re-running setup.",
    // Byte-identical to MERGE_INVALID_ROOT_ERROR / MERGE_INVALID_SERVERS_ERROR / MERGE_INVALID_MCP_ERROR in client-config.ts.
    fileMergeInvalidRoot: "Existing MCP config is not a JSON object; fix it first. Nothing was changed.",
    fileMergeInvalidServers: 'Existing MCP config has a non-object "mcpServers" key; fix it first. Nothing was changed.',
    fileMergeInvalidMcp: 'Existing MCP config has a non-object "mcp" key; fix it first. Nothing was changed.',
    fileConfigured: "Configured {path} (only mcpServers.{server} changed).", cliDryRunPreview: "[dry run preview] {command}",
    cliDryRunNote: "[dry run] Would run the exact command above. Nothing was invoked.",
    cliConfirm: "Run this exact command? [y/N] {command} ",
    cliSkipped: "Skipped the CLI-managed destination.",
    cliLaunchFailed: "Could not launch {program}. Run this yourself once it is installed:\n  {command}",
    cliNotFound: "The {program} CLI was not found on PATH. Run this yourself once it is installed:\n  {command}",
    cliAddFailed: "{program} mcp add did not succeed. Nothing was removed automatically. To replace the entry yourself, run:\n{steps}",
    cliConfigured: "Configured {program} ({server}).",
    // --- T04 skill-install, sample-query, finish-verification, completion (English canonical) ---
    skillListTitle: "Install the agent skill?",
    skillListAll: "All compatible agents (global, recommended)",
    skillAgentClaudeCode: "Claude Code",
    skillAgentCursor: "Cursor",
    skillAgentCodex: "Codex",
    skillListSkip: "Skip",
    skillListPrompt: "Choose [0]: ",
    skillInvalidSelection: "Invalid skill selection: use numbers like 1,2, \"all\", or 0 to skip.",
    skillConfirm: "Install the GSC agent skill (\"{skill}\") globally with the pinned Skills CLI ({spec})? [y/N] ",
    skillSkippedFlag: "Skill install skipped (pass --install-skill to install the GSC agent skill).",
    skillSkipped: "Skill install skipped.",
    skillFailed: "Skill install failed; the MCP client config above is unchanged.",
    skillDryRunPreview: "[dry run preview] {command}",
    skillDryRunNote: "[dry run] Would run the exact skill-install command above. Nothing was invoked.",
    skillUnsupported: "Skill install skipped: none of the selected clients (desktop/opencode/pi/generic/print) support agent skills. " +
        "Select code, cursor, or codex to map the skill. Nothing was invoked.",
    skillMissing: "Skill source is missing ({missing}). Nothing was invoked and no MCP config was touched. " +
        "Reinstall the package so skills/{skill}/SKILL.md exists, then retry yourself:\n  {command}",
    skillLaunchError: "Could not launch {program}. Install its runtime (Bun 1+ for bunx, Node 22+ for npx) and run this yourself:\n  {command}\n" +
        "MCP client config above is unchanged.",
    skillCliMissing: "The {program} launcher was not found on PATH. Run this yourself once it is installed:\n  {command}\n" +
        "MCP client config above is unchanged.",
    skillExitNonzero: "Skills CLI install did not succeed. Nothing was rolled back and no MCP config was touched. To retry yourself, run:\n  {command}",
    skillInstalling: "Installing agent skill:\n  {command}",
    skillInstalled: "Agent skill installed ({skill}).",
    skillDetailInstalled: "installed globally via pinned {spec} (agents: {agents})",
    skillDetailInstalledNoAgents: "installed globally via pinned {spec}",
    skillDetailPreview: "preview: {command}; nothing invoked",
    skillDetailUnsupported: "no compatible agent targets selected (code/cursor/codex); skill not installed, nothing invoked",
    skillDetailMissing: "skill install failed (missing_bundle); MCP client config unchanged",
    skillDetailLaunch: "skill install failed (launch_error); MCP client config unchanged",
    skillDetailCliMissing: "skill install failed (cli_missing); MCP client config unchanged",
    skillDetailExit: "skill install failed (exit_nonzero); MCP client config unchanged",
    sampleAllowAllSkip: "Sample query skipped for allow-all: no single property to query (explicit opt-in covers current + future properties).",
    sampleSkippedFlag: "Sample query skipped (pass --first-query to run one minimal query).",
    sampleConfirm: "Run one minimal sample query on {site} ({start}..{end}, date breakdown, up to 5 rows)? [y/N] ",
    sampleSkipped: "Sample query skipped.",
    sampleResult: "Sample query [{status}]: {detail}",
    sampleDryRunFlag: "Sample query not run in --dry-run (no Google calls); it runs on the live setup with --first-query.",
    sampleDryRunSkip: "Sample query skipped in --dry-run (no Google calls). Opt in on the live run with --first-query.",
    sampleOk: "one minimal query on one property ({start}..{end}, date breakdown, {count} rows): {clicks} clicks, {impressions} impressions",
    sampleNoData: "query succeeded but returned no rows for {start}..{end} (fresh property, no permission, or data lag); no success claimed",
    sampleDenied: "sample query denied for this session on the selected property ({start}..{end}, permission_denied): missing sharing or disabled API; no success claimed",
    sampleTimeout: "sample query timed out ({start}..{end}, timeout) without claiming success; retry later",
    sampleQueryError: "sample query failed ({start}..{end}, query_error) without claiming success; check network access and re-run setup",
    finishAuth: "{mode} ({scope} scope)",
    finishHeader: "Finish verification:",
    finishHeaderDryRun: "Finish verification (dry-run preview):",
    finishHeaderFailed: "Finish verification (configuration failed):",
    finishHeaderDryRunFailed: "Finish verification (dry-run preview; configuration failed):",
    finishWriteAccessFull: "Google write ops ENABLED (GSC_ACCESS_MODE={mode})",
    finishWriteAccessReadonly: "Google write ops disabled (GSC_ACCESS_MODE={mode})",
    finishWriteLegacyEnabled: "Google write ops ENABLED (full scope + GSC_ENABLE_WRITE=1)",
    finishWriteLegacyDisabled: "Google write ops disabled (needs GSC_SCOPES=full plus GSC_ENABLE_WRITE=1)",
    finishToolsOk: "{count} gsc_* tools (canonical catalog)",
    finishToolsMismatch: "expected {expected} gsc_* tools, found {count}; release evidence needs reconciliation",
    finishApiDryRun: "skipped: --dry-run performs no Google calls; the live run reuses its single sites.list call here",
    finishApiOkOne: "Search Console API reachable: 1 property visible (reused setup sites.list, no second call)",
    finishApiOkMany: "Search Console API reachable: {count} properties visible (reused setup sites.list, no second call)",
    finishApiEmpty: "Search Console API answered but listed no properties for this account; allowlist checks below fail closed",
    finishPropsPreviewOne: "preview: 1 selected property (no live verification without network)",
    finishPropsPreviewMany: "preview: {count} selected properties (no live verification without network)",
    finishPropsNone: "no properties selected; serve would reject every property tool call until configured",
    finishPropsUnverifiedOne: "1 selected property but the account lists none; selection stored exactly and unverified",
    finishPropsUnverifiedMany: "{count} selected properties but the account lists none; selection stored exactly and unverified",
    finishPropsAllOne: "1 selected property, all visible to this session: {sites}",
    finishPropsAllMany: "{count} selected properties, all visible to this session: {sites}",
    finishPropsPartial: "{visible} of {count} selected properties visible to this session; the stored identifiers stay exact",
    finishClientsNone: "no client targets requested",
    finishClientsDryPreviewed: "{targets} previewed",
    finishClientsDryPrinted: "{targets} printed (preview)",
    finishClientsDrySkipped: "{targets} skipped",
    finishClientsDryFailed: "{targets} failed",
    finishClientsDryApplied: "{targets} applied",
    finishClientsDryWrap: "preview: {parts}; nothing configured",
    finishClientsConfigured: "configured: {targets}",
    finishClientsPrinted: "printed fallback (manual, nothing written): {targets}",
    finishClientsPreviewed: "previewed: {targets}",
    finishClientsSkipped: "skipped (nothing changed): {targets}",
    finishClientsFailed: "failed: {targets}",
    finishDone: "Setup complete. Next, ask your agent: \"What are my quick win keywords?\"",
    finishToken: "OAuth tokens use {path} for local storage and are sent to Google for authentication, not to the maintainer.",
    finishRevoke: "Revoke access any time at https://myaccount.google.com/permissions",
    finishReauth: "Change access level later by re-running: gsc setup --reauth",
};
const CORE_ES = {
    welcomeTitle: "GSC MCP Local setup",
    welcomeSubtitle: "Gratis y de código abierto. Las solicitudes a Google se ejecutan en esta máquina; las respuestas llegan a su cliente MCP y su proveedor de IA. Antes de conectar, revise https://gscmcp.dev/privacy y sus ajustes de retención y entrenamiento. Quick Connect solo permite lectura; las escrituras requieren OAuth propio o service account.",
    stageAuth: "Paso 1 de 3 — Inicio de sesión (recomendado: Quick Connect, solo lectura)",
    stageProperties: "Paso 2 de 3 — Elección de propiedades de Search Console",
    stageClients: "Paso 3 de 3 — Dónde instalar",
    authTitle: "Autenticación?",
    authOptionShared: "Quick Connect (recomendado, solo lectura, sin indexación)",
    authOptionCustom: "Custom OAuth (acceso completo, indexación)",
    authOptionService: "Service Account (acceso completo, indexación)",
    accessTitle: "Nivel de acceso?",
    accessOptionReadonly: "Solo lectura (solo datos)",
    accessOptionFull: "Completo (datos + indexación)",
    accessOptionFullExplained: "Completo (datos + indexación, incluye escrituras de Google)",
    choosePrompt: "Elige [1]: ",
    writeConfirm: "Habilitar las operaciones de escritura de Google por separado? [y/N] ",
    authSharedNote: "Usando el inicio de sesión integrado de Google. No necesita configuración de Google Cloud.",
    customGuideTitle: "Esta compilación aún no incluye un cliente OAuth integrado, así que necesita el suyo (5 minutos, una sola vez):",
    customGuideStep1: "  1. console.cloud.google.com > create a project > enable the Search Console API",
    customGuideStep2: "  2. Credentials > Create credentials > OAuth client ID > Desktop app",
    customGuideStep3: "  3. Download the JSON file",
    customWalkthrough: "Guía completa: {url}",
    secretsPrompt: "Ruta al archivo JSON de secretos de cliente: ",
    keyFilePrompt: "Ruta al archivo JSON de la cuenta de servicio: ",
    clientSecretsPrompt: "Ruta al archivo JSON de secretos de cliente: ",
    usingOAuthClient: "Usando el cliente OAuth de {path}.",
    scopeReadonly: "Acceso de solo lectura. La pantalla de consentimiento mostrará un único permiso de lectura.",
    scopeFull: "Acceso completo. Incluye el envío de sitemaps y la Indexing API.",
    allSitesPreview: "[dry run] --all-sites: la configuración real guarda cada identificador exacto a partir de una llamada sites.list; no hay allowlist que previsualizar sin red.",
    connectedOne: "Conectado. Su cuenta de Google tiene 1 propiedad de Search Console.",
    connectedMany: "Conectado. Su cuenta de Google tiene {count} propiedades de Search Console.",
    selectedAllCount: "Seleccionadas las {count} propiedades.",
    allowAllSelected: 'Seleccionadas todas las propiedades actuales y futuras (aceptación explícita: "all").',
    noPropertiesManual: "No se encontraron propiedades en esta cuenta. Aún puede indicar una manualmente.",
    manualPropertyPrompt: "Propiedad del panel (p. ej. sc-domain:yoursite.com): ",
    manualPropertyRequired: "Se requiere una propiedad del panel. Vuelva a ejecutar la configuración cuando la cuenta de Google tenga acceso a GSC.",
    singleProperty: "Propiedad del panel: {site}",
    propertySelect: 'Seleccione propiedades: números separados por comas (p. ej. 1,3), "0" o "all" para todas las actuales y futuras (aceptación explícita), o Enter para el valor predeterminado [1]: ',
    propertyAllOption: "Todas las propiedades actuales y futuras (aceptación explícita)",
    selectedCountOne: "Seleccionada 1 propiedad: {sites}",
    selectedCountMany: "Seleccionadas {count} propiedades: {sites}",
    unlistedWarning: 'Advertencia: "{site}" no está entre las {count} propiedades listadas; se guardará el valor exacto igualmente.',
    clientTitle: "Dónde instalar?",
    clientPrompt: 'Seleccione destinos: números separados por comas (p. ej. 1,3), "all" para cada instalador, o Enter para el valor predeterminado [1]: ',
    clientPrintLabel: "Formato JSON",
    allowAllWarning: 'Advertencia: "All current + future sites" permite a este agente consultar CUALQUIER propiedad de Search Console actual o futura visible para la credencial ' +
        "(el agente puede consultar cualquier propiedad actual o futura). Se prefiere una lista explícita; use allow-all solo si comprende el alcance. " +
        "Las propiedades futuras se incluyen automáticamente.",
    allowAllConfirm: "Permitir todas las propiedades actuales y futuras? Confirme explícitamente [y/N]: ",
    allowAllNotConfirmed: "Allow-all no confirmado; vuelva a ejecutar la configuración y elija propiedades explícitas o confirme explícitamente. No se cambió nada.",
    secretsNotFoundFlag: "Archivo de secretos no encontrado. Compruebe la ruta --secrets y vuelva a ejecutar la configuración.",
    secretsNotFoundPath: "Archivo de secretos no encontrado. Compruebe la ruta y vuelva a ejecutar la configuración.",
    noCredentials: "No se proporcionaron credenciales. Vuelva a ejecutar la configuración cuando tenga el archivo JSON.",
    genericFailure: "Error de configuración (setup_error): un error inesperado detuvo la configuración; vuelva a ejecutar con --dry-run para comprobar los indicadores y reintente. Los detalles sin procesar se ocultan para no filtrar credenciales.",
    // --- T03 first-install target-application copy (Spanish) ---
    targetPrintHeading: "Añada esto a la configuración de su cliente MCP:",
    targetConfigUnavailable: "No se puede localizar de forma segura la configuración de {target} en esta máquina; mostrando la salida genérica.",
    targetRestartDesktop: "Reinicie Claude Desktop para aplicar el cambio.",
    targetRestartCursor: "Reinicie Cursor para aplicar el cambio.",
    targetRestartOpencode: "Reinicie OpenCode para aplicar el cambio.",
    targetRestartPi: "Reinicie Pi (OhMyPi) para aplicar el cambio.",
    targetCliFallbackHeading: "Alternativa para copiar y pegar (JSON genérico, sin escritura):",
    targetManualCommand: "Comando manual: {command}",
    fileConfigFile: "Archivo de configuración: {path}",
    filePreviewExisting: "entrada gsc existente (valores ocultos):",
    filePreviewNew: "nueva entrada gsc:",
    fileNoExisting: "(sin entrada gsc existente)",
    fileUnreadable: "(entrada ilegible)",
    fileDryRun: "[dry run] Solo se combinaría mcpServers.{server}; los demás servidores no se tocarían. No se escribió ningún archivo.",
    fileConfirmOverwrite: "Ya existe una entrada {server}. Sobrescribir solo mcpServers.{server}? [y/N] ",
    fileConfirmNew: "Escribir una nueva entrada mcpServers.{server} en {path}? [y/N] ",
    fileSkipped: "Se omitió la escritura del archivo de configuración. No se cambió nada.",
    fileBackup: "Copia de seguridad: {backup}",
    fileCouldNotRead: "No se pudo leer {path}. No se cambió nada.",
    fileInvalidJson: "No se pudo analizar {path}. El archivo contiene JSON no válido. Corríjalo primero y vuelva a ejecutar la configuración. No se cambió nada.",
    fileBackupFailed: "No se pudo crear una copia de seguridad de {path}. No se cambió nada.",
    fileMkdirFailed: "No se pudo crear la carpeta de configuración para {path}. No se escribió ningún archivo de configuración.",
    fileStageFailedExisting: "No se pudo preparar la configuración actualizada en {dir}. El archivo de configuración existente no se modificó; se conservó una copia de seguridad en {backup}.",
    fileStageFailedNew: "No se pudo preparar la nueva configuración en {dir}. No se escribió ningún archivo de configuración.",
    fileReplaceFailedExisting: "No se pudo reemplazar {path}. Se conservó una copia de seguridad en {backup}; compruebe el archivo de configuración antes de volver a ejecutar la configuración.",
    fileReplaceFailedNew: "No se pudo escribir {path}. No se confirmó ninguna entrada de configuración; compruebe la carpeta antes de volver a ejecutar la configuración.",
    fileMergeInvalidRoot: "La configuración MCP existente no es un objeto JSON; corríjala primero. No se cambió nada.",
    fileMergeInvalidServers: 'La configuración MCP existente tiene una clave "mcpServers" que no es un objeto; corríjala primero. No se cambió nada.',
    fileMergeInvalidMcp: 'La configuración MCP existente tiene una clave "mcp" que no es un objeto; corríjala primero. No se cambió nada.',
    fileConfigured: "{path} configurado (solo cambió mcpServers.{server}).", cliDryRunPreview: "[dry run preview] {command}",
    cliDryRunNote: "[dry run] Se ejecutaría el comando exacto anterior. No se invocó nada.",
    cliConfirm: "Ejecutar este comando exacto? [y/N] {command} ",
    cliSkipped: "Se omitió el destino gestionado por CLI.",
    cliLaunchFailed: "No se pudo iniciar {program}. Ejecútelo usted mismo una vez instalado:\n  {command}",
    cliNotFound: "No se encontró la CLI {program} en PATH. Ejecútelo usted mismo una vez instalado:\n  {command}",
    cliAddFailed: "{program} mcp add no se completó. No se eliminó nada automáticamente. Para reemplazar la entrada usted mismo, ejecute:\n{steps}",
    cliConfigured: "{program} configurado ({server}).",
    // --- T04 skill-install, sample-query, finish-verification, completion (Spanish) ---
    skillListTitle: "¿Instalar la skill del agente?",
    skillListAll: "Todos los agentes compatibles (global, recomendado)",
    skillAgentClaudeCode: "Claude Code",
    skillAgentCursor: "Cursor",
    skillAgentCodex: "Codex",
    skillListSkip: "Omitir",
    skillListPrompt: "Elige [0]: ",
    skillInvalidSelection: "Selección de skill no válida: use números como 1,2, \"all\" o 0 para omitir.",
    skillConfirm: "Instalar la agent skill de GSC (\"{skill}\") globalmente con el Skills CLI fijado ({spec})? [y/N] ",
    skillSkippedFlag: "Instalación de la skill omitida (pase --install-skill para instalar la agent skill de GSC).",
    skillSkipped: "Instalación de la skill omitida.",
    skillFailed: "La instalación de la skill falló; la configuración del cliente MCP no cambió.",
    skillDryRunPreview: "[dry run preview] {command}",
    skillDryRunNote: "[dry run] Se ejecutaría el comando exacto de instalación anterior. No se invocó nada.",
    skillUnsupported: "Instalación de la skill omitida: ninguno de los clientes seleccionados (desktop/opencode/pi/generic/print) admite agent skills. " +
        "Seleccione code, cursor o codex para asignar la skill. No se invocó nada.",
    skillMissing: "La fuente de la skill falta ({missing}). No se invocó nada ni se modificó la configuración MCP. " +
        "Reinstale el paquete para que exista skills/{skill}/SKILL.md e inténtelo usted mismo:\n  {command}",
    skillLaunchError: "No se pudo iniciar {program}. Instale su runtime (Bun 1+ para bunx, Node 22+ para npx) y ejecútelo usted mismo:\n  {command}\n" +
        "La configuración del cliente MCP no cambió.",
    skillCliMissing: "No se encontró el iniciador {program} en PATH. Ejecútelo usted mismo una vez instalado:\n  {command}\n" +
        "La configuración del cliente MCP no cambió.",
    skillExitNonzero: "La instalación con el Skills CLI no se completó. No se revirtió nada ni se modificó la configuración MCP. Para intentarlo usted mismo, ejecute:\n  {command}",
    skillInstalling: "Instalando la agent skill:\n  {command}",
    skillInstalled: "Agent skill instalada ({skill}).",
    skillDetailInstalled: "instalada globalmente con {spec} fijado (agents: {agents})",
    skillDetailInstalledNoAgents: "instalada globalmente con {spec} fijado",
    skillDetailPreview: "vista previa: {command}; nada invocado",
    skillDetailUnsupported: "sin destinos de agente compatibles seleccionados (code/cursor/codex); skill no instalada, nada invocado",
    skillDetailMissing: "instalación de la skill fallida (missing_bundle); configuración del cliente MCP sin cambios",
    skillDetailLaunch: "instalación de la skill fallida (launch_error); configuración del cliente MCP sin cambios",
    skillDetailCliMissing: "instalación de la skill fallida (cli_missing); configuración del cliente MCP sin cambios",
    skillDetailExit: "instalación de la skill fallida (exit_nonzero); configuración del cliente MCP sin cambios",
    sampleAllowAllSkip: "Consulta de muestra omitida para allow-all: no hay una sola propiedad que consultar (la aceptación explícita cubre las propiedades actuales y futuras).",
    sampleSkippedFlag: "Consulta de muestra omitida (pase --first-query para ejecutar una consulta mínima).",
    sampleConfirm: "Ejecutar una consulta mínima de muestra en {site} ({start}..{end}, desglose por fecha, hasta 5 filas)? [y/N] ",
    sampleSkipped: "Consulta de muestra omitida.",
    sampleResult: "Consulta de muestra [{status}]: {detail}",
    sampleDryRunFlag: "Consulta de muestra no ejecutada en --dry-run (sin llamadas a Google); se ejecuta en la configuración real con --first-query.",
    sampleDryRunSkip: "Consulta de muestra omitida en --dry-run (sin llamadas a Google). Actívela en la ejecución real con --first-query.",
    sampleOk: "una consulta mínima en una propiedad ({start}..{end}, desglose por fecha, {count} filas): {clicks} clics, {impressions} impresiones",
    sampleNoData: "la consulta se ejecutó pero no devolvió filas para {start}..{end} (propiedad nueva, sin permiso o retraso de datos); no se afirma éxito",
    sampleDenied: "consulta de muestra denegada para esta sesión en la propiedad seleccionada ({start}..{end}, permission_denied): falta el uso compartido o la API está deshabilitada; no se afirma éxito",
    sampleTimeout: "la consulta de muestra agotó el tiempo de espera ({start}..{end}, timeout) sin afirmar éxito; inténtelo más tarde",
    sampleQueryError: "la consulta de muestra falló ({start}..{end}, query_error) sin afirmar éxito; compruebe el acceso a la red y vuelva a ejecutar la configuración",
    finishAuth: "{mode} (alcance {scope})",
    finishHeader: "Verificación final:",
    finishHeaderDryRun: "Verificación final (vista previa dry-run):",
    finishHeaderFailed: "Verificación final (la configuración falló):",
    finishHeaderDryRunFailed: "Verificación final (vista previa dry-run; la configuración falló):",
    finishWriteAccessFull: "Operaciones de escritura de Google HABILITADAS (GSC_ACCESS_MODE={mode})",
    finishWriteAccessReadonly: "Operaciones de escritura de Google deshabilitadas (GSC_ACCESS_MODE={mode})",
    finishWriteLegacyEnabled: "Operaciones de escritura de Google HABILITADAS (alcance full + GSC_ENABLE_WRITE=1)",
    finishWriteLegacyDisabled: "Operaciones de escritura de Google deshabilitadas (necesita GSC_SCOPES=full más GSC_ENABLE_WRITE=1)",
    finishToolsOk: "{count} herramientas gsc_* (catálogo canónico)",
    finishToolsMismatch: "se esperaban {expected} herramientas gsc_*, se encontraron {count}; la evidencia de la versión necesita conciliación",
    finishApiDryRun: "omitida: --dry-run no realiza llamadas a Google; la ejecución real reutiliza aquí su única llamada sites.list",
    finishApiOkOne: "API de Search Console accesible: 1 propiedad visible (sites.list de configuración reutilizado, sin segunda llamada)",
    finishApiOkMany: "API de Search Console accesible: {count} propiedades visibles (sites.list de configuración reutilizado, sin segunda llamada)",
    finishApiEmpty: "La API de Search Console respondió pero no listó propiedades para esta cuenta; las comprobaciones de la lista fallan de forma segura",
    finishPropsPreviewOne: "vista previa: 1 propiedad seleccionada (sin comprobación en vivo sin red)",
    finishPropsPreviewMany: "vista previa: {count} propiedades seleccionadas (sin comprobación en vivo sin red)",
    finishPropsNone: "ninguna propiedad seleccionada; serve rechazaría cada llamada de herramienta de propiedad hasta que se configure",
    finishPropsUnverifiedOne: "1 propiedad seleccionada pero la cuenta no lista ninguna; la selección se guarda exacta y sin comprobar",
    finishPropsUnverifiedMany: "{count} propiedades seleccionadas pero la cuenta no lista ninguna; la selección se guarda exacta y sin comprobar",
    finishPropsAllOne: "1 propiedad seleccionada, toda visible para esta sesión: {sites}",
    finishPropsAllMany: "{count} propiedades seleccionadas, todas visibles para esta sesión: {sites}",
    finishPropsPartial: "{visible} de {count} propiedades seleccionadas visibles para esta sesión; los identificadores guardados siguen exactos",
    finishClientsNone: "ningún destino de cliente solicitado",
    finishClientsDryPreviewed: "{targets} previsualizados",
    finishClientsDryPrinted: "{targets} impresos (vista previa)",
    finishClientsDrySkipped: "{targets} omitidos",
    finishClientsDryFailed: "{targets} fallidos",
    finishClientsDryApplied: "{targets} aplicados",
    finishClientsDryWrap: "vista previa: {parts}; nada configurado",
    finishClientsConfigured: "configurados: {targets}",
    finishClientsPrinted: "reserva impresa (manual, nada escrito): {targets}",
    finishClientsPreviewed: "previsualizados: {targets}",
    finishClientsSkipped: "omitidos (nada cambiado): {targets}",
    finishClientsFailed: "fallidos: {targets}",
    finishDone: "Configuración completa. Siguiente paso, pregunte a su agente: \"¿Qué palabras clave ofrecen oportunidades rápidas?\"",
    finishToken: "Los tokens OAuth usan {path} como almacenamiento local y se envían a Google para autenticar, no al mantenedor.",
    finishRevoke: "Revoque el acceso cuando quiera en https://myaccount.google.com/permissions",
    finishReauth: "Cambie el nivel de acceso más tarde volviendo a ejecutar: gsc setup --reauth",
};
exports.SETUP_STRINGS = {
    en: { usage: USAGE_SHORT_EN, usageVerbose: USAGE_EN, ...CORE_EN },
    es: { usage: USAGE_SHORT_ES, usageVerbose: USAGE_ES, ...CORE_ES },
};
/**
 * Return localized help text; short by default, full flag reference with
 * `verbose` (`setup --help --verbose`). Only the optional Skills CLI varies
 * by runtime.
 */
function getSetupUsage(locale, verbose = false) {
    const usage = verbose ? exports.SETUP_STRINGS[locale].usageVerbose : exports.SETUP_STRINGS[locale].usage;
    if ((0, client_config_js_1.currentRuntime)() === "bun") {
        return usage
            .replaceAll("npx --yes", "bunx --bun");
    }
    return usage;
}
/**
 * Look up one catalog key for a locale with English fallback. Carries an
 * optional `{name}` interpolation payload for T02 messages.
 */
function translateSetup(locale, key, vars = {}) {
    const template = exports.SETUP_STRINGS[locale][key] ?? exports.SETUP_STRINGS[exports.DEFAULT_SETUP_LOCALE][key];
    return formatSetupMessage(template, vars);
}
/**
 * Interpolate `{name}` placeholders with the supplied values. Unknown
 * placeholders are left intact so missing values stay visible in tests
 * instead of silently vanishing.
 */
function formatSetupMessage(template, vars = {}) {
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
        const value = vars[name];
        return value === undefined ? match : String(value);
    });
}
/**
 * Locale-aware affirmative handling for core journey confirmations
 * (auth/write opt-in and allow-all confirmations). English accepts `y` and
 * `yes`; Spanish additionally accepts `s`, `si`, and `sí`. Matching is
 * case- and whitespace-tolerant. The default stays "no": empty and
 * negative answers decline in both locales. Skill-install and sample-query
 * confirmations keep their English-only parsers until T04.
 */
function isSetupAffirmative(answer, locale) {
    const normalized = answer.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes")
        return true;
    if (locale === "es" && (normalized === "s" || normalized === "si" || normalized === "sí"))
        return true;
    return false;
}
/**
 * Spanish rendering for every known controlled static setup error.
 * English stays the exact canonical message; flags, option values, env
 * keys, product names, identifiers, and structured IDs (`setup_error`,
 * `UPSTREAM_SCHEMA_CHANGED`, `sites.list`, `siteEntry`) stay exact.
 * Returns `null` for unknown messages so callers fail closed to the
 * generic safe error instead of echoing raw text.
 */
const SETUP_ERROR_ES = {
    "Unknown option. Run with --help for usage.": "Opción desconocida. Ejecute con --help para ver el uso.",
    "--client needs a value. Run with --help for usage.": "--client necesita un valor. Ejecute con --help para ver el uso.",
    "--site needs a value. Run with --help for usage.": "--site necesita un valor. Ejecute con --help para ver el uso.",
    "Invalid --client value. Use desktop, code, cursor, codex, generic, print, or both (repeatable).": "Valor de --client no válido. Use desktop, code, cursor, codex, generic, print o both (repetible).",
    "Invalid --client value. Use desktop, code, cursor, codex, generic, print (repeatable) or both.": "Valor de --client no válido. Use desktop, code, cursor, codex, generic, print (repetible) o both.",
    "Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print, or both (repeatable).": "Valor de --client no válido. Use desktop, code, cursor, codex, opencode, pi, generic, print o both (repetible).",
    "Invalid --client value. Use desktop, code, cursor, codex, opencode, pi, generic, print (repeatable) or both.": "Valor de --client no válido. Use desktop, code, cursor, codex, opencode, pi, generic, print (repetible) o both.",
    "Invalid --scopes value. Use readonly or full.": "Valor de --scopes no válido. Use readonly o full.",
    "Invalid --access value. Use readonly or full.": "Valor de --access no válido. Use readonly o full.",
    "Invalid --auth value. Use shared, custom, or service-account.": "Valor de --auth no válido. Use shared, custom o service-account.",
    [exports.INVALID_SETUP_LANGUAGE_ERROR]: "Valor de --language no válido. Use en o es.",
    [exports.MISSING_SETUP_LANGUAGE_ERROR]: "--language necesita un valor. Ejecute con --help para ver el uso.",
    [`Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}.`]: `Quick Connect es de solo lectura en ${version_js_1.CLI_VERSION}.`,
    [`Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`]: `Quick Connect es de solo lectura en ${version_js_1.CLI_VERSION}. Elija --auth custom o --auth service-account para el acceso full.`,
    "Quick Connect is unavailable in this build. Choose --auth custom with --secrets instead.": "Quick Connect no está disponible en esta compilación. Elija --auth custom con --secrets en su lugar.",
    "Credential path does not match the selected authentication mode.": "La ruta de la credencial no coincide con el modo de autenticación seleccionado.",
    "Service Account requires --key-file.": "Service Account requiere --key-file.",
    "Cannot read a valid custom JSON credential file.": "No se puede leer un archivo de credencial JSON custom válido.",
    "Cannot read a valid service-account JSON credential file.": "No se puede leer un archivo de credencial JSON service-account válido.",
    "Invalid custom credential shape.": "Forma de credencial custom no válida.",
    "Invalid service-account credential shape.": "Forma de credencial service-account no válida.",
    "Custom OAuth requires a Desktop installed client JSON with client_id, client_secret, and loopback redirect_uris.": "Custom OAuth requiere un JSON de cliente instalado Desktop con client_id, client_secret y redirect_uris de loopback.",
    "Service Account requires a service_account JSON with client_email and private_key.": "Service Account requiere un JSON service_account con client_email y private_key.",
    "Write enablement requires full access.": "La habilitación de escritura requiere acceso full.",
    "--enable-write requires --scopes full and a custom or service-account authentication mode.": "--enable-write requiere --scopes full y un modo de autenticación custom o service-account.",
    "Invalid --site value: property must not be empty. Use sc-domain:... or an http(s):// URL.": "Valor de --site no válido: la propiedad no debe estar vacía. Use sc-domain:... o una URL http(s)://.",
    "Invalid --site value. Use sc-domain:... or an http(s):// URL.": "Valor de --site no válido. Use sc-domain:... o una URL http(s)://.",
    "Invalid property. Use sc-domain:... or an http(s):// URL.": "Propiedad no válida. Use sc-domain:... o una URL http(s)://.",
    "Invalid setup choice": "Elección de configuración no válida",
    "Invalid setup scope": "Alcance de configuración no válido",
    "Invalid setup client": "Cliente de configuración no válido",
    "A dashboard property is required": "Se requiere una propiedad del panel",
    "No Search Console properties available": "No hay propiedades de Search Console disponibles",
    "No properties found on this account; --all-sites has nothing to select. Pass --site explicitly once access exists.": "No se encontraron propiedades en esta cuenta; --all-sites no tiene nada que seleccionar. Pase --site explícitamente cuando exista acceso.",
    "No credentials provided. Re-run setup when you have the JSON file.": "No se proporcionaron credenciales. Vuelva a ejecutar la configuración cuando tenga el archivo JSON.",
    "Secrets file not found. Check the --secrets path and re-run setup.": "Archivo de secretos no encontrado. Compruebe la ruta --secrets y vuelva a ejecutar la configuración.",
    "Secrets file not found. Check the path and re-run setup.": "Archivo de secretos no encontrado. Compruebe la ruta y vuelva a ejecutar la configuración.",
    "Use either repeatable --site or --all-sites, not both.": "Use --site repetible o --all-sites, no ambos.",
    'GSC_SITE_URLS mixes "all" with explicit properties: use either "all" alone for every current and future property, or an explicit allowlist without "all".': 'GSC_SITE_URLS combina "all" con propiedades explícitas: use "all" por sí solo para todas las propiedades actuales y futuras, o una lista explícita sin "all".',
    "Use --client print/generic alone: it only prints the config without writing or invoking.": "Use --client print/generic por sí solo: solo imprime la configuración sin escribir ni invocar.",
    "OAuth authentication timed out after 2 minutes": "La autenticación OAuth agotó el tiempo de espera después de 2 minutos",
    "UPSTREAM_SCHEMA_CHANGED: sites.list response shape changed (expected an object with a siteEntry array)": "UPSTREAM_SCHEMA_CHANGED: la forma de la respuesta sites.list cambió (se esperaba un objeto con un arreglo siteEntry)",
    "Allow-all not confirmed; re-run setup and choose explicit properties or confirm explicitly. Nothing was changed.": "Allow-all no confirmado; vuelva a ejecutar la configuración y elija propiedades explícitas o confirme explícitamente. No se cambió nada.",
};
/**
 * Localize one controlled static setup error message. Returns the English
 * canonical message for `en`, the Spanish rendering for `es`, and `null`
 * for unknown messages (including the two bounded numeric selection
 * patterns when they do not match their anchored shapes) so callers map
 * them to the generic fail-closed error with no raw text.
 */
function localizeSetupErrorMessage(message, locale) {
    if (locale === "en") {
        if (Object.hasOwn(SETUP_ERROR_ES, message))
            return message;
        if (/^Invalid property selection: (use numbers like 0,1,3 or "all"\.|use "0" alone for all current \+ future properties\.|choose 0-\d+ or "all"\.)$/.test(message) ||
            /^Invalid client selection: (use numbers like 1,3\.|choose 1-\d+\.)$/.test(message)) {
            return message;
        }
        return null;
    }
    const translated = SETUP_ERROR_ES[message];
    if (translated !== undefined)
        return translated;
    if (message === 'Invalid property selection: use numbers like 0,1,3 or "all".') {
        return 'Selección de propiedad no válida: use números como 0,1,3 o "all".';
    }
    if (message === 'Invalid property selection: use "0" alone for all current + future properties.') {
        return 'Selección de propiedad no válida: use "0" por sí solo para todas las propiedades actuales y futuras.';
    }
    const propertyRange = message.match(/^Invalid property selection: choose 0-(\d+) or "all"\.$/);
    if (propertyRange) {
        return `Selección de propiedad no válida: elija 0-${propertyRange[1]} o "all".`;
    }
    if (message === "Invalid client selection: use numbers like 1,3.") {
        return "Selección de cliente no válida: use números como 1,3.";
    }
    const clientRange = message.match(/^Invalid client selection: choose 1-(\d+)\.$/);
    if (clientRange) {
        return `Selección de cliente no válida: elija 1-${clientRange[1]}.`;
    }
    return null;
}
