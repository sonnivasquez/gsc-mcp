import assert from "node:assert/strict";
import test from "node:test";

const { ok } = await import("../dist/gsc/envelope.js");

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

test("unshrinkable CJK envelope warns despite UTF-16 length fitting", () => {
  const r = ok({ text: "漢".repeat(20000) }, { source: "local_status", fetchedAt: null });
  assert.ok(bytes(r) > 49152, `expected oversize envelope, got ${bytes(r)}`);
  assert.ok(r.meta.warnings.some((w) => w.code === "SIZE_TRIMMED"));
  assert.equal(r.data.text, "漢".repeat(20000));
});

test("same count of ASCII characters does not warn", () => {
  const r = ok({ text: "x".repeat(20000) }, { source: "local_status", fetchedAt: null });
  assert.ok(!r.meta.warnings.some((w) => w.code === "SIZE_TRIMMED"));
  assert.equal(r.data.text, "x".repeat(20000));
});

test("metadata-heavy envelope warns even when data alone fits", () => {
  const r = ok({ text: "x".repeat(40000) }, { source: "local_status", fetchedAt: null }, {
    warnings: [{ code: "NOTE", message: "m", details: { pad: "y".repeat(12000) } }],
  });
  assert.ok(bytes(r) > 49152);
  assert.ok(r.meta.warnings.some((w) => w.code === "SIZE_TRIMMED"));
  assert.ok(r.meta.warnings.some((w) => w.code === "NOTE"));
});

test("shrinkable unicode rows fit with truthful coverage and recoverable dataset", async () => {
  const tools = await import("../dist/gsc/tools.js");
  const { DatasetStore } = await import("../dist/gsc/datasets.js");
  const wide = Array.from({ length: 200 }, (_, i) => ({
    keys: [`漢字クエリ-${i}-` + "あ".repeat(120)],
    clicks: (i + 1) * 3,
    impressions: (i + 1) * 50,
    ctr: 0.06,
    position: 5 + (i % 10),
  }));
  const fetchImpl = async () => new Response(JSON.stringify({ rows: wide }), { status: 200 });
  const store = new DatasetStore();
  const env = await tools.gscSearchAnalytics(
    {
      siteUrl: "sc-domain:example.com", startDate: "2026-08-01", endDate: "2026-08-28",
      dimensions: ["query"], resultLimit: 200,
    },
    { provider: { getAccessToken: async () => "tok" }, fetchImpl, store, profileAlias: "test" }
  );
  assert.equal(env.status, "ok");
  assert.ok(Buffer.byteLength(JSON.stringify(env), "utf8") <= 49152);
  assert.equal(env.meta.coverage.returnedRows, env.data.rows.length);
  assert.equal(env.meta.coverage.truncatedByProduct, true);
  const warn = env.meta.warnings.find((w) => w.code === "SOURCE_NOT_EXHAUSTIVE");
  assert.equal(warn.details.returnedRows, env.data.rows.length);
  const page = await tools.gscGetDataset({ datasetId: env.meta.datasetId, limit: 200 }, { store, profileAlias: "test" });
  assert.equal(page.data.totalRows, 200);
});
