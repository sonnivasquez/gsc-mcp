import { CANONICAL_TOOLS } from "./gsc/catalog.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { dataDir, envAllowlist, isAllowAllAllowlist } from "./profiles.js";
import { compareSemver, fetchRegistryLatest, REGISTRY_TIMEOUT_MS } from "./registry-version.js";
import { cachedTokenPath } from "./oauth.js";
import { INVALID_ACCESS_MODE, resolveAccessPolicy } from "./access.js";
import { fetchSitesList, getAuthProvider } from "./auth-provider.js";
import type { AuthProvider } from "./auth-provider.js";
import { CLI_VERSION } from "./version.js";
declare const Bun: { version: string } | undefined;

/** Re-exported single source of truth; canonical definition lives in version.ts. */
export { CLI_VERSION };

export const DOCTOR_USAGE = `
Usage: gsc doctor [--online]

Offline by default: reads local state only, never touches the network and
never prints secret material (paths and booleans, not contents).

  --online    Opt into bounded Google checks: exactly one sites.list call
              through the shared provider (cached session refresh only,
              never a browser prompt), plus selected-property and tool
              catalog verification. Omit it to stay fully offline.
  --help      Show this help
`.trim();

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
export const ALLOWLIST_ERROR_DETAIL =
  'invalid GSC_SITE_URLS (allowlist_error): expected a JSON string array or legacy comma-separated list of sc-domain:... / http(s):// identifiers, or "all" alone for every current + future property; re-run setup to reconfigure';

/** Explicit allow-all display: never enumerates properties. */
export const ALLOW_ALL_DISPLAY = "all (explicit opt-in)";

// Offline by default: reads local state only, never touches the network and
// never prints secret material (paths and booleans, not contents).
export function runDoctor(): { ok: number; failed: number; checks: DoctorCheck[] } {
  const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
  const checks: DoctorCheck[] = [
    { id: "runtime", ok: true, detail: `${runtime} on ${process.platform}-${process.arch}` },
  ];

  const mode = process.env.GSC_AUTH_MODE?.toLowerCase() === "oauth" ? "oauth" : "service_account";
  checks.push({ id: "auth_mode", ok: true, detail: mode });

  // Single centralized allowlist parser (profiles.envAllowlist): JSON-first,
  // legacy-compatible. A bad value is reported as a failing check with a
  // stable sanitized diagnostic instead of throwing, so doctor never throws
  // and always reports a complete check list. The parser's raw message is
  // never interpolated: it echoes the offending property value.
  let allowlist: string[] = [];
  let allowlistInvalid = false;
  try {
    allowlist = envAllowlist();
  } catch {
    allowlistInvalid = true;
  }
  checks.push({
    id: "site_urls",
    ok: !allowlistInvalid && allowlist.length > 0,
    detail:
      allowlistInvalid
        ? ALLOWLIST_ERROR_DETAIL
        : isAllowAllAllowlist(allowlist)
          ? ALLOW_ALL_DISPLAY
          : allowlist.length > 0
            ? `${allowlist.length} configured`
            : "GSC_SITE_URLS is empty",
  });
  checks.push({
    id: "allowlist",
    ok: allowlist.length > 0,
    detail:
      allowlistInvalid
        ? ALLOWLIST_ERROR_DETAIL
        : isAllowAllAllowlist(allowlist)
          ? `sites: ${ALLOW_ALL_DISPLAY}`
          : allowlist.length > 0
            ? `${allowlist.length} properties enforced on this instance`
            : "empty: serve would reject every property tool call until configured",
  });

  try {
    const access = resolveAccessPolicy();
    const source = access.source === "canonical"
      ? `GSC_ACCESS_MODE=${access.scopeTier}`
      : `legacy configuration; scope ${access.scopeTier}`;
    checks.push({
      id: "write_ops", ok: true,
      detail: `Google write ops ${access.writesEnabled ? "ENABLED" : "disabled"} (${source})`,
    });
  } catch {
    checks.push({ id: "write_ops", ok: false, detail: INVALID_ACCESS_MODE });
  }

  if (mode === "service_account") {
    const keyFile = process.env.GSC_KEY_FILE ?? "";
    const present = keyFile !== "" && fs.existsSync(keyFile);
    // Same default-mode blindness as `auth status`: the OAuth token check
    // below only runs in oauth mode, so point at a cached token instead of
    // reporting a bare missing key file. Existence only, never contents.
    const oauthHint =
      keyFile === "" && fs.existsSync(cachedTokenPath())
        ? `; OAuth token cached at ${cachedTokenPath()}, set GSC_AUTH_MODE=oauth to use it`
        : "";
    checks.push({
      id: "service_key",
      ok: present,
      detail: (keyFile === "" ? "GSC_KEY_FILE is not set" : present ? `present at ${keyFile}` : `missing at ${keyFile}`) + oauthHint,
    });
  } else {
    // Active scoped token only: existence check reports the path without
    // reading token contents and never falls back to another location.
    // Default (GSC_DATA_DIR unset) remains ~/.gsc-mcp.
    const tokenPath = cachedTokenPath();
    const cached = fs.existsSync(tokenPath);
    checks.push({
      id: "oauth_token",
      ok: cached,
      detail: cached ? `cached at ${tokenPath}` : `no cached token at ${tokenPath}; run setup`,
    });
  }

  const failed = checks.filter((c) => !c.ok).length;
  return { ok: checks.length - failed, failed, checks };
}

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
export const REGISTRY_VERSION_CACHE_FILE = "registry-version-cache.json";
export const REGISTRY_VERSION_CACHE_TTL_MS = 3600 * 1000;

