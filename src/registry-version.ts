import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Public packument URL whose `dist-tags.latest` is the newest release. */
export const REGISTRY_URL = "https://registry.npmjs.org/@sonnivasquez/gsc-mcp";

/** Single bounded GET, same budget as the update-feed fetch. */
export const REGISTRY_TIMEOUT_MS = 10_000;
export const REGISTRY_VERSION_CACHE_FILE = "registry-version-cache.json";
export const REGISTRY_VERSION_CACHE_TTL_MS = 3600 * 1000;

/** Fixed reason classes for an unknown registry answer; raw text never escapes. */
export type RegistryUnknownReason = "timeout" | "network_error" | "unexpected-response";

export type RegistryLatestResult = { ok: true; latest: string } | { ok: false; reason: RegistryUnknownReason };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STABLE_VERSION_RE = /^(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})$/;

export function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && STABLE_VERSION_RE.test(value) && value === value.trim();
}

/** Strict numeric semver core, or null when the string is not a version. */
export function parseSemver(version: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Numeric semver comparison, or null when either side is unparseable. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/** Stable safe classification for a registry transport failure. */
export function classifyRegistryError(err: unknown): "timeout" | "network_error" {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/abort|timeout|timed\s*out|ETIMEDOUT|ECONNABORTED|EAI_AGAIN/i.test(message)) return "timeout";
  return "network_error";
}

/**
 * Exactly one GET for dist-tags.latest through the injected fetch seam
 * (AbortController timeout, fetch-guard pattern). A 200 with unparseable
 * JSON or a missing/empty/non-semver dist-tags.latest reports
 * `unexpected-response`; non-2xx answers report `network_error`.
 */
export async function fetchRegistryLatest(
  fetchImpl: typeof fetch,
  timeoutMs: number = REGISTRY_TIMEOUT_MS
): Promise<RegistryLatestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
    if (!response.ok) return { ok: false, reason: "network_error" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "unexpected-response" };
    }
    if (body === null || typeof body !== "object" || !("dist-tags" in body)) {
      return { ok: false, reason: "unexpected-response" };
    }
    const distTags = body["dist-tags"];
    if (distTags === null || typeof distTags !== "object" || !("latest" in distTags)) {
      return { ok: false, reason: "unexpected-response" };
    }
    const latest = distTags.latest;
    if (typeof latest !== "string" || parseSemver(latest) === null) {
      return { ok: false, reason: "unexpected-response" };
    }
    return { ok: true, latest: latest.trim() };
  } catch (err) {
    return { ok: false, reason: classifyRegistryError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort shared cache. Readers see a complete record or a cache miss. */
export async function cachedRegistryLatest(opts: {
  fetchImpl: typeof fetch;
  cacheDir: string;
  nowMs: number;
  timeoutMs?: number;
}): Promise<RegistryLatestResult> {
  const file = path.join(opts.cacheDir, REGISTRY_VERSION_CACHE_FILE);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    const age = opts.nowMs - Date.parse(cached?.fetchedAt);
    if (age >= 0 && age < REGISTRY_VERSION_CACHE_TTL_MS && isStableVersion(cached?.latest)) {
      return { ok: true, latest: cached.latest };
    }
  } catch {
    // A missing, unreadable or malformed cache is a miss.
  }

  const result = await fetchRegistryLatest(opts.fetchImpl, opts.timeoutMs);
  if (!result.ok || !isStableVersion(result.latest)) return result;

  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(opts.cacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, JSON.stringify({ latest: result.latest, fetchedAt: new Date(opts.nowMs).toISOString() }), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
  } catch {
    try { fs.rmSync(temp, { force: true }); } catch { /* Cache writes are optional. */ }
  }
  return result;
}
