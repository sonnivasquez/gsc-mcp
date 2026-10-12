import { observeChild, stopChild } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
// Let the 30s child/response deadline and 5s cleanup finish before the runner
// interrupts the test. This is not evidence that Windows startup is fixed.
const STARTUP_TEST_TIMEOUT_MS = 40_000;
const RESPONSE_TIMEOUT_MS = 30_000;

function staticEdges(text) {
  const source = ts.createSourceFile("module.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edges = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      assert.equal(node.arguments.length, 1, "unexpected require arguments");
      assert.ok(ts.isStringLiteral(node.arguments[0]), "nonliteral require cannot be audited");
      edges.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edges;
}

function closure(entry) {
  const seen = new Set();
  const external = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    assert.ok(existsSync(file), `unresolved relative dependency: ${file}`);
    seen.add(file);
    for (const edge of staticEdges(readFileSync(file, "utf8"))) {
      if (edge.startsWith(".")) visit(resolve(dirname(file), edge));
      else external.add(edge);
    }
  }
  visit(join(dist, entry));
  return [...[...seen].map(file => relative(dist, file).replaceAll("\\", "/")), ...external];
}

test("static edge parser covers ESM declarations and CommonJS require/re-exports, excluding dynamic imports", () => {
  assert.deepEqual(staticEdges('import x from "./a.js"; export { x } from "./b.js"; export * from "./c.js"; const d = require("./d.js"); __exportStar(require("./e.js"), exports); import("./lazy.js");'), ["./a.js", "./b.js", "./c.js", "./d.js", "./e.js"]);
  assert.throws(() => staticEdges("require(variable)"), /nonliteral/);
});

// Node16 currently emits CommonJS; audit that real output, not an ESM-only approximation.
test("compiled local CLI static closures exclude server and Google implementations", () => {
  for (const entry of ["index.js", "cli.js", "doctor.js", "setup.js", "update.js"]) {
    const edges = closure(entry);
    const forbidden = edges.filter(edge => edge === "googleapis" || edge === "gsc/tools.js" || edge.startsWith("tools/") || edge === "server.js" || edge === "zod" || edge.startsWith("@modelcontextprotocol/sdk"));
    assert.deepEqual(forbidden, [], `${entry} eagerly loads ${forbidden.join(", ")}`);
  }
});

function isolated(fn) {
  const base = join(root, ".atl", "cli-startup");
  mkdirSync(base, { recursive: true });
  const home = mkdtempSync(join(base, "test-home-"));
  const cache = mkdtempSync(join(tmpdir(), "gsc-startup-cache-"));
  const env = {
    PATH: process.env.PATH,
    HOME: home, USERPROFILE: home, APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
    GSC_DATA_DIR: join(home, "data"), GSC_AUTH_MODE: "oauth", LANG: "en_US.UTF-8",
  };
  const children = [];
  const trackChild = child => {
    const observed = observeChild(child);
    children.push(observed);
    return observed;
  };
  const run = args => {
    const result = spawnSync(process.execPath, [join(dist, "index.js"), ...args], { env, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  return Promise.resolve().then(() => fn({ home, env, run, trackChild })).finally(() => {
    // Unknown termination is a failure, never permission to delete a live child's files.
    assert.ok(children.every(child => child.closed), "Child termination unconfirmed; HOME/cache retained");
    rmSync(home, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });
}

function snapshot(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
    const file = join(dir, item.name);
    return item.isDirectory() ? [[file, "directory"], ...snapshot(file)] : [[file, readFileSync(file).toString("base64")]];
  });
}

test("real entrypoint local routes preserve output, exit codes and a scrubbed HOME", { timeout: STARTUP_TEST_TIMEOUT_MS }, async () => {
  const { HELP_TEXT } = await import("../dist/cli.js");
  const { CLI_VERSION } = await import("../dist/version.js");
  const { DOCTOR_USAGE } = await import("../dist/doctor.js");
  const { UPDATE_USAGE } = await import("../dist/update.js");
  const { getSetupUsage } = await import("../dist/setup/i18n.js");
  const { printClientConfig } = await import("../dist/client-config.js");
  await isolated(({ home, run }) => {
    const before = snapshot(home);
    for (const [args, output] of [[["--help"], HELP_TEXT], [["--version"], CLI_VERSION], [["doctor", "--help"], DOCTOR_USAGE], [["update", "--help"], UPDATE_USAGE], [["setup", "--help"], getSetupUsage("en")]]) {
      const result = run(args);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, output + "\n");
      assert.equal(result.stderr, "");
    }
    const config = run(["config", "print", "--client", "desktop"]);
    assert.equal(config.status, 0);
    assert.equal(config.stderr, "");
    assert.equal(config.stdout, printClientConfig("desktop", { command: process.execPath, entrypoint: join(dist, "index.js") }) + "\n");
    for (const args of [["doctor"], ["doctor", "--online"]]) {
      const result = run(args);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(report), ["ok", "failed", "checks"]);
      assert.equal(report.checks.find(check => check.id === "auth_mode").detail, "oauth");
      assert.match(report.checks.find(check => check.id === "oauth_token").detail, /no cached token/);
      if (args.includes("--online")) {
        assert.equal(report.checks.find(check => check.id === "api").detail, "No Google session cached (AUTH_REQUIRED). Run `gsc auth login`.");
      }
    }
    const dry = run(["setup", "--auth", "shared", "--client", "print", "--site", "sc-domain:example.com", "--dry-run", "--yes", "--language", "en"]);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /sc-domain:example.com/);
    assert.match(dry.stderr, /preview|dry.run/i);
    const bad = run(["doctor", "--private-marker"]);
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.equal(bad.stderr, "doctor: unknown flag. See: gsc doctor --help.\n");
    // `doctor --online` may refresh its best-effort 1-hour registry version
    // cache under GSC_DATA_DIR when the network answers; that single state
    // file is the only write this scrubbed HOME tolerates.
    const allowedCache = new Set([join(home, "data"), join(home, "data", "registry-version-cache.json")]);
    assert.deepEqual(snapshot(home).filter(([file]) => !allowedCache.has(file)), before);
  });
});

