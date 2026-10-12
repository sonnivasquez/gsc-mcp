// Domain errors for the fetch-based GSC adapter. Every failure is a typed
// GscError: machine-readable code, retryability, and a user action.
// Provider messages are summarized, never forwarded raw (QA-sanitization).

export type GscErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "MISSING_SCOPE"
  | "API_DISABLED"
  | "PROPERTY_NOT_ALLOWED"
  | "PROPERTY_PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "REQUEST_BUDGET_EXCEEDED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_SCHEMA_CHANGED"
  | "DATASET_EXPIRED"
  | "DATASET_NOT_FOUND"
  | "INSUFFICIENT_DATA"
  | "CANCELLED";
export class GscError extends Error {
  readonly code: GscErrorCode;
  readonly retryable: boolean;
  readonly suggestedAction?: string;
  readonly retryAfterMs?: number;

  constructor(code: GscErrorCode, message: string, opts: { retryable?: boolean; suggestedAction?: string; retryAfterMs?: number } = {}) {
    super(`${code}: ${message}`);
    this.name = "GscError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.suggestedAction = opts.suggestedAction;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

// allowlist decisions surface with the same envelope as provider denials.
export function propertyNotAllowed(siteUrl: string, count: number): GscError {
  return new GscError(
    "PROPERTY_NOT_ALLOWED",
    `"${siteUrl}" is not in this instance's allowlist (${count} properties). Change the instance profile explicitly.`,
    { suggestedAction: "serve with a profile that includes the property, or add it to GSC_SITE_URLS" }
  );
}

function summarizeDetail(detail: unknown): string {
  if (typeof detail === "string") return detail.slice(0, 300);
  try {
    return JSON.stringify(detail).slice(0, 300);
  } catch {
    return "unparseable provider error";
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

// Maps an HTTP response to the error it means. Never returns: always throws.
export function throwForResponse(status: number, reason: string, detail: unknown, headers: Headers): never {
  const summary = summarizeDetail(detail);
  const lowered = `${reason} ${summary}`.toLowerCase();
  if (status === 400) {
    throw new GscError("INVALID_ARGUMENT", summary, { suggestedAction: "correct parameters and retry" });
  }
  if (status === 401) {
    throw new GscError("AUTH_EXPIRED", "Google rejected the credentials.", {
      suggestedAction: "run `gsc auth login` in a terminal",
    });
  }
  if (status === 403) {
    if (lowered.includes("quota") || lowered.includes("ratelimit") || lowered.includes("rate limit")) {
      throw new GscError("QUOTA_EXCEEDED", summary, {
        retryable: true,
        suggestedAction: "reduce load and retry later",
      });
    }
    if (lowered.includes("accessnotconfigured") || lowered.includes("api") && lowered.includes("not enabled")) {
      throw new GscError("API_DISABLED", summary, {
        suggestedAction: "enable the Search Console API on the project's Google Cloud project",
      });
    }
    throw new GscError("PROPERTY_PERMISSION_DENIED", summary, {
      suggestedAction: "check account and property permissions",
    });
  }
  if (status === 404) {
    throw new GscError("PROPERTY_PERMISSION_DENIED", summary || "not found", {
      suggestedAction: "check the exact GSC property identifier",
    });
  }
  if (status === 429) {
    throw new GscError("RATE_LIMITED", summary || "rate limited", {
      retryable: true,
      retryAfterMs: parseRetryAfterMs(headers.get("retry-after")),
      suggestedAction: "reduce load and retry",
    });
  }
  if (status >= 500) {
    throw new GscError("UPSTREAM_ERROR", `Google answered ${status}`, {
      retryable: true,
      suggestedAction: "retry in a controlled way",
    });
  }
  throw new GscError("UPSTREAM_ERROR", `unexpected status ${status}: ${summary}`, {
    suggestedAction: "retry later",
  });
}

export function throwForTransport(err: unknown): never {
  if (err instanceof GscError) throw err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError") {
    throw new GscError("CANCELLED", "the request was cancelled", {
      suggestedAction: "do not resume automatically",
    });
  }
  throw new GscError("UPSTREAM_TIMEOUT", message || "no response from Google", {
    retryable: true,
    suggestedAction: "retry in a controlled way",
  });
}
