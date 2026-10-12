import type { AnalyticsRow } from "./client.js";

export type Observation = "observed_in_both" | "not_observed_in_current" | "not_observed_in_baseline";

export interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ComparedRow {
  key: string;
  observation: Observation;
  current: Metrics | null;
  baseline: Metrics | null;
  deltaClicks: number | null;
  deltaClicksPct: number | null;
  deltaClicksPctReason?: "ZERO_BASELINE";
  deltaImpressions: number | null;
  deltaImpressionsPct: number | null;
  deltaImpressionsPctReason?: "ZERO_BASELINE";
  deltaCtrPp: number | null;
  deltaPosition: number | null;
  positionImprovement: number | null;
}

export interface Comparison {
  compared: ComparedRow[];
  notObservedInCurrent: ComparedRow[];
  notObservedInBaseline: ComparedRow[];
}

export type CompareOrder = "deltaClicks" | "deltaImpressions" | "deltaCtrPp" | "positionImprovement";

function pct(current: number, baseline: number): { value: number | null; zeroBaseline: boolean } {
  if (baseline <= 0) return { value: null, zeroBaseline: true };
  return { value: (100 * (current - baseline)) / baseline, zeroBaseline: false };
}

function comparePair(key: string, current: Metrics | null, baseline: Metrics | null): ComparedRow {
  if (current !== null && baseline !== null) {
    const clicks = pct(current.clicks, baseline.clicks);
    const impressions = pct(current.impressions, baseline.impressions);
    return {
      key,
      observation: "observed_in_both",
      current,
      baseline,
      deltaClicks: current.clicks - baseline.clicks,
      deltaClicksPct: clicks.value,
      ...(clicks.zeroBaseline ? { deltaClicksPctReason: "ZERO_BASELINE" as const } : {}),
      deltaImpressions: current.impressions - baseline.impressions,
      deltaImpressionsPct: impressions.value,
      ...(impressions.zeroBaseline ? { deltaImpressionsPctReason: "ZERO_BASELINE" as const } : {}),
      deltaCtrPp: 100 * (current.ctr - baseline.ctr),
      deltaPosition: current.position - baseline.position,
      positionImprovement: baseline.position - current.position,
    };
  }
  const empty: Pick<ComparedRow, "deltaClicks" | "deltaClicksPct" | "deltaImpressions" | "deltaImpressionsPct" | "deltaCtrPp" | "deltaPosition" | "positionImprovement"> = {
    deltaClicks: null,
    deltaClicksPct: null,
    deltaImpressions: null,
    deltaImpressionsPct: null,
    deltaCtrPp: null,
    deltaPosition: null,
    positionImprovement: null,
  };
  return {
    key,
    observation: current === null ? "not_observed_in_current" : "not_observed_in_baseline",
    current,
    baseline,
    ...empty,
  };
}

// Full outer join on the complete dimension key. Absence is preserved as
// absence with null metrics — never silently converted to zero.
export function comparePeriods(
  currentRows: AnalyticsRow[],
  baselineRows: AnalyticsRow[],
  orderBy: CompareOrder = "deltaClicks",
  direction: "asc" | "desc" = "asc"
): Comparison {
  const keyOf = (r: AnalyticsRow): string => r.keys.join(String.fromCharCode(0));
  const toMetrics = (r: AnalyticsRow): Metrics => ({
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  });
  const current = new Map(currentRows.map((r) => [keyOf(r), toMetrics(r)]));
  const baseline = new Map(baselineRows.map((r) => [keyOf(r), toMetrics(r)]));
  const compared: ComparedRow[] = [];
  const notObservedInCurrent: ComparedRow[] = [];
  const notObservedInBaseline: ComparedRow[] = [];
  for (const [key, c] of current) {
    const b = baseline.get(key) ?? null;
    const row = comparePair(key, c, b);
    if (row.observation === "observed_in_both") compared.push(row);
    else notObservedInBaseline.push(row);
  }
  for (const [key, b] of baseline) {
    if (!current.has(key)) notObservedInCurrent.push(comparePair(key, null, b));
  }
  const dir = direction === "asc" ? 1 : -1;
  compared.sort((a, b) => {
    const av = a[orderBy] ?? Number.POSITIVE_INFINITY;
    const bv = b[orderBy] ?? Number.POSITIVE_INFINITY;
    if (av !== bv) return (av - bv) * dir;
    return a.key < b.key ? -1 : 1;
  });
  return { compared, notObservedInCurrent, notObservedInBaseline };
}

export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

// Totals come from sums, never from averaging ratios: CTR is sum(clicks) /
// sum(impressions), position is impression-weighted. Null denominator → null.
export function sumTotals(rows: AnalyticsRow[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let posWeight = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeight += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? posWeight / impressions : null,
  };
}
