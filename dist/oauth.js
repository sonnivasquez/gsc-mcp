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
exports.OAUTH_CALLBACK_TIMEOUT_MS = exports.OAUTH_CALLBACK_HOST = void 0;
exports.tokenDir = tokenDir;
exports.cachedTokenPath = cachedTokenPath;
exports.getScopeTier = getScopeTier;
exports.scopesForTier = scopesForTier;
exports.clearCachedToken = clearCachedToken;
exports.tokenPath = tokenPath;
exports.loadCachedToken = loadCachedToken;
exports.credentialsOnly = credentialsOnly;
exports.cachedTokenSuitable = cachedTokenSuitable;
exports.saveCachedToken = saveCachedToken;
exports.getOAuthConfig = getOAuthConfig;
exports.cachedTokenCoversScopes = cachedTokenCoversScopes;
exports.createLocalCallbackListener = createLocalCallbackListener;
exports.startLocalCallbackServer = startLocalCallbackServer;
exports.authenticateWithOAuth = authenticateWithOAuth;
exports.generateCodeVerifier = generateCodeVerifier;
exports.codeChallenge = codeChallenge;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const node_crypto_1 = require("node:crypto");
const embedded_client_js_1 = require("./embedded-client.js");
const oauth_callback_page_js_1 = require("./oauth-callback-page.js");
const access_js_1 = require("./access.js");
// Single source of truth for the OAuth token location. Honors GSC_DATA_DIR
// per call (and a changed HOME), so login/save/load/clear and every
// user-visible path stay on the same active scoped file. The default
// (GSC_DATA_DIR unset) remains ~/.gsc-mcp. No migration, copy, or
// deletion of any other location is ever performed here.
function tokenDir() {
    return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}
function cachedTokenPath() {
    return path.join(tokenDir(), "oauth-token.json");
}
/**
 * Readonly requests only webmasters.readonly, which keeps the
 * Google consent screen to a single read-only permission. Readonly is the
 * default; "full" (read + webmasters + Indexing API scopes) is an explicit
 * opt-in for the submit tools.
 */
function getScopeTier() {
    return (0, access_js_1.resolveAccessPolicy)().scopeTier;
}
function scopesForTier(tier) {
    if (tier === "readonly") {
        return ["https://www.googleapis.com/auth/webmasters.readonly"];
    }
    return [
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/webmasters",
        // Required for the submit tools (Indexing API).
        // Without this scope the token issued by the OAuth flow cannot call
        // indexing.urlNotifications.publish, and submissions fail with
        // "Insufficient Permission" even when the Indexing API is enabled.
        "https://www.googleapis.com/auth/indexing",
    ];
}
function clearCachedToken() {
    try {
        const active = cachedTokenPath();
        if (fs.existsSync(active))
            fs.unlinkSync(active);
    }
    catch {
        // best effort
    }
}
/**
 * Legacy alias kept for compatibility. Returns the active scoped token
 * path (identical to cachedTokenPath()).
 */
