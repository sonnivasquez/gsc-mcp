export declare function tokenDir(): string;
export declare function cachedTokenPath(): string;
export type ScopeTier = "readonly" | "full";
/**
 * Readonly requests only webmasters.readonly, which keeps the
 * Google consent screen to a single read-only permission. Readonly is the
 * default; "full" (read + webmasters + Indexing API scopes) is an explicit
 * opt-in for the submit tools.
 */
export declare function getScopeTier(): ScopeTier;
export declare function scopesForTier(tier: ScopeTier): string[];
export declare function clearCachedToken(): void;
/**
 * Legacy alias kept for compatibility. Returns the active scoped token
 * path (identical to cachedTokenPath()).
 */
export declare function tokenPath(): string;
export declare function loadCachedToken(): any | null;
export declare function credentialsOnly(token: any): any;
export declare function cachedTokenSuitable(token: any, clientId: string): boolean;
export declare function saveCachedToken(token: any): void;
interface OAuthConfig {
    clientId: string;
    clientSecret: string;
}
export declare function getOAuthConfig(): OAuthConfig;
/**
 * True when the cached token was granted every scope the current tier needs.
 * A token minted in read-only mode cannot call write APIs, so switching
 * GSC_SCOPES to "full" must trigger a fresh consent rather than a silent 403.
 */
export declare function cachedTokenCoversScopes(cachedToken: any): boolean;
/**
 * Loopback host for the OAuth redirect. Matches the registered
 * `http://127.0.0.1:<port>` redirect URI so the browser lands on a
 * listener this process owns.
 */
export declare const OAUTH_CALLBACK_HOST = "127.0.0.1";
export declare const OAUTH_CALLBACK_TIMEOUT_MS: number;
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
export declare function createLocalCallbackListener(port: number, options?: LocalCallbackOptions): {
    ready: Promise<number>;
    code: Promise<string>;
};
/**
 * Starts a one-shot local HTTP server to capture the OAuth redirect.
 * Returns the authorization code.
 */
export declare function startLocalCallbackServer(port: number, options?: LocalCallbackOptions): Promise<string>;
/**
 * Runs the full OAuth2 flow: open browser, catch redirect, exchange code, cache token.
 * Returns an authenticated OAuth2 client.
 */
export declare function authenticateWithOAuth(): Promise<any>;
/**
 * PKCE S256 pair for the Desktop flow (RFC 7636). Pure and unit-tested;
 * the verifier stays in memory and is sent only to Google's token endpoint.
 */
export declare function generateCodeVerifier(): string;
export declare function codeChallenge(verifier: string): string;
export {};
