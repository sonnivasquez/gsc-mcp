import { GscError } from "./errors.js";
import type { AnalyticsRow } from "./client.js";

export const OPPORTUNITY_RULE_VERSION = "t11.1";

export type OpportunityKind = "low_ctr" | "striking_distance" | "declining" | "ctr_benchmark" | "low_clicks";

export interface Opportunity {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  reason: string;
  scenarioExtraClicks?: number;
}

export interface OpportunityResult {
  kind: OpportunityKind;
  ruleVersion: string;
  thresholds: Record<string, number | string>;
  candidates: Opportunity[];
  limitation: string;
}

function orderByImpressions(a: Opportunity, b: Opportunity): number {
  if (b.impressions !== a.impressions) return b.impressions - a.impressions;
  return a.key < b.key ? -1 : 1;
}

function asOpportunity(r: AnalyticsRow, reason: string, scenarioExtraClicks?: number): Opportunity {
  return {
    key: r.keys.join(" "),
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 10000) / 100,
    position: Math.round(r.position * 10) / 10,
    reason,
    ...(scenarioExtraClicks !== undefined ? { scenarioExtraClicks } : {}),
  };
}

export interface LowCtrOpts {
  minImpressions?: number;
  minPosition?: number;
  maxPosition?: number;
  maxCtr?: number;
  targetCtr?: number;
}

// Rows with volume and visibility whose CTR trails a configurable bar.
// No uplift is estimated unless targetCtr is given, and then only as a
// conditional scenario — never a forecast.
export function lowCtr(rows: AnalyticsRow[], opts: LowCtrOpts = {}): OpportunityResult {
  const minImpressions = opts.minImpressions ?? 200;
  const minPosition = opts.minPosition ?? 4;
  const maxPosition = opts.maxPosition ?? 15;
  const maxCtr = opts.maxCtr ?? 0.02;
  const candidates = rows
    .filter((r) => r.impressions >= minImpressions && r.position >= minPosition && r.position <= maxPosition && r.ctr < maxCtr)
    .map((r) =>
      asOpportunity(
        r,
        `CTR ${(r.ctr * 100).toFixed(2)}% below ${(maxCtr * 100).toFixed(2)}% at position ${r.position.toFixed(1)}`,
        opts.targetCtr !== undefined ? Math.max(0, Math.round(r.impressions * (opts.targetCtr - r.ctr))) : undefined
      )
    )
    .sort(orderByImpressions);
  return {
    kind: "low_ctr",
    ruleVersion: OPPORTUNITY_RULE_VERSION,
    thresholds: { minImpressions, minPosition, maxPosition, maxCtr, ...(opts.targetCtr !== undefined ? { targetCtr: opts.targetCtr } : {}) },
    candidates,
    limitation: opts.targetCtr === undefined
      ? "No click recovery is estimated without an explicit targetCtr."
      : "scenarioExtraClicks is a conditional arithmetic scenario for the given targetCtr, not a traffic forecast.",
  };
}

export interface StrikingDistanceOpts {
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
}

// Historical average position near page one — not a live SERP rank.
export function strikingDistance(rows: AnalyticsRow[], opts: StrikingDistanceOpts = {}): OpportunityResult {
  const minPosition = opts.minPosition ?? 8;
  const maxPosition = opts.maxPosition ?? 20;
  const minImpressions = opts.minImpressions ?? 100;
  const candidates = rows
    .filter((r) => r.position >= minPosition && r.position <= maxPosition && r.impressions >= minImpressions)
    .map((r) => asOpportunity(r, `average position ${r.position.toFixed(1)} with ${r.impressions} impressions`))
    .sort(orderByImpressions);
  return {
    kind: "striking_distance",
    ruleVersion: OPPORTUNITY_RULE_VERSION,
    thresholds: { minPosition, maxPosition, minImpressions },
    candidates,
    limitation: "Position is a historical impression-weighted average, not the current rank of any SERP.",
  };
}

export interface DecliningOpts {
  windowDays?: number;
  minBaseClicks?: number;
  minDeclinePct?: number;
}

// Three comparable windows, two consecutive qualifying drops. Anything less
// is INSUFFICIENT_DATA, never a "sustained decline".
export function declining(
  windows: [AnalyticsRow[], AnalyticsRow[], AnalyticsRow[]],
  opts: DecliningOpts = {}
): OpportunityResult {
  const windowDays = opts.windowDays ?? 28;
  const minBaseClicks = opts.minBaseClicks ?? 50;
  const minDeclinePct = opts.minDeclinePct ?? 20;
  const byKey = (rows: AnalyticsRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.keys.join(" "), (m.get(r.keys.join(" ")) ?? 0) + r.clicks);
    return m;
  };
  const middle = byKey(windows[1]);
  const oldest = byKey(windows[2]);
  const recentAcc = new Map<string, { clicks: number; impressions: number; positionWeight: number }>();
  for (const r of windows[0]) {
    const key = r.keys.join(" ");
    const acc = recentAcc.get(key) ?? { clicks: 0, impressions: 0, positionWeight: 0 };
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    acc.positionWeight += r.position * r.impressions;
    recentAcc.set(key, acc);
  }
  const candidates: Opportunity[] = [];
  for (const [key, oldClicks] of oldest) {
    const midClicks = middle.get(key);
    const acc = recentAcc.get(key);
    if (midClicks === undefined || acc === undefined || oldClicks < minBaseClicks) continue;
    const newClicks = acc.clicks;
    const drop1 = (100 * (midClicks - oldClicks)) / oldClicks;
    const drop2 = midClicks > 0 ? (100 * (newClicks - midClicks)) / midClicks : -100;
    if (drop1 <= -minDeclinePct && drop2 <= -minDeclinePct) {
      candidates.push({
        key,
        clicks: newClicks,
        impressions: acc.impressions,
        ctr: acc.impressions > 0 ? Math.round((acc.clicks / acc.impressions) * 10000) / 100 : null,
        position: acc.impressions > 0 ? Math.round((acc.positionWeight / acc.impressions) * 10) / 10 : null,
        reason: `${windowDays}d windows: ${oldClicks} → ${midClicks} → ${newClicks} clicks`,
      });
    }
  }
  candidates.sort((a, b) => a.clicks - b.clicks);
  return {
    kind: "declining",
    ruleVersion: OPPORTUNITY_RULE_VERSION,
    thresholds: { windowDays, minBaseClicks, minDeclinePct },
    candidates,
    limitation: "A sustained fall in observed clicks is a candidate for review, not proof of obsolete content or any cause.",
  };
}

