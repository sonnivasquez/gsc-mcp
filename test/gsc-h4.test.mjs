import assert from "node:assert/strict";
import test from "node:test";

const { resolvePeriods } = await import("../dist/gsc/periods.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");
const { comparePeriods, sumTotals } = await import("../dist/gsc/compare.js");
const tools = await import("../dist/gsc/tools.js");

const REF = new Date("2026-09-21T12:00:00Z");

// --- Periods (PT calendar, deterministic) ---

test("preset resolves on the PT calendar with conservative lag", () => {
  const r = resolvePeriods({ preset: "last_7_days" }, REF);
  assert.deepEqual(r.current, { startDate: "2026-09-12", endDate: "2026-09-18" });
  assert.equal(r.resolution, "conservative_lag");
  assert.equal(r.baseline, null);
});

test("previous_period abuts the current window", () => {
  const r = resolvePeriods(
    { startDate: "2026-08-01", endDate: "2026-08-28", baseline: "previous_period" },
    REF
  );
  assert.deepEqual(r.baseline, { startDate: "2026-07-04", endDate: "2026-07-31" });
  assert.equal(r.resolution, "explicit");
});

test("previous_year maps Feb 29 with a warning", () => {
  const r = resolvePeriods(
    { startDate: "2024-02-29", endDate: "2024-02-29", baseline: "previous_year" },
    REF
  );
  assert.deepEqual(r.baseline, { startDate: "2023-02-28", endDate: "2023-02-28" });
  assert.ok(r.warnings.some((w) => w.includes("Feb 29")));
});

test("period validation fails before any budget use", () => {
  for (const spec of [
    { startDate: "2026-13-01", endDate: "2026-08-01" },
    { startDate: "2026-08-02", endDate: "2026-08-01" },
    { preset: "last_forever" },
    { startDate: "2026-08-01", endDate: "2026-08-07", baseline: "yesterday" },
    {},
  ]) {
    assert.throws(() => resolvePeriods(spec, REF), /INVALID_ARGUMENT/);
  }
});

test("unequal windows warn about daily rates", () => {
  const r = resolvePeriods(
    { startDate: "2026-08-01", endDate: "2026-08-07", baseline: { startDate: "2026-07-01", endDate: "2026-07-05" } },
    REF
  );
  assert.ok(r.warnings.some((w) => w.includes("daily rates")));
});

// --- Datasets ---

function sampleRows() {
  return Array.from({ length: 5 }, (_, i) => ({ q: `q${i + 1}`, clicks: (i + 1) * 10 }));
}

test("dataset pages with opaque cursors and column projection", () => {
  const store = new DatasetStore();
  const ds = store.create("work", ["q", "clicks"], sampleRows());
  const p1 = store.page(ds.id, "work", { limit: 2 });
  assert.deepEqual(p1.rows.map((r) => r.q), ["q1", "q2"]);
  assert.deepEqual(p1.columns, ["q", "clicks"]);
  assert.equal(p1.totalRows, 5);
  assert.ok(p1.nextCursor);
  const p2 = store.page(ds.id, "work", { cursor: p1.nextCursor, limit: 2, columns: ["clicks"] });
  assert.deepEqual(p2.rows, [{ clicks: 30 }, { clicks: 40 }]);
  const p3 = store.page(ds.id, "work", { cursor: p2.nextCursor, limit: 2 });
  assert.deepEqual(p3.rows.map((r) => r.q), ["q5"]);
  assert.equal(p3.nextCursor, null);
});

test("datasets reject foreign profiles, bad cursors and unknown columns", () => {
  const store = new DatasetStore();
  const ds = store.create("work", ["q", "clicks"], sampleRows());
  assert.throws(() => store.page(ds.id, "personal"), /DATASET_NOT_FOUND/);
  assert.throws(() => store.page("nope", "work"), /DATASET_NOT_FOUND/);
  assert.throws(() => store.page(ds.id, "work", { cursor: "!!!" }), /INVALID_ARGUMENT/);
  assert.throws(() => store.page(ds.id, "work", { limit: 201 }), /INVALID_ARGUMENT/);
  assert.throws(() => store.page(ds.id, "work", { columns: ["ctr"] }), /INVALID_ARGUMENT/);
});

test("expired datasets report DATASET_EXPIRED", () => {
  const store = new DatasetStore();
  const ds = store.create("work", ["q"], sampleRows(), Date.now() - 20 * 60_000);
  assert.throws(() => store.page(ds.id, "work"), /DATASET_EXPIRED/);
});

