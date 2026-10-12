import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpClientRunner, MCP_TEST_TIMEOUT_MS, withMcpClient } from "./helpers/mcp-client.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function clock() {
  const pending = new Map();
  const scheduled = [];
  return {
    pending,
    scheduled,
    set(fn, ms) {
      const id = {};
      pending.set(id, { fn, ms });
      scheduled.push(ms);
      return id;
    },
    clear(id) { pending.delete(id); },
    fire(ms) {
      const entry = [...pending].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, `expected a pending ${ms}ms timer`);
      pending.delete(entry[0]);
      entry[1].fn();
    },
  };
}

// Exercise the real SDK's callback wrapping, abort handling, and initialize
// failure path. No subprocess, Google credentials, or network is needed.
function fixture(t, { initialize = "ok", close = "automatic", makeClient } = {}) {
  const timers = clock();
  const initializing = deferred();
  const requesting = deferred();
  const closing = deferred();
  let options;
  let client;
  let closeCalls = 0;
  const transport = {
    async start() {},
    async send(message) {
      if (message.method === "initialize") {
        initializing.resolve(message);
        if (initialize === "pending") return;
        queueMicrotask(() => transport.onmessage?.(initialize === "error" ? {
          jsonrpc: "2.0", id: message.id,
          error: { code: -32603, message: "fixture initialize failure" },
        } : {
          jsonrpc: "2.0", id: message.id,
          result: {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          },
        }));
      } else if (message.method === "tools/list") {
        requesting.resolve(message);
      }
    },
    async close() {
      closeCalls++;
      closing.resolve();
      if (close === "automatic") transport.finishClose();
    },
    finishClose() { transport.onclose?.(); },
  };
  const run = createMcpClientRunner({
    timers,
    makeClient(info) {
      client = makeClient ? makeClient(info) : new Client(info);
      return client;
    },
    makeTransport(params) { options = params; return transport; },
  });
  t.after(() => {
    transport.finishClose();
    if (options) rmSync(options.env.HOME, { recursive: true, force: true });
  });
  return {
    run, timers, transport, initializing, requesting, closing,
    get options() { return options; },
    get client() { return client; },
    get closeCalls() { return closeCalls; },
  };
}

