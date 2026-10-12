import { CLI_TEST_TIMEOUT_MS, homeEnvironment } from "./helpers/subprocess.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const oauth = await import("../dist/oauth.js");
const provider = await import("../dist/auth-provider.js");

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

function modeOf(p) {
  return statSync(p).mode & 0o777;
}

test("default path stays HOME/.gsc-mcp when GSC_DATA_DIR is unset", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-default-"));
  // Bun caches os.homedir() at process startup, so in-process HOME mutation
  // cannot move the default path. Assert it in a fresh subprocess whose HOME
  // is set before runtime startup. The probe only resolves paths, never reads tokens.
  const probe = join(home, "probe-default-path.mjs");
  const oauthUrl = new URL("../dist/oauth.js", import.meta.url).href;
  writeFileSync(
    probe,
    `import { tokenDir, cachedTokenPath, tokenPath } from ${JSON.stringify(oauthUrl)};\n` +
      `console.log(JSON.stringify({ dir: tokenDir(), cached: cachedTokenPath(), alias: tokenPath() }));\n`
  );
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GSC_")) delete env[key];
  }
  const r = spawnSync(process.execPath, [probe], {
    encoding: "utf8",
    env: { ...env, ...homeEnvironment(home) },
  });
  assert.equal(r.status, 0, `default-path probe failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.dir, join(home, ".gsc-mcp"));
  assert.equal(out.cached, join(home, ".gsc-mcp", "oauth-token.json"));
  assert.equal(out.alias, out.cached);
});

test("GSC_DATA_DIR overrides HOME for every token helper", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-scoped-"));
  const scoped = mkdtempSync(join(tmpdir(), "gsc-data-scoped-"));
  await withEnv({ ...homeEnvironment(home), GSC_DATA_DIR: scoped }, () => {
    assert.equal(oauth.tokenDir(), scoped);
    assert.equal(oauth.cachedTokenPath(), join(scoped, "oauth-token.json"));
    assert.equal(oauth.tokenPath(), oauth.cachedTokenPath());
    assert.ok(!oauth.cachedTokenPath().startsWith(join(home, ".gsc-mcp")));
  });
});

test("round-trip save/load uses the active scoped file with private permissions", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-roundtrip-"));
  const scoped = mkdtempSync(join(tmpdir(), "gsc-data-roundtrip-"));
  await withEnv({ ...homeEnvironment(home), GSC_DATA_DIR: scoped, GSC_SCOPES: "readonly" }, () => {
    const token = {
      access_token: "roundtrip-access",
      refresh_token: "roundtrip-refresh",
      expiry_date: Date.now() + 3600_000,
      scope: oauth.scopesForTier("readonly")[0],
      gsc_client_id: "roundtrip-client",
    };
    oauth.saveCachedToken(token);
    const file = join(scoped, "oauth-token.json");
    assert.ok(existsSync(file));
    assert.deepEqual(oauth.loadCachedToken(), token);
    if (process.platform !== "win32") {
      assert.equal(modeOf(scoped), 0o700);
      assert.equal(modeOf(file), 0o600);
    }
    oauth.clearCachedToken();
    assert.ok(!existsSync(file));
    assert.equal(oauth.loadCachedToken(), null);
  });
});

test("scoped save/clear leaves a legacy HOME sentinel untouched and never migrates it", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-legacy-"));
  const scoped = mkdtempSync(join(tmpdir(), "gsc-data-legacy-"));
  const legacyDir = join(home, ".gsc-mcp");
  mkdirSync(legacyDir, { recursive: true });
  const legacyFile = join(legacyDir, "oauth-token.json");
  const legacyRaw = JSON.stringify({ marker: "legacy-sentinel", access_token: "legacy-value" });
  writeFileSync(legacyFile, legacyRaw);
  await withEnv({ ...homeEnvironment(home), GSC_DATA_DIR: scoped, GSC_SCOPES: "readonly" }, () => {
    const scopedToken = {
      access_token: "scoped-access",
      refresh_token: "scoped-refresh",
      expiry_date: Date.now() + 3600_000,
      scope: oauth.scopesForTier("readonly")[0],
      gsc_client_id: "scoped-client",
    };
    oauth.saveCachedToken(scopedToken);
    const scopedFile = join(scoped, "oauth-token.json");
    assert.ok(existsSync(scopedFile));
    assert.equal(readFileSync(legacyFile, "utf8"), legacyRaw);
    assert.deepEqual(oauth.loadCachedToken(), scopedToken);
    oauth.clearCachedToken();
    assert.ok(!existsSync(scopedFile));
    assert.equal(readFileSync(legacyFile, "utf8"), legacyRaw);
    assert.equal(oauth.loadCachedToken(), null);
  });
  assert.equal(readFileSync(legacyFile, "utf8"), legacyRaw);
});

test("fresh cached session is a cache-hit and never opens a browser", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-home-cachehit-"));
  const scoped = mkdtempSync(join(tmpdir(), "gsc-data-cachehit-"));
  await withEnv(
    {
      ...homeEnvironment(home),
      GSC_DATA_DIR: scoped,
      GSC_SCOPES: "readonly",
      GSC_OAUTH_SECRETS_FILE: undefined,
      GSC_OAUTH_CLIENT_ID: "cachehit-client",
      GSC_OAUTH_CLIENT_SECRET: "cachehit-secret",
    },
    async () => {
      const token = {
        access_token: "cachehit-access",
        refresh_token: "cachehit-refresh",
        expiry_date: Date.now() + 3600_000,
        scope: oauth.scopesForTier("readonly")[0],
        gsc_client_id: "cachehit-client",
      };
      oauth.saveCachedToken(token);
      const client = await oauth.authenticateWithOAuth();
      assert.equal(client.credentials.access_token, "cachehit-access");
      assert.deepEqual(oauth.loadCachedToken(), token);
    }
  );
});

test("provider refresh writer keeps private directory and file permissions", async () => {
  const { google } = await import("googleapis");
  const home = mkdtempSync(join(tmpdir(), "gsc-home-refresh-"));
  const scoped = mkdtempSync(join(tmpdir(), "gsc-data-refresh-"));
  await withEnv(
    {
      ...homeEnvironment(home),
      GSC_DATA_DIR: scoped,
      GSC_AUTH_MODE: "oauth",
      GSC_SCOPES: "readonly",
      GSC_OAUTH_SECRETS_FILE: undefined,
      GSC_OAUTH_CLIENT_ID: "refresh-perm-client",
      GSC_OAUTH_CLIENT_SECRET: "refresh-perm-secret",
    },
    async () => {
      const original = google.auth.OAuth2.prototype.refreshAccessToken;
      google.auth.OAuth2.prototype.refreshAccessToken = async function () {
        return { credentials: { access_token: "renewed-access", expiry_date: Date.now() + 3600_000 } };
      };
      try {
        writeFileSync(
          join(scoped, "oauth-token.json"),
          JSON.stringify({
            access_token: "expired-access",
            refresh_token: "refresh-value",
            expiry_date: Date.now() - 1000,
            scope: oauth.scopesForTier("readonly")[0],
            gsc_client_id: "refresh-perm-client",
          })
        );
        const access = await new provider.OAuthTokenProvider().getAccessToken();
        assert.equal(access, "renewed-access");
        if (process.platform !== "win32") {
          assert.equal(modeOf(scoped), 0o700);
          assert.equal(modeOf(join(scoped, "oauth-token.json")), 0o600);
        }
      } finally {
        google.auth.OAuth2.prototype.refreshAccessToken = original;
      }
    }
  );
});
