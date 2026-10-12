import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import { createHash, randomBytes } from "node:crypto";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET, embeddedClientAvailable } from "./embedded-client.js";
import { renderCallbackPage } from "./oauth-callback-page.js";
import { resolveAccessPolicy } from "./access.js";

// Single source of truth for the OAuth token location. Honors GSC_DATA_DIR
// per call (and a changed HOME), so login/save/load/clear and every
// user-visible path stay on the same active scoped file. The default
// (GSC_DATA_DIR unset) remains ~/.gsc-mcp. No migration, copy, or
// deletion of any other location is ever performed here.
export function tokenDir(): string {
  return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}

export function cachedTokenPath(): string {
  return path.join(tokenDir(), "oauth-token.json");
}

export type ScopeTier = "readonly" | "full";

/**
 * Readonly requests only webmasters.readonly, which keeps the
 * Google consent screen to a single read-only permission. Readonly is the
 * default; "full" (read + webmasters + Indexing API scopes) is an explicit
 * opt-in for the submit tools.
 */
export function getScopeTier(): ScopeTier {
  return resolveAccessPolicy().scopeTier;
}

export function scopesForTier(tier: ScopeTier): string[] {
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

export function clearCachedToken(): void {
  try {
    const active = cachedTokenPath();
    if (fs.existsSync(active)) fs.unlinkSync(active);
  } catch {
    // best effort
  }
}

/**
 * Legacy alias kept for compatibility. Returns the active scoped token
 * path (identical to cachedTokenPath()).
 */
export function tokenPath(): string {
  return cachedTokenPath();
}

// Concurrency guard: if an OAuth flow is already in progress, reuse its promise
let activeAuthPromise: Promise<any> | null = null;

function ensureTokenDir(): void {
  const dir = tokenDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort: filesystems without POSIX modes keep the created dir
  }
}

export function loadCachedToken(): any | null {
  try {
    const active = cachedTokenPath();
    if (fs.existsSync(active)) {
      const raw = fs.readFileSync(active, "utf8");
      return JSON.parse(raw);
    }
  } catch {
    // corrupted token file, will re-auth
  }
  return null;
}

export function credentialsOnly(token: any): any {
  const { gsc_client_id: _identity, ...credentials } = token;
  return credentials;
}

export function cachedTokenSuitable(token: any, clientId: string): boolean {
  return typeof token?.gsc_client_id === "string" && token.gsc_client_id.length > 0 &&
    token.gsc_client_id === clientId && cachedTokenCoversScopes(token);
}

