import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ALLOW_ALL_TOKEN, MIXED_ALLOW_ALL_ERROR, isAllowAllToken, isPropertyIdentifier } from "./setup/properties.js";

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
export function isAllowAllAllowlist(allowlist: readonly string[] | null | undefined): boolean {
  return Array.isArray(allowlist) && allowlist.length === 1 && isAllowAllToken(allowlist[0]);
}

export interface InstanceProfile {
  alias: string;
  allowedSites: string[];
}

export function dataDir(): string {
  return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}

function profilePath(alias: string): string {
  return path.join(dataDir(), "profiles", `${alias}.json`);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

// Reads and validates a stored profile. Throws with an actionable message;
// never returns a half-parsed allowlist.
export function loadProfile(alias: string): InstanceProfile {
  const file = profilePath(alias);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `Profile "${alias}" not found at ${file}. Create it with allowedSites, or serve without --profile to use GSC_SITE_URLS.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Profile "${alias}" at ${file} is not valid JSON.`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !isStringList((parsed as { allowedSites?: unknown }).allowedSites)
  ) {
    throw new Error(
      `Profile "${alias}" at ${file} must be {"version":1,"allowedSites":[...non-empty strings...]}.`
    );
  }
  // Stored entries use the same shared predicate as every other reader:
  // structurally invalid nonempty entries fail closed instead of persisting
  // a silently unenforceable allowlist. Valid entries keep their exact bytes.
  // The sole `all` entry (any case/whitespace) is the explicit allow-all
  // sentinel for current + future properties; mixed `all` fails closed.
  const sites = (parsed as { allowedSites: string[] }).allowedSites;
  if (sites.length === 1 && isAllowAllToken(sites[0])) {
    return { alias, allowedSites: [ALLOW_ALL_TOKEN] };
  }
  if (sites.some((site) => isAllowAllToken(site))) {
    throw new Error(
      `Profile "${alias}" at ${file} ${MIXED_ALLOW_ALL_ERROR}`
    );
  }
  for (const site of sites) {
    if (!isPropertyIdentifier(site)) {
      throw new Error(
        `Profile "${alias}" at ${file} has invalid property ${JSON.stringify(site)}: use sc-domain:... or an http(s):// URL.`
      );
    }
  }
  return {
    alias,
    allowedSites: [...sites],
  };
}

export function envAllowlist(): string[] {
  // Declared reader domain (total: every other value fails closed):
  // - the explicit allow-all sentinel `all` (bare, case-insensitive,
  //   whitespace-tolerant) or JSON `["all"]` (sole entry), meaning every
  //   current + future property visible to the credential, or
  // - a JSON array of non-empty structurally valid GSC identifiers, or
  // - legacy comma-separated entries where every entry is structurally valid.
  // Valid entries are returned byte-for-byte (legacy entries keep their
  // historical outer-whitespace trim; the sentinel normalizes to `["all"]`);
  // mixed `all` with explicit identifiers fails closed; anything else throws.
  const raw = process.env.GSC_SITE_URLS ?? "";
  if (raw.trim().length === 0) return [];
  const trimmed = raw.trim();
  // Bare sentinel first: exactly `all` with any case/whitespace. This must
  // precede legacy comma parsing so `all` never falls through to property
  // validation (where it would fail as an invalid identifier).
  if (isAllowAllToken(trimmed)) return [ALLOW_ALL_TOKEN];
  // Any JSON-looking value (array or object) enters the JSON branch: setup
  // writes arrays, and a non-array JSON value such as {"allowedSites":[]}
  // must fail closed instead of falling through to legacy comma parsing.
  // No valid legacy identifier starts with "[" or "{".
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    // New setup writes a JSON string array so identifiers containing commas
    // survive exactly. Parse it byte-for-byte; never comma-split JSON.
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        "GSC_SITE_URLS looks like JSON but is not valid JSON. Use a JSON string array like " +
          "'[\"sc-domain:example.com\",\"https://example.com/\"]' or a legacy comma-separated list of valid identifiers."
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        "GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
          "'[\"sc-domain:example.com\",\"https://example.com/\"]'."
      );
    }
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(
          "GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
            "'[\"sc-domain:example.com\",\"https://example.com/\"]'."
        );
      }
      // Sentinel entries are checked before property validation: a sole
      // `all` (any case/whitespace) is allow-all; mixed `all` fails closed.
      if (isAllowAllToken(entry)) {
        if (parsed.length !== 1) throw new Error(MIXED_ALLOW_ALL_ERROR);
        return [ALLOW_ALL_TOKEN];
      }
      if (!isPropertyIdentifier(entry)) {
        throw new Error(`Invalid property ${JSON.stringify(entry)} in GSC_SITE_URLS: use sc-domain:... or an http(s):// URL.`);
      }
      out.push(entry);
    }
    // A JSON array that contained only the sentinel already returned above;
    // reaching here means no sentinel was present.
    if (out.length === 0) {
      throw new Error(
        "GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
          "'[\"sc-domain:example.com\",\"https://example.com/\"]'."
      );
    }
    return out;
  }
  // Legacy comma-separated input compatibility for valid historical values.
  // Every entry must be non-empty and structurally valid: JSON scalars,
  // bare tokens, empty elements, and arbitrary garbage all fail closed.
  // A sole `all` (any case/whitespace) is the allow-all sentinel; mixed
  // `all` with explicit identifiers fails closed with an actionable message.
  const parts = raw.split(",");
  if (parts.length === 1 && isAllowAllToken(parts[0])) return [ALLOW_ALL_TOKEN];
  if (parts.some((part) => isAllowAllToken(part))) throw new Error(MIXED_ALLOW_ALL_ERROR);
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry.length === 0) {
      throw new Error(
        "GSC_SITE_URLS contains an empty property entry. Use a JSON string array like " +
          "'[\"sc-domain:example.com\",\"https://example.com/\"]' or a comma-separated list of valid identifiers."
      );
    }
    if (!isPropertyIdentifier(entry)) {
      throw new Error(`Invalid property ${JSON.stringify(entry)} in GSC_SITE_URLS: use sc-domain:... or an http(s):// URL.`);
    }
    out.push(entry);
  }
  return out;
}

