import { CLI_TEST_TIMEOUT_MS, homeEnvironment } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const doctor = await import("../dist/doctor.js");
const providers = await import("../dist/auth-provider.js");

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  return { ...env, ...extra };
};

const tokenProvider = (token = "test-token") => ({
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => token,
});

const sitesResponse = (entries) => async () => ({
  status: 200,
  ok: true,
  json: async () => ({ siteEntry: entries }),
});

const allowlistEnv = JSON.stringify(["sc-domain:a.example", "https://b.example/"]);

test("online doctor verifies API, properties, and tools with one bounded call", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    let calls = 0;
    let registryCalls = 0;
    let seenAuth = "";
    const cacheDir = mkdtempSync(join(tmpdir(), "gsc-reg-bounded-"));
    const fetchImpl = async (url, init) => {
      if (String(url).includes("registry.npmjs.org")) {
        registryCalls++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
        };
      }
      calls++;
      seenAuth = init?.headers?.Authorization ?? "";
      return sitesResponse([
        { siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" },
        { siteUrl: "https://b.example/", permissionLevel: "siteFullUser" },
      ])();
    };
    const report = await doctor.runDoctorOnline({ provider: tokenProvider(), fetchImpl, toolCount: 29, cacheDir });
    assert.equal(calls, 1);
    assert.equal(registryCalls, 1);
    assert.equal(seenAuth, "Bearer test-token");
    const api = report.checks.find((c) => c.id === "api");
    assert.equal(api.ok, true);
    assert.match(api.detail, /one bounded sites\.list/);
    const properties = report.checks.find((c) => c.id === "properties");
    assert.equal(properties.ok, true);
    assert.match(properties.detail, /all visible/);
    assert.equal(report.checks.find((c) => c.id === "tools").ok, true);
    const version = report.checks.find((c) => c.id === "version");
    assert.equal(version.ok, true);
    assert.match(version.detail, /up to date \(1\.0\.0\)/);
    assert.ok(!JSON.stringify(report).includes("test-token"));
  });
});

test("online doctor reports partial visibility and catalog drift honestly", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    const report = await doctor.runDoctorOnline({
      provider: tokenProvider(),
      fetchImpl: sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }]),
      toolCount: 28,
    });
    const properties = report.checks.find((c) => c.id === "properties");
    assert.equal(properties.ok, false);
    assert.match(properties.detail, /1 of 2 selected properties visible/);
    const tools = report.checks.find((c) => c.id === "tools");
    assert.equal(tools.ok, false);
    assert.match(tools.detail, /expected 29 gsc_\* tools, found 28/);
    assert.ok(report.failed > 0);
  });
});

test("online doctor classifies 401, 403, and 500 without claiming access", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    for (const [status, pattern] of [[401, /401/], [403, /403/], [500, /Google answered 500/]]) {
      const report = await doctor.runDoctorOnline({
        provider: tokenProvider(),
        fetchImpl: async () => ({ status, ok: false, json: async () => ({}) }),
        toolCount: 29,
      });
      assert.equal(report.checks.find((c) => c.id === "api").ok, false, `status ${status}`);
      assert.match(report.checks.find((c) => c.id === "api").detail, pattern, `status ${status}`);
      assert.match(report.checks.find((c) => c.id === "properties").detail, /skipped/, `status ${status}`);
    }
  });
});

