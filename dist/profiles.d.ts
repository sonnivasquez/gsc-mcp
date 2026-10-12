import { ALLOW_ALL_TOKEN, MIXED_ALLOW_ALL_ERROR, isAllowAllToken } from "./setup/properties.js";
/**
 * Dedicated allow-all state for current + future properties.
 * GSC_SITE_URLS exactly `all` (bare) or JSON `["all"]` (sole entry,
 * case-insensitive, whitespace-tolerant) means every Search Console
 * property visible to the credential, including future ones. The canonical
 * in-memory form is `["all"]` (lowercase): distinct from `null`
 * (uninitialized, unenforced) and from `[]` (empty, denies everything).
 * Mixed `all` with explicit identifiers is invalid and fails closed.
 */
export { ALLOW_ALL_TOKEN, MIXED_ALLOW_ALL_ERROR, isAllowAllToken };
/**
 * True when an allowlist is the explicit allow-all sentinel: exactly one
 * entry equal to `all` (case-insensitive, whitespace-tolerant). Null
 * (uninitialized) is never allow-all; empty is never allow-all.
 */
export declare function isAllowAllAllowlist(allowlist: readonly string[] | null | undefined): boolean;
export interface InstanceProfile {
    alias: string;
    allowedSites: string[];
}
export declare function dataDir(): string;
export declare function loadProfile(alias: string): InstanceProfile;
export declare function envAllowlist(): string[];
export declare function initInstance(profileAlias?: string): InstanceProfile;
export declare function getActiveInstanceGeneration(): number | null;
export declare function setInstanceAllowlist(sites: string[] | null): void;
export declare function getInstanceAllowlist(): string[] | null;
export declare function getInstanceAlias(): string | null;
/**
 * True when the active instance is the explicit allow-all sentinel
 * (current + future properties). Distinct from null (uninitialized,
 * unenforced): allow-all is an explicit opt-in, never a default.
 */
export declare function isInstanceAllowAll(): boolean;
export declare function isPageUrlAllowedByAllowlist(pageUrl: string, allowlist: string[]): boolean;
export declare function assertSiteAllowed(siteUrl: string): void;
