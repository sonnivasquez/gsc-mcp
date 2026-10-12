"use strict";
// Exact property-allowlist selection for the guided setup flow.
// Google identifiers are opaque strings: selection only copies them
// byte-for-byte and never normalizes case, prefixes, or trailing slashes.
// Each repeatable --site flag is already one identifier boundary: values are
// never comma-split, so a comma inside an http(s) URL-prefix property
// round-trips exactly. Accepted Google forms are `sc-domain:` or an
// `http://`/`https://` URL prefix; anything else fails closed.
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
exports.ALLOW_ALL_WARNING = exports.MIXED_ALLOW_ALL_ERROR = exports.ALLOW_ALL_TOKEN = void 0;
exports.isAllowAllToken = isAllowAllToken;
exports.isAllowAllFutureAnswer = isAllowAllFutureAnswer;
exports.isPropertyIdentifier = isPropertyIdentifier;
exports.parseSiteFlags = parseSiteFlags;
exports.validateAllowlist = validateAllowlist;
exports.parsePropertySelectionAnswer = parsePropertySelectionAnswer;
exports.selectProperties = selectProperties;
const net = __importStar(require("node:net"));
/**
 * Explicit allow-all sentinel for current + future properties.
 * GSC_SITE_URLS exactly `all` (bare) or JSON `["all"]` (sole entry,
 * case-insensitive, whitespace-tolerant) means every Search Console
 * property visible to the credential, including future ones. Mixed `all`
 * with explicit identifiers is invalid and fails closed.
 * Defined here (shape-rule owner) so profiles.ts can import it without a
 * cycle: profiles -> properties is the single direction.
 */
exports.ALLOW_ALL_TOKEN = "all";
/**
 * True for the allow-all sentinel (case-insensitive, whitespace-tolerant).
 * Only the bare token counts: surrounding whitespace is ignored, but any
 * other content rejects.
 */
function isAllowAllToken(value) {
    return typeof value === "string" && value.trim().toLowerCase() === exports.ALLOW_ALL_TOKEN;
}
/** Actionable failure for mixed `all` plus explicit identifiers. */
exports.MIXED_ALLOW_ALL_ERROR = 'GSC_SITE_URLS mixes "all" with explicit properties: use either "all" alone for every current and future property, or an explicit allowlist without "all".';
/**
 * Interactive sentinel choice for the setup wizard: `0` or bare `all`
 * selects all current + future properties (explicit opt-in,
 * double-confirmed). Accepted case-insensitively with surrounding
 * whitespace tolerated. `0` exists so non-technical users never need to
 * guess a keyword; `all` matches the `--site all` spelling.
 */
function isAllowAllFutureAnswer(answer) {
    const normalized = answer.trim().toLowerCase();
    return normalized === "0" || normalized === "all";
}
/** Strong warning shown before the allow-all confirmation. */
exports.ALLOW_ALL_WARNING = 'Warning: "All current + future sites" lets this agent query ANY current or future Search Console property visible to the credential ' +
    "(agent may query any current/future property). An explicit allowlist is preferred; use allow-all only if you understand the scope. " +
    "Future properties are included automatically.";
/** Domain-style hostname: nonempty dot-separated labels (RFC 1035 shape). */
function isDomainHostname(host) {
    const name = host.endsWith(".") ? host.slice(0, -1) : host;
    if (name.length === 0 || name.length > 253)
        return false;
    for (const label of name.split(".")) {
        if (label.length === 0 || label.length > 63)
            return false;
        if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))
            return false;
    }
    return true;
}
/**
 * True for the accepted Google property forms. Shared single shape rule for
 * the setup writer and the centralized profiles/auth/doctor readers: one
 * predicate, no divergent shape rules.
 * - Any whitespace anywhere rejects (identifiers never contain it).
 * - `sc-domain:` requires a nonempty valid domain-style hostname.
 * - `http(s)://` must URL-parse and its host must be a valid domain-style
 *   hostname or a legitimate IP literal (IPv4/IPv6). WHATWG parsing alone
 *   accepts invalid DNS labels (underscores, edge hyphens), so the same
 *   label rule applies to URL hosts. Ports, paths, queries, case, commas,
 *   and trailing slashes never affect the verdict.
 * Accepted values keep their exact original string: case, trailing slashes,
 * ports, paths, and commas inside URL-prefix properties all survive.
 * Only the documented Google prefixes are accepted; nothing else is excluded
 * beyond malformed hosts and whitespace.
 */
function isPropertyIdentifier(value) {
    if (typeof value !== "string" || value.length === 0)
        return false;
    if (/\s/.test(value))
        return false;
    if (value.startsWith("sc-domain:")) {
        return isDomainHostname(value.slice("sc-domain:".length));
    }
    if (value.startsWith("https://") || value.startsWith("http://")) {
        let hostname;
        try {
            const url = new URL(value);
            if (url.protocol !== "http:" && url.protocol !== "https:")
                return false;
            hostname = url.hostname;
        }
        catch {
            return false;
        }
        if (hostname.length === 0)
            return false;
        // Bracketed IPv6 literal: strip brackets before the IP check.
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
            return net.isIP(hostname.slice(1, -1)) === 6;
        }
        if (net.isIP(hostname) !== 0)
            return true;
        // Same DNS-label rule as sc-domain (covers localhost as one valid label).
        return isDomainHostname(hostname);
    }
    return false;
}
/**
 * Validate repeatable --site flag values. Each flag is one exact identifier:
 * preserved byte-for-byte with no trimming or comma splitting, except the
 * explicit allow-all sentinel `--site all` (case-insensitive) which is
 * normalized to the canonical `"all"`. Rejects empty/whitespace-only and
 * structurally invalid flags instead of silently dropping or fixing them.
 * Mixed `all` with explicit identifiers fails closed with an actionable
 * message; use either `all` alone or an explicit allowlist without `all`.
 */
