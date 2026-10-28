"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStore = void 0;
const fs = __importStar(require("node:fs/promises"));
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const profiles_js_1 = require("../profiles.js");
const errors_js_1 = require("../gsc/errors.js");
const hash = (s) => (0, node_crypto_1.createHash)("sha256").update(s).digest("hex");
const MAX_BYTES = 100 * 1024 * 1024;
class HistoryStore {
    profile;
    siteUrl;
    check;
    root;
    folder;
    constructor(profile, siteUrl, root = (0, profiles_js_1.dataDir)(), check = () => { }) {
        this.profile = profile;
        this.siteUrl = siteUrl;
        this.check = check;
        this.root = path.join(root, "history");
        this.folder = path.join(this.root, hash(profile), hash(siteUrl));
    }
    gate() {
        if (process.env.GSC_HISTORY !== "1")
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "history disabled: set GSC_HISTORY=1; exports permission is independent");
    }
    async directory(dir) {
        this.check();
        await fs.mkdir(path.dirname(this.root), { recursive: true, mode: 0o700 });
        const rel = path.relative(this.root, dir);
        for (const p of [this.root, ...rel.split(path.sep).filter(Boolean).map((_, i, a) => path.join(this.root, ...a.slice(0, i + 1)))]) {
            this.check();
            try {
                await fs.mkdir(p, { mode: 0o700 });
            }
            catch (err) {
                if (err.code !== "EEXIST")
                    throw err;
            }
            const st = await fs.lstat(p);
            if (!st.isDirectory() || st.isSymbolicLink())
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "history directory must not be a symbolic link");
            await fs.chmod(p, 0o700);
        }
    }
    validId(id) { if (!/^[0-9a-f-]{36}$/.test(id))
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid change identifier"); }
    async readJson(file) {
        this.check();
        const fd = await fs.open(file, node_fs_1.constants.O_RDONLY | node_fs_1.constants.O_NOFOLLOW);
        try {
            const stat = await fd.stat();
            if (!stat.isFile() || stat.size > MAX_BYTES)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid history file");
            const body = await fd.readFile("utf8");
            this.check();
            const value = JSON.parse(body);
            this.check();
            if (value.schemaVersion !== 1)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "unsupported history schema version");
            return value;
        }
        catch (err) {
            if (err instanceof errors_js_1.GscError && ["CANCELLED", "REQUEST_BUDGET_EXCEEDED"].includes(err.code))
                throw err;
            throw new errors_js_1.GscError("INVALID_ARGUMENT", `history file cannot be read: ${err instanceof Error ? err.message.slice(0, 160) : "invalid JSON"}`);
        }
        finally {
            await fd.close();
        }
    }
    async usage(dir = this.root) {
        this.check();
        let bytes = 0;
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            this.check();
            const file = path.join(dir, e.name);
            if (e.isSymbolicLink())
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "symbolic link in history");
            if (e.isDirectory())
                bytes += await this.usage(file);
            else if (e.isFile())
                bytes += (await fs.lstat(file)).size;
        }
        return bytes;
    }
    async locked(fn) {
        this.check();
        this.gate();
        await this.directory(this.folder);
        this.check();
        const lock = path.join(this.root, ".write-lock");
        let fd;
        try {
            fd = await fs.open(lock, "wx", 0o600);
        }
        catch {
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "history is locked by another writer; retry; if the process crashed, remove history/.write-lock explicitly");
        }
        try {
            this.check();
            return await fn();
        }
        finally {
            await fd.close();
            await fs.unlink(lock);
        }
    }
    async write(file, data) {
        this.check();
        const body = JSON.stringify(data, null, 2) + "\n";
        if (await this.usage() + Buffer.byteLength(body) > MAX_BYTES)
            throw new errors_js_1.GscError("REQUEST_BUDGET_EXCEEDED", "history reached 100 MiB; explicitly delete old changes before writing");
        const temp = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`;
        const fd = await fs.open(temp, "wx", 0o600);
        try {
            this.check();
            await fd.writeFile(body, "utf8");
            this.check();
            await fd.sync();
        }
        catch (err) {
            await fs.unlink(temp).catch(() => { });
            throw err;
        }
        finally {
            await fd.close();
        }
        try {
            this.check();
            await fs.rename(temp, file);
        }
        catch (err) {
            await fs.unlink(temp).catch(() => { });
            throw err;
        }
    }
    async record(input) {
        return this.locked(async () => {
            if (input.idempotencyKey) {
                const found = (await this.list()).find((r) => r.idempotencyKey === input.idempotencyKey);
                if (found) {
                    if (JSON.stringify([found.date, found.label, found.description, found.urls]) !== JSON.stringify([input.date, input.label, input.description, input.urls]))
                        throw new errors_js_1.GscError("INVALID_ARGUMENT", "idempotency key reused for a different change");
                    return found;
                }
            }
            const record = { ...input, schemaVersion: 1, id: (0, node_crypto_1.randomUUID)(), siteUrl: this.siteUrl, profile: this.profile, createdAt: new Date().toISOString() };
            await this.write(path.join(this.folder, `${record.id}.json`), record);
            return record;
        });
    }
    async list() {
        this.check();
        this.gate();
        await this.directory(this.folder);
        const out = [];
        for (const name of (await fs.readdir(this.folder)).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) {
            this.check();
            const r = await this.readJson(path.join(this.folder, name));
            if (r.profile !== this.profile || r.siteUrl !== this.siteUrl || !Array.isArray(r.urls))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "history namespace mismatch");
            out.push(r);
        }
        return out;
    }
    async get(id) {
        this.validId(id);
        const found = (await this.list()).find((r) => r.id === id);
        if (!found)
            throw new errors_js_1.GscError("DATASET_NOT_FOUND", "change record not found");
        return found;
    }
    async snapshot(id, input, result) {
        this.validId(id);
        return this.locked(async () => {
            await this.get(id);
            const file = path.join(this.folder, `${id}.snapshot-${(0, node_crypto_1.randomUUID)()}.json`);
            await this.write(file, { schemaVersion: 1, changeId: id, savedAt: new Date().toISOString(), input, result });
            return file;
        });
    }
    async snapshots(id) {
        await this.get(id);
        const out = [];
        for (const file of (await fs.readdir(this.folder)).filter((n) => n.startsWith(`${id}.snapshot-`) && n.endsWith(".json")).sort())
            out.push(await this.readJson(path.join(this.folder, file)));
        return out;
    }
    // Small histories retain the original API. Larger ones expose bounded raw JSON
    // byte chunks, so even one near-quota snapshot can be recovered without loading it.
    async snapshotPage(id, cursor) {
        const change = await this.get(id);
        this.check();
        const names = (await fs.readdir(this.folder)).filter((n) => n.startsWith(`${id}.snapshot-`) && /^[0-9a-f.-]+snapshot-[0-9a-f-]+\.json$/.test(n)).sort();
        const files = [];
        for (const name of names) {
            this.check();
            const st = await fs.lstat(path.join(this.folder, name));
            if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid history file");
            files.push({ name, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
        }
        if (!cursor && files.reduce((n, f) => n + f.size, 0) <= 1024 * 1024)
            return { change, snapshots: await this.snapshots(id), snapshotsTotal: files.length, nextCursor: null };
        const scope = hash(JSON.stringify([this.profile, this.siteUrl, id]));
        let name = files[0]?.name, offset = 0, expected;
        if (cursor) {
            try {
                const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
                if (c.scope !== scope || typeof c.name !== "string" || !Number.isSafeInteger(c.offset) || c.offset < 0 || !Number.isSafeInteger(c.size) || c.size < 1 || !Number.isFinite(c.mtimeMs) || !Number.isSafeInteger(c.ino))
                    throw new Error();
                name = c.name;
                offset = c.offset;
                expected = c;
            }
            catch {
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid history cursor for this profile, property and change");
            }
        }
        const index = files.findIndex((f) => f.name === name);
        if (index < 0 || offset >= files[index].size || (expected && (files[index].size !== expected.size || files[index].mtimeMs !== expected.mtimeMs || files[index].ino !== expected.ino)))
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "history cursor points to missing or changed snapshot");
        const file = files[index];
        const fd = await fs.open(path.join(this.folder, file.name), node_fs_1.constants.O_RDONLY | node_fs_1.constants.O_NOFOLLOW);
        let buf;
        try {
            const st = await fd.stat();
            if (!st.isFile() || st.size !== file.size || st.mtimeMs !== file.mtimeMs || st.ino !== file.ino)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "history snapshot changed during read");
            buf = Buffer.alloc(Math.min(24 * 1024, file.size - offset));
            this.check();
            const { bytesRead } = await fd.read(buf, 0, buf.length, offset);
            this.check();
            if (bytesRead !== buf.length)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "history snapshot changed during read");
            const after = await fd.stat();
            this.check();
            if (after.size !== file.size || after.mtimeMs !== file.mtimeMs || after.ino !== file.ino)
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "history snapshot changed during read");
        }
        finally {
            await fd.close();
        }
        const nextOffset = offset + buf.length;
        const nextFile = nextOffset < file.size ? file : files[index + 1];
        const next = nextFile ? { ...nextFile, offset: nextOffset < file.size ? nextOffset : 0 } : null;
        return { change: { id: change.id }, changeDetails: "Use list without changeId and retrieve full change records from gsc_get_dataset.", snapshotsTotal: files.length, snapshotChunk: { snapshotId: file.name.slice(id.length + 10, -5), offset, totalBytes: file.size, encoding: "base64", data: buf.toString("base64"), validation: "raw_json_bytes_not_validated" }, nextCursor: next ? Buffer.from(JSON.stringify({ scope, ...next })).toString("base64url") : null };
    }
    async delete(id) {
        this.validId(id);
        await this.locked(async () => {
            await this.get(id);
            for (const name of await fs.readdir(this.folder))
                if (name === `${id}.json` || (name.startsWith(`${id}.snapshot-`) && /^[0-9a-f.-]+snapshot-[0-9a-f-]+\.json$/.test(name))) {
                    this.check();
                    await fs.unlink(path.join(this.folder, name));
                }
        });
    }
}
exports.HistoryStore = HistoryStore;
