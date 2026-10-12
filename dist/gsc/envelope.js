"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.fail = fail;
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("./errors.js");
// Target ceiling for one MCP tool response. Rows shrink first; warnings stay.
const MAX_BYTES = 48 * 1024;
function cleanMessage(err) {
    return err.message.replace(/^[A-Z_]+: /, "");
}
function ok(data, provenance, opts = {}) {
    const warnings = [...(opts.warnings ?? [])];
    const envelope = {
        schemaVersion: "1.0",
        status: warnings.some((w) => w.code === "PARTIAL") ? "partial" : "ok",
        data,
        meta: {
            requestId: (0, node_crypto_1.randomUUID)(),
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
            if (size <= MAX_BYTES)
                break;
            const smaller = opts.shrink(envelope.data);
            if (smaller === null)
                break;
            envelope.data = smaller;
            size = Buffer.byteLength(JSON.stringify(envelope), "utf8");
        }
    }
    if (size > MAX_BYTES) {
        envelope.meta.warnings.push({ code: "SIZE_TRIMMED", message: `response exceeded ${MAX_BYTES} bytes after shrinking` });
    }
    return envelope;
}
function fail(err) {
    const block = err instanceof errors_js_1.GscError
        ? { code: err.code, message: cleanMessage(err), retryable: err.retryable, suggestedAction: err.suggestedAction }
        : { code: "UPSTREAM_ERROR", message: String(err), retryable: false, suggestedAction: undefined };
    return {
        schemaVersion: "1.0",
        status: "error",
        data: null,
        meta: {
            requestId: (0, node_crypto_1.randomUUID)(),
            provenance: { source: "google_search_console", fetchedAt: null, servedAt: new Date().toISOString() },
            googleDataAttempts: 0,
            oauthAttempts: 0,
            cacheHit: false,
            warnings: [],
        },
        error: block,
    };
}
