"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebReader = void 0;
exports.normalized = normalized;
exports.pageFindings = pageFindings;
const node_html_parser_1 = require("node-html-parser");
const robots_parser_1 = __importDefault(require("robots-parser"));
const fetch_guard_js_1 = require("../fetch-guard.js");
const errors_js_1 = require("../gsc/errors.js");
const context_js_1 = require("./context.js");
const USER_AGENT = "gsc-mcp";
class WebReader {
    ctx;
    robots = new Map();
    constructor(ctx) {
        this.ctx = ctx;
    }
    async fetch(raw, maxBytes = 2 * 1024 * 1024, robotsResource = false, automatic = false) {
        this.ctx.remaining();
        const url = (0, context_js_1.pageUrl)(raw);
        if (!robotsResource)
            this.ctx.url(url);
        const redirects = [];
        const origin = new URL(url).origin;
        const { response, finalUrl } = await (0, fetch_guard_js_1.guardedFetch)(url, {
            resolveHost: this.ctx.deps.resolveHost, fetchImpl: this.ctx.deps.fetchImpl,
            signal: this.ctx.signal, timeoutMs: Math.min(15000, this.ctx.remaining()), maxRedirects: 5,
            headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xml,text/xml,text/plain,*/*;q=0.5" },
            allowUrl: (u) => robotsResource ? new URL(u).origin === origin : this.ctx.accepts(u),
            beforeRequest: automatic ? async (u) => { if (!await this.allowed(u))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "ROBOTS_DISALLOWED: redirect target skipped"); } : undefined,
            onRedirect: (from, to, status) => { redirects.push({ from, to, status }); },
        });
        const bytes = await (0, fetch_guard_js_1.readBoundedBody)(response, { maxBytes, timeoutMs: Math.min(15000, this.ctx.remaining()) });
        this.ctx.source("website_fetch", finalUrl);
        return { response, finalUrl, redirects, bytes };
    }
    async allowed(raw) {
        const url = this.ctx.url(raw);
        const origin = new URL(url).origin;
        let rules = this.robots.get(origin);
        if (!rules) {
            const robotsUrl = `${origin}/robots.txt`;
            const result = await this.fetch(robotsUrl, 512 * 1024, true);
            if (result.response.status === 404 || result.response.status === 410)
                rules = (0, robots_parser_1.default)(robotsUrl, "");
            else if (result.response.ok)
                rules = (0, robots_parser_1.default)(robotsUrl, result.bytes.toString("utf8"));
            else
                throw new errors_js_1.GscError("UPSTREAM_ERROR", "robots.txt unavailable; automatic traversal stopped");
            this.robots.set(origin, rules);
        }
        return rules.isAllowed(url, USER_AGENT) !== false;
    }
    async page(raw, automatic = false) {
        if (automatic && !(await this.allowed(raw)))
            throw new errors_js_1.GscError("INVALID_ARGUMENT", "ROBOTS_DISALLOWED: traversal skipped");
        const result = await this.fetch(raw, 2 * 1024 * 1024, false, automatic);
        const type = result.response.headers.get("content-type") ?? "unknown";
        const evidence = {
            url: (0, context_js_1.pageUrl)(raw), finalUrl: result.finalUrl, status: result.response.status, redirects: result.redirects,
            fetchedAt: new Date().toISOString(), contentType: type, titles: [], descriptions: [], h1: [], headings: [], canonicals: [],
            robots: [], xRobotsTag: result.response.headers.get("x-robots-tag"), text: "", links: [], javascriptContentUnknown: true,
        };
        if (!/html/i.test(type))
            return evidence;
        const root = (0, node_html_parser_1.parse)(result.bytes.toString("utf8"));
        const clean = (s) => s.replace(/\s+/g, " ").trim();
        const texts = (selector) => root.querySelectorAll(selector).map((el) => clean(el.textContent).slice(0, 2000));
        evidence.titles = texts("title");
        evidence.h1 = texts("h1");
        evidence.headings = texts("h2,h3");
        const baseHref = root.querySelector("base[href]")?.getAttribute("href");
        let base = result.finalUrl;
        try {
            if (baseHref)
                base = new URL(baseHref, base).href;
        }
        catch { /* malformed base: retain document URL */ }
        for (const meta of root.querySelectorAll("meta")) {
            const name = meta.getAttribute("name")?.toLowerCase();
            const content = meta.getAttribute("content") ?? "";
            if (name === "description")
                evidence.descriptions.push(content.slice(0, 2000));
            if (name === "robots" || name === "googlebot")
                evidence.robots.push(`${name}: ${content}`);
        }
        for (const link of root.querySelectorAll("link[href]")) {
            if ((link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
                try {
                    evidence.canonicals.push(new URL(link.getAttribute("href"), base).href);
                }
                catch {
                    evidence.canonicals.push("INVALID");
                }
            }
        }
        for (const a of root.querySelectorAll("a[href]")) {
            let target;
            try {
                target = (0, context_js_1.pageUrl)(new URL(a.getAttribute("href"), base).href);
            }
            catch {
                continue;
            }
            let parent = a.parentNode;
            let navigation = false;
            while (parent) {
                if (["NAV", "HEADER", "FOOTER", "ASIDE"].includes(parent.tagName))
                    navigation = true;
                parent = parent.parentNode;
            }
            evidence.links.push({ url: target, anchor: clean(a.textContent).slice(0, 300), rel: (a.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean), zone: navigation ? "navigation" : "content" });
            if (evidence.links.length >= 10000) {
                this.ctx.warn("LINKS_TRUNCATED", "Page has more than 10000 links");
                break;
            }
        }
        const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
        for (const el of main.querySelectorAll("script,style,noscript,template,nav,header,footer,aside,[hidden],[aria-hidden=true]"))
            el.remove();
        evidence.text = clean(main.textContent).slice(0, 100000);
        return evidence;
    }
}
exports.WebReader = WebReader;
function normalized(text) { return text.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim(); }
// Headers may combine multiple fields into one comma-separated value. A crawler
// prefix applies to its following rules until another crawler prefix appears.
function robotsRules(p) {
    const rules = new Set();
    const add = (part) => {
        const token = part.trim().toLowerCase();
        if (token === "index" || token === "noindex" || token === "none")
            rules.add(token);
    };
    for (const meta of p.robots) {
        const colon = meta.indexOf(":");
        if (colon >= 0)
            for (const part of meta.slice(colon + 1).split(","))
                add(part);
    }
    let applies = true;
    for (const part of (p.xRobotsTag ?? "").split(",")) {
        const scoped = part.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
        if (scoped && !["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"].includes(scoped[1].toLowerCase())) {
            applies = scoped[1].toLowerCase() === "googlebot";
            if (applies)
                add(scoped[2]);
        }
        else if (applies)
            add(part);
    }
    return rules;
}
function pageFindings(p) {
    const out = [];
    const add = (code, priority, evidence) => out.push({ code, priority, evidence, ruleVersion: "audit.1" });
    if (p.status >= 400)
        add("HTTP_ERROR", "high", p.status);
    if (p.redirects.length)
        add("REDIRECTED", "review", p.redirects);
    const directives = [...p.robots, p.xRobotsTag ?? ""].join(",");
    const rules = robotsRules(p);
    const noindex = rules.has("noindex") || rules.has("none");
    if (noindex)
        add("NOINDEX", "high", directives);
    if (noindex && rules.has("index"))
        add("ROBOTS_CONFLICT", "review", directives);
    if (!/html/i.test(p.contentType)) {
        add("NON_HTML", "review", p.contentType);
        return out;
    }
    for (const [name, values] of [["TITLE", p.titles], ["DESCRIPTION", p.descriptions], ["H1", p.h1]]) {
        if (!values.length || values.every((x) => !x.trim()))
            add(`${name}_MISSING_OR_EMPTY`, "review", values);
        if (values.length > 1)
            add(`${name}_MULTIPLE`, "review", values);
    }
    if (!p.canonicals.length)
        add("CANONICAL_MISSING", "review", []);
    if (p.canonicals.length > 1)
        add("CANONICAL_MULTIPLE", "medium", p.canonicals);
    if (p.canonicals.some((u) => u === "INVALID" || !/^https?:\/\//i.test(u)))
        add("CANONICAL_INVALID", "medium", p.canonicals);
    if (p.canonicals.some((u) => u !== p.finalUrl))
        add("CANONICAL_OTHER_URL", "review", p.canonicals);
    return out;
}
