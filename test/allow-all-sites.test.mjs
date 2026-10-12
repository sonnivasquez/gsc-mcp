import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const profiles = await import("../dist/profiles.js");
const properties = await import("../dist/setup/properties.js");
const setup = await import("../dist/setup.js");
const doctor = await import("../dist/doctor.js");
const tools = await import("../dist/gsc/tools.js");

const {
  envAllowlist,
  isAllowAllAllowlist,
  setInstanceAllowlist,
  assertSiteAllowed,
  isPageUrlAllowedByAllowlist,
} = profiles;
const {
  parseSiteFlags,
  validateAllowlist,
  parsePropertySelectionAnswer,
  isAllowAllFutureAnswer,
} = properties;

function withSiteUrls(value, fn) {
  const previous = process.env.GSC_SITE_URLS;
  try {
    if (value === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = value;
    return fn();
  } finally {
    if (previous === undefined) delete process.env.GSC_SITE_URLS;
    else process.env.GSC_SITE_URLS = previous;
    setInstanceAllowlist(null);
  }
}

const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  return { ...env, ...extra };
};

const isolatedEnv = (extra = {}) => {
  const home = mkdtempSync(join(tmpdir(), "gsc-allowall-home-"));
  const dataDir = mkdtempSync(join(tmpdir(), "gsc-allowall-data-"));
  const tmp = mkdtempSync(join(tmpdir(), "gsc-allowall-tmp-"));
  return cleanEnv({ HOME: home, GSC_DATA_DIR: dataDir, TMPDIR: tmp, ...extra });
};

const provider = {
  describe: () => ({ mode: "oauth", scopeTier: "readonly" }),
  getAccessToken: async () => "tok",
};

// --- Sentinel parsing: bare and JSON forms (case-insensitive, whitespace-tolerant) ---

test("envAllowlist accepts bare all in any case with surrounding whitespace", () => {
  for (const raw of ["all", "All", "ALL", "  all  ", "\tALL\n"]) {
    withSiteUrls(raw, () => {
      assert.deepEqual(envAllowlist(), ["all"]);
    });
  }
});

test("envAllowlist accepts JSON sole all entry case-insensitively", () => {
  for (const raw of ['["all"]', '["All"]', '["ALL"]', '[ "  all  " ]']) {
    withSiteUrls(raw, () => {
      assert.deepEqual(envAllowlist(), ["all"]);
    });
  }
});

test("envAllowlist rejects mixed all with explicit identifiers", () => {
  for (const raw of [
    '["all","sc-domain:a.example"]',
    '["sc-domain:a.example","all"]',
    '["ALL","https://b.example/"]',
    "all,sc-domain:a.example",
    "sc-domain:a.example, all",
    "sc-domain:a.example,all,https://b.example/",
  ]) {
    withSiteUrls(raw, () => {
      assert.throws(() => envAllowlist(), /mixes "all"/, `value ${raw}`);
    });
  }
});

test("isAllowAllAllowlist distinguishes sentinel from null, empty, and explicit lists", () => {
  assert.equal(isAllowAllAllowlist(["all"]), true);
  assert.equal(isAllowAllAllowlist(["ALL"]), true);
  assert.equal(isAllowAllAllowlist(["  all  "]), true);
  assert.equal(isAllowAllAllowlist(null), false);
  assert.equal(isAllowAllAllowlist(undefined), false);
  assert.equal(isAllowAllAllowlist([]), false);
  assert.equal(isAllowAllAllowlist(["sc-domain:a.example"]), false);
  assert.equal(isAllowAllAllowlist(["all", "sc-domain:a.example"]), false);
});

// --- Enforcement: allow-all passes arbitrary and future properties ---

test("allow-all passes arbitrary and future properties while explicit lists stay exact", () => {
  setInstanceAllowlist(["all"]);
  try {
    assertSiteAllowed("sc-domain:future.example");
    assertSiteAllowed("https://never-seen.example/");
    assertSiteAllowed("sc-domain:Example.COM");
  } finally {
    setInstanceAllowlist(null);
  }
  setInstanceAllowlist(["sc-domain:allowed.example"]);
  try {
    assertSiteAllowed("sc-domain:allowed.example");
    assert.throws(() => assertSiteAllowed("sc-domain:future.example"), /PROPERTY_NOT_ALLOWED/);
    assert.throws(() => assertSiteAllowed("https://never-seen.example/"), /PROPERTY_NOT_ALLOWED/);
  } finally {
    setInstanceAllowlist(null);
  }
  setInstanceAllowlist(null);
  assertSiteAllowed("anything-goes-when-uninitialized");
});

