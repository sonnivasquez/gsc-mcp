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
exports.isAllowAllToken = exports.MIXED_ALLOW_ALL_ERROR = exports.ALLOW_ALL_TOKEN = void 0;
exports.isAllowAllAllowlist = isAllowAllAllowlist;
exports.dataDir = dataDir;
exports.loadProfile = loadProfile;
exports.envAllowlist = envAllowlist;
exports.initInstance = initInstance;
exports.getActiveInstanceGeneration = getActiveInstanceGeneration;
exports.setInstanceAllowlist = setInstanceAllowlist;
exports.getInstanceAllowlist = getInstanceAllowlist;
exports.getInstanceAlias = getInstanceAlias;
exports.isInstanceAllowAll = isInstanceAllowAll;
exports.isPageUrlAllowedByAllowlist = isPageUrlAllowedByAllowlist;
exports.assertSiteAllowed = assertSiteAllowed;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const properties_js_1 = require("./setup/properties.js");
Object.defineProperty(exports, "ALLOW_ALL_TOKEN", { enumerable: true, get: function () { return properties_js_1.ALLOW_ALL_TOKEN; } });
Object.defineProperty(exports, "MIXED_ALLOW_ALL_ERROR", { enumerable: true, get: function () { return properties_js_1.MIXED_ALLOW_ALL_ERROR; } });
Object.defineProperty(exports, "isAllowAllToken", { enumerable: true, get: function () { return properties_js_1.isAllowAllToken; } });
/**
 * True when an allowlist is the explicit allow-all sentinel: exactly one
 * entry equal to `all` (case-insensitive, whitespace-tolerant). Null
 * (uninitialized) is never allow-all; empty is never allow-all.
 */
