import assert from "node:assert/strict";
import test from "node:test";

const { FetchGscDataSource } = await import("../dist/gsc/client.js");
const { RequestBudget } = await import("../dist/gsc/budget.js");
const { GscError } = await import("../dist/gsc/errors.js");

const SITE = "sc-domain:example.com";

const provider = { getAccessToken: async () => "tok" };

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    keys: [`q${i + 1}`],
    clicks: (i + 1) * 10,
    impressions: (i + 1) * 100,
    ctr: 0.1,
    position: 4 + i,
  }));
}

// Serves dataset slices honoring startRow/rowLimit; records every call.
function pagedFetch(dataset, calls = [], status = 200) {
  return async (url, init) => {
    const body = JSON.parse(init.body ?? "{}");
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body });
    const start = body.startRow ?? 0;
    const limit = body.rowLimit ?? 25000;
    return new Response(JSON.stringify({ rows: dataset.slice(start, start + limit) }), { status });
  };
}

function statusFetch(status, body, calls = [], headers = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  };
}

test("query paginates with auth header, encoded site and final defaults", async () => {
  const calls = [];
  const ds = new FetchGscDataSource(provider, { fetchImpl: pagedFetch(rows(5), calls) });
  const res = await ds.queryAnalytics(SITE, {
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["query"],
    rowLimit: 2,
  });
  assert.equal(res.rows.length, 5);
  assert.equal(res.pagesFetched, 3);
  assert.equal(res.truncated, false);
  assert.ok(calls[0].url.includes("sc-domain%3Aexample.com"));
  assert.equal(calls[0].auth, "Bearer tok");
  assert.equal(calls[0].body.dataState, "final");
  assert.equal(calls[0].body.searchType, "web");
  assert.deepEqual(calls.map((c) => c.body.startRow), [0, 2, 4]);
});

test("query truncates at maxFetchRows", async () => {
  const ds = new FetchGscDataSource(provider, { fetchImpl: pagedFetch(rows(5)) });
  const res = await ds.queryAnalytics(SITE, {
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["query"],
    rowLimit: 2,
    maxFetchRows: 3,
  });
  assert.equal(res.rows.length, 3);
  assert.equal(res.truncated, true);
});

test("error statuses map to typed codes", async () => {
  const cases = [
    [401, {}, "AUTH_EXPIRED"],
    [400, { error: { message: "bad dates" } }, "INVALID_ARGUMENT"],
    [403, { error: { message: "quota exceeded" } }, "QUOTA_EXCEEDED"],
    [403, { error: { message: "forbidden" } }, "PROPERTY_PERMISSION_DENIED"],
    [200, { rows: "nope" }, "UPSTREAM_SCHEMA_CHANGED"],
    [200, [1, 2], "UPSTREAM_SCHEMA_CHANGED"],
  ];
  for (const [status, body, code] of cases) {
    // Single attempt: mapping is asserted here, retry behavior has its own tests.
    const ds = new FetchGscDataSource(provider, {
      budget: new RequestBudget(1),
      fetchImpl: statusFetch(status, body),
    });
    await assert.rejects(ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] }), (err) => {
      assert.ok(err instanceof GscError);
      assert.equal(err.code, code);
      return true;
    });
  }
});

test("429 with Retry-After retries inside the budget", async () => {
  const calls = [];
  let n = 0;
  const ds = new FetchGscDataSource(provider, {
    budget: new RequestBudget(5),
    fetchImpl: async () => {
      calls.push(n);
      n++;
      if (n === 1) return new Response(JSON.stringify({}), { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ rows: rows(1) }), { status: 200 });
    },
  });
  const res = await ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] });
  assert.equal(res.rows.length, 1);
  assert.equal(calls.length, 2);
});

test("persistent 500s exhaust the attempt budget", async () => {
  let calls = 0;
  const ds = new FetchGscDataSource(provider, {
    budget: new RequestBudget(3),
    fetchImpl: async () => {
      calls++;
      return new Response("boom", { status: 500 });
    },
  });
  await assert.rejects(
    ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] }),
    (err) => err instanceof GscError && err.code === "UPSTREAM_ERROR"
  );
  assert.equal(calls, 3);
});

