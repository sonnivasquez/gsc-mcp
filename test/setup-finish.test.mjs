import { CLI_TEST_TIMEOUT_MS, homeEnvironment } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const finish = await import("../dist/setup/finish.js");
const tools = await import("../dist/gsc/tools.js");
const setup = await import("../dist/setup.js");

const entries = [
  { siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" },
  { siteUrl: "https://b.example/", permissionLevel: "siteFullUser" },
];

test("finish report reuses the supplied sites.list entries without a second call", () => {
  const report = finish.buildFinishReport({
    authMode: "oauth (Quick Connect)",
    scope: "readonly",
    writeEnabled: false,
    allowlist: ["sc-domain:a.example", "https://b.example/"],
    clientOutcomes: [{ target: "print", status: "printed" }],
    siteEntries: entries,
    dryRun: false,
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.sections.map((s) => s.id),
    ["runtime", "auth", "api", "properties", "write_ops", "clients", "tools"]
  );
  const api = report.sections.find((s) => s.id === "api");
  assert.equal(api.ok, true);
  assert.match(api.detail, /2 properties visible/);
  assert.match(api.detail, /no second call/);
  const properties = report.sections.find((s) => s.id === "properties");
  assert.equal(properties.ok, true);
  assert.match(properties.detail, /all visible/);
  assert.match(properties.detail, /sc-domain:a\.example/);
  const clients = report.sections.find((s) => s.id === "clients");
  assert.equal(clients.ok, true);
  assert.match(clients.detail, /printed fallback \(manual, nothing written\): print/);
  assert.ok(!clients.detail.includes("configured"));
  const toolSection = report.sections.find((s) => s.id === "tools");
  assert.equal(toolSection.ok, true);
  assert.match(toolSection.detail, /29 gsc_\* tools/);
  const lines = finish.formatFinishReport(report);
  assert.match(lines[0], /Finish verification:/);
  assert.ok(lines.some((l) => l.includes("[ok] tools: 29 gsc_* tools")));
});

test("finish report stays honest when the account lists no properties", () => {
  const report = finish.buildFinishReport({
    authMode: "oauth (custom client)",
    scope: "full",
    writeEnabled: true,
    allowlist: ["sc-domain:a.example"],
    clientOutcomes: [{ target: "desktop", status: "applied" }],
    siteEntries: [],
    dryRun: false,
  });
  assert.equal(report.ok, false);
  assert.equal(report.sections.find((s) => s.id === "api").ok, false);
  const properties = report.sections.find((s) => s.id === "properties");
  assert.equal(properties.ok, false);
  assert.match(properties.detail, /unverified/);
  assert.match(report.sections.find((s) => s.id === "write_ops").detail, /ENABLED/);
  assert.match(report.sections.find((s) => s.id === "clients").detail, /configured: desktop/);
});

test("finish distinguishes applied, printed, skipped, and failed targets", () => {
  const base = {
    authMode: "oauth (custom client)",
    scope: "full",
    writeEnabled: false,
    allowlist: ["sc-domain:a.example"],
    siteEntries: [{ siteUrl: "sc-domain:a.example" }],
    dryRun: false,
  };
  const mixed = finish.buildFinishReport({
    ...base,
    clientOutcomes: [
      { target: "code", status: "applied" },
      { target: "desktop", status: "printed", note: "config path unavailable on this machine; generic JSON printed" },
    ],
  });
  const clients = mixed.sections.find((s) => s.id === "clients");
  assert.equal(clients.ok, true);
  assert.match(clients.detail, /configured: code/);
  assert.match(clients.detail, /printed fallback \(manual, nothing written\): desktop/);

  const declined = finish.buildFinishReport({
    ...base,
    clientOutcomes: [
      { target: "code", status: "applied" },
      { target: "cursor", status: "skipped", note: "not applied (declined or failed); nothing was changed" },
    ],
  });
  assert.equal(declined.ok, false);
  assert.equal(declined.sections.find((s) => s.id === "clients").ok, false);
  assert.match(declined.sections.find((s) => s.id === "clients").detail, /skipped \(nothing changed\): cursor/);

  const failed = finish.buildFinishReport({
    ...base,
    clientOutcomes: [{ target: "codex", status: "failed", note: "CLI invocation failed" }],
  });
  assert.equal(failed.ok, false);
  assert.match(failed.sections.find((s) => s.id === "clients").detail, /failed: codex/);
});

test("dry-run finish says previewed and never configured", () => {
  const report = finish.buildFinishReport({
    authMode: "oauth (Quick Connect)",
    scope: "readonly",
    writeEnabled: false,
    allowlist: ["sc-domain:a.example"],
    clientOutcomes: [
      { target: "desktop", status: "previewed", note: "preview only; no file written" },
      { target: "print", status: "printed" },
    ],
    siteEntries: [],
    dryRun: true,
  });
  const clients = report.sections.find((s) => s.id === "clients");
  assert.equal(clients.ok, true);
  assert.match(clients.detail, /preview: desktop previewed; print printed \(preview\); nothing configured/);
  assert.ok(!clients.detail.includes("configured:"));
});

test("dry-run finish preview performs no verification and says so", () => {
  const report = finish.buildFinishReport({
    authMode: "oauth (Quick Connect)",
    scope: "readonly",
    writeEnabled: false,
    allowlist: [],
    clientOutcomes: [{ target: "print", status: "printed" }],
    siteEntries: [],
    dryRun: true,
  });
  assert.equal(report.dryRun, true);
  assert.match(report.sections.find((s) => s.id === "api").detail, /skipped: --dry-run/);
  assert.match(report.sections.find((s) => s.id === "properties").detail, /preview/);
  assert.match(finish.formatFinishReport(report)[0], /dry-run preview/);
});

test("tool catalog mismatch fails honestly instead of claiming 29", () => {
  const section = finish.toolCatalogSummary(28);
  assert.equal(section.ok, false);
  assert.match(section.detail, /expected 29 gsc_\* tools, found 28/);
});

test("compiled tool catalog holds exactly 29 canonical tools", () => {
  assert.equal(tools.CANONICAL_TOOLS.length, 29);
  assert.equal(finish.EXPECTED_TOOL_COUNT, 29);
});

test("first-query confirmation is explicit opt-in only", () => {
  for (const yes of ["y", "Y", "yes", "YES", "  y  "]) {
    assert.equal(finish.parseFirstQueryAnswer(yes), true, JSON.stringify(yes));
  }
  for (const no of ["", "n", "N", "no", "yeah", "1", "yep"]) {
    assert.equal(finish.parseFirstQueryAnswer(no), false, JSON.stringify(no));
  }
});

test("sample window is a short 7-day inclusive range", () => {
  const window = finish.sampleWindow(Date.UTC(2026, 8, 23));
  assert.deepEqual(window, { startDate: "2026-09-17", endDate: "2026-09-23" });
  assert.equal(finish.SAMPLE_QUERY_WINDOW_DAYS, 7);
  assert.deepEqual([...finish.SAMPLE_QUERY_DIMENSIONS], ["date"]);
  assert.equal(finish.SAMPLE_QUERY_ROW_LIMIT, 5);
});

test("sample query reports totals without row contents", async () => {
  const window = { startDate: "2026-09-17", endDate: "2026-09-23" };
  const ok = await finish.runSampleQuery("sc-domain:a.example", window, async (site, win) => {
    assert.equal(site, "sc-domain:a.example");
    assert.deepEqual(win, window);
    return { rows: [{ keys: ["2026-09-22"], clicks: 4, impressions: 40 }] };
  });
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.summary, { rowCount: 1, clicks: 4, impressions: 40 });
  assert.match(ok.detail, /one minimal query on one property/);
  assert.ok(!JSON.stringify(ok).includes("2026-09-22"));
});

test("sample query without data or permission reports honestly", async () => {
  const window = { startDate: "2026-09-17", endDate: "2026-09-23" };
  const empty = await finish.runSampleQuery("sc-domain:a.example", window, async () => ({ rows: [] }));
  assert.equal(empty.status, "no_data");
  assert.match(empty.detail, /no success claimed/);

  const denied = await finish.runSampleQuery("sc-domain:a.example", window, async () => {
    throw new Error("403 Forbidden: insufficient permission");
  });
  assert.equal(denied.status, "denied");
  assert.equal(denied.code, "permission_denied");
  assert.match(denied.detail, /no success claimed/);

  const failed = await finish.runSampleQuery("sc-domain:a.example", window, async () => {
    throw new Error("socket hang up");
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.code, "query_error");
  assert.match(failed.detail, /without claiming success/);
});

test("sample query never leaks raw exception text", async () => {
  const window = { startDate: "2026-09-17", endDate: "2026-09-23" };
  const sentinel = "SENTINEL-LEAK-PROBE-9f8e";
  const cases = [
    { error: new Error(`kaboom ${sentinel} token=secret-value path=/private/x`), status: "error", code: "query_error" },
    { error: new Error(`403 Forbidden ${sentinel} refresh_token=secret-value`), status: "denied", code: "permission_denied" },
    { error: new Error(`ETIMEDOUT ${sentinel} internal-host=secret-value`), status: "error", code: "timeout" },
    { error: `${sentinel} bare string failure with secret-value`, status: "error", code: "query_error" },
  ];
  for (const { error, status, code } of cases) {
    const outcome = await finish.runSampleQuery("sc-domain:a.example", window, async () => { throw error; });
    assert.equal(outcome.status, status);
    assert.equal(outcome.code, code);
    assert.ok(!JSON.stringify(outcome).includes(sentinel), `leak for ${code}`);
    assert.ok(!JSON.stringify(outcome).includes("secret-value"), `leak for ${code}`);
  }
});

test("applyTargets reports printed for print-only without installing", async () => {
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const result = await setup.applyTargets(["print"], { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" }, prompter, {
    force: false, yes: true, dryRun: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["printed"]);
  assert.equal(result.outcomes[0].target, "print");
});

test("applyTargets reports printed fallback for an unavailable file target", async () => {
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const result = await setup.applyTargets(["desktop"], { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" }, prompter, {
    force: false, yes: true, dryRun: true,
  }, { resolveFileConfigPath: () => null });
  assert.equal(result.ok, true);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].target, "desktop");
  assert.equal(result.outcomes[0].status, "printed");
  assert.match(result.outcomes[0].note ?? "", /unavailable/);
});

test("applyTargets reports previewed in dry-run and skipped on decline without writing", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gsc-apply-"));
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const env = { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" };
  const preview = await setup.applyTargets(["desktop"], env, prompter, {
    force: false, yes: true, dryRun: true,
  }, { resolveFileConfigPath: () => join(dir, "preview-config.json") });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.outcomes.map((o) => o.status), ["previewed"]);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(join(dir, "preview-config.json")), false);

  const declined = await setup.applyTargets(["desktop"], env, prompter, {
    force: false, yes: false, dryRun: false,
  }, { resolveFileConfigPath: () => join(dir, "declined-config.json") });
  assert.equal(declined.ok, false);
  assert.deepEqual(declined.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(existsSync(join(dir, "declined-config.json")), false);
});

