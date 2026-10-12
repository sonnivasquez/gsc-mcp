import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homeEnvironment } from "./subprocess.mjs";

// Pass this to node:test's options too: Bun otherwise imposes an outer 5s limit.
export const MCP_TEST_TIMEOUT_MS = 40_000;
const OPERATION_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
const entrypoint = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

// Public dependency seams keep lifecycle regressions offline and deterministic.
export function createMcpClientRunner({
  makeClient = info => new Client(info),
  makeTransport = options => new StdioClientTransport(options),
  timers = { set: setTimeout, clear: clearTimeout },
} = {}) {
  return async function withMcpClient({ name, env = {} }, callback) {
    const home = mkdtempSync(join(tmpdir(), "gsc-mcp-test-"));
    let client;
    let transport;
    try {
      const clean = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^GSC_/i.test(key)));
      client = makeClient({ name, version: "1.0.0" });
      transport = makeTransport({
        command: process.execPath,
        args: [entrypoint],
        stderr: "pipe",
        env: {
          ...clean,
          ...env,
          ...homeEnvironment(home),
          GSC_DATA_DIR: join(home, "state"),
          GSC_AUTH_MODE: "oauth",
        },
      });
    } catch (error) {
      rmSync(home, { recursive: true, force: true });
      throw error;
    }

    let closed = false;
    // Protocol.connect wraps this callback. Install it BEFORE connecting, not
    // on client.onclose, and never infer child exit from close() resolving.
    const confirmedClose = new Promise(resolve => {
      const previous = transport.onclose;
      transport.onclose = () => {
        closed = true;
        resolve();
        previous?.();
      };
    });
    // Drain piped diagnostics so a noisy child cannot block on stderr.
    transport.stderr?.resume();
    const controller = new AbortController();
    const requestOptions = { signal: controller.signal, timeout: OPERATION_TIMEOUT_MS };
    const failures = [];
    let result;
    let operationTimer;
    try {
      const deadline = new Promise((_, reject) => {
        operationTimer = timers.set(() => {
          const error = new Error(`MCP operation timed out after ${OPERATION_TIMEOUT_MS}ms`);
          // Settle the race first, then cancel the SDK's in-flight request.
          reject(error);
          controller.abort(error);
        }, OPERATION_TIMEOUT_MS);
      });
      const work = Promise.resolve().then(async () => {
        await client.connect(transport, requestOptions);
        controller.signal.throwIfAborted();
        return callback(client, requestOptions);
      });
      // The race observes work even if it rejects after timeout or teardown.
      result = await Promise.race([deadline, work]);
    } catch (error) {
      failures.push(error);
    } finally {
      timers.clear(operationTimer);
    }

    let closeTimer;
    try {
      const deadline = new Promise((_, reject) => {
        closeTimer = timers.set(() => reject(new Error(closed
          ? `MCP close incomplete after ${CLOSE_TIMEOUT_MS}ms; transport exit confirmed`
          : `MCP close unconfirmed after ${CLOSE_TIMEOUT_MS}ms; retain HOME/cache: ${home}`,
        )), CLOSE_TIMEOUT_MS);
      });
      // Do not replace client.close: Client.connect invokes it without awaiting
      // on initialize failure. Its own close may already be in progress here.
      const closing = Promise.resolve().then(() => client.close()).catch(error => {
        failures.push(error);
      });
      await Promise.race([Promise.all([closing, confirmedClose]), deadline]);
    } catch (error) {
      failures.push(error);
    } finally {
      timers.clear(closeTimer);
      // A timeout does not authorize deletion while a child may still use HOME.
      if (closed) {
        try { rmSync(home, { recursive: true, force: true }); }
        catch (error) { failures.push(error); }
      }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "MCP operation/cleanup failed");
    return result;
  };
}

export const withMcpClient = createMcpClientRunner();