test("a hanging provider surfaces UPSTREAM_TIMEOUT", async () => {
  const ds = new FetchGscDataSource(provider, {
    budget: new RequestBudget(2),
    timeoutMs: 100,
    fetchImpl: () => new Promise(() => {}),
  });
  await assert.rejects(
    ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] }),
    { message: /UPSTREAM_TIMEOUT/ }
  );
});
test("timed-out Google transport is aborted with UPSTREAM_TIMEOUT", async () => {
  let calls = 0;
  let seenSignal = null;
  let aborted = false;
  const ds = new FetchGscDataSource(provider, {
    budget: new RequestBudget(1),
    timeoutMs: 20,
    fetchImpl: async (url, init) => {
      calls++;
      seenSignal = init.signal;
      assert.ok(seenSignal instanceof AbortSignal);
      await new Promise((resolve, reject) => {
        seenSignal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    },
  });
  const err = await ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof GscError);
  assert.equal(err.code, "UPSTREAM_TIMEOUT");
  assert.equal(err.retryable, true);
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.equal(seenSignal.aborted, true);
});
test("stalled response body times out and aborts without schema error", async () => {
  let seenSignal = null;
  const ds = new FetchGscDataSource(provider, {
    budget: new RequestBudget(1),
    timeoutMs: 20,
    fetchImpl: async (url, init) => {
      seenSignal = init.signal;
      let ctrl = null;
      const stream = new ReadableStream({ start(c) { ctrl = c; } });
      seenSignal.addEventListener("abort", () => {
        try { ctrl.error(new DOMException("aborted", "AbortError")); } catch {}
      }, { once: true });
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const err = await ds.listSites().then(() => null, (e) => e);
  assert.ok(err instanceof GscError);
  assert.equal(err.code, "UPSTREAM_TIMEOUT");
  assert.equal(seenSignal.aborted, true);
});

test("pre-aborted budget never starts the attempt", async () => {
  const budget = new RequestBudget(4);
  const controller = new AbortController();
  controller.abort();
  let ran = false;
  const err = await budget.run(async () => { ran = true; return 1; }, { signal: controller.signal }).then(() => null, (e) => e);
  assert.ok(err instanceof GscError);
  assert.equal(err.code, "CANCELLED");
  assert.equal(ran, false);
  assert.equal(budget.attemptsUsed, 0);
});

test("mid-attempt external cancellation aborts once without retry", async () => {
  const budget = new RequestBudget(4);
  const controller = new AbortController();
  let calls = 0;
  let attemptSignal = null;
  const err = await budget.run(async (_n, signal) => {
    calls++;
    attemptSignal = signal;
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return 1;
  }, { signal: controller.signal, timeoutMs: 1000 }).then(() => null, (e) => e);
  assert.ok(err instanceof GscError);
  assert.equal(err.code, "CANCELLED");
  assert.equal(calls, 1);
  assert.equal(budget.attemptsUsed, 1);
  assert.equal(attemptSignal.aborted, true);
});

test("backoff cancellation settles without a second attempt", async () => {
  const budget = new RequestBudget(4);
  const controller = new AbortController();
  let calls = 0;
  const run = budget.run(async () => {
    calls++;
    throw new GscError("UPSTREAM_ERROR", "flaky", { retryable: true, retryAfterMs: 1000 });
  }, { signal: controller.signal, timeoutMs: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  const err = await run.then(() => null, (e) => e);
  assert.ok(err instanceof GscError);
  assert.equal(err.code, "CANCELLED");
  assert.equal(calls, 1);
});

test("completed attempt is not aborted by a later caller signal", async () => {
  const budget = new RequestBudget(4);
  const controller = new AbortController();
  let attemptSignal = null;
  const out = await budget.run(async (_n, signal) => {
    attemptSignal = signal;
    return 7;
  }, { signal: controller.signal, timeoutMs: 1000 });
  assert.equal(out, 7);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attemptSignal.aborted, false);
});

test("allowlist rejects before any fetch", async () => {
  let calls = 0;
  const ds = new FetchGscDataSource(provider, {
    allowlist: ["sc-domain:allowed.example"],
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    },
  });
  await ds.queryAnalytics("sc-domain:allowed.example", { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] });
  assert.equal(calls, 1);
  await assert.rejects(
    ds.queryAnalytics("sc-domain:other.example", { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] }),
    /PROPERTY_NOT_ALLOWED/
  );
  assert.equal(calls, 1);
});

test("listSites and listSitemaps normalize entries", async () => {
  const ds = new FetchGscDataSource(provider, {
    fetchImpl: async (url) => {
      if (url.endsWith("/sitemaps")) {
        return new Response(
          JSON.stringify({ sitemap: [{ path: "https://example.com/sitemap.xml", lastSubmitted: "2026-01-01", warnings: 1, errors: 2 }] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ siteEntry: [{ siteUrl: SITE, permissionLevel: "siteFullUser" }] }),
        { status: 200 }
      );
    },
  });
  assert.deepEqual(await ds.listSites(), [{ siteUrl: SITE, permissionLevel: "siteFullUser" }]);
  assert.deepEqual(await ds.listSitemaps(SITE), [
    { path: "https://example.com/sitemap.xml", lastSubmitted: "2026-01-01", warnings: 1, errors: 2 },
  ]);
});

test("provider auth failures surface as typed AUTH_REQUIRED", async () => {
  const ds = new FetchGscDataSource({
    getAccessToken: async () => {
      throw new Error("AUTH_REQUIRED: no session");
    },
  });
  await assert.rejects(ds.listSites(), (err) => err instanceof GscError && err.code === "AUTH_REQUIRED");
});

test("aggregate rows without keys parse with empty keys", async () => {
  const ds = new FetchGscDataSource(provider, {
    fetchImpl: statusFetch(200, { rows: [{ clicks: 1229, impressions: 80303, ctr: 0.0153, position: 8.15 }] }),
  });
  const res = await ds.queryAnalytics(SITE, { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: [] });
  assert.deepEqual(res.rows[0].keys, []);
  assert.equal(res.rows[0].clicks, 1229);
});
