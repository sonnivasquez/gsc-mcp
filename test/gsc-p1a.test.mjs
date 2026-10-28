import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

const opp = await import("../dist/gsc/opportunities.js");
const cann = await import("../dist/gsc/cannibalization.js");
const seg = await import("../dist/gsc/segments.js");
const tools = await import("../dist/gsc/tools.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");

const SITE = "sc-domain:example.com";
const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};
const deps = (fetchImpl, store) => ({ provider, fetchImpl, store, profileAlias: "test" });

const qrows = [
  { keys: ["keep"], clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
  { keys: ["topten"], clicks: 300, impressions: 2000, ctr: 0.15, position: 3 },
  { keys: ["deep"], clicks: 5, impressions: 900, ctr: 0.005, position: 20 },
  { keys: ["quiet"], clicks: 1, impressions: 10, ctr: 0.1, position: 6 },
  { keys: ["best"], clicks: 38, impressions: 2000, ctr: 0.019, position: 4 },
];

// --- T11 engines ---

test("low_ctr selects under the bar, scenario only with target", () => {
  const r = opp.lowCtr(qrows, {});
  assert.deepEqual(r.candidates.map((c) => c.key), ["best"]);
  assert.ok(!("scenarioExtraClicks" in r.candidates[0]));
  assert.equal(r.ruleVersion, "t11.1");
  const s = opp.lowCtr(qrows, { targetCtr: 0.11 });
  assert.equal(s.candidates[0].scenarioExtraClicks, 182);
  assert.match(s.limitation, /scenario/);
});

test("striking_distance uses the configured band", () => {
  assert.deepEqual(opp.strikingDistance(qrows, {}).candidates.map((c) => c.key), ["deep"]);
  const custom = opp.strikingDistance(qrows, { minPosition: 4, maxPosition: 6 });
  assert.deepEqual(custom.candidates.map((c) => c.key), ["best", "keep"]);
});
test("declining needs two consecutive qualifying drops", () => {
  const mk = (clicks) => [{ keys: ["p"], clicks, impressions: 1000, ctr: 0.1, position: 5 }];
  const r = opp.declining([mk(50), mk(80), mk(120)], {});
  assert.equal(r.candidates.length, 1);
  assert.match(r.candidates[0].reason, /120 → 80 → 50/);
  const single = opp.declining([mk(50), mk(120), mk(120)], {});
  assert.equal(single.candidates.length, 0);
  const thin = opp.declining([mk(10), mk(20), mk(40)], {});
  assert.equal(thin.candidates.length, 0);
});
test("declining aggregates observed recent metrics with explicit nulls", () => {
  const row = (clicks, impressions, position, ctr) => [{ keys: ["p"], clicks, impressions, ctr, position }];
  const inconsistent = opp.declining([row(50, 1000, 5, 0.999), row(80, 1000, 5, 0.08), row(120, 1000, 5, 0.12)], {});
  const c = inconsistent.candidates[0];
  assert.equal(c.clicks, 50);
  assert.equal(c.impressions, 1000);
  assert.equal(c.ctr, 5);
  assert.equal(c.position, 5);
  const dup = opp.declining(
    [
      [{ keys: ["p"], clicks: 30, impressions: 600, ctr: 0.05, position: 4 }, { keys: ["p"], clicks: 20, impressions: 400, ctr: 0.05, position: 6 }],
      row(80, 1000, 5, 0.08),
      row(120, 1000, 5, 0.12),
    ],
    {}
  );
  assert.equal(dup.candidates[0].clicks, 50);
  assert.equal(dup.candidates[0].impressions, 1000);
  assert.equal(dup.candidates[0].ctr, 5);
  assert.equal(dup.candidates[0].position, 4.8);
  const zero = opp.declining([[{ keys: ["p"], clicks: 0, impressions: 0, ctr: 0, position: 0 }], row(80, 1000, 5, 0.08), row(120, 1000, 5, 0.12)], {});
  assert.equal(zero.candidates[0].ctr, null);
  assert.equal(zero.candidates[0].position, null);
  const absent = opp.declining([[], row(80, 1000, 5, 0.08), row(120, 1000, 5, 0.12)], {});
  assert.equal(absent.candidates.length, 0);
});

test("T11 declining validates windowDays before fetching", async () => {
  for (const windowDays of [6, 91, 7.5]) {
    let calls = 0;
    const env = await tools.gscFindOpportunities(
      { siteUrl: SITE, kind: "declining", startDate: "2026-08-01", endDate: "2026-08-28", windowDays },
      deps(async () => (calls++, new Response(JSON.stringify({ rows: [] }), { status: 200 })), new DatasetStore())
    );
    assert.equal(env.error.code, "INVALID_ARGUMENT");
    assert.equal(calls, 0);
  }
  for (const windowDays of [7, 90]) {
    const env = await tools.gscFindOpportunities(
      { siteUrl: SITE, kind: "declining", startDate: "2026-08-01", endDate: "2026-08-28", windowDays },
      deps(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }), new DatasetStore())
    );
    assert.equal(env.status, "ok");
  }
});

