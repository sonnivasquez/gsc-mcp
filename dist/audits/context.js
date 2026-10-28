"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditContext = void 0;
exports.integer = integer;
exports.pageUrl = pageUrl;
exports.period = period;
exports.message = message;
const auth_provider_js_1 = require("../auth-provider.js");
const profiles_js_1 = require("../profiles.js");
const client_js_1 = require("../gsc/client.js");
const budget_js_1 = require("../gsc/budget.js");
const errors_js_1 = require("../gsc/errors.js");
const periods_js_1 = require("../gsc/periods.js");
function integer(value, fallback, max, name, min = 1) {
    const n = value ?? fallback;
    if (!Number.isInteger(n) || n < min || n > max)
        throw new errors_js_1.GscError("INVALID_ARGUMENT", `${name} must be ${min}..${max}`);
    return n;
}
function pageUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid absolute URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "only public http(s) URLs without credentials are supported");
    url.hash = "";
    return url.href;
}
function period(input) {
    return (0, periods_js_1.resolvePeriods)(input.preset || input.startDate || input.endDate ? input : { preset: "last_28_days" }).current;
}
function message(err) { return err instanceof Error ? err.message : String(err); }
class AuditContext {
    sites;
    deps;
    deadline;
    signal;
    budget;
    ds;
    alias;
    allowlist;
    warnings = [];
    sources = [];
    constructor(sites, deps = {}) {
        this.sites = sites;
        this.deps = deps;
        this.alias = deps.profileAlias ?? (0, profiles_js_1.getInstanceAlias)() ?? "default(env)";
        this.allowlist = deps.allowlist === undefined ? (0, profiles_js_1.getInstanceAllowlist)() : deps.allowlist;
        this.deadline = Date.now() + Math.min(deps.deadlineMs ?? 60000, 60000);
        this.signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(Math.max(1, this.deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, this.deadline - Date.now()));
        this.budget = deps.budget ?? new budget_js_1.RequestBudget();
        for (const site of sites) {
            if (!(site.startsWith("sc-domain:") ? /^sc-domain:[a-z0-9.-]+$/i.test(site) : /^https?:\/\//.test(site)))
                throw new errors_js_1.GscError("INVALID_ARGUMENT", "invalid property identifier");
            if (this.allowlist !== null && !(0, profiles_js_1.isAllowAllAllowlist)(this.allowlist) && !this.allowlist.includes(site))
                throw (0, errors_js_1.propertyNotAllowed)(site, this.allowlist.length);
        }
        this.ds = new client_js_1.FetchGscDataSource(deps.provider ?? (0, auth_provider_js_1.getAuthProvider)(), { budget: this.budget, fetchImpl: deps.fetchImpl, allowlist: this.allowlist, deadline: this.deadline, signal: this.signal });
    }
    async authorize() {
        // An all-properties profile still grants website access only to actual GSC properties.
        if ((0, profiles_js_1.isAllowAllAllowlist)(this.allowlist)) {
            const visible = await this.ds.listSites();
            for (const site of this.sites)
                if (!visible.some((s) => s.siteUrl === site))
                    throw new errors_js_1.GscError("PROPERTY_PERMISSION_DENIED", "property is not visible to this account");
        }
    }
    accepts(raw, sites = this.sites) {
        try {
            const url = pageUrl(raw);
            return (0, profiles_js_1.isPageUrlAllowedByAllowlist)(url, sites);
        }
        catch {
            return false;
        }
    }
    url(raw, site) {
        const url = pageUrl(raw);
        if (!this.accepts(url, site ? [site] : this.sites))
            throw (0, errors_js_1.propertyNotAllowed)(url, this.sites.length);
        return url;
    }
    remaining() {
        if (this.signal.aborted || Date.now() >= this.deadline)
            throw new errors_js_1.GscError(this.deps.signal?.aborted ? "CANCELLED" : "REQUEST_BUDGET_EXCEEDED", "call stopped; request the next batch explicitly");
        return this.deadline - Date.now();
    }
    canContinue() { return !this.signal.aborted && Date.now() < this.deadline && this.budget.attemptsUsed < 12; }
    warn(code, msg) { this.warnings.push({ code, message: msg }); }
    source(source, siteUrl) {
        if (this.sources.length < 20)
            this.sources.push({ source, siteUrl, fetchedAt: new Date().toISOString() });
    }
}
exports.AuditContext = AuditContext;
