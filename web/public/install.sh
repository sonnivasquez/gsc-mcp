#!/bin/sh
# Install the latest GSC MCP release globally, then open read-only setup.
set -eu

GSC_INSTALL_MANAGER=npm
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manager)
      [ "$#" -ge 2 ] || { echo 'Usage: install.sh [--manager npm|bun]' >&2; exit 1; }
      GSC_INSTALL_MANAGER="$2"
      shift 2
      ;;
    --help)
      echo 'Usage: install.sh [--manager npm|bun]'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
case "$GSC_INSTALL_MANAGER" in
  npm|bun) ;;
  *) echo 'Choose --manager npm or --manager bun.' >&2; exit 1 ;;
esac

# The CLI bin keeps Node's shebang for cross-platform npm shims. Node is needed
# to run `gsc` even when Bun is selected as the package installer.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Install Node.js 22 or newer, then run this installer again.' >&2
  exit 1
fi
if ! command -v "$GSC_INSTALL_MANAGER" >/dev/null 2>&1; then
  echo "Install $GSC_INSTALL_MANAGER first, or choose another --manager." >&2
  exit 1
fi
if ! (test -r /dev/tty && test -w /dev/tty && ( : </dev/tty )) 2>/dev/null; then
  echo 'Run this installer in an interactive terminal to complete Google sign-in and setup.' >&2
  exit 1
fi

case "$GSC_INSTALL_MANAGER" in
  npm)
    npm view @sonnivasquez/gsc-mcp version --registry=https://registry.npmjs.org/ >/dev/null
    npm install -g --ignore-scripts --no-audit --no-fund \
      --registry=https://registry.npmjs.org/ @sonnivasquez/gsc-mcp
    GSC_INSTALL_BIN="$(npm prefix -g)/bin/gsc"
    ;;
  bun)
    bun install -g --ignore-scripts --registry=https://registry.npmjs.org/ @sonnivasquez/gsc-mcp
    GSC_INSTALL_BIN="$(bun pm bin -g)/gsc"
    ;;
esac
if [ ! -x "$GSC_INSTALL_BIN" ]; then
  echo "Installation did not provide gsc at $GSC_INSTALL_BIN." >&2
  exit 1
fi
case ":$PATH:" in
  *":$(dirname "$GSC_INSTALL_BIN"):"*) ;;
  *) echo "To use gsc in your terminal, add $(dirname "$GSC_INSTALL_BIN") to your PATH." ;;
esac
echo 'Starting read-only Quick Connect setup. Complete Google sign-in in your browser.'
exec "$GSC_INSTALL_BIN" setup --auth shared --access readonly </dev/tty
