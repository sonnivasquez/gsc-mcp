import { randomUUID } from "node:crypto";
import { GscError } from "./errors.js";

export type ResultStatus = "ok" | "partial" | "error";

export interface Warning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Coverage {
  sourceGuarantee: "top_rows_not_exhaustive" | "resource_response";
  apiPaginationComplete: boolean | null;
  fetchedRows: number;
  returnedRows: number;
  truncatedByProduct: boolean;
  stoppedBecause: string[];
  sortAppliedTo?: "retrieved_dataset";
}

export interface Provenance {
  source: "google_search_console" | "local_cache" | "local_dataset" | "local_status";
  fetchedAt: string | null;
  servedAt: string;
  siteUrl?: string;
  period?: { startDate: string; endDate: string };
  searchType?: string;
  dataState?: string;
}

export interface ToolEnvelope<T> {
  schemaVersion: "1.0";
  status: ResultStatus;
  data: T | null;
  meta: {
    requestId: string;
    provenance: Provenance;
    sources?: Array<Omit<Provenance, "servedAt">>;
    coverage?: Coverage;
    googleDataAttempts: number;
    oauthAttempts: number;
    cacheHit: boolean;
    datasetId?: string;
    datasetExpiresAt?: string;
    warnings: Warning[];
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    suggestedAction?: string;
  };
}
// Target ceiling for one MCP tool response. Rows shrink first; warnings stay.
const MAX_BYTES = 48 * 1024;

export interface OkOpts<T> {
  coverage?: Coverage;
  warnings?: Warning[];
  attempts?: number;
  datasetId?: string;
  datasetExpiresAt?: string;
  sources?: Array<Omit<Provenance, "servedAt">>;
  // Returns a smaller payload, or null when it cannot shrink further.
  shrink?: (data: T) => T | null;
}

function cleanMessage(err: GscError): string {
  return err.message.replace(/^[A-Z_]+: /, "");
}

export function ok<T>(data: T, provenance: Omit<Provenance, "servedAt">, opts: OkOpts<T> = {}): ToolEnvelope<T> {
  const warnings = [...(opts.warnings ?? [])];
  const envelope: ToolEnvelope<T> = {
    schemaVersion: "1.0",
    status: warnings.some((w) => w.code === "PARTIAL") ? "partial" : "ok",
    data,
    meta: {
      requestId: randomUUID(),
      provenance: { ...provenance, servedAt: new Date().toISOString() },
      coverage: opts.coverage,
      sources: opts.sources,
      googleDataAttempts: opts.attempts ?? 0,
      oauthAttempts: 0,
      cacheHit: false,
      datasetId: opts.datasetId,
      warnings,
    },
  };
  let size = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (opts.shrink) {
    for (let shrinks = 0; shrinks < 8; shrinks++) {
      if (size <= MAX_BYTES) break;
      const smaller = opts.shrink(envelope.data as T);
      if (smaller === null) break;
      envelope.data = smaller;
      size = Buffer.byteLength(JSON.stringify(envelope), "utf8");
    }
  }
  if (size > MAX_BYTES) {
    envelope.meta.warnings.push({ code: "SIZE_TRIMMED", message: `response exceeded ${MAX_BYTES} bytes after shrinking` });
  }
  return envelope;
}

export function fail<T = null>(err: unknown): ToolEnvelope<T> {
  const block =
    err instanceof GscError
      ? { code: err.code, message: cleanMessage(err), retryable: err.retryable, suggestedAction: err.suggestedAction }
      : { code: "UPSTREAM_ERROR", message: String(err), retryable: false, suggestedAction: undefined };
  return {
    schemaVersion: "1.0",
    status: "error",
    data: null,
    meta: {
      requestId: randomUUID(),
      provenance: { source: "google_search_console", fetchedAt: null, servedAt: new Date().toISOString() },
      googleDataAttempts: 0,
      oauthAttempts: 0,
      cacheHit: false,
      warnings: [],
    },
    error: block,
  };
}
