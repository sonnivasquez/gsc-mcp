import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAuth } from "../dist/setup/auth.js";
import { buildEnv, runSetup } from "../dist/setup.js";
import { getScopeTier } from "../dist/oauth.js";
import { assertWriteEnabled } from "../dist/auth.js";

function preview(args = []) {
  const home = mkdtempSync(join(tmpdir(), "gsc-access-preview-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GSC_")));
  const result = spawnSync(process.execPath, ["dist/index.js", "setup", "--dry-run", "--verbose", "--yes", "--client", "print", ...args], {
    encoding: "utf8",
    env: {
      ...env,
      LC_ALL: "C",
      LC_MESSAGES: "C",
      LANG: "C",
      // Bun's transpiler cache is runtime state, not a setup dry-run side effect.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      HOME: home,
      GSC_DATA_DIR: join(home, "state"),
    },
  });
  assert.notEqual(result.status, null, JSON.stringify({
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
  }));
  assert.deepEqual(readdirSync(home), [], "dry-run must not create local state");
  return result;
}

function emitted(result) {
  assert.equal(result.status, 0, result.stderr);
  const start = result.stdout.indexOf('{\n  "mcpServers"');
  assert.notEqual(start, -1, result.stdout);
  return JSON.parse(result.stdout.slice(start)).mcpServers.gsc.env;
}

test("new setup defaults and explicit readonly emit only canonical access", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  for (const flags of [[], ["--access", "readonly"]]) {
    const env = emitted(preview(flags));
    assert.equal(env.GSC_ACCESS_MODE, "readonly");
    assert.equal(Object.hasOwn(env, "GSC_SCOPES"), false);
    assert.equal(Object.hasOwn(env, "GSC_ENABLE_WRITE"), false);
  }
});

test("canonical full setup enables writes without a separate prompt", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
  const prompt = {
    choose: async () => 1,
    text: async () => { throw new Error("unexpected separate write prompt"); },
    close() {},
  };
  for (const mode of ["custom", "service-account"]) {
    const decision = await decideAuth(prompt, mode, null, false, "full");
    assert.deepEqual(decision, { mode, scope: "full", write: true });
    const interactive = await decideAuth(prompt, mode, null, false, null);
    assert.deepEqual(interactive, decision);
  }
  const result = preview(["--auth", "custom", "--access", "full"]);
  const env = emitted(result);
  assert.equal(env.GSC_ACCESS_MODE, "full");
  assert.equal(Object.hasOwn(env, "GSC_SCOPES"), false);
  assert.equal(Object.hasOwn(env, "GSC_ENABLE_WRITE"), false);
  assert.match(result.stderr, /ENABLED.*GSC_ACCESS_MODE=full/);
});

test("canonical readonly wins conflicting legacy setup flags even for Quick Connect", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const env = emitted(preview(["--auth", "shared", "--access", "readonly", "--scopes", "full", "--enable-write"]));
  assert.equal(env.GSC_ACCESS_MODE, "readonly");
  assert.equal(Object.hasOwn(env, "GSC_ENABLE_WRITE"), false);
});

test("environment emitter enforces shared access on canonical rather than conflicting legacy inputs", () => {
  const base = { mode: "shared", scopes: "readonly", write: false, site: "sc-domain:example.test", secretsPath: null, keyFile: null };
  assert.throws(() => buildEnv({ ...base, access: "full" }), /readonly-only/);
  const env = buildEnv({ ...base, access: "readonly", scopes: "full", write: true });
  assert.equal(env.GSC_ACCESS_MODE, "readonly");
  assert.equal(Object.hasOwn(env, "GSC_ENABLE_WRITE"), false);
});

test("shared full fails before authentication", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const shared = preview(["--auth", "shared", "--access", "full"]);
  assert.equal(shared.status, 1);
  assert.match(shared.stderr, /readonly-only/);
  assert.equal(shared.stdout.includes('"mcpServers"'), false);
});

// Each CLI start gets an explicit subprocess test budget on slower CI hosts.
for (const [name, args] of [
  ["missing", ["--access"]],
  ["invalid", ["--access", "invalid-private-marker"]],
  ["uppercase", ["--access", "FULL"]],
]) {
  test(`${name} access fails before authentication without reflecting rejected values`, { timeout: CLI_TEST_TIMEOUT_MS }, () => {
    const result = preview(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --access value/);
    assert.equal((result.stdout + result.stderr).includes("private-marker"), false);
  });
}

test("deprecated full setup keeps legacy full-token/write-off semantics", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  for (const flags of [[], ["--enable-write"]]) {
    const env = emitted(preview(["--auth", "custom", "--scopes", "full", ...flags]));
    assert.equal(Object.hasOwn(env, "GSC_ACCESS_MODE"), false);
    assert.equal(env.GSC_SCOPES, "full");
    assert.equal(env.GSC_ENABLE_WRITE, flags.length ? "1" : undefined);
  }
});

test("setup authentication honors its selected access instead of ambient canonical or legacy settings", async () => {
  const saved = { ...process.env };
  const originalLog = console.log;
  const originalError = console.error;
  const dir = mkdtempSync(join(tmpdir(), "gsc-access-auth-"));
  const key = join(dir, "fixture.json");
  writeFileSync(key, JSON.stringify({ type: "service_account", client_email: "fixture@example.test", private_key: "-----BEGIN PRIVATE KEY----- fixture" }));
  console.log = () => {};
  console.error = () => {};
  try {
    for (const [flags, ambient, scope, writes] of [
      [["--access", "readonly"], "full", "readonly", false],
      [["--access", "full"], "readonly", "full", true],
      [["--scopes", "full"], "readonly", "full", false],
    ]) {
      process.env.GSC_ACCESS_MODE = ambient;
      process.env.GSC_SCOPES = "full";
      process.env.GSC_ENABLE_WRITE = "1";
      let calls = 0;
      const code = await runSetup(["--auth", "service-account", "--key-file", key, "--client", "print", "--site", "sc-domain:example.test", "--yes", ...flags], {
        listSitesRaw: async () => {
          calls++;
          assert.equal(getScopeTier(), scope);
          if (writes) assert.doesNotThrow(() => assertWriteEnabled("fixture"));
          else assert.throws(() => assertWriteEnabled("fixture"));
          return { siteEntry: [{ siteUrl: "sc-domain:example.test", permissionLevel: "siteOwner" }] };
        },
      });
      assert.equal(code, 0);
      assert.equal(calls, 1);
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
