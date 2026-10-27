import assert from "node:assert/strict";
import test from "node:test";

const { FetchGscDataSource } = await import("../dist/gsc/client.js");
const { GscError } = await import("../dist/gsc/errors.js");
const { gscSearchAnalytics } = await import("../dist/gsc/tools.js");
const { DatasetStore } = await import("../dist/gsc/datasets.js");
const { fetchAllRows } = await import("../dist/analytics.js");
const { setInstanceAllowlist } = await import("../dist/profiles.js");

const SITE = "sc-domain:example.com";
const provider = { getAccessToken: async () => "tok", describe: () => ({ mode: "oauth", scopeTier: "readonly" }) };
const range = { startDate: "2026-08-01", endDate: "2026-08-28" };

function source(calls) {
  return new FetchGscDataSource(provider, {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    },
  });
}

async function rejected(query, pattern) {
  const calls = [];
  await assert.rejects(source(calls).queryAnalytics(SITE, { ...range, dimensions: ["page"], ...query }), (err) => {
    assert.ok(err instanceof GscError);
    assert.equal(err.code, "INVALID_ARGUMENT");
    assert.match(err.message, pattern);
    assert.match(err.suggestedAction, /Remove|Group|Filter|Use aggregationType/);
    return true;
  });
  assert.equal(calls.length, 0);
}

async function accepted(query) {
  const calls = [];
  const result = await source(calls).queryAnalytics(SITE, { ...range, dimensions: ["page"], ...query });
  assert.equal(result.rows.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], "searchType"), false);
  return calls[0];
}

test("discover rejects query and device before the Google call", async () => {
  await rejected({ dimensions: ["query"], searchType: "discover" }, /type "discover" does not support the query dimension/);
  await rejected(
    {
      dimensions: ["page"],
      searchType: "discover",
      filters: [{ dimension: "device", operator: "equals", expression: "MOBILE" }],
    },
    /type "discover" does not support the device dimension/,
  );
  const body = await accepted({ dimensions: ["page"], searchType: "discover" });
  assert.equal(body.type, "discover");
});

test("news and googleNews reject query and still allow device", async () => {
  await rejected({ dimensions: ["query"], searchType: "googleNews" }, /type "googleNews" does not support the query dimension/);
  await rejected(
    {
      dimensions: ["country"],
      searchType: "news",
      filters: [{ dimension: "query", operator: "contains", expression: "seo" }],
    },
    /type "news" does not support the query dimension/,
  );
  const body = await accepted({ dimensions: ["device"], searchType: "googleNews" });
  assert.equal(body.type, "googleNews");
});

test("searchAppearance is grouped alone and filtered with equals", async () => {
  await rejected(
    { dimensions: ["searchAppearance", "page"], searchType: "web" },
    /searchAppearance cannot be grouped with other dimensions/,
  );
  await rejected(
    {
      dimensions: ["page"],
      searchType: "web",
      filters: [{ dimension: "searchAppearance", operator: "contains", expression: "AMP" }],
    },
    /searchAppearance filters must use operator "equals"/,
  );
  const alone = await accepted({ dimensions: ["searchAppearance"], searchType: "web" });
  assert.deepEqual(alone.dimensions, ["searchAppearance"]);
  assert.equal(alone.type, "web");
  const filtered = await accepted({
    dimensions: ["device"],
    searchType: "web",
    filters: [{ dimension: "searchAppearance", operator: "equals", expression: "AMP_BLUE_LINK" }],
  });
  assert.equal(filtered.dimensionFilterGroups[0].filters[0].operator, "equals");
});

test("byProperty is rejected for discover and googleNews and sent for news", async () => {
  await rejected(
    { dimensions: ["page"], searchType: "discover", aggregationType: "byProperty" },
    /aggregationType "byProperty" is not supported for type "discover"/,
  );
  await rejected(
    { dimensions: ["page"], searchType: "googleNews", aggregationType: "byProperty" },
    /aggregationType "byProperty" is not supported for type "googleNews"/,
  );
  const body = await accepted({ dimensions: ["page"], searchType: "news", aggregationType: "byProperty" });
  assert.equal(body.type, "news");
  assert.equal(body.aggregationType, "byProperty");
});

test("tool input searchType is mapped to type and the tool returns the rule error", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  const deps = { provider, fetchImpl, store: new DatasetStore(), profileAlias: "rules" };
  const image = await gscSearchAnalytics({ ...range, siteUrl: SITE, dimensions: ["query"], searchType: "image" }, deps);
  assert.equal(image.status, "ok");
  assert.equal(calls[0].type, "image");
  assert.equal(Object.hasOwn(calls[0], "searchType"), false);

  calls.length = 0;
  const blocked = await gscSearchAnalytics(
    { ...range, siteUrl: SITE, dimensions: ["query"], searchType: "discover" },
    deps,
  );
  assert.equal(blocked.status, "error");
  assert.equal(blocked.error.code, "INVALID_ARGUMENT");
  assert.match(blocked.error.message, /Remove query from dimensions and filters/);
  assert.match(blocked.error.suggestedAction, /group Discover by page, country, date, or searchAppearance/);
  assert.equal(calls.length, 0);
});

test("fetchAllRows rejects a Discover query before calling the client", async () => {
  setInstanceAllowlist(null);
  let calls = 0;
  await assert.rejects(
    () => fetchAllRows(
      { ...range, dimensions: ["query"], type: "discover" },
      SITE,
      { searchanalytics: { query: async () => { calls += 1; return { data: { rows: [] } }; } } },
    ),
    (err) => {
      assert.ok(err instanceof GscError);
      assert.match(err.message, /type "discover" does not support the query dimension/);
      return true;
    },
  );
  assert.equal(calls, 0);
  setInstanceAllowlist(null);
});