test("applyTargets reports failed on file failure and skipped only on decline", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gsc-apply-fail-"));
  const badFile = join(dir, "bad-config.json");
  writeFileSync(badFile, "{invalid json");
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const env = { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" };

  const failed = await setup.applyTargets(["desktop"], env, prompter, {
    force: false, yes: true, dryRun: false,
  }, { resolveFileConfigPath: () => badFile });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.outcomes.map((o) => o.status), ["failed"]);
  assert.equal(readFileSync(badFile, "utf8"), "{invalid json");

  const declinedCli = await setup.applyTargets(
    ["code"],
    env,
    prompter,
    { force: false, yes: false, dryRun: false },
    { runner: () => { throw new Error("runner must stay untouched after decline"); } }
  );
  assert.equal(declinedCli.ok, false);
  assert.deepEqual(declinedCli.outcomes.map((o) => o.status), ["skipped"]);
});

test("applyTargets reports failed when a dry-run helper fails", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gsc-apply-dryfail-"));
  const badFile = join(dir, "bad-config.json");
  writeFileSync(badFile, "{invalid json");
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const result = await setup.applyTargets(
    ["desktop"],
    { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" },
    prompter,
    { force: false, yes: true, dryRun: true },
    { resolveFileConfigPath: () => badFile }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["failed"]);
  assert.ok(!result.outcomes.some((o) => o.status === "previewed"));
});