test("setup access and legacy toggle dry-runs leave existing config byte-identical", { timeout: STARTUP_TEST_TIMEOUT_MS }, async () => {
  await isolated(({ home, run }) => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "keep" }, gsc: { command: "node", args: [], env: { GSC_AUTH_MODE: "service_account", GSC_SCOPES: "full" } } } }));
    const before = snapshot(home);
    for (const args of [["access", "readonly"], ["enable-write"], ["disable-write"]]) {
      const result = run(["setup", ...args, "--client", "cursor", "--dry-run", "--yes"]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(snapshot(home), before);
    }
  });
});

test("catalog re-export preserves public object identity and capabilities content", async () => {
  const catalog = await import("../dist/gsc/catalog.js");
  const tools = await import("../dist/gsc/tools.js");
  assert.equal(tools.CANONICAL_TOOLS, catalog.CANONICAL_TOOLS);
  assert.equal(tools.gscCapabilities().data.tools, catalog.CANONICAL_TOOLS);
  assert.equal(new Set(catalog.CANONICAL_TOOLS.map(tool => tool.name)).size, catalog.CANONICAL_TOOLS.length);
});

test("missing credentials and valid cached provider tokens remain Google-free", { timeout: STARTUP_TEST_TIMEOUT_MS }, async () => {
  await isolated(({ home, env }) => {
    const script = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const Module = require('node:module');
      const originalLoad = Module._load;
      Module._load = function(id, ...args) {
        if (id === 'googleapis') throw new Error('Google must not load on a local provider path');
        return originalLoad.call(this, id, ...args);
      };
      const { OAuthTokenProvider, ServiceAccountProvider } = require('./dist/auth-provider.js');
      (async () => {
        await assert.rejects(new OAuthTokenProvider().getAccessToken(), /AUTH_REQUIRED/);
        await assert.rejects(new ServiceAccountProvider().getAccessToken(), /AUTH_REQUIRED/);
        process.env.GSC_OAUTH_CLIENT_ID = 'test-client';
        process.env.GSC_OAUTH_CLIENT_SECRET = 'test-secret';
        fs.mkdirSync(process.env.GSC_DATA_DIR);
        fs.writeFileSync(process.env.GSC_DATA_DIR + '/oauth-token.json', JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expiry_date: Date.now() + 3600000, gsc_client_id: 'test-client', scope: 'https://www.googleapis.com/auth/webmasters.readonly' }));
        assert.equal(await new OAuthTokenProvider().getAccessToken(), 'test-access');
        assert.ok(!Object.keys(require.cache).some(file => /[\\\\/]node_modules[\\\\/]googleapis[\\\\/]/.test(file)), 'Google loaded on local guards/cache path');
      })().catch(err => { console.error(err); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ["-e", script], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
});

function waitForMcp(child, messages, stderr, timers = { set: setTimeout, clear: clearTimeout }) {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let settled = false;
    let timer;
    const started = performance.now();
    const received = [];
    const diagnostic = () => `elapsed=${Math.round(performance.now() - started)}ms, responses=${JSON.stringify(received)}, stderr=${stderr()}`;
    const finish = err => {
      if (settled) return;
      settled = true;
      timers.clear(timer);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdin.removeListener("error", onError);
      child.stdout.removeListener("data", onData);
      err ? reject(err) : resolvePromise();
    };
    const onError = err => finish(err);
    const onClose = (code, signal) => finish(new Error(`MCP closed early: code=${code}, signal=${signal}; ${diagnostic()}`));
    const onData = chunk => {
      buffer += chunk;
      try {
        let end;
        while ((end = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line) continue;
          const message = JSON.parse(line);
          assert.equal(message.jsonrpc, "2.0", "non-protocol stdout");
          if (message.id !== undefined) {
            messages.set(message.id, message);
            received.push({ id: message.id, elapsedMs: Math.round(performance.now() - started) });
          }
        }
        if ([1, 2, 3, 4].every(id => messages.has(id))) finish();
      } catch (err) { finish(err); }
    };
    child.on("error", onError);
    child.on("close", onClose);
    child.stdin.on("error", onError);
    child.stdout.on("data", onData);
    timer = timers.set(() => finish(new Error("MCP response deadline: " + diagnostic())), RESPONSE_TIMEOUT_MS);
    try {
      for (const message of [
        { id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "startup-test", version: "0" } } },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/list", params: {} },
        { id: 3, method: "tools/call", params: { name: "gsc_capabilities", arguments: {} } },
        { id: 4, method: "prompts/list", params: {} },
      ]) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    } catch (err) { finish(err); }
  });
}

