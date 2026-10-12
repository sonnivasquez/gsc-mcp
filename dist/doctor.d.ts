import type { AuthProvider } from "./auth-provider.js";
import { CLI_VERSION } from "./version.js";
/** Re-exported single source of truth; canonical definition lives in version.ts. */
export { CLI_VERSION };
export declare const DOCTOR_USAGE: string;
interface DoctorCheck {
    id: string;
    ok: boolean;
    detail: string;
}
/**
 * Stable sanitized allowlist diagnostic. The parser's raw error echoes the
 * offending property value, so doctor reports only this fixed sentence in
 * both offline and online JSON.
 */
export declare const ALLOWLIST_ERROR_DETAIL = "invalid GSC_SITE_URLS (allowlist_error): expected a JSON string array or legacy comma-separated list of sc-domain:... / http(s):// identifiers, or \"all\" alone for every current + future property; re-run setup to reconfigure";
/** Explicit allow-all display: never enumerates properties. */
export declare const ALLOW_ALL_DISPLAY = "all (explicit opt-in)";
export declare function runDoctor(): {
    ok: number;
    failed: number;
    checks: DoctorCheck[];
};
export interface DoctorOnlineDeps {
    provider?: AuthProvider;
    fetchImpl?: typeof fetch;
    /** Canonical gsc_* tool count supplied by the caller (no tools import here). */
    toolCount?: number;
    /** Registry GET seam; reuses fetchImpl unless overridden (tests). */
    versionFetchImpl?: typeof fetch;
    /** Registry cache dir override (tests); defaults to dataDir(). */
    cacheDir?: string;
    /** Clock override (tests); defaults to Date.now. */
    now?: () => number;
}
/**
 * Registry version cache: a best-effort 1-hour file under dataDir(),
 * mirroring the update-feed cache. Fresh entries skip the registry GET on
 * repeated doctor runs; stale or missing entries are bypassed, never
 * trusted. A failed write never fails the check.
 */
export declare const REGISTRY_VERSION_CACHE_FILE = "registry-version-cache.json";
export declare const REGISTRY_VERSION_CACHE_TTL_MS: number;
/**
 * Bounded online diagnostics: the offline checks plus exactly one `sites.list`
 * call through the shared provider (the same provider serve uses: cached
 * session refresh only, never a browser prompt). Selected properties are
 * verified by membership and reported as counts only; secret material is
 * never printed. Without `--online` the CLI never calls this.
 */
export declare function runDoctorOnline(deps?: DoctorOnlineDeps): Promise<{
    ok: number;
    failed: number;
    checks: DoctorCheck[];
}>;
