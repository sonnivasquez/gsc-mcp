import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
// T02 — localized core guided-journey flow.
// Focused English/Spanish coverage for the recommended-path headings/copy,
// exact machine tokens, locale-aware affirmatives, controlled localized
// failures, unknown-error redaction, and explicit --language overrides.
// Every flow case uses --dry-run --yes: no network call and no client write.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");
const i18n = await import("../dist/setup/i18n.js");
const setup = await import("../dist/setup.js");
const auth = await import("../dist/setup/auth.js");
const clientConfig = await import("../dist/client-config.js");

const { SETUP_STRINGS, isSetupAffirmative, translateSetup } = i18n;

function baseEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  return env;
}

const C_ENV = baseEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" });
const ES_ENV = baseEnv({ LC_ALL: "es_ES.UTF-8", LC_MESSAGES: "", LANG: "" });

function dryRunArgs(extra = []) {
  return [entry, "setup", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "print", ...extra];
}

// --- Catalog shape: English canonical/complete, Spanish translated, tokens exact ---

test("core catalog has identical keys in both locales with exact machine tokens", () => {
  const enKeys = Object.keys(SETUP_STRINGS.en).sort();
  const esKeys = Object.keys(SETUP_STRINGS.es).sort();
  assert.deepEqual(esKeys, enKeys);
  for (const key of enKeys) {
    assert.ok(SETUP_STRINGS.es[key].length > 0, `es.${key} must not be empty`);
  }
  // Product names and machine tokens stay exact in Spanish copy.
  assert.ok(SETUP_STRINGS.es.authOptionShared.includes("Quick Connect"));
  assert.ok(SETUP_STRINGS.es.authOptionCustom.includes("Custom OAuth"));
  assert.ok(SETUP_STRINGS.es.authOptionService.includes("Service Account"));
  assert.ok(translateSetup("es", "propertySelect", { count: 2 }).includes('"all"'));
  assert.ok(translateSetup("es", "propertySelect", { count: 2 }).includes('"0" o "all"'));
  assert.ok(translateSetup("es", "allowAllSelected").includes('"all"'));
  assert.ok(translateSetup("es", "allSitesPreview").includes("--all-sites"));
  assert.ok(translateSetup("es", "allSitesPreview").includes("sites.list"));
  assert.ok(translateSetup("es", "manualPropertyPrompt").includes("sc-domain:yoursite.com"));
  assert.ok(translateSetup("es", "genericFailure").includes("setup_error"));
  assert.ok(translateSetup("es", "genericFailure").includes("--dry-run"));
  const walkthrough = translateSetup("es", "customWalkthrough", {
    url: "docs/quickstart.md (custom OAuth client section)",
  });
  assert.ok(walkthrough.includes("docs/quickstart.md (custom OAuth client section)"));
  assert.ok(translateSetup("es", "clientPrompt").includes('"all"'));
});

// --- Locale-aware affirmatives: Spanish adds s/si/sí, English unchanged ---

test("affirmative handling accepts Spanish s/si/sí without changing English behavior", () => {
  for (const yes of ["y", "Y", "yes", "YES", "  y  "]) {
    assert.equal(isSetupAffirmative(yes, "en"), true, `en ${JSON.stringify(yes)}`);
    assert.equal(isSetupAffirmative(yes, "es"), true, `es ${JSON.stringify(yes)}`);
  }
  for (const yes of ["s", "S", "si", "SI", "sí", "SÍ", "  sí  "]) {
    assert.equal(isSetupAffirmative(yes, "es"), true, `es ${JSON.stringify(yes)}`);
    assert.equal(isSetupAffirmative(yes, "en"), false, `en ${JSON.stringify(yes)}`);
  }
  // Default-no is preserved in both locales.
  for (const no of ["", "n", "N", "no", "NO", "s i", "yep", "1"]) {
    assert.equal(isSetupAffirmative(no, "en"), false, `en ${JSON.stringify(no)}`);
    assert.equal(isSetupAffirmative(no, "es"), false, `es ${JSON.stringify(no)}`);
  }
});

test("decideAuth applies the locale-aware write confirmation", async () => {
  const stub = (answer) => ({
    choose: async () => 0,
    text: async () => answer,
    close: () => undefined,
  });
  // Legacy full path asks the separate write confirmation.
  const esYes = await auth.decideAuth(stub("si"), "custom", "full", false, undefined, "es");
  assert.equal(esYes.write, true);
  const enNo = await auth.decideAuth(stub("si"), "custom", "full", false, undefined, "en");
  assert.equal(enNo.write, false);
  const esPrompt = [];
  const capture = {
    choose: async () => 0,
    text: async (q) => {
      esPrompt.push(q);
      return "n";
    },
    close: () => undefined,
  };
  await auth.decideAuth(capture, "custom", "full", false, undefined, "es");
  assert.ok(esPrompt.some((q) => q.includes("escritura")), `write confirm in Spanish: ${esPrompt.join(" | ")}`);
});

