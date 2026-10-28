#!/bin/sh
# test:mcp — stdio smoke against a built server entrypoint.
# Usage: scripts/test-mcp.sh [entry] [runtime]
# Defaults: dist/index.js via bun (primary). Pass explicit `node` for the Node secondary. No credentials, no network.
set -eu

ENTRY="${1:-dist/index.js}"
RUNTIME="${2:-bun}"

if [ ! -f "$ENTRY" ]; then
  echo "test:mcp: missing entry $ENTRY (run build first)" >&2
  exit 1
fi

OUT="$("$RUNTIME" "$ENTRY" --version 2>/dev/null)"
if [ "$OUT" != "1.0.0" ]; then
  echo "test:mcp: --version returned '$OUT', expected 1.0.0" >&2
  exit 1
fi

ENTRY="$ENTRY" RUNTIME="$RUNTIME" "$RUNTIME" -e '
const { spawn } = require("node:child_process");
const entry = process.env.ENTRY;
const runtime = process.env.RUNTIME;
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("GSC_")) delete env[k];
env.GSC_AUTH_MODE = "oauth";
const child = spawn(runtime, [entry], { env, stdio: ["pipe", "pipe", "pipe"] });
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-mcp", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "gsc_capabilities", arguments: {} } });
let out = "";
const timer = setTimeout(() => { console.error("test:mcp: timed out waiting for responses"); process.exit(1); }, 20000);
child.stdout.on("data", (c) => {
  out += c.toString();
  if (!out.includes("\"id\":3")) return;
  clearTimeout(timer);
  const byId = {};
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.jsonrpc !== "2.0") throw new Error("non-JSON-RPC line on stdout");
    if (msg.id !== undefined) byId[msg.id] = msg;
  }
  const tools = byId[2].result.tools;
  if (tools.length !== 34) throw new Error(`tools/list: ${tools.length}, expected 34`);
  const text = JSON.parse(byId[3].result.content[0].text);
  if (text.data.tools.length !== 34) throw new Error(`capabilities: ${text.data.tools.length}, expected 34`);
  console.log(`test:mcp OK: ${tools.length} tools, capabilities roundtrip works (${runtime})`);
  child.kill();
  process.exit(0);
});
child.on("error", (e) => { console.error(e.message); process.exit(1); });
'