test("sanitizeSetupFailure keeps controlled messages and sanitizes the rest", () => {
  assert.match(
    setup.sanitizeSetupFailure(new Error("Invalid --site value. Use sc-domain:... or an http(s):// URL.")),
    /^\nSetup failed: Invalid --site value\./
  );
  assert.match(
    setup.sanitizeSetupFailure(new Error("--client needs a value. Run with --help for usage.")),
    /needs a value/
  );
  const sentinel = "SENTINEL-SETUP-51ae";
  const sanitized = setup.sanitizeSetupFailure(
    new Error(`Request failed with status code 500 ${sentinel} body=secret-value path=/private/x`)
  );
  assert.match(sanitized, /setup_error/);
  assert.ok(!sanitized.includes(sentinel));
  assert.ok(!sanitized.includes("secret-value"));
  const bare = setup.sanitizeSetupFailure(`${sentinel} bare failure secret-value`);
  assert.match(bare, /setup_error/);
  assert.ok(!bare.includes(sentinel));
});

test("sanitizeSetupFailure blocks forged controlled-prefix external text", () => {
  const sentinel = "SENTINEL-FORGE-a71d";
  const forged = [
    `OAuth error: access_denied ${sentinel}`,
    `OAuth error: ${sentinel}`,
    `Invalid --site value. Use sc-domain:... or an http(s):// URL. ${sentinel}`,
    `Invalid property ${sentinel}`,
    `Invalid property selection: choose 0-3 or "all". ${sentinel}`,
    `QUICK CONNECT IS READONLY-ONLY ${sentinel}`,
    `--client needs a value ${sentinel}`,
  ];
  for (const message of forged) {
    const out = setup.sanitizeSetupFailure(new Error(message));
    assert.match(out, /setup_error/, message);
    assert.ok(!out.includes(sentinel), message);
  }
  assert.match(
    setup.sanitizeSetupFailure(new Error("OAuth authentication timed out after 2 minutes")),
    /^\nSetup failed: OAuth authentication timed out/
  );
  assert.match(
    setup.sanitizeSetupFailure(new Error('Invalid property selection: choose 0-3 or "all".')),
    /choose 0-3/
  );
});