test("online doctor fails the API check on malformed 2xx sites.list bodies", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    const malformed = [
      ["json throws", async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("Unexpected token < in JSON"); } })],
      ["string body", async () => ({ status: 200, ok: true, json: async () => "bogus" })],
      ["number body", async () => ({ status: 200, ok: true, json: async () => 42 })],
      ["array body", async () => ({ status: 200, ok: true, json: async () => [] })],
      ["non-array siteEntry", async () => ({ status: 200, ok: true, json: async () => ({ siteEntry: "nope" }) })],
      ["null body", async () => ({ status: 200, ok: true, json: async () => null })],
    ];
    for (const [name, fetchImpl] of malformed) {
      const report = await doctor.runDoctorOnline({ provider: tokenProvider(), fetchImpl, toolCount: 29 });
      const api = report.checks.find((c) => c.id === "api");
      assert.equal(api.ok, false, name);
      assert.match(api.detail, /UPSTREAM_SCHEMA_CHANGED/, name);
      assert.ok(!api.detail.includes("0 properties visible"), name);
      assert.match(report.checks.find((c) => c.id === "properties").detail, /skipped/, name);
    }
    const empty = await doctor.runDoctorOnline({
      provider: tokenProvider(),
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }),
      toolCount: 29,
    });
    assert.equal(empty.checks.find((c) => c.id === "api").ok, true);
    assert.match(empty.checks.find((c) => c.id === "api").detail, /0 properties visible/);
  });
});

test("online doctor never leaks raw exception text", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    const sentinel = "SENTINEL-LEAK-PROBE-4d2c";
    const failingProvider = {
      getAccessToken: async () => { throw new Error(`weird failure ${sentinel} token=secret-value`); },
    };
    const viaProvider = await doctor.runDoctorOnline({
      provider: failingProvider,
      fetchImpl: async () => { throw new Error("fetch must stay untouched"); },
      toolCount: 29,
    });
    const providerApi = viaProvider.checks.find((c) => c.id === "api");
    assert.equal(providerApi.ok, false);
    assert.match(providerApi.detail, /network_error/);
    assert.ok(!JSON.stringify(viaProvider).includes(sentinel));
    assert.ok(!JSON.stringify(viaProvider).includes("secret-value"));

    const viaFetch = await doctor.runDoctorOnline({
      provider: tokenProvider(),
      fetchImpl: async () => { throw new Error(`getaddrinfo EAI_AGAIN ${sentinel} internal=secret-value`); },
      toolCount: 29,
    });
    const fetchApi = viaFetch.checks.find((c) => c.id === "api");
    assert.equal(fetchApi.ok, false);
    assert.ok(!JSON.stringify(viaFetch).includes(sentinel));
    assert.ok(!JSON.stringify(viaFetch).includes("secret-value"));
  });
});

test("online doctor reports a missing session without touching the Google API", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    let calls = 0;
    const report = await doctor.runDoctorOnline({
      provider: { getAccessToken: async () => { throw new Error("AUTH_REQUIRED: no OAuth session cached."); } },
      fetchImpl: async (url) => {
        if (!String(url).includes("registry.npmjs.org")) calls++;
        throw new Error("network must stay untouched");
      },
      toolCount: 29,
    });
    assert.equal(calls, 0);
    assert.match(report.checks.find((c) => c.id === "api").detail, /AUTH_REQUIRED/);
  });
});

test("doctor offline and online never echo allowlist values", async () => {
  const sentinel = "SENTINEL-ALLOW-6b9e";
  for (const value of [`["sc-domain:bad_host-${sentinel}"]`, `bogus-${sentinel}`, `{"[${sentinel}]": 1}`]) {
    await withEnv({ GSC_SITE_URLS: value }, async () => {
      const offline = doctor.runDoctor();
      for (const id of ["site_urls", "allowlist"]) {
        const check = offline.checks.find((c) => c.id === id);
        assert.equal(check.ok, false, `${value} ${id}`);
        assert.match(check.detail, /allowlist_error/, `${value} ${id}`);
      }
      assert.ok(!JSON.stringify(offline).includes(sentinel), value);
      const online = await doctor.runDoctorOnline({
        provider: tokenProvider(),
        fetchImpl: sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }]),
        toolCount: 29,
      });
      const properties = online.checks.find((c) => c.id === "properties");
      assert.equal(properties.ok, false, value);
      assert.match(properties.detail, /allowlist_error/, value);
      assert.ok(!JSON.stringify(online).includes(sentinel), value);
    });
  }
});

