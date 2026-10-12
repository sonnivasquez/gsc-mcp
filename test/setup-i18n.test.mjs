import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
// T01 — deterministic setup locale infrastructure.
// Pure unit coverage uses injectable env/systemLocale seams only; subprocess
// coverage pins LC_ALL/LC_MESSAGES/LANG explicitly so inherited developer
// locale never makes assertions flaky. No network, no Google, no writes.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");
const i18n = await import("../dist/setup/i18n.js");

const {
  DEFAULT_SETUP_LOCALE,
  INVALID_SETUP_LANGUAGE_ERROR,
  MISSING_SETUP_LANGUAGE_ERROR,
  SETUP_LOCALES,
  getSetupUsage,
  parseLocaleTag,
  parseSetupLanguage,
  resolveSetupLocale,
} = i18n;

function cleanEnv(overrides = {}) {
  return { ...process.env, LC_ALL: "", LC_MESSAGES: "", LANG: "", ...overrides };
}

function helpEnv(overrides = {}) {
  return { ...process.env, ...overrides };
}

// --- Catalog shape: exactly en + es, English canonical/fallback ---

test("supported locales are exactly en and es with English fallback", () => {
  assert.deepEqual([...SETUP_LOCALES], ["en", "es"]);
  assert.equal(DEFAULT_SETUP_LOCALE, "en");
});

// --- Explicit override wins ---

test("explicit --language wins over environment and Intl", () => {
  assert.equal(resolveSetupLocale("es", { LC_ALL: "en_US.UTF-8" }, "en-US"), "es");
  assert.equal(resolveSetupLocale("en", { LC_ALL: "es_ES.UTF-8" }, "es-ES"), "en");
  assert.equal(resolveSetupLocale("es", {}, "en-US"), "es");
  assert.equal(resolveSetupLocale("en", {}, "es-ES"), "en");
});

// --- Spanish environment detection ---

test("Spanish env tags resolve es", () => {
  for (const tag of ["es", "es-ES", "es-PE", "es-MX", "es_ES", "es_ES.UTF-8", "ES", "Es-Es", "es-419", "es@modifier", "  es_MX.UTF-8  "]) {
    assert.equal(resolveSetupLocale(undefined, { LC_ALL: tag }, "en-US"), "es", tag);
  }
  assert.equal(resolveSetupLocale(undefined, { LC_MESSAGES: "es-ES" }, "en-US"), "es");
  assert.equal(resolveSetupLocale(undefined, { LANG: "es_ES.UTF-8" }, "en-US"), "es");
  assert.equal(resolveSetupLocale(null, { LANG: "es" }, "en-US"), "es");
});

// --- Intl fallback seam: only when all env fields are absent/empty ---

test("Intl locale applies only when every env locale field is absent or empty", () => {
  assert.equal(resolveSetupLocale(undefined, {}, "es-ES"), "es");
  assert.equal(resolveSetupLocale(undefined, {}, "es-PE"), "es");
  assert.equal(resolveSetupLocale(undefined, {}, "es-MX"), "es");
  assert.equal(resolveSetupLocale(undefined, {}, "es"), "es");
  assert.equal(resolveSetupLocale(undefined, {}, "fr-FR"), "en");
  assert.equal(resolveSetupLocale(undefined, {}, null), "en");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "", LC_MESSAGES: "", LANG: "" }, "es-ES"), "es");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "", LC_MESSAGES: "", LANG: "" }, "fr-FR"), "en");
});

// --- Unsupported / malformed / C / POSIX resolve English ---

test("unsupported, malformed, C, and POSIX env values resolve English", () => {
  for (const tag of ["fr", "fr-FR", "de_DE.UTF-8", "pt-BR", "en-US", "en", "C", "POSIX", "  C  ", "!!!", "123", "_"]) {
    assert.equal(resolveSetupLocale(undefined, { LC_ALL: tag }, "es-ES"), "en", `LC_ALL=${tag}`);
  }
  assert.equal(parseLocaleTag("C"), "en");
  assert.equal(parseLocaleTag("POSIX"), "en");
  assert.equal(parseLocaleTag("fr-FR"), "en");
  assert.equal(parseLocaleTag("!!!"), "en");
  assert.equal(parseLocaleTag(""), "en");
  assert.equal(parseLocaleTag(undefined), "en");
  assert.equal(parseLocaleTag(null), "en");
});

// --- Precedence: first non-empty LC_ALL > LC_MESSAGES > LANG ---