// --- Recommended-path headings/copy with exact machine output (English) ---

test("English dry-run shows staged recommended-path copy with exact machine tokens", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, dryRunArgs(), { encoding: "utf8", env: C_ENV });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /Step 1 of 3.*Quick Connect/);
  assert.match(out, /Read only access/);
  assert.match(out, /Step 2 of 3/);
  assert.match(out, /Step 3 of 3/);
  assert.ok(!out.includes("Paso 1 de 3"), "English run must not leak Spanish copy");
  const printed = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.equal(printed.mcpServers.gsc.env.GSC_AUTH_MODE, "oauth");
  assert.equal(printed.mcpServers.gsc.env.GSC_ACCESS_MODE, "readonly");
  assert.deepEqual(JSON.parse(printed.mcpServers.gsc.env.GSC_SITE_URLS), ["sc-domain:a.example"]);
});

// --- Spanish dry-run via environment ---

test("Spanish dry-run via locale environment keeps identifiers and machine tokens exact", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, dryRunArgs(), { encoding: "utf8", env: ES_ENV });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /Paso 1 de 3.*Quick Connect/);
  assert.match(out, /solo lectura/);
  assert.match(out, /Paso 2 de 3/);
  assert.match(out, /Paso 3 de 3/);
  assert.ok(!out.includes("Step 1 of 3"), "Spanish run must not leak English stage copy");
  const printed = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.equal(printed.mcpServers.gsc.env.GSC_AUTH_MODE, "oauth");
  assert.equal(printed.mcpServers.gsc.env.GSC_ACCESS_MODE, "readonly");
  assert.deepEqual(JSON.parse(printed.mcpServers.gsc.env.GSC_SITE_URLS), ["sc-domain:a.example"]);
});

// --- Explicit --language overrides the environment ---

test("explicit --language overrides environment detection both ways", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const forcedEnglish = spawnSync(process.execPath, dryRunArgs(["--language", "en"]), {
    encoding: "utf8",
    env: ES_ENV,
  });
  assert.equal(forcedEnglish.status, 0, `stderr: ${forcedEnglish.stderr}`);
  assert.match(forcedEnglish.stdout + forcedEnglish.stderr, /Step 1 of 3/);
  assert.ok(!(forcedEnglish.stdout + forcedEnglish.stderr).includes("Paso 1 de 3"));

  const forcedSpanish = spawnSync(process.execPath, dryRunArgs(["--language", "es"]), {
    encoding: "utf8",
    env: C_ENV,
  });
  assert.equal(forcedSpanish.status, 0, `stderr: ${forcedSpanish.stderr}`);
  assert.match(forcedSpanish.stdout + forcedSpanish.stderr, /Paso 1 de 3/);
  assert.ok(!(forcedSpanish.stdout + forcedSpanish.stderr).includes("Step 1 of 3"));
});

// --- Controlled localized failures (Spanish) without echo ---

test("controlled failures render localized Spanish without echoing input", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-T02-ES-9c1d";
  const badSite = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--yes", "--language", "es", "--site", `not-a-property-${sentinel}`, "--client", "print"],
    { encoding: "utf8", env: C_ENV }
  );
  assert.equal(badSite.status, 1);
  assert.match(badSite.stderr + badSite.stdout, /Valor de --site no válido/);
  assert.ok(!(badSite.stderr + badSite.stdout).includes(sentinel));

  const badClient = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--language", "es", "--client", `bogus-${sentinel}`],
    { encoding: "utf8", env: C_ENV }
  );
  assert.equal(badClient.status, 1);
  assert.match(badClient.stderr + badClient.stdout, /Valor de --client no válido/);
  assert.ok(!(badClient.stderr + badClient.stdout).includes(sentinel));

  const unknown = spawnSync(process.execPath, [entry, "setup", "--language", "es", `--${sentinel}`], {
    encoding: "utf8",
    env: C_ENV,
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr + unknown.stdout, /Opción desconocida/);
  assert.ok(!(unknown.stderr + unknown.stdout).includes(sentinel));
});

