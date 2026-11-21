import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const { createReadToolRegistrar } = await import("../dist/mcp-update-notice.js");
const { reserveUpdateNotice } = await import("../dist/update-notice.js");
const { REGISTRY_VERSION_CACHE_TTL_MS } = await import("../dist/registry-version.js");
const require = createRequire(import.meta.url);
const version = "9.9.9";

function useNoticeDirectory(t) {
  const previousDir = process.env.GSC_DATA_DIR;
  const previousOptOut = process.env.GSC_UPDATE_CHECK;
  const cache = mkdtempSync(path.join(tmpdir(), "gsc-update-notice-"));
  process.env.GSC_DATA_DIR = cache;
  delete process.env.GSC_UPDATE_CHECK;
  t.after(() => {
    if (previousDir === undefined) delete process.env.GSC_DATA_DIR;
    else process.env.GSC_DATA_DIR = previousDir;
    if (previousOptOut !== undefined) process.env.GSC_UPDATE_CHECK = previousOptOut;
    rmSync(cache, { recursive: true, force: true });
  });
  return cache;
}

async function withClient(action, use, onRead) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "update-test", version: "1.0.0" }, {
    capabilities: action ? { elicitation: { form: {} } } : {},
  });
  let calls = 0;
  let prompts = 0;
  if (action) {
    client.setRequestHandler(ElicitRequestSchema, (request, extra) => {
      prompts++;
      assert.equal(calls, 0, "Prompt must happen before running the read");
      assert.match(request.params.message, /9\.9\.9/);
      if (typeof action === "function") return action(extra);
      if (action === "decline") return { action: "decline" };
      return { action: "accept", content: { action } };
    });
  }

  const server = new McpServer({ name: "update-test", version: "1.0.0" });
  const readTool = createReadToolRegistrar(server, async () => ({ version }));
  readTool("read", "Test read", { value: z.number() }, async ({ value }, extra) => {
    calls++;
    if (onRead) await onRead(extra);
    return { content: [{ type: "text", text: JSON.stringify({ value }) }] };
  });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const call = options => client.callTool({ name: "read", arguments: { value: 7 } }, undefined, options);
    await use({ call, calls: () => calls, prompts: () => prompts });
  } finally {
    await client.close();
    await server.close();
  }
}

for (const action of ["update", "continue", "decline", undefined]) {
  test(`MCP update dialog handles ${action ?? "clients without elicitation"}`, async t => {
    useNoticeDirectory(t);
    await withClient(action, async ({ call, calls, prompts }) => {
      const result = await call();
      assert.equal(prompts(), action ? 1 : 0);
      if (action === "update") {
        assert.equal(calls(), 0);
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /gsc update --to 9\.9\.9/);
      } else {
        assert.equal(calls(), 1);
        assert.equal(result.content[0].text, '{"value":7}');
        assert.equal(result.content.length, action ? 1 : 2);
      }
    });
    // A new process using the same data directory should not repeat the notice.
    await withClient(action, async ({ call, calls, prompts }) => {
      const result = await call();
      assert.equal(prompts(), 0);
      assert.equal(calls(), 1);
      assert.deepEqual(result.content, [{ type: "text", text: '{"value":7}' }]);
    });
  });
}

test("MCP retries a text notice in the same session after a failed read", async t => {
  useNoticeDirectory(t);
  let fail = true;
  await withClient(undefined, async ({ call }) => {
    const failed = await call();
    assert.equal(failed.isError, true);
    assert.equal(failed.content[0].text, "Read failed");

    fail = false;
    const result = await call();
    assert.match(result.content[1]?.text ?? "", /gsc update --to 9\.9\.9/);
  }, () => {
    if (fail) throw new Error("Read failed");
  });
});

