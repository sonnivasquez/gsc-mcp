#!/usr/bin/env node
// Run with Node. --runtime selects BOTH the SDK client worker and its server.
// Examples: node scripts/diagnose-mcp-lifecycle.mjs --runtime node
//           node scripts/diagnose-mcp-lifecycle.mjs --runtime bun
// JSON output contains timing events, not credentials or tool response bodies.
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolation, supervise } from './verify-cli-startup.mjs';

const cases = [
  ['readonly', {}],
  ['full', { GSC_ACCESS_MODE: 'full' }],
  ['readonly-overrides-legacy', { GSC_ACCESS_MODE: 'readonly', GSC_SCOPES: 'full', GSC_ENABLE_WRITE: '1' }],
  ['legacy-full', { GSC_SCOPES: 'full' }],
];
const script = fileURLToPath(import.meta.url);

async function worker() {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { createMcpClientRunner } = await import('../test/helpers/mcp-client.mjs');
  console.log(JSON.stringify({ event: 'worker-ready', runtime: process.execPath,
    node: process.version, bun: process.versions.bun ?? null,
    platform: process.platform, arch: process.arch }));
  for (const [name, env] of cases) {
    const started = performance.now();
    const event = (event, details = {}) => console.log(JSON.stringify({
      case: name, event, elapsedMs: Math.round((performance.now() - started) * 100) / 100, ...details,
    }));
    let closeCalls = 0;
    let confirmed = false;
    let stderrBytes = 0;
    const run = createMcpClientRunner({
      makeTransport(options) {
        const transport = new StdioClientTransport(options);
        transport.stderr.on('data', chunk => { stderrBytes += chunk.length; });
        transport.onclose = () => {
          confirmed = true;
          event('child-close-confirmed', { stderrBytes });
        };
        const start = transport.start.bind(transport);
        transport.start = async () => {
          // SDK start resolves on spawn, NOT when the server is initialized.
          event('spawn-requested');
          await start();
          event('spawn-confirmed', { pid: transport.pid });
        };
        const close = transport.close.bind(transport);
        transport.close = async () => {
          const call = ++closeCalls;
          event('close-requested', { call, confirmed });
          await close();
          event('close-returned', { call, confirmed });
        };
        return transport;
      },
    });
    event('case-start');
    try {
      await run({ name: 'lifecycle-diagnostic', env }, async (client, options) => {
        event('initialize-complete');
        await client.callTool({ name: 'gsc_capabilities', arguments: {} }, undefined, options);
        event('capabilities-complete');
        // The access matrix only calls capabilities; this extra request probes
        // the schema-listing phase used by the multi-site test separately.
        await client.listTools(undefined, options);
        event('tools-list-complete');
      });
      event('case-complete');
    } catch (error) {
      event('case-failed', { errorName: error.name, errorCode: error.code ?? null, confirmed });
      process.exitCode = 1;
      return; // Do not overlap another case with uncertain termination.
    }
  }
}

async function main() {
  if (process.argv[2] === '--worker') return worker();
  const args = process.argv.slice(2);
  if (process.versions.bun || (args.length && (args.length !== 2 || args[0] !== '--runtime'))) {
    throw new Error('Usage: node scripts/diagnose-mcp-lifecycle.mjs [--runtime node|bun|absolute-executable]');
  }
  const runtime = args[1] || process.execPath;
  const area = await isolation();
  // Reuse the existing bounded supervisor. On Windows, a deadline stops ONLY
  // this worker's process tree with taskkill /PID <worker> /T /F.
  const result = await supervise(runtime, [script, '--worker'], {
    env: area.env, deadlineMs: 150_000,
  });
  const passed = result.status === 0 && result.terminationConfirmed &&
    !result.timedOut && !result.error && !result.cleanupError && !result.outputLimit;
  console.log(JSON.stringify({ runtime, cwd: resolve('.'), passed, ...result,
    retainedIsolation: result.terminationConfirmed ? null : area.base }, null, 2));
  if (result.terminationConfirmed) await rm(area.base, { recursive: true, force: true });
  process.exitCode = passed ? 0 : 1;
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'diagnostic-failed', errorName: error.name,
    errorCode: error.code ?? null }));
  process.exitCode = 1;
});
