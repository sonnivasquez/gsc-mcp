"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultResolveHost = void 0;
exports.isPrivateLiteral = isPrivateLiteral;
exports.assertPublicUrl = assertPublicUrl;
exports.guardedFetch = guardedFetch;
exports.readBoundedBody = readBoundedBody;
const promises_1 = require("node:dns/promises");
const errors_js_1 = require("./gsc/errors.js");
const defaultResolveHost = async (host) => {
    const records = await (0, promises_1.lookup)(host, { all: true });
    return records.map((r) => r.address);
};
exports.defaultResolveHost = defaultResolveHost;
function isIPv4Literal(value) {
    const parts = value.split(".");
    if (parts.length !== 4)
        return null;
    const octets = [];
    for (const part of parts) {
        if (part.length === 0 || !/^\d+$/.test(part))
            return null;
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0 || n > 255)
            return null;
        octets.push(n);
    }
    return octets;
}
// Public-host policy: true means the literal must be blocked. Covers IPv4
// private/loopback/link-local/reserved/multicast+, IPv6 loopback/unspecified/
// link-local/unique-local/multicast, plus localhost names (case-insensitive).
function isPrivateLiteral(hostOrIp) {
    const lower = hostOrIp.toLowerCase();
    if (lower === "localhost" || lower.endsWith(".localhost"))
        return true;
    const v4 = isIPv4Literal(hostOrIp);
    if (v4 !== null) {
        const [a, b] = v4;
        if (a === 10)
            return true;
        if (a === 172 && b >= 16 && b <= 31)
            return true;
        if (a === 192 && b === 168)
            return true;
        if (a === 127)
            return true;
        if (a === 169 && b === 254)
            return true;
        if (a === 0)
            return true;
        if (a >= 224)
            return true;
        return false;
    }
    // IPv4 embedded in IPv6 (e.g. ::ffff:127.0.0.1): check the IPv4 tail.
    if (hostOrIp.includes(".") && hostOrIp.includes(":")) {
        const tail = hostOrIp.slice(hostOrIp.lastIndexOf(":") + 1);
        const embedded = isIPv4Literal(tail);
        if (embedded !== null)
            return isPrivateLiteral(tail);
    }
    // IPv6 literals (or hostnames that look like them). Plain hostnames with
    // dots but no valid IPv4 shape already returned above; hostnames without
    // dots or colons are not literals.
    if (!hostOrIp.includes(":"))
        return false;
    const norm = lower.trim();
    if (norm === "::" || norm === "::1")
        return true;
    // All-zero forms (0:0:0:0:0:0:0:0, ::0) are the unspecified address.
    const withoutColons = norm.replace(/:/g, "");
    if (withoutColons.length > 0 && /^[0]+$/.test(withoutColons))
        return true;
    if (withoutColons.length === 0)
        return true;
    const firstHextet = norm.split(":").find((p) => p.length > 0) ?? "";
    const value = Number.parseInt(firstHextet.slice(0, 4), 16);
    if (!Number.isFinite(value))
        return false;
    if (value >= 0xfe80 && value <= 0xfebf)
        return true; // fe80::/10 link-local
    if (value >= 0xfc00 && value <= 0xfdff)
        return true; // fc00::/7 unique-local
    if ((value & 0xff00) === 0xff00)
        return true; // ff00::/8 multicast
    return false;
}
function extractAddresses(resolved) {
    if (!Array.isArray(resolved))
        return [];
    return resolved.map((entry) => typeof entry === "string" ? entry : String(entry.address));
}
// Rejects non-public URLs before any fetch. DNS failures fail closed.
async function assertPublicUrl(url, resolveHost = exports.defaultResolveHost) {
    let hostname;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new errors_js_1.GscError("UPSTREAM_ERROR", `only http/https URLs may be fetched: ${url}`, {
                suggestedAction: "pass an http(s) URL on a public host",
            });
        }
        hostname = parsed.hostname;
    }
    catch (err) {
        if (err instanceof errors_js_1.GscError)
            throw err;
        throw new errors_js_1.GscError("UPSTREAM_ERROR", `unparseable URL: ${url}`, {
            suggestedAction: "pass a valid http(s) URL on a public host",
        });
    }
    if (isPrivateLiteral(hostname)) {
        throw new errors_js_1.GscError("UPSTREAM_ERROR", `blocked private host: ${hostname}`, {
            suggestedAction: "pass a URL on a public host",
        });
    }
    let resolved;
    try {
        resolved = extractAddresses(await resolveHost(hostname));
    }
    catch {
        throw new errors_js_1.GscError("UPSTREAM_ERROR", "cannot verify host is public", {
            suggestedAction: "retry with a resolvable public host",
        });
    }
    // An empty answer proves nothing about the host: fail closed instead of
    // letting the loop over zero addresses pass and the fetch proceed.
    if (resolved.length === 0) {
        throw new errors_js_1.GscError("UPSTREAM_ERROR", "cannot verify host is public", {
            suggestedAction: "retry with a resolvable public host",
        });
    }
    for (const address of resolved) {
        if (isPrivateLiteral(address)) {
            throw new errors_js_1.GscError("UPSTREAM_ERROR", `blocked private host: ${hostname}`, {
                suggestedAction: "pass a URL on a public host",
            });
        }
    }
}
// Fetch with a public-host policy and manual redirect handling. Every hop is
// revalidated with assertPublicUrl plus the optional allowUrl predicate;
// more than maxRedirects hops fails closed.
async function guardedFetch(url, opts = {}) {
    const resolveHost = opts.resolveHost ?? exports.defaultResolveHost;
    const maxRedirects = opts.maxRedirects ?? 5;
    const headers = opts.headers ?? {};
    const timeoutMs = opts.timeoutMs;
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        await assertPublicUrl(current, resolveHost);
        if (opts.allowUrl && !opts.allowUrl(current)) {
            throw new errors_js_1.GscError("PROPERTY_NOT_ALLOWED", `"${current}" is not in this instance's allowlist. Change the instance profile explicitly.`, { suggestedAction: "serve with a profile that includes the property, or add it to GSC_SITE_URLS" });
        }
        const controller = new AbortController();
        const timer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
        let response;
        try {
            response = await globalThis.fetch(current, {
                headers,
                redirect: "manual",
                signal: controller.signal,
            });
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
        const location = response.headers.get("location");
        if (location && [301, 302, 303, 307, 308].includes(response.status)) {
            if (hop >= maxRedirects) {
                throw new errors_js_1.GscError("UPSTREAM_ERROR", "too many redirects", {
                    suggestedAction: "pass a URL that resolves within 5 redirects",
                });
            }
            current = new URL(location, current).href;
            continue;
        }
        return { response, finalUrl: current };
    }
    throw new errors_js_1.GscError("UPSTREAM_ERROR", "too many redirects", {
        suggestedAction: "pass a URL that resolves within 5 redirects",
    });
}
// Incrementally reads a response body with byte and body-phase time bounds.
// Content-Length is an early-rejection hint only; streamed accounting enforces
// the cap even when the declaration is missing, malformed, or understated.
async function readBoundedBody(response, opts) {
    const body = response.body;
    if (body === null)
        return Buffer.alloc(0);
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > 0 && declared > opts.maxBytes) {
        try {
            if (body.locked) {
                const lockedReader = body.getReader();
                const pending = lockedReader.cancel();
                if (pending instanceof Promise)
                    pending.catch(() => { });
            }
            else {
                const pending = body.cancel();
                if (pending instanceof Promise)
                    pending.catch(() => { });
            }
        }
        catch {
            // Best-effort cancellation only.
        }
        throw new errors_js_1.GscError("UPSTREAM_ERROR", `body exceeded ${opts.maxBytes} bytes`);
    }
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers();
    const timer = setTimeout(() => {
        rejectTimeout(new errors_js_1.GscError("UPSTREAM_TIMEOUT", `body read exceeded ${opts.timeoutMs}ms`, { retryable: true }));
    }, opts.timeoutMs);
    const cancelReader = () => {
        try {
            const p = reader.cancel();
            if (p instanceof Promise)
                p.catch(() => { });
        }
        catch {
            // Best-effort cancellation only.
        }
    };
    const readLoop = (async () => {
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value.byteLength === 0)
                    continue;
                if (total + value.byteLength > opts.maxBytes) {
                    try {
                        const pending = reader.cancel();
                        if (pending instanceof Promise)
                            pending.catch(() => { });
                    }
                    catch {
                        // Best-effort cancellation only.
                    }
                    throw new errors_js_1.GscError("UPSTREAM_ERROR", `body exceeded ${opts.maxBytes} bytes`);
                }
                chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                total += value.byteLength;
            }
            return Buffer.concat(chunks, total);
        }
        finally {
            clearTimeout(timer);
            try {
                reader.releaseLock();
            }
            catch {
                // Suppressed so cleanup cannot mask the primary outcome.
            }
        }
    })();
    try {
        return await Promise.race([readLoop, timeoutPromise]);
    }
    catch (err) {
        clearTimeout(timer);
        cancelReader();
        throw err;
    }
}
