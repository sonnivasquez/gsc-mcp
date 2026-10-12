import assert from "node:assert/strict";
import test from "node:test";

const tools = await import("../dist/gsc/tools.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");

const SITE = "sc-domain:example.com";
const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};

function byDims(routes) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const key = `${(body.dimensions ?? []).join(",")}|${body.startDate}`;
    const hit = routes[key] ?? routes[(body.dimensions ?? []).join(",")];
    if (!hit) throw new Error(`unexpected query ${key}`);
    return new Response(JSON.stringify(hit), { status: 200 });
  };
}

const deps = (fetchImpl, store) => ({ provider, fetchImpl, store, profileAlias: "test" });

test("T04 totals come from the aggregate row with timeline and comparison", async () => {
  const store = new DatasetStore();
  const fetchImpl = byDims({
    "|2026-08-01": { rows: [{ keys: [], clicks: 1000, impressions: 10000, ctr: 0.1, position: 7.5 }] },
    "|2026-07-01": { rows: [{ keys: [], clicks: 800, impressions: 9000, ctr: 0.088, position: 8 }] },
    "date|2026-08-01": { rows: [{ keys: ["2026-08-01"], clicks: 100, impressions: 1000, ctr: 0.1, position: 7 }] },
  });
  const env = await tools.gscPerformanceOverview(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", includeComparison: true, baseline: { startDate: "2026-07-01", endDate: "2026-07-28" } },
    deps(fetchImpl, store)
  );
  assert.equal(env.status, "ok");
  assert.deepEqual(env.data.totals, { clicks: 1000, impressions: 10000, ctr: 0.1, position: 7.5 });
  assert.equal(env.data.timeline.length, 1);
  assert.equal(env.data.comparison.deltaClicks, 200);
  assert.equal(env.meta.sources.length, 2);
  assert.equal(env.meta.provenance.source, "google_search_console");
});