test("MCP response wait removes listeners and timer on success, timeout, close and errors", async () => {
  for (const outcome of ["success", "timeout", "close", "child-error", "stdin-error", "invalid-json", "write-error"]) {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin.write = () => {
      if (outcome === "write-error") throw new Error("write failure");
    };
    let expire;
    let cleared = false;
    const timers = {
      set: (fn, ms) => { assert.equal(ms, RESPONSE_TIMEOUT_MS); expire = fn; return 1; },
      clear: id => { assert.equal(id, 1); cleared = true; },
    };
    const messages = new Map();
    const waiting = waitForMcp(child, messages, () => "fixture stderr", timers);
    const check = outcome === "success" ? waiting : assert.rejects(waiting, outcome === "timeout" ? /MCP response deadline:.*responses=.*fixture stderr/ : /closed early|fixture error|JSON|write failure/);
    if (outcome === "success") {
      for (const id of [1, 2, 3, 4]) child.stdout.emit("data", JSON.stringify({ jsonrpc: "2.0", id, result: {} }) + "\n");
    } else if (outcome === "timeout") expire();
    else if (outcome === "close") child.emit("close", 1, null);
    else if (outcome === "child-error") child.emit("error", new Error("fixture error"));
    else if (outcome === "stdin-error") child.stdin.emit("error", new Error("fixture error"));
    else if (outcome === "invalid-json") child.stdout.emit("data", "invalid JSON\n");
    await check;
    assert.ok(cleared);
    assert.equal(child.listenerCount("error"), 0);
    assert.equal(child.listenerCount("close"), 0);
    assert.equal(child.stdin.listenerCount("error"), 0);
    assert.equal(child.stdout.listenerCount("data"), 0);
    // Late close/data cannot settle another test or restart the response timer.
    child.emit("close", null, "SIGTERM");
    child.stdout.emit("data", "late data\n");
  }
});

