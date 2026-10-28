import type { AnalyticsRow } from "./client.js";

export const CANNIBALIZATION_RULE_VERSION = "t12.1";

export interface CannibalizationCandidate {
  query: string;
  pages: Array<{ page: string; clicks: number; impressions: number; position: number; sharePct: number }>;
  totalImpressions: number;
  verdict: "candidate";
  temporalOverlap: "unknown";
  temporal?: TemporalEvidence;
  temporalAnalysisStatus?: "pending" | "analyzed" | "insufficient_data" | "error";
  temporalError?: string;
  temporalPendingReason?: "query_limit" | "request_budget";
  temporalCoverage?: { fetchedRows: number; truncated: boolean };
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

export interface TemporalEvidence {
  status: "insufficient_data" | "analyzed";
  observedDays: number;
  sameDayOverlap: string[];
  daily: Array<{ date: string; dominantUrl: string | null; pages: Array<{ page: string; clicks: number; impressions: number }> }>;
  sustainedChanges: Array<{ date: string; from: string; to: string }>;
  ruleVersion: "temporal.1";
}
// Coexistence is an observation within a date, never evidence of the same SERP.
export function temporalEvidence(rows: AnalyticsRow[], minDailyImpressions = 10): TemporalEvidence {
  const days = new Map<string, Array<{ page: string; clicks: number; impressions: number }>>();
  for (const r of rows) {
    if (r.impressions < minDailyImpressions) continue;
    const day = r.keys[0], page = r.keys[1];
    if (!day || !page) continue;
    const list = days.get(day) ?? []; list.push({ page, clicks: r.clicks, impressions: r.impressions }); days.set(day, list);
  }
  const daily = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, pages]) => {
    pages.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.page.localeCompare(b.page));
    const tied = pages.length > 1 && pages[0].clicks === pages[1].clicks && pages[0].impressions === pages[1].impressions;
    return { date, dominantUrl: tied ? null : pages[0].page, pages };
  });
  const sustainedChanges: TemporalEvidence["sustainedChanges"] = [];
  let stable: string | null = null;
  for (let i = 2; i < daily.length; i++) {
    const triplet = daily.slice(i - 2, i + 1);
    if (triplet[0].dominantUrl && triplet.every((d) => d.dominantUrl === triplet[0].dominantUrl) && Date.parse(triplet[1].date) - Date.parse(triplet[0].date) === 86400000 && Date.parse(triplet[2].date) - Date.parse(triplet[1].date) === 86400000) {
      if (stable && stable !== triplet[0].dominantUrl) sustainedChanges.push({ date: triplet[0].date, from: stable, to: triplet[0].dominantUrl });
      stable = triplet[0].dominantUrl;
    }
  }
  const enough = daily.length >= 7;
  return { status: enough ? "analyzed" : "insufficient_data", observedDays: daily.length, sameDayOverlap: daily.filter((d) => d.pages.length > 1).map((d) => d.date), daily, sustainedChanges: enough ? sustainedChanges : [], ruleVersion: "temporal.1" };
}