test("doctor JSON never echoes even valid allowlist values", async () => {
  const sentinel = "SENTINEL-ALLOW-6b9e";
  await withEnv({ GSC_SITE_URLS: JSON.stringify([`sc-domain:valid-${sentinel}.example`]) }, async () => {
    const offline = doctor.runDoctor();
    assert.equal(offline.checks.find((c) => c.id === "site_urls").ok, true);
    assert.ok(!JSON.stringify(offline).includes(sentinel));
  });
});

test("sites.list members are validated, not silently filtered", async () => {
  const okFetch = (entries) => async () => ({
    status: 200, ok: true, json: async () => ({ siteEntry: entries }),
  });
  const compat = await providers.fetchSitesList(tokenProvider(), okFetch([{}, {}]));
  assert.equal(compat.sites, 2);
  assert.deepEqual(compat.entries, []);
  const empty = await providers.fetchSitesList(tokenProvider(), async () => ({
    status: 200, ok: true, json: async () => ({}),
  }));
  assert.deepEqual(empty, { status: 200, sites: 0, entries: [] });
  const valid = await providers.fetchSitesList(
    tokenProvider(),
    okFetch([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }])
  );
  assert.equal(valid.sites, 1);
  assert.deepEqual(valid.entries, [{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }]);
  for (const [name, entries] of [
    ["null member", [null, {}]],
    ["string member", ["sc-domain:a.example"]],
    ["array member", [["sc-domain:a.example"]]],
    ["non-string siteUrl", [{ siteUrl: 42 }]],
    ["non-string permission", [{ siteUrl: "sc-domain:a.example", permissionLevel: 7 }]],
  ]) {
    await assert.rejects(
      providers.fetchSitesList(tokenProvider(), okFetch(entries)),
      /UPSTREAM_SCHEMA_CHANGED/,
      name
    );
  }
});

test("offline doctor stays offline: injected fetch is never called", async () => {
  await withEnv({ GSC_SITE_URLS: allowlistEnv }, async () => {
    const report = doctor.runDoctor();
    assert.ok(!report.checks.some((c) => c.id === "api" || c.id === "properties" || c.id === "tools" || c.id === "version"));
    assert.ok(report.checks.some((c) => c.id === "runtime" && c.ok));
  });
});

test("cli doctor --help documents the offline default and the online opt-in", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor", "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Offline by default/);
  assert.match(r.stdout, /--online/);
});

test("cli doctor rejects unknown flags without echoing them", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const sentinel = "SENTINEL-DOCTORFLAG-7e1a";
  const r = spawnSync(process.execPath, [entry, "doctor", `--${sentinel}`], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /doctor: unknown flag/);
  assert.ok(!r.stderr.includes(sentinel));
  assert.ok(!r.stdout.includes(sentinel));
});

test("cli doctor rejects unknown flags instead of silently ignoring them", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "doctor", "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("cli doctor --online is honest JSON without secrets when no session exists", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-doctor-online-"));
  const r = spawnSync(process.execPath, [entry, "doctor", "--online"], {
    encoding: "utf8",
    env: cleanEnv({ ...homeEnvironment(home) }),
  });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  const ids = report.checks.map((c) => c.id);
  assert.ok(ids.includes("api"));
  assert.ok(ids.includes("properties"));
  assert.ok(ids.includes("tools"));
  assert.ok(ids.includes("version"));
  assert.equal(report.checks.find((c) => c.id === "api").ok, false);
  assert.match(report.checks.find((c) => c.id === "api").detail, /GSC_KEY_FILE|AUTH_REQUIRED/);
  assert.match(report.checks.find((c) => c.id === "tools").detail, /29 gsc_\* tools/);
});