test("real default stdio server lists the catalog and prompts without credentials", { timeout: STARTUP_TEST_TIMEOUT_MS }, async () => {
  const { CANONICAL_TOOLS } = await import("../dist/gsc/catalog.js");
  await isolated(async ({ home, env, trackChild }) => {
    // A real handshake and metadata requests must not load the Google SDK.
    // Fail immediately on an eager import instead of relying on host speed.
    const preload = join(home, "reject-google.cjs");
    writeFileSync(preload, `
      const Module = require('node:module');
      const originalLoad = Module._load;
      Module._load = function(id, ...args) {
        if (id === 'googleapis' || id.startsWith('googleapis/')) {
          throw new Error('Google SDK loaded during MCP startup or metadata request');
        }
        return originalLoad.call(this, id, ...args);
      };
    `);
    const before = snapshot(home);
    const child = spawn(process.execPath, ["--require", preload, join(dist, "index.js")], { env, stdio: ["pipe", "pipe", "pipe"] });
    const observed = trackChild(child);
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const messages = new Map();
    try {
      await waitForMcp(child, messages, () => stderr);
      assert.equal(messages.get(1).result.serverInfo.name, "gsc-mcp");
      assert.deepEqual(messages.get(2).result.tools.map(tool => tool.name).sort(), CANONICAL_TOOLS.map(tool => tool.name).sort());
      assert.deepEqual(JSON.parse(messages.get(3).result.content[0].text).data.tools, CANONICAL_TOOLS);
      assert.ok(messages.get(4).result.prompts.length > 0);
      assert.deepEqual(snapshot(home), before);
    } finally {
      // Runs on response timeout, spawn/stream error and assertion failure as well as success.
      await stopChild(observed);
      assert.ok(observed.closed, "close must precede isolated directory removal");
      assert.ok(existsSync(home), "HOME must remain present until close is observed");
      assert.ok(existsSync(env.BUN_RUNTIME_TRANSPILER_CACHE_PATH), "cache must remain present until close is observed");
    }
  });
});

test("child cleanup observes synchronous close before removing isolated HOME/cache, including errors", async () => {
  let home;
  let cache;
  await assert.rejects(isolated(async context => {
    home = context.home;
    cache = context.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH;
    const child = new EventEmitter();
    child.kill = () => {
      assert.ok(existsSync(home));
      assert.ok(existsSync(cache));
      child.emit("close", null, "SIGTERM");
      return true;
    };
    const observed = context.trackChild(child);
    try {
      throw new Error("mock response failure");
    } finally {
      await stopChild(observed);
      assert.ok(observed.closed);
    }
  }), /mock response failure/);
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(cache), false);
});

test("child cleanup contains late process and stdin errors until close", async () => {
  for (const source of ["process", "stdin"]) {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin.write = () => {};
    child.kill = () => true;
    const observed = observeChild(child);
    const response = waitForMcp(child, new Map(), () => "");
    for (const id of [1, 2, 3, 4]) child.stdout.emit("data", JSON.stringify({ jsonrpc: "2.0", id }) + "\n");
    await response;
    const stopped = stopChild(observed);
    const lateError = new Error("late " + source + " error");
    const failure = assert.rejects(stopped, err => {
      assert.ok(err instanceof AggregateError);
      assert.deepEqual(err.errors, [lateError]);
      assert.ok(observed.closed, "report lifecycle errors only after confirmed close");
      return true;
    });
    assert.doesNotThrow(() => (source === "stdin" ? child.stdin : child).emit("error", lateError));
    assert.equal(observed.closed, false);
    child.emit("close", null, "SIGTERM");
    await failure;
    assert.equal(child.listenerCount("error"), 0);
    assert.equal(child.stdin.listenerCount("error"), 0);
    await assert.rejects(stopChild(observed), /Child lifecycle errors/);
  }
});

test("child cleanup escalates within one budget and retains directories on unconfirmed termination", async () => {
  let home;
  let cache;
  const callbacks = new Map();
  const cleared = [];
  const signals = [];
  const timers = {
    set: (fn, ms) => { callbacks.set(ms, fn); return ms; },
    clear: id => cleared.push(id),
  };
  try {
    await assert.rejects(isolated(async context => {
      home = context.home;
      cache = context.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH;
      const child = new EventEmitter();
      child.kill = signal => { signals.push(signal); return true; };
      const observed = context.trackChild(child);
      const stopped = stopChild(observed, timers);
      const failure = assert.rejects(stopped, /termination unconfirmed after 5s/);
      assert.deepEqual([...callbacks.keys()], [2_500, 5_000]);
      callbacks.get(2_500)();
      callbacks.get(5_000)();
      await failure;
      assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
      assert.deepEqual(cleared, [2_500, 5_000]);
    }), /termination unconfirmed; HOME\/cache retained/);
    assert.ok(existsSync(home));
    assert.ok(existsSync(cache));
  } finally {
    // This regression uses a fake child: no live process owns these retained directories.
    if (home) rmSync(home, { recursive: true, force: true });
    if (cache) rmSync(cache, { recursive: true, force: true });
  }
});
