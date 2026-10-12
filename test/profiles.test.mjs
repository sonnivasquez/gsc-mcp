import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const dataDir = mkdtempSync(join(tmpdir(), "gsc-profiles-"));
mkdirSync(join(dataDir, "profiles"), { recursive: true });
writeFileSync(
  join(dataDir, "profiles", "work.json"),
  JSON.stringify({ version: 1, allowedSites: ["sc-domain:work.example", "https://shop.example/"] })
);
writeFileSync(join(dataDir, "profiles", "broken.json"), "{not json");
writeFileSync(join(dataDir, "profiles", "badshape.json"), JSON.stringify({ version: 1, allowedSites: "nope" }));

process.env.GSC_DATA_DIR = dataDir;

const {
  loadProfile,
  initInstance,
  getActiveInstanceGeneration,
  setInstanceAllowlist,
  assertSiteAllowed,
  envAllowlist,
} = await import("../dist/profiles.js");
const { getAuthProvider } = await import("../dist/auth-provider.js");
const { fetchAllRows } = await import("../dist/analytics.js");
const { printClientConfig } = await import("../dist/client-config.js");

test("loadProfile reads and trims a stored profile", () => {
  assert.deepEqual(loadProfile("work"), {
    alias: "work",
    allowedSites: ["sc-domain:work.example", "https://shop.example/"],
  });
});

test("loadProfile fails closed on missing, corrupt and malformed profiles", () => {
  assert.throws(() => loadProfile("ghost"), /not found/);
  assert.throws(() => loadProfile("broken"), /not valid JSON/);
  assert.throws(() => loadProfile("badshape"), /allowedSites/);
});

test("assertSiteAllowed matches GSC identifiers exactly", () => {
  setInstanceAllowlist(["sc-domain:work.example", "https://shop.example/"]);
  try {
    assertSiteAllowed("sc-domain:work.example");
    assertSiteAllowed("https://shop.example/");
    assert.throws(() => assertSiteAllowed("https://work.example/"), /PROPERTY_NOT_ALLOWED/);
    assert.throws(() => assertSiteAllowed("sc-domain:work.example.evil.test"), /PROPERTY_NOT_ALLOWED/);
    assert.throws(() => assertSiteAllowed("https://shop.example"), /PROPERTY_NOT_ALLOWED/);
    assert.throws(() => assertSiteAllowed(""), /PROPERTY_NOT_ALLOWED/);
  } finally {
    setInstanceAllowlist(null);
  }
});

test("fetchAllRows rejects outside the allowlist before any Google call", async () => {
  let calls = 0;
  const fake = {
    searchanalytics: {
      query: async () => {
        calls++;
        return { data: { rows: [] } };
      },
    },
  };
  setInstanceAllowlist(["sc-domain:allowed.example"]);
  try {
    await fetchAllRows(
      { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] },
      "sc-domain:allowed.example",
      fake
    );
    assert.equal(calls, 1);
    await assert.rejects(
      fetchAllRows(
        { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] },
        "sc-domain:other.example",
        fake
      ),
      /PROPERTY_NOT_ALLOWED/
    );
    assert.equal(calls, 1);
  } finally {
    setInstanceAllowlist(null);
  }
});

test("two profiles isolate the same property differently", async () => {
  const fake = { searchanalytics: { query: async () => ({ data: { rows: [] } }) } };
  const params = { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["query"] };
  setInstanceAllowlist(["sc-domain:shared.example"]);
  try {
    await fetchAllRows(params, "sc-domain:shared.example", fake);
  } finally {
    setInstanceAllowlist(["sc-domain:elsewhere.example"]);
  }
  try {
    await assert.rejects(fetchAllRows(params, "sc-domain:shared.example", fake), /PROPERTY_NOT_ALLOWED/);
  } finally {
    setInstanceAllowlist(null);
  }
});

test("initInstance resolves a stored profile and env fallback", () => {
  assert.deepEqual(initInstance("work").allowedSites, ["sc-domain:work.example", "https://shop.example/"]);
  setInstanceAllowlist(null);
  delete process.env.GSC_SITE_URLS;
  assert.deepEqual(initInstance(undefined).allowedSites, []);
  process.env.GSC_SITE_URLS = "sc-domain:a.example, https://b.example/ ";
  assert.deepEqual(initInstance(undefined).allowedSites, ["sc-domain:a.example", "https://b.example/"]);
  delete process.env.GSC_SITE_URLS;
  setInstanceAllowlist(null);
});

test("OAuth provider factory reuses only the active connection", () => {
  const previousMode = process.env.GSC_AUTH_MODE;
  const previousDir = process.env.GSC_DATA_DIR;
  try {
    process.env.GSC_AUTH_MODE = "oauth";
    setInstanceAllowlist(null);
    assert.equal(getActiveInstanceGeneration(), null);
    assert.notEqual(getAuthProvider(), getAuthProvider());

    initInstance("work");
    const generation = getActiveInstanceGeneration();
    const first = getAuthProvider();
    assert.equal(first, getAuthProvider());
    assert.throws(() => initInstance("ghost"), /not found/);
    assert.equal(getActiveInstanceGeneration(), generation);
    assert.equal(getAuthProvider(), first);

    initInstance("work");
    assert.notEqual(getActiveInstanceGeneration(), generation);
    const renewed = getAuthProvider();
    assert.notEqual(renewed, first);
    initInstance(undefined);
    const otherProfile = getAuthProvider();
    assert.notEqual(otherProfile, renewed);

    process.env.GSC_DATA_DIR = mkdtempSync(join(tmpdir(), "gsc-provider-dir-"));
    const otherDirectory = getAuthProvider();
    assert.notEqual(otherDirectory, otherProfile);
    process.env.GSC_AUTH_MODE = "service_account";
    assert.notEqual(getAuthProvider(), otherDirectory);
    process.env.GSC_AUTH_MODE = "oauth";
    assert.notEqual(getAuthProvider(), otherDirectory);
  } finally {
    setInstanceAllowlist(null);
    if (previousMode === undefined) delete process.env.GSC_AUTH_MODE;
    else process.env.GSC_AUTH_MODE = previousMode;
    if (previousDir === undefined) delete process.env.GSC_DATA_DIR;
    else process.env.GSC_DATA_DIR = previousDir;
  }
});

