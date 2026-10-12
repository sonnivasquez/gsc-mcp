// Isolated tests for `setup enable-write` / `setup disable-write`.
// No Google, no network, no tokens, no real client files: every test uses
// a temp home directory (threaded as homeDir, never os.homedir) and scrubs
// inherited GSC_* variables so the tier classification is deterministic.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  WRITE_ENV_KEY,
  SETUP_SERVER_NAME,
  detectFileTarget,
  readGscEntry,
  updateGscEnvForWrite,
  previewWriteEnvChange,
  applyWriteFileConfig,
  cursorConfigPath,
  desktopConfigPath,
} from "../dist/client-config.js";
import {
  runEnableWriteCommand,
  runDisableWriteCommand,
  classifyWriteTier,
  resolveWriteTargets,
  SHARED_WRITE_REFUSAL,
} from "../dist/setup.js";

const GSC_SECRET = "SENTINEL_GSC_SECRET_7f3a9c2d";
const OTHER_SECRET = "SENTINEL_OTHER_SECRET_1b8e4d5a";

/** Remove every inherited GSC_* var; restore them after the test. */
function scrubGscEnv() {
  const saved = new Map();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GSC_")) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GSC_")) delete process.env[key];
    }
    for (const [key, value] of saved) process.env[key] = value;
  };
}