function lifecycleTest(name, body) {
  test(name, { timeout: MCP_TEST_TIMEOUT_MS }, async t => {
    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      await body(t);
      // Include rejects delivered after the helper has returned.
      await nextTurn();
      await nextTurn();
      assert.deepEqual(unhandled, []);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
}

lifecycleTest("normal lifecycle isolates environment and waits for actual transport close", async t => {
  assert.equal(MCP_TEST_TIMEOUT_MS, 40_000);
  assert.equal(typeof withMcpClient, "function");
  const saved = process.env.GSC_LIFECYCLE_SENTINEL;
  process.env.GSC_LIFECYCLE_SENTINEL = "must not leak";
  t.after(() => {
    if (saved === undefined) delete process.env.GSC_LIFECYCLE_SENTINEL;
    else process.env.GSC_LIFECYCLE_SENTINEL = saved;
  });
  const f = fixture(t, { close: "manual" });
  const result = f.run({ name: "normal", env: { GSC_ACCESS_MODE: "full" } }, async (client, requestOptions) => {
    assert.equal(client, f.client);
    assert.equal(client.close, Client.prototype.close);
    assert.equal(requestOptions.timeout, 30_000);
    assert.equal(requestOptions.signal.aborted, false);
    const { env, command, args } = f.options;
    assert.equal(command, process.execPath);
    assert.equal(isAbsolute(args[0]), true);
    assert.match(args[0], /[\\/]dist[\\/]index\.js$/);
    assert.equal(env.GSC_LIFECYCLE_SENTINEL, undefined);
    assert.equal(env.GSC_ACCESS_MODE, "full");
    assert.equal(env.GSC_AUTH_MODE, "oauth");
    assert.equal(env.USERPROFILE, env.HOME);
    assert.equal(env.APPDATA, join(env.HOME, "AppData", "Roaming"));
    assert.equal(env.LOCALAPPDATA, join(env.HOME, "AppData", "Local"));
    assert.equal(env.GSC_DATA_DIR, join(env.HOME, "state"));
    return "callback result";
  });
  await f.closing.promise;
  await nextTurn();
  assert.equal(existsSync(f.options.env.HOME), true, "close() resolution is not exit confirmation");
  assert.equal(f.timers.pending.size, 1);
  f.transport.finishClose();
  assert.equal(await result, "callback result");
  assert.equal(existsSync(f.options.env.HOME), false);
  assert.equal(f.timers.pending.size, 0);
  assert.deepEqual(f.timers.scheduled, [30_000, 5_000]);
});

lifecycleTest("a timed out initialize aborts the SDK request without overriding close", async t => {
  const f = fixture(t, { initialize: "pending" });
  let called = false;
  const result = f.run({ name: "connect-timeout" }, () => { called = true; });
  const rejected = assert.rejects(result, /MCP operation timed out after 30000ms/);
  await f.initializing.promise;
  assert.equal(f.client.close, Client.prototype.close);
  f.timers.fire(30_000);
  await rejected;
  assert.equal(called, false);
  assert.ok(f.closeCalls >= 1);
  assert.equal(existsSync(f.options.env.HOME), false);
  assert.equal(f.timers.pending.size, 0);
});

lifecycleTest("one total deadline covers connect and callback and aborts a pending SDK request", async t => {
  const f = fixture(t);
  let signal;
  const result = f.run({ name: "request-timeout" }, async (client, options) => {
    signal = options.signal;
    return client.listTools({}, options);
  });
  const rejected = assert.rejects(result, /MCP operation timed out after 30000ms/);
  await f.requesting.promise;
  assert.deepEqual(f.timers.scheduled, [30_000], "callback must not restart the total budget");
  f.timers.fire(30_000);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.match(signal.reason.message, /MCP operation timed out/);
  assert.equal(existsSync(f.options.env.HOME), false);
  assert.equal(f.timers.pending.size, 0);
});

lifecycleTest("unconfirmed close retains HOME even when close() resolves", async t => {
  const f = fixture(t, { close: "manual" });
  const result = f.run({ name: "unconfirmed" }, async () => "done");
  const rejected = assert.rejects(result, error => {
    assert.match(error.message, /MCP close unconfirmed after 5000ms; retain HOME\/cache:/);
    assert.ok(error.message.includes(f.options.env.HOME));
    return true;
  });
  await f.closing.promise;
  f.timers.fire(5_000);
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), true);
  f.transport.finishClose();
  await nextTurn();
  assert.equal(existsSync(f.options.env.HOME), true, "late close must not trigger background deletion");
  assert.equal(f.timers.pending.size, 0);
});

lifecycleTest("initialize failure preserves the SDK error and observes its automatic close", async t => {
  const f = fixture(t, { initialize: "error", close: "manual" });
  const result = f.run({ name: "initialize-error" }, () => assert.fail("callback must not run"));
  const rejected = assert.rejects(result, error => {
    assert.equal(error.code, -32603);
    assert.match(error.message, /fixture initialize failure/);
    return true;
  });
  await f.closing.promise;
  await nextTurn();
  assert.equal(existsSync(f.options.env.HOME), true);
  f.transport.finishClose();
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), false);
});

lifecycleTest("callback failure preserves identity, including when teardown also fails", async t => {
  const original = new Error("callback failed");
  const f = fixture(t);
  await assert.rejects(f.run({ name: "callback-error" }, () => { throw original; }), error => error === original);
  const g = fixture(t, { close: "manual" });
  const result = g.run({ name: "both-errors" }, () => { throw original; });
  const rejected = assert.rejects(result, error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], original);
    assert.match(error.errors[1].message, /retain HOME\/cache/);
    return true;
  });
  await g.closing.promise;
  g.timers.fire(5_000);
  await rejected;
  assert.equal(existsSync(g.options.env.HOME), true);
});