test("T11 declining preset windows stay adjacent and disjoint", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ startDate: body.startDate, endDate: body.endDate });
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  const env = await tools.gscFindOpportunities(
    { siteUrl: SITE, kind: "declining", preset: "last_7_days", windowDays: 28 },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  assert.equal(seen.length, 3);
  const days = (s, e) => (new Date(e) - new Date(s)) / 86400000 + 1;
  for (const w of seen) assert.equal(days(w.startDate, w.endDate), 28);
  assert.equal(seen[1].endDate < seen[0].startDate, true);
  assert.equal(seen[2].endDate < seen[1].startDate, true);
  assert.equal((new Date(seen[0].startDate) - new Date(seen[1].endDate)) / 86400000, 1);
  assert.equal((new Date(seen[1].startDate) - new Date(seen[2].endDate)) / 86400000, 1);
});

test("ctr_benchmark defaults to the site median, never an industry curve", () => {
  const r = opp.ctrBenchmark(qrows, {});
  assert.equal(r.thresholds.baseline, "site_observed_median");
  const withCurve = opp.ctrBenchmark(qrows, { curve: [{ maxPosition: 10, expectedCtr: 0.5 }] });
  assert.ok(withCurve.candidates.length >= r.candidates.length);
});

test("low_clicks keeps thresholds explicit", () => {
  const r = opp.lowClicks(
    [...qrows, { keys: ["ghost"], clicks: 0, impressions: 600, ctr: 0, position: 12 }],
    {}
  );
  assert.deepEqual(r.candidates.map((c) => c.key), ["ghost"]);
});

test("findOpportunities rejects unknown kinds and missing windows", () => {
  assert.throws(() => opp.findOpportunities("vibes", qrows), /INVALID_ARGUMENT/);
  assert.throws(() => opp.findOpportunities("declining", qrows), /INSUFFICIENT_DATA/);
});

// --- T12 engine ---

test("cannibalization finds shared queries as candidates only", () => {
  const rows = [
    { keys: ["q", "https://example.com/a"], clicks: 60, impressions: 600, ctr: 0.1, position: 4 },
    { keys: ["q", "https://example.com/b"], clicks: 40, impressions: 400, ctr: 0.1, position: 6 },
    { keys: ["solo", "https://example.com/c"], clicks: 10, impressions: 500, ctr: 0.02, position: 9 },
  ];
  const [hit] = cann.detectCannibalization(rows, {});
  assert.equal(hit.query, "q");
  assert.equal(hit.verdict, "candidate");
  assert.equal(hit.temporalOverlap, "unknown");
  assert.deepEqual(hit.pages.map((p) => p.page), ["https://example.com/a", "https://example.com/b"]);
  assert.equal(hit.pages[0].sharePct, 60);
  assert.equal(cann.detectCannibalization(rows, { minPages: 3 }).length, 0);
});

// --- T13 engine ---

