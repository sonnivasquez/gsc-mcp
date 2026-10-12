import assert from "node:assert/strict";
import test from "node:test";

const ui = await import("../dist/tools/update-impact.js");
const tools = await import("../dist/gsc/tools.js");
const { RequestBudget } = await import("../dist/gsc/budget.js");

const SITE = "sc-domain:example.com";
const WINDOW = { startDate: "2024-03-01", endDate: "2024-03-31" };
const BASELINE = { startDate: "2024-02-01", endDate: "2024-02-29" };

const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};

function rss(items) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0"><channel><title>Google Search Status Dashboard</title>` +
    items.join("") +
    `</channel></rss>`
  );
}

const item = (title, link, pubDate) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate></item>`;

const CORE_ITEM = item(
  "March 2024 core update",
  "https://status.search.google.com/incidents/core-mar-2024",
  "Tue, 05 Mar 2024 12:00:00 GMT"
);
const SPAM_ITEM = item(
  "March 2024 spam update",
  "https://status.search.google.com/incidents/spam-mar-2024",
  "Wed, 20 Mar 2024 12:00:00 GMT"
);
const OLD_ITEM = item(
  "October 2023 spam update",
  "https://status.search.google.com/incidents/spam-oct-2023",
  "Wed, 04 Oct 2023 12:00:00 GMT"
);

function dropStub(calls, drops = [{ key: "https://example.com/a" }]) {
  return async (input, toolDeps) => {
    calls.push({ input, toolDeps });
    return {
      status: "ok",
      data: { drops, vanished: [], baselinePeriod: BASELINE },
      meta: { warnings: [] },
      error: null,
    };
  };
}

function gscFetch(rows) {
  return async () =>
    new Response(JSON.stringify({ rows }), { status: 200 });
}

test("reports overlaps with coincidence language, confidence and links", async () => {
  const calls = [];
  const budget = new RequestBudget();
  const env = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      budget,
      allowlist: [SITE],
      useCache: false,
      dropEngine: dropStub(calls),
      feedFetch: async () => ({ status: 200, text: rss([CORE_ITEM, OLD_ITEM]) }),
    }
  );
  assert.equal(env.status, "ok");
  assert.equal(env.data.siteUrl, SITE);
  assert.deepEqual(env.data.dropWindow, WINDOW);
  assert.deepEqual(env.data.baselinePeriod, BASELINE);
  assert.equal(env.data.overlapsTotal, 1);
  const [overlap] = env.data.overlaps;
  assert.equal(overlap.name, "March 2024 core update");
  assert.equal(overlap.type, "core");
  assert.equal(overlap.url, "https://status.search.google.com/incidents/core-mar-2024");
  assert.equal(overlap.confidence, "high");
  assert.match(overlap.language, /coincides with/);
  assert.match(env.data.disclaimer, /coincidence only/i);
  assert.match(env.data.disclaimer, /out of scope/);
  assert.ok(!JSON.stringify(env).match(/caused by/i), "never attributes causation");
  assert.ok(env.meta.warnings.some((w) => w.code === "NO_CAUSALITY"));
  assert.equal(env.data.feed.source, "live");
  assert.equal(env.data.feed.historyFloor, "2022-12-14");
  assert.equal(env.meta.provenance.siteUrl, SITE);
  assert.deepEqual(env.meta.provenance.period, WINDOW);
  assert.equal(env.meta.coverage.fetchedRows, 2);
  assert.equal(env.meta.coverage.returnedRows, 1);
  // One shared budget: the stub saw the exact instance the caller passed.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolDeps.budget, budget);
});

test("type filter narrows to one family and rejects unknown filters", async () => {
  const calls = [];
  const spamOnly = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW, updateType: "spam" },
    {
      provider,
      allowlist: [SITE],
      useCache: false,
      dropEngine: dropStub(calls),
      feedFetch: async () => ({ status: 200, text: rss([CORE_ITEM, SPAM_ITEM]) }),
    }
  );
  assert.equal(spamOnly.status, "ok");
  assert.equal(spamOnly.data.overlapsTotal, 1);
  assert.equal(spamOnly.data.overlaps[0].type, "spam");
  assert.deepEqual(spamOnly.meta.coverage.stoppedBecause, ["type_filter"]);

  let feedCalls = 0;
  const bad = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW, updateType: "panda" },
    {
      provider,
      allowlist: [SITE],
      useCache: false,
      dropEngine: dropStub([]),
      feedFetch: async () => {
        feedCalls++;
        return { status: 200, text: rss([CORE_ITEM]) };
      },
    }
  );
  assert.equal(bad.status, "error");
  assert.equal(bad.error.code, "INVALID_ARGUMENT");
  assert.equal(feedCalls, 0);
});

test("honest empty state when nothing overlaps the window", async () => {
  const env = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      allowlist: [SITE],
      useCache: false,
      dropEngine: dropStub([]),
      feedFetch: async () => ({ status: 200, text: rss([OLD_ITEM]) }),
    }
  );
  assert.equal(env.status, "ok");
  assert.deepEqual(env.data.overlaps, []);
  assert.equal(env.data.overlapsTotal, 0);
  assert.ok(env.meta.warnings.some((w) => w.code === "NO_OVERLAP"));
  assert.ok(env.data.disclaimer.length > 0);
});

test("feed failure falls back to the curated snapshot", async () => {
  const snapshot = [
    {
      name: "Test core update",
      type: "core",
      startDate: "2024-03-10",
      endDate: "2024-03-24",
      status: "completed",
      url: "https://status.search.google.com/",
    },
  ];
  const env = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      allowlist: [SITE],
      useCache: false,
      dropEngine: dropStub([]),
      curatedUpdates: snapshot,
      feedFetch: async () => {
        throw new Error("socket hang up");
      },
    }
  );
  assert.equal(env.status, "ok");
  assert.equal(env.data.feed.source, "snapshot");
  assert.equal(env.data.overlapsTotal, 1);
  assert.equal(env.data.overlaps[0].name, "Test core update");
  assert.equal(env.data.overlaps[0].overlapDays, 15);
  assert.ok(env.meta.warnings.some((w) => w.code === "FEED_FALLBACK"));
});

test("allowlist denial happens before any GSC or feed fetch", async () => {
  let gscCalls = 0;
  let feedCalls = 0;
  let engineCalls = 0;
  const env = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      fetchImpl: async () => {
        gscCalls++;
        return new Response("{}", { status: 200 });
      },
      allowlist: ["sc-domain:other.example"],
      useCache: false,
      dropEngine: async () => {
        engineCalls++;
        throw new Error("engine must stay untouched");
      },
      feedFetch: async () => {
        feedCalls++;
        return { status: 200, text: rss([CORE_ITEM]) };
      },
    }
  );
  assert.equal(env.status, "error");
  assert.equal(env.error.code, "PROPERTY_NOT_ALLOWED");
  assert.equal(gscCalls, 0);
  assert.equal(feedCalls, 0);
  assert.equal(engineCalls, 0);
});

test("shares one RequestBudget with the real drop engine", async () => {
  const rows = [
    { keys: ["https://example.com/a"], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
  ];
  const budget = new RequestBudget();
  const env = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      fetchImpl: gscFetch(rows),
      budget,
      allowlist: [SITE],
      useCache: false,
      feedFetch: async () => ({ status: 200, text: rss([CORE_ITEM]) }),
    }
  );
  assert.equal(env.status, "ok");
  assert.equal(budget.attemptsUsed, 2);
  assert.equal(env.meta.googleDataAttempts, 2);

  const exhausted = await ui.checkUpdateImpact(
    { siteUrl: SITE, ...WINDOW },
    {
      provider,
      fetchImpl: gscFetch(rows),
      budget: new RequestBudget(0),
      allowlist: [SITE],
      useCache: false,
      feedFetch: async () => ({ status: 200, text: rss([CORE_ITEM]) }),
    }
  );
  assert.equal(exhausted.status, "error");
  assert.equal(exhausted.error.code, "REQUEST_BUDGET_EXCEEDED");
});

test("catalog holds 29 tools including the new read tool", () => {
  assert.equal(tools.CANONICAL_TOOLS.length, 29);
  const entry = tools.CANONICAL_TOOLS.find((t) => t.name === "gsc_check_update_impact");
  assert.ok(entry);
  assert.equal(entry.kind, "read");
});
