import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
// T04 — localized skill, sample-query, finish-verification, and completion copy.
// Focused English/Spanish coverage for every finish header/section branch,
// skill statuses and failure modes, sample statuses/failures, Spanish
// affirmative/default-no handling, explicit language overrides, exact
// ID/code/token preservation, redaction, dry-run non-invocation, stdout JSON
// integrity, and the concise completion guidance. No network, no Google, no
// real config edits: temp dirs and injected seams only.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const finish = await import("../dist/setup/finish.js");
const skill = await import("../dist/setup/skill-install.js");
const setup = await import("../dist/setup.js");
const oauth = await import("../dist/oauth.js");
const clientConfig = await import("../dist/client-config.js");

const FAKE_SKILLS_DIR = join(root, "skills", "google-search-console-mcp");
const WINDOW = { startDate: "2026-09-17", endDate: "2026-09-23" };

function baseEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  return env;
}

const C_ENV = baseEnv({ LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" });
const ES_ENV = baseEnv({ LC_ALL: "es_ES.UTF-8", LC_MESSAGES: "", LANG: "" });

function baseInput(overrides = {}) {
  return {
    authMode: "oauth (Quick Connect)",
    scope: "readonly",
    writeEnabled: false,
    allowlist: ["sc-domain:a.example"],
    clientOutcomes: [{ target: "print", status: "printed" }],
    siteEntries: [{ siteUrl: "sc-domain:a.example" }],
    dryRun: false,
    ...overrides,
  };
}

// --- Finish headers: all four variants in both locales ---

test("finish headers render in English by default and in Spanish with locale", () => {
  const live = finish.buildFinishReport(baseInput());
  assert.equal(finish.formatFinishReport(live)[0], "Finish verification:");
  const dry = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [] }));
  assert.match(finish.formatFinishReport(dry)[0], /^Finish verification \(dry-run preview\):$/);
  assert.match(
    finish.formatFinishReport(live, { configFailed: true })[0],
    /^Finish verification \(configuration failed\):$/
  );
  assert.match(
    finish.formatFinishReport(dry, { configFailed: true })[0],
    /^Finish verification \(dry-run preview; configuration failed\):$/
  );

  const es = finish.buildFinishReport(baseInput({ locale: "es" }));
  assert.equal(es.locale, "es");
  // The report locale flows into formatting without an explicit option.
  assert.equal(finish.formatFinishReport(es)[0], "Verificación final:");
  const esDry = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [], locale: "es" }));
  assert.equal(
    finish.formatFinishReport(esDry)[0],
    "Verificación final (vista previa dry-run):"
  );
  assert.equal(
    finish.formatFinishReport(es, { configFailed: true })[0],
    "Verificación final (la configuración falló):"
  );
  assert.equal(
    finish.formatFinishReport(esDry, { configFailed: true })[0],
    "Verificación final (vista previa dry-run; la configuración falló):"
  );
  // An explicit formatting locale overrides the report locale.
  assert.equal(finish.formatFinishReport(es, { locale: "en" })[0], "Finish verification:");
  assert.equal(finish.formatFinishReport(live, { locale: "es" })[0], "Verificación final:");
  // Spanish headers keep the exact dry-run marker and never leak English copy.
  assert.ok(finish.formatFinishReport(esDry)[0].includes("dry-run"));
  assert.ok(!finish.formatFinishReport(esDry)[0].includes("Finish verification"));
});

// --- Section IDs and markers stay exact in every locale ---

test("section IDs and ok markers stay exact in Spanish", () => {
  const en = finish.buildFinishReport(baseInput());
  const es = finish.buildFinishReport(baseInput({ locale: "es" }));
  assert.deepEqual(
    es.sections.map((s) => s.id),
    en.sections.map((s) => s.id)
  );
  assert.deepEqual(
    es.sections.map((s) => s.id),
    ["runtime", "auth", "api", "properties", "write_ops", "clients", "tools"]
  );
  for (const line of finish.formatFinishReport(es)) {
    if (line === "Verificación final:") continue;
    assert.match(line, /^  \[(ok|!!)\] [a-z_]+: /);
  }
  const withSkill = finish.buildFinishReport(
    baseInput({ locale: "es", skill: { status: "installed", detail: "x" } })
  );
  assert.equal(withSkill.sections.at(-1).id, "skill");
});

