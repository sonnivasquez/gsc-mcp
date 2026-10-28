# gsc-mcp tool catalog (34 tools, single `gsc_*` catalog)

Source of truth: `src/gsc/catalog.ts` (`CANONICAL_TOOLS`) and `src/server.ts`.
Every public name carries the `gsc_*` prefix. Never invoke a retired name
without that prefix.

## Kinds and gates

- `read` (23): read-only Google queries or local capability/dataset reads. No mutation.
- `write` (3): mutates Google. Requires `GSC_ACCESS_MODE=full`. Without the new
  variable, legacy `GSC_SCOPES=full` and `GSC_ENABLE_WRITE=1` still apply.
  Verify with `doctor` (`write_ops`); obtain user authorization before submission.
- `fetch` (5): downloads the user's own pages and image bytes.
- `local` (3): writes to the user's machine only. `gsc_export_dataset`
  additionally needs `GSC_EXPORTS=1`; it never overwrites, never uploads.

## Catalog

| Tool | Kind | Role |
|---|---|---|
| `gsc_page_audit` | fetch | Current HTTP HTML plus exact-page GSC queries; no JavaScript. |
| `gsc_indexing_audit` | fetch | Sitemap discovery and indexed-view samples, explicit batches. |
| `gsc_internal_link_audit` | fetch | Bounded link graph; observed incoming links and literal suggestions. |
| `gsc_change_impact` | local | record/list/analyze/delete; GSC_HISTORY=1 for persistence, no scheduler. |
| `gsc_migration_audit` | fetch | Explicit old/new mappings across authorized properties. |
| `gsc_capabilities` | read | Abilities, auth, limits. Offline, no credentials needed. |
| `gsc_list_sites` | read | Properties visible to this instance (allowlist-filtered). |
| `gsc_search_analytics` | read | Flexible query: dims `date,page,query,country,device,hour,searchAppearance`; `hour` pairs with `hourly_all`, appearance groups alone. Public `searchType` maps to provider `type`; optional `aggregationType`. Returns `datasetId`. |
| `gsc_inspect_urls` | read | Index inspection, 1–10 URLs, stable order, partial results. |
| `gsc_list_sitemaps` | read | Registered sitemaps. Never submits. |
| `gsc_get_dataset` | read | Pages a previous result. Zero new Google calls. TTL 15 min, per profile. |
| `gsc_performance_overview` | read | Aggregate-row totals plus `date` timeline and optional comparison. |
| `gsc_compare_periods` | read | Full join: `compared`, `not_observed_in_current`, `not_observed_in_baseline`. |
| `gsc_page_queries` | read | Observed queries for one exact page URL. |
| `gsc_query_pages` | read | Observed pages for one exact query. |
| `gsc_find_opportunities` | read | Candidates by transparent versioned rule. |
| `gsc_detect_cannibalization` | read | Queries served by several own pages; candidates only. |
| `gsc_analyze_segments` | read | Caller-defined segment comparison over one dataset. |
| `gsc_export_dataset` | local | Local export (json/csv/markdown). Needs `GSC_EXPORTS=1`. |
| `gsc_analyze_traffic_drop` | read | Signals, hypotheses, missing evidence. Correlation is not causation. |
| `gsc_content_decay` | read | Three-window decline candidates, web or image. |
| `gsc_check_alerts` | read | On-demand rule evaluation with stable ids. |
| `gsc_content_candidates` | read | Observed queries at weak positions. |
| `gsc_content_recommendations` | read | Prioritized candidates with evidence. |
| `gsc_multi_site_overview` | read | Per-property health, isolated failures. |
| `gsc_generate_report` | local | Deterministic markdown report; save is export-gated. |
| `gsc_verify_claim` | read | `verified` / `contradicted` / `unverifiable` with tolerance. |
| `gsc_compare_web_image` | read | Web vs image join by key. |
| `gsc_submit_url` | write | Indexing API single submit. Gated. |
| `gsc_submit_batch` | write | Indexing API batch submit (max 200). Gated. |
| `gsc_submit_sitemap` | write | Sitemap submission. Gated. |
| `gsc_genai_conversation_queries` | read | AI-conversation exhaust in query data. Read-only analysis. |
| `gsc_image_page_audit` | fetch | On-page image audit of the user's own URLs. |
| `gsc_check_update_impact` | read | Drop window vs confirmed ranking updates; temporal coincidence only, never causal. |

## Response envelope

`status`: `ok` | `partial` (batch with failures) | `error` (total
failure). Stable error codes include `AUTH_REQUIRED`, `PROPERTY_NOT_ALLOWED`,
`INVALID_ARGUMENT`, `DATASET_EXPIRED`/`DATASET_NOT_FOUND`, each with
`retryable` and a suggested action.

## Audit contracts

All audits run only on request. Follow nextCursor explicitly; sessions expire
after 15 idle minutes or process exit. HTML is not JavaScript-rendered.
Results preview 20 array elements and 2000 characters per string. Retrieve
full evidence with gsc_get_dataset: group index, sort part, concatenate evidence,
then JSON.parse. Search analytics adds hour + hourly_all, and searchAppearance
alone followed by a filtered query. Cannibalization optionally adds
includeTimeline, timelineQueryLimit and minDailyImpressions; candidates only.

History list with changeId streams large snapshots as bounded base64 byte chunks
(snapshotChunk, nextCursor), independent of the transient dataset quota. Decode
blocks, group snapshotId, concatenate by offset, then decode UTF-8 and JSON.parse.
Small history remains snapshots + dataset. Partial audit errors survive continuation.
Temporal cannibalization uses evidenceBase64 parts in its dataset; reconstruct
by index and part, base64-decode and JSON.parse. meta.coverage describes previews.
