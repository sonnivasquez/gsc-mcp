import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import { createHash, randomBytes } from "node:crypto";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET, embeddedClientAvailable } from "./embedded-client.js";
import { renderCallbackPage } from "./oauth-callback-page.js";
import { resolveAccessPolicy } from "./access.js";

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const TOKEN_FILE = "oauth-token.json";
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
const LOOPBACK_PORT = 3847;

export function tokenDir(): string {
  return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}

export function cachedTokenPath(): string {
  return path.join(tokenDir(), TOKEN_FILE);
}

export type ScopeTier = "readonly" | "full";

const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";

export function getScopeTier(): ScopeTier {
  return resolveAccessPolicy().scopeTier;
}

export function scopesForTier(tier: ScopeTier): string[] {
  switch (tier) {
    case "readonly":
      return [READONLY_SCOPE];
    case "full":
      return [READONLY_SCOPE, WEBMASTERS_SCOPE, INDEXING_SCOPE];
    default: {
      const unexpected: never = tier;
      return unexpected;
    }
  }
}

export function clearCachedToken(): void {
  try {
    const active = cachedTokenPath();
    if (fs.existsSync(active)) fs.unlinkSync(active);
  } catch {
    // Removing a missing or locked file is not fatal.
  }
}

export function tokenPath(): string {
  return cachedTokenPath();
}

let activeAuthPromise: Promise<any> | null = null;

function prepareTokenDir(): void {
  const dir = tokenDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
  try {
    fs.chmodSync(dir, PRIVATE_DIR);
  } catch {
    // Some filesystems ignore POSIX modes.
  }
}

export function loadCachedToken(): any | null {
  try {
    const active = cachedTokenPath();
    if (!fs.existsSync(active)) return null;
    return JSON.parse(fs.readFileSync(active, "utf8"));
  } catch {
    return null;
  }
}

export function credentialsOnly(token: any): any {
  const copy = { ...token };
  delete copy.gsc_client_id;
  return copy;
}

export function cachedTokenCoversScopes(cachedToken: any): boolean {
  const tier = getScopeTier();
  const needed = scopesForTier(tier);
  const rawScope = typeof cachedToken?.scope === "string" ? cachedToken.scope : "";
  const granted = rawScope.split(/\s+/).filter(Boolean);
  if (granted.length === 0) return tier === "full";
  if (tier === "readonly" && granted.some((scope: string) => scope === WEBMASTERS_SCOPE || scope === INDEXING_SCOPE)) {
    return false;
  }
  return needed.every((scope) => granted.includes(scope));
}

export function cachedTokenSuitable(token: any, clientId: string): boolean {
  const stored = token?.gsc_client_id;
  const matchesClient = typeof stored === "string" && stored.length > 0 && stored === clientId;
  return matchesClient && cachedTokenCoversScopes(token);
}

export function saveCachedToken(token: any): void {
  prepareTokenDir();
  const active = cachedTokenPath();
  fs.writeFileSync(active, JSON.stringify(token, null, 2), { encoding: "utf8", mode: PRIVATE_FILE });
  try {
    fs.chmodSync(active, PRIVATE_FILE);
  } catch {
    // Some filesystems ignore POSIX modes.
  }
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

function readInstalledClient(secretsFile: string): OAuthConfig {
  const raw = JSON.parse(fs.readFileSync(secretsFile, "utf8")) as { installed?: { client_id?: unknown; client_secret?: unknown } };
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

function configuredValue(name: string): string | undefined {
  return process.env[name];
}

export function getOAuthConfig(): OAuthConfig {
  const secretsFile = configuredValue("GSC_OAUTH_SECRETS_FILE");
  if (secretsFile) return readInstalledClient(secretsFile);

  const clientId = configuredValue("GSC_OAUTH_CLIENT_ID");
  const clientSecret = configuredValue("GSC_OAUTH_CLIENT_SECRET");
  if (clientId && clientSecret) return { clientId, clientSecret };

  if (embeddedClientAvailable()) {
    return {
      clientId: EMBEDDED_CLIENT_ID,
      clientSecret: EMBEDDED_CLIENT_SECRET,
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

export const OAUTH_CALLBACK_HOST = "127.0.0.1";
export const OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

export interface LocalCallbackOptions {
  host?: string;
  timeoutMs?: number;
}

function plainHeaders(): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  headers["Content-Type"] = "text/plain; charset=utf-8";
  headers["Cache-Control"] = "no-store";
  headers["Referrer-Policy"] = "no-referrer";
  headers["X-Content-Type-Options"] = "nosniff";
  return headers;
}

function browserFailure(): Error & { code: string } {
  const err = new Error(phrase([
    "OAuth authorization failed in the browser. ",
    "Return to the terminal and try again.",
  ])) as Error & { code: string };
  err.code = "OAUTH_BROWSER_AUTHORIZATION_FAILED";
  return err;
}

function languageHeader(req: http.IncomingMessage): string | undefined {
  const header = req.headers["accept-language"];
  return Array.isArray(header) ? header[0] : header;
}

export function createLocalCallbackListener(
  port: number,
  options?: LocalCallbackOptions,
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
  ready.catch(() => {});
  code.catch(() => {});

  const stopTimer = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const failBoth = (err: Error): void => {
    if (settled) return;
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
      const page = renderCallbackPage("error", { acceptLanguage: languageHeader(req) });
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
      const page = renderCallbackPage("success", { acceptLanguage: languageHeader(req) });
      res.writeHead(200, page.headers);
      res.end(page.html);
      codeResolve(receivedCode);
      server.close();
      return;
    }
    res.writeHead(400, plainHeaders());
    res.end("Missing code parameter");
  });

  server.on("error", (err: Error) => failBoth(err));

  timer = setTimeout(() => {
    failBoth(new Error("OAuth authentication timed out after 10 minutes"));
  }, timeoutMs);
  const unref = (timer as { unref?: () => void }).unref;
  if (typeof unref === "function") unref.call(timer);

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : port;
    readyResolve(actualPort);
  });

  return { ready, code };
}

export function startLocalCallbackServer(port: number, options?: LocalCallbackOptions): Promise<string> {
  return createLocalCallbackListener(port, options).code;
}

async function googleAuthLibrary() {
  // Deferred on purpose: importing the SDK at module load breaks credential-free startup.
  return import("googleapis");
}

export function generateCodeVerifier(): string {
  const bytes = randomBytes(64);
  return bytes.toString("base64url");
}

export function codeChallenge(verifier: string): string {
  const digest = createHash("sha256").update(verifier, "ascii");
  return digest.digest("base64url");
}

async function openBrowser(authUrl: string): Promise<void> {
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
  } catch {
    console.error(phrase([
      "Could not open browser automatically. ",
      "Please visit the URL above.",
    ]));
  }
}

async function runBrowserAuth(client: any, redirectUri: string, clientId: string): Promise<any> {
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
    } finally {
      activeAuthPromise = null;
    }
  })();

  return activeAuthPromise;
}

async function reuseCached(client: any, cached: any, clientId: string): Promise<any> {
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
  } catch {
    console.error(phrase([
      "Token refresh failed, ",
      "re-authenticating...",
    ]));
    return runBrowserAuth(client, `http://127.0.0.1:${LOOPBACK_PORT}`, clientId);
  }
}

export async function authenticateWithOAuth(): Promise<any> {
  const { clientId, clientSecret } = getOAuthConfig();
  const redirectUri = `http://127.0.0.1:${LOOPBACK_PORT}`;
  const { google } = await googleAuthLibrary();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const cached = loadCachedToken();
  if (!cached) return runBrowserAuth(client, redirectUri, clientId);
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