// --- Auth section: mode/scope values exact, surrounding copy localized ---

test("auth section keeps mode and scope values exact", () => {
  const en = finish.buildFinishReport(baseInput());
  assert.equal(en.sections.find((s) => s.id === "auth").detail, "oauth (Quick Connect) (readonly scope)");
  const es = finish.buildFinishReport(baseInput({ locale: "es" }));
  const detail = es.sections.find((s) => s.id === "auth").detail;
  assert.ok(detail.includes("oauth (Quick Connect)"), detail);
  assert.ok(detail.includes("readonly"), detail);
  assert.ok(detail.includes("alcance"), detail);
  assert.ok(!detail.includes(" scope)"), detail);
});

// --- API section branches ---

test("api section branches localize with sites.list and counts exact", () => {
  const dryEn = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [] }));
  assert.match(dryEn.sections.find((s) => s.id === "api").detail, /skipped: --dry-run/);
  assert.match(dryEn.sections.find((s) => s.id === "api").detail, /sites\.list/);
  const dryEs = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [], locale: "es" }));
  const dryDetail = dryEs.sections.find((s) => s.id === "api").detail;
  assert.ok(dryDetail.includes("--dry-run"), dryDetail);
  assert.ok(dryDetail.includes("sites.list"), dryDetail);
  assert.ok(!dryDetail.includes("skipped: --dry-run performs no Google calls"), dryDetail);

  const oneEn = finish.buildFinishReport(baseInput());
  assert.match(oneEn.sections.find((s) => s.id === "api").detail, /1 property visible/);
  const oneEs = finish.buildFinishReport(baseInput({ locale: "es" }));
  const oneDetail = oneEs.sections.find((s) => s.id === "api").detail;
  assert.ok(oneDetail.includes("1 propiedad visible"), oneDetail);
  assert.ok(oneDetail.includes("sites.list"), oneDetail);
  assert.ok(!oneDetail.includes("reachable"), oneDetail);

  const manyEs = finish.buildFinishReport(
    baseInput({
      locale: "es",
      siteEntries: [{ siteUrl: "sc-domain:a.example" }, { siteUrl: "https://b.example/" }],
      allowlist: ["sc-domain:a.example", "https://b.example/"],
    })
  );
  assert.ok(manyEs.sections.find((s) => s.id === "api").detail.includes("2 propiedades visibles"));

  const emptyEn = finish.buildFinishReport(baseInput({ siteEntries: [] }));
  assert.equal(emptyEn.sections.find((s) => s.id === "api").ok, false);
  assert.match(emptyEn.sections.find((s) => s.id === "api").detail, /listed no properties/);
  const emptyEs = finish.buildFinishReport(baseInput({ siteEntries: [], locale: "es" }));
  assert.equal(emptyEs.sections.find((s) => s.id === "api").ok, false);
  assert.ok(!emptyEs.sections.find((s) => s.id === "api").detail.includes("listed no properties"));
});

// --- Properties section branches ---

test("properties section branches localize with identifiers and counts exact", () => {
  const exact = "https://shop.example/sale,2026/";
  const previewEn = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [] }));
  assert.match(previewEn.sections.find((s) => s.id === "properties").detail, /preview: 1 selected property/);
  const previewEs = finish.buildFinishReport(baseInput({ dryRun: true, siteEntries: [], locale: "es" }));
  assert.ok(previewEs.sections.find((s) => s.id === "properties").detail.includes("vista previa: 1 propiedad seleccionada"));
  const previewManyEs = finish.buildFinishReport(
    baseInput({ dryRun: true, siteEntries: [], allowlist: ["a", "b", "c"], locale: "es" })
  );
  assert.ok(previewManyEs.sections.find((s) => s.id === "properties").detail.includes("3 propiedades seleccionadas"));

  const noneEn = finish.buildFinishReport(baseInput({ allowlist: [], siteEntries: [] }));
  assert.match(noneEn.sections.find((s) => s.id === "properties").detail, /serve would reject/);
  const noneEs = finish.buildFinishReport(baseInput({ allowlist: [], siteEntries: [], locale: "es" }));
  const noneDetail = noneEs.sections.find((s) => s.id === "properties").detail;
  assert.ok(noneDetail.includes("serve"), noneDetail);
  assert.ok(!noneDetail.includes("serve would reject"), noneDetail);

  const unverifiedEs = finish.buildFinishReport(
    baseInput({ allowlist: [exact], siteEntries: [], locale: "es" })
  );
  assert.equal(unverifiedEs.sections.find((s) => s.id === "properties").ok, false);
  assert.ok(!unverifiedEs.sections.find((s) => s.id === "properties").detail.includes("stored exactly"));

  const allEs = finish.buildFinishReport(
    baseInput({ allowlist: [exact], siteEntries: [{ siteUrl: exact }], locale: "es" })
  );
  assert.equal(allEs.sections.find((s) => s.id === "properties").ok, true);
  const allDetail = allEs.sections.find((s) => s.id === "properties").detail;
  assert.ok(allDetail.includes(exact), "comma-containing identifier stays byte-exact");
  assert.ok(!allDetail.includes("all visible"), allDetail);

  const partialEs = finish.buildFinishReport(
    baseInput({
      allowlist: ["sc-domain:a.example", "https://b.example/"],
      siteEntries: [{ siteUrl: "sc-domain:a.example" }],
      locale: "es",
    })
  );
  const partialDetail = partialEs.sections.find((s) => s.id === "properties").detail;
  assert.ok(partialDetail.includes("1 de 2"), partialDetail);
  assert.ok(!partialDetail.includes("of 2 selected properties visible"), partialDetail);
});

