"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.datasets = exports.DatasetStore = void 0;
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("./errors.js");
const TTL_MS = 15 * 60_000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DATASETS = 100;
function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}
function decodeCursor(cursor) {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (typeof parsed.offset !== "number" || parsed.offset < 0 || !Number.isInteger(parsed.offset)) {
            throw new Error("bad offset");
        }
        return parsed.offset;
    }
    catch {
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "cursor is not a valid dataset cursor for this dataset");
    }
}
// Process-local navigation store: zero new Google calls while paging.
// Namespaced by profile alias: a handle from another profile is rejected,
// never served.
class DatasetStore {
    sets = new Map();
    usageBytes() {
        let total = 0;
        for (const ds of this.sets.values())
            total += ds.byteSize;
        return total;
    }
    evictExpired(now) {
        for (const [id, ds] of this.sets) {
            if (Date.parse(ds.expiresAt) <= now)
                this.sets.delete(id);
        }
    }
    evictOldestWhileOver() {
        while ((this.sets.size > MAX_DATASETS || this.usageBytes() > MAX_BYTES) && this.sets.size > 0) {
            const oldest = this.sets.keys().next();
            if (oldest.done)
                break;
            this.sets.delete(oldest.value);
        }
    }
    create(profileAlias, columns, rows, now = Date.now()) {
        this.evictExpired(now);
        const createdAt = new Date(now).toISOString();
        const ds = {
            id: (0, node_crypto_1.randomUUID)(),
            profileAlias,
            columns,
            rows,
            createdAt,
            expiresAt: new Date(now + TTL_MS).toISOString(),
            byteSize: JSON.stringify(rows).length,
        };
        this.sets.set(ds.id, ds);
        this.evictOldestWhileOver();
        if (!this.sets.has(ds.id)) {
            throw new errors_js_1.GscError("REQUEST_BUDGET_EXCEEDED", "dataset store is full; narrow the query", {
                suggestedAction: "reduce maxFetchRows and retry",
            });
        }
        return ds;
    }
    page(datasetId, profileAlias, opts = {}) {
        const ds = this.sets.get(datasetId);
        if (ds === undefined) {
            throw new errors_js_1.GscError("DATASET_NOT_FOUND", "dataset id is unknown; re-run the query explicitly", {
                suggestedAction: "re-run the originating tool call",
            });
        }
        if (Date.parse(ds.expiresAt) <= Date.now()) {
            this.sets.delete(datasetId);
            throw new errors_js_1.GscError("DATASET_EXPIRED", "dataset expired; re-run the query explicitly", {
                suggestedAction: "re-run the originating tool call",
            });
        }
        if (ds.profileAlias !== profileAlias) {
            throw new errors_js_1.GscError("DATASET_NOT_FOUND", "dataset is unknown under the current profile", {
                suggestedAction: "re-run the query under the current profile",
            });
        }
        const offset = opts.cursor === undefined ? 0 : decodeCursor(opts.cursor);
        const limit = opts.limit ?? 50;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "limit must be an integer between 1 and 200");
        }
        const columns = opts.columns ?? ds.columns;
        for (const c of columns) {
            if (!ds.columns.includes(c)) {
                throw new errors_js_1.GscError("INVALID_ARGUMENT", `column "${c}" was not in the original result`);
            }
        }
        const slice = ds.rows.slice(offset, offset + limit);
        const projected = slice.map((row) => {
            const out = {};
            for (const c of columns)
                out[c] = row[c] ?? null;
            return out;
        });
        const next = offset + limit;
        return {
            datasetId,
            rows: projected,
            columns,
            totalRows: ds.rows.length,
            nextCursor: next < ds.rows.length ? encodeCursor(next) : null,
            expiresAt: ds.expiresAt,
        };
    }
}
exports.DatasetStore = DatasetStore;
exports.datasets = new DatasetStore();
