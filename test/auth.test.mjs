import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const dataDir = mkdtempSync(join(tmpdir(), "gsc-auth-"));

const tokenFile = () => join(dataDir, "oauth-token.json");

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

const oauth = await import("../dist/oauth.js");
const provider = await import("../dist/auth-provider.js");
const authConfig = await import("../dist/auth.js");

test("scope tier defaults to readonly; full is explicit opt-in", async () => {
  await withEnv({ GSC_SCOPES: undefined }, () => assert.equal(oauth.getScopeTier(), "readonly"));
  await withEnv({ GSC_SCOPES: "readonly" }, () => assert.equal(oauth.getScopeTier(), "readonly"));
  await withEnv({ GSC_SCOPES: "full" }, () => assert.equal(oauth.getScopeTier(), "full"));
  await withEnv({ GSC_SCOPES: "FULL" }, () => assert.equal(oauth.getScopeTier(), "full"));
});

test("readonly cache accepts readonly grants but rejects known write grants and unknown legacy grants", async () => {
  await withEnv({ GSC_SCOPES: "readonly" }, () => {
    const readonly = oauth.scopesForTier("readonly")[0];
    assert.equal(oauth.cachedTokenCoversScopes({ scope: readonly }), true);
    assert.equal(oauth.cachedTokenCoversScopes({ scope: `${readonly} https://www.googleapis.com/auth/webmasters` }), false);
    assert.equal(oauth.cachedTokenCoversScopes({ scope: `${readonly} https://www.googleapis.com/auth/indexing` }), false);
    assert.equal(oauth.cachedTokenCoversScopes({}), false);
  });
  await withEnv({ GSC_SCOPES: "full" }, () => assert.equal(oauth.cachedTokenCoversScopes({}), true));
});

test("explicit Desktop secrets file takes precedence over ambient client variables", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "gsc-client-selection-")), "client.json");
  writeFileSync(file, JSON.stringify({ installed: { client_id: "file-id", client_secret: "file-secret" } }));
  await withEnv({ GSC_OAUTH_SECRETS_FILE: file, GSC_OAUTH_CLIENT_ID: "ambient-id", GSC_OAUTH_CLIENT_SECRET: "ambient-secret" }, () => {
    const config = oauth.getOAuthConfig();
    assert.equal(config.clientId, "file-id");
    assert.equal(config.clientSecret, "file-secret");
  });
});

test("cached OAuth identity requires exact match and rejects legacy entries", async () => {
  await withEnv({ GSC_SCOPES: "readonly" }, () => {
    const token = { gsc_client_id: "client-a", scope: oauth.scopesForTier("readonly")[0] };
    assert.equal(oauth.cachedTokenSuitable(token, "client-a"), true);
    assert.equal(oauth.cachedTokenSuitable(token, "client-b"), false);
    assert.equal(oauth.cachedTokenSuitable({ scope: token.scope }, "client-a"), false);
    assert.equal(Object.hasOwn(oauth.credentialsOnly(token), "gsc_client_id"), false);
  });
});

test("PKCE challenge matches the RFC 7636 vector", () => {
  assert.equal(
    oauth.codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  );
  const verifier = oauth.generateCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(oauth.codeChallenge(verifier).length, 43);
});

test("authorization URL carries the S256 challenge", async () => {
  const { google } = await import("googleapis");
  const client = new google.auth.OAuth2("id", "secret", "http://127.0.0.1:3847");
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
    code_challenge_method: "S256",
    code_challenge: oauth.codeChallenge("test-verifier"),
  });
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, /code_challenge=[A-Za-z0-9_-]+/);
});

test("provider factory follows GSC_AUTH_MODE", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SCOPES: undefined }, () => {
    const p = provider.getAuthProvider();
    assert.deepEqual(p.describe(), { mode: "oauth", scopeTier: "readonly" });
  });
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_SCOPES: undefined }, () => {
    const p = provider.getAuthProvider();
    assert.deepEqual(p.describe(), { mode: "service_account", scopeTier: "readonly" });
  });
});

