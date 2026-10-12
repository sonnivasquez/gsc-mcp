# Quickstart

Connect your AI assistant to Google Search Console in three steps: install the MCP, sign in to Google, and choose a property and client.

For Spanish, see the [Spanish quickstart](quickstart.es.md).

## 1. Install

You need **Node.js 22 or newer**. The installer uses npm by default; you can use Bun as the package manager, but Node is still required to run the `gsc` command.

### curl

This installs the latest release globally and opens setup:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh
```

To install with Bun instead of npm:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh -s -- --manager bun
```

### npm

```bash
npm install -g @sonnivasquez/gsc-mcp && gsc setup
```

### Bun

```bash
bun install -g @sonnivasquez/gsc-mcp && gsc setup
```

Both package-manager commands install the latest release globally. The `gsc` command remains available after you close the terminal or clear package-manager caches.

## 2. Connect Google and your MCP client

Setup runs quietly by default; add `--verbose` for the full detail or `--dry-run` to preview
without changes. It guides you in three steps:

1. Sign in: choose `Quick Connect (recommended, read-only, no indexing)` and sign in to Google
   in the browser. For full access, use `Custom OAuth (full access, indexing)` or
   `Service Account (full access, indexing)` with `Full (data + indexing)` access instead of
   `Read only (data only)`. Full access asks a separate confirmation before enabling writes.
2. Select the Search Console property: press Enter for the first one, pick numbers for an
   explicit allowlist, or choose `[0]` (or `all`) for all current and future properties, which
   warns and asks for a second confirmation.
3. Choose your MCP client (`desktop`, `code`, `cursor`, `codex`, `opencode`, `pi`, or JSON output).
   Review the preview and approve the client configuration when prompted. Setup preserves other
   MCP servers. OpenCode and Pi are configured globally only.

Read-only is the default. `--yes` accepts the defaults, so it never turns on write operations,
the sample query, or the agent skill install (both strictly opt-in).

Copy this prompt into an agent that can run terminal commands and configure MCP servers. The prompt is intentionally in English; complete Google sign-in yourself in the browser.

```text
Install @sonnivasquez/gsc-mcp globally with npm (or Bun if I prefer), then run gsc setup.
Use read-only Quick Connect. Help me sign in to Google, choose my Search Console property,
and connect this MCP to my client without removing other MCP servers. Never ask me to paste
credentials or tokens into chat. Verify with gsc doctor and tell me if I need to restart
my client. Do not run a Search Console query until I ask.
```

Quick Connect needs no Google Cloud setup and grants read-only access. For your own OAuth client, service-account access, or full access, see the [credentials guide](https://gscmcp.dev/docs/credentials). To set up a specific client, see [supported clients](https://gscmcp.dev/docs/clients).

## 3. Verify

```bash
gsc doctor
gsc auth status
```

`gsc doctor` checks the local runtime and configuration. `gsc auth status` shows the saved session. To validate access with a minimal request to Google, run:

```bash
gsc auth status --online
```

If your client does not show the MCP tools after setup, restart that client. The server provides **29 tools** for Search Console performance, comparisons, indexing, sitemaps, and reports. See the [tool catalog](tools.md).

## Update or uninstall

Updates never break a working install. If a major change requires migration, the tool performs it automatically with a backup of your configuration; it never asks you for manual steps.

The assisted path checks the registry, reinstalls, and verifies:

```bash
gsc update
```

To compare the installed version against the latest release without installing, run `gsc update --check`. `gsc doctor --online` reports the same comparison.

You can also install again with your preferred package manager to update:

```bash
npm install -g @sonnivasquez/gsc-mcp
```

With Bun, run `bun install -g @sonnivasquez/gsc-mcp`. After updating, check with `gsc --version` and **restart your MCP client**: the previous server keeps running until you restart it.

To stay on a specific version or roll back, pin the version:

```bash
npm install -g @sonnivasquez/gsc-mcp@1.0.0
```

Updating, pinning, or rolling back never touches your Google tokens, profiles, or client configurations. To remove the CLI, use `npm uninstall -g @sonnivasquez/gsc-mcp` or `bun remove -g @sonnivasquez/gsc-mcp`. Removing the package does not delete your local Google tokens either; see the [uninstall guide](https://gscmcp.dev/docs/uninstall) if you want to remove local data or revoke access too.

## More help

- [CLI command reference](https://gscmcp.dev/docs/commands)
- [Troubleshooting](https://gscmcp.dev/docs/troubleshooting)
- [Privacy and data handling](../PRIVACY.md)