// --- Write-ops branches ---

test("write-ops branches localize with env keys exact", () => {
  assert.equal(
    finish.describeWriteState("readonly", false, "readonly"),
    "Google write ops disabled (GSC_ACCESS_MODE=readonly)"
  );
  assert.equal(
    finish.describeWriteState("full", true, "full"),
    "Google write ops ENABLED (GSC_ACCESS_MODE=full)"
  );
  assert.equal(
    finish.describeWriteState("full", true),
    "Google write ops ENABLED (full scope + GSC_ENABLE_WRITE=1)"
  );
  assert.equal(
    finish.describeWriteState("readonly", false),
    "Google write ops disabled (needs GSC_SCOPES=full plus GSC_ENABLE_WRITE=1)"
  );
  const esFull = finish.describeWriteState("full", true, "full", "es");
  assert.ok(esFull.includes("GSC_ACCESS_MODE=full"), esFull);
  assert.ok(!esFull.includes("Google write ops ENABLED"), esFull);
  const esLegacy = finish.describeWriteState("full", true, undefined, "es");
  assert.ok(esLegacy.includes("GSC_ENABLE_WRITE=1"), esLegacy);
  assert.ok(esLegacy.includes("full"), esLegacy);
  const esOff = finish.describeWriteState("readonly", false, undefined, "es");
  assert.ok(esOff.includes("GSC_SCOPES=full"), esOff);
  assert.ok(esOff.includes("GSC_ENABLE_WRITE=1"), esOff);
  assert.ok(!esOff.includes("needs GSC_SCOPES=full plus"), esOff);
});

// --- Clients branches ---

test("clients branches localize with target names exact", () => {
  const noneEn = finish.summarizeTargetOutcomes([], false);
  assert.equal(noneEn.detail, "no client targets requested");
  const noneEs = finish.summarizeTargetOutcomes([], false, "es");
  assert.ok(!noneEs.detail.includes("no client targets requested"));

  const mixed = [
    { target: "code", status: "applied" },
    { target: "desktop", status: "printed" },
    { target: "cursor", status: "skipped" },
    { target: "codex", status: "failed" },
  ];
  const en = finish.summarizeTargetOutcomes(mixed, false);
  assert.match(en.detail, /configured: code/);
  assert.match(en.detail, /printed fallback \(manual, nothing written\): desktop/);
  assert.match(en.detail, /skipped \(nothing changed\): cursor/);
  assert.match(en.detail, /failed: codex/);
  const es = finish.summarizeTargetOutcomes(mixed, false, "es");
  for (const target of ["code", "desktop", "cursor", "codex"]) {
    assert.ok(es.detail.includes(target), `target ${target} stays exact`);
  }
  assert.ok(!es.detail.includes("configured: code"), "human detail localizes");
  assert.ok(!es.detail.includes("printed fallback"), "human detail localizes");

  const dryEn = finish.summarizeTargetOutcomes(
    [
      { target: "desktop", status: "previewed" },
      { target: "print", status: "printed" },
    ],
    true
  );
  assert.equal(dryEn.detail, "preview: desktop previewed; print printed (preview); nothing configured");
  const dryEs = finish.summarizeTargetOutcomes(
    [
      { target: "desktop", status: "previewed" },
      { target: "print", status: "printed" },
    ],
    true,
    "es"
  );
  assert.ok(dryEs.detail.includes("desktop"), "target stays exact");
  assert.ok(dryEs.detail.includes("print"), "target stays exact");
  assert.ok(dryEs.detail.includes("nada configurado"), dryEs.detail);
  assert.ok(!dryEs.detail.includes("nothing configured"), dryEs.detail);
});

