// Shared npm-registry version lookup for `gsc doctor --online` (version check)
// and `gsc update` (assisted reinstall). Read-only: exactly one GET against
// the public packument for dist-tags.latest; no telemetry beyond that request.

/** Public packument URL whose `dist-tags.latest` is the newest release. */
export const REGISTRY_URL = "https://registry.npmjs.org/@sonnivasquez/gsc-mcp";

/** Single bounded GET, same budget as the update-feed fetch. */
export const REGISTRY_TIMEOUT_MS = 10_000;

/** Fixed reason classes for an unknown registry answer; raw text never escapes. */
export type RegistryUnknownReason = "timeout" | "network_error" | "unexpected-response";

export type RegistryLatestResult = { ok: true; latest: string } | { ok: false; reason: RegistryUnknownReason };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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
    const response = await fetchImpl(REGISTRY_URL, { signal: controller.signal });
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