function tokenPath() {
    return cachedTokenPath();
}
// Concurrency guard: if an OAuth flow is already in progress, reuse its promise
let activeAuthPromise = null;
function ensureTokenDir() {
    const dir = tokenDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
        fs.chmodSync(dir, 0o700);
    }
    catch {
        // best effort: filesystems without POSIX modes keep the created dir
    }
}
function loadCachedToken() {
    try {
        const active = cachedTokenPath();
        if (fs.existsSync(active)) {
            const raw = fs.readFileSync(active, "utf8");
            return JSON.parse(raw);
        }
    }
    catch {
        // corrupted token file, will re-auth
    }
    return null;
}
function credentialsOnly(token) {
    const { gsc_client_id: _identity, ...credentials } = token;
    return credentials;
}
function cachedTokenSuitable(token, clientId) {
    return typeof token?.gsc_client_id === "string" && token.gsc_client_id.length > 0 &&
        token.gsc_client_id === clientId && cachedTokenCoversScopes(token);
}
function saveCachedToken(token) {
    ensureTokenDir();
    const active = cachedTokenPath();
    // Private by default: never log the token value itself.
    fs.writeFileSync(active, JSON.stringify(token, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
        fs.chmodSync(active, 0o600);
    }
    catch {
        // best effort on non-POSIX filesystems
    }
}
function getOAuthConfig() {
    // An explicitly selected file takes precedence over ambient client variables.
    // Option 1: secrets file
    const secretsFile = process.env.GSC_OAUTH_SECRETS_FILE;
    if (secretsFile) {
        const raw = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
        const creds = raw.installed;
        if (!creds || typeof creds.client_id !== "string" || !creds.client_id.trim() ||
            typeof creds.client_secret !== "string" || !creds.client_secret.trim()) {
            throw new Error("OAuth secrets file must contain a Desktop installed client.");
        }
        return { clientId: creds.client_id, clientSecret: creds.client_secret };
    }
    // Option 2: direct env vars
    const clientId = process.env.GSC_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET;
    if (clientId && clientSecret)
        return { clientId, clientSecret };
    // Option 3: the embedded public client (see embedded-client.ts)
    if ((0, embedded_client_js_1.embeddedClientAvailable)()) {
        return { clientId: embedded_client_js_1.EMBEDDED_CLIENT_ID, clientSecret: embedded_client_js_1.EMBEDDED_CLIENT_SECRET };
    }
    throw new Error("OAuth credentials not found. Run `gsc setup` for guided configuration, " +
        "or set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET, " +
        "or set GSC_OAUTH_SECRETS_FILE to a Google OAuth client secrets JSON file.");
}
/**
 * True when the cached token was granted every scope the current tier needs.
 * A token minted in read-only mode cannot call write APIs, so switching
 * GSC_SCOPES to "full" must trigger a fresh consent rather than a silent 403.
 */
function cachedTokenCoversScopes(cachedToken) {
    const tier = getScopeTier();
    const needed = scopesForTier(tier);
    const granted = typeof cachedToken?.scope === "string" ? cachedToken.scope.split(/\s+/).filter(Boolean) : [];
    if (granted.length === 0) {
        // Legacy tokens lack scope evidence. They may retain full-mode compatibility,
        // but cannot prove that a readonly session has no write grants.
        return tier === "full";
    }
    if (tier === "readonly" && granted.some((scope) => scope === "https://www.googleapis.com/auth/webmasters" || scope === "https://www.googleapis.com/auth/indexing")) {
        return false;
    }
    return needed.every((scope) => granted.includes(scope));
}
/**
 * Loopback host for the OAuth redirect. Matches the registered
 * `http://127.0.0.1:<port>` redirect URI so the browser lands on a
 * listener this process owns.
 */
exports.OAUTH_CALLBACK_HOST = "127.0.0.1";
exports.OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * Binds a one-shot local HTTP server to the loopback interface and waits
 * for the OAuth redirect. `ready` resolves with the bound port once the
 * listener accepts connections; `code` resolves with the authorization
 * code once the browser redirect arrives. Bind errors reject both promptly
 * so callers can fail before opening the browser. The timer and listener
 * are cleaned up on success, provider error, bind failure, or timeout.
 */
function createLocalCallbackListener(port, options) {
    const host = options?.host ?? exports.OAUTH_CALLBACK_HOST;
    const timeoutMs = options?.timeoutMs ?? exports.OAUTH_CALLBACK_TIMEOUT_MS;
    let settled = false;
    let timer;
    let readyResolve;
    let readyReject;
    let codeResolve;
    let codeReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    const code = new Promise((resolve, reject) => {
        codeResolve = resolve;
        codeReject = reject;
    });
    // Awaiting only one side must never surface as an unhandled rejection.
    ready.catch(() => { });
    code.catch(() => { });
    const clearTimer = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };
    const server = http.createServer((req, res) => {
        if (settled) {
            res.writeHead(400, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
            });
            res.end("OAuth flow already settled");
            return;
        }
        const url = new URL(req.url || "/", `http://${host}:${port}`);
        const receivedCode = url.searchParams.get("code");
        // Presence (not truthiness): a present-but-empty `?error=` is still a
        // provider failure and must not fall through to the code branch.
        const hasOAuthError = url.searchParams.has("error");
        const acceptLanguage = Array.isArray(req.headers["accept-language"])
            ? req.headers["accept-language"][0]
            : req.headers["accept-language"];
        if (hasOAuthError) {
            settled = true;
            clearTimer();
            const page = (0, oauth_callback_page_js_1.renderCallbackPage)("error", { acceptLanguage });
            res.writeHead(200, page.headers);
            res.end(page.html);
            // Stable authored rejection: the raw `error` query value is
            // untrusted external text, so it never enters the message (and
            // therefore never reaches HTML, logs, or CLI output that prints
            // the rejection). Match on `code`, never on message parsing.
            const err = new Error("OAuth authorization failed in the browser. Return to the terminal and try again.");
            err.code = "OAUTH_BROWSER_AUTHORIZATION_FAILED";
            readyReject(err);
            codeReject(err);
            server.close();
            return;
        }
        if (receivedCode) {
            settled = true;
            clearTimer();
            const page = (0, oauth_callback_page_js_1.renderCallbackPage)("success", { acceptLanguage });
            res.writeHead(200, page.headers);
            res.end(page.html);
            codeResolve(receivedCode);
            server.close();
            return;
        }
        res.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        });
        res.end("Missing code parameter");
    });
    server.on("error", (err) => {
        if (settled)
            return;
        settled = true;
        clearTimer();
        readyReject(err);
        codeReject(err);
        server.close();
    });
    timer = setTimeout(() => {
        if (settled)
            return;
        settled = true;
        const err = new Error("OAuth authentication timed out after 10 minutes");
        readyReject(err);
        codeReject(err);
        server.close();
    }, timeoutMs);
    if (typeof timer.unref === "function") {
        timer.unref();
    }
    server.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === "object" && address !== null ? address.port : port;
        readyResolve(actualPort);
    });
    return { ready, code };
}
/**
 * Starts a one-shot local HTTP server to capture the OAuth redirect.
 * Returns the authorization code.
 */