// --- Tools branches ---

test("tools branches localize with counts and gsc_* exact", () => {
  const okEn = finish.toolCatalogSummary();
  assert.equal(okEn.detail, "34 gsc_* tools (canonical catalog)");
  const okEs = finish.toolCatalogSummary(34, "es");
  assert.ok(okEs.detail.includes("34"), okEs.detail);
  assert.ok(okEs.detail.includes("gsc_*"), okEs.detail);
  assert.ok(!okEs.detail.includes("canonical catalog"), okEs.detail);
  const badEn = finish.toolCatalogSummary(28);
  assert.match(badEn.detail, /expected 34 gsc_\* tools, found 28/);
  const badEs = finish.toolCatalogSummary(28, "es");
  assert.ok(badEs.detail.includes("34"), badEs.detail);
  assert.ok(badEs.detail.includes("28"), badEs.detail);
  assert.ok(badEs.detail.includes("gsc_*"), badEs.detail);
  assert.ok(!badEs.detail.includes("expected 34"), badEs.detail);
});

// --- Skill section: statuses exact, report honesty preserved ---

test("skill section keeps statuses exact in both locales", () => {
  for (const locale of ["en", "es"]) {
    const opts = locale === "es" ? { locale: "es" } : {};
    const installed = finish.buildFinishReport({
      ...baseInput(),
      ...opts,
      skill: { status: "installed", detail: "installed globally via pinned skills@1.7.0 (agents: claude-code)" },
    });
    assert.equal(installed.sections.find((s) => s.id === "skill").ok, true);
    const failed = finish.buildFinishReport({
      ...baseInput(),
      ...opts,
      skill: { status: "failed", detail: "skill install failed (exit_nonzero); MCP client config unchanged" },
    });
    assert.equal(failed.sections.find((s) => s.id === "skill").ok, false);
    assert.equal(failed.ok, false);
  }
});

// --- Parsers: English canonical by default, Spanish adds s/si/sí ---

test("first-query and skill confirmations stay English-canonical without a locale", () => {
  for (const yes of ["y", "Y", "yes", "YES", "  y  "]) {
    assert.equal(finish.parseFirstQueryAnswer(yes), true, JSON.stringify(yes));
    assert.equal(skill.parseInstallSkillAnswer(yes), true, JSON.stringify(yes));
  }
  for (const no of ["", "n", "N", "no", "yeah", "1", "yep", "s", "si", "sí"]) {
    assert.equal(finish.parseFirstQueryAnswer(no), false, JSON.stringify(no));
    assert.equal(skill.parseInstallSkillAnswer(no), false, JSON.stringify(no));
  }
});

test("Spanish confirmations accept s/si/sí alongside y/yes with default-no", () => {
  for (const yes of ["y", "yes", "s", "S", "si", "SI", "sí", "SÍ", "  sí  "]) {
    assert.equal(finish.parseFirstQueryAnswer(yes, "es"), true, `es ${JSON.stringify(yes)}`);
    assert.equal(skill.parseInstallSkillAnswer(yes, "es"), true, `es ${JSON.stringify(yes)}`);
  }
  for (const no of ["", "n", "N", "no", "NO", "s i", "yep", "1"]) {
    assert.equal(finish.parseFirstQueryAnswer(no, "es"), false, `es ${JSON.stringify(no)}`);
    assert.equal(skill.parseInstallSkillAnswer(no, "es"), false, `es ${JSON.stringify(no)}`);
  }
});

// --- Sample query: statuses, codes, dates, and redaction in both locales ---