export interface BenchmarkOpts {
  // Explicit user curve: {positionBucket: expectedCtr}. Without it, the
  // site's own observed medians are the baseline — never an invented norm.
  curve?: Array<{ maxPosition: number; expectedCtr: number }>;
  minImpressions?: number;
}

function bucketMedians(rows: AnalyticsRow[]): Array<{ maxPosition: number; expectedCtr: number }> {
  const buckets = new Map<number, number[]>();
  for (const r of rows) {
    const b = Math.min(10, Math.max(1, Math.floor(r.position)));
    const list = buckets.get(b) ?? [];
    list.push(r.ctr);
    buckets.set(b, list);
  }
  return [...buckets.entries()]
    .map(([maxPosition, ctrs]) => {
      const sorted = [...ctrs].sort((a, b) => a - b);
      return { maxPosition, expectedCtr: sorted[Math.floor(sorted.length / 2)] };
    })
    .sort((a, b) => a.maxPosition - b.maxPosition);
}

export function ctrBenchmark(rows: AnalyticsRow[], opts: BenchmarkOpts = {}): OpportunityResult {
  const minImpressions = opts.minImpressions ?? 200;
  const curve = opts.curve ?? bucketMedians(rows);
  const source = opts.curve ? "user_curve" : "site_observed_median";
  const refFor = (pos: number): number | null => {
    const hit = curve.find((c) => pos <= c.maxPosition);
    return hit ? hit.expectedCtr : null;
  };
  const candidates = rows
    .filter((r) => r.impressions >= minImpressions)
    .map((r) => ({ r, ref: refFor(r.position) }))
    .filter((x): x is { r: AnalyticsRow; ref: number } => x.ref !== null && x.r.ctr < x.ref)
    .map(({ r, ref }) =>
      asOpportunity(r, `CTR ${(r.ctr * 100).toFixed(2)}% vs ${(ref * 100).toFixed(2)}% ${source} at position ${r.position.toFixed(1)}`)
    )
    .sort(orderByImpressions);
  return {
    kind: "ctr_benchmark",
    ruleVersion: OPPORTUNITY_RULE_VERSION,
    thresholds: { minImpressions, baseline: source },
    candidates,
    limitation: source === "site_observed_median"
      ? "Reference is this site's own observed median per position bucket, not an industry standard."
      : "Reference is the caller-provided curve; its provenance is the caller's responsibility.",
  };
}

export interface LowClicksOpts {
  minImpressions?: number;
  maxClicks?: number;
}

export function lowClicks(rows: AnalyticsRow[], opts: LowClicksOpts = {}): OpportunityResult {
  const minImpressions = opts.minImpressions ?? 500;
  const maxClicks = opts.maxClicks ?? 2;
  const candidates = rows
    .filter((r) => r.impressions >= minImpressions && r.clicks <= maxClicks)
    .map((r) => asOpportunity(r, `${r.impressions} impressions with ${r.clicks} clicks`))
    .sort(orderByImpressions);
  return {
    kind: "low_clicks",
    ruleVersion: OPPORTUNITY_RULE_VERSION,
    thresholds: { minImpressions, maxClicks },
    candidates,
    limitation: "Zero clicks is an observed value, not proof on its own that a thumbnail or title fails.",
  };
}

export function findOpportunities(
  kind: string,
  rows: AnalyticsRow[],
  opts: LowCtrOpts & StrikingDistanceOpts & DecliningOpts & BenchmarkOpts & LowClicksOpts & { windows?: [AnalyticsRow[], AnalyticsRow[], AnalyticsRow[]] } = {}
): OpportunityResult {
  switch (kind) {
    case "low_ctr":
      return lowCtr(rows, opts);
    case "striking_distance":
      return strikingDistance(rows, opts);
    case "declining":
      if (!opts.windows) {
        throw new GscError("INSUFFICIENT_DATA", "declining needs three comparable windows; got none");
      }
      return declining(opts.windows, opts);
    case "ctr_benchmark":
      return ctrBenchmark(rows, opts);
    case "low_clicks":
      return lowClicks(rows, opts);
    default:
      throw new GscError("INVALID_ARGUMENT", `kind must be low_ctr, striking_distance, declining, ctr_benchmark or low_clicks`);
  }
}
