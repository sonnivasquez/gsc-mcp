---
name: google-search-console-mcp
description: "Trigger: Google Search Console, GSC, search analytics, SEO audit. Query the local gsc-mcp server with current gsc_* tools and safety gates."
license: Apache-2.0
metadata:
  author: "sonnivasquez"
  version: "1.0"
---

## Activation Contract

Use when the user asks about Search Console data: performance, queries,
pages, countries, devices, image search, index inspection, sitemaps,
content opportunities, traffic drops, or AI-conversation query evidence.
Do not use for general SEO advice without data; run the tools first.

## Hard Rules

- Invoke only `gsc_*` names from `references/tool-catalog.md` (29 tools).
  Never invent tool names or strip the prefix.
- Read-only by default: 23 `read` tools never mutate Google.
- `write` (`gsc_submit_url`, `gsc_submit_batch`, `gsc_submit_sitemap`)
  requires `GSC_ACCESS_MODE=full`. Without that variable, legacy configuration
  still needs `GSC_SCOPES=full` and `GSC_ENABLE_WRITE=1`. Check `doctor`
  (`write_ops`) first; never bypass the gate or infer permission to submit.
- `fetch` (`gsc_image_page_audit`) downloads only the user's own pages
  and image bytes. `local` (`gsc_export_dataset`, `gsc_generate_report`)
  writes only to the user's machine; export needs `GSC_EXPORTS=1`,
  never overwrites, never uploads.
- Use exact property IDs (`sc-domain:example.com` or the exact URL-prefix
  identifier returned by `gsc_list_sites`). Respect the instance allowlist.
- Evidence discipline: analyze only returned rows; absent rows are not
  zeros; cannibalization findings are candidates; update-impact overlap
  is temporal coincidence, never causal; `position` is an
  impression-weighted average, prefer deltas; `ctr` is a 0..1 fraction.

## Decision Gates

| Need | Action |
|------|--------|
| Server abilities, auth, limits | `gsc_capabilities` (offline, no credentials needed) |
| Which properties are visible | `gsc_list_sites` |
| Totals, timeline, comparison | `gsc_performance_overview`, `gsc_compare_periods` |
| Query/page drill-down | `gsc_page_queries`, `gsc_query_pages`, `gsc_search_analytics` |
| Opportunities, decay, alerts, segments | `gsc_find_opportunities`, `gsc_content_decay`, `gsc_check_alerts`, `gsc_analyze_segments` |
| Index or sitemaps | `gsc_inspect_urls`, `gsc_list_sitemaps` |
| Large results | Page with `gsc_get_dataset` (`datasetId`, zero new Google calls) |
| Request indexing or send a sitemap | Gated `gsc_submit_url`, `gsc_submit_batch`, `gsc_submit_sitemap` with full access and explicit user authorization |
| Image page diagnosis | `gsc_image_page_audit` on allowlisted URLs |

## Execution Steps

1. Call `gsc_capabilities`, then `gsc_list_sites` to fix the exact property.
2. Query with explicit dates (`last_7_days`, `last_28_days`,
   `last_90_days`, or `startDate`/`endDate`) and dimensions
   (`date,page,query,country,device`).
3. Page large outputs via `gsc_get_dataset`; never re-query for pagination.
4. State coverage, status (`ok`/`partial`/`error`), and missing evidence.

## Output Contract

Return: the exact numbers observed, the property and period, coverage and
status, and what the data cannot prove. Never speculate about causes.

## References

- `references/tool-catalog.md` — full 29-tool catalog with kinds and gates.