test("sample query outcomes keep statuses, codes, and dates exact in both locales", async () => {
  for (const locale of ["en", "es"]) {
    const args = locale === "es" ? [locale] : [];
    const ok = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => ({
      rows: [{ keys: ["2026-09-22"], clicks: 4, impressions: 40 }],
    }), ...args);
    assert.equal(ok.status, "ok");
    assert.equal(ok.code, "ok");
    assert.deepEqual(ok.summary, { rowCount: 1, clicks: 4, impressions: 40 });
    assert.ok(ok.detail.includes("2026-09-17..2026-09-23"), `dates exact (${locale})`);
    assert.ok(!JSON.stringify(ok).includes("2026-09-22"), `row contents never leak (${locale})`);

    const empty = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => ({ rows: [] }), ...args);
    assert.equal(empty.status, "no_data");
    assert.equal(empty.code, "no_data");

    const denied = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => {
      throw new Error("403 Forbidden: insufficient permission");
    }, ...args);
    assert.equal(denied.status, "denied");
    assert.equal(denied.code, "permission_denied");
    assert.ok(denied.detail.includes("permission_denied"), `code exact (${locale})`);

    const timeout = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => {
      throw new Error("ETIMEDOUT waiting");
    }, ...args);
    assert.equal(timeout.status, "error");
    assert.equal(timeout.code, "timeout");
    assert.ok(timeout.detail.includes("timeout"), `code exact (${locale})`);

    const failed = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => {
      throw new Error("socket hang up");
    }, ...args);
    assert.equal(failed.status, "error");
    assert.equal(failed.code, "query_error");
    assert.ok(failed.detail.includes("query_error"), `code exact (${locale})`);
  }
  const esOk = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => ({
    rows: [{ keys: ["x"], clicks: 1, impressions: 2 }],
  }), "es");
  assert.ok(!esOk.detail.includes("one minimal query on one property"), "Spanish detail localizes");
  assert.ok(esOk.detail.includes("1 filas") || esOk.detail.includes("1 fila"), esOk.detail);
});

test("sample query redaction holds in Spanish", async () => {
  const sentinel = "SENTINEL-T04-ES-6d3a";
  const cases = [
    { error: new Error(`kaboom ${sentinel} token=secret-value`), status: "error", code: "query_error" },
    { error: new Error(`403 Forbidden ${sentinel} refresh_token=secret-value`), status: "denied", code: "permission_denied" },
    { error: new Error(`ETIMEDOUT ${sentinel} internal-host=secret-value`), status: "error", code: "timeout" },
  ];
  for (const { error, status, code } of cases) {
    const outcome = await finish.runSampleQuery("sc-domain:a.example", WINDOW, async () => { throw error; }, "es");
    assert.equal(outcome.status, status);
    assert.equal(outcome.code, code);
    assert.ok(!JSON.stringify(outcome).includes(sentinel), `leak for ${code}`);
    assert.ok(!JSON.stringify(outcome).includes("secret-value"), `leak for ${code}`);
  }
});

// --- Skill install in Spanish: all statuses and failure modes ---

test("Spanish dry-run previews the exact pinned argv and invokes nothing", async () => {
  let calls = 0;
  const logs = [];
  const outcome = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: ["claude-code"],
    dryRun: true,
    log: (m) => logs.push(m),
    locale: "es",
    runner: () => {
      calls++;
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "previewed");
  assert.equal(calls, 0);
  assert.deepEqual(outcome.agents, ["claude-code"]);
  const expectedSkillPrefix = clientConfig.currentRuntime() === "bun" ? "bunx --bun skills@1.7.0 add " : "npx --yes skills@1.7.0 add ";
  assert.ok(outcome.command.includes(expectedSkillPrefix), outcome.command);
  assert.ok(outcome.command.includes("--skill google-search-console-mcp"), outcome.command);
  assert.ok(outcome.command.includes("--agent claude-code --yes"), outcome.command);
  assert.ok(!outcome.detail.includes("preview: "), "Spanish detail localizes");
  assert.ok(logs.join("\n").includes("[dry run preview]"), "dry-run marker stays exact");
});

test("Spanish unsupported targets invoke nothing and fail nothing", async () => {
  let calls = 0;
  const outcome = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: [],
    dryRun: false,
    log: () => {},
    locale: "es",
    runner: () => {
      calls++;
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "unsupported");
  assert.equal(calls, 0);
  assert.ok(outcome.detail.includes("code/cursor/codex"), "compatible targets stay exact");
});

