"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftDays = shiftDays;
exports.resolvePeriods = resolvePeriods;
const errors_js_1 = require("./errors.js");
const PRESET_DAYS = {
    last_7_days: 7,
    last_28_days: 28,
    last_90_days: 90,
};
function shiftDays(range, days) {
    const shift = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
        return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    };
    return { startDate: shift(range.startDate), endDate: shift(range.endDate) };
}
function ptParts(ref) {
    const iso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(ref);
    const [y, m, d] = iso.split("-").map(Number);
    return { y, m, d };
}
function fmt(y, m, d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function rangeDays(range) {
    const [sy, sm, sd] = range.startDate.split("-").map(Number);
    const [ey, em, ed] = range.endDate.split("-").map(Number);
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// All Search Console dates are America/Los_Angeles calendar days. Presets end
// three days before PT today: a product default (conservative_lag), not a
// guarantee about what Google has processed.
function resolvePeriods(spec, refNow = new Date()) {
    const warnings = [];
    let current;
    let resolution;
    if (spec.preset !== undefined) {
        const days = spec.preset === "last_7_days" ? 7 : spec.preset === "last_28_days" ? 28 : spec.preset === "last_90_days" ? 90 : undefined;
        if (days === undefined)
            throw new errors_js_1.GscError("INVALID_ARGUMENT", `preset must be ${Object.keys(PRESET_DAYS).join(", ")}`);
        const { y, m, d } = ptParts(refNow);
        const end = new Date(Date.UTC(y, m - 1, d) - 3 * 86_400_000);
        const start = new Date(end.getTime() - (days - 1) * 86_400_000);
        const iso = (dt) => fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        current = { startDate: iso(start), endDate: iso(end) };
        resolution = "conservative_lag";
    }
    else if (spec.startDate !== undefined && spec.endDate !== undefined) {
        if (!validDate(spec.startDate) || !validDate(spec.endDate)) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "startDate/endDate must be real calendar dates in YYYY-MM-DD");
        }
        if (spec.startDate > spec.endDate)
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "startDate must not be after endDate");
        current = { startDate: spec.startDate, endDate: spec.endDate };
        resolution = "explicit";
    }
    else {
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "period needs either a preset or explicit startDate+endDate");
    }
    let baseline = null;
    const mode = spec.baseline;
    if (mode !== undefined) {
        if (typeof mode === "string") {
            if (mode === "previous_period") {
                baseline = shiftDays(current, -rangeDays(current));
            }
            else if (mode === "previous_year") {
                const back = (iso) => {
                    const [y, m, d] = iso.split("-").map(Number);
                    const leap = m === 2 && d === 29;
                    if (leap)
                        warnings.push("Feb 29 mapped to Feb 28 in the baseline year; durations differ by one day");
                    return fmt(y - 1, m, leap ? 28 : d);
                };
                baseline = { startDate: back(current.startDate), endDate: back(current.endDate) };
            }
            else {
                throw new errors_js_1.GscError("INVALID_ARGUMENT", 'baseline mode must be "previous_period" or "previous_year"');
            }
        }
        else {
            if (!validDate(mode.startDate) || !validDate(mode.endDate) || mode.startDate > mode.endDate) {
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "explicit baseline needs valid startDate/endDate in YYYY-MM-DD");
            }
            baseline = { startDate: mode.startDate, endDate: mode.endDate };
        }
        if (rangeDays(baseline) !== rangeDays(current)) {
            warnings.push("current and baseline windows differ in length: compare daily rates, not raw totals");
        }
    }
    return { current, baseline, resolution, warnings };
}