test("isPageUrlAllowedByAllowlist allows any valid http(s) URL under allow-all", () => {
  const allowAll = ["all"];
  assert.equal(isPageUrlAllowedByAllowlist("https://future.example/page", allowAll), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://sub.allowed.example/x?q=1", allowAll), true);
  assert.equal(isPageUrlAllowedByAllowlist("http://127.0.0.1/", allowAll), true);
  assert.equal(isPageUrlAllowedByAllowlist("ftp://example.com/", allowAll), false);
  assert.equal(isPageUrlAllowedByAllowlist("not-a-url", allowAll), false);
  assert.equal(isPageUrlAllowedByAllowlist("https://evil.com/", ["https://example.com/"]), false);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com/page", ["https://example.com/"]), true);
});

// --- Setup shapes: --site all sentinel, mixed rejection, future answer ---

test("parseSiteFlags accepts sole all and rejects mixed all plus identifiers", () => {
  assert.deepEqual(parseSiteFlags(["all"]), ["all"]);
  assert.deepEqual(parseSiteFlags(["All"]), ["all"]);
  assert.deepEqual(parseSiteFlags(["  ALL  "]), ["all"]);
  assert.deepEqual(parseSiteFlags(["sc-domain:Example.COM", "https://example.com/a,b"]), [
    "sc-domain:Example.COM",
    "https://example.com/a,b",
  ]);
  assert.throws(() => parseSiteFlags(["all", "sc-domain:a.example"]), /mixes "all"/);
  assert.throws(() => parseSiteFlags(["sc-domain:a.example", "ALL"]), /mixes "all"/);
  assert.throws(() => parseSiteFlags(["bogus"]), /Invalid --site value/);
});

test("validateAllowlist accepts sole all and rejects mixed entries", () => {
  assert.deepEqual(validateAllowlist(["all"]), ["all"]);
  assert.deepEqual(validateAllowlist(["  All  "]), ["all"]);
  assert.throws(() => validateAllowlist(["all", "https://b.example/"]), /mixes "all"/);
  assert.throws(() => validateAllowlist(["bogus"]), /Invalid property/);
  assert.throws(() => validateAllowlist([]), /property is required/);
});

test("interactive future answer is 0 or bare all (all+future removed)", () => {
  assert.equal(isAllowAllFutureAnswer("0"), true);
  assert.equal(isAllowAllFutureAnswer("all"), true);
  assert.equal(isAllowAllFutureAnswer("ALL"), true);
  assert.equal(isAllowAllFutureAnswer("  all  "), true);
  assert.equal(isAllowAllFutureAnswer("all+future"), false);
  assert.equal(isAllowAllFutureAnswer("all future"), false);
  assert.equal(isAllowAllFutureAnswer("1,3"), false);
  assert.equal(isAllowAllFutureAnswer(""), false);
  const fetched = ["sc-domain:a.example", "https://b.example/"];
  assert.deepEqual(parsePropertySelectionAnswer("all", fetched, 0), ["all"]);
  assert.deepEqual(parsePropertySelectionAnswer("ALL", fetched, 0), ["all"]);
});

// --- Generated GSC_SITE_URLS stays exact and round-trips ---

test("buildEnv stores allow-all exactly as JSON and round-trips through envAllowlist", () => {
  const base = { secretsPath: null, keyFile: null, mode: "custom", scopes: "readonly", write: false };
  const env = setup.buildEnv({ ...base, sites: ["all"] });
  assert.equal(env.GSC_SITE_URLS, '["all"]');
  withSiteUrls(env.GSC_SITE_URLS, () => {
    assert.deepEqual(envAllowlist(), ["all"]);
  });
  assert.throws(() => setup.buildEnv({ ...base, sites: ["all", "sc-domain:a.example"] }), /mixes "all"/);
  const explicit = setup.buildEnv({ ...base, sites: ["sc-domain:a.example", "https://b.example/"] });
  assert.deepEqual(JSON.parse(explicit.GSC_SITE_URLS), ["sc-domain:a.example", "https://b.example/"]);
});

// --- Doctor, capabilities, and list filtering honor the explicit opt-in ---

test("doctor displays allow-all without enumerating properties", () => {
  withSiteUrls("all", () => {
    const report = doctor.runDoctor();
    assert.equal(report.checks.find((c) => c.id === "site_urls").detail, "all (explicit opt-in)");
    assert.equal(report.checks.find((c) => c.id === "allowlist").detail, "sites: all (explicit opt-in)");
    assert.ok(!JSON.stringify(report).includes("future.example"));
  });
  withSiteUrls('["sc-domain:a.example"]', () => {
    const report = doctor.runDoctor();
    assert.match(report.checks.find((c) => c.id === "site_urls").detail, /1 configured/);
  });
});

test("gscCapabilities keeps allow-all exact with no empty-allowlist warning", () => {
  const cap = tools.gscCapabilities({ provider, allowlist: ["all"] });
  assert.deepEqual(cap.data.allowedSites, ["all"]);
  assert.ok(!cap.meta.warnings.some((w) => w.code === "NO_ALLOWLIST"));
  const empty = tools.gscCapabilities({ provider, allowlist: [] });
  assert.ok(empty.meta.warnings.some((w) => w.code === "NO_ALLOWLIST"));
});

test("gscListSites returns every visible property under allow-all with no truncation", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/sites")
      ? new Response(
          JSON.stringify({ siteEntry: [{ siteUrl: "sc-domain:a.example" }, { siteUrl: "https://b.example/" }] }),
          { status: 200 }
        )
      : new Response("{}", { status: 404 });
  const allowAll = await tools.gscListSites({ provider, fetchImpl, allowlist: ["all"] });
  assert.deepEqual(
    allowAll.data.sites.map((s) => s.siteUrl).sort(),
    ["https://b.example/", "sc-domain:a.example"]
  );
  assert.equal(allowAll.meta.coverage.truncatedByProduct, false);
  assert.deepEqual(allowAll.meta.coverage.stoppedBecause, []);
  const filtered = await tools.gscListSites({ provider, fetchImpl, allowlist: ["sc-domain:a.example"] });
  assert.deepEqual(filtered.data.sites.map((s) => s.siteUrl), ["sc-domain:a.example"]);
  assert.deepEqual(filtered.meta.coverage.stoppedBecause, ["instance_allowlist"]);
});