test("OAuth provider without a session demands explicit login", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir }, async () => {
    await assert.rejects(new provider.OAuthTokenProvider().getAccessToken(), /AUTH_REQUIRED/);
    const status = provider.authStatusOffline();
    assert.equal(status.session, "none");
  });
});

test("OAuth provider characterizes concurrent refresh and cached-token merge", async () => {
  const { google } = await import("googleapis");
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    const original = google.auth.OAuth2.prototype.refreshAccessToken;
    const deferred = Promise.withResolvers();
    const started = Promise.withResolvers();
    let refreshes = 0;
    google.auth.OAuth2.prototype.refreshAccessToken = function () {
      refreshes++;
      started.resolve();
      return deferred.promise;
    };
    try {
      writeFileSync(tokenFile(), JSON.stringify({ access_token: "expired", refresh_token: "refresh-value", expiry_date: Date.now() - 1000, gsc_client_id: "test-client", scope: oauth.scopesForTier("readonly")[0] }));
      const p = new provider.OAuthTokenProvider();
      const first = p.getAccessToken();
      const second = p.getAccessToken();
      await started.promise;
      assert.equal(refreshes, 1);
      deferred.resolve({ credentials: { access_token: "renewed", expiry_date: Date.now() + 3600_000 } });
      assert.deepEqual(await Promise.all([first, second]), ["renewed", "renewed"]);
      const cached = JSON.parse((await import("node:fs")).readFileSync(tokenFile(), "utf8"));
      assert.equal(cached.refresh_token, "refresh-value");
      assert.equal(cached.access_token, "renewed");
    } finally {
      google.auth.OAuth2.prototype.refreshAccessToken = original;
      if (existsSync(tokenFile())) (await import("node:fs")).unlinkSync(tokenFile());
    }
  });
});

test("OAuth singleflight resets after failure and accepts a later cached token", async () => {
  const { google } = await import("googleapis");
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    const original = google.auth.OAuth2.prototype.refreshAccessToken;
    const firstRefresh = Promise.withResolvers();
    const started = Promise.withResolvers();
    let refreshes = 0;
    google.auth.OAuth2.prototype.refreshAccessToken = function () {
      refreshes++;
      started.resolve();
      return refreshes === 1 ? firstRefresh.promise : Promise.resolve({ credentials: { access_token: "recovered", expiry_date: Date.now() + 3600_000 } });
    };
    try {
      writeFileSync(tokenFile(), JSON.stringify({ access_token: "expired", refresh_token: "refresh-value", expiry_date: Date.now() - 1000, gsc_client_id: "test-client", scope: oauth.scopesForTier("readonly")[0] }));
      const p = new provider.OAuthTokenProvider();
      const first = p.getAccessToken();
      const second = p.getAccessToken();
      const results = Promise.allSettled([first, second]);
      await started.promise;
      assert.equal(refreshes, 1);
      firstRefresh.reject(new Error("mock refresh failure"));
      const failed = await results;
      assert.ok(failed.every((result) => result.status === "rejected" && /REAUTH_REQUIRED/.test(result.reason.message)));
      assert.equal(await p.getAccessToken(), "recovered");
      assert.equal(refreshes, 2);
      assert.equal(await p.getAccessToken(), "recovered");
      assert.equal(refreshes, 2);
    } finally {
      google.auth.OAuth2.prototype.refreshAccessToken = original;
      if (existsSync(tokenFile())) (await import("node:fs")).unlinkSync(tokenFile());
    }
  });
});

test("OAuth refresh without a new access token keeps the cached file unchanged", async () => {
  const { google } = await import("googleapis");
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    const original = google.auth.OAuth2.prototype.refreshAccessToken;
    google.auth.OAuth2.prototype.refreshAccessToken = async () => ({ credentials: { expiry_date: Date.now() + 3600_000 } });
    try {
      const expired = { access_token: "expired", refresh_token: "refresh-value", expiry_date: Date.now() - 1000, gsc_client_id: "test-client", scope: oauth.scopesForTier("readonly")[0] };
      writeFileSync(tokenFile(), JSON.stringify(expired));
      await assert.rejects(new provider.OAuthTokenProvider().getAccessToken(), /REAUTH_REQUIRED/);
      assert.deepEqual(JSON.parse((await import("node:fs")).readFileSync(tokenFile(), "utf8")), expired);
    } finally {
      google.auth.OAuth2.prototype.refreshAccessToken = original;
      if (existsSync(tokenFile())) (await import("node:fs")).unlinkSync(tokenFile());
    }
  });
});