export function saveCachedToken(token: any): void {
  ensureTokenDir();
  const active = cachedTokenPath();
  // Private by default: never log the token value itself.
  fs.writeFileSync(active, JSON.stringify(token, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(active, 0o600);
  } catch {
    // best effort on non-POSIX filesystems
  }
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function getOAuthConfig(): OAuthConfig {
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
  if (clientId && clientSecret) return { clientId, clientSecret };

  // Option 3: the embedded public client (see embedded-client.ts)
  if (embeddedClientAvailable()) {
    return { clientId: EMBEDDED_CLIENT_ID, clientSecret: EMBEDDED_CLIENT_SECRET };
  }

  throw new Error(
    "OAuth credentials not found. Run `gsc setup` for guided configuration, " +
    "or set GSC_OAUTH_CLIENT_ID and GSC_OAUTH_CLIENT_SECRET, " +
    "or set GSC_OAUTH_SECRETS_FILE to a Google OAuth client secrets JSON file."
  );
}

/**
 * True when the cached token was granted every scope the current tier needs.
 * A token minted in read-only mode cannot call write APIs, so switching
 * GSC_SCOPES to "full" must trigger a fresh consent rather than a silent 403.
 */
export function cachedTokenCoversScopes(cachedToken: any): boolean {
  const tier = getScopeTier();
  const needed = scopesForTier(tier);
  const granted: string[] = typeof cachedToken?.scope === "string" ? cachedToken.scope.split(/\s+/).filter(Boolean) : [];
  if (granted.length === 0) {
    // Legacy tokens lack scope evidence. They may retain full-mode compatibility,
    // but cannot prove that a readonly session has no write grants.
    return tier === "full";
  }
  if (tier === "readonly" && granted.some((scope) =>
    scope === "https://www.googleapis.com/auth/webmasters" || scope === "https://www.googleapis.com/auth/indexing")) {
    return false;
  }
  return needed.every((scope) => granted.includes(scope));
}

/**
 * Loopback host for the OAuth redirect. Matches the registered
 * `http://127.0.0.1:<port>` redirect URI so the browser lands on a
 * listener this process owns.
 */
export const OAUTH_CALLBACK_HOST = "127.0.0.1";
export const OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

export interface LocalCallbackOptions {
  host?: string;
  timeoutMs?: number;
}

/**
 * Binds a one-shot local HTTP server to the loopback interface and waits
 * for the OAuth redirect. `ready` resolves with the bound port once the
 * listener accepts connections; `code` resolves with the authorization
 * code once the browser redirect arrives. Bind errors reject both promptly
 * so callers can fail before opening the browser. The timer and listener
 * are cleaned up on success, provider error, bind failure, or timeout.
 */
export function createLocalCallbackListener(
  port: number,
  options?: LocalCallbackOptions
): { ready: Promise<number>; code: Promise<string> } {
  const host = options?.host ?? OAUTH_CALLBACK_HOST;
  const timeoutMs = options?.timeoutMs ?? OAUTH_CALLBACK_TIMEOUT_MS;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let readyResolve!: (actualPort: number) => void;
  let readyReject!: (err: Error) => void;
  let codeResolve!: (code: string) => void;
  let codeReject!: (err: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const code = new Promise<string>((resolve, reject) => {
    codeResolve = resolve;
    codeReject = reject;
  });
  // Awaiting only one side must never surface as an unhandled rejection.
  ready.catch(() => {});
  code.catch(() => {});

  const clearTimer = (): void => {
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
      const page = renderCallbackPage("error", { acceptLanguage });
      res.writeHead(200, page.headers);
      res.end(page.html);
      // Stable authored rejection: the raw `error` query value is
      // untrusted external text, so it never enters the message (and
      // therefore never reaches HTML, logs, or CLI output that prints
      // the rejection). Match on `code`, never on message parsing.
      const err = new Error(
        "OAuth authorization failed in the browser. Return to the terminal and try again."
      ) as Error & { code: string };
      err.code = "OAUTH_BROWSER_AUTHORIZATION_FAILED";
      readyReject(err);
      codeReject(err);
      server.close();
      return;
    }

    if (receivedCode) {
      settled = true;
      clearTimer();
      const page = renderCallbackPage("success", { acceptLanguage });
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

  server.on("error", (err: Error) => {
    if (settled) return;
    settled = true;
    clearTimer();
    readyReject(err);
    codeReject(err);
    server.close();
  });

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    const err = new Error("OAuth authentication timed out after 10 minutes");
    readyReject(err);
    codeReject(err);
    server.close();
  }, timeoutMs);
  if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
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
export function startLocalCallbackServer(port: number, options?: LocalCallbackOptions): Promise<string> {
  return createLocalCallbackListener(port, options).code;
}

/**
 * Runs the full OAuth2 flow: open browser, catch redirect, exchange code, cache token.
 * Returns an authenticated OAuth2 client.
 */
export async function authenticateWithOAuth(): Promise<any> {
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
      } catch {
        console.error("Token refresh failed, re-authenticating...");
        return await runBrowserAuth(oauth2Client, callbackPort, redirectUri, clientId);
      }
    } else {
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
export function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function runBrowserAuth(
  oauth2Client: any,
  callbackPort: number,
  redirectUri: string,
  clientId: string
): Promise<any> {
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
      } catch {
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
    } finally {
      activeAuthPromise = null;
    }
  })();

  return activeAuthPromise;
}