test("Spanish skill failures report codes truthfully without touching MCP config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t04-skill-"));
  const configPath = join(dir, "mcp.json");
  const clientConfig = await import("../dist/client-config.js");
  const written = await clientConfig.applyFileConfig({
    configPath,
    entry: clientConfig.buildSetupEntry({ GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" }),
    force: true,
    yes: true,
    dryRun: false,
    confirm: async () => "y",
    log: () => {},
  });
  assert.equal(written, true);
  const before = readFileSync(configPath, "utf8");

  const cases = [
    ["nonzero exit", () => ({ status: 1 }), "exit_nonzero"],
    ["throw", () => { throw new Error("spawn down"); }, "launch_error"],
    ["ENOENT", () => ({ status: null, error: Object.assign(new Error("missing"), { code: "ENOENT" }) }), "cli_missing"],
    ["missing bundle", null, "missing_bundle"],
  ];
  for (const [name, runner, code] of cases) {
    const logs = [];
    const outcome = await skill.installSkill({
      skillsDir: name === "missing bundle" ? mkdtempSync(join(tmpdir(), "gsc-t04-missing-")) : FAKE_SKILLS_DIR,
      agents: ["codex"],
      dryRun: false,
      log: (m) => logs.push(m),
      locale: "es",
      ...(runner !== null ? { runner } : {}),
    });
    assert.equal(outcome.status, "failed", name);
    assert.ok(outcome.detail.includes(`(${code})`), `${name}: code ${code} stays exact`);
    assert.ok(outcome.command.includes("skills@1.7.0"), `${name}: pinned CLI stays exact`);
    assert.equal(readFileSync(configPath, "utf8"), before, `MCP config mutated by ${name}`);
  }

  const installed = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: ["cursor"],
    dryRun: false,
    log: () => {},
    locale: "es",
    runner: () => ({ status: 0 }),
  });
  assert.equal(installed.status, "installed");
  assert.ok(installed.detail.includes("skills@1.7.0"), "pinned CLI stays exact");
  assert.ok(installed.detail.includes("cursor"), "agent name stays exact");
  assert.ok(!installed.detail.includes("installed globally via pinned"), "Spanish detail localizes");
});

// --- Localized setup flow: dry-run stdout JSON integrity ---

test("Spanish dry-run keeps stdout JSON exact while human copy localizes", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--verbose", "--yes", "--language", "es", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "print"],
    { encoding: "utf8", env: C_ENV }
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /Verificación final \(vista previa dry-run\):/);
  assert.match(r.stderr, /Consulta de muestra omitida en --dry-run/);
  assert.match(r.stderr, /Instalación de la skill omitida/);
  assert.ok(!r.stderr.includes("Finish verification:"), "no English header leak");
  assert.ok(!r.stderr.includes("Sample query skipped in --dry-run"), "no English sample leak");
  const printed = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.equal(printed.mcpServers.gsc.env.GSC_AUTH_MODE, "oauth");
  assert.equal(printed.mcpServers.gsc.env.GSC_ACCESS_MODE, "readonly");
  assert.deepEqual(JSON.parse(printed.mcpServers.gsc.env.GSC_SITE_URLS), ["sc-domain:a.example"]);
});

test("explicit --language overrides environment detection for finish and sample copy", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const forcedSpanish = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--verbose", "--yes", "--language", "es", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "print"],
    { encoding: "utf8", env: C_ENV }
  );
  assert.equal(forcedSpanish.status, 0);
  assert.match(forcedSpanish.stderr, /Verificación final/);

  const forcedEnglish = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--verbose", "--yes", "--language", "en", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "print"],
    { encoding: "utf8", env: ES_ENV }
  );
  assert.equal(forcedEnglish.status, 0);
  assert.match(forcedEnglish.stderr, /Finish verification \(dry-run preview\):/);
  assert.match(forcedEnglish.stderr, /Sample query skipped in --dry-run/);
  assert.ok(!forcedEnglish.stderr.includes("Verificación final"), "no Spanish leak under explicit en");
});

// --- Concise completion guidance: one next action, token path, revocation, reauth ---

function writeTempKeyFile(dir) {
  const keyFile = join(dir, "sa.json");
  writeFileSync(keyFile, JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  }));
  return keyFile;
}