function isAllowAllAllowlist(allowlist) {
    return Array.isArray(allowlist) && allowlist.length === 1 && (0, properties_js_1.isAllowAllToken)(allowlist[0]);
}
function dataDir() {
    return process.env.GSC_DATA_DIR ?? path.join(os.homedir(), ".gsc-mcp");
}
function profilePath(alias) {
    return path.join(dataDir(), "profiles", `${alias}.json`);
}
function isStringList(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.every((s) => typeof s === "string" && s.trim().length > 0));
}
// Reads and validates a stored profile. Throws with an actionable message;
// never returns a half-parsed allowlist.
function loadProfile(alias) {
    const file = profilePath(alias);
    let raw;
    try {
        raw = fs.readFileSync(file, "utf8");
    }
    catch {
        throw new Error(`Profile "${alias}" not found at ${file}. Create it with allowedSites, or serve without --profile to use GSC_SITE_URLS.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Profile "${alias}" at ${file} is not valid JSON.`);
    }
    if (typeof parsed !== "object" ||
        parsed === null ||
        parsed.version !== 1 ||
        !isStringList(parsed.allowedSites)) {
        throw new Error(`Profile "${alias}" at ${file} must be {"version":1,"allowedSites":[...non-empty strings...]}.`);
    }
    // Stored entries use the same shared predicate as every other reader:
    // structurally invalid nonempty entries fail closed instead of persisting
    // a silently unenforceable allowlist. Valid entries keep their exact bytes.
    // The sole `all` entry (any case/whitespace) is the explicit allow-all
    // sentinel for current + future properties; mixed `all` fails closed.
    const sites = parsed.allowedSites;
    if (sites.length === 1 && (0, properties_js_1.isAllowAllToken)(sites[0])) {
        return { alias, allowedSites: [properties_js_1.ALLOW_ALL_TOKEN] };
    }
    if (sites.some((site) => (0, properties_js_1.isAllowAllToken)(site))) {
        throw new Error(`Profile "${alias}" at ${file} ${properties_js_1.MIXED_ALLOW_ALL_ERROR}`);
    }
    for (const site of sites) {
        if (!(0, properties_js_1.isPropertyIdentifier)(site)) {
            throw new Error(`Profile "${alias}" at ${file} has invalid property ${JSON.stringify(site)}: use sc-domain:... or an http(s):// URL.`);
        }
    }
    return {
        alias,
        allowedSites: [...sites],
    };
}
function envAllowlist() {
    // Declared reader domain (total: every other value fails closed):
    // - the explicit allow-all sentinel `all` (bare, case-insensitive,
    //   whitespace-tolerant) or JSON `["all"]` (sole entry), meaning every
    //   current + future property visible to the credential, or
    // - a JSON array of non-empty structurally valid GSC identifiers, or
    // - legacy comma-separated entries where every entry is structurally valid.
    // Valid entries are returned byte-for-byte (legacy entries keep their
    // historical outer-whitespace trim; the sentinel normalizes to `["all"]`);
    // mixed `all` with explicit identifiers fails closed; anything else throws.
    const raw = process.env.GSC_SITE_URLS ?? "";
    if (raw.trim().length === 0)
        return [];
    const trimmed = raw.trim();
    // Bare sentinel first: exactly `all` with any case/whitespace. This must
    // precede legacy comma parsing so `all` never falls through to property
    // validation (where it would fail as an invalid identifier).
    if ((0, properties_js_1.isAllowAllToken)(trimmed))
        return [properties_js_1.ALLOW_ALL_TOKEN];
    // Any JSON-looking value (array or object) enters the JSON branch: setup
    // writes arrays, and a non-array JSON value such as {"allowedSites":[]}
    // must fail closed instead of falling through to legacy comma parsing.
    // No valid legacy identifier starts with "[" or "{".
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        // New setup writes a JSON string array so identifiers containing commas
        // survive exactly. Parse it byte-for-byte; never comma-split JSON.
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            throw new Error("GSC_SITE_URLS looks like JSON but is not valid JSON. Use a JSON string array like " +
                "'[\"sc-domain:example.com\",\"https://example.com/\"]' or a legacy comma-separated list of valid identifiers.");
        }
        if (!Array.isArray(parsed)) {
            throw new Error("GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
                "'[\"sc-domain:example.com\",\"https://example.com/\"]'.");
        }
        const out = [];
        for (const entry of parsed) {
            if (typeof entry !== "string" || entry.length === 0) {
                throw new Error("GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
                    "'[\"sc-domain:example.com\",\"https://example.com/\"]'.");
            }
            // Sentinel entries are checked before property validation: a sole
            // `all` (any case/whitespace) is allow-all; mixed `all` fails closed.
            if ((0, properties_js_1.isAllowAllToken)(entry)) {
                if (parsed.length !== 1)
                    throw new Error(properties_js_1.MIXED_ALLOW_ALL_ERROR);
                return [properties_js_1.ALLOW_ALL_TOKEN];
            }
            if (!(0, properties_js_1.isPropertyIdentifier)(entry)) {
                throw new Error(`Invalid property ${JSON.stringify(entry)} in GSC_SITE_URLS: use sc-domain:... or an http(s):// URL.`);
            }
            out.push(entry);
        }
        // A JSON array that contained only the sentinel already returned above;
        // reaching here means no sentinel was present.
        if (out.length === 0) {
            throw new Error("GSC_SITE_URLS JSON must be an array of non-empty valid property strings, e.g. " +
                "'[\"sc-domain:example.com\",\"https://example.com/\"]'.");
        }
        return out;
    }
    // Legacy comma-separated input compatibility for valid historical values.
    // Every entry must be non-empty and structurally valid: JSON scalars,
    // bare tokens, empty elements, and arbitrary garbage all fail closed.
    // A sole `all` (any case/whitespace) is the allow-all sentinel; mixed
    // `all` with explicit identifiers fails closed with an actionable message.
    const parts = raw.split(",");
    if (parts.length === 1 && (0, properties_js_1.isAllowAllToken)(parts[0]))
        return [properties_js_1.ALLOW_ALL_TOKEN];
    if (parts.some((part) => (0, properties_js_1.isAllowAllToken)(part)))
        throw new Error(properties_js_1.MIXED_ALLOW_ALL_ERROR);
    const out = [];
    for (const part of raw.split(",")) {
        const entry = part.trim();
        if (entry.length === 0) {
            throw new Error("GSC_SITE_URLS contains an empty property entry. Use a JSON string array like " +
                "'[\"sc-domain:example.com\",\"https://example.com/\"]' or a comma-separated list of valid identifiers.");
        }
        if (!(0, properties_js_1.isPropertyIdentifier)(entry)) {
            throw new Error(`Invalid property ${JSON.stringify(entry)} in GSC_SITE_URLS: use sc-domain:... or an http(s):// URL.`);
        }
        out.push(entry);
    }
    return out;
}
// Process-level allowlist. null = not initialized (tests and library use):
// enforcement is a no-op until serve startup calls initInstance.
let instanceAllowlist = null;
let instanceAlias = null;
let instanceGeneration = 0;
function initInstance(profileAlias) {
    const profile = profileAlias !== undefined && profileAlias !== ""
        ? loadProfile(profileAlias)
        : { alias: "default(env)", allowedSites: envAllowlist() };
    instanceAllowlist = profile.allowedSites;
    instanceAlias = profile.alias;
    instanceGeneration++;
    return profile;
}
function getActiveInstanceGeneration() {
    return instanceAllowlist === null || instanceGeneration === 0 ? null : instanceGeneration;
}
function setInstanceAllowlist(sites) {
    instanceAllowlist = sites;
}
function getInstanceAllowlist() {
    return instanceAllowlist;
}
function getInstanceAlias() {
    return instanceAlias;
}
/**
 * True when the active instance is the explicit allow-all sentinel
 * (current + future properties). Distinct from null (uninitialized,
 * unenforced): allow-all is an explicit opt-in, never a default.
 */
