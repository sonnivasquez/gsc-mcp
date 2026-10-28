import { SaxesParser } from "saxes";
import { gunzipSync } from "node:zlib";
import { GscError } from "../gsc/errors.js";
import { WebReader } from "./web.js";
import { message } from "./context.js";

export interface SitemapEntry { url: string; sitemap: string; lastmod: string | null }
export interface Discovery {
  queue: string[]; visited: string[]; entries: SitemapEntry[]; failures: Array<{ url: string; error: string }>;
  capped: boolean;
}
export function discovery(roots: string[] = []): Discovery { return { queue: [...new Set(roots)], visited: [], entries: [], failures: [], capped: false }; }
export function parseSitemap(xml: string, source: string): { sitemaps: string[]; entries: SitemapEntry[] } {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = []; let root = ""; let loc = ""; let lastmod = "";
  const result: { sitemaps: string[]; entries: SitemapEntry[] } = { sitemaps: [], entries: [] };
  parser.on("doctype", () => { throw new GscError("INVALID_ARGUMENT", "XML document types and entities are not allowed"); });
  parser.on("error", (err) => { throw new GscError("INVALID_ARGUMENT", `invalid sitemap XML: ${err.message.slice(0, 160)}`); });
  parser.on("opentag", (tag) => {
    stack.push(tag.local);
    if (stack.length === 1) { root = tag.local; if (!["urlset", "sitemapindex"].includes(root)) throw new GscError("INVALID_ARGUMENT", "not a sitemap XML document"); }
    if (stack.length === 2) { loc = ""; lastmod = ""; }
  });
  const text = (value: string) => { if (stack.length === 3 && stack[2] === "loc") loc += value; if (stack.length === 3 && stack[2] === "lastmod") lastmod += value; };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", () => {
    if (stack.length === 2 && loc.trim()) {
      if (root === "sitemapindex" && stack[1] === "sitemap") result.sitemaps.push(loc.trim());
      if (root === "urlset" && stack[1] === "url") result.entries.push({ url: loc.trim(), sitemap: source, lastmod: lastmod.trim() || null });
      if (result.entries.length + result.sitemaps.length > 10000) throw new GscError("REQUEST_BUDGET_EXCEEDED", "sitemap exceeds 10000 entries; supply smaller child sitemaps or explicit URLs");
    }
    stack.pop();
  });
  parser.write(xml).close();
  return result;
}
export async function discoverBatch(state: Discovery, web: WebReader): Promise<void> {
  let files = 0; let bytes = 0;
  const known = new Set(state.entries.map((e) => e.url));
  while (state.queue.length && files < 10 && web.ctx.canContinue() && !state.capped) {
    const raw = state.queue[0];
    const remainingBytes = Math.max(1, 50 * 1024 * 1024 - bytes);
    if (state.visited.includes(raw)) { state.queue.shift(); continue; }
    try {
      if (!await web.allowed(raw)) throw new GscError("INVALID_ARGUMENT", "ROBOTS_DISALLOWED: sitemap skipped");
      const downloaded = await web.fetch(raw, remainingBytes);
      if (!downloaded.response.ok) throw new GscError("UPSTREAM_ERROR", `sitemap HTTP ${downloaded.response.status}`);
      let data = downloaded.bytes;
      if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data, { maxOutputLength: remainingBytes });
      bytes += data.byteLength;
      const parsed = parseSitemap(data.toString("utf8"), downloaded.finalUrl);
      for (const url of parsed.sitemaps) {
        try {
          const child = web.ctx.url(url);
          if (!state.visited.includes(child) && !state.queue.includes(child)) state.queue.push(child);
        } catch { state.failures.push({ url: url.slice(0, 2048), error: "URL outside declared property" }); }
      }
      for (const e of parsed.entries) {
        try { e.url = web.ctx.url(e.url); } catch { state.failures.push({ url: e.url.slice(0, 2048), error: "URL outside declared property" }); continue; }
        if (!known.has(e.url)) { known.add(e.url); state.entries.push(e); }
        if (state.entries.length >= 10000) { state.capped = true; break; }
      }
    } catch (err) {
      if (!web.ctx.canContinue()) break;
      // A resource that exceeds the remaining allowance may fit in a fresh call.
      // Retry only when earlier resources consumed bytes, so an oversized single
      // resource becomes a terminal failure instead of an endless continuation.
      const limitExceeded = (err instanceof GscError && err.code === "UPSTREAM_ERROR" && err.message === `UPSTREAM_ERROR: body exceeded ${remainingBytes} bytes`)
        || (err instanceof Error && "code" in err && err.code === "ERR_BUFFER_TOO_LARGE");
      if (bytes > 0 && limitExceeded) break;
      state.failures.push({ url: raw, error: message(err) });
    }
    state.visited.push(raw); state.queue.shift(); files++;
    if (bytes >= 50 * 1024 * 1024) break;
  }
  if (state.capped) web.ctx.warn("DISCOVERY_LIMIT", "10000 discovered URLs reached; remaining sitemaps were not traversed");
}
