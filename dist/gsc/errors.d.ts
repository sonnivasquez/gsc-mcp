export type GscErrorCode = "AUTH_REQUIRED" | "AUTH_EXPIRED" | "MISSING_SCOPE" | "API_DISABLED" | "PROPERTY_NOT_ALLOWED" | "PROPERTY_PERMISSION_DENIED" | "INVALID_ARGUMENT" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "REQUEST_BUDGET_EXCEEDED" | "UPSTREAM_TIMEOUT" | "UPSTREAM_ERROR" | "UPSTREAM_SCHEMA_CHANGED" | "DATASET_EXPIRED" | "DATASET_NOT_FOUND" | "INSUFFICIENT_DATA" | "CANCELLED";
export declare class GscError extends Error {
    readonly code: GscErrorCode;
    readonly retryable: boolean;
    readonly suggestedAction?: string;
    readonly retryAfterMs?: number;
    constructor(code: GscErrorCode, message: string, opts?: {
        retryable?: boolean;
        suggestedAction?: string;
        retryAfterMs?: number;
    });
}
export declare function propertyNotAllowed(siteUrl: string, count: number): GscError;
export declare function throwForResponse(status: number, reason: string, detail: unknown, headers: Headers): never;
export declare function throwForTransport(err: unknown): never;
