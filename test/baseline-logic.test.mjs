import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));

const { fetchAllRows } = await import("../dist/analytics.js");

// Routes fixture row sets by request startDate and honors startRow/rowLimit,
// so pagination runs against fixtures instead of Google.
function fakeClient(setsByStartDate, calls = []) {
  return {
    searchanalytics: {
      query: async ({ siteUrl, requestBody }) => {
        calls.push({ siteUrl, startDate: requestBody.startDate, startRow: requestBody.startRow });
        const rows = setsByStartDate[requestBody.startDate] ?? setsByStartDate.default ?? [];
        const start = requestBody.startRow ?? 0;
        const limit = requestBody.rowLimit ?? 25000;
        return { data: { rows: rows.slice(start, start + limit) } };
      },
    },
  };
}

const SITE = "sc-domain:example.com";

test("fetchAllRows paginates until a short page", async () => {
  const { rows } = load("pagination.json");
  const calls = [];
  const all = await fetchAllRows(
    { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"], rowLimit: 2 },
    SITE,
    fakeClient({ default: rows }, calls)
  );

  assert.equal(all.length, 5);
  assert.deepEqual(calls.map((c) => c.startRow), [0, 2, 4]);
  assert.ok(calls.every((c) => c.siteUrl === SITE));
});

test("fetchAllRows returns no rows on an empty response", async () => {
  const { rows } = load("empty.json");
  const all = await fetchAllRows(
    { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] },
    SITE,
    fakeClient({ default: rows })
  );
  assert.deepEqual(all, []);
});
