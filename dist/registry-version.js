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
exports.REGISTRY_VERSION_CACHE_TTL_MS = exports.REGISTRY_VERSION_CACHE_FILE = exports.REGISTRY_TIMEOUT_MS = exports.REGISTRY_URL = void 0;
exports.isStableVersion = isStableVersion;
exports.parseSemver = parseSemver;
exports.compareSemver = compareSemver;
exports.classifyRegistryError = classifyRegistryError;
exports.fetchRegistryLatest = fetchRegistryLatest;
exports.cachedRegistryLatest = cachedRegistryLatest;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
/** Public packument URL whose `dist-tags.latest` is the newest release. */
exports.REGISTRY_URL = "https://registry.npmjs.org/@sonnivasquez/gsc-mcp";
/** Single bounded GET, same budget as the update-feed fetch. */
exports.REGISTRY_TIMEOUT_MS = 10_000;
exports.REGISTRY_VERSION_CACHE_FILE = "registry-version-cache.json";
exports.REGISTRY_VERSION_CACHE_TTL_MS = 3600 * 1000;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STABLE_VERSION_RE = /^(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})$/;
function isStableVersion(value) {
    return typeof value === "string" && STABLE_VERSION_RE.test(value) && value === value.trim();
}
/** Strict numeric semver core, or null when the string is not a version. */
function parseSemver(version) {
    const match = SEMVER_RE.exec(version.trim());
    if (!match)
        return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/** Numeric semver comparison, or null when either side is unparseable. */
function compareSemver(a, b) {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left || !right)
        return null;
    for (let i = 0; i < 3; i++) {
        if (left[i] < right[i])
            return -1;
        if (left[i] > right[i])
            return 1;
    }
    return 0;
}
/** Stable safe classification for a registry transport failure. */
function classifyRegistryError(err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (/abort|timeout|timed\s*out|ETIMEDOUT|ECONNABORTED|EAI_AGAIN/i.test(message))
        return "timeout";
    return "network_error";
}
/**
 * Exactly one GET for dist-tags.latest through the injected fetch seam
 * (AbortController timeout, fetch-guard pattern). A 200 with unparseable
 * JSON or a missing/empty/non-semver dist-tags.latest reports
 * `unexpected-response`; non-2xx answers report `network_error`.
 */
async function fetchRegistryLatest(fetchImpl, timeoutMs = exports.REGISTRY_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(exports.REGISTRY_URL, {
            signal: controller.signal,
            headers: { Accept: "application/vnd.npm.install-v1+json" },
        });
        if (!response.ok)
            return { ok: false, reason: "network_error" };
        let body;
        try {
            body = await response.json();
        }
        catch {
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
    }
    catch (err) {
        return { ok: false, reason: classifyRegistryError(err) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Best-effort shared cache. Readers see a complete record or a cache miss. */
async function cachedRegistryLatest(opts) {
    const file = path.join(opts.cacheDir, exports.REGISTRY_VERSION_CACHE_FILE);
    try {
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        const age = opts.nowMs - Date.parse(cached?.fetchedAt);
        if (age >= 0 && age < exports.REGISTRY_VERSION_CACHE_TTL_MS && isStableVersion(cached?.latest)) {
            return { ok: true, latest: cached.latest };
        }
    }
    catch {
        // A missing, unreadable or malformed cache is a miss.
    }
    const result = await fetchRegistryLatest(opts.fetchImpl, opts.timeoutMs);
    if (!result.ok || !isStableVersion(result.latest))
        return result;
    const temp = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        fs.mkdirSync(opts.cacheDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(temp, JSON.stringify({ latest: result.latest, fetchedAt: new Date(opts.nowMs).toISOString() }), { flag: "wx", mode: 0o600 });
        fs.renameSync(temp, file);
    }
    catch {
        try {
            fs.rmSync(temp, { force: true });
        }
        catch { /* Cache writes are optional. */ }
    }
    return result;
}