interface RegistryVersionCache {
  fetchedAt: string;
  latest: string;
}

function readRegistryVersionCache(cacheDir: string): RegistryVersionCache | null {
  try {
    const raw = fs.readFileSync(path.join(cacheDir, REGISTRY_VERSION_CACHE_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || !("latest" in parsed) || !("fetchedAt" in parsed)) {
      return null;
    }
    const { latest, fetchedAt } = parsed;
    if (typeof latest !== "string" || latest.trim() === "" || typeof fetchedAt !== "string") return null;
    return { fetchedAt, latest };
  } catch {
    return null;
  }
}

function writeRegistryVersionCache(cacheDir: string, latest: string, nowMs: number): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const payload: RegistryVersionCache = { fetchedAt: new Date(nowMs).toISOString(), latest };
    fs.writeFileSync(path.join(cacheDir, REGISTRY_VERSION_CACHE_FILE), JSON.stringify(payload), "utf8");
  } catch {
    // Cache is best-effort: a failed write never fails the check.
  }
}

function formatVersionCheck(installed: string, latest: string): DoctorCheck {
  const cmp = compareSemver(installed, latest);
  if (cmp === null) {
    return { id: "version", ok: true, detail: "registry latest unknown (unexpected-response); retry later" };
  }
  if (cmp === 0) {
    return { id: "version", ok: true, detail: `up to date (${installed})` };
  }
  if (cmp === 1) {
    return { id: "version", ok: true, detail: `installed ${installed} is ahead of registry latest ${latest}` };
  }
  return { id: "version", ok: true, detail: `installed ${installed}, registry latest ${latest} — run gsc update` };
}

/**
 * Non-failing registry version check: every outcome reports ok:true so it
 * never breaks a working install's diagnostics. Unknown covers offline,
 * timeout, and shape answers with a fixed reason class only.
 */
async function resolveVersionCheck(opts: { fetchImpl: typeof fetch; cacheDir: string; nowMs: number }): Promise<DoctorCheck> {
  const cached = readRegistryVersionCache(opts.cacheDir);
  if (cached !== null) {
    const fetchedAt = Date.parse(cached.fetchedAt);
    if (Number.isFinite(fetchedAt) && opts.nowMs - fetchedAt < REGISTRY_VERSION_CACHE_TTL_MS) {
      return formatVersionCheck(CLI_VERSION, cached.latest);
    }
  }
  const result = await fetchRegistryLatest(opts.fetchImpl, REGISTRY_TIMEOUT_MS);
  if (!result.ok) {
    return { id: "version", ok: true, detail: `registry latest unknown (${result.reason}); retry later` };
  }
  writeRegistryVersionCache(opts.cacheDir, result.latest, opts.nowMs);
  return formatVersionCheck(CLI_VERSION, result.latest);
}

/**
 * Map an online-check failure to a stable safe classification. Only
 * authored in-repo codes (AUTH_REQUIRED, REAUTH_REQUIRED,
 * UPSTREAM_SCHEMA_CHANGED) and fixed network/timeout sentences reach the
 * output; raw exception text (paths, tokens, upstreams) never does, while
 * each sentence keeps the actionable next step.
 */
function classifyOnlineCheckError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = message.match(/^(AUTH_REQUIRED|REAUTH_REQUIRED|UPSTREAM_SCHEMA_CHANGED)\b/)?.[1];
  if (code === "AUTH_REQUIRED") return "No Google session cached (AUTH_REQUIRED). Run `gsc auth login`.";
  if (code === "REAUTH_REQUIRED") return "The OAuth session cannot be renewed (REAUTH_REQUIRED). Run `gsc auth login`.";
  if (code === "UPSTREAM_SCHEMA_CHANGED") {
    return "Google answered 200 with an unrecognized sites.list shape (UPSTREAM_SCHEMA_CHANGED); retry later.";
  }
  if (/timeout|timed\s*out|ETIMEDOUT|ECONNABORTED|EAI_AGAIN/i.test(message)) {
    return "Google check timed out (timeout); retry later.";
  }
  return "Google check failed (network_error); retry later.";
}

