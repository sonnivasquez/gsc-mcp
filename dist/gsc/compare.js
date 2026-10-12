"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.comparePeriods = comparePeriods;
exports.sumTotals = sumTotals;
function pct(current, baseline) {
    if (baseline <= 0)
        return { value: null, zeroBaseline: true };
    return { value: (100 * (current - baseline)) / baseline, zeroBaseline: false };
}
function comparePair(key, current, baseline) {
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
            ...(clicks.zeroBaseline ? { deltaClicksPctReason: "ZERO_BASELINE" } : {}),
            deltaImpressions: current.impressions - baseline.impressions,
            deltaImpressionsPct: impressions.value,
            ...(impressions.zeroBaseline ? { deltaImpressionsPctReason: "ZERO_BASELINE" } : {}),
            deltaCtrPp: 100 * (current.ctr - baseline.ctr),
            deltaPosition: current.position - baseline.position,
            positionImprovement: baseline.position - current.position,
        };
    }
    const empty = {
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
function comparePeriods(currentRows, baselineRows, orderBy = "deltaClicks", direction = "asc") {
    const keyOf = (r) => r.keys.join(String.fromCharCode(0));
    const toMetrics = (r) => ({
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
    });
    const current = new Map(currentRows.map((r) => [keyOf(r), toMetrics(r)]));
    const baseline = new Map(baselineRows.map((r) => [keyOf(r), toMetrics(r)]));
    const compared = [];
    const notObservedInCurrent = [];
    const notObservedInBaseline = [];
    for (const [key, c] of current) {
        const b = baseline.get(key) ?? null;
        const row = comparePair(key, c, b);
        if (row.observation === "observed_in_both")
            compared.push(row);
        else
            notObservedInBaseline.push(row);
    }
    for (const [key, b] of baseline) {
        if (!current.has(key))
            notObservedInCurrent.push(comparePair(key, null, b));
    }
    const dir = direction === "asc" ? 1 : -1;
    compared.sort((a, b) => {
        const av = a[orderBy] ?? Number.POSITIVE_INFINITY;
        const bv = b[orderBy] ?? Number.POSITIVE_INFINITY;
        if (av !== bv)
            return (av - bv) * dir;
        return a.key < b.key ? -1 : 1;
    });
    return { compared, notObservedInCurrent, notObservedInBaseline };
}
// Totals come from sums, never from averaging ratios: CTR is sum(clicks) /
// sum(impressions), position is impression-weighted. Null denominator → null.
function sumTotals(rows) {
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
