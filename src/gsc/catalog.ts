export type CapabilityKind = "read" | "write" | "fetch" | "local";

export interface CapabilityInfo {
  name: string;
  description: string;
  kind: CapabilityKind;
}

export const CANONICAL_TOOLS: CapabilityInfo[] = [
  { name: "gsc_page_audit", description: "Live HTML and exact-page GSC evidence; on demand, no JavaScript rendering.", kind: "fetch" },
  { name: "gsc_indexing_audit", description: "Sitemap discovery and sampled indexed-state inspection in explicit batches.", kind: "fetch" },
  { name: "gsc_internal_link_audit", description: "Bounded website link graph with observed incoming links and evidence-backed suggestions.", kind: "fetch" },
  { name: "gsc_change_impact", description: "On-demand before/after analysis; explicit history actions require GSC_HISTORY=1.", kind: "local" },
  { name: "gsc_migration_audit", description: "Explicit route/domain migration map audit; current HTTP and historical GSC evidence.", kind: "fetch" },
  { name: "gsc_capabilities", description: "What this server can do, its auth state and limits. Works offline.", kind: "read" },
  { name: "gsc_list_sites", description: "GSC properties visible to this instance.", kind: "read" },
  { name: "gsc_search_analytics", description: "Flexible performance query with explicit coverage.", kind: "read" },
  { name: "gsc_inspect_urls", description: "Index inspection for 1-10 URLs with per-URL results.", kind: "read" },
  { name: "gsc_list_sitemaps", description: "Registered sitemaps and their reported states.", kind: "read" },
  { name: "gsc_get_dataset", description: "Page through a previous result with zero new Google calls.", kind: "read" },
  { name: "gsc_performance_overview", description: "Totals, timeline and optional comparison for a site.", kind: "read" },
  { name: "gsc_compare_periods", description: "Deterministic period comparison with observed/absent blocks.", kind: "read" },
  { name: "gsc_page_queries", description: "Observed queries for one exact page URL.", kind: "read" },
  { name: "gsc_query_pages", description: "Observed pages for one exact query.", kind: "read" },
  { name: "gsc_find_opportunities", description: "Review candidates by transparent versioned rule.", kind: "read" },
  { name: "gsc_detect_cannibalization", description: "Queries served by several own pages; candidates only.", kind: "read" },
  { name: "gsc_analyze_segments", description: "Caller-defined segment comparison over one dataset.", kind: "read" },
  { name: "gsc_export_dataset", description: "Local export of a previous dataset; opt-in, never uploads.", kind: "local" },
  { name: "gsc_analyze_traffic_drop", description: "Drop decomposition: signals, hypotheses, missing evidence.", kind: "read" },
  { name: "gsc_content_decay", description: "Three-window decline candidates, web or image.", kind: "read" },
  { name: "gsc_check_alerts", description: "On-demand rule evaluation with stable ids.", kind: "read" },
  { name: "gsc_content_candidates", description: "Observed queries at weak positions.", kind: "read" },
  { name: "gsc_content_recommendations", description: "Prioritized candidates with evidence.", kind: "read" },
  { name: "gsc_multi_site_overview", description: "Per-property health, isolated failures.", kind: "read" },
  { name: "gsc_generate_report", description: "Deterministic markdown report.", kind: "local" },
  { name: "gsc_verify_claim", description: "Verified, contradicted or unverifiable.", kind: "read" },
  { name: "gsc_compare_web_image", description: "Web vs image join by key.", kind: "read" },
  { name: "gsc_submit_url", description: "Indexing API single submit. Requires full scope plus explicit enablement.", kind: "write" },
  { name: "gsc_submit_batch", description: "Indexing API batch submit. Requires full scope plus explicit enablement.", kind: "write" },
  { name: "gsc_submit_sitemap", description: "Sitemap submission. Requires full scope plus explicit enablement.", kind: "write" },
  { name: "gsc_genai_conversation_queries", description: "AI-conversation exhaust in query data. Read-only analysis.", kind: "read" },
  { name: "gsc_image_page_audit", description: "On-page image audit of your own URLs. Fetches pages and image bytes.", kind: "fetch" },
  { name: "gsc_check_update_impact", description: "Drop window vs confirmed ranking updates; temporal coincidence only.", kind: "read" },
];

