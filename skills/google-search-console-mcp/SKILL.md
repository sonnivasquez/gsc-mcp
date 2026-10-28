---
name: google-search-console-mcp
description: "Trigger: Google Search Console, GSC, search analytics, SEO audit. Query the local gsc-mcp server with current gsc_* tools and safety gates."
license: Apache-2.0
metadata:
  author: "sonnivasquez"
  version: "1.1.0"
---

## Activation Contract

Use when the user asks about Search Console data: performance, queries,
pages, countries, devices, image search, index inspection, sitemaps,
content opportunities, traffic drops, or AI-conversation query evidence.
Do not use for general SEO advice without data; run the tools first.

## Hard Rules

- Invoke only `gsc_*` names from `references/tool-catalog.md` (34 tools).
  Never invent tool names or strip the prefix.
- Read-only by default: 23 `read` tools never mutate Google.
- `write` (`gsc_submit_url`, `gsc_submit_batch`, `gsc_submit_sitemap`)
  requires `GSC_ACCESS_MODE=full`. Without that variable, legacy configuration
  still needs `GSC_SCOPES=full` and `GSC_ENABLE_WRITE=1`. Check `doctor`
  (`write_ops`) first; never bypass the gate or infer permission to submit.
- `fetch` covers page, indexing, internal-link and migration audits and
  `gsc_image_page_audit`: website requests are bounded and authorized;
  referenced image files can be on external public hosts.
- `local` includes `gsc_export_dataset`, `gsc_generate_report` and
  `gsc_change_impact`. Exports and saved reports need `GSC_EXPORTS=1`;
  persistent change records and snapshots need independent `GSC_HISTORY=1`.
  Transient change analysis needs neither. Never infer consent to save or delete.
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
| Live HTML and exact-page queries | `gsc_page_audit` |
| Sitemap/index sample | `gsc_indexing_audit` |
| Bounded HTML link graph | `gsc_internal_link_audit` |
| Explicit change records and comparisons | `gsc_change_impact`; persistent actions need `GSC_HISTORY=1` |
| Declared route/domain mappings | `gsc_migration_audit` |

## Execution Steps

1. Call `gsc_capabilities`, then `gsc_list_sites` to fix the exact property.
2. Query with explicit dates (`last_7_days`, `last_28_days`,
   `last_90_days`, or `startDate`/`endDate`) and dimensions
   (`date,page,query,country,device,hour,searchAppearance`).
3. For `gsc_search_analytics`, use explicit `startDate` and `endDate`;
   `hour` and `hourly_all` require each other. Query `searchAppearance`
   alone, then filter a returned appearance with `equals` in a second query.
4. Page datasets via `gsc_get_dataset`; never re-query for pagination.
   Continue an audit explicitly with its own `nextCursor`; sessions expire
   after 15 idle minutes or server restart. Large saved history has a separate
   snapshot cursor. Reassemble each evidence format as in the catalog.
5. Report status, coverage, warnings and unknowns. Completion is not proof of
   complete coverage; HTTP-only audits cannot see client-rendered content.
   No scheduler, daemon, automatic captures or causal conclusions.

## Output Contract

Return: the exact numbers observed, the property and period, coverage and
status, and what the data cannot prove. Never speculate about causes.

## References

- `references/tool-catalog.md` — full 34-tool catalog with kinds and gates.