lifecycleTest("late callback Connection closed rejection is consumed after timeout", async t => {
  const f = fixture(t);
  const callbackStarted = deferred();
  const late = deferred();
  const result = f.run({ name: "late-callback" }, () => {
    callbackStarted.resolve();
    return late.promise;
  });
  const rejected = assert.rejects(result, /MCP operation timed out/);
  await callbackStarted.promise;
  f.timers.fire(30_000);
  await rejected;
  late.reject(new Error("Connection closed"));
});

lifecycleTest("late connect rejection is consumed and never invokes the callback", async t => {
  const late = deferred();
  const started = deferred();
  const f = fixture(t, {
    makeClient: () => ({
      connect() { started.resolve(); return late.promise; },
      async close() { f.transport.finishClose(); },
    }),
  });
  const result = f.run({ name: "late-connect" }, () => assert.fail("callback must not run"));
  const rejected = assert.rejects(result, /MCP operation timed out/);
  await started.promise;
  f.timers.fire(30_000);
  await rejected;
  late.reject(new Error("Connection closed"));
});

lifecycleTest("late successful connect cannot start the callback after timeout", async t => {
  const late = deferred();
  const started = deferred();
  const f = fixture(t, { makeClient: () => ({
    connect() { started.resolve(); return late.promise; },
    async close() { f.transport.finishClose(); },
  }) });
  let called = false;
  const result = f.run({ name: "late-connect-success" }, () => { called = true; });
  const rejected = assert.rejects(result, /MCP operation timed out/);
  await started.promise;
  f.timers.fire(30_000);
  await rejected;
  late.resolve();
  await nextTurn();
  assert.equal(called, false);
});

lifecycleTest("initialize timeout plus unconfirmed automatic close retains HOME without unhandled rejection", async t => {
  const f = fixture(t, { initialize: "pending", close: "manual" });
  const result = f.run({ name: "initialize-and-close-timeout" }, () => assert.fail("callback must not run"));
  const rejected = assert.rejects(result, error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /MCP operation timed out/);
    assert.match(error.errors[1].message, /MCP close unconfirmed/);
    return true;
  });
  await f.initializing.promise;
  f.timers.fire(30_000);
  await f.closing.promise;
  await nextTurn();
  f.timers.fire(5_000);
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), true);
  f.transport.finishClose();
});

lifecycleTest("unexpected transport exit preserves the SDK Connection closed error", async t => {
  const f = fixture(t);
  const result = f.run({ name: "unexpected-exit" }, (client, options) => client.listTools({}, options));
  const rejected = assert.rejects(result, error => {
    assert.equal(error.code, -32000);
    assert.match(error.message, /Connection closed/);
    return true;
  });
  await f.requesting.promise;
  f.transport.finishClose();
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), false);
});

lifecycleTest("close rejection is observed while still awaiting exit confirmation", async t => {
  const original = new Error("close failed");
  const f = fixture(t, { makeClient: () => ({
    async connect() {},
    async close() { f.closing.resolve(); throw original; },
  }) });
  const result = f.run({ name: "close-error" }, async () => {});
  const rejected = assert.rejects(result, error => error === original);
  await f.closing.promise;
  await nextTurn();
  assert.equal(existsSync(f.options.env.HOME), true);
  f.transport.finishClose();
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), false);
});

lifecycleTest("late close rejection after cleanup deadline is consumed", async t => {
  const late = deferred();
  const f = fixture(t, { makeClient: () => ({
    async connect() {},
    close() { f.closing.resolve(); return late.promise; },
  }) });
  const result = f.run({ name: "late-close" }, async () => {});
  const rejected = assert.rejects(result, /MCP close unconfirmed/);
  await f.closing.promise;
  f.timers.fire(5_000);
  await rejected;
  assert.equal(existsSync(f.options.env.HOME), true);
  late.reject(new Error("Connection closed"));
});