function parseSiteFlags(rawValues) {
    const out = [];
    for (const raw of rawValues) {
        if (typeof raw !== "string" || raw.length === 0 || raw.trim().length === 0) {
            throw new Error("Invalid --site value: property must not be empty. Use sc-domain:... or an http(s):// URL.");
        }
        // Explicit allow-all sentinel for non-interactive setup (`--site all`):
        // case-insensitive, normalized to canonical "all" so the stored
        // GSC_SITE_URLS stays exact (`["all"]`). Mixed use is rejected below.
        if (isAllowAllToken(raw)) {
            out.push(exports.ALLOW_ALL_TOKEN);
            continue;
        }
        if (!isPropertyIdentifier(raw)) {
            // No input echo: the rejected value may hold sensitive text.
            throw new Error("Invalid --site value. Use sc-domain:... or an http(s):// URL.");
        }
        out.push(raw);
    }
    if (out.length > 1 && out.some((entry) => isAllowAllToken(entry))) {
        throw new Error(exports.MIXED_ALLOW_ALL_ERROR);
    }
    return out;
}
/**
 * Fail-closed allowlist validation: non-empty, no blanks, valid shapes.
 * The sole `all` entry (case-insensitive, whitespace-tolerant) selects all
 * current + future properties and is normalized to canonical `"all"`.
 * Mixed `all` with explicit identifiers fails closed with an actionable
 * message.
 */
function validateAllowlist(sites) {
    if (sites.length === 0)
        throw new Error("A dashboard property is required");
    if (sites.length === 1 && isAllowAllToken(sites[0]))
        return [exports.ALLOW_ALL_TOKEN];
    if (sites.some((site) => isAllowAllToken(site))) {
        throw new Error(exports.MIXED_ALLOW_ALL_ERROR);
    }
    for (const site of sites) {
        if (typeof site !== "string" || site.trim().length === 0) {
            throw new Error("A dashboard property is required");
        }
        if (!isPropertyIdentifier(site)) {
            // No input echo: the rejected value may hold sensitive text.
            throw new Error("Invalid property. Use sc-domain:... or an http(s):// URL.");
        }
    }
    return [...sites];
}
/**
 * Parse one interactive property answer against the exact fetched list.
 * - "" (Enter) selects the default single property ([1], least privilege).
 * - "0" or "all" selects all current + future properties as the `all`
 *   sentinel (explicit opt-in; the caller double-confirms before storing).
 * - Otherwise a comma/space-separated list of 1-based indices.
 * Throws on any out-of-range, mixed-`0`, or non-numeric token; never guesses.
 */
function parsePropertySelectionAnswer(answer, properties, defaultIndex = 0) {
    if (properties.length === 0)
        throw new Error("No Search Console properties available");
    if (defaultIndex < 0 || defaultIndex >= properties.length) {
        throw new Error("Invalid setup choice");
    }
    const trimmed = answer.trim();
    if (trimmed === "")
        return [properties[defaultIndex]];
    if (trimmed === "0" || trimmed.toLowerCase() === "all")
        return ["all"];
    const tokens = trimmed.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
    if (tokens.length === 0)
        return [properties[defaultIndex]];
    if (tokens.some((t) => t === "0")) {
        throw new Error(`Invalid property selection: use "0" alone for all current + future properties.`);
    }
    const picked = [];
    const seen = new Set();
    for (const token of tokens) {
        // No input echo: the rejected token may hold sensitive text.
        if (!/^\d+$/.test(token))
            throw new Error(`Invalid property selection: use numbers like 0,1,3 or "all".`);
        const index = Number(token) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= properties.length) {
            throw new Error(`Invalid property selection: choose 0-${properties.length} or "all".`);
        }
        if (!seen.has(index)) {
            seen.add(index);
            picked.push(properties[index]);
        }
    }
    if (picked.length === 0)
        throw new Error("A dashboard property is required");
    return picked;
}
/**
 * Deterministic property resolution shared by interactive and
 * non-interactive setup. requested/fetched entries are already exact;
 * this function only selects, never rewrites identifiers.
 */
function selectProperties(opts) {
    if (opts.allSites && opts.requested.length > 0) {
        throw new Error("Use either repeatable --site or --all-sites, not both.");
    }
    if (opts.allSites)
        return [...opts.fetched];
    if (opts.requested.length > 0)
        return [...opts.requested];
    if (opts.interactiveAnswer !== undefined) {
        return parsePropertySelectionAnswer(opts.interactiveAnswer, opts.fetched, opts.defaultIndex ?? 0);
    }
    if (opts.fetched.length === 0)
        throw new Error("A dashboard property is required");
    return [opts.fetched[opts.defaultIndex ?? 0]];
}