test("config print covers every client without secrets", () => {
  for (const client of ["desktop", "code", "cursor", "generic"]) {
    const out = printClientConfig(client, { command: "/abs/bun", entrypoint: "/abs/dist/index.js", profile: "work" });
    assert.match(out, /\/abs\/dist\/index\.js/);
    assert.match(out, /work/);
    assert.ok(!out.includes("refresh_token"));
  }
  assert.throws(() => printClientConfig("smoke-signals", { command: "x", entrypoint: "y" }), /Unknown client/);
});

test("serve --profile with a missing profile exits 1 before listening", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const env = { ...process.env, GSC_DATA_DIR: dataDir };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_") && key !== "GSC_DATA_DIR") delete env[key];
  }
  const r = spawnSync(process.execPath, [entry, "serve", "--profile", "ghost"], { encoding: "utf8", env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not found/);
});

test("envAllowlist accepts a JSON string array exactly, including commas", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = JSON.stringify(["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
    assert.deepEqual(envAllowlist(), ["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test("envAllowlist retains legacy comma-separated input compatibility", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = "sc-domain:a.example, https://b.example/ ";
    assert.deepEqual(envAllowlist(), ["sc-domain:a.example", "https://b.example/"]);
    delete process.env.GSC_SITE_URLS;
    assert.deepEqual(envAllowlist(), []);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test("envAllowlist fails closed on malformed JSON allowlists", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = '["sc-domain:a.example", 42]';
    assert.throws(() => envAllowlist(), /non-empty valid property strings/);
    process.env.GSC_SITE_URLS = '["unclosed';
    assert.throws(() => envAllowlist(), /not valid JSON/);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test("envAllowlist fails closed on every value outside its declared domain", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    // Quoted JSON scalar, bare JSON tokens, and arbitrary legacy garbage.
    for (const bad of ['"sc-domain:a.example"', '42', 'true', 'null', 'bogus']) {
      process.env.GSC_SITE_URLS = bad;
      assert.throws(() => envAllowlist(), /Invalid property/, `value ${bad}`);
    }
    // Empty elements in legacy input.
    for (const bad of ['sc-domain:a.example,,https://b.example/', 'sc-domain:a.example,', ',sc-domain:a.example']) {
      process.env.GSC_SITE_URLS = bad;
      assert.throws(() => envAllowlist(), /empty property entry/, `value ${bad}`);
    }
    // Invalid JSON-array entries: wrong shape and empty string.
    process.env.GSC_SITE_URLS = '["bogus"]';
    assert.throws(() => envAllowlist(), /Invalid property/);
    process.env.GSC_SITE_URLS = '["sc-domain:a.example",""]';
    assert.throws(() => envAllowlist(), /non-empty valid property strings/);
    // Declared domain still passes byte-for-byte.
    process.env.GSC_SITE_URLS = '["sc-domain:Example.COM","https://shop.example/sale,2026/"]';
    assert.deepEqual(envAllowlist(), ['sc-domain:Example.COM', 'https://shop.example/sale,2026/']);
    process.env.GSC_SITE_URLS = 'sc-domain:a.example, https://b.example/ ';
    assert.deepEqual(envAllowlist(), ['sc-domain:a.example', 'https://b.example/']);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test("envAllowlist fails closed on JSON non-array values instead of legacy parsing", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = '{"allowedSites":[]}';
    assert.throws(() => envAllowlist(), /non-empty valid property strings/);
    process.env.GSC_SITE_URLS = '{"allowedSites":["sc-domain:a.example"]}';
    assert.throws(() => envAllowlist(), /non-empty valid property strings/);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
  }
});

test("loadProfile rejects a stored profile with a structurally invalid entry", () => {
  writeFileSync(
    join(dataDir, "profiles", "badprop.json"),
    JSON.stringify({ version: 1, allowedSites: ["sc-domain:work.example", "bogus"] })
  );
  assert.throws(() => loadProfile("badprop"), /invalid property/);
  writeFileSync(
    join(dataDir, "profiles", "badhost.json"),
    JSON.stringify({ version: 1, allowedSites: ["https://bad_host.example/"] })
  );
  assert.throws(() => loadProfile("badhost"), /invalid property/);
});

test("loadProfile preserves a comma-containing URL as one entry", () => {
  writeFileSync(
    join(dataDir, "profiles", "comma.json"),
    JSON.stringify({ version: 1, allowedSites: ["sc-domain:work.example", "https://shop.example/sale,2026/"] })
  );
  assert.deepEqual(loadProfile("comma"), {
    alias: "comma",
    allowedSites: ["sc-domain:work.example", "https://shop.example/sale,2026/"],
  });
});

test("initInstance resolves a JSON env allowlist exactly", () => {
  const previous = process.env.GSC_SITE_URLS;
  try {
    process.env.GSC_SITE_URLS = JSON.stringify(["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
    assert.deepEqual(initInstance(undefined).allowedSites, ["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
    setInstanceAllowlist(null);
  }
});
