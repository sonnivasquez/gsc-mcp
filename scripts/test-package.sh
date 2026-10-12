#!/bin/sh
# test:package — pack the tarball, install it in a throwaway dir, and run the
# MCP smoke there with both runtimes. Catches missing files[] entries and
# undeclared dependencies. Needs network for the clean-room npm install.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
# dist is runtime-agnostic tsc output: build explicitly with Node so this
# check works even on Node-only machines. Bun/Node parity is covered by CI.
npm run build:node >/dev/null 2>&1
TARBALL="$(npm pack --silent --pack-destination "$WORK")"
echo "packed: $TARBALL"

mkdir -p "$WORK/room-npm" "$WORK/room-bun"
cd "$WORK/room-npm"
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund "$WORK/$TARBALL" >/dev/null 2>&1
ENTRY_NPM="$WORK/room-npm/node_modules/@sonnivasquez/gsc-mcp/dist/index.js"
sh "$ROOT/scripts/test-mcp.sh" "$ENTRY_NPM" node

cd "$WORK/room-bun"
bun install --silent "$WORK/$TARBALL" >/dev/null 2>&1
ENTRY_BUN="$WORK/room-bun/node_modules/@sonnivasquez/gsc-mcp/dist/index.js"
sh "$ROOT/scripts/test-mcp.sh" "$ENTRY_BUN" bun

# Check both published global aliases using isolated install roots. Node is
# required by the package's cross-platform JS bin shim, even for Bun installs.
npm install -g --prefix "$WORK/npm-global" --no-audit --no-fund "$WORK/$TARBALL" >/dev/null 2>&1
"$WORK/npm-global/bin/gsc" --version >/dev/null
"$WORK/npm-global/bin/gsc-mcp" --version >/dev/null
"$WORK/npm-global/bin/gsc" config print --client generic > "$WORK/npm-global-config.json"
node -e 'const fs=require("node:fs");const path=require("node:path");const e=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).mcpServers["gsc-local"];if(e.command!==process.execPath||!path.isAbsolute(e.args[0])||!e.args[0].endsWith(path.join("@sonnivasquez","gsc-mcp","dist","index.js"))||e.args[1]!=="serve")process.exit(1)' "$WORK/npm-global-config.json"

mkdir -p "$WORK/bun-global"
BUN_INSTALL="$WORK/bun-global" bun install -g --ignore-scripts "$WORK/$TARBALL" >/dev/null 2>&1
"$WORK/bun-global/bin/gsc" --version >/dev/null
"$WORK/bun-global/bin/gsc-mcp" --version >/dev/null
"$WORK/bun-global/bin/gsc" config print --client generic > "$WORK/bun-global-config.json"
node -e 'const fs=require("node:fs");const path=require("node:path");const e=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).mcpServers["gsc-local"];if(e.command!==process.execPath||!path.isAbsolute(e.args[0])||!e.args[0].endsWith(path.join("@sonnivasquez","gsc-mcp","dist","index.js"))||e.args[1]!=="serve")process.exit(1)' "$WORK/bun-global-config.json"

echo "test:package OK: tarball serves under node and bun; npm/Bun global installs expose both aliases and print installed absolute server paths"
