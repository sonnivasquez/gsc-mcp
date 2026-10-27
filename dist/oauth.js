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
exports.cachedTokenCoversScopes = cachedTokenCoversScopes;
exports.cachedTokenSuitable = cachedTokenSuitable;
exports.saveCachedToken = saveCachedToken;
exports.getOAuthConfig = getOAuthConfig;
exports.createLocalCallbackListener = createLocalCallbackListener;
exports.startLocalCallbackServer = startLocalCallbackServer;
exports.generateCodeVerifier = generateCodeVerifier;
exports.codeChallenge = codeChallenge;
exports.authenticateWithOAuth = authenticateWithOAuth;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const node_crypto_1 = require("node:crypto");
const embedded_client_js_1 = require("./embedded-client.js");
const oauth_callback_page_js_1 = require("./oauth-callback-page.js");
const access_js_1 = require("./access.js");
function phrase(parts) {
    return parts.join("");
}
const TOKEN_FILE = "oauth-token.json";
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
const LOOPBACK_PORT = 3847;
function tokenDir() {
    return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}
function cachedTokenPath() {
    return path.join(tokenDir(), TOKEN_FILE);
}
const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
function getScopeTier() {
    return (0, access_js_1.resolveAccessPolicy)().scopeTier;
}
function scopesForTier(tier) {
    switch (tier) {
        case "readonly":
            return [READONLY_SCOPE];
        case "full":
            return [READONLY_SCOPE, WEBMASTERS_SCOPE, INDEXING_SCOPE];
        default: {
            const unexpected = tier;
            return unexpected;
        }
    }
}
function clearCachedToken() {
    try {
        const active = cachedTokenPath();
        if (fs.existsSync(active))
            fs.unlinkSync(active);
    }
    catch {
        // Removing a missing or locked file is not fatal.
    }
}
function tokenPath() {
    return cachedTokenPath();
}
let activeAuthPromise = null;
function prepareTokenDir() {
    const dir = tokenDir();
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
    try {
        fs.chmodSync(dir, PRIVATE_DIR);
    }
    catch {
        // Some filesystems ignore POSIX modes.
    }
}
function loadCachedToken() {
    try {
        const active = cachedTokenPath();
        if (!fs.existsSync(active))
            return null;
        return JSON.parse(fs.readFileSync(active, "utf8"));
    }
    catch {
        return null;
    }
}
function credentialsOnly(token) {
    const copy = { ...token };
    delete copy.gsc_client_id;
    return copy;
}
function cachedTokenCoversScopes(cachedToken) {
    const tier = getScopeTier();
    const needed = scopesForTier(tier);
    const rawScope = typeof cachedToken?.scope === "string" ? cachedToken.scope : "";
    const granted = rawScope.split(/\s+/).filter(Boolean);
    if (granted.length === 0)
        return tier === "full";
    if (tier === "readonly" && granted.some((scope) => scope === WEBMASTERS_SCOPE || scope === INDEXING_SCOPE)) {
        return false;
    }
    return needed.every((scope) => granted.includes(scope));
}
function cachedTokenSuitable(token, clientId) {
    const stored = token?.gsc_client_id;
    const matchesClient = typeof stored === "string" && stored.length > 0 && stored === clientId;
    return matchesClient && cachedTokenCoversScopes(token);
}
function saveCachedToken(token) {
    prepareTokenDir();
    const active = cachedTokenPath();
    fs.writeFileSync(active, JSON.stringify(token, null, 2), { encoding: "utf8", mode: PRIVATE_FILE });
    try {
        fs.chmodSync(active, PRIVATE_FILE);
    }
    catch {
        // Some filesystems ignore POSIX modes.
    }
}
function readInstalledClient(secretsFile) {
    const raw = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    const installed = raw.installed;
    const clientId = installed?.client_id;
    const clientSecret = installed?.client_secret;
    const idOk = typeof clientId === "string" && clientId.trim().length > 0;
    const secretOk = typeof clientSecret === "string" && clientSecret.trim().length > 0;
    if (!idOk || !secretOk) {
        throw new Error("OAuth secrets file must contain a Desktop installed client.");
    }
    return { clientId, clientSecret };
}
function configuredValue(name) {
    return process.env[name];
}
function getOAuthConfig() {
    const secretsFile = configuredValue("GSC_OAUTH_SECRETS_FILE");
    if (secretsFile)
        return readInstalledClient(secretsFile);
    const clientId = configuredValue("GSC_OAUTH_CLIENT_ID");
    const clientSecret = configuredValue("GSC_OAUTH_CLIENT_SECRET");
    if (clientId && clientSecret)
        return { clientId, clientSecret };
    if ((0, embedded_client_js_1.embeddedClientAvailable)()) {
        return {
            clientId: embedded_client_js_1.EMBEDDED_CLIENT_ID,
            clientSecret: embedded_client_js_1.EMBEDDED_CLIENT_SECRET,
        };
    }
    throw new Error(phrase([
        "OAuth credentials not found. Run `gsc setup` ",
        "for guided configuration, or set ",
        "GSC_OAUTH_CLIENT_ID and ",
        "GSC_OAUTH_CLIENT_SECRET, or set ",
        "GSC_OAUTH_SECRETS_FILE to a Google OAuth ",
        "client secrets JSON file.",
    ]));
}
exports.OAUTH_CALLBACK_HOST = "127.0.0.1";
exports.OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;
function plainHeaders() {
    const headers = {};
    headers["Content-Type"] = "text/plain; charset=utf-8";
    headers["Cache-Control"] = "no-store";
    headers["Referrer-Policy"] = "no-referrer";
    headers["X-Content-Type-Options"] = "nosniff";
    return headers;
}
function browserFailure() {
    const err = new Error(phrase([
        "OAuth authorization failed in the browser. ",
        "Return to the terminal and try again.",
    ]));
    err.code = "OAUTH_BROWSER_AUTHORIZATION_FAILED";
    return err;
}
function languageHeader(req) {
    const header = req.headers["accept-language"];
    return Array.isArray(header) ? header[0] : header;
}
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
    ready.catch(() => { });
    code.catch(() => { });
    const stopTimer = () => {
        if (timer === undefined)
            return;
        clearTimeout(timer);
        timer = undefined;
    };
    const failBoth = (err) => {
        if (settled)
            return;
        settled = true;
        stopTimer();
        readyReject(err);
        codeReject(err);
        server.close();
    };
    const server = http.createServer((req, res) => {
        if (settled) {
            res.writeHead(400, plainHeaders());
            res.end("OAuth flow already settled");
            return;
        }
        const origin = "http://" + host + ":" + String(port);
        const requestPath = req.url || "/";
        const url = new URL(requestPath, origin);
        if (url.searchParams.has("error")) {
            settled = true;
            stopTimer();
            const page = (0, oauth_callback_page_js_1.renderCallbackPage)("error", { acceptLanguage: languageHeader(req) });
            res.writeHead(200, page.headers);
            res.end(page.html);
            const err = browserFailure();
            readyReject(err);
            codeReject(err);
            server.close();
            return;
        }
        const receivedCode = url.searchParams.get("code");
        if (receivedCode) {
            settled = true;
            stopTimer();
            const page = (0, oauth_callback_page_js_1.renderCallbackPage)("success", { acceptLanguage: languageHeader(req) });
            res.writeHead(200, page.headers);
            res.end(page.html);
            codeResolve(receivedCode);
            server.close();
            return;
        }
        res.writeHead(400, plainHeaders());
        res.end("Missing code parameter");
    });
    server.on("error", (err) => failBoth(err));
    timer = setTimeout(() => {
        failBoth(new Error("OAuth authentication timed out after 10 minutes"));
    }, timeoutMs);
    const unref = timer.unref;
    if (typeof unref === "function")
        unref.call(timer);
    server.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === "object" && address !== null ? address.port : port;
        readyResolve(actualPort);
    });
    return { ready, code };
}
function startLocalCallbackServer(port, options) {
    return createLocalCallbackListener(port, options).code;
}
async function googleAuthLibrary() {
    // Deferred on purpose: importing the SDK at module load breaks credential-free startup.
    return import("googleapis");
}
function generateCodeVerifier() {
    const bytes = (0, node_crypto_1.randomBytes)(64);
    return bytes.toString("base64url");
}
function codeChallenge(verifier) {
    const digest = (0, node_crypto_1.createHash)("sha256").update(verifier, "ascii");
    return digest.digest("base64url");
}
async function openBrowser(authUrl) {
    console.error(phrase([
        "\nOpening browser for Google ",
        "authentication...\nIf the browser ",
        "doesn't open, visit this URL:\n",
        authUrl,
        "\n",
    ]));
    try {
        const opener = await import("open");
        await opener.default(authUrl);
    }
    catch {
        console.error(phrase([
            "Could not open browser automatically. ",
            "Please visit the URL above.",
        ]));
    }
}
async function runBrowserAuth(client, redirectUri, clientId) {
    if (activeAuthPromise) {
        console.error(phrase([
            "OAuth flow already in progress, ",
            "waiting for it to complete...",
        ]));
        return activeAuthPromise;
    }
    activeAuthPromise = (async () => {
        try {
            const codeVerifier = generateCodeVerifier();
            const authUrl = client.generateAuthUrl({
                access_type: "offline",
                scope: scopesForTier(getScopeTier()),
                prompt: "consent",
                code_challenge_method: "S256",
                code_challenge: codeChallenge(codeVerifier),
            });
            const listener = createLocalCallbackListener(LOOPBACK_PORT);
            await listener.ready;
            await openBrowser(authUrl);
            const code = await listener.code;
            const { tokens } = await client.getToken({ code, codeVerifier });
            client.setCredentials(tokens);
            saveCachedToken({ ...tokens, gsc_client_id: clientId });
            console.error(phrase([
                "OAuth authentication successful, ",
                "token cached",
            ]));
            return client;
        }
        finally {
            activeAuthPromise = null;
        }
    })();
    return activeAuthPromise;
}
async function reuseCached(client, cached, clientId) {
    client.setCredentials(credentialsOnly(cached));
    const expiry = cached.expiry_date;
    const expired = Boolean(expiry) && Number(expiry) < Date.now();
    if (!expired) {
        console.error(phrase(["Using cached ", "OAuth token"]));
        return client;
    }
    try {
        const { credentials } = await client.refreshAccessToken();
        const merged = { ...cached, ...credentials, gsc_client_id: clientId };
        client.setCredentials(credentialsOnly(merged));
        saveCachedToken(merged);
        console.error(phrase(["OAuth token refreshed ", "successfully"]));
        return client;
    }
    catch {
        console.error(phrase([
            "Token refresh failed, ",
            "re-authenticating...",
        ]));
        return runBrowserAuth(client, `http://127.0.0.1:${LOOPBACK_PORT}`, clientId);
    }
}
async function authenticateWithOAuth() {
    const { clientId, clientSecret } = getOAuthConfig();
    const redirectUri = `http://127.0.0.1:${LOOPBACK_PORT}`;
    const { google } = await googleAuthLibrary();
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const cached = loadCachedToken();
    if (!cached)
        return runBrowserAuth(client, redirectUri, clientId);
    if (!cachedTokenSuitable(cached, clientId)) {
        console.error(phrase([
            "Cached OAuth session is not suitable ",
            "for this client and access tier; ",
            "re-authenticating...",
        ]));
        return runBrowserAuth(client, redirectUri, clientId);
    }
    return reuseCached(client, cached, clientId);
}