function startLocalCallbackServer(port, options) {
    return createLocalCallbackListener(port, options).code;
}
/**
 * Runs the full OAuth2 flow: open browser, catch redirect, exchange code, cache token.
 * Returns an authenticated OAuth2 client.
 */
async function authenticateWithOAuth() {
    const { clientId, clientSecret } = getOAuthConfig();
    const callbackPort = 3847;
    const redirectUri = `http://127.0.0.1:${callbackPort}`;
    const { google } = await import("googleapis");
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    // Check for cached token
    const cachedToken = loadCachedToken();
    if (cachedToken && !cachedTokenSuitable(cachedToken, clientId)) {
        console.error("Cached OAuth session is not suitable for this client and access tier; re-authenticating...");
        return await runBrowserAuth(oauth2Client, callbackPort, redirectUri, clientId);
    }
    if (cachedToken) {
        oauth2Client.setCredentials(credentialsOnly(cachedToken));
        // Check if token needs refresh
        if (cachedToken.expiry_date && cachedToken.expiry_date < Date.now()) {
            try {
                const { credentials } = await oauth2Client.refreshAccessToken();
                const merged = { ...cachedToken, ...credentials, gsc_client_id: clientId };
                oauth2Client.setCredentials(credentialsOnly(merged));
                saveCachedToken(merged);
                console.error("OAuth token refreshed successfully");
            }
            catch {
                console.error("Token refresh failed, re-authenticating...");
                return await runBrowserAuth(oauth2Client, callbackPort, redirectUri, clientId);
            }
        }
        else {
            console.error("Using cached OAuth token");
        }
        return oauth2Client;
    }
    return await runBrowserAuth(oauth2Client, callbackPort, redirectUri, clientId);
}
/**
 * PKCE S256 pair for the Desktop flow (RFC 7636). Pure and unit-tested;
 * the verifier stays in memory and is sent only to Google's token endpoint.
 */
function generateCodeVerifier() {
    return (0, node_crypto_1.randomBytes)(64).toString("base64url");
}
function codeChallenge(verifier) {
    return (0, node_crypto_1.createHash)("sha256").update(verifier, "ascii").digest("base64url");
}
async function runBrowserAuth(oauth2Client, callbackPort, redirectUri, clientId) {
    // If an auth flow is already running, wait for it instead of starting a second server
    if (activeAuthPromise) {
        console.error("OAuth flow already in progress, waiting for it to complete...");
        return activeAuthPromise;
    }
    activeAuthPromise = (async () => {
        try {
            const codeVerifier = generateCodeVerifier();
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: "offline",
                scope: scopesForTier(getScopeTier()),
                prompt: "consent",
                code_challenge_method: "S256",
                code_challenge: codeChallenge(codeVerifier),
            });
            // Bind the loopback listener before opening the browser so the
            // redirect target exists. A bind failure rejects here promptly.
            const listener = createLocalCallbackListener(callbackPort);
            await listener.ready;
            // Open browser
            console.error(`\nOpening browser for Google authentication...\nIf the browser doesn't open, visit this URL:\n${authUrl}\n`);
            try {
                const open = (await import("open")).default;
                await open(authUrl);
            }
            catch {
                console.error("Could not open browser automatically. Please visit the URL above.");
            }
            // Wait for the code
            const code = await listener.code;
            // Exchange code for tokens, proving the PKCE challenge
            const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
            oauth2Client.setCredentials(tokens);
            saveCachedToken({ ...tokens, gsc_client_id: clientId });
            console.error("OAuth authentication successful, token cached");
            return oauth2Client;
        }
        finally {
            activeAuthPromise = null;
        }
    })();
    return activeAuthPromise;
}