// --- Setup choice: sentinel requires no enumeration and dry-run writes nothing ---

test("dry-run with --site all previews the exact sentinel and writes nothing", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-allowall-home-"));
  const dataDir = mkdtempSync(join(tmpdir(), "gsc-allowall-data-"));
  const tmp = mkdtempSync(join(tmpdir(), "gsc-allowall-tmp-"));
  const env = cleanEnv({ HOME: home, GSC_DATA_DIR: dataDir, TMPDIR: tmp });
  const before = spawnSync(process.execPath, [entry, "setup", "--dry-run", "--yes", "--auth", "shared", "--site", "all", "--client", "print"], {
    encoding: "utf8",
    env,
  });
  assert.equal(before.status, 0, `stderr: ${before.stderr}`);
  // The print preview is a JSON block, so the exact sentinel string `["all"]`
  // appears JSON-escaped; assert the escaped form plus the key name.
  assert.ok(before.stdout.includes('GSC_SITE_URLS'), `stdout should name the env key: ${before.stdout.slice(0, 500)}`);
  assert.ok(before.stdout.includes('[\\"all\\"]'), `stdout should carry the exact sentinel (JSON-escaped): ${before.stdout.slice(0, 500)}`);
  assert.ok(!before.stdout.includes("sc-domain:yoursite.com"), "dry-run sentinel must not fall back to the placeholder");
});

test("dry-run with mixed all plus site fails closed", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const env = isolatedEnv({ LC_ALL: "C" });
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--dry-run", "--yes", "--auth", "shared", "--site", "all", "--site", "sc-domain:a.example", "--client", "print"],
    { encoding: "utf8", env }
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /mixes "all"/);
});

test("normal allowlist behavior is unchanged", () => {
  withSiteUrls('["sc-domain:Example.COM","https://shop.example/sale,2026/"]', () => {
    assert.deepEqual(envAllowlist(), ["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
  });
  withSiteUrls("sc-domain:a.example, https://b.example/ ", () => {
    assert.deepEqual(envAllowlist(), ["sc-domain:a.example", "https://b.example/"]);
  });
  withSiteUrls("bogus", () => {
    assert.throws(() => envAllowlist(), /Invalid property/);
  });
  withSiteUrls('["sc-domain:a.example", 42]', () => {
    assert.throws(() => envAllowlist(), /non-empty valid property strings/);
  });
});
