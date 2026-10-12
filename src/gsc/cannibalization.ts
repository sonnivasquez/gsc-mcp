import type { AnalyticsRow } from "./client.js";

export const CANNIBALIZATION_RULE_VERSION = "t12.1";

export interface CannibalizationCandidate {
  query: string;
  pages: Array<{ page: string; clicks: number; impressions: number; position: number; sharePct: number }>;
  totalImpressions: number;
  verdict: "candidate";
  temporalOverlap: "unknown";
}

export interface CannibalizationOpts {
  minPages?: number;
  minImpressionsPerPage?: number;
  minSharePct?: number;
}

// Queries served by several of your own pages in the observed rows.
// A candidate for editorial review — never an order to consolidate.
export function detectCannibalization(rows: AnalyticsRow[], opts: CannibalizationOpts = {}): CannibalizationCandidate[] {
  const minPages = opts.minPages ?? 2;
  const minImpressionsPerPage = opts.minImpressionsPerPage ?? 100;
  const minSharePct = opts.minSharePct ?? 20;
  const byQuery = new Map<string, AnalyticsRow[]>();
  for (const r of rows) {
    const q = r.keys[0] ?? "";
    const list = byQuery.get(q) ?? [];
    list.push(r);
    byQuery.set(q, list);
  }
  const out: CannibalizationCandidate[] = [];
  for (const [query, group] of byQuery) {
    if (group.length < minPages) continue;
    const total = group.reduce((s, r) => s + r.impressions, 0);
    const pages = group
      .filter((r) => r.impressions >= minImpressionsPerPage)
      .map((r) => ({
        page: r.keys[1] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
        sharePct: total > 0 ? Math.round((100 * r.impressions) / total) : 0,
      }))
      .filter((p) => p.sharePct >= minSharePct && p.page !== "");
    if (pages.length < minPages) continue;
    pages.sort((a, b) => a.position - b.position);
    out.push({ query, pages, totalImpressions: total, verdict: "candidate", temporalOverlap: "unknown" });
  }
  out.sort((a, b) => b.totalImpressions - a.totalImpressions);
  return out;
}