// Process-level allowlist. null = not initialized (tests and library use):
// enforcement is a no-op until serve startup calls initInstance.
let instanceAllowlist: string[] | null = null;
let instanceAlias: string | null = null;
let instanceGeneration = 0;

export function initInstance(profileAlias?: string): InstanceProfile {
  const profile =
    profileAlias !== undefined && profileAlias !== ""
      ? loadProfile(profileAlias)
      : { alias: "default(env)", allowedSites: envAllowlist() };
  instanceAllowlist = profile.allowedSites;
  instanceAlias = profile.alias;
  instanceGeneration++;
  return profile;
}

export function getActiveInstanceGeneration(): number | null {
  return instanceAllowlist === null || instanceGeneration === 0 ? null : instanceGeneration;
}

export function setInstanceAllowlist(sites: string[] | null): void {
  instanceAllowlist = sites;
}

export function getInstanceAllowlist(): string[] | null {
  return instanceAllowlist;
}

export function getInstanceAlias(): string | null {
  return instanceAlias;
}

/**
 * True when the active instance is the explicit allow-all sentinel
 * (current + future properties). Distinct from null (uninitialized,
 * unenforced): allow-all is an explicit opt-in, never a default.
 */
export function isInstanceAllowAll(): boolean {
  return isAllowAllAllowlist(instanceAllowlist);
}

// Page allowlist matcher for the image audit. sc-domain:d matches the page
// host itself or any subdomain (case-insensitive); http(s) entries match by
// exact-string prefix of the full page URL with an origin boundary: the next
// character after the prefix must be `/`, `?`, `#`, or end-of-string, so
// `https://example.com` never matches `https://example.com.evil.com/x`.
// The explicit allow-all sentinel (`["all"]`) allows any valid http(s)
// page URL, including future properties. Invalid page URLs never match.
export function isPageUrlAllowedByAllowlist(pageUrl: string, allowlist: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  } catch {
    return false;
  }
  // Explicit allow-all opt-in: every current + future property is allowed.
  // The URL must still be a valid http(s) URL (checked above).
  if (isAllowAllAllowlist(allowlist)) return true;
  const host = parsed.hostname.toLowerCase();
  for (const entry of allowlist) {
    if (entry.startsWith("sc-domain:")) {
      const domain = entry.slice("sc-domain:".length).toLowerCase();
      if (domain.length === 0) continue;
      if (host === domain || host.endsWith(`.${domain}`)) return true;
    } else if (pageUrl.startsWith(entry)) {
      // Entries that already end at a boundary (e.g. `https://example.com/`)
      // keep plain prefix semantics; otherwise require the next character
      // to be `/`, `?`, `#`, or end-of-string.
      const last = entry.slice(-1);
      if (last === "/" || last === "?" || last === "#") return true;
      const next = pageUrl.slice(entry.length);
      if (next === "" || next.startsWith("/") || next.startsWith("?") || next.startsWith("#")) {
        return true;
      }
    }
  }
  return false;
}
// before any Google request. Uninitialized (null) means unenforced.
// The explicit allow-all sentinel (`["all"]`) allows every property,
// including future ones; it is distinct from null and never a default.
export function assertSiteAllowed(siteUrl: string): void {
  if (instanceAllowlist === null) return;
  if (isAllowAllAllowlist(instanceAllowlist)) return;
  if (!instanceAllowlist.includes(siteUrl)) {
    throw new Error(
      `PROPERTY_NOT_ALLOWED: "${siteUrl}" is not in this instance's allowlist ` +
        `(${instanceAllowlist.length} properties). Change the instance profile explicitly; ` +
        `tool arguments cannot widen it.`
    );
  }
}