/**
 * Bounded online diagnostics: the offline checks plus exactly one `sites.list`
 * call through the shared provider (the same provider serve uses: cached
 * session refresh only, never a browser prompt). Selected properties are
 * verified by membership and reported as counts only; secret material is
 * never printed. Without `--online` the CLI never calls this.
 */
export async function runDoctorOnline(
  deps: DoctorOnlineDeps = {}
): Promise<{ ok: number; failed: number; checks: DoctorCheck[] }> {
  const base = runDoctor();
  const checks: DoctorCheck[] = [...base.checks];

  if (deps.toolCount !== undefined) {
    const okTools = deps.toolCount === CANONICAL_TOOLS.length;
    checks.push({
      id: "tools",
      ok: okTools,
      detail: okTools
        ? `${deps.toolCount} gsc_* tools (canonical catalog)`
        : `expected ${CANONICAL_TOOLS.length} gsc_* tools, found ${deps.toolCount}; release evidence needs reconciliation`,
    });
  }

  const provider = deps.provider ?? getAuthProvider();
  const fetchImpl = deps.fetchImpl ?? fetch;
  let visible: string[] | null = null;
  try {
    const snapshot = await fetchSitesList(provider, fetchImpl);
    if (snapshot.status === 401) {
      checks.push({ id: "api", ok: false, detail: "Google rejected the credentials (401). Run `gsc auth login`." });
    } else if (snapshot.status === 403) {
      checks.push({ id: "api", ok: false, detail: "Credentials valid but Search Console API is disabled or no property is shared (403)." });
    } else if (snapshot.status < 200 || snapshot.status >= 300) {
      checks.push({ id: "api", ok: false, detail: `Google answered ${snapshot.status}; retry later.` });
    } else {
      visible = snapshot.entries.map((entry) => entry.siteUrl);
      checks.push({
        id: "api",
        ok: true,
        detail: `Search Console API reachable: ${snapshot.sites} propert${snapshot.sites === 1 ? "y" : "ies"} visible (one bounded sites.list call)`,
      });
    }
  } catch (err) {
    checks.push({ id: "api", ok: false, detail: classifyOnlineCheckError(err) });
  }

  let allowlist: string[] = [];
  let allowlistInvalid = false;
  try {
    allowlist = envAllowlist();
  } catch {
    allowlistInvalid = true;
  }
  if (visible === null) {
    checks.push({ id: "properties", ok: false, detail: "skipped: the API check failed, so selected properties cannot be verified" });
  } else if (allowlistInvalid) {
    checks.push({ id: "properties", ok: false, detail: ALLOWLIST_ERROR_DETAIL });
  } else if (allowlist.length === 0) {
    checks.push({ id: "properties", ok: false, detail: "no allowlist configured; serve would reject every property tool call until configured" });
  } else if (isAllowAllAllowlist(allowlist)) {
    // Explicit allow-all covers every visible property plus future ones:
    // verification counts visible properties without enumerating the
    // allowlist (which stays exactly `all`).
    checks.push({
      id: "properties",
      ok: true,
      detail: `sites: ${ALLOW_ALL_DISPLAY}: ${visible.length} propert${visible.length === 1 ? "y" : "ies"} visible to this session, future properties included`,
    });
  } else {
    const seen = allowlist.filter((site) => visible.includes(site)).length;
    checks.push({
      id: "properties",
      ok: seen === allowlist.length,
      detail:
        seen === allowlist.length
          ? `${allowlist.length} selected propert${allowlist.length === 1 ? "y" : "ies"}, all visible to this session`
          : `${seen} of ${allowlist.length} selected properties visible to this session; check sharing or the allowlist`,
    });
  }

  // Non-failing registry version check (cached for an hour): informational
  // only, every outcome reports ok:true so it never fails the run.
  checks.push(
    await resolveVersionCheck({
      fetchImpl: deps.versionFetchImpl ?? deps.fetchImpl ?? fetch,
      cacheDir: deps.cacheDir ?? dataDir(),
      nowMs: deps.now?.() ?? Date.now(),
    })
  );

  const failed = checks.filter((c) => !c.ok).length;
  return { ok: checks.length - failed, failed, checks };
}
