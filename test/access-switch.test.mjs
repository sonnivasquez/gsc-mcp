import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runSetup, runEnableWriteCommand, runDisableWriteCommand } from "../dist/setup.js";
import { applyWriteFileConfig, cursorConfigPath } from "../dist/client-config.js";

function fixture(env = {}) {
  const home = mkdtempSync(join(tmpdir(), "gsc-access-switch-"));
  const configPath = cursorConfigPath(home);
  mkdirSync(dirname(configPath), { recursive: true });
  const config = { keep: true, mcpServers: {
    other: { command: "other", env: { SECRET: "secret-marker" } },
    gsc: { command: "custom-node", args: ["/installed/index.js"], custom: true,
      env: { GSC_AUTH_MODE: "service_account", GSC_SITE_URLS: '["sc-domain:example.test"]', SECRET: "secret-marker", ...env } },
  } };
  writeFileSync(configPath, JSON.stringify(config));
  return { home, configPath, config, before: readFileSync(configPath, "utf8") };
}

async function command(home, args) {
  const lines = [];
  const log = console.log;
  const error = console.error;
  console.log = console.error = (message) => lines.push(String(message));
  try { return { code: await runSetup(args, { homeDir: home }), text: lines.join("\n") }; }
  finally { console.log = log; console.error = error; }
}

test("access switch replaces only access keys and preserves installed entries with a backup", async () => {
  for (const mode of ["full", "readonly"]) {
    const item = fixture({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "0" });
    const result = await command(item.home, ["access", mode, "--client", "cursor", "--yes"]);
    assert.equal(result.code, 0, result.text);
    const expected = structuredClone(item.config);
    delete expected.mcpServers.gsc.env.GSC_SCOPES;
    delete expected.mcpServers.gsc.env.GSC_ENABLE_WRITE;
    expected.mcpServers.gsc.env.GSC_ACCESS_MODE = mode;
    assert.deepEqual(JSON.parse(readFileSync(item.configPath, "utf8")), expected);
    assert.equal(readdirSync(dirname(item.configPath)).length, 2);
    assert.equal(result.text.includes("secret-marker"), false);
    assert.match(result.text, /restart/i);
    if (mode === "readonly") assert.match(result.text, /auth login/);
  }
});

test("shared full, malformed entries and missing files are refused without mutation", async () => {
  for (const kind of ["shared", "malformed", "missing"]) {
    const item = fixture({ GSC_AUTH_MODE: "oauth" });
    let home = item.home;
    if (kind === "malformed") writeFileSync(item.configPath, '{"mcpServers":{"gsc":{"env":42}}}');
    if (kind === "missing") home = mkdtempSync(join(tmpdir(), "gsc-access-missing-"));
    const before = readFileSync(item.configPath, "utf8");
    const result = await command(home, ["access", "full", "--client", "cursor", "--yes"]);
    assert.equal(result.code, 1);
    if (kind === "shared") assert.match(result.text, /readonly-only/);
    assert.equal(readFileSync(item.configPath, "utf8"), before);
    assert.equal(readdirSync(dirname(item.configPath)).length, 1);
  }
  const item = fixture({ GSC_AUTH_MODE: "oauth" });
  assert.equal((await command(item.home, ["access", "readonly", "--client", "cursor", "--yes"])).code, 0);
});

test("canonical access shares dry-run, decline, idempotence and atomic failure protections", async () => {
  for (const scenario of ["dry", "decline", "idempotent", "stage", "rename"]) {
    const item = fixture(scenario === "idempotent" ? { GSC_ACCESS_MODE: "full" } : { GSC_SCOPES: "full" });
    const lines = [];
    let prompts = 0;
    const ok = await applyWriteFileConfig({
      configPath: item.configPath, access: "full", enable: true,
      force: false, yes: scenario === "stage" || scenario === "rename", dryRun: scenario === "dry",
      confirm: async () => { prompts++; return "n"; }, log: (message) => lines.push(message),
      hooks: scenario === "stage" ? { stageTemp: () => { throw new Error("fixture"); } }
        : scenario === "rename" ? { commitTemp: () => { throw new Error("fixture"); } } : undefined,
    });
    assert.equal(ok, scenario === "dry" || scenario === "idempotent", scenario);
    assert.equal(prompts, scenario === "decline" ? 1 : 0, scenario);
    assert.equal(readFileSync(item.configPath, "utf8"), item.before, scenario);
    assert.equal(readdirSync(dirname(item.configPath)).length, scenario === "stage" || scenario === "rename" ? 2 : 1);
    assert.equal(lines.join("\n").includes("secret-marker"), false);
  }
});

test("legacy toggles refuse canonical entries with the exact replacement command", async () => {
  for (const [run, desired] of [[runEnableWriteCommand, "full"], [runDisableWriteCommand, "readonly"]]) {
    const item = fixture({ GSC_ACCESS_MODE: "full", GSC_ENABLE_WRITE: "1" });
    const lines = [];
    const code = await run(["--client", "cursor", "--yes"], { homeDir: item.home, log: (message) => lines.push(message) });
    assert.equal(code, 1);
    assert.match(lines.join("\n"), new RegExp(`setup access ${desired}`));
    assert.equal(readFileSync(item.configPath, "utf8"), item.before);
    assert.equal(readdirSync(dirname(item.configPath)).length, 1);
  }
});

test("legacy enable on canonical Quick Connect points to access instead of an ineffective legacy migration", async () => {
  const item = fixture({ GSC_AUTH_MODE: "oauth", GSC_ACCESS_MODE: "readonly" });
  const lines = [];
  assert.equal(await runEnableWriteCommand(["--client", "cursor", "--yes"], {
    homeDir: item.home, log: (message) => lines.push(message),
  }), 1);
  assert.match(lines.join("\n"), /setup access full/);
  assert.equal(readFileSync(item.configPath, "utf8"), item.before);
});

test("access commands validate modes without echo and keep CLI-managed targets manual", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-access-manual-"));
  for (const args of [["access"], ["access", "private-marker"], ["access", "full", "--private-marker"]]) {
    const result = await command(home, args);
    assert.equal(result.code, 1);
    assert.equal(result.text.includes("private-marker"), false);
    assert.match(result.text, /setup access/);
  }
  for (const target of ["code", "codex", "print"]) {
    const result = await command(home, ["access", "full", "--client", target, "--yes"]);
    assert.equal(result.code, 0, result.text);
    assert.match(result.text, /GSC_ACCESS_MODE.*full/);
    assert.match(result.text, /GSC_SCOPES.*GSC_ENABLE_WRITE/);
    assert.match(result.text, /Nothing was changed/);
  }
  assert.deepEqual(readdirSync(home), []);
});