function seedCursorConfig(home, env) {
  const configPath = cursorConfigPath(home);
  mkdirSync(dirname(configPath), { recursive: true });
  const config = {
    customTopLevel: true,
    mcpServers: {
      other: { command: "other-bin", args: ["--keep"], env: { OTHER_TOKEN: OTHER_SECRET } },
      [SETUP_SERVER_NAME]: {
        command: "npx",
        args: ["-y", "@sonnivasquez/gsc-mcp@0.1.0"],
        env,
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function collectLog() {
  const lines = [];
  return { lines, log: (message) => lines.push(message), text: () => lines.join("\n") };
}

function backupsIn(dir) {
  return readdirSync(dir, { recursive: true }).filter((name) => String(name).includes(".backup-"));
}

// --- Pure env edit ---------------------------------------------------------

test("updateGscEnvForWrite adds the flag and preserves unrelated keys", () => {
  const old = { GSC_SCOPES: "full", KEEP: "yes" };
  const { env, changed } = updateGscEnvForWrite(old, true);
  assert.equal(changed, true);
  assert.equal(env[WRITE_ENV_KEY], "1");
  assert.equal(env.KEEP, "yes");
  assert.ok(!(WRITE_ENV_KEY in old), "input is never mutated");
});

test("updateGscEnvForWrite is idempotent when already correct", () => {
  assert.equal(updateGscEnvForWrite({ [WRITE_ENV_KEY]: "1", A: "b" }, true).changed, false);
  assert.equal(updateGscEnvForWrite({ A: "b" }, false).changed, false);
});

test("updateGscEnvForWrite removes only the flag on disable", () => {
  const { env, changed } = updateGscEnvForWrite({ [WRITE_ENV_KEY]: "1", KEEP: "yes" }, false);
  assert.equal(changed, true);
  assert.ok(!(WRITE_ENV_KEY in env));
  assert.equal(env.KEEP, "yes");
});

test("updateGscEnvForWrite fails closed on a non-object env", () => {
  assert.throws(() => updateGscEnvForWrite("GSC_ENABLE_WRITE=1", true), /non-object env/);
});

test("previewWriteEnvChange redacts both sides and names only the flag", () => {
  const oldEntry = { command: "npx", env: { TOKEN: GSC_SECRET } };
  const { env } = updateGscEnvForWrite(oldEntry.env, true);
  const preview = previewWriteEnvChange(oldEntry, { ...oldEntry, env }, true);
  assert.ok(!preview.includes(GSC_SECRET), "existing values never leak into the preview");
  assert.ok(preview.includes("[redacted]"));
  assert.ok(preview.includes(`+ ${WRITE_ENV_KEY}=1`));
  const removal = previewWriteEnvChange({ env: { [WRITE_ENV_KEY]: "1" } }, { env: {} }, false);
  assert.ok(removal.includes(`- ${WRITE_ENV_KEY} (removed)`));
});

// --- Config reads and target detection -------------------------------------

test("readGscEntry fails closed on missing files and unknown entries", () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-enable-read-"));
  assert.throws(() => readGscEntry(join(home, "missing.json")), /Run setup first/);
  const bad = join(home, "bad.json");
  writeFileSync(bad, "{not json");
  assert.throws(() => readGscEntry(bad), /invalid JSON/);
  const noGsc = join(home, "nogsc.json");
  writeFileSync(noGsc, JSON.stringify({ mcpServers: { other: {} } }));
  assert.throws(() => readGscEntry(noGsc), /No gsc entry/);
});

test("detectFileTarget prefers desktop, falls back to cursor, else null", () => {
  const empty = mkdtempSync(join(tmpdir(), "gsc-enable-detect-empty-"));
  assert.equal(detectFileTarget(empty), null);
  const cursorOnly = mkdtempSync(join(tmpdir(), "gsc-enable-detect-cursor-"));
  mkdirSync(join(cursorOnly, ".cursor"), { recursive: true });
  writeFileSync(cursorConfigPath(cursorOnly), "{}");
  assert.equal(detectFileTarget(cursorOnly), "cursor");
  const both = mkdtempSync(join(tmpdir(), "gsc-enable-detect-both-"));
  mkdirSync(join(both, ".cursor"), { recursive: true });
  writeFileSync(cursorConfigPath(both), "{}");
  const desktopPath = desktopConfigPath(both);
  mkdirSync(dirname(desktopPath), { recursive: true });
  writeFileSync(desktopPath, "{}");
  assert.equal(detectFileTarget(both), "desktop");
});

test("resolveWriteTargets reuses setup client parsing and detects a default", () => {
  const restore = scrubGscEnv();
  try {
    assert.deepEqual(resolveWriteTargets(["cursor", "desktop"]), ["cursor", "desktop"]);
    assert.deepEqual(resolveWriteTargets(["both"]), ["desktop", "code"]);
    assert.throws(() => resolveWriteTargets(["print", "cursor"]), /alone/);
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-resolve-"));
    assert.throws(() => resolveWriteTargets([], { homeDir: home }), /No desktop, cursor, opencode, or pi MCP config found/);
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(cursorConfigPath(home), "{}");
    assert.deepEqual(resolveWriteTargets([], { homeDir: home }), ["cursor"]);
  } finally {
    restore();
  }
});

test("classifyWriteTier refuses only bare oauth (Quick Connect)", () => {
  const restore = scrubGscEnv();
  try {
    assert.equal(classifyWriteTier({}), "service-account");
    assert.equal(classifyWriteTier({ GSC_AUTH_MODE: "service_account" }), "service-account");
    assert.equal(classifyWriteTier({ GSC_AUTH_MODE: "oauth" }), "shared");
    assert.equal(classifyWriteTier({ GSC_AUTH_MODE: "oauth", GSC_OAUTH_SECRETS_FILE: "/tmp/c.json" }), "custom");
    assert.equal(
      classifyWriteTier({ GSC_AUTH_MODE: "oauth", GSC_OAUTH_CLIENT_ID: "id", GSC_OAUTH_CLIENT_SECRET: "s" }),
      "custom"
    );
    // Process env is the fallback for keys the installed entry omits.
    process.env.GSC_AUTH_MODE = "oauth";
    process.env.GSC_OAUTH_SECRETS_FILE = "/tmp/c.json";
    assert.equal(classifyWriteTier({}), "custom");
    delete process.env.GSC_OAUTH_SECRETS_FILE;
    assert.equal(classifyWriteTier({}), "shared");
  } finally {
    restore();
  }
});

// --- File application -------------------------------------------------------

test("enable adds the flag, preserves unrelated settings, backs up, hides secrets", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-add-"));
    const configPath = seedCursorConfig(home, {
      GSC_AUTH_MODE: "service_account",
      GSC_SCOPES: "full",
      EXISTING_SECRET: GSC_SECRET,
    });
    const sink = collectLog();
    const ok = await applyWriteFileConfig({
      configPath,
      enable: true,
      force: false,
      yes: true,
      dryRun: false,
      confirm: async () => {
        throw new Error("must not confirm on --yes");
      },
      log: sink.log,
    });
    assert.equal(ok, true);
    const next = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(next.customTopLevel, true);
    assert.deepEqual(next.mcpServers.other, {
      command: "other-bin",
      args: ["--keep"],
      env: { OTHER_TOKEN: OTHER_SECRET },
    });
    assert.equal(next.mcpServers[SETUP_SERVER_NAME].command, "npx");
    assert.equal(next.mcpServers[SETUP_SERVER_NAME].env[WRITE_ENV_KEY], "1");
    assert.equal(next.mcpServers[SETUP_SERVER_NAME].env.EXISTING_SECRET, GSC_SECRET);
    assert.equal(backupsIn(home).length, 1);
    assert.ok(!sink.text().includes(GSC_SECRET), "carried-over values stay out of logs");
    assert.ok(!sink.text().includes(OTHER_SECRET), "unrelated server values stay out of logs");
  } finally {
    restore();
  }
});

test("disable removes only the flag and keeps everything else", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-remove-"));
    const configPath = seedCursorConfig(home, {
      GSC_AUTH_MODE: "service_account",
      GSC_SCOPES: "full",
      [WRITE_ENV_KEY]: "1",
    });
    const sink = collectLog();
    const ok = await applyWriteFileConfig({
      configPath,
      enable: false,
      force: false,
      yes: true,
      dryRun: false,
      confirm: async () => {
        throw new Error("must not confirm on --yes");
      },
      log: sink.log,
    });
    assert.equal(ok, true);
    const next = JSON.parse(readFileSync(configPath, "utf8"));
    assert.ok(!(WRITE_ENV_KEY in next.mcpServers[SETUP_SERVER_NAME].env));
    assert.equal(next.mcpServers[SETUP_SERVER_NAME].env.GSC_SCOPES, "full");
    assert.deepEqual(next.mcpServers.other.env, { OTHER_TOKEN: OTHER_SECRET });
  } finally {
    restore();
  }
});

