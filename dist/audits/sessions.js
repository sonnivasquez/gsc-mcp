"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditSessions = exports.AuditSessionStore = void 0;
exports.namespace = namespace;
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("../gsc/errors.js");
const TTL = 15 * 60000;
class AuditSessionStore {
    sessions = new Map();
    sweep(now = Date.now()) {
        for (const [id, s] of this.sessions)
            if (!s.busy && now - s.touchedAt >= TTL)
                this.sessions.delete(id);
    }
    create(namespace, kind, input, state) {
        this.sweep();
        const s = { id: (0, node_crypto_1.randomUUID)(), cursor: (0, node_crypto_1.randomUUID)(), namespace, kind, input, state, touchedAt: Date.now(), busy: true, warnings: [] };
        this.sessions.set(s.id, s);
        this.bound(s.id);
        return s;
    }
    get(namespace, kind, cursor, supplied) {
        this.sweep();
        const s = [...this.sessions.values()].find((s) => s.cursor === cursor);
        if (!s)
            throw new errors_js_1.GscError("DATASET_EXPIRED", "audit cursor expired or process restarted; start a new audit");
        if (s.namespace !== namespace || s.kind !== kind)
            throw new errors_js_1.GscError("PROPERTY_NOT_ALLOWED", "audit cursor belongs to another profile or operation");
        if (s.busy)
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "audit is already running");
        for (const [key, value] of Object.entries(supplied)) {
            if (key !== "cursor" && value !== undefined && JSON.stringify(value) !== JSON.stringify(s.input[key]))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", `continuation cannot change ${key}`);
        }
        s.busy = true;
        return s;
    }
    release(s) {
        s.busy = false;
        s.touchedAt = Date.now();
        try {
            this.bound(s.id);
            return this.sessions.has(s.id);
        }
        catch {
            return false;
        }
    }
    bound(current) {
        const bytes = () => [...this.sessions.values()].reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s)), 0);
        while (this.sessions.size > 100 || bytes() > 64 * 1024 * 1024) {
            const candidate = [...this.sessions.values()].find((s) => s.id !== current && !s.busy);
            if (!candidate) {
                this.sessions.delete(current);
                throw new errors_js_1.GscError("REQUEST_BUDGET_EXCEEDED", "audit memory limit exceeded; narrow scope");
            }
            this.sessions.delete(candidate.id);
        }
    }
}
exports.AuditSessionStore = AuditSessionStore;
exports.auditSessions = new AuditSessionStore();
function namespace(alias, sites, allowlist) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([alias, sites, allowlist])).digest("hex");
}