test("offline doctor reports the active scoped token, never the default fixture", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-doctor-home-"));
  const scopedFull = mkdtempSync(join(tmpdir(), "gsc-doctor-scoped-full-"));
  const scopedEmpty = mkdtempSync(join(tmpdir(), "gsc-doctor-scoped-empty-"));
  mkdirSync(join(home, ".gsc-mcp"), { recursive: true });
  writeFileSync(join(home, ".gsc-mcp", "oauth-token.json"), JSON.stringify({ marker: "default-fixture" }));
  writeFileSync(join(scopedFull, "oauth-token.json"), JSON.stringify({ marker: "scoped-fixture" }));

  await withEnv({ ...homeEnvironment(home), GSC_DATA_DIR: scopedFull, GSC_AUTH_MODE: "oauth" }, async () => {
    const report = doctor.runDoctor();
    const check = report.checks.find((c) => c.id === "oauth_token");
    assert.equal(check.ok, true);
    assert.equal(check.detail, `cached at ${join(scopedFull, "oauth-token.json")}`);
    assert.ok(!JSON.stringify(report).includes("default-fixture"));
    assert.ok(!JSON.stringify(report).includes("scoped-fixture"));
  });

  await withEnv({ ...homeEnvironment(home), GSC_DATA_DIR: scopedEmpty, GSC_AUTH_MODE: "oauth" }, async () => {
    const report = doctor.runDoctor();
    const check = report.checks.find((c) => c.id === "oauth_token");
    assert.equal(check.ok, false);
    assert.equal(check.detail, `no cached token at ${join(scopedEmpty, "oauth-token.json")}; run setup`);
    assert.ok(!JSON.stringify(report).includes("default-fixture"));
  });

  // Bun caches os.homedir() at process startup, so the default-home branch runs
  // in a fresh subprocess whose home environment is set before runtime startup.
  {
    const r = spawnSync(process.execPath, [entry, "doctor"], {
      encoding: "utf8",
      env: cleanEnv({ ...homeEnvironment(home), GSC_AUTH_MODE: "oauth" }),
    });
    assert.equal(r.status, 0, `doctor failed: ${r.stderr}`);
    const report = JSON.parse(r.stdout);
    const check = report.checks.find((c) => c.id === "oauth_token");
    assert.equal(check.ok, true);
    assert.equal(check.detail, `cached at ${join(home, ".gsc-mcp", "oauth-token.json")}`);
    assert.ok(!JSON.stringify(report).includes("default-fixture"));
  }
});

test("offline doctor service_key hints at a cached OAuth token in default mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-doctor-key-hint-"));
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: undefined, GSC_DATA_DIR: dir }, async () => {
    const bare = doctor.runDoctor().checks.find((c) => c.id === "service_key");
    assert.equal(bare.ok, false);
    assert.equal(bare.detail, "GSC_KEY_FILE is not set");
  });
  writeFileSync(join(dir, "oauth-token.json"), JSON.stringify({ marker: "hint-fixture" }));
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: undefined, GSC_DATA_DIR: dir }, async () => {
    const report = doctor.runDoctor();
    const hinted = report.checks.find((c) => c.id === "service_key");
    assert.equal(hinted.ok, false);
    assert.match(hinted.detail, /GSC_KEY_FILE is not set/);
    assert.match(hinted.detail, /GSC_AUTH_MODE=oauth/);
    assert.ok(!JSON.stringify(report).includes("hint-fixture"));
  });
});

// --- F2: non-failing registry version check in `gsc doctor --online` ---

const registryFetch = (latest, onCall) => async () => {
  onCall?.();
  return {
    status: 200,
    ok: true,
    json: async () => ({ "dist-tags": { latest } }),
  };
};

const versionReport = (fetchImpl, extra = {}) =>
  withEnv({ GSC_SITE_URLS: allowlistEnv }, () =>
    doctor.runDoctorOnline({
      provider: tokenProvider(),
      fetchImpl,
      toolCount: 29,
      cacheDir: mkdtempSync(join(tmpdir(), "gsc-reg-version-")),
      ...extra,
    })
  );