test("dry-run previews without writing or backing up", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-dry-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "service_account" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const ok = await applyWriteFileConfig({
      configPath,
      enable: true,
      force: false,
      yes: false,
      dryRun: true,
      confirm: async () => {
        throw new Error("must not confirm on dry-run");
      },
      log: sink.log,
    });
    assert.equal(ok, true);
    assert.equal(readFileSync(configPath, "utf8"), before);
    assert.equal(backupsIn(home).length, 0);
    assert.match(sink.text(), /No file written/);
  } finally {
    restore();
  }
});

test("already-correct state succeeds without prompting, writing, or backup", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-idem-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "service_account", [WRITE_ENV_KEY]: "1" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const ok = await applyWriteFileConfig({
      configPath,
      enable: true,
      force: false,
      yes: false,
      dryRun: false,
      confirm: async () => {
        throw new Error("must not prompt when already enabled");
      },
      log: sink.log,
    });
    assert.equal(ok, true);
    assert.equal(readFileSync(configPath, "utf8"), before);
    assert.equal(backupsIn(home).length, 0);
    assert.match(sink.text(), /already set/);
  } finally {
    restore();
  }
});

test("declined confirmation writes nothing and reports failure", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-decline-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "service_account" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const ok = await applyWriteFileConfig({
      configPath,
      enable: true,
      force: false,
      yes: false,
      dryRun: false,
      confirm: async () => "n",
      log: sink.log,
    });
    assert.equal(ok, false);
    assert.equal(readFileSync(configPath, "utf8"), before);
    assert.equal(backupsIn(home).length, 0);
  } finally {
    restore();
  }
});

// --- Command level ----------------------------------------------------------

test("runEnableWriteCommand enables the flag and prints warning plus verify steps", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-cmd-"));
    const configPath = seedCursorConfig(home, {
      GSC_AUTH_MODE: "service_account",
      GSC_SCOPES: "full",
      EXISTING_SECRET: GSC_SECRET,
    });
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "cursor", "--yes"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).mcpServers[SETUP_SERVER_NAME].env[WRITE_ENV_KEY], "1");
    assert.match(sink.text(), /REAL Google submissions/);
    assert.match(sink.text(), /allowlist/);
    assert.match(sink.text(), /gsc doctor/);
    assert.ok(!sink.text().includes(GSC_SECRET));
    assert.ok(!sink.text().includes(OTHER_SECRET));
  } finally {
    restore();
  }
});