test("invalid --scopes never echoes the rejected value", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-SCOPES-3f9c";
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--scopes", `readonly-${sentinel}`],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid --scopes value/);
  assert.ok(!r.stderr.includes(sentinel));
  assert.ok(!r.stdout.includes(sentinel));
});

test("unknown options and clients never echo user-supplied values", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-ARGS-5b2e";
  const unknown = spawnSync(process.execPath, [entry, "setup", "--language", "en", `--${sentinel}`], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option/);
  assert.ok(!unknown.stderr.includes(sentinel));
  const badClient = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--client", `bogus-${sentinel}`],
    { encoding: "utf8" }
  );
  assert.equal(badClient.status, 1);
  assert.match(badClient.stderr, /Invalid --client value/);
  assert.ok(!badClient.stderr.includes(sentinel));
});

test("runSetup never echoes rejected input values", async () => {
  const sentinel = "SENTINEL-INPUT-88c1";
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  try {
    const code = await setup.runSetup(["--language", "en", "--dry-run", "--site", `not-a-property-${sentinel}`]);
    assert.equal(code, 1);
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  const combined = errors.join("\n") + "\n" + logs.join("\n");
  assert.match(combined, /Invalid --site value/);
  assert.ok(!combined.includes(sentinel));
});

test("applyTargets reports failed when the CLI invocation fails", async () => {
  const prompter = { text: async () => "n", choose: async (_q, _c, d) => d, close: () => undefined };
  const result = await setup.applyTargets(
    ["code"],
    { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" },
    prompter,
    { force: false, yes: true, dryRun: false },
    { runner: () => ({ status: 1 }) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].status, "failed");
  assert.match(result.outcomes[0].note ?? "", /manual fallback/);
});

test("setup --help documents the explicit first-query flag", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help", "--verbose"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--first-query/);
  assert.match(r.stdout, /--yes never enables it/);
});

test("setup dry-run prints the finish preview without Google calls", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--all-sites", "--client", "print"],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0);
  // Finish diagnostics go to stderr so the generic JSON on stdout stays
  // the last structured content (T03 machine-readable contract).
  assert.match(r.stderr, /Finish verification \(dry-run preview\):/);
  assert.match(r.stderr, /\[ok\] tools: 29 gsc_\* tools/);
  assert.match(r.stderr, /Sample query skipped in --dry-run/);
  assert.match(r.stderr, /preview: print printed \(preview\); nothing configured/);
  const printed = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.ok(printed.mcpServers.gsc);
});

