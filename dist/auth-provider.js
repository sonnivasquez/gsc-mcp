"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SITES_LIST_SHAPE_ERROR = exports.SITES_LIST_URL = exports.ServiceAccountProvider = exports.OAuthTokenProvider = void 0;
exports.getAuthProvider = getAuthProvider;
exports.authStatusOffline = authStatusOffline;
exports.parseSitesListBody = parseSitesListBody;
exports.fetchSitesList = fetchSitesList;
exports.authStatusOnline = authStatusOnline;
exports.authLogin = authLogin;
exports.authLogout = authLogout;
exports.authRevoke = authRevoke;
const fs = __importStar(require("node:fs"));
const auth_js_1 = require("./auth.js");
const profiles_js_1 = require("./profiles.js");
const oauth_js_1 = require("./oauth.js");
function readCachedToken() {
    try {
        return JSON.parse(fs.readFileSync((0, oauth_js_1.cachedTokenPath)(), "utf8"));
    }
    catch {
        return null;
    }
}
const REFRESH_MARGIN_MS = 60_000;
class OAuthTokenProvider {
    refreshInFlight = null;
    describe() {
        return { mode: "oauth", scopeTier: (0, oauth_js_1.getScopeTier)() };
    }
    async getAccessToken() {
        const cached = readCachedToken();
        if (cached === null || !cached.refresh_token) {
            throw new Error("AUTH_REQUIRED: no OAuth session cached. Run `gsc auth login` in a terminal.");
        }
        const { clientId, clientSecret } = (0, oauth_js_1.getOAuthConfig)();
        if (!(0, oauth_js_1.cachedTokenSuitable)(cached, clientId)) {
            throw new Error("REAUTH_REQUIRED: cached OAuth session does not match this client and access tier. Run `gsc auth login` in a terminal.");
        }
        if (cached.access_token && cached.expiry_date && cached.expiry_date - REFRESH_MARGIN_MS > Date.now()) {
            return cached.access_token;
        }
        if (this.refreshInFlight)
            return this.refreshInFlight;
        const directory = (0, oauth_js_1.tokenDir)();
        const file = (0, oauth_js_1.cachedTokenPath)();
        const pending = (async () => {
            try {
                // Install refreshInFlight before any module-loading await can yield.
                const { google } = await import("googleapis");
                const client = new google.auth.OAuth2(clientId, clientSecret);
                client.setCredentials((0, oauth_js_1.credentialsOnly)(cached));
                const { credentials } = await client.refreshAccessToken();
                if (!credentials.access_token)
                    throw new Error("refresh returned no access token");
                const merged = { ...cached, ...credentials, gsc_client_id: clientId };
                fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
                try {
                    fs.chmodSync(directory, 0o700);
                }
                catch {
                    // best effort on non-POSIX filesystems
                }
                fs.writeFileSync(file, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600 });
                try {
                    fs.chmodSync(file, 0o600);
                }
                catch {
                    // best effort on non-POSIX filesystems
                }
                return credentials.access_token;
            }
            catch {
                throw new Error("REAUTH_REQUIRED: the OAuth session cannot be renewed. Run `gsc auth login` in a terminal.");
            }
        })();
        this.refreshInFlight = pending;
        try {
            return await pending;
        }
        finally {
            if (this.refreshInFlight === pending)
                this.refreshInFlight = null;
        }
    }
}
exports.OAuthTokenProvider = OAuthTokenProvider;
class ServiceAccountProvider {
    describe() {
        return { mode: "service_account", scopeTier: (0, oauth_js_1.getScopeTier)() };
    }
    async getAccessToken() {
        const keyFile = process.env.GSC_KEY_FILE;
        if (!keyFile) {
            throw new Error("AUTH_REQUIRED: GSC_KEY_FILE is not set for service_account mode.");
        }
        const scopes = (0, oauth_js_1.scopesForTier)((0, oauth_js_1.getScopeTier)());
        const { google } = await import("googleapis");
        const auth = new google.auth.GoogleAuth({ keyFile, scopes });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        const access = typeof token === "string" ? token : token?.token;
        if (!access)
            throw new Error("AUTH_REQUIRED: the service account issued no access token.");
        return access;
    }
}
exports.ServiceAccountProvider = ServiceAccountProvider;
let activeOAuthProvider = null;
function getAuthProvider() {
    const mode = (0, auth_js_1.getAuthMode)();
    const generation = (0, profiles_js_1.getActiveInstanceGeneration)();
    if (mode !== "oauth" || generation === null) {
        activeOAuthProvider = null;
        return mode === "oauth" ? new OAuthTokenProvider() : new ServiceAccountProvider();
    }
    const directory = (0, profiles_js_1.dataDir)();
    if (activeOAuthProvider?.generation !== generation || activeOAuthProvider.directory !== directory) {
        activeOAuthProvider = { generation, directory, provider: new OAuthTokenProvider() };
    }
    return activeOAuthProvider.provider;
}
function authStatusOffline() {
    const mode = (0, auth_js_1.getAuthMode)();
    if (mode === "service_account") {
        const keyFile = process.env.GSC_KEY_FILE ?? "";
        const present = keyFile !== "" && fs.existsSync(keyFile);
        if (present) {
            return { mode, scopeTier: (0, oauth_js_1.getScopeTier)(), session: "key_file", detail: `key file at ${keyFile}` };
        }
        // `auth login` always mints an OAuth token, but the default mode is
        // service_account: without this hint, `auth status` reports "none" while
        // a valid OAuth session sits cached. Only hint when no key file was
        // chosen (an explicit-but-missing path is a deliberate mode choice).
        const oauthHint = keyFile === "" && fs.existsSync((0, oauth_js_1.cachedTokenPath)())
            ? `; OAuth token cached at ${(0, oauth_js_1.cachedTokenPath)()}, set GSC_AUTH_MODE=oauth to use it`
            : "";
        return {
            mode,
            scopeTier: (0, oauth_js_1.getScopeTier)(),
            session: "none",
            detail: `GSC_KEY_FILE is not set or missing${oauthHint}`,
        };
    }
    const cached = readCachedToken() !== null;
    return {
        mode,
        scopeTier: (0, oauth_js_1.getScopeTier)(),
        session: cached ? "cached" : "none",
        detail: cached ? `token cached at ${(0, oauth_js_1.cachedTokenPath)()}` : "no cached session; run `gsc auth login`",
    };
}
exports.SITES_LIST_URL = "https://www.googleapis.com/webmasters/v3/sites";
/** Stable classification for an unparseable or wrong-shaped 2xx body. */
exports.SITES_LIST_SHAPE_ERROR = "UPSTREAM_SCHEMA_CHANGED: sites.list response shape changed (expected an object with a siteEntry array)";
/**
 * One bounded `sites.list` call through the shared provider. The provider
 * only refreshes a cached session and never opens a browser, so this is
 * safe to reuse in serve-adjacent CLIs such as `doctor --online`. Token
 * failures throw the provider's plain CODE-prefixed Error for the caller
 * to report honestly; non-2xx HTTP statuses are returned, never thrown. A
 * 2xx response that is not JSON or lacks the siteEntry shape throws the
 * stable SITES_LIST_SHAPE_ERROR instead of masquerading as zero sites: a
 * valid empty account answers `{}` while anything else is API failure.
 */