function isInstanceAllowAll() {
    return isAllowAllAllowlist(instanceAllowlist);
}
// Page allowlist matcher for the image audit. sc-domain:d matches the page
// host itself or any subdomain (case-insensitive); http(s) entries match by
// exact-string prefix of the full page URL with an origin boundary: the next
// character after the prefix must be `/`, `?`, `#`, or end-of-string, so
// `https://example.com` never matches `https://example.com.evil.com/x`.
// The explicit allow-all sentinel (`["all"]`) allows any valid http(s)
// page URL, including future properties. Invalid page URLs never match.
function isPageUrlAllowedByAllowlist(pageUrl, allowlist) {
    let parsed;
    try {
        parsed = new URL(pageUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return false;
    }
    catch {
        return false;
    }
    // Explicit allow-all opt-in: every current + future property is allowed.
    // The URL must still be a valid http(s) URL (checked above).
    if (isAllowAllAllowlist(allowlist))
        return true;
    const host = parsed.hostname.toLowerCase();
    for (const entry of allowlist) {
        if (entry.startsWith("sc-domain:")) {
            const domain = entry.slice("sc-domain:".length).toLowerCase();
            if (domain.length === 0)
                continue;
            if (host === domain || host.endsWith(`.${domain}`))
                return true;
        }
        else if (pageUrl.startsWith(entry)) {
            // Entries that already end at a boundary (e.g. `https://example.com/`)
            // keep plain prefix semantics; otherwise require the next character
            // to be `/`, `?`, `#`, or end-of-string.
            const last = entry.slice(-1);
            if (last === "/" || last === "?" || last === "#")
                return true;
            const next = pageUrl.slice(entry.length);
            if (next === "" || next.startsWith("/") || next.startsWith("?") || next.startsWith("#")) {
                return true;
            }
        }
    }
    return false;
}
// before any Google request. Uninitialized (null) means unenforced.
// The explicit allow-all sentinel (`["all"]`) allows every property,
// including future ones; it is distinct from null and never a default.
function assertSiteAllowed(siteUrl) {
    if (instanceAllowlist === null)
        return;
    if (isAllowAllAllowlist(instanceAllowlist))
        return;
    if (!instanceAllowlist.includes(siteUrl)) {
        throw new Error(`PROPERTY_NOT_ALLOWED: "${siteUrl}" is not in this instance's allowlist ` +
            `(${instanceAllowlist.length} properties). Change the instance profile explicitly; ` +
            `tool arguments cannot widen it.`);
    }
}