function saveSetupEnv() {
  const saved = {};
  for (const k of ["GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_AUTH_MODE", "GSC_KEY_FILE", "GSC_OAUTH_SECRETS_FILE", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_SITE_URLS", "GSC_ENABLE_WRITE"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return saved;
}

function restoreSetupEnv(saved) {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

async function livePrintRun(extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t04-done-"));
  const keyFile = writeTempKeyFile(dir);
  const saved = saveSetupEnv();
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--verbose", "--yes", "--auth", "service-account", "--key-file", keyFile, "--site", "sc-domain:a.example", "--client", "print", ...extraArgs],
      { listSitesRaw: async () => ({ siteEntry: [{ siteUrl: "sc-domain:a.example" }] }) }
    );
  } finally {
    console.log = origLog;
    console.error = origError;
    restoreSetupEnv(saved);
  }
  return { code, logs, errors };
}

test("English completion is concise with exact token path, revocation URL, and reauth command", async () => {
  const { code, logs } = await livePrintRun(["--language", "en"]);
  assert.equal(code, 0);
  const out = logs.join("\n");
  assert.match(out, /Setup complete\. Next, ask your agent: "What are my quick win keywords\?"/);
  assert.ok(out.includes(`OAuth tokens use ${oauth.cachedTokenPath()} for local storage and are sent to Google for authentication, not to the maintainer.`), "token path and Google authentication disclosure exact");
  assert.ok(!out.includes("never leaves this machine"), "do not claim tokens never reach Google");
  assert.ok(out.includes("Revoke access any time at https://myaccount.google.com/permissions"), "revocation URL exact");
  assert.ok(out.includes("Change access level later by re-running: gsc setup --reauth"), "reauth command exact");
  // The verbose three-question tail is gone: exactly one quoted next action.
  assert.ok(!out.includes("Done. Try asking Claude:"), "verbose tail replaced");
  assert.ok(!out.includes("Which pages lost traffic this month and why?"), "single next action only");
  assert.ok(!out.includes("What are my top image search queries?"), "single next action only");
});

test("Spanish completion localizes guidance with exact path, URL, command, and question", async () => {
  const { code, logs } = await livePrintRun(["--language", "es"]);
  assert.equal(code, 0);
  const out = logs.join("\n");
  assert.match(out, /Configuración completa\. Siguiente paso, pregunte a su agente:/);
  assert.ok(out.includes('"¿Qué palabras clave ofrecen oportunidades rápidas?"'), "suggested question translated to neutral Spanish");
  assert.ok(!out.includes('"What are my quick win keywords?"'), "no English question leak in Spanish output");
  assert.ok(out.includes(oauth.cachedTokenPath()), "token path stays exact");
  assert.ok(out.includes("https://myaccount.google.com/permissions"), "revocation URL stays exact");
  assert.ok(out.includes("gsc setup --reauth"), "reauth command stays exact");
  assert.ok(!out.includes("Setup complete."), "no English completion leak");
  assert.ok(!out.includes("OAuth tokens use"), "no English token-line leak");
  assert.ok(out.includes(`Los tokens OAuth usan ${oauth.cachedTokenPath()} como almacenamiento local y se envían a Google para autenticar, no al mantenedor.`), "token disclosure stays exact in Spanish");
  assert.ok(!out.includes("nunca sale"), "do not claim tokens never reach Google");
});

// --- --yes alone never enables skill install or sample query, in Spanish too ---

test("--yes alone never opts into skill install or sample query under Spanish locale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t04-yes-"));
  const keyFile = writeTempKeyFile(dir);
  const saved = saveSetupEnv();
  const errors = [];
  const logs = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--verbose", "--yes", "--language", "es", "--auth", "service-account", "--key-file", keyFile, "--site", "sc-domain:a.example", "--client", "print"],
      {
        listSitesRaw: async () => ({ siteEntry: [{ siteUrl: "sc-domain:a.example" }] }),
        skillsDir: FAKE_SKILLS_DIR,
        skillRunner: () => {
          calls++;
          return { status: 0 };
        },
      }
    );
  } finally {
    console.log = origLog;
    console.error = origError;
    restoreSetupEnv(saved);
  }
  assert.equal(code, 0);
  assert.equal(calls, 0, "skill runner never invoked without --install-skill");
  const stderr = errors.join("\n");
  assert.ok(stderr.includes("Instalación de la skill omitida (pase --install-skill"), "Spanish skill skip");
  assert.ok(!stderr.includes("[ok] skill:"), "no skill section without opt-in");
});