/**
 * Pure shared shape gate for a sites.list response body. Throws the stable
 * SITES_LIST_SHAPE_ERROR on any wrong shape; a valid empty account (`{}`)
 * yields zero sites. Every member is structurally validated, never
 * silently filtered: a member must be a non-array object, an explicitly
 * present siteUrl must be a string, and a present permissionLevel must be
 * a string. Members without a siteUrl (such as {}) still count toward the
 * raw total for backward compatibility but never enter verification
 * entries. No I/O: setup reuses this on its single live response and
 * doctor reuses it on its single online call, so neither issues a second
 * HTTP request for validation.
 */
function parseSitesListBody(body) {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error(exports.SITES_LIST_SHAPE_ERROR);
    }
    const raw = body.siteEntry;
    if (raw !== undefined && !Array.isArray(raw)) {
        throw new Error(exports.SITES_LIST_SHAPE_ERROR);
    }
    const list = Array.isArray(raw) ? raw : [];
    // Every member is structurally validated, never silently filtered: a
    // member must be a non-array object, an explicitly present siteUrl must
    // be a string, and a present permissionLevel must be a string. Members
    // without a siteUrl (such as {}) still count toward the raw total for
    // backward compatibility but never enter verification entries.
    for (const member of list) {
        if (typeof member !== "object" || member === null || Array.isArray(member)) {
            throw new Error(exports.SITES_LIST_SHAPE_ERROR);
        }
        const siteUrl = member.siteUrl;
        if (siteUrl !== undefined && typeof siteUrl !== "string") {
            throw new Error(exports.SITES_LIST_SHAPE_ERROR);
        }
        const permissionLevel = member.permissionLevel;
        if (permissionLevel !== undefined && typeof permissionLevel !== "string") {
            throw new Error(exports.SITES_LIST_SHAPE_ERROR);
        }
    }
    const entries = list
        .filter((entry) => typeof entry.siteUrl === "string")
        .map((entry) => ({
        siteUrl: entry.siteUrl,
        permissionLevel: typeof entry.permissionLevel === "string" ? entry.permissionLevel : "",
    }));
    return { sites: list.length, entries };
}
async function fetchSitesList(provider, fetchImpl = fetch) {
    const token = await provider.getAccessToken();
    const res = await fetchImpl(exports.SITES_LIST_URL, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status < 200 || res.status >= 300) {
        return { status: res.status, sites: 0, entries: [] };
    }
    let body;
    try {
        body = await res.json();
    }
    catch {
        throw new Error(exports.SITES_LIST_SHAPE_ERROR);
    }
    return { status: res.status, ...parseSitesListBody(body) };
}
/**
 * Map an `auth status --online` failure to a trusted stable
 * classification. Only authored in-repo codes (AUTH_REQUIRED,
 * REAUTH_REQUIRED, UPSTREAM_SCHEMA_CHANGED) select fixed detail
 * sentences; arbitrary fetch/provider/JSON error text (paths, tokens,
 * upstreams) never reaches the output.
 */