// --- Compare engine (spec section 12 reference numbers) ---

const BASE = [{ keys: ["p"], clicks: 100, impressions: 1000, ctr: 0.1, position: 10 }];
const CURRENT = [{ keys: ["p"], clicks: 150, impressions: 2000, ctr: 0.075, position: 8 }];
test("reference arithmetic: +50 clicks, -2.5pp CTR, improvement 2", () => {
  const { compared } = comparePeriods(CURRENT, BASE);
  assert.equal(compared.length, 1);
  const r = compared[0];
  assert.equal(r.observation, "observed_in_both");
  assert.equal(r.deltaClicks, 50);
  assert.equal(r.deltaClicksPct, 50);
  assert.ok(Math.abs(r.deltaCtrPp - -2.5) < 1e-9, `deltaCtrPp=${r.deltaCtrPp}`);
  assert.equal(r.deltaPosition, -2);
  assert.equal(r.positionImprovement, 2);
});

test("zero baseline yields null percent, never Infinity", () => {
  const { compared } = comparePeriods(
    [{ keys: ["p"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }],
    [{ keys: ["p"], clicks: 0, impressions: 0, ctr: 0, position: 5 }]
  );
  assert.equal(compared[0].deltaClicksPct, null);
  assert.equal(compared[0].deltaClicksPctReason, "ZERO_BASELINE");
  assert.ok(Number.isFinite(compared[0].deltaClicks));
});

test("absent keys stay in their own blocks with nulls", () => {
  const c = comparePeriods(
    [{ keys: ["new"], clicks: 5, impressions: 50, ctr: 0.1, position: 9 }],
    [{ keys: ["gone"], clicks: 5, impressions: 50, ctr: 0.1, position: 9 }]
  );
  assert.equal(c.compared.length, 0);
  assert.equal(c.notObservedInBaseline[0].key, "new");
  assert.equal(c.notObservedInCurrent[0].key, "gone");
  assert.equal(c.notObservedInCurrent[0].deltaClicks, null);
});

test("totals use ratios of sums, null on empty denominator", () => {
  const t = sumTotals([...BASE, ...CURRENT]);
  assert.equal(t.clicks, 250);
  assert.equal(t.impressions, 3000);
  assert.equal(t.ctr, 250 / 3000);
  assert.equal(t.position, (10 * 1000 + 8 * 2000) / 3000);
  assert.deepEqual(sumTotals([]), { clicks: 0, impressions: 0, ctr: null, position: null });
});

// --- T10 over MCP-shaped envelopes ---

test("gsc_get_dataset pages a stored result with zero Google calls", async () => {
  const { DatasetStore: Fresh } = await import("../dist/gsc/datasets.js");
  const store = new Fresh();
  const ds = store.create("test", ["q", "clicks"], sampleRows());
  const env = await tools.gscGetDataset({ datasetId: ds.id, limit: 2 }, { store, profileAlias: "test" });
  assert.equal(env.status, "ok");
  assert.equal(env.meta.provenance.source, "local_dataset");
  assert.equal(env.data.totalRows, 5);
  assert.equal(env.data.rows.length, 2);
  const env2 = await tools.gscGetDataset({ datasetId: ds.id, cursor: env.data.nextCursor, limit: 10 }, { store, profileAlias: "test" });
  assert.equal(env2.data.rows.length, 3);
  assert.equal(env2.data.nextCursor, null);
});

test("gsc_get_dataset isolates profiles and rejects unknown ids", async () => {
  const { DatasetStore: Fresh } = await import("../dist/gsc/datasets.js");
  const store = new Fresh();
  const ds = store.create("test", ["q"], sampleRows());
  const foreign = await tools.gscGetDataset({ datasetId: ds.id }, { store, profileAlias: "other" });
  assert.equal(foreign.status, "error");
  assert.equal(foreign.error.code, "DATASET_NOT_FOUND");
  const missing = await tools.gscGetDataset({ datasetId: "nope" }, { store, profileAlias: "test" });
  assert.equal(missing.error.code, "DATASET_NOT_FOUND");
  const empty = await tools.gscGetDataset({ datasetId: " " }, { store, profileAlias: "test" });
  assert.equal(empty.error.code, "INVALID_ARGUMENT");
});