for (const phase of ["read", "dialog"]) {
  test(`MCP retains the update notice after cancellation during the ${phase}`, { timeout: 5_000 }, async t => {
    useNoticeDirectory(t);
    const controller = new AbortController();
    const started = Promise.withResolvers();
    const waitForCancellation = ({ signal }) => {
      started.resolve();
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    await withClient(phase === "dialog" ? waitForCancellation : undefined, async ({ call }) => {
      const pending = assert.rejects(call({ signal: controller.signal }), /Cancel the request/);
      await started.promise;
      controller.abort(new Error("Cancel the request"));
      await pending;
    }, phase === "read" ? waitForCancellation : undefined);

    await withClient(undefined, async ({ call }) => {
      const result = await call();
      assert.match(result.content[1]?.text ?? "", /gsc update --to 9\.9\.9/);
    });
  });
}

test("MCP rechecks a delivery marker that another session rolls back", async t => {
  useNoticeDirectory(t);
  const otherSession = reserveUpdateNotice(version);
  const undoDelivery = otherSession.complete();
  assert.equal(typeof undoDelivery, "function");

  await withClient(undefined, async ({ call }) => {
    assert.equal((await call()).content.length, 1);
    undoDelivery();
    const now = Date.now;
    Date.now = () => now() + REGISTRY_VERSION_CACHE_TTL_MS + 1;
    try {
      const result = await call();
      assert.match(result.content[1]?.text ?? "", /gsc update --to 9\.9\.9/);
    } finally {
      Date.now = now;
    }
  });
});

test("MCP shows an update after the reservation of a terminated server expires", { timeout: 15_000 }, async t => {
  const cache = useNoticeDirectory(t);
  const transport = new StdioClientTransport({
    command: process.execPath,
    env: { GSC_DATA_DIR: cache },
    args: ["-e", `
      const { McpServer } = require(${JSON.stringify(require.resolve("@modelcontextprotocol/sdk/server/mcp.js"))});
      const { StdioServerTransport } = require(${JSON.stringify(require.resolve("@modelcontextprotocol/sdk/server/stdio.js"))});
      const { createReadToolRegistrar } = require(${JSON.stringify(require.resolve("../dist/mcp-update-notice.js"))});
      const server = new McpServer({ name: "update-test", version: "1.0.0" });
      const readTool = createReadToolRegistrar(server, async () => ({ version: ${JSON.stringify(version)} }));
      readTool("read", "Test read", {}, async () => ({ content: [{ type: "text", text: "Read" }] }));
      server.connect(new StdioServerTransport()).catch(error => { console.error(error); process.exitCode = 1; });
    `],
  });
  const client = new Client({ name: "update-test", version: "1.0.0" }, {
    capabilities: { elicitation: { form: {} } },
  });
  client.setRequestHandler(ElicitRequestSchema, async (_request, { signal }) => {
    assert.ok(transport.pid);
    process.kill(transport.pid, "SIGKILL");
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    return { action: "cancel" };
  });
  try {
    await client.connect(transport, { timeout: 5_000 });
    await assert.rejects(client.callTool({ name: "read", arguments: {} }, undefined, { timeout: 5_000 }), /Connection closed/);
  } finally {
    await client.close();
  }

  const marker = path.join(cache, "update-notices", version);
  const pending = `${marker}.pending`;
  assert.equal(existsSync(marker), false, "a pending dialogue is not a delivered notice");
  const [owner] = readdirSync(pending);
  await withClient(undefined, async ({ call }) => {
    assert.equal((await call()).content.length, 1, "a fresh reservation prevents overlapping notices");
  });

  const expired = new Date(Date.now() - 120_000);
  utimesSync(path.join(pending, owner), expired, expired);
  await withClient(undefined, async ({ call }) => {
    const result = await call();
    assert.match(result.content[1]?.text ?? "", /gsc update --to 9\.9\.9/);
  });
  assert.equal(existsSync(marker), true);
  assert.equal(existsSync(pending), false);
});

test("automatic update retries missed and rejected installation probes, then caches success", async t => {
  useNoticeDirectory(t);
  const install = require("../dist/update-install.js");
  const registry = require("../dist/registry-version.js");
  const { findAvailableUpdate } = require("../dist/update-notice.js");
  const originalProbe = install.findGlobalInstallation;
  const originalRegistry = registry.cachedRegistryLatest;
  t.after(() => {
    install.findGlobalInstallation = originalProbe;
    registry.cachedRegistryLatest = originalRegistry;
  });
  const installation = { manager: "bun" };
  let probes = 0;
  let checks = 0;
  install.findGlobalInstallation = async () => {
    probes++;
    if (probes === 1) return undefined;
    if (probes === 2) throw new Error("Probe failed");
    return installation;
  };
  registry.cachedRegistryLatest = async () => {
    checks++;
    return { ok: true, latest: version };
  };
  assert.deepEqual(await Promise.all([findAvailableUpdate(), findAvailableUpdate()]), [undefined, undefined]);
  assert.equal(probes, 1);
  assert.equal(await findAvailableUpdate(), undefined);
  assert.equal(checks, 0);
  assert.deepEqual(await findAvailableUpdate(), { version, installation });
  assert.deepEqual(await findAvailableUpdate(), { version, installation });
  assert.equal(probes, 3);
  assert.equal(checks, 2);
});