test("setup dry-run file target says previewed and never configured", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "desktop"],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0);
  assert.match(r.stderr, /desktop previewed/);
  assert.match(r.stderr, /nothing configured/);
  assert.ok(!r.stderr.includes("configured:"));
});

test("parseSetupSitesList shares the strict shape gate and preserves exact identifiers", () => {
  const exact = ["sc-domain:Example.COM", "https://shop.example/sale,2026/"];
  const valid = setup.parseSetupSitesList({
    siteEntry: [
      { siteUrl: exact[0], permissionLevel: "siteOwner" },
      { siteUrl: exact[1], permissionLevel: "siteFullUser" },
    ],
  });
  assert.deepEqual(valid.fetched, exact);
  assert.deepEqual(valid.siteEntries, [
    { siteUrl: exact[0], permissionLevel: "siteOwner" },
    { siteUrl: exact[1], permissionLevel: "siteFullUser" },
  ]);
  assert.deepEqual(setup.parseSetupSitesList({}), { fetched: [], siteEntries: [] });
  for (const [name, data] of [
    ["null member", { siteEntry: [null, {}] }],
    ["non-string siteUrl", { siteEntry: [{ siteUrl: 42 }] }],
    ["string body", "bogus"],
    ["non-array siteEntry", { siteEntry: "nope" }],
  ]) {
    assert.throws(() => setup.parseSetupSitesList(data), /UPSTREAM_SCHEMA_CHANGED/, name);
  }
});

test("runSetup fails before client configuration on malformed sites.list", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gsc-flow-"));
  const keyFile = join(dir, "sa.json");
  writeFileSync(keyFile, JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  }));
  const sentinel = "SENTINEL-SITES-91c4";
  const saved = {};
  for (const k of ["GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_AUTH_MODE", "GSC_KEY_FILE", "GSC_OAUTH_SECRETS_FILE", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_SITE_URLS", "GSC_ENABLE_WRITE"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--yes", "--auth", "service-account", "--key-file", keyFile,
        "--site", "sc-domain:a.example", "--client", "print"],
      { listSitesRaw: async () => { calls++; return { siteEntry: [null, { siteUrl: "x", permissionLevel: sentinel }] }; } }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  assert.equal(code, 1);
  assert.equal(calls, 1);
  const combined = errors.join("\n") + "\n" + logs.join("\n");
  assert.match(combined, /UPSTREAM_SCHEMA_CHANGED/);
  assert.ok(!combined.includes(sentinel));
  assert.ok(!combined.includes("mcpServers"), "no client configuration output");
  assert.ok(!combined.includes("Finish verification"), "no success-claiming finish");
});

test("runSetup with valid entries preserves exact identifiers end to end", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gsc-flow-"));
  const keyFile = join(dir, "sa.json");
  writeFileSync(keyFile, JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  }));
  const exact = "https://shop.example/sale,2026/";
  const saved = {};
  for (const k of ["GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_AUTH_MODE", "GSC_KEY_FILE", "GSC_OAUTH_SECRETS_FILE", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_SITE_URLS", "GSC_ENABLE_WRITE"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--verbose", "--yes", "--auth", "service-account", "--key-file", keyFile, "--site", exact, "--client", "print"],
      { listSitesRaw: async () => { calls++; return { siteEntry: [{ siteUrl: exact, permissionLevel: "siteOwner" }] }; } }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  assert.equal(code, 0);
  assert.equal(calls, 1);
  const jsonEntry = logs.find((line) => line.trim().startsWith("{"));
  assert.ok(jsonEntry, "printed generic JSON logged exactly once");
  const printed = JSON.parse(jsonEntry);
  assert.deepEqual(JSON.parse(printed.mcpServers.gsc.env.GSC_SITE_URLS), [exact]);
  assert.match(errors.join("\n"), /all visible/);
});

test("setup dry-run renders failed finish diagnostics and exits nonzero on helper failure", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const configPath = join(home, ".cursor", "mcp.json");
  writeFileSync(configPath, "{invalid json");
  const env = { ...process.env, ...homeEnvironment(home) };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "cursor"],
    { encoding: "utf8", env }
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dry-run preview; configuration failed/);
  assert.match(r.stderr, /cursor failed/);
  assert.ok(!r.stderr.includes("configured:"));
  assert.equal(readFileSync(configPath, "utf8"), "{invalid json");
  assert.deepEqual(readdirSync(join(home, ".cursor")), ["mcp.json"]);
});