test("runEnableWriteCommand notes when full scopes are still missing", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-scopes-"));
    seedCursorConfig(home, { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "readonly" });
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "cursor", "--yes"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.match(sink.text(), /GSC_SCOPES=full/);
  } finally {
    restore();
  }
});

test("runEnableWriteCommand refuses Quick Connect installs without touching files", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-shared-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "cursor", "--yes"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 1);
    assert.equal(readFileSync(configPath, "utf8"), before);
    assert.equal(backupsIn(home).length, 0);
    assert.ok(sink.text().includes(SHARED_WRITE_REFUSAL.split(".")[0]));
    assert.match(sink.text(), /Nothing was changed/);
  } finally {
    restore();
  }
});

test("runEnableWriteCommand dry-run changes nothing on disk", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-cmddry-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "full" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "cursor", "--dry-run"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.equal(readFileSync(configPath, "utf8"), before);
    assert.equal(backupsIn(home).length, 0);
  } finally {
    restore();
  }
});

test("runDisableWriteCommand removes the flag after confirmation", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-disable-cmd-"));
    const configPath = seedCursorConfig(home, {
      GSC_AUTH_MODE: "service_account",
      [WRITE_ENV_KEY]: "1",
    });
    const sink = collectLog();
    let question = "";
    const code = await runDisableWriteCommand(["--client", "cursor"], {
      homeDir: home,
      confirm: async (asked) => {
        question = asked;
        return "y";
      },
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.match(question, /Remove/);
    assert.ok(!(WRITE_ENV_KEY in JSON.parse(readFileSync(configPath, "utf8")).mcpServers[SETUP_SERVER_NAME].env));
    assert.match(sink.text(), /gsc doctor/);
    assert.ok(!sink.text().includes(OTHER_SECRET));
  } finally {
    restore();
  }
});

test("runDisableWriteCommand needs no tier check and honors declines", async () => {
  const restore = scrubGscEnv();
  try {
    // Even a shared install can always turn writes off.
    const home = mkdtempSync(join(tmpdir(), "gsc-disable-shared-"));
    const configPath = seedCursorConfig(home, { GSC_AUTH_MODE: "oauth", [WRITE_ENV_KEY]: "1" });
    const before = readFileSync(configPath, "utf8");
    const sink = collectLog();
    const code = await runDisableWriteCommand(["--client", "cursor"], {
      homeDir: home,
      confirm: async () => "n",
      log: sink.log,
    });
    assert.equal(code, 1);
    assert.equal(readFileSync(configPath, "utf8"), before);
  } finally {
    restore();
  }
});

test("CLI-managed targets print guidance without invoking or writing", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-cli-"));
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "code", "--yes"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.match(sink.text(), /CLI-managed/);
    assert.match(sink.text(), /Nothing was changed/);
    assert.equal(readdirSync(home).length, 0, "no config files are created");
  } finally {
    restore();
  }
});

test("print target shows a merge fragment without touching disk", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-print-"));
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--client", "print"], {
      homeDir: home,
      log: sink.log,
    });
    assert.equal(code, 0);
    assert.ok(sink.text().includes(`\"${WRITE_ENV_KEY}\": \"1\"`));
  } finally {
    restore();
  }
});

test("default target detection uses the temp home, never real configs", async () => {
  const restore = scrubGscEnv();
  try {
    const home = mkdtempSync(join(tmpdir(), "gsc-enable-default-"));
    seedCursorConfig(home, { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "full" });
    const sink = collectLog();
    const code = await runEnableWriteCommand(["--yes"], { homeDir: home, log: sink.log });
    assert.equal(code, 0);
    assert.equal(
      JSON.parse(readFileSync(cursorConfigPath(home), "utf8")).mcpServers[SETUP_SERVER_NAME].env[WRITE_ENV_KEY],
      "1"
    );
  } finally {
    restore();
  }
});
