import { GscError } from "./errors.js";

export interface DateRange {
  startDate: string;
  endDate: string;
}

export type Preset = "last_7_days" | "last_28_days" | "last_90_days";
export type BaselineMode = "previous_period" | "previous_year";

export interface PeriodSpec {
  preset?: string;
  startDate?: string;
  endDate?: string;
  baseline?: string | DateRange;
}

export interface ResolvedPeriods {
  current: DateRange;
  baseline: DateRange | null;
  resolution: "conservative_lag" | "explicit";
  warnings: string[];
}
const PRESET_DAYS: Record<Preset, number> = {
  last_7_days: 7,
  last_28_days: 28,
  last_90_days: 90,
};

export function shiftDays(range: DateRange, days: number): DateRange {
  const shift = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  };
  return { startDate: shift(range.startDate), endDate: shift(range.endDate) };
}

function ptParts(ref: Date): { y: number; m: number; d: number } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function rangeDays(range: DateRange): number {
  const [sy, sm, sd] = range.startDate.split("-").map(Number);
  const [ey, em, ed] = range.endDate.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// All Search Console dates are America/Los_Angeles calendar days. Presets end
// three days before PT today: a product default (conservative_lag), not a
// guarantee about what Google has processed.
export function resolvePeriods(spec: PeriodSpec, refNow: Date = new Date()): ResolvedPeriods {
  const warnings: string[] = [];
  let current: DateRange;
  let resolution: ResolvedPeriods["resolution"];

  if (spec.preset !== undefined) {
    const days = spec.preset === "last_7_days" ? 7 : spec.preset === "last_28_days" ? 28 : spec.preset === "last_90_days" ? 90 : undefined;
    if (days === undefined) throw new GscError("INVALID_ARGUMENT", `preset must be ${Object.keys(PRESET_DAYS).join(", ")}`);
    const { y, m, d } = ptParts(refNow);
    const end = new Date(Date.UTC(y, m - 1, d) - 3 * 86_400_000);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const iso = (dt: Date): string => fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    current = { startDate: iso(start), endDate: iso(end) };
    resolution = "conservative_lag";
  } else if (spec.startDate !== undefined && spec.endDate !== undefined) {
    if (!validDate(spec.startDate) || !validDate(spec.endDate)) {
      throw new GscError("INVALID_ARGUMENT", "startDate/endDate must be real calendar dates in YYYY-MM-DD");
    }
    if (spec.startDate > spec.endDate) throw new GscError("INVALID_ARGUMENT", "startDate must not be after endDate");
    current = { startDate: spec.startDate, endDate: spec.endDate };
    resolution = "explicit";
  } else {
    throw new GscError("INVALID_ARGUMENT", "period needs either a preset or explicit startDate+endDate");
  }

  let baseline: DateRange | null = null;
  const mode = spec.baseline;
  if (mode !== undefined) {
    if (typeof mode === "string") {
      if (mode === "previous_period") {
        baseline = shiftDays(current, -rangeDays(current));
      } else if (mode === "previous_year") {
        const back = (iso: string): string => {
          const [y, m, d] = iso.split("-").map(Number);
          const leap = m === 2 && d === 29;
          if (leap) warnings.push("Feb 29 mapped to Feb 28 in the baseline year; durations differ by one day");
          return fmt(y - 1, m, leap ? 28 : d);
        };
        baseline = { startDate: back(current.startDate), endDate: back(current.endDate) };
      } else {
        throw new GscError("INVALID_ARGUMENT", 'baseline mode must be "previous_period" or "previous_year"');
      }
    } else {
      if (!validDate(mode.startDate) || !validDate(mode.endDate) || mode.startDate > mode.endDate) {
        throw new GscError("INVALID_ARGUMENT", "explicit baseline needs valid startDate/endDate in YYYY-MM-DD");
      }
      baseline = { startDate: mode.startDate, endDate: mode.endDate };
    }
    if (rangeDays(baseline) !== rangeDays(current)) {
      warnings.push("current and baseline windows differ in length: compare daily rates, not raw totals");
    }
  }

  return { current, baseline, resolution, warnings };
}