test("first non-empty env variable is decisive and blocks lower ones", () => {
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "es-ES", LC_MESSAGES: "fr-FR", LANG: "fr-FR" }, "en-US"), "es");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "fr-FR", LC_MESSAGES: "es-ES", LANG: "es-ES" }, "es-ES"), "en");
  assert.equal(resolveSetupLocale(undefined, { LC_MESSAGES: "es-ES", LANG: "fr-FR" }, "en-US"), "es");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "", LC_MESSAGES: "es-ES", LANG: "fr-FR" }, "en-US"), "es");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "", LC_MESSAGES: "", LANG: "es-ES" }, "en-US"), "es");
});

test("C/POSIX are explicit English and block lower variables", () => {
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "C", LANG: "es-ES" }, "es-ES"), "en");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "POSIX", LANG: "es-ES" }, "es-ES"), "en");
  assert.equal(resolveSetupLocale(undefined, { LC_ALL: "", LC_MESSAGES: "C", LANG: "es-ES" }, "es-ES"), "en");
});

// --- Help catalogs: natural Spanish, exact machine tokens ---

test("English help is the canonical catalog", () => {
  const usage = getSetupUsage("en");
  assert.match(usage, /Guided setup in 3 steps/);
  assert.match(usage, /--language <locale>/);
  assert.match(usage, /add --verbose for every flag/);
  assert.match(usage, /Subcommands: setup access readonly\|full/);
  for (const token of ["--first-query", "--install-skill", "--scopes", "--enable-write", "--reauth", "--force", "GSC_SITE_URLS", "mcpServers.gsc", "skills@1.7.0"]) {
    assert.ok(!usage.includes(token), `Short help must not include verbose-only token: ${token}`);
  }
  const verbose = getSetupUsage("en", true);
  assert.match(verbose, /Guided setup for the GSC MCP server/);
  assert.match(verbose, /--first-query/);
  assert.match(verbose, /--yes never enables it/);
  assert.match(verbose, /--language <locale>/);
  assert.match(verbose, /GSC_SITE_URLS/);
  assert.match(verbose, /mcpServers\.gsc/);
  assert.match(verbose, /skills@1\.7\.0/);
});

test("Spanish help is natural Spanish with exact flags and keys", () => {
  const usage = getSetupUsage("es");
  assert.match(usage, /Configuraci.n guiada en 3 pasos/);
  assert.match(usage, /Opciones:/);
  assert.match(usage, /Subcomandos: setup access readonly\|full/);
  assert.match(usage, /Muestra esta ayuda/);
  assert.ok(!usage.includes("Show this help"), "Spanish help must not keep English help line");
  assert.ok(!usage.includes("Options:"), "Spanish help must not keep English Options heading");
  assert.ok(!usage.includes("Propiedades permitidas:"), "Short Spanish help keeps the allowlist detail in --verbose");
  // Machine-facing tokens stay exact in the short help.
  for (const token of [
    "--client", "--access", "--site",
    "--all-sites", "--auth", "--secrets", "--key-file",
    "--dry-run", "--verbose", "--yes",
    "--language", "--help", "setup access readonly|full", "setup enable-write",
    "setup disable-write", "Quick Connect",
  ]) {
    assert.ok(usage.includes(token), `Spanish help must keep exact token: ${token}`);
  }
  // Every documented flag survives in the verbose help.
  const verbose = getSetupUsage("es", true);
  assert.match(verbose, /Propiedades permitidas:/);
  for (const token of [
    "--scopes", "--first-query",
    "--install-skill", "--enable-write", "--reauth", "--force",
    "GSC_SITE_URLS", "GSC_ENABLE_WRITE", "mcpServers.gsc",
    "skills@1.7.0", "google-search-console-mcp", "code->claude-code",
    "LC_ALL/LC_MESSAGES/LANG", '["all"]', "sites.list",
  ]) {
    assert.ok(verbose.includes(token), `Spanish verbose help must keep exact token: ${token}`);
  }
});

// --- --language validation: static safe errors, never echo ---