test("T04 works without timeline or comparison", async () => {
  const fetchImpl = byDims({ "|2026-08-01": { rows: [] } });
  const env = await tools.gscPerformanceOverview(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", includeTimeline: false },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.data.timeline, undefined);
  assert.deepEqual(env.data.totals, { clicks: 0, impressions: 0, ctr: null, position: null });
  assert.equal(env.data.comparison, null);
});
test("T04 overview shares one request budget across totals and timeline", async () => {
  const counting = (routes) => {
    let n = 0;
    const impl = async (url, init) => {
      n++;
      return byDims(routes)(url, init);
    };
    return { impl, count: () => n };
  };
  const rows = (clicks) => ({ rows: [{ keys: [], clicks, impressions: 1000, ctr: clicks / 1000, position: 5 }] });
  const dateRows = { rows: [{ keys: ["2026-08-01"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] };
  {
    const c = counting({ "|2026-08-01": rows(100), "date|2026-08-01": dateRows });
    const env = await tools.gscPerformanceOverview(
      { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-07" },
      deps(c.impl, new DatasetStore())
    );
    assert.equal(env.status, "ok");
    assert.equal(c.count(), 2);
    assert.equal(env.meta.googleDataAttempts, 2);
  }
  {
    const c = counting({
      "|2026-08-01": rows(100),
      "|2026-07-01": rows(80),
      "date|2026-08-01": dateRows,
    });
    const env = await tools.gscPerformanceOverview(
      {
        siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-07",
        includeComparison: true, baseline: { startDate: "2026-07-01", endDate: "2026-07-07" },
      },
      deps(c.impl, new DatasetStore())
    );
    assert.equal(env.status, "ok");
    assert.equal(c.count(), 3);
    assert.equal(env.meta.googleDataAttempts, 3);
  }
  {
    const c = counting({ "|2026-08-01": rows(100) });
    const env = await tools.gscPerformanceOverview(
      { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-07", includeTimeline: false },
      deps(c.impl, new DatasetStore())
    );
    assert.equal(env.status, "ok");
    assert.equal(c.count(), 1);
    assert.equal(env.meta.googleDataAttempts, 1);
  }
});

test("T04 overview budget cap surfaces timeline exhaustion without extra fetch", async () => {
  const { RequestBudget } = await import("../dist/gsc/budget.js");
  let n = 0;
  const fetchImpl = byDims({
    "|2026-08-01": { rows: [{ keys: [], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }] },
    "date|2026-08-01": { rows: [{ keys: ["2026-08-01"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] },
  });
  const counting = async (url, init) => {
    n++;
    return fetchImpl(url, init);
  };
  const env = await tools.gscPerformanceOverview(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-07" },
    { provider, fetchImpl: counting, store: new DatasetStore(), profileAlias: "test", budget: new RequestBudget(1) }
  );
  assert.equal(env.status, "error");
  assert.equal(env.error.code, "REQUEST_BUDGET_EXCEEDED");
  assert.equal(n, 1);
});

test("T04 overview retry accounting spans totals and timeline", async () => {
  let n = 0;
  const totals = { rows: [{ keys: [], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }] };
  const timeline = { rows: [{ keys: ["2026-08-01"], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] };
  const fetchImpl = async (url, init) => {
    n++;
    if (n === 1) return new Response(JSON.stringify({ error: { code: 429, message: "throttled" } }), { status: 429, headers: { "Retry-After": "0" } });
    const body = JSON.parse(init.body);
    const key = `${(body.dimensions ?? []).join(",")}|${body.startDate}`;
    const hit = key.startsWith("date|") ? timeline : totals;
    return new Response(JSON.stringify(hit), { status: 200 });
  };
  const env = await tools.gscPerformanceOverview(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-07" },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  assert.equal(n, 3);
  assert.equal(env.meta.googleDataAttempts, 3);
});

test("T05 compares dimensions with blocks and registers a dataset", async () => {
  const store = new DatasetStore();
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const rows =
      body.startDate === "2026-08-01"
        ? [{ keys: ["a"], clicks: 150, impressions: 2000, ctr: 0.075, position: 8 }]
        : [{ keys: ["a"], clicks: 100, impressions: 1000, ctr: 0.1, position: 10 }];
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  const env = await tools.gscComparePeriods(
    { siteUrl: SITE, dimension: "page", startDate: "2026-08-01", endDate: "2026-08-28", baseline: "previous_period" },
    deps(fetchImpl, store)
  );
  assert.equal(env.status, "ok");
  assert.equal(env.data.compared[0].deltaClicks, 50);
  assert.equal(env.data.comparedTotal, 1);
  assert.equal(env.meta.coverage.sortAppliedTo, "retrieved_dataset");
  assert.ok(env.meta.datasetId);
  const page = await tools.gscGetDataset({ datasetId: env.meta.datasetId }, { store, profileAlias: "test" });
  assert.equal(page.status, "ok");
});

test("T05 dimension none compares totals", async () => {
  const fetchImpl = byDims({
    "|2026-08-01": { rows: [{ keys: [], clicks: 150, impressions: 2000, ctr: 0.075, position: 8 }] },
    "|2026-07-01": { rows: [{ keys: [], clicks: 100, impressions: 1000, ctr: 0.1, position: 10 }] },
  });
  const env = await tools.gscComparePeriods(
    { siteUrl: SITE, dimension: "none", startDate: "2026-08-01", endDate: "2026-08-28", baseline: { startDate: "2026-07-01", endDate: "2026-07-28" } },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.data.deltaClicks, 50);
  assert.equal(env.data.deltaClicksPct, 50);
});

test("T05 rejects bad dimension without fetching", async () => {
  let calls = 0;
  const env = await tools.gscComparePeriods(
    { siteUrl: SITE, dimension: "keyword", startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(async () => (calls++, new Response("{}", { status: 200 })), new DatasetStore())
  );
  assert.equal(env.error.code, "INVALID_ARGUMENT");
  assert.equal(calls, 0);
});

test("T06/T07 send exact equality filters", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  const d = deps(fetchImpl, new DatasetStore());
  await tools.gscPageQueries({ siteUrl: SITE, pageUrl: "https://example.com/p", startDate: "2026-08-01", endDate: "2026-08-28" }, d);
  await tools.gscQueryPages({ siteUrl: SITE, query: "exact query", startDate: "2026-08-01", endDate: "2026-08-28" }, d);
  assert.deepEqual(seen[0].dimensions, ["query"]);
  assert.deepEqual(seen[0].dimensionFilterGroups[0].filters, [{ dimension: "page", operator: "equals", expression: "https://example.com/p" }]);
  assert.deepEqual(seen[1].dimensions, ["page"]);
  assert.deepEqual(seen[1].dimensionFilterGroups[0].filters, [{ dimension: "query", operator: "equals", expression: "exact query" }]);
  const bad = await tools.gscPageQueries({ siteUrl: SITE, pageUrl: " ", startDate: "2026-08-01", endDate: "2026-08-28" }, d);
  assert.equal(bad.error.code, "INVALID_ARGUMENT");
});
