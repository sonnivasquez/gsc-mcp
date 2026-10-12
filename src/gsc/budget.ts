import { GscError } from "./errors.js";

export interface RunOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
  // Wall-clock budget for the whole run (retries included). Defaults to 60s.
  deadlineMs?: number;
}

function cancelledDuringBackoff(): GscError {
  return new GscError("CANCELLED", "cancelled during retry backoff", {
    suggestedAction: "do not resume automatically",
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelledDuringBackoff());
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onAbort = (): void => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reject(cancelledDuringBackoff());
  };
  const timer: NodeJS.Timeout = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

// Shared request budget for one tool call (composed tools share the instance).
// Retries transient failures with backoff+jitter, honors Retry-After, and
// stops with an actionable error when attempts or time run out.
export class RequestBudget {
  private used = 0;

  constructor(private readonly maxAttempts: number = 12) {}

  get attemptsUsed(): number {
    return this.used;
  }

  async run<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, opts: RunOpts = {}): Promise<T> {
    const deadline = Date.now() + (opts.deadlineMs ?? 60_000);
    let attempt = 0;
    for (;;) {
      if (opts.signal?.aborted) {
        throw new GscError("CANCELLED", "cancelled before the attempt", {
          suggestedAction: "do not resume automatically",
        });
      }
      if (this.used >= this.maxAttempts) {
        throw new GscError("REQUEST_BUDGET_EXCEEDED", `reached ${this.maxAttempts} Google attempts`, {
          suggestedAction: "narrow the scope and keep the partial result",
        });
      }
      this.used++;
      const timeoutMs = opts.timeoutMs ?? 15_000;
      const controller = new AbortController();
      const { promise: stopPromise, reject: rejectStop } = Promise.withResolvers<never>();
      let stopCause: GscError | null = null;
      const recordStop = (cause: GscError): void => {
        if (stopCause === null) {
          stopCause = cause;
          rejectStop(cause);
          try {
            controller.abort();
          } catch {
            // Abort delivery is best-effort; the recorded cause settles the race.
          }
        }
      };
      const timer: NodeJS.Timeout = setTimeout(() => {
        recordStop(new GscError("UPSTREAM_TIMEOUT", `no response within ${timeoutMs}ms`, { retryable: true }));
      }, timeoutMs);
      const onExternalAbort = (): void => {
        recordStop(new GscError("CANCELLED", "cancelled during the attempt", {
          suggestedAction: "do not resume automatically",
        }));
      };
      if (opts.signal !== undefined) {
        if (opts.signal.aborted) {
          onExternalAbort();
        } else {
          opts.signal.addEventListener("abort", onExternalAbort, { once: true });
        }
      }
      try {
        const outcome = await Promise.race([fn(attempt, controller.signal), stopPromise]);
        opts.signal?.removeEventListener("abort", onExternalAbort);
        clearTimeout(timer);
        return outcome;
      } catch (err) {
        const gsc = stopCause ?? (err instanceof GscError ? err : new GscError("UPSTREAM_ERROR", String(err), { retryable: false }));
        opts.signal?.removeEventListener("abort", onExternalAbort);
        clearTimeout(timer);
        if (gsc.code === "CANCELLED") throw gsc;
        if (!gsc.retryable || attempt + 1 >= this.maxAttempts) throw gsc;
        const wait = gsc.retryAfterMs ?? backoffMs(attempt);
        if (wait > deadline - Date.now()) {
          throw new GscError(gsc.code, gsc.message, {
            retryable: true,
            suggestedAction: `retry after ${Math.ceil(wait / 1000)}s`,
          });
        }
        attempt++;
        await sleep(wait, opts.signal);
      }
    }
  }
}