test("online doctor reports an outdated install without failing", async () => {
  let registryCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("registry.npmjs.org")) {
      return registryFetch("9.9.9", () => registryCalls++)();
    }
    return sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }])();
  };
  const report = await versionReport(fetchImpl);
  assert.equal(registryCalls, 1);
  const version = report.checks.find((c) => c.id === "version");
  assert.equal(version.ok, true);
  assert.match(version.detail, /installed 1\.0\.0, registry latest 9\.9\.9/);
  assert.match(version.detail, /gsc update/);
  assert.ok(report.checks.filter((c) => !c.ok).every((c) => c.id !== "version"));
});

test("online doctor reports registry outages as unknown without failing or leaking", async () => {
  const sentinel = "SENTINEL-REGISTRY-8a4f";
  const cases = [
    ["offline", async () => { throw new Error(`connect ECONNREFUSED ${sentinel}`); }, /registry latest unknown \(network_error\)/],
    ["timeout", async () => { throw new Error(`request timed out after 10000ms ${sentinel}`); }, /registry latest unknown \(timeout\)/],
    ["shape error", async () => ({ status: 200, ok: true, json: async () => ({ nonsense: true }) }), /registry latest unknown \(unexpected-response\)/],
    ["empty latest", async () => ({ status: 200, ok: true, json: async () => ({ "dist-tags": { latest: "" } }) }), /registry latest unknown \(unexpected-response\)/],
  ];
  for (const [name, versionFetchImpl, pattern] of cases) {
    const fetchImpl = async (url) => {
      if (String(url).includes("registry.npmjs.org")) return versionFetchImpl();
      return sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }])();
    };
    const report = await versionReport(fetchImpl);
    const version = report.checks.find((c) => c.id === "version");
    assert.equal(version.ok, true, name);
    assert.match(version.detail, pattern, name);
    assert.ok(!JSON.stringify(report).includes(sentinel), name);
    assert.ok(!JSON.stringify(report).includes("secret-value"), name);
  }
});

test("online doctor caches the registry version for an hour", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "gsc-reg-cache-"));
  let registryCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("registry.npmjs.org")) {
      return registryFetch("1.0.0", () => registryCalls++)();
    }
    return sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }])();
  };
  const opts = {
    provider: tokenProvider(),
    fetchImpl,
    toolCount: 29,
    cacheDir,
  };
  const first = await withEnv({ GSC_SITE_URLS: allowlistEnv }, () => doctor.runDoctorOnline(opts));
  assert.equal(registryCalls, 1);
  assert.match(first.checks.find((c) => c.id === "version").detail, /up to date/);
  // A fresh successful check refreshes the cache: the second run fetches nothing.
  const second = await withEnv({ GSC_SITE_URLS: allowlistEnv }, () => doctor.runDoctorOnline(opts));
  assert.equal(registryCalls, 1);
  assert.equal(second.checks.find((c) => c.id === "version").detail, first.checks.find((c) => c.id === "version").detail);
});

test("online doctor bypasses a stale registry cache", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "gsc-reg-stale-"));
  writeFileSync(
    join(cacheDir, doctor.REGISTRY_VERSION_CACHE_FILE),
    JSON.stringify({ fetchedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), latest: "0.0.1" })
  );
  let registryCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("registry.npmjs.org")) {
      return registryFetch("1.0.0", () => registryCalls++)();
    }
    return sitesResponse([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }])();
  };
  const report = await withEnv({ GSC_SITE_URLS: allowlistEnv }, () =>
    doctor.runDoctorOnline({ provider: tokenProvider(), fetchImpl, toolCount: 29, cacheDir })
  );
  assert.equal(registryCalls, 1);
  assert.match(report.checks.find((c) => c.id === "version").detail, /up to date \(1\.0\.0\)/);
});