test("online status classifies 401 and counts sites", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    writeFileSync(tokenFile(), JSON.stringify({ access_token: "a", refresh_token: "r", expiry_date: Date.now() + 3600_000, gsc_client_id: "test-client", scope: oauth.scopesForTier("readonly")[0] }));
    try {
      const unauth = await provider.authStatusOnline(async () => ({ status: 401, ok: false }));
      assert.equal(unauth.session, "none");
      assert.match(unauth.detail, /401/);
      const ok = await provider.authStatusOnline(
        async () => ({ status: 200, ok: true, json: async () => ({ siteEntry: [{}, {}] }) })
      );
      assert.equal(ok.sites, 2);
    } finally {
      if (existsSync(tokenFile())) (await import("node:fs")).unlinkSync(tokenFile());
    }
  });
});

test("online status never leaks fetch/provider rejection text", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    const sentinel = "SENTINEL-STATUS-2d8f";
    const bomb = () => { throw new Error(`transport blew up ${sentinel} token=secret-value`); };
    const rejectingProvider = { getAccessToken: async () => { throw new Error(`weird provider failure ${sentinel} path=/private/x`); } };
    const fromFetch = await provider.authStatusOnline(bomb, { getAccessToken: async () => "tok" });
    assert.equal(fromFetch.sites, undefined);
    assert.match(fromFetch.detail, /network_error/);
    assert.ok(!JSON.stringify(fromFetch).includes(sentinel));
    assert.ok(!JSON.stringify(fromFetch).includes("secret-value"));
    const fromProvider = await provider.authStatusOnline(
      async () => { throw new Error("fetch must stay untouched"); },
      rejectingProvider
    );
    assert.equal(fromProvider.sites, undefined);
    assert.match(fromProvider.detail, /network_error/);
    assert.ok(!JSON.stringify(fromProvider).includes(sentinel));
  });
});

test("online status maps trusted codes and malformed 2xx to stable detail", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir, GSC_OAUTH_SECRETS_FILE: undefined, GSC_OAUTH_CLIENT_ID: "test-client", GSC_OAUTH_CLIENT_SECRET: "test-secret" }, async () => {
    const noSession = await provider.authStatusOnline(
      async () => { throw new Error("fetch must stay untouched"); },
      { getAccessToken: async () => { throw new Error("AUTH_REQUIRED: no OAuth session cached."); } }
    );
    assert.match(noSession.detail, /AUTH_REQUIRED/);
    assert.equal(noSession.sites, undefined);
    const malformed = await provider.authStatusOnline(
      async () => ({ status: 200, ok: true, json: async () => ({ siteEntry: [null] }) }),
      { getAccessToken: async () => "tok" }
    );
    assert.match(malformed.detail, /UPSTREAM_SCHEMA_CHANGED/);
    assert.equal(malformed.sites, undefined);
  });
});

test("logout removes the cached session and revoke needs --yes", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dataDir }, async () => {
    assert.equal(provider.authLogout(), "No cached OAuth session to remove.");
    writeFileSync(tokenFile(), JSON.stringify({ access_token: "a", refresh_token: "r" }));
    assert.match(provider.authLogout(), /removed/);
    assert.ok(!existsSync(tokenFile()));
    await assert.rejects(provider.authRevoke(false), /--yes/);
    assert.equal(await provider.authRevoke(true), "No cached OAuth session; nothing to revoke.");
    writeFileSync(tokenFile(), JSON.stringify({ access_token: "tok123", refresh_token: "r" }));
    const calls = [];
    const msg = await provider.authRevoke(true, async (url, init) => {
      calls.push({ url, init });
      return { status: 200, ok: true };
    });
    assert.match(msg, /removed locally/);
    assert.ok(calls[0].url.includes("revoke?token=tok123"));
    assert.ok(!existsSync(tokenFile()));
  });
});