test("parseSetupLanguage accepts en/es and rejects everything else statically", () => {
  assert.equal(parseSetupLanguage("en"), "en");
  assert.equal(parseSetupLanguage("es"), "es");
  assert.throws(() => parseSetupLanguage("fr"), new Error(INVALID_SETUP_LANGUAGE_ERROR));
  assert.throws(() => parseSetupLanguage("EN"), new Error(INVALID_SETUP_LANGUAGE_ERROR));
  assert.throws(() => parseSetupLanguage(""), new Error(MISSING_SETUP_LANGUAGE_ERROR));
  assert.throws(() => parseSetupLanguage(undefined), new Error(MISSING_SETUP_LANGUAGE_ERROR));
  assert.throws(() => parseSetupLanguage("--help"), new Error(MISSING_SETUP_LANGUAGE_ERROR));
  assert.throws(() => parseSetupLanguage("--es"), new Error(MISSING_SETUP_LANGUAGE_ERROR));
});

test("invalid and missing --language values never echo input (pure)", () => {
  const sentinel = "SENTINEL-LANG-7d2a";
  for (const value of [`xx-${sentinel}`, sentinel]) {
    try {
      parseSetupLanguage(value);
      assert.fail(`expected throw for ${value}`);
    } catch (err) {
      assert.equal(err.message, INVALID_SETUP_LANGUAGE_ERROR);
      assert.ok(!err.message.includes(sentinel));
    }
  }
});

// --- Subprocess: localized help + safe failures ---

test("subprocess English help under pinned C locale", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Guided setup in 3 steps/);
  assert.match(r.stdout, /--language <locale>/);
  assert.ok(!r.stdout.includes("--first-query"), "Short help keeps the full reference in --verbose");
});

test("subprocess Spanish help via Spanish env", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "es_ES.UTF-8", LC_MESSAGES: "", LANG: "" }),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Configuraci.n guiada/);
  assert.match(r.stdout, /Muestra esta ayuda/);
});

test("subprocess verbose help prints every documented flag", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help", "--verbose"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Guided setup for the GSC MCP server/);
  for (const token of ["--first-query", "--install-skill", "--scopes", "--enable-write", "--reauth", "--force", "GSC_SITE_URLS", "mcpServers.gsc", "skills@1.7.0"]) {
    assert.ok(r.stdout.includes(token), `Verbose help must keep: ${token}`);
  }
  const short = spawnSync(process.execPath, [entry, "setup", "-h"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(short.status, 0);
  assert.match(short.stdout, /Guided setup in 3 steps/);
  assert.ok(!short.stdout.includes("--first-query"), "-h stays short");
  const verboseEs = spawnSync(process.execPath, [entry, "setup", "--help", "--verbose", "--language", "es"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(verboseEs.status, 0);
  assert.match(verboseEs.stdout, /Propiedades permitidas:/);
  assert.ok(verboseEs.stdout.includes("--install-skill"), "Spanish verbose help keeps every flag");
});

test("subprocess explicit --language overrides the environment", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const spanishEnv = helpEnv({ LC_ALL: "es_ES.UTF-8", LC_MESSAGES: "", LANG: "" });
  const forcedEnglish = spawnSync(process.execPath, [entry, "setup", "--language", "en", "--help"], {
    encoding: "utf8",
    env: spanishEnv,
  });
  assert.equal(forcedEnglish.status, 0);
  assert.match(forcedEnglish.stdout, /Guided setup in 3 steps/);

  const cEnv = helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" });
  const forcedSpanish = spawnSync(process.execPath, [entry, "setup", "--language", "es", "--help"], {
    encoding: "utf8",
    env: cEnv,
  });
  assert.equal(forcedSpanish.status, 0);
  assert.match(forcedSpanish.stdout, /Configuraci.n guiada/);
});

test("subprocess C env blocks a lower Spanish variable", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "", LANG: "es_ES.UTF-8" }),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Guided setup in 3 steps/);
});
test("subprocess invalid --language fails statically without echo", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-LANG-SUB-4b8e";
  const r = spawnSync(process.execPath, [entry, "setup", "--language", `xx-${sentinel}`, "--help"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid --language value\. Use en or es\./);
  assert.ok(!r.stderr.includes(sentinel));
  assert.ok(!r.stdout.includes(sentinel));
});

test("subprocess missing --language fails statically", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const missing = spawnSync(process.execPath, [entry, "setup", "--language"], {
    encoding: "utf8",
    env: helpEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }),
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--language needs a value/);

  const flagAsValue = spawnSync(process.execPath, [entry, "setup", "--language", "--help"], {
    encoding: "utf8",
    env: cleanEnv({ LC_ALL: "C" }),
  });
  assert.equal(flagAsValue.status, 1);
  assert.match(flagAsValue.stderr, /--language needs a value/);
});
