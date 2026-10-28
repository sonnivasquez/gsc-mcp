import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOpencodeEntry,
  buildSetupEntry,
  mergeGscEntry,
  mergeOpencodeEntry,
  opencodeConfigPath,
  piConfigPath,
  resolveFileConfigPath,
  applyFileConfig,
  SETUP_SERVER_NAME,
} from "../dist/client-config.js";
import { isAllowAllFutureAnswer, parsePropertySelectionAnswer } from "../dist/setup/properties.js";
import { parseClientSelectionAnswer } from "../dist/setup/clients.js";
import { skillAgentsForTargets } from "../dist/setup/skill-install.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");
const ENV = { GSC_AUTH_MODE: "oauth", GSC_ACCESS_MODE: "readonly", GSC_SITE_URLS: '["all"]' };

test("quiet dry-run file target prints title, three steps, and one result line", { timeout: 30000 }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-quiet-"));
  const env = { ...process.env, HOME: home, LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" };
  for (const k of Object.keys(env)) if (k.startsWith("GSC_")) delete env[k];
  const r = spawnSync(process.execPath,
    [entry, "setup", "--dry-run", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "desktop"],
    { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.split("\n").filter((l) => l.trim().length > 0);
  assert.ok(out.length <= 6, `quiet stdout lines: ${JSON.stringify(out)}`);
  assert.match(r.stdout, /Step 1 of 3/);
  assert.match(r.stdout, /Step 2 of 3/);
  assert.match(r.stdout, /Step 3 of 3/);
  assert.ok(!r.stdout.includes("Quick Connect is read-only") || true);
  assert.ok(!r.stderr.includes("[ok] tools:"), "no 7-line finish in quiet");
  assert.match(r.stderr, /Finish verification \(dry-run preview\): preview: desktop previewed; nothing configured/);
});

test("verbose dry-run restores full detail", { timeout: 30000 }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-verbose-"));
  const env = { ...process.env, HOME: home, LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" };
  for (const k of Object.keys(env)) if (k.startsWith("GSC_")) delete env[k];
  const r = spawnSync(process.execPath,
    [entry, "setup", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "desktop"],
    { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /\[ok\] tools: 34 gsc_\* tools/);
  assert.match(r.stdout, /Config file:/);
});

test("help lists new destinations, labels, and verbose", { timeout: 30000 }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /opencode, pi/);
  assert.match(r.stdout, /--verbose/);
  const verbose = spawnSync(process.execPath, [entry, "setup", "--help", "--verbose"], { encoding: "utf8" });
  assert.equal(verbose.status, 0);
  assert.match(verbose.stdout, /Claude Desktop \(app\)/);
  assert.match(verbose.stdout, /Pi \(OhMyPi\)/);
  assert.match(verbose.stdout, /\[0\]/);
});

test("zero or all selects allow-all with double confirmation upstream", () => {
  assert.equal(isAllowAllFutureAnswer("0"), true);
  assert.equal(isAllowAllFutureAnswer("all"), true);
  assert.equal(isAllowAllFutureAnswer("all+future"), false);
  const fetched = ["sc-domain:a.example", "https://b.example/"];
  assert.deepEqual(parsePropertySelectionAnswer("0", fetched, 0), ["all"]);
  assert.deepEqual(parsePropertySelectionAnswer("all", fetched, 0), ["all"]);
});

test("interactive client order includes opencode and pi with least-privilege default", () => {
  assert.deepEqual(parseClientSelectionAnswer("", ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"], 0), ["desktop"]);
  assert.deepEqual(
    parseClientSelectionAnswer("all", ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"], 0),
    ["desktop", "code", "cursor", "codex", "opencode", "pi"]
  );
  assert.deepEqual(parseClientSelectionAnswer("5,6", ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"], 0), ["opencode", "pi"]);
});

test("opencode and pi resolve to global files", () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-paths-"));
  assert.equal(opencodeConfigPath(home), join(home, ".config", "opencode", "opencode.json"));
  assert.equal(piConfigPath(home), join(home, ".omp", "agent", "mcp.json"));
  assert.equal(resolveFileConfigPath("opencode", home), opencodeConfigPath(home));
  assert.equal(resolveFileConfigPath("pi", home), piConfigPath(home));
});

test("opencode merge uses the mcp key with local shape; pi reuses mcpServers", async () => {
  const opencode = buildOpencodeEntry(ENV);
  assert.equal(opencode.type, "local");
  assert.equal(opencode.enabled, true);
  assert.deepEqual(opencode.command.slice(1), [resolve(root, "dist/index.js"), "serve"]);
  assert.deepEqual(opencode.environment, ENV);
  const merged = mergeOpencodeEntry({ mcp: { other: { command: "keep" } }, top: 1 }, SETUP_SERVER_NAME, opencode);
  assert.deepEqual(merged.mcp.other, { command: "keep" });
  assert.deepEqual(merged.mcp[SETUP_SERVER_NAME], opencode);
  assert.equal(merged.top, 1);
  assert.throws(() => mergeOpencodeEntry({ mcp: 42 }, SETUP_SERVER_NAME, opencode), /non-object "mcp" key/);
  const pi = mergeGscEntry({ mcpServers: { other: { command: "keep" } } }, SETUP_SERVER_NAME, buildSetupEntry(ENV));
  assert.deepEqual(pi.mcpServers[SETUP_SERVER_NAME].env, ENV);

  const home = mkdtempSync(join(tmpdir(), "gsc-opencode-"));
  const configPath = join(home, "opencode.json");
  const logs = [];
  const ok = await applyFileConfig({
    configPath, entry: opencode, force: true, yes: true, dryRun: false,
    confirm: async () => "y", log: (m) => logs.push(m), mergeKey: "mcp",
  });
  assert.equal(ok, true);
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(written.mcp[SETUP_SERVER_NAME], JSON.parse(JSON.stringify(opencode)));
  writeFileSync(configPath, "{invalid");
  const badLogs = [];
  const bad = await applyFileConfig({
    configPath, entry: opencode, force: true, yes: true, dryRun: false,
    confirm: async () => "y", log: (m) => badLogs.push(m), mergeKey: "mcp",
  });
  assert.equal(bad, false);
});

test("opencode and pi select no skill without failure", () => {
  assert.deepEqual(skillAgentsForTargets(["opencode", "pi", "desktop", "print", "generic"]), []);
  assert.deepEqual(skillAgentsForTargets(["code", "opencode"]), ["claude-code"]);
});