function classifyAuthStatusError(err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.match(/^(AUTH_REQUIRED|REAUTH_REQUIRED|UPSTREAM_SCHEMA_CHANGED)\b/)?.[1];
    if (code === "AUTH_REQUIRED") {
        return "No usable Google session (AUTH_REQUIRED). Run `gsc auth login` or check the service-account setup.";
    }
    if (code === "REAUTH_REQUIRED") {
        return "The OAuth session cannot be renewed (REAUTH_REQUIRED). Run `gsc auth login`.";
    }
    if (code === "UPSTREAM_SCHEMA_CHANGED") {
        return "Google answered 200 with an unrecognized sites.list shape (UPSTREAM_SCHEMA_CHANGED); retry later.";
    }
    if (/timeout|timed\s*out|ETIMEDOUT|ECONNABORTED|EAI_AGAIN/i.test(message)) {
        return "Google check timed out (timeout); retry later.";
    }
    return "Google check failed (network_error); retry later.";
}
async function authStatusOnline(fetchImpl = fetch, provider = getAuthProvider()) {
    const base = authStatusOffline();
    let snapshot;
    try {
        snapshot = await fetchSitesList(provider, fetchImpl);
    }
    catch (err) {
        return { ...base, detail: classifyAuthStatusError(err) };
    }
    const res = { status: snapshot.status, ok: snapshot.status >= 200 && snapshot.status < 300 };
    if (res.status === 401) {
        return { ...base, session: "none", detail: "Google rejected the credentials (401). Run `gsc auth login`." };
    }
    if (res.status === 403) {
        return { ...base, detail: "Credentials valid but Search Console API is disabled or no property is shared (403)." };
    }
    if (!res.ok) {
        return { ...base, detail: `Google answered ${res.status}; retry later.` };
    }
    return { ...base, detail: "Google confirmed access.", sites: snapshot.sites };
}
async function authLogin() {
    await (0, oauth_js_1.authenticateWithOAuth)();
    return `OAuth session cached at ${(0, oauth_js_1.cachedTokenPath)()}.`;
}
function authLogout() {
    const file = (0, oauth_js_1.cachedTokenPath)();
    if (!fs.existsSync(file))
        return "No cached OAuth session to remove.";
    fs.unlinkSync(file);
    return `Cached OAuth session removed from ${file}. Service-account mode is unaffected.`;
}
async function authRevoke(confirmed, fetchImpl = fetch) {
    if (!confirmed) {
        throw new Error("Refusing without confirmation: re-run with --yes. Revocation also affects other sessions of the same app.");
    }
    const cached = readCachedToken();
    const file = (0, oauth_js_1.cachedTokenPath)();
    if (cached?.access_token) {
        await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${cached.access_token}`, { method: "POST" });
    }
    const hadFile = fs.existsSync(file);
    if (hadFile)
        fs.unlinkSync(file);
    if (!cached && !hadFile)
        return "No cached OAuth session; nothing to revoke.";
    return "Session revoked at Google (when a token existed) and removed locally.";
}
