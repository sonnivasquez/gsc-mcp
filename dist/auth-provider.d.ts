export interface AuthDescription {
    mode: "service_account" | "oauth";
    scopeTier: "readonly" | "full";
}
export interface AuthProvider {
    describe(): AuthDescription;
    getAccessToken(): Promise<string>;
}
export declare class OAuthTokenProvider implements AuthProvider {
    private refreshInFlight;
    describe(): AuthDescription;
    getAccessToken(): Promise<string>;
}
export declare class ServiceAccountProvider implements AuthProvider {
    describe(): AuthDescription;
    getAccessToken(): Promise<string>;
}
export declare function getAuthProvider(): AuthProvider;
export interface AuthStatus {
    mode: "service_account" | "oauth";
    scopeTier: "readonly" | "full";
    session: "none" | "cached" | "key_file";
    detail: string;
}
export declare function authStatusOffline(): AuthStatus;
export declare const SITES_LIST_URL = "https://www.googleapis.com/webmasters/v3/sites";
export interface SitesListEntry {
    siteUrl: string;
    permissionLevel: string;
}
export interface SitesListSnapshot {
    status: number;
    /** Raw siteEntry array length, exactly as Google returned it. */
    sites: number;
    /** Entries with a usable string siteUrl (subset used for verification). */
    entries: SitesListEntry[];
}
/** Stable classification for an unparseable or wrong-shaped 2xx body. */
export declare const SITES_LIST_SHAPE_ERROR = "UPSTREAM_SCHEMA_CHANGED: sites.list response shape changed (expected an object with a siteEntry array)";
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
export declare function parseSitesListBody(body: unknown): {
    sites: number;
    entries: SitesListEntry[];
};
export declare function fetchSitesList(provider: AuthProvider, fetchImpl?: typeof fetch): Promise<SitesListSnapshot>;
export declare function authStatusOnline(fetchImpl?: typeof fetch, provider?: AuthProvider): Promise<AuthStatus & {
    sites?: number;
}>;
export declare function authLogin(): Promise<string>;
export declare function authLogout(): string;
export declare function authRevoke(confirmed: boolean, fetchImpl?: typeof fetch): Promise<string>;
