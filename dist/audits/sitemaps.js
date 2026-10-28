"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discovery = discovery;
exports.parseSitemap = parseSitemap;
exports.discoverBatch = discoverBatch;
const saxes_1 = require("saxes");
const node_zlib_1 = require("node:zlib");
const errors_js_1 = require("../gsc/errors.js");
const context_js_1 = require("./context.js");
function discovery(roots = []) { return { queue: [...new Set(roots)], visited: [], entries: [], failures: [], capped: false }; }
function parseSitemap(xml, source) {
    const parser = new saxes_1.SaxesParser({ xmlns: true });
    const stack = [];
    let root = "";
    let loc = "";
    let lastmod = "";
    const result = { sitemaps: [], entries: [] };
    parser.on("doctype", () => { throw new errors_js_1.GscError("INVALID_ARGUMENT", "XML document types and entities are not allowed"); });
    parser.on("error", (err) => { throw new errors_js_1.GscError("INVALID_ARGUMENT", `invalid sitemap XML: ${err.message.slice(0, 160)}`); });
    parser.on("opentag", (tag) => {
        stack.push(tag.local);
        if (stack.length === 1) {
            root = tag.local;
            if (!["urlset", "sitemapindex"].includes(root))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "not a sitemap XML document");
        }
        if (stack.length === 2) {
            loc = "";
            lastmod = "";
        }
    });
    const text = (value) => { if (stack.length === 3 && stack[2] === "loc")
        loc += value; if (stack.length === 3 && stack[2] === "lastmod")
        lastmod += value; };
    parser.on("text", text);
    parser.on("cdata", text);
    parser.on("closetag", () => {
        if (stack.length === 2 && loc.trim()) {
            if (root === "sitemapindex" && stack[1] === "sitemap")
                result.sitemaps.push(loc.trim());
            if (root === "urlset" && stack[1] === "url")
                result.entries.push({ url: loc.trim(), sitemap: source, lastmod: lastmod.trim() || null });
            if (result.entries.length + result.sitemaps.length > 10000)
                throw new errors_js_1.GscError("REQUEST_BUDGET_EXCEEDED", "sitemap exceeds 10000 entries; supply smaller child sitemaps or explicit URLs");
        }
        stack.pop();
    });
    parser.write(xml).close();
    return result;
}
async function discoverBatch(state, web) {
    let files = 0;
    let bytes = 0;
    const known = new Set(state.entries.map((e) => e.url));
    while (state.queue.length && files < 10 && web.ctx.canContinue() && !state.capped) {
        const raw = state.queue[0];
        const remainingBytes = Math.max(1, 50 * 1024 * 1024 - bytes);
        if (state.visited.includes(raw)) {
            state.queue.shift();
            continue;
        }
        try {
            if (!await web.allowed(raw))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "ROBOTS_DISALLOWED: sitemap skipped");
            const downloaded = await web.fetch(raw, remainingBytes);
            if (!downloaded.response.ok)
                throw new errors_js_1.GscError("UPSTREAM_ERROR", `sitemap HTTP ${downloaded.response.status}`);
            let data = downloaded.bytes;
            if (data[0] === 0x1f && data[1] === 0x8b)
                data = (0, node_zlib_1.gunzipSync)(data, { maxOutputLength: remainingBytes });
            bytes += data.byteLength;
            const parsed = parseSitemap(data.toString("utf8"), downloaded.finalUrl);
            for (const url of parsed.sitemaps) {
                try {
                    const child = web.ctx.url(url);
                    if (!state.visited.includes(child) && !state.queue.includes(child))
                        state.queue.push(child);
                }
                catch {
                    state.failures.push({ url: url.slice(0, 2048), error: "URL outside declared property" });
                }
            }
            for (const e of parsed.entries) {
                try {
                    e.url = web.ctx.url(e.url);
                }
                catch {
                    state.failures.push({ url: e.url.slice(0, 2048), error: "URL outside declared property" });
                    continue;
                }
                if (!known.has(e.url)) {
                    known.add(e.url);
                    state.entries.push(e);
                }
                if (state.entries.length >= 10000) {
                    state.capped = true;
                    break;
                }
            }
        }
        catch (err) {
            if (!web.ctx.canContinue())
                break;
            // A resource that exceeds the remaining allowance may fit in a fresh call.
            // Retry only when earlier resources consumed bytes, so an oversized single
            // resource becomes a terminal failure instead of an endless continuation.
            const limitExceeded = (err instanceof errors_js_1.GscError && err.code === "UPSTREAM_ERROR" && err.message === `UPSTREAM_ERROR: body exceeded ${remainingBytes} bytes`)
                || (err instanceof Error && "code" in err && err.code === "ERR_BUFFER_TOO_LARGE");
            if (bytes > 0 && limitExceeded)
                break;
            state.failures.push({ url: raw, error: (0, context_js_1.message)(err) });
        }
        state.visited.push(raw);
        state.queue.shift();
        files++;
        if (bytes >= 50 * 1024 * 1024)
            break;
    }
    if (state.capped)
        web.ctx.warn("DISCOVERY_LIMIT", "10000 discovered URLs reached; remaining sitemaps were not traversed");
}
