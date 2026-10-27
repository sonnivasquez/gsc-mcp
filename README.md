# Google Search Console MCP server

[![npm version](https://img.shields.io/npm/v/@sonnivasquez/gsc-mcp)](https://www.npmjs.com/package/@sonnivasquez/gsc-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sonnivasquez/gsc-mcp)](https://github.com/sonnivasquez/gsc-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-placeholder-lightgrey)](https://registry.modelcontextprotocol.io/)

<!-- TODO: uncomment the Glama score badge after this server is listed on Glama.
[![Glama score](https://glama.ai/mcp/servers/io.github.sonnivasquez/gsc-mcp/badges/score.svg)](https://glama.ai/mcp/servers/io.github.sonnivasquez/gsc-mcp)
-->

<!-- TODO: add screenshots/demo.gif and switch the preview below to that file. The PNG stays until the GIF exists. -->

![Google Search Console MCP server](<screenshots/google search console MCP.png>)

Google Search Console MCP server. Compare search performance, find SEO opportunities, and check URL indexing status from your AI assistant using your own Google Search Console data.

GSC MCP is an open-source MCP server by [Sonni Vasquez](https://github.com/sonnivasquez). It runs locally over stdio with Node.js or Bun and provides 29 tools. Google API requests run from your machine, with read-only Google access by default and access limited to the properties you select.

[Website](https://gscmcp.dev/) · [npm package](https://www.npmjs.com/package/@sonnivasquez/gsc-mcp) · [Quickstart](docs/quickstart.md) · [Guía en español](docs/quickstart.es.md) · [Tool catalog](docs/tools.md)

This is an independent project, not an official Google product.

## Install with npx

The buttons and snippets below start the local stdio server with `npx -y @sonnivasquez/gsc-mcp`. They set `GSC_AUTH_MODE=oauth` and `GSC_ACCESS_MODE=readonly`. They do not sign you in to Google and they do not choose a property. Node.js 22 or newer is required. After the client starts the server, set `GSC_SITE_URLS` to your Search Console property and run `gsc auth login` or `gsc setup`. Quick Connect uses the shared read-only OAuth client shipped in this package, so you do not create a Google Cloud project for that path.

[![Install in Cursor](https://img.shields.io/badge/Install%20in-Cursor-000000)](cursor://anysphere.cursor-deeplink/mcp/install?name=gsc-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzb25uaXZhc3F1ZXovZ3NjLW1jcCJdLCJlbnYiOnsiR1NDX0FVVEhfTU9ERSI6Im9hdXRoIiwiR1NDX0FDQ0VTU19NT0RFIjoicmVhZG9ubHkifX0%3D)
[![Install in VS Code](https://img.shields.io/badge/Install%20in-VS%20Code-0098FF)](vscode:mcp/install?%7B%22name%22%3A%22gsc-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40sonnivasquez%2Fgsc-mcp%22%5D%2C%22env%22%3A%7B%22GSC_AUTH_MODE%22%3A%22oauth%22%2C%22GSC_ACCESS_MODE%22%3A%22readonly%22%7D%7D)

### Claude Code

Replace `sc-domain:example.com` with your Search Console property id:

```bash
claude mcp add gsc-mcp -e GSC_AUTH_MODE=oauth -e GSC_ACCESS_MODE=readonly -e GSC_SITE_URLS=sc-domain:example.com -- npx -y @sonnivasquez/gsc-mcp
```

### JSON config

Same command, for a client that reads `mcpServers`. Replace the example property:

```json
{
  "mcpServers": {
    "gsc-mcp": {
      "command": "npx",
      "args": ["-y", "@sonnivasquez/gsc-mcp"],
      "env": {
        "GSC_AUTH_MODE": "oauth",
        "GSC_ACCESS_MODE": "readonly",
        "GSC_SITE_URLS": "sc-domain:example.com"
      }
    }
  }
}
```

## Why this one

Quick Connect is the path that skips creating a Google Cloud OAuth client. Custom OAuth and service accounts in this same server still use credentials you create. Both paths run locally.

| | Quick Connect in this server | Your own Google credentials |
|---|---|---|
| Google Cloud project | Not required. This package ships a shared read-only OAuth client. | Custom OAuth needs your client (`GSC_OAUTH_SECRETS_FILE`, or `GSC_OAUTH_CLIENT_ID` plus `GSC_OAUTH_CLIENT_SECRET`). A service account needs `GSC_KEY_FILE`. |
| Where it runs | Local stdio process. Google API requests run from your machine. | Same local process. |
| Default access | Read-only. Setup refuses full access for Quick Connect. | Read-only unless `GSC_ACCESS_MODE=full`. That mode enables `gsc_submit_url`, `gsc_submit_batch`, and `gsc_submit_sitemap`. |
| Tools | 29 `gsc_*` tools registered by the server. | The same 29 tools. |
| Also registered here | `gsc_genai_conversation_queries`, `gsc_check_update_impact`, and `gsc_image_page_audit`. | The same tools. |

`gsc_genai_conversation_queries` reads AI-conversation exhaust in query data. `gsc_check_update_impact` compares a drop window with confirmed ranking updates and reports temporal coincidence only. `gsc_image_page_audit` fetches your own pages and their image bytes.

## What you can do

| SEO task | What GSC MCP returns | Example tools |
|---|---|---|
| Understand a traffic change | Clicks, impressions, CTR, average position and period comparisons by page or query | `gsc_performance_overview`, `gsc_compare_periods`, `gsc_analyze_traffic_drop` |
| Prioritize pages and queries | Candidates with low CTR, weak positions or declining traffic, using explicit thresholds | `gsc_find_opportunities`, `gsc_content_decay` |
| Review competing pages | Queries served by multiple pages on your site, with evidence for editorial review | `gsc_detect_cannibalization`, `gsc_query_pages` |
| Inspect indexing and sitemaps | Google's indexed view of selected URLs and registered sitemap states | `gsc_inspect_urls`, `gsc_list_sitemaps` |
| Compare segments | Brand terms, site folders, countries, devices, or web versus image search | `gsc_analyze_segments`, `gsc_compare_web_image` |
| Audit on-page images | Findings from downloading your own pages and their referenced images | `gsc_image_page_audit` |
| Prepare reports | Markdown reports and optional local dataset exports | `gsc_generate_report`, `gsc_export_dataset` |

These are analysis tools. Opportunity and cannibalization results are candidates to review, not proof that a particular SEO change will improve rankings.

## Get started

You need **Node.js 22 or newer**, npm or Bun, and a Google account with access to a Search Console property. Bun can install the package and run the MCP server; the global `gsc` CLI still requires Node.js.

```bash
npm install -g @sonnivasquez/gsc-mcp
gsc setup
```

Setup guides you through:

1. **Sign in to Google.** Choose read-only Quick Connect, or use your own OAuth client or a service account.
2. **Choose properties.** Select the Search Console properties this server may access.
3. **Connect your client.** Review and approve the configuration preview. Setup preserves other MCP servers.

Quick Connect uses a shared Desktop OAuth application and needs no Google Cloud project setup. Complete Google sign-in in your browser. Never paste passwords, OAuth credentials or tokens into an AI chat.

Check your local installation and saved authentication state:

```bash
gsc doctor
gsc auth status
```

To check access with a minimal request to Google, run `gsc auth status --online`. Restart your MCP client if the tools do not appear.

### Other installation options

With Bun as the package manager:

```bash
bun install -g @sonnivasquez/gsc-mcp
gsc setup
```

The shell installer installs the latest package globally and opens setup. It uses npm by default and does not use `sudo`:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh
```

To use Bun with the installer:

```bash
curl -fsSL https://gscmcp.dev/install.sh | sh -s -- --manager bun
```

[Read the installer](https://gscmcp.dev/install.sh) or follow the [quickstart](docs/quickstart.md) for details.

### Supported clients

Guided setup supports Claude Desktop, Claude Code, Cursor, Codex, OpenCode and Pi. It can also print JSON for another compatible MCP client. GSC MCP uses **local stdio**, so the client must support launching a local server.

See [client setup instructions](https://gscmcp.dev/docs/clients). Use `gsc setup --dry-run` to preview changes or `gsc setup --verbose` for configuration details. OpenCode and Pi configuration is global.

### Install with your AI agent

Copy this prompt into an agent that can run terminal commands. You complete Google sign-in yourself:

```text
Install @sonnivasquez/gsc-mcp globally with npm, or Bun if I prefer, then run gsc setup.
Use read-only Quick Connect. Help me sign in to Google, choose my Search Console
properties and connect my MCP client while preserving other MCP servers.
Never ask me to paste credentials or tokens into chat. Verify with gsc doctor
and tell me whether I need to restart my client. Do not query Search Console
until I ask.
```

## Try it with your site

After setup, ask your assistant to list the properties it can access. Use an exact property identifier such as `sc-domain:example.com` or `https://example.com/` in subsequent requests.

The prompts below are examples, not measured results:

```text
For sc-domain:example.com, compare the last 28 days with the previous period.
Show the pages with the largest observed click losses, including impressions,
CTR and average position. State the dates and coverage of the returned data.
```

```text
Find queries for sc-domain:example.com with at least 500 impressions and CTR
below 2% in the last 28 days. Show their ranking pages and prioritize candidates
for a title and snippet review. Do not edit the site.
```

```text
Inspect these three URLs on my selected property and show Google's indexed
status for each. Then list its registered sitemaps. Do not submit anything.
```

You can also ask for pages with sustained traffic declines, query overlap across your own pages, brand versus non-brand segments, or a Markdown performance report. Saving reports and exporting datasets require `GSC_EXPORTS=1` in your MCP client's server environment. Restart the client after changing that environment.

## Authentication and access

| Connection | Requirements | Access |
|---|---|---|
| Quick Connect | Browser sign-in with a Google account that can access the property | Read-only, using the shared OAuth application |
| Custom OAuth | Your own Google Cloud OAuth client and browser sign-in | Read-only, or full access after explicit configuration |
| Service account | Your own credentials file and permissions for the property | Read-only, or full access after explicit configuration |

Read-only access blocks Google write operations. Full access uses `GSC_ACCESS_MODE=full` and enables sitemap submission and eligible Indexing API URL notifications. Setup asks for separate confirmation before enabling writes. Quick Connect does not support full access.

URL Inspection reads Google's indexed view; it does not request indexing. Indexing API submissions have eligibility and permission requirements and do not guarantee indexing. See the [credentials guide](https://gscmcp.dev/docs/credentials) and [tool catalog](docs/tools.md) before enabling writes.

Choosing all properties also includes future properties and requires an explicit confirmation. Setup's `--yes` option does not enable writes, a sample query, or the optional agent skill.

## Privacy and data limits

GSC MCP has no hosted MCP backend or product telemetry. OAuth tokens stay in your local data directory, `~/.gsc-mcp/` by default, or `GSC_DATA_DIR`. Quick Connect shares an OAuth application and its Google API quotas; it does not share your tokens or property access with the maintainer.

The optional image audit also downloads your selected pages and their referenced image files directly, including images served by external hosts.

Tool responses go to your MCP client and may be sent to its AI provider. Local execution does not mean your Search Console data stays entirely on your machine. Review your client's retention and training settings and the [privacy policy](PRIVACY.md).

When interpreting results:

- Date presets such as `last_28_days` end three days before today in Pacific Time. This is a conservative product default, not a guarantee of Google's data availability.
- Search Console returns limited rows and coverage. Missing rows are not necessarily zero traffic.
- Average position is an impression-weighted average, not a live rank tracker.
- Traffic drops and overlap with Google updates do not establish causation.
- URL Inspection does not trigger a live crawl or guarantee indexing.
- Alerts run on demand; GSC MCP does not continuously monitor your site.

## Update or uninstall

Check for a newer release without installing it:

```bash
gsc update --check
```

Run `gsc update` for an assisted reinstall and verification, or reinstall with your package manager. Check `gsc --version` and restart your MCP client after updating.

Uninstall with `npm uninstall -g @sonnivasquez/gsc-mcp` or `bun remove -g @sonnivasquez/gsc-mcp`. Removing the package does not revoke Google access or delete saved tokens. Follow the [uninstall guide](https://gscmcp.dev/docs/uninstall) to remove local data or revoke access.

## Documentation

- [Quickstart](docs/quickstart.md) · [Guía rápida en español](docs/quickstart.es.md)
- [Tool catalog and response contracts](docs/tools.md)
- [Credentials and permissions](https://gscmcp.dev/docs/credentials)
- [Supported clients](https://gscmcp.dev/docs/clients)
- [CLI commands](https://gscmcp.dev/docs/commands)
- [Troubleshooting](https://gscmcp.dev/docs/troubleshooting)
- [Privacy](PRIVACY.md) · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

## Development

```bash
npm ci
npm run typecheck:node
npm run test:node
```

For Bun, build with `bun run build` and run `bun --test test`. The package includes an optional [Google Search Console MCP agent skill](skills/google-search-console-mcp/SKILL.md), available from setup with `--install-skill`.

## License and attribution

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for base-project attribution. Maintained by [Sonni Vasquez](https://github.com/sonnivasquez).

If this server helps, star the repo: https://github.com/sonnivasquez/gsc-mcp