test("bounded numeric selection patterns localize with the range preserved", () => {
  const esProperty = setup.sanitizeSetupFailure(new Error('Invalid property selection: choose 0-3 or "all".'), "es");
  assert.match(esProperty, /elija 0-3/);
  assert.ok(esProperty.includes('"all"'));
  assert.ok(!esProperty.includes("Invalid property selection"));
  const esClient = setup.sanitizeSetupFailure(new Error("Invalid client selection: choose 1-5."), "es");
  assert.match(esClient, /elija 1-5/);
  // English rendering is unchanged.
  assert.match(
    setup.sanitizeSetupFailure(new Error('Invalid property selection: choose 0-3 or "all".')),
    /choose 0-3/
  );
  assert.match(setup.sanitizeSetupFailure(new Error("Invalid client selection: choose 1-5.")), /choose 1-5/);
  // Forged suffixes still fail closed to the generic error with no echo.
  const sentinel = "SENTINEL-T02-FORGE-2a7f";
  const forged = setup.sanitizeSetupFailure(
    new Error(`Invalid property selection: choose 0-3 or "all". ${sentinel}`),
    "es"
  );
  assert.match(forged, /setup_error/);
  assert.ok(!forged.includes(sentinel));
});

// --- Unknown/upstream errors redact to a generic localized safe error ---

test("unknown errors map to a generic localized safe error with no raw text", () => {
  const sentinel = "SENTINEL-T02-LEAK-51b8";
  const es = setup.sanitizeSetupFailure(
    new Error(`Request failed 500 ${sentinel} token=secret path=/private/x https://internal/?q=1`),
    "es"
  );
  assert.match(es, /Error de configuración/);
  assert.match(es, /setup_error/);
  assert.ok(es.includes("--dry-run"), "generic Spanish error keeps the exact flag");
  assert.ok(!es.includes(sentinel));
  assert.ok(!es.includes("secret"));
  const en = setup.sanitizeSetupFailure(new Error(`kaboom ${sentinel} secret-value`));
  assert.match(en, /Setup failed \(setup_error\)/);
  assert.ok(!en.includes(sentinel));
});

// --- No network call and no client write on --dry-run --yes ---

test("dry-run localized flow makes no sites.list call and writes no client file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t02-"));
  const configPath = join(dir, "mcp.json");
  const saved = {};
  for (const k of [
    "GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_AUTH_MODE", "GSC_KEY_FILE",
    "GSC_OAUTH_SECRETS_FILE", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET",
    "GSC_SITE_URLS", "GSC_ENABLE_WRITE",
  ]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--dry-run", "--yes", "--language", "es", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "desktop"],
      {
        listSitesRaw: async () => {
          calls++;
          throw new Error("network must not be used in --dry-run");
        },
        resolveFileConfigPath: () => configPath,
      }
    );
  } finally {
    console.log = origLog;
    console.error = origError;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  assert.equal(code, 0);
  assert.equal(calls, 0, "dry-run must not call sites.list");
  assert.equal(existsSync(configPath), false, "dry-run must not write the client file");
  const out = logs.join("\n") + "\n" + errors.join("\n");
  assert.match(out, /Paso 1 de 3/);
  assert.match(out, /Paso 3 de 3/);
});

test("dry-run subprocess with a file target writes nothing to an isolated HOME", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-t02-home-"));
  // Isolate the Windows roaming profile under the temp HOME as well so the
  // expected path matches the child on every platform. Bun legitimately
  // creates cache files under HOME, so assert the product paths instead of
  // requiring HOME to stay completely empty.
  const isolatedAppData = join(home, "AppData", "Roaming");
  const savedAppData = process.env.APPDATA;
  let configPath;
  try {
    process.env.APPDATA = isolatedAppData;
    configPath = clientConfig.resolveFileConfigPath("desktop", home);
  } finally {
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
  }
  assert.ok(configPath !== null && configPath.startsWith(home), `desktop path stays under isolated HOME: ${configPath}`);
  const beforeExists = existsSync(configPath);
  const beforeContent = beforeExists ? readFileSync(configPath, "utf8") : null;
  const env = { ...C_ENV, HOME: home, USERPROFILE: home, APPDATA: isolatedAppData };
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "desktop"],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(existsSync(configPath), beforeExists, "dry-run must not create or remove the Desktop config");
  if (beforeExists) {
    assert.equal(readFileSync(configPath, "utf8"), beforeContent, "dry-run must not modify the Desktop config");
  }
  const dir = dirname(configPath);
  if (existsSync(dir)) {
    const base = basename(configPath);
    const backups = readdirSync(dir).filter((f) => f.startsWith(`${base}.backup-`));
    assert.deepEqual(backups, [], "dry-run must not create a Desktop backup");
  }
});
