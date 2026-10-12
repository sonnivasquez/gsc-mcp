import assert from "node:assert/strict";
import test from "node:test";
import { google } from "googleapis";
import { getScopeTier, scopesForTier, cachedTokenCoversScopes } from "../dist/oauth.js";
import { assertWriteEnabled } from "../dist/auth.js";
import { OAuthTokenProvider, ServiceAccountProvider } from "../dist/auth-provider.js";
import { runDoctor } from "../dist/doctor.js";
import { gscCapabilities } from "../dist/gsc/tools.js";

async function withAccess(values, fn) {
  const keys = ["GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_ENABLE_WRITE", "GSC_KEY_FILE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try { return await fn(); }
  finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("canonical full grants full scopes and writes without legacy flags", async () => {
  await withAccess({ GSC_ACCESS_MODE: "full" }, () => {
    assert.equal(getScopeTier(), "full");
    assert.doesNotThrow(() => assertWriteEnabled("submission"));
    for (const provider of [new OAuthTokenProvider(), new ServiceAccountProvider()]) {
      assert.equal(provider.describe().scopeTier, "full");
    }
    assert.equal(cachedTokenCoversScopes({ scope: scopesForTier("full").join(" ") }), true);
    assert.equal(gscCapabilities().data.disabledCapabilities.includes("gsc_submit_url"), false);
  });
});

test("canonical access overrides legacy flags in both directions", async () => {
  await withAccess({ GSC_ACCESS_MODE: "readonly", GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () => {
    assert.equal(getScopeTier(), "readonly");
    assert.throws(() => assertWriteEnabled("submission"), /GSC_ACCESS_MODE=full/);
    assert.equal(cachedTokenCoversScopes({ scope: scopesForTier("full").join(" ") }), false);
  });
  await withAccess({ GSC_ACCESS_MODE: "full", GSC_SCOPES: "readonly", GSC_ENABLE_WRITE: "0" }, () => {
    assert.equal(getScopeTier(), "full");
    assert.doesNotThrow(() => assertWriteEnabled("submission"));
  });
});

test("invalid canonical access refuses scopes and writes without legacy fallback or value echo", async () => {
  for (const value of ["", "FULL", " full ", "invalid-private-marker"]) {
    await withAccess({ GSC_ACCESS_MODE: value, GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () => {
      for (const action of [getScopeTier, () => assertWriteEnabled("submission")]) {
        assert.throws(action, (error) => /GSC_ACCESS_MODE/.test(error.message) && !error.message.includes("private-marker"));
      }
      const check = runDoctor().checks.find((item) => item.id === "write_ops");
      assert.equal(check.ok, false);
      assert.match(check.detail, /GSC_ACCESS_MODE/);
      assert.equal(check.detail.includes("private-marker"), false);
    });
  }
});

test("legacy configurations preserve scopes, token compatibility and exact write opt-in", async () => {
  for (const scope of [undefined, "readonly", "full", "FULL", " full ", "invalid"]) {
    for (const write of [undefined, "0", "1", "true"]) {
      await withAccess({ GSC_SCOPES: scope, GSC_ENABLE_WRITE: write }, () => {
        const full = scope?.toLowerCase() === "full";
        assert.equal(getScopeTier(), full ? "full" : "readonly");
        assert.equal(cachedTokenCoversScopes({ scope: scopesForTier("full").join(" ") }), full);
        if (full && write === "1") assert.doesNotThrow(() => assertWriteEnabled("submission"));
        else assert.throws(() => assertWriteEnabled("submission"));
      });
    }
  }
});

test("doctor reports canonical full and legacy full with writes disabled accurately", async () => {
  await withAccess({ GSC_ACCESS_MODE: "full" }, () => {
    const check = runDoctor().checks.find((item) => item.id === "write_ops");
    assert.equal(check.ok, true);
    assert.match(check.detail, /ENABLED.*GSC_ACCESS_MODE=full/);
  });
  await withAccess({ GSC_SCOPES: "full" }, () => {
    const check = runDoctor().checks.find((item) => item.id === "write_ops");
    assert.equal(check.ok, true);
    assert.match(check.detail, /disabled.*legacy/);
  });
});

test("service account token requests use canonical scopes without contacting Google", async () => {
  const OriginalGoogleAuth = google.auth.GoogleAuth;
  const requested = [];
  google.auth.GoogleAuth = class {
    constructor(options) { requested.push(options.scopes); }
    async getClient() { return { getAccessToken: async () => ({ token: "fixture" }) }; }
  };
  try {
    for (const mode of ["readonly", "full"]) {
      await withAccess({ GSC_ACCESS_MODE: mode, GSC_KEY_FILE: "fixture-not-read.json" }, async () => {
        assert.equal(await new ServiceAccountProvider().getAccessToken(), "fixture");
        assert.deepEqual(requested.at(-1), scopesForTier(mode));
      });
    }
  } finally { google.auth.GoogleAuth = OriginalGoogleAuth; }
});
