/**
 * Explicit allow-all sentinel for current + future properties.
 * GSC_SITE_URLS exactly `all` (bare) or JSON `["all"]` (sole entry,
 * case-insensitive, whitespace-tolerant) means every Search Console
 * property visible to the credential, including future ones. Mixed `all`
 * with explicit identifiers is invalid and fails closed.
 * Defined here (shape-rule owner) so profiles.ts can import it without a
 * cycle: profiles -> properties is the single direction.
 */
export declare const ALLOW_ALL_TOKEN = "all";
/**
 * True for the allow-all sentinel (case-insensitive, whitespace-tolerant).
 * Only the bare token counts: surrounding whitespace is ignored, but any
 * other content rejects.
 */
export declare function isAllowAllToken(value: unknown): boolean;
/** Actionable failure for mixed `all` plus explicit identifiers. */
export declare const MIXED_ALLOW_ALL_ERROR = "GSC_SITE_URLS mixes \"all\" with explicit properties: use either \"all\" alone for every current and future property, or an explicit allowlist without \"all\".";
/**
 * Interactive sentinel choice for the setup wizard: `0` or bare `all`
 * selects all current + future properties (explicit opt-in,
 * double-confirmed). Accepted case-insensitively with surrounding
 * whitespace tolerated. `0` exists so non-technical users never need to
 * guess a keyword; `all` matches the `--site all` spelling.
 */
export declare function isAllowAllFutureAnswer(answer: string): boolean;
/** Strong warning shown before the allow-all confirmation. */
export declare const ALLOW_ALL_WARNING: string;
/**
 * True for the accepted Google property forms. Shared single shape rule for
 * the setup writer and the centralized profiles/auth/doctor readers: one
 * predicate, no divergent shape rules.
 * - Any whitespace anywhere rejects (identifiers never contain it).
 * - `sc-domain:` requires a nonempty valid domain-style hostname.
 * - `http(s)://` must URL-parse and its host must be a valid domain-style
 *   hostname or a legitimate IP literal (IPv4/IPv6). WHATWG parsing alone
 *   accepts invalid DNS labels (underscores, edge hyphens), so the same
 *   label rule applies to URL hosts. Ports, paths, queries, case, commas,
 *   and trailing slashes never affect the verdict.
 * Accepted values keep their exact original string: case, trailing slashes,
 * ports, paths, and commas inside URL-prefix properties all survive.
 * Only the documented Google prefixes are accepted; nothing else is excluded
 * beyond malformed hosts and whitespace.
 */
export declare function isPropertyIdentifier(value: string): boolean;
/**
 * Validate repeatable --site flag values. Each flag is one exact identifier:
 * preserved byte-for-byte with no trimming or comma splitting, except the
 * explicit allow-all sentinel `--site all` (case-insensitive) which is
 * normalized to the canonical `"all"`. Rejects empty/whitespace-only and
 * structurally invalid flags instead of silently dropping or fixing them.
 * Mixed `all` with explicit identifiers fails closed with an actionable
 * message; use either `all` alone or an explicit allowlist without `all`.
 */
export declare function parseSiteFlags(rawValues: string[]): string[];
/**
 * Fail-closed allowlist validation: non-empty, no blanks, valid shapes.
 * The sole `all` entry (case-insensitive, whitespace-tolerant) selects all
 * current + future properties and is normalized to canonical `"all"`.
 * Mixed `all` with explicit identifiers fails closed with an actionable
 * message.
 */
export declare function validateAllowlist(sites: string[]): string[];
/**
 * Parse one interactive property answer against the exact fetched list.
 * - "" (Enter) selects the default single property ([1], least privilege).
 * - "0" or "all" selects all current + future properties as the `all`
 *   sentinel (explicit opt-in; the caller double-confirms before storing).
 * - Otherwise a comma/space-separated list of 1-based indices.
 * Throws on any out-of-range, mixed-`0`, or non-numeric token; never guesses.
 */
export declare function parsePropertySelectionAnswer(answer: string, properties: readonly string[], defaultIndex?: number): string[];
export interface SelectPropertiesOpts {
    allSites: boolean;
    requested: string[];
    fetched: string[];
    interactiveAnswer?: string;
    defaultIndex?: number;
}
/**
 * Deterministic property resolution shared by interactive and
 * non-interactive setup. requested/fetched entries are already exact;
 * this function only selects, never rewrites identifiers.
 */
export declare function selectProperties(opts: SelectPropertiesOpts): string[];
