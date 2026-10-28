import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tools = await import("../dist/gsc/tools.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");
const { RequestBudget } = await import("../dist/gsc/budget.js");

const SITE = "sc-domain:example.com";
const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};
const deps = (fetchImpl, store) => ({ provider, fetchImpl, store, profileAlias: "test" });

function router(routes) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const key = `${(body.dimensions ?? []).join(",")}|${body.startDate}|${body.type ?? "web"}`;
    const hit = routes[key] ?? routes[(body.dimensions ?? []).join(",")];
    if (!hit) throw new Error(`unexpected query ${key}`);
    if (hit.status) return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status });
    return new Response(JSON.stringify({ rows: hit }), { status: 200 });
  };
}

const DROP_CURRENT = [
  { keys: ["/rank"], clicks: 100, impressions: 2000, ctr: 0.05, position: 9 },
  { keys: ["/ctr"], clicks: 100, impressions: 2000, ctr: 0.05, position: 5.5 },
  { keys: ["/demand"], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
  { keys: ["/up"], clicks: 150, impressions: 2000, ctr: 0.075, position: 8 },
];
const DROP_PRIOR = [
  { keys: ["/rank"], clicks: 200, impressions: 2000, ctr: 0.1, position: 5 },
  { keys: ["/ctr"], clicks: 200, impressions: 2000, ctr: 0.1, position: 5 },
  { keys: ["/demand"], clicks: 200, impressions: 2000, ctr: 0.1, position: 5 },
  { keys: ["/up"], clicks: 100, impressions: 1000, ctr: 0.1, position: 10 },
  { keys: ["/gone"], clicks: 50, impressions: 800, ctr: 0.0625, position: 7 },
];

test("T15 separates ranking, CTR and demand signals without causes", async () => {
  const fetchImpl = router({ "page|2026-08-01|web": DROP_CURRENT, page: DROP_PRIOR });
  const env = await tools.gscAnalyzeTrafficDrop(
    { siteUrl: SITE, dimension: "page", startDate: "2026-08-01", endDate: "2026-08-28", baseline: "previous_period" },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  const byKey = new Map(env.data.drops.map((d) => [d.key, d]));
  assert.match(byKey.get("/rank").observedSignals[0], /position/);
  assert.match(byKey.get("/ctr").observedSignals[0], /CTR/);
  assert.match(byKey.get("/demand").observedSignals[0], /impressions/);
  assert.ok(!byKey.has("/up"));
  assert.equal(env.data.vanished[0].key, "/gone");
  assert.ok(env.meta.warnings.some((w) => w.code === "NO_CAUSALITY"));
  assert.equal(env.meta.sources.length, 2);
});

test("T16 flags three-window declines per surface", async () => {
  const w = (clicks) => [{ keys: ["/p"], clicks, impressions: 1000, ctr: 0.1, position: 5 }];
  const fetchImpl = router({
    "page|2026-08-02|web": w(50),
    "page|2026-07-05|web": w(80),
    "page|2026-06-07|web": w(120),
  });
  const env = await tools.gscContentDecay(
    { siteUrl: SITE, startDate: "2026-08-02", endDate: "2026-08-29", windowDays: 28 },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.data.candidates.length, 1);
  assert.deepEqual(env.data.windows.map((x) => x.startDate), ["2026-06-07", "2026-07-05", "2026-08-02"]);
  assert.deepEqual([env.data.candidates[0].clicks, env.data.candidates[0].impressions, env.data.candidates[0].ctr, env.data.candidates[0].position], [50, 1000, 5, 5]);
});

test("T17 emits stable severity-rated alert ids", async () => {
  const fetchImpl = router({ "page|2026-08-01|web": DROP_CURRENT, page: DROP_PRIOR });
  const d = deps(fetchImpl, new DatasetStore());
  const a = await tools.gscCheckAlerts(
    { siteUrl: SITE, dimension: "page", startDate: "2026-08-01", endDate: "2026-08-28", baseline: "previous_period" },
    d
  );
  const b = await tools.gscCheckAlerts(
    { siteUrl: SITE, dimension: "page", startDate: "2026-08-01", endDate: "2026-08-28", baseline: "previous_period" },
    d
  );
  assert.deepEqual(a.data.alerts.map((x) => x.id), b.data.alerts.map((x) => x.id));
  const gone = a.data.alerts.find((x) => x.rule === "not_observed");
  assert.equal(gone.severity, "warning");
  assert.ok(a.data.alerts.some((x) => x.rule === "click_loss" && x.severity === "warning"));
  assert.equal(a.data.ruleVersion, "t17.1");
});

test("T18 returns observed pages with unknown content presence", async () => {
  const fetchImpl = router({
    "query|2026-08-01|web": [
      { keys: ["gap"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 },
      { keys: ["fine"], clicks: 50, impressions: 500, ctr: 0.1, position: 5 },
    ],
    "page|2026-08-01|web": [{ keys: ["https://example.com/g"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 }],
  });
  const env = await tools.gscContentCandidates(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.data.candidatesTotal, 1);
  assert.deepEqual(env.data.candidates[0].observedPages, ["https://example.com/g"]);
  assert.equal(env.data.candidates[0].contentPresence, "unknown");
});

test("T20 isolates per-site failures with a shared budget", async () => {
  const fetchImpl = router({
    "|2026-08-01|web": [{ keys: [], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }],
  });
  const mixed = async (url, init) => {
    if (url.includes("sc-domain%3Abad.example")) {
      return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
    }
    return fetchImpl(url, init);
  };
  const env = await tools.gscMultiSiteOverview(
    { sites: ["sc-domain:good.example", "sc-domain:bad.example"], startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(mixed, new DatasetStore())
  );
  assert.equal(env.status, "partial");
  assert.equal(env.data.sites.length, 2);
  const bad = await tools.gscMultiSiteOverview({ sites: [], startDate: "2026-08-01", endDate: "2026-08-28" }, deps(mixed, new DatasetStore()));
  assert.equal(bad.status, "error");
  assert.equal(bad.error.code, "INVALID_ARGUMENT");
});

test("T20 fetches repeated exact properties once while retaining every result", async () => {
  const site = "sc-domain:repeat.example";
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ rows: [{ keys: [], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] }), { status: 200 });
  };
  const input = { sites: [site, site], startDate: "2026-08-01", endDate: "2026-08-28" };
  const plain = await tools.gscMultiSiteOverview(input, deps(fetchImpl, new DatasetStore()));
  assert.equal(plain.status, "ok");
  assert.deepEqual(plain.data.sites.map((entry) => entry.siteUrl), [site, site]);
  assert.equal(requests.length, 1);
  assert.equal(plain.meta.googleDataAttempts, 1);
  requests.length = 0;
  const compared = await tools.gscMultiSiteOverview({ ...input, includeComparison: true }, deps(fetchImpl, new DatasetStore()));
  assert.equal(compared.status, "ok");
  assert.equal(compared.data.sites.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(compared.meta.googleDataAttempts, 2);
  requests.length = 0;
  const later = await tools.gscMultiSiteOverview(input, deps(fetchImpl, new DatasetStore()));
  assert.equal(later.status, "ok");
  assert.equal(requests.length, 1);
});

test("T20 projects duplicate failures and keeps exact domain and prefix properties distinct", async () => {
  const a = "sc-domain:a.example";
  const b = "sc-domain:b.example";
  const prefix = "https://a.example/";
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    if (url.includes(encodeURIComponent(a))) {
      return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
    }
    return new Response(JSON.stringify({ rows: [{ keys: [], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] }), { status: 200 });
  };
  const input = { sites: [a, b, a], startDate: "2026-08-01", endDate: "2026-08-28" };
  const partial = await tools.gscMultiSiteOverview(input, deps(fetchImpl, new DatasetStore()));
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.data.sites.map((entry) => [entry.siteUrl, entry.status]), [[a, "error"], [a, "error"], [b, "ok"]]);
  assert.match(partial.meta.warnings.find((warning) => warning.code === "PARTIAL").message, /2 of 3 properties failed/);
  assert.equal(requests.length, 2);
  assert.equal(requests.filter(({ url }) => url.includes(encodeURIComponent(a))).length, 1);
  assert.equal(partial.meta.googleDataAttempts, requests.length);

  requests.length = 0;
  const distinct = await tools.gscMultiSiteOverview({ ...input, sites: [prefix, a] }, deps(fetchImpl, new DatasetStore()));
  assert.equal(requests.length, 2);
  assert.equal(distinct.meta.googleDataAttempts, 2);
  assert.deepEqual(distinct.data.sites.map((entry) => entry.siteUrl), [prefix, a].sort());
  assert.ok(requests.some(({ url }) => url.includes(encodeURIComponent(prefix))));
  assert.ok(requests.every(({ body }) => body.dimensions.length === 0));
});

test("T20 schedules first unique sites in input order with at most three active calls", async () => {
  const sites = ["sc-domain:c.example", "sc-domain:a.example", "sc-domain:b.example", "sc-domain:d.example", "sc-domain:e.example"];
  const started = [];
  const pending = [];
  let active = 0;
  let peak = 0;
  const fetchImpl = (url) => new Promise((resolve) => {
    started.push(sites.find((site) => url.includes(encodeURIComponent(site))));
    active++;
    peak = Math.max(peak, active);
    pending.push(() => {
      active--;
      resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    });
  });
  const run = tools.gscMultiSiteOverview(
    { sites, startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(fetchImpl, new DatasetStore())
  );
  await Promise.resolve();
  assert.deepEqual(started, sites.slice(0, 3));
  assert.equal(active, 3);
  while (pending.length) {
    pending.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const env = await run;
  assert.equal(env.status, "ok");
  assert.equal(peak, 3);
  assert.equal(started.length, 5);
  assert.deepEqual(env.data.sites.map((entry) => entry.siteUrl), [...sites].sort());
  assert.equal(env.meta.googleDataAttempts, 5);
});

test("T20 shares an injected attempt budget across five input occurrences", async () => {
  const sites = ["sc-domain:a.example", "sc-domain:b.example", "sc-domain:a.example", "sc-domain:c.example", "sc-domain:d.example"];
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  const budget = new RequestBudget(2);
  const env = await tools.gscMultiSiteOverview(
    { sites, startDate: "2026-08-01", endDate: "2026-08-28" },
    { ...deps(fetchImpl, new DatasetStore()), budget }
  );
  assert.equal(env.status, "partial");
  assert.equal(env.data.sites.length, 5);
  assert.equal(attempts, 2);
  assert.equal(budget.attemptsUsed, 2);
  assert.equal(env.meta.googleDataAttempts, attempts);
  assert.equal(env.data.sites.filter((entry) => entry.status !== "ok").length, 2);
  assert.match(env.meta.warnings.find((warning) => warning.code === "PARTIAL").message, /2 of 5 properties failed/);
  const tooMany = await tools.gscMultiSiteOverview(
    { sites: [...sites, "sc-domain:e.example"], startDate: "2026-08-01", endDate: "2026-08-28" },
    { ...deps(fetchImpl, new DatasetStore()), budget }
  );
  assert.equal(tooMany.status, "error");
  assert.equal(tooMany.error.code, "INVALID_ARGUMENT");
  assert.equal(attempts, 2);
});

test("T19 combines categories with evidence and no auto-actions", async () => {
  const fetchImpl = router({
    "query|2026-08-01|web": [{ keys: ["q"], clicks: 60, impressions: 600, ctr: 0.1, position: 9 }],
    "query,page|2026-08-01|web": [
      { keys: ["q", "https://example.com/a"], clicks: 60, impressions: 600, ctr: 0.1, position: 4 },
      { keys: ["q", "https://example.com/b"], clicks: 40, impressions: 400, ctr: 0.1, position: 6 },
    ],
    "page|2026-08-01|web": [{ keys: ["https://example.com/a"], clicks: 60, impressions: 600, ctr: 0.1, position: 4 }],
  });
  const env = await tools.gscContentRecommendations(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(fetchImpl, new DatasetStore())
  );
  assert.equal(env.status, "ok");
  const kinds = env.data.recommendations.map((r) => r.actionCandidate);
  assert.ok(kinds.includes("update"));
  assert.ok(kinds.includes("consolidate"));
  assert.ok(env.data.recommendations.every((r) => r.evidence.length > 0 && r.checksBeforeAction.length > 0));
});

test("T19 characterizes category queries, expansions, and evidence", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const dims = body.dimensions.join(",");
    const rows = dims === "query"
      ? [
          { keys: ["near"], clicks: 60, impressions: 600, ctr: 0.1, position: 9 },
          { keys: ["gap"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 },
        ]
      : dims === "page"
        ? [{ keys: ["https://example.com/gap"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 }]
        : [
            { keys: ["shared", "https://example.com/a"], clicks: 60, impressions: 600, ctr: 0.1, position: 4 },
            { keys: ["shared", "https://example.com/b"], clicks: 40, impressions: 400, ctr: 0.1, position: 6 },
          ];
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  const input = { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28" };
  for (const [categories, queryCount, pageCount, pairCount, actions] of [
    [["update", "create"], 1, 1, 0, ["update:near", "create:gap"]],
    [["update"], 1, 0, 0, ["update:near"]],
    [["create"], 1, 1, 0, ["create:gap"]],
    [["consolidate"], 0, 0, 1, ["consolidate:shared"]],
  ]) {
    calls.length = 0;
    const budget = new RequestBudget();
    const env = await tools.gscContentRecommendations({ ...input, categories }, { ...deps(fetchImpl, new DatasetStore()), budget });
    assert.equal(env.status, "ok");
    assert.equal(env.meta.provenance.source, "google_search_console");
    assert.equal(env.meta.warnings[0].code, "CANDIDATE");
    assert.deepEqual(env.data.recommendations.map((r) => `${r.actionCandidate}:${r.entity}`), actions);
    assert.equal(env.data.recommendationsTotal, actions.length);
    assert.ok(env.data.recommendations.every((r) => r.evidence.length === 1 && r.checksBeforeAction.length > 0));
    assert.equal(calls.filter(({ body }) => body.dimensions.join() === "query").length, queryCount);
    assert.equal(calls.filter(({ body }) => body.dimensions.join() === "page").length, pageCount);
    assert.equal(calls.filter(({ body }) => body.dimensions.join() === "query,page").length, pairCount);
    assert.equal(budget.attemptsUsed, calls.length);
    assert.equal(env.meta.googleDataAttempts, calls.length);
    assert.ok(calls.every(({ url, body }) => url.includes(encodeURIComponent(SITE)) && body.startDate === input.startDate && body.endDate === input.endDate && body.type === "web" && body.dataState === "final"));
    assert.ok(calls.filter(({ body }) => body.dimensions.join() === "page").every(({ body }) =>
      body.dimensionFilterGroups[0].filters[0].dimension === "query" &&
      body.dimensionFilterGroups[0].filters[0].operator === "equals" &&
      body.dimensionFilterGroups[0].filters[0].expression === "gap"
    ));
  }
});

test("T19 keeps query reuse within one invocation and its effective request", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const rows = body.dimensions.join() === "query"
      ? [{ keys: ["gap"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 }]
      : [{ keys: ["https://example.com/gap"], clicks: 5, impressions: 500, ctr: 0.01, position: 25 }];
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  const base = { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", categories: ["update", "create"] };
  for (const input of [
    base,
    { ...base, startDate: "2026-09-01", endDate: "2026-09-28", searchType: "image", maxFetchRows: 10,
      filters: [{ dimension: "country", operator: "equals", expression: "per" }] },
  ]) {
    const budget = new RequestBudget();
    const before = calls.length;
    const env = await tools.gscContentRecommendations(input, { ...deps(fetchImpl, new DatasetStore()), budget });
    assert.equal(env.status, "ok");
    assert.deepEqual(env.data.recommendations.map((r) => r.actionCandidate), ["create"]);
    assert.equal(calls.length - before, 2);
    assert.equal(budget.attemptsUsed, 2);
    assert.equal(env.meta.googleDataAttempts, 2);
  }
  const queries = calls.filter(({ body }) => body.dimensions.join() === "query");
  assert.equal(queries.length, 2);
  assert.notDeepEqual(queries[0], queries[1]);
  assert.equal(queries[1].body.startDate, "2026-09-01");
  assert.equal(queries[1].body.type, "image");
  assert.deepEqual(queries[1].body.dimensionFilterGroups[0].filters, [{ dimension: "country", operator: "equals", expression: "per" }]);
});

test("T19 retries the later category after a failed query and retains five expansions", async () => {
  const calls = [];
  let failFirst = true;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (failFirst) {
      failFirst = false;
      return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
    }
    const rows = body.dimensions.join() === "query"
      ? Array.from({ length: 5 }, (_, i) => ({ keys: [`gap-${i}`], clicks: 5, impressions: 500 - i, ctr: 0.01, position: 25 }))
      : [{ keys: [`https://example.com/${body.dimensionFilterGroups[0].filters[0].expression}`], clicks: 5, impressions: 500, ctr: 0.01, position: 25 }];
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  const budget = new RequestBudget();
  const env = await tools.gscContentRecommendations(
    { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", categories: ["update", "create"] },
    { ...deps(fetchImpl, new DatasetStore()), budget }
  );
  assert.equal(env.status, "ok");
  assert.equal(env.data.recommendationsTotal, 5);
  assert.ok(env.data.recommendations.every((r) => r.actionCandidate === "create" && r.evidence.length === 1));
  assert.equal(calls.filter(({ body }) => body.dimensions.join() === "query").length, 2);
  const expansions = calls.filter(({ body }) => body.dimensions.join() === "page");
  assert.deepEqual(expansions.map(({ body }) => body.dimensionFilterGroups[0].filters[0].expression), ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4"]);
  assert.equal(calls.length, 7);
  assert.equal(budget.attemptsUsed, 7);
  assert.equal(env.meta.googleDataAttempts, 7);
});

test("T21 assembles deterministic markdown and saves opt-in", async () => {
  const fetchImpl = router({
    "|2026-08-01|web": [{ keys: [], clicks: 1000, impressions: 10000, ctr: 0.1, position: 7 }],
    "page|2026-08-01|web": [{ keys: ["/a"], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
    "page|2026-07-04|web": [{ keys: ["/a"], clicks: 80, impressions: 900, ctr: 0.08, position: 6 }],
    "query|2026-08-01|web": [{ keys: ["q"], clicks: 60, impressions: 600, ctr: 0.1, position: 9 }],
  });
  const d = deps(fetchImpl, new DatasetStore());
  const env = await tools.gscGenerateReport(
    { siteUrl: SITE, sections: ["summary", "movers", "limitations"], startDate: "2026-08-01", endDate: "2026-08-28" },
    d
  );
  assert.match(env.data.content, /# Performance report/);
  assert.match(env.data.content, /## Summary/);
  assert.match(env.data.content, /## Limitations/);
  assert.ok(!("savedTo" in env.data));
  const twice = await tools.gscGenerateReport(
    { siteUrl: SITE, sections: ["summary"], startDate: "2026-08-01", endDate: "2026-08-28" },
    d
  );
  assert.equal(twice.data.content, (await tools.gscGenerateReport(
    { siteUrl: SITE, sections: ["summary"], startDate: "2026-08-01", endDate: "2026-08-28" },
    d
  )).data.content);
  process.env.GSC_EXPORTS = "1";
  process.env.GSC_DATA_DIR = mkdtempSync(join(tmpdir(), "gsc-report-"));
  try {
    const saved = await tools.gscGenerateReport(
      { siteUrl: SITE, sections: ["summary"], startDate: "2026-08-01", endDate: "2026-08-28", save: true },
      d
    );
    assert.ok(saved.data.savedTo.endsWith(".markdown"));
  } finally {
    delete process.env.GSC_EXPORTS;
    delete process.env.GSC_DATA_DIR;
  }
});

test("T21 characterizes report window calls and section subsets", async () => {
  const calls = [];
  const rows = {
    "|2026-08-01|web": [{ keys: [], clicks: 1000, impressions: 10000, ctr: 0.1, position: 7 }],
    "page|2026-08-01|web": [{ keys: ["/page"], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
    "page|2026-07-04|web": [{ keys: ["/page"], clicks: 80, impressions: 900, ctr: 0.08, position: 6 }],
    "query|2026-08-01|web": [{ keys: ["web-query"], clicks: 60, impressions: 600, ctr: 0.1, position: 9 }],
    "query|2026-08-01|image": [{ keys: ["image-query"], clicks: 1, impressions: 500, ctr: 0.002, position: 9 }],
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const key = `${body.dimensions.join(",")}|${body.startDate}|${body.type}`;
    assert.ok(rows[key], `unexpected request ${key}`);
    return new Response(JSON.stringify({ rows: rows[key] }), { status: 200 });
  };
  const budget = new RequestBudget();
  const d = { ...deps(fetchImpl, new DatasetStore()), budget };
  const input = { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", save: false };
  const all = await tools.gscGenerateReport(input, d);
  assert.equal(all.status, "ok");
  assert.equal(all.meta.provenance.source, "local_dataset");
  assert.equal(all.data.content, [
    `# Performance report: ${SITE}`, "",
    "## Summary", "Clicks 1000, impressions 10000.", "",
    "## Movers", "- /page: 20 clicks", "",
    "## Opportunities", "- web-query", "",
    "## Images", "- image-query", "",
    "## Alerts", "", "## Limitations",
    "Rows describe retrieved GSC data, not all searches. Positions are impression-weighted averages.", "",
  ].join("\n"));
  assert.equal(calls.length, 5);
  assert.equal(budget.attemptsUsed, calls.length);
  assert.equal(calls.filter(({ body }) => body.dimensions.join() === "page" && body.startDate === "2026-08-01").length, 1);
  assert.equal(calls.filter(({ body }) => body.dimensions.join() === "page" && body.startDate === "2026-07-04").length, 1);
  assert.equal(calls.filter(({ body }) => body.dimensions.length === 0).length, 1);
  assert.equal(calls.filter(({ body }) => body.dimensions.join() === "query" && body.type === "web").length, 1);
  assert.equal(calls.filter(({ body }) => body.dimensions.join() === "query" && body.type === "image").length, 1);
  assert.ok(calls.every(({ url, body }) => url.includes(encodeURIComponent(SITE)) && body.dataState === "final"));

  for (const [sections, expectedCalls] of [["movers", 2], ["alerts", 2], ["limitations", 0]]) {
    calls.length = 0;
    const subsetBudget = new RequestBudget();
    const one = await tools.gscGenerateReport({ ...input, sections: [sections] }, { ...d, budget: subsetBudget });
    assert.equal(one.status, "ok");
    assert.equal(calls.length, expectedCalls);
    assert.equal(calls.filter(({ body }) => body.dimensions.join() === "page").length, expectedCalls);
    assert.equal(subsetBudget.attemptsUsed, expectedCalls);
  }
});

test("T21 does not retain a failed page window or share one across reports", async () => {
  const calls = [];
  let failFirst = true;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (failFirst) {
      failFirst = false;
      return new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 });
    }
    const clicks = body.startDate === "2026-08-01" ? 10 : 100;
    return new Response(JSON.stringify({ rows: [{ keys: ["/page"], clicks, impressions: 1000, ctr: clicks / 1000, position: 5 }] }), { status: 200 });
  };
  const input = { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28", sections: ["movers", "alerts"] };
  const budget = new RequestBudget();
  const first = await tools.gscGenerateReport(input, { ...deps(fetchImpl, new DatasetStore()), budget });
  assert.equal(first.status, "ok");
  assert.match(first.data.content, /Movers unavailable\./);
  assert.match(first.data.content, /- \[warning\] \/page/);
  assert.equal(calls.length, 3);
  assert.equal(budget.attemptsUsed, 3);
  assert.deepEqual(calls.map(({ body }) => body.startDate), ["2026-08-01", "2026-08-01", "2026-07-04"]);

  calls.length = 0;
  const secondBudget = new RequestBudget();
  const second = await tools.gscGenerateReport(input, { ...deps(fetchImpl, new DatasetStore()), budget: secondBudget });
  assert.equal(second.status, "ok");
  assert.match(second.data.content, /- \/page: -90 clicks/);
  assert.equal(calls.length, 2);
  assert.equal(secondBudget.attemptsUsed, 2);
});

test("T22 verifies, contradicts and declines", async () => {
  const fetchImpl = router({ "|2026-08-01|web": [{ keys: [], clicks: 150, impressions: 2000, ctr: 0.075, position: 8 }] });
  const d = deps(fetchImpl, new DatasetStore());
  const base = { siteUrl: SITE, startDate: "2026-08-01", endDate: "2026-08-28" };
  const okV = await tools.gscVerifyClaim({ ...base, metric: "clicks", value: 150 }, d);
  assert.equal(okV.data.verification.verdict, "verified");
  const bad = await tools.gscVerifyClaim({ ...base, metric: "clicks", value: 100 }, d);
  assert.equal(bad.data.verification.verdict, "contradicted");
  const tol = await tools.gscVerifyClaim({ ...base, metric: "clicks", value: 100, toleranceRel: 0.6 }, d);
  assert.equal(tol.data.verification.verdict, "verified");
  const unk = await tools.gscVerifyClaim({ ...base, metric: "deltaClicks", value: 1 }, d);
  assert.equal(unk.data.verification.verdict, "unverifiable");
  const badMetric = await tools.gscVerifyClaim({ ...base, metric: "backlinks", value: 1 }, d);
  assert.equal(badMetric.error.code, "INVALID_ARGUMENT");
});

test("T23 joins surfaces with ratios and absent states", async () => {
  const fetchImpl = router({
    "query|2026-08-01|web": [{ keys: ["both"], clicks: 10, impressions: 1000, ctr: 0.01, position: 5 }],
    "query|2026-08-01|image": [
      { keys: ["both"], clicks: 2, impressions: 2000, ctr: 0.001, position: 3 },
      { keys: ["img-only"], clicks: 0, impressions: 500, ctr: 0, position: 6 },
    ],
  });
  const env = await tools.gscCompareWebImage(
    { siteUrl: SITE, dimension: "query", startDate: "2026-08-01", endDate: "2026-08-28" },
    deps(fetchImpl, new DatasetStore())
  );
  const byKey = new Map(env.data.rows.map((r) => [r.key, r]));
  assert.equal(byKey.get("both").imageVsWebImpressionsRatio, 2);
  assert.equal(byKey.get("img-only").web, null);
  assert.equal(env.data.rowsTotal, 2);
});