test("cli auth status/logout/revoke behave without secrets", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-auth-cli-"));
  const env = { ...process.env, GSC_AUTH_MODE: "oauth", GSC_DATA_DIR: dir };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_") && key !== "GSC_AUTH_MODE" && key !== "GSC_DATA_DIR") delete env[key];
  }
  const status = spawnSync(process.execPath, [entry, "auth", "status"], { encoding: "utf8", env });
  assert.equal(status.status, 0);
  const report = JSON.parse(status.stdout);
  assert.equal(report.session, "none");
  assert.ok(!status.stdout.includes("refresh_token"));

  const revoke = spawnSync(process.execPath, [entry, "auth", "revoke"], { encoding: "utf8", env });
  assert.equal(revoke.status, 1);
  assert.match(revoke.stderr, /--yes/);

  writeFileSync(join(dir, "oauth-token.json"), JSON.stringify({ access_token: "a" }));
  const logout = spawnSync(process.execPath, [entry, "auth", "logout"], { encoding: "utf8", env });
  assert.equal(logout.status, 0);
  assert.ok(!existsSync(join(dir, "oauth-token.json")));
});

test("getConfig resolves a JSON allowlist with commas exactly", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: JSON.stringify(["sc-domain:Example.COM", "https://shop.example/sale,2026/"]) }, () => {
    const config = authConfig.getConfig();
    assert.deepEqual(config.siteUrls, ["sc-domain:Example.COM", "https://shop.example/sale,2026/"]);
  });
});

test("getConfig retains legacy comma-separated values", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: "sc-domain:a.example, https://b.example/ " }, () => {
    assert.deepEqual(authConfig.getConfig().siteUrls, ["sc-domain:a.example", "https://b.example/"]);
  });
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: undefined }, () => {
    assert.deepEqual(authConfig.getConfig().siteUrls, []);
  });
});

test("getConfig fails closed on malformed JSON allowlists", async () => {
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: '["sc-domain:a.example", 42]' }, () => {
    assert.throws(() => authConfig.getConfig(), /non-empty valid property strings/);
  });
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: '["unclosed' }, () => {
    assert.throws(() => authConfig.getConfig(), /not valid JSON/);
  });
  await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: '{"allowedSites":[]}' }, () => {
    assert.throws(() => authConfig.getConfig(), /array of non-empty valid property strings/);
  });
});

test("getConfig fails closed on scalars, garbage, and invalid entries", async () => {
  for (const bad of ['"sc-domain:a.example"', '42', 'true', 'null', 'bogus', 'sc-domain:a.example,', '["bogus"]']) {
    await withEnv({ GSC_AUTH_MODE: "oauth", GSC_SITE_URLS: bad }, () => {
      assert.throws(() => authConfig.getConfig(), /Invalid property|empty property entry/, `value ${bad}`);
    });
  }
});

test("offline status in default mode hints at a cached OAuth token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-status-hint-"));
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: undefined, GSC_DATA_DIR: dir }, () => {
    const bare = provider.authStatusOffline();
    assert.equal(bare.mode, "service_account");
    assert.equal(bare.session, "none");
    assert.equal(bare.detail, "GSC_KEY_FILE is not set or missing");
  });
  writeFileSync(join(dir, "oauth-token.json"), JSON.stringify({ marker: "hint-fixture" }));
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: undefined, GSC_DATA_DIR: dir }, () => {
    const hinted = provider.authStatusOffline();
    assert.equal(hinted.mode, "service_account");
    assert.equal(hinted.session, "none");
    assert.match(hinted.detail, /GSC_KEY_FILE is not set or missing/);
    assert.match(hinted.detail, /GSC_AUTH_MODE=oauth/);
    assert.ok(!JSON.stringify(hinted).includes("hint-fixture"));
  });
  await withEnv({ GSC_AUTH_MODE: undefined, GSC_KEY_FILE: join(dir, "nope.json"), GSC_DATA_DIR: dir }, () => {
    const explicit = provider.authStatusOffline();
    assert.equal(explicit.detail, "GSC_KEY_FILE is not set or missing");
  });
});
