import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_TEST_TIMEOUT_MS, homeEnvironment, observeChild, stopChild } from "./helpers/subprocess.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  return { ...env, ...extra };
};

test("homeEnvironment isolates subprocess home and Windows application data paths", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-env-"));
  const overrides = homeEnvironment(home);
  assert.deepEqual(overrides, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
  });
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { homedir } from "node:os";
    console.log(JSON.stringify({
      home: homedir(),
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
    }));
  `], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: join(home, "wrong-home"),
      USERPROFILE: join(home, "wrong-profile"),
      APPDATA: join(home, "wrong-roaming"),
      LOCALAPPDATA: join(home, "wrong-local"),
      ...overrides,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { home, ...overrides });
});

test("cli --version prints the version", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "1.0.0");
});

test("cli --help documents serve, setup and doctor", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /serve/);
  assert.match(r.stdout, /setup/);
  assert.match(r.stdout, /setup enable-write/);
  assert.match(r.stdout, /setup disable-write/);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /GSC_SITE_URLS\s+JSON array of exact property IDs, or "all" alone/);
});

test("setup enable-write --help documents warning, refusal, and flags", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "enable-write", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GSC_ENABLE_WRITE/);
  assert.match(r.stdout, /Quick Connect/);
  assert.match(r.stdout, /--dry-run/);
});

test("setup enable-write --dry-run previews an isolated cursor config without writing", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-enable-cli-"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const configPath = join(home, ".cursor", "mcp.json");
  const before = JSON.stringify({
    mcpServers: {
      other: { command: "keep" },
      gsc: { command: "npx", args: ["-y", "x"], env: { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "full" } },
    },
  });
  writeFileSync(configPath, before);
  const r = spawnSync(process.execPath, [entry, "setup", "enable-write", "--client", "cursor", "--dry-run"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home) }),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GSC_ENABLE_WRITE/);
  assert.equal(readFileSync(configPath, "utf8"), before);
});

test("setup enable-write --yes edits only the isolated cursor config", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-enable-cli-yes-"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const configPath = join(home, ".cursor", "mcp.json");
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      other: { command: "keep" },
      gsc: { command: "npx", args: ["-y", "x"], env: { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "full" } },
    },
  }));
  const r = spawnSync(process.execPath, [entry, "setup", "enable-write", "--client", "cursor", "--yes"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home) }),
  });
  assert.equal(r.status, 0);
  const next = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(next.mcpServers.gsc.env.GSC_ENABLE_WRITE, "1");
  assert.deepEqual(next.mcpServers.other, { command: "keep" });
  assert.match(r.stdout, /gsc doctor/);
});

test("setup enable-write refuses Quick Connect installs in isolation", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-enable-cli-shared-"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const configPath = join(home, ".cursor", "mcp.json");
  const before = JSON.stringify({
    mcpServers: { gsc: { command: "npx", args: [], env: { GSC_AUTH_MODE: "oauth" } } },
  });
  writeFileSync(configPath, before);
  const r = spawnSync(process.execPath, [entry, "setup", "enable-write", "--client", "cursor", "--yes"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home) }),
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Quick Connect is readonly-only/);
  assert.equal(readFileSync(configPath, "utf8"), before);
});

test("setup disable-write --yes removes the flag in isolation", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-disable-cli-"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const configPath = join(home, ".cursor", "mcp.json");
  writeFileSync(configPath, JSON.stringify({
    mcpServers: { gsc: { command: "npx", args: [], env: { GSC_AUTH_MODE: "service_account", GSC_ENABLE_WRITE: "1" } } },
  }));
  const r = spawnSync(process.execPath, [entry, "setup", "disable-write", "--client", "cursor", "--yes"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home) }),
  });
  assert.equal(r.status, 0);
  const next = JSON.parse(readFileSync(configPath, "utf8"));
  assert.ok(!("GSC_ENABLE_WRITE" in next.mcpServers.gsc.env));
});

test("cli rejects unknown commands with exit 2", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "frobnicate"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("cli --help documents update", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /gsc update \[--check\]/);
});

test("cli update --help shows usage with exit 0", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "update", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: gsc update \[--check\]/);
});

test("cli update rejects unknown flags without echoing them", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-UPDATEFLAG-3c9d";
  const r = spawnSync(process.execPath, [entry, "update", `--${sentinel}`], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /update: unknown flag/);
  assert.ok(!r.stderr.includes(sentinel));
  assert.ok(!r.stdout.includes(sentinel));
});

test("doctor is offline JSON and never prints secret material", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-doctor-"));
  mkdirSync(join(home, ".gsc-mcp"), { recursive: true });
  writeFileSync(join(home, ".gsc-mcp", "oauth-token.json"), JSON.stringify({ refresh_token: "secret-value-marker" }));

  const r = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home), GSC_AUTH_MODE: "oauth" }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.some((c) => c.id === "oauth_token" && c.ok));
  assert.ok(!r.stdout.includes("secret-value-marker"));
});

test("doctor reports a JSON allowlist with commas exactly", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: cleanEnv({ GSC_SITE_URLS: JSON.stringify(["sc-domain:Example.COM", "https://shop.example/sale,2026/"]) }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  const siteUrls = report.checks.find((c) => c.id === "site_urls");
  const allowlist = report.checks.find((c) => c.id === "allowlist");
  assert.equal(siteUrls.ok, true);
  assert.match(siteUrls.detail, /2 configured/);
  assert.equal(allowlist.ok, true);
  assert.match(allowlist.detail, /2 properties enforced/);
});

test("doctor reports legacy comma-separated values", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: cleanEnv({ GSC_SITE_URLS: "sc-domain:a.example, https://b.example/ " }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.match(report.checks.find((c) => c.id === "site_urls").detail, /2 configured/);
});

test("doctor reports malformed JSON as a failing diagnostic without throwing", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: cleanEnv({ GSC_SITE_URLS: '["sc-domain:a.example", 42]' }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout); // still pure JSON: no crash, no stack
  for (const id of ["site_urls", "allowlist"]) {
    const check = report.checks.find((c) => c.id === id);
    assert.equal(check.ok, false);
    assert.match(check.detail, /invalid GSC_SITE_URLS/);
  }
});

test("doctor reports garbage and invalid entries as failing diagnostics without throwing", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  for (const bad of ['bogus', '"sc-domain:a.example"', '42', '["bogus"]', 'sc-domain:a.example,']) {
    const r = spawnSync(process.execPath, [entry, "doctor"], {
      encoding: "utf8",
      env: cleanEnv({ GSC_SITE_URLS: bad }),
    });
    assert.equal(r.status, 0, `value ${bad}`);
    const report = JSON.parse(r.stdout); // still pure JSON: no crash, no stack
    for (const id of ["site_urls", "allowlist"]) {
      const check = report.checks.find((c) => c.id === id);
      assert.equal(check.ok, false, `value ${bad} check ${id}`);
      assert.match(check.detail, /invalid GSC_SITE_URLS/, `value ${bad} check ${id}`);
    }
  }
});

test("doctor reports a JSON object as a failing diagnostic without throwing", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor"], {
    encoding: "utf8",
    env: cleanEnv({ GSC_SITE_URLS: '{"allowedSites":[]}' }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout); // still pure JSON: no crash, no stack
  for (const id of ["site_urls", "allowlist"]) {
    const check = report.checks.find((c) => c.id === id);
    assert.equal(check.ok, false);
    assert.match(check.detail, /invalid GSC_SITE_URLS/);
  }
});

test("serve completes handshake without credentials and keeps stdout pure JSON-RPC", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-handshake-"));
  const child = spawn(process.execPath, [entry], {
    env: cleanEnv({ ...homeEnvironment(home), GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: join(home, "state") }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const observed = observeChild(child);
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    // Leave room for the 15s response deadline and bounded 5s cleanup.
    // Wait for complete lines, not a partial id substring.
    await new Promise((resolvePromise, rejectPromise) => {
      let timer;
      let settled = false;
      const finish = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.removeListener("data", onData);
        child.removeListener("error", onError);
        child.stdin.removeListener("error", onError);
        child.removeListener("close", onClose);
        err ? rejectPromise(err) : resolvePromise();
      };
      const onError = err => finish(err);
      const onClose = (code, signal) => finish(new Error(`serve closed before handshake: ${code}/${signal}: ${stderr}`));
      const onData = chunk => {
        stdout += chunk;
        try {
          const lines = stdout.slice(0, stdout.lastIndexOf("\n") + 1).split("\n").filter(Boolean);
          if (lines.some(line => JSON.parse(line).id === 2)) finish();
        } catch (err) { finish(err); }
      };
      child.stdout.on("data", onData);
      child.on("error", onError);
      child.stdin.on("error", onError);
      child.on("close", onClose);
      timer = setTimeout(() => finish(new Error("serve handshake timed out: " + stderr)), 15_000);
      try {
        for (const msg of [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa", version: "0" } } },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        ]) child.stdin.write(JSON.stringify(msg) + "\n");
      } catch (err) { finish(err); }
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 2);
    let tools = null;
    for (const line of lines) {
      const msg = JSON.parse(line); // throws on any non-JSON banner: stdout stays pure
      assert.equal(msg.jsonrpc, "2.0");
      if (msg.id === 2) tools = msg.result.tools;
    }
    assert.equal(tools.length, 29);
  } finally {
    try { await stopChild(observed); }
    finally { if (observed.closed) rmSync(home, { recursive: true, force: true }); }
  }
});
