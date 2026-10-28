import assert from "node:assert/strict";
import test from "node:test";

const tools = await import("../dist/gsc/tools.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");
const { RequestBudget } = await import("../dist/gsc/budget.js");

const SITE = "sc-domain:example.com";
const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};

function router(routes) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const key = `${(body.dimensions ?? []).join(",")}|${body.startDate}|${body.type ?? "web"}`;
    const hit = routes[key] ?? routes[(body.dimensions ?? []).join(",")];
    if (!hit) throw new Error(`unexpected query ${key}`);
    return new Response(JSON.stringify({ rows: hit }), { status: 200 });
  };
}

const rows = {
  "|2026-08-01|web": [{ keys: [], clicks: 1000, impressions: 10000, ctr: 0.1, position: 7 }],
  "page|2026-08-01|web": [{ keys: ["/page"], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
  "page|2026-07-04|web": [{ keys: ["/page"], clicks: 80, impressions: 900, ctr: 0.08, position: 6 }],
  "query|2026-08-01|web": [{ keys: ["web-query"], clicks: 60, impressions: 600, ctr: 0.1, position: 9 }],
  "query|2026-08-01|image": [{ keys: ["image-query"], clicks: 1, impressions: 500, ctr: 0.002, position: 9 }],
};

test("gscGenerateReport reports real attempts and aggregated sources", async () => {
  const fetchImpl = router(rows);
  const budget = new RequestBudget();
  const env = await tools.gscGenerateReport(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", save: false },
    { provider, fetchImpl, budget, store: new DatasetStore(), profileAlias: "test" }
  );
  assert.equal(env.status, "ok");
  assert.equal(env.meta.provenance.source, "local_dataset");
  assert.ok(env.meta.googleDataAttempts > 0);
  assert.equal(env.meta.googleDataAttempts, budget.attemptsUsed);
  assert.ok(Array.isArray(env.meta.sources) && env.meta.sources.length > 0);
  assert.ok(env.meta.sources.some((s) => s.source === "google_search_console"));
  for (const s of env.meta.sources) {
    assert.ok(!("servedAt" in s));
  }
});

test("gscGenerateReport with limitations-only makes no Google attempts", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  const budget = new RequestBudget();
  const env = await tools.gscGenerateReport(
    { siteUrl: SITE, sections: ["limitations"], startDate: "2026-08-01", endDate: "2026-08-28", save: false },
    { provider, fetchImpl, budget, store: new DatasetStore(), profileAlias: "test" }
  );
  assert.equal(env.status, "ok");
  assert.equal(env.meta.googleDataAttempts, 0);
  assert.equal(budget.attemptsUsed, 0);
  assert.equal(calls, 0);
  assert.deepEqual(env.meta.sources ?? [], []);
});
