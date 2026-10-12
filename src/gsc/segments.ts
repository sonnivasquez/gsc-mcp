import type { AnalyticsRow } from "./client.js";
import { sumTotals } from "./compare.js";

export const SEGMENTS_RULE_VERSION = "t13.1";

export interface SegmentDef {
  id: string;
  label: string;
  // All literal, case-insensitive. brandTerms match the query; pathPrefix
  // matches the page; country/device match their dimensions when present.
  brandTerms?: string[];
  pathPrefix?: string;
  country?: string;
  device?: string;
}

export interface SegmentResult {
  id: string;
  label: string;
  rule: SegmentDef;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  matchedRows: number;
}

export interface SegmentsAnalysis {
  segments: SegmentResult[];
  unattributedRows: number;
  unattributedNote: string;
  classificationMode: "local_dataset";
  warnings: string[];
}

// Local classification over one retrieved dataset: the universe is stated,
// groups may overlap (shares are not additive), and unmatched rows are
// reported — never silently filed under non-brand.
export function analyzeSegments(rows: AnalyticsRow[], dimensions: string[], defs: SegmentDef[]): SegmentsAnalysis {
  const warnings: string[] = [];
  const qi = dimensions.indexOf("query");
  const pi = dimensions.indexOf("page");
  const ci = dimensions.indexOf("country");
  const di = dimensions.indexOf("device");
  if (qi === -1) warnings.push("no query dimension: brand matching disabled");
  if (pi === -1 && defs.some((d) => d.pathPrefix)) warnings.push("no page dimension: folder matching disabled");

  const matched = new Set<number>();
  const segments = defs.map((def) => {
    const hits: AnalyticsRow[] = [];
    rows.forEach((r, i) => {
      const q = qi === -1 ? "" : (r.keys[qi] ?? "").toLowerCase();
      const p = pi === -1 ? "" : (r.keys[pi] ?? "");
      const c = ci === -1 ? "" : (r.keys[ci] ?? "");
      const dv = di === -1 ? "" : (r.keys[di] ?? "");
      if (def.brandTerms && !def.brandTerms.some((t) => q.includes(t.toLowerCase()))) return;
      if (def.pathPrefix && !p.startsWith(def.pathPrefix)) return;
      if (def.country && c.toUpperCase() !== def.country.toUpperCase()) return;
      if (def.device && dv.toUpperCase() !== def.device.toUpperCase()) return;
      hits.push(r);
      matched.add(i);
    });
    const t = sumTotals(hits);
    return {
      id: def.id,
      label: def.label,
      rule: def,
      clicks: t.clicks,
      impressions: t.impressions,
      ctr: t.ctr,
      position: t.position,
      matchedRows: hits.length,
    };
  });

  if (defs.length > 1) {
    warnings.push("segments may overlap: shares are not additive parts of one total");
  }
  return {
    segments,
    unattributedRows: rows.length - matched.size,
    unattributedNote: "rows matching no segment; unquantifiable remainder stays unknown, never defaults to non-brand",
    classificationMode: "local_dataset",
    warnings,
  };
}
