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
    source: "google_search_console" | "local_cache" | "local_dataset" | "local_status" | "website_fetch" | "local_history";
    fetchedAt: string | null;
    servedAt: string;
    siteUrl?: string;
    period?: {
        startDate: string;
        endDate: string;
    };
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
export interface OkOpts<T> {
    coverage?: Coverage;
    warnings?: Warning[];
    attempts?: number;
    datasetId?: string;
    datasetExpiresAt?: string;
    sources?: Array<Omit<Provenance, "servedAt">>;
    shrink?: (data: T) => T | null;
}
export declare function ok<T>(data: T, provenance: Omit<Provenance, "servedAt">, opts?: OkOpts<T>): ToolEnvelope<T>;
export declare function fail<T = null>(err: unknown): ToolEnvelope<T>;