test("segments classify brand and folder with unattributed remainder", () => {
  const rows = [
    { keys: ["acme shoes", "https://example.com/blog/x"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
    { keys: ["boots", "https://example.com/shop/y"], clicks: 20, impressions: 200, ctr: 0.1, position: 4 },
    { keys: ["sandals", "https://example.com/blog/z"], clicks: 5, impressions: 50, ctr: 0.1, position: 9 },
  ];
  const r = seg.analyzeSegments(rows, ["query", "page"], [
    { id: "brand", label: "Brand", brandTerms: ["acme"] },
    { id: "blog", label: "Blog", pathPrefix: "https://example.com/blog/" },
  ]);
  assert.equal(r.segments[0].clicks, 10);
  assert.equal(r.segments[1].clicks, 15);
  assert.equal(r.unattributedRows, 1);
  assert.equal(r.classificationMode, "local_dataset");
  assert.ok(r.warnings.some((w) => w.includes("overlap")));
});

// --- Tool-level: T11 declining windows, T12, T13 ---

test("T11 declining fetches three windows and honors limits", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.startDate);
    const clicks = body.startDate === "2026-08-01" ? 50 : body.startDate === "2026-07-04" ? 80 : 120;
    return new Response(JSON.stringify({ rows: [{ keys: ["p"], clicks, impressions: 1000, ctr: 0.1, position: 5 }] }), { status: 200 });
  };
  const env = await tools.gscFindOpportunities(
    { siteUrl: SITE, kind: "declining", startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  assert.equal(env.data.candidates.length, 1);
  assert.deepEqual(seen.sort(), ["2026-06-06", "2026-07-04", "2026-08-01"]);
  const bad = await tools.gscFindOpportunities({ siteUrl: SITE, kind: "vibes", startDate: "2026-08-01", endDate: "2026-08-28" }, deps(fetchImpl, new DatasetStore()));
  assert.equal(bad.error.code, "INVALID_ARGUMENT");
});
test("T11 declining uses adjacent windowDays widths with observed recent metrics", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ startDate: body.startDate, endDate: body.endDate });
    const clicks = seen.length === 1 ? 50 : seen.length === 2 ? 80 : 120;
    return new Response(JSON.stringify({ rows: [{ keys: ["p"], clicks, impressions: 1000, ctr: 0.05, position: 5 }] }), { status: 200 });
  };
  const env = await tools.gscFindOpportunities(
    { siteUrl: SITE, kind: "declining", startDate: "2026-08-01", endDate: "2026-08-28", windowDays: 7 },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  assert.deepEqual(seen, [
    { startDate: "2026-08-22", endDate: "2026-08-28" },
    { startDate: "2026-08-15", endDate: "2026-08-21" },
    { startDate: "2026-08-08", endDate: "2026-08-14" },
  ]);
  const c = env.data.candidates[0];
  assert.equal(c.clicks, 50);
  assert.equal(c.impressions, 1000);
  assert.equal(c.ctr, 5);
  assert.equal(c.position, 5);
});

test("T12/T13 run over fetched rows", async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.dimensions, ["query", "page"]);
    return new Response(
      JSON.stringify({
        rows: [
          { keys: ["q", "https://example.com/a"], clicks: 60, impressions: 600, ctr: 0.1, position: 4 },
          { keys: ["q", "https://example.com/b"], clicks: 40, impressions: 400, ctr: 0.1, position: 6 },
        ],
      }),
      { status: 200 }
    );
  };
  const d = deps(fetchImpl, new DatasetStore());
  const c12 = await tools.gscDetectCannibalization({ siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28" }, d);
  assert.equal(c12.data.candidatesTotal, 1);
  const c13 = await tools.gscAnalyzeSegments(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", segments: [{ id: "all", label: "All" }] },
    d
  );
  assert.equal(c13.data.segments[0].clicks, 100);
  assert.equal(c13.data.unattributedRows, 0);
});

// --- T14 export ---

