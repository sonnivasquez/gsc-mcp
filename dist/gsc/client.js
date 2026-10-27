"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FetchGscDataSource = void 0;
const zod_1 = require("zod");
const profiles_js_1 = require("../profiles.js");
const budget_js_1 = require("./budget.js");
const analytics_rules_js_1 = require("./analytics-rules.js");
const errors_js_1 = require("./errors.js");
const WEBMASTERS = "https://www.googleapis.com/webmasters/v3/sites";
const INSPECTION = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const MAX_PAGE = 25_000;
// Provider responses are parsed once, here, with zod. Parse failures carry
// field paths only — never received values, which may hold user queries.
const AnalyticsRowSchema = zod_1.z.object({
    keys: zod_1.z.array(zod_1.z.string()).default([]),
    clicks: zod_1.z.coerce.number(),
    impressions: zod_1.z.coerce.number(),
    ctr: zod_1.z.coerce.number(),
    position: zod_1.z.coerce.number(),
});
const SearchAnalyticsResponse = zod_1.z.object({
    rows: zod_1.z.array(AnalyticsRowSchema).default([]),
});
const SitesResponse = zod_1.z.object({
    siteEntry: zod_1.z
        .array(zod_1.z.object({ siteUrl: zod_1.z.string().default(""), permissionLevel: zod_1.z.string().default("") }))
        .default([]),
});
const SitemapsResponse = zod_1.z.object({
    sitemap: zod_1.z
        .array(zod_1.z.object({
        path: zod_1.z.string().default(""),
        lastSubmitted: zod_1.z.string().optional(),
        warnings: zod_1.z.coerce.number().default(0),
        errors: zod_1.z.coerce.number().default(0),
    }))
        .default([]),
});
function parseOrThrow(schema, body, op) {
    const parsed = schema.safeParse(body);
    if (parsed.success)
        return parsed.data;
    const paths = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new errors_js_1.GscError("UPSTREAM_SCHEMA_CHANGED", `${op} response shape changed (fields: ${paths || "root"})`);
}
function errorDetail(body) {
    if (typeof body === "object" && body !== null && "error" in body) {
        const nested = body.error;
        if (typeof nested === "object" && nested !== null && "message" in nested && typeof nested.message === "string") {
            return nested.message.slice(0, 300);
        }
    }
    return "provider error";
}
// The AuthProvider surfaces plain Errors with a CODE prefix; the envelope
// needs typed errors, so the adapter translates at its boundary.
function authFailure(err) {
    const message = err instanceof Error ? err.message : String(err);
    const expired = message.startsWith("REAUTH_REQUIRED");
    throw new errors_js_1.GscError(expired ? "AUTH_EXPIRED" : "AUTH_REQUIRED", message, {
        suggestedAction: "run `gsc auth login` in a terminal",
    });
}
// Fetch-based Search Console reader. Readonly by construction: only
// GET/POST-query endpoints exist here, and the scope tier comes from the
// provider (readonly unless explicitly full).
class FetchGscDataSource {
    provider;
    budget;
    fetchImpl;
    allowlist;
    timeoutMs;
    constructor(provider, opts = {}) {
        this.provider = provider;
        this.budget = opts.budget ?? new budget_js_1.RequestBudget();
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.allowlist = opts.allowlist ?? null;
        this.timeoutMs = opts.timeoutMs;
    }
    checkSite(siteUrl) {
        if (this.allowlist === null)
            return;
        // Explicit allow-all opt-in covers every current + future property.
        if ((0, profiles_js_1.isAllowAllAllowlist)(this.allowlist))
            return;
        if (!this.allowlist.includes(siteUrl)) {
            throw (0, errors_js_1.propertyNotAllowed)(siteUrl, this.allowlist.length);
        }
    }
    async fetchOnce(path, init, token, signal) {
        try {
            return await this.fetchImpl(path, {
                ...init,
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
                signal,
            });
        }
        catch (err) {
            (0, errors_js_1.throwForTransport)(err);
        }
    }
    async call(path, init, op) {
        let token;
        try {
            token = await this.provider.getAccessToken();
        }
        catch (err) {
            authFailure(err);
            throw new errors_js_1.GscError("AUTH_REQUIRED", "unreachable");
        }
        return this.budget.run(async (_attempt, signal) => {
            const response = await this.fetchOnce(path, init, token, signal);
            let body = null;
            try {
                body = await response.json();
            }
            catch {
                body = null;
            }
            if (!response.ok) {
                (0, errors_js_1.throwForResponse)(response.status, response.statusText, errorDetail(body), response.headers);
            }
            if (body === null) {
                throw new errors_js_1.GscError("UPSTREAM_SCHEMA_CHANGED", `${op} returned no JSON body`);
            }
            return body;
        }, { timeoutMs: this.timeoutMs });
    }
    async listSites() {
        const parsed = parseOrThrow(SitesResponse, await this.call(WEBMASTERS, { method: "GET" }, "sites.list"), "sites.list");
        return parsed.siteEntry;
    }
    async queryAnalytics(siteUrl, q) {
        this.checkSite(siteUrl);
        const pageSize = Math.min(q.rowLimit ?? MAX_PAGE, MAX_PAGE);
        const maxFetch = q.maxFetchRows ?? 5_000;
        const rows = [];
        let startRow = 0;
        let pagesFetched = 0;
        (0, analytics_rules_js_1.assertSearchAnalyticsRules)({
            dimensions: q.dimensions,
            filters: q.filters,
            searchType: q.searchType,
            aggregationType: q.aggregationType,
        });
        for (;;) {
            const payload = {
                startDate: q.startDate,
                endDate: q.endDate,
                dimensions: q.dimensions,
                // Google deprecated searchType. Tool inputs still use that name.
                type: q.searchType ?? "web",
                dataState: q.dataState ?? "final",
                rowLimit: pageSize,
                startRow,
            };
            if (q.filters?.length) {
                payload.dimensionFilterGroups = [
                    {
                        filters: q.filters.map((f) => ({
                            dimension: f.dimension,
                            operator: f.operator,
                            expression: f.expression,
                        })),
                    },
                ];
            }
            if (q.aggregationType)
                payload.aggregationType = q.aggregationType;
            const body = await this.call(`${WEBMASTERS}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
                method: "POST",
                body: JSON.stringify(payload),
            }, "searchAnalytics.query");
            const page = parseOrThrow(SearchAnalyticsResponse, body, "searchAnalytics.query").rows;
            pagesFetched++;
            const room = maxFetch - rows.length;
            if (room <= 0)
                return { rows, pagesFetched, truncated: true };
            rows.push(...page.slice(0, room));
            if (page.length < pageSize)
                return { rows, pagesFetched, truncated: false };
            if (rows.length >= maxFetch)
                return { rows, pagesFetched, truncated: true };
            startRow += pageSize;
        }
    }
    async inspectUrl(siteUrl, inspectionUrl, languageCode) {
        this.checkSite(siteUrl);
        return this.call(INSPECTION, {
            method: "POST",
            body: JSON.stringify({ inspectionUrl, siteUrl, ...(languageCode ? { languageCode } : {}) }),
        }, "urlInspection.index.inspect");
    }
    async listSitemaps(siteUrl) {
        this.checkSite(siteUrl);
        const parsed = parseOrThrow(SitemapsResponse, await this.call(`${WEBMASTERS}/${encodeURIComponent(siteUrl)}/sitemaps`, { method: "GET" }, "sitemaps.list"), "sitemaps.list");
        return parsed.sitemap.map((s) => ({
            path: s.path,
            lastSubmitted: s.lastSubmitted ?? null,
            warnings: s.warnings,
            errors: s.errors,
        }));
    }
}
exports.FetchGscDataSource = FetchGscDataSource;
