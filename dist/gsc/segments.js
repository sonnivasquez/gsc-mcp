"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEGMENTS_RULE_VERSION = void 0;
exports.analyzeSegments = analyzeSegments;
const compare_js_1 = require("./compare.js");
exports.SEGMENTS_RULE_VERSION = "t13.1";
// Local classification over one retrieved dataset: the universe is stated,
// groups may overlap (shares are not additive), and unmatched rows are
// reported — never silently filed under non-brand.
function analyzeSegments(rows, dimensions, defs) {
    const warnings = [];
    const qi = dimensions.indexOf("query");
    const pi = dimensions.indexOf("page");
    const ci = dimensions.indexOf("country");
    const di = dimensions.indexOf("device");
    if (qi === -1)
        warnings.push("no query dimension: brand matching disabled");
    if (pi === -1 && defs.some((d) => d.pathPrefix))
        warnings.push("no page dimension: folder matching disabled");
    const matched = new Set();
    const segments = defs.map((def) => {
        const hits = [];
        rows.forEach((r, i) => {
            const q = qi === -1 ? "" : (r.keys[qi] ?? "").toLowerCase();
            const p = pi === -1 ? "" : (r.keys[pi] ?? "");
            const c = ci === -1 ? "" : (r.keys[ci] ?? "");
            const dv = di === -1 ? "" : (r.keys[di] ?? "");
            if (def.brandTerms && !def.brandTerms.some((t) => q.includes(t.toLowerCase())))
                return;
            if (def.pathPrefix && !p.startsWith(def.pathPrefix))
                return;
            if (def.country && c.toUpperCase() !== def.country.toUpperCase())
                return;
            if (def.device && dv.toUpperCase() !== def.device.toUpperCase())
                return;
            hits.push(r);
            matched.add(i);
        });
        const t = (0, compare_js_1.sumTotals)(hits);
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
