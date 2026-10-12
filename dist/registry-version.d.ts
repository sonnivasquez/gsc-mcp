/** Public packument URL whose `dist-tags.latest` is the newest release. */
export declare const REGISTRY_URL = "https://registry.npmjs.org/@sonnivasquez/gsc-mcp";
/** Single bounded GET, same budget as the update-feed fetch. */
export declare const REGISTRY_TIMEOUT_MS = 10000;
/** Fixed reason classes for an unknown registry answer; raw text never escapes. */
export type RegistryUnknownReason = "timeout" | "network_error" | "unexpected-response";
export type RegistryLatestResult = {
    ok: true;
    latest: string;
} | {
    ok: false;
    reason: RegistryUnknownReason;
};
/** Strict numeric semver core, or null when the string is not a version. */
export declare function parseSemver(version: string): [number, number, number] | null;
/** Numeric semver comparison, or null when either side is unparseable. */
export declare function compareSemver(a: string, b: string): -1 | 0 | 1 | null;
/** Stable safe classification for a registry transport failure. */
export declare function classifyRegistryError(err: unknown): "timeout" | "network_error";
/**
 * Exactly one GET for dist-tags.latest through the injected fetch seam
 * (AbortController timeout, fetch-guard pattern). A 200 with unparseable
 * JSON or a missing/empty/non-semver dist-tags.latest reports
 * `unexpected-response`; non-2xx answers report `network_error`.
 */
export declare function fetchRegistryLatest(fetchImpl: typeof fetch, timeoutMs?: number): Promise<RegistryLatestResult>;