test("export writes json/csv/md with formula neutralization", async () => {
  process.env.GSC_EXPORTS = "1";
  try {
    const { exportDataset } = await import("../dist/gsc/export.js");
    const root = mkdtempSync(join(tmpdir(), "gsc-export-"));
    const columns = ["q", "clicks", "note"];
    const rows = [{ q: "=cmd|evil", clicks: 5, note: "@mention" }];
    const j = exportDataset(root, "rep", "json", columns, rows, { why: "test" });
    assert.ok(existsSync(j.path));
    assert.ok(j.sha256.length === 64);
    const c = exportDataset(root, "rep", "csv", columns, rows, { why: "test" });
    const csv = readFileSync(c.path, "utf8");
    assert.match(csv, /"'=cmd\|evil"/);
    assert.match(csv, /,5,/);
    const m = exportDataset(root, "rep", "markdown", columns, rows, { why: "test" });
    assert.match(readFileSync(m.path, "utf8"), /# Dataset export/);
  } finally {
    delete process.env.GSC_EXPORTS;
  }
});
test("csv export is pure with separate metadata sidecar", async () => {
  const prev = process.env.GSC_EXPORTS;
  process.env.GSC_EXPORTS = "1";
  const root = mkdtempSync(join(tmpdir(), "gsc-csv-sidecar-"));
  try {
    const { exportDataset } = await import("../dist/gsc/export.js");
    const columns = ["q", "clicks", "note"];
    const rows = [{ q: "=cmd|evil", clicks: 5, note: "@mention" }];
    const r = exportDataset(root, "rep", "csv", columns, rows, { why: "test" });
    assert.equal(readFileSync(r.path, "utf8"), `"q","clicks","note"\n"'=cmd|evil",5,"'@mention"\n`);
    assert.deepEqual(JSON.parse(readFileSync(r.sidecarPath, "utf8")), { why: "test" });
  } finally {
    if (prev === undefined) delete process.env.GSC_EXPORTS;
    else process.env.GSC_EXPORTS = prev;
    const { rmSync } = await import("node:fs");
    rmSync(root, { recursive: true, force: true });
  }
});
test("csv collisions never overwrite and json/md keep embedded metadata", async () => {
  const prev = process.env.GSC_EXPORTS;
  process.env.GSC_EXPORTS = "1";
  const { exportDataset } = await import("../dist/gsc/export.js");
  const { writeFileSync, readFileSync: readSync, existsSync: exists, statSync, createHash: _NOPE } = await import("node:fs");
  const origDate = Date.prototype.toISOString;
  const origRandom = Math.random;
  Date.prototype.toISOString = function () { return "2026-08-28T00:00:00.000Z"; };
  Math.random = () => 0.123456;
  const root = mkdtempSync(join(tmpdir(), "gsc-csv-collision-"));
  try {
    const first = exportDataset(root, "rep", "csv", ["q"], [{ q: "a" }], { n: 1 });
    assert.throws(() => exportDataset(root, "rep", "csv", ["q"], [{ q: "b" }], { n: 2 }), /export collision/);
    assert.equal(readSync(first.path, "utf8"), `"q"\n"a"\n`);
    const sidecarTarget = first.path.replace(/\.csv$/, ".meta.json");
    assert.equal(first.sidecarPath, sidecarTarget);
    const root2 = mkdtempSync(join(tmpdir(), "gsc-csv-sidecar-collision-"));
    try {
      const { mkdirSync, unlinkSync, readdirSync } = await import("node:fs");
      mkdirSync(join(root2, "exports"), { recursive: true });
      const probe = exportDataset(root2, "rep", "csv", ["q"], [{ q: "probe" }], { n: 0 });
      const csvName = basename(probe.path);
      const metaName = basename(probe.sidecarPath);
      unlinkSync(probe.path);
      unlinkSync(probe.sidecarPath);
      writeFileSync(join(root2, "exports", metaName), JSON.stringify({ sentinel: true }));
      assert.throws(() => exportDataset(root2, "rep", "csv", ["q"], [{ q: "a" }], { n: 1 }), /export collision/);
      assert.deepEqual(JSON.parse(readSync(join(root2, "exports", metaName), "utf8")), { sentinel: true });
      assert.equal(exists(join(root2, "exports", csvName)), false);
      assert.deepEqual(readdirSync(join(root2, "exports")), [metaName]);
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(root2, { recursive: true, force: true });
    }
    const j = exportDataset(root, "uni", "json", ["q"], [{ q: "x" }], { why: "j" });
    assert.equal(j.sidecarPath, undefined);
    assert.match(readSync(j.path, "utf8"), /"why": "j"/);
    const m = exportDataset(root, "md", "markdown", ["q"], [{ q: "x" }], { why: "m" });
    assert.equal(m.sidecarPath, undefined);
    assert.match(readSync(m.path, "utf8"), /# Dataset export/);
    assert.equal(j.bytes, statSync(j.path).size);
    const { createHash } = await import("node:crypto");
    assert.equal(j.sha256, createHash("sha256").update(readSync(j.path)).digest("hex"));
  } finally {
    Date.prototype.toISOString = origDate;
    Math.random = origRandom;
    if (prev === undefined) delete process.env.GSC_EXPORTS;
    else process.env.GSC_EXPORTS = prev;
    const { rmSync } = await import("node:fs");
    rmSync(root, { recursive: true, force: true });
  }
});

test("csv preserves unicode/quotes/newlines and neutralizes formulas", async () => {
  const prev = process.env.GSC_EXPORTS;
  process.env.GSC_EXPORTS = "1";
  const root = mkdtempSync(join(tmpdir(), "gsc-csv-edge-"));
  try {
    const { exportDataset } = await import("../dist/gsc/export.js");
    const columns = ["q", "clicks", "note"];
    const rows = [
      { q: "a,b", clicks: 1, note: 'say "hi"' },
      { q: "漢字", clicks: 2, note: "line1\nline2" },
      { q: "-danger", clicks: 3, note: "+plus" },
    ];
    const r = exportDataset(root, "edge", "csv", columns, rows, { why: "edge" });
    const csv = readFileSync(r.path, "utf8");
    assert.match(csv, /"a,b",1,"say ""hi"""/);
    assert.match(csv, /漢字/);
    assert.match(csv, /"'-danger",3,"'\+plus"/);
    assert.ok(!csv.includes("Coverage and methodology"));
  } finally {
    if (prev === undefined) delete process.env.GSC_EXPORTS;
    else process.env.GSC_EXPORTS = prev;
    const { rmSync } = await import("node:fs");
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool-level csv export exposes discoverable sidecar", async () => {
  const prevExports = process.env.GSC_EXPORTS;
  const prevDataDir = process.env.GSC_DATA_DIR;
  process.env.GSC_EXPORTS = "1";
  const root = mkdtempSync(join(tmpdir(), "gsc-csv-tool-"));
  process.env.GSC_DATA_DIR = root;
  try {
    const store = new DatasetStore();
    const ds = store.create("test", ["q", "clicks"], [{ q: "sample", clicks: 1 }]);
    const env = await tools.gscExportDataset({ datasetId: ds.id, format: "csv", name: "sidecar-check" }, { store, profileAlias: "test" });
    assert.equal(env.status, "ok");
    assert.ok(env.data.export.path.endsWith(".csv"));
    assert.ok(env.data.export.sidecarPath.endsWith(".meta.json"));
    const { readFileSync: readSync } = await import("node:fs");
    const meta = JSON.parse(readSync(env.data.export.sidecarPath, "utf8"));
    assert.equal(meta.datasetId, ds.id);
    assert.deepEqual(meta.columns, ["q", "clicks"]);
    assert.equal(meta.totalRows, 1);
    assert.ok(meta.exportedAt);
  } finally {
    if (prevExports === undefined) delete process.env.GSC_EXPORTS;
    else process.env.GSC_EXPORTS = prevExports;
    if (prevDataDir === undefined) delete process.env.GSC_DATA_DIR;
    else process.env.GSC_DATA_DIR = prevDataDir;
    const { rmSync } = await import("node:fs");
    rmSync(root, { recursive: true, force: true });
  }
});

test("export refuses when disabled and blocks traversal", async () => {
  delete process.env.GSC_EXPORTS;
  const { exportDataset } = await import("../dist/gsc/export.js");
  const root = mkdtempSync(join(tmpdir(), "gsc-export-"));
  assert.throws(() => exportDataset(root, "x", "json", ["a"], [], {}), /GSC_EXPORTS=1/);
  process.env.GSC_EXPORTS = "1";
  try {
    const r = exportDataset(root, "../../evil", "json", ["a"], [], {});
    assert.ok(r.path.startsWith(join(root, "exports") + sep));
    assert.throws(() => exportDataset(root, "x", "xml", ["a"], [], {}), /INVALID_ARGUMENT/);
  } finally {
    delete process.env.GSC_EXPORTS;
  }
});

test("T14 exports a stored dataset end to end", async () => {
  const previousDataDir = process.env.GSC_DATA_DIR;
  const isolatedDataDir = mkdtempSync(join(tmpdir(), "gsc-export-e2e-"));
  process.env.GSC_DATA_DIR = isolatedDataDir;
  process.env.GSC_EXPORTS = "1";
  try {
    const store = new DatasetStore();
    const ds = store.create("test", ["q", "clicks"], [{ q: "a", clicks: 1 }]);
    const env = await tools.gscExportDataset({ datasetId: ds.id, format: "json", name: "t14" }, { store, profileAlias: "test" });
    assert.equal(env.status, "ok");
    assert.ok(existsSync(env.data.export.path));
    assert.equal(env.data.export.rows, 1);
    const gated = await tools.gscExportDataset({ datasetId: "nope" }, { store, profileAlias: "test" });
    assert.equal(gated.error.code, "DATASET_NOT_FOUND");
  } finally {
    delete process.env.GSC_EXPORTS;
    if (previousDataDir === undefined) delete process.env.GSC_DATA_DIR; else process.env.GSC_DATA_DIR = previousDataDir;
    rmSync(isolatedDataDir, { recursive: true, force: true });
  }
});
