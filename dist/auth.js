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
exports.assertWriteEnabled = assertWriteEnabled;
exports.getAuthMode = getAuthMode;
exports.getConfig = getConfig;
exports.resolveSiteUrl = resolveSiteUrl;
exports.getSearchConsoleClient = getSearchConsoleClient;
const fs = __importStar(require("fs"));
const oauth_js_1 = require("./oauth.js");
const profiles_js_1 = require("./profiles.js");
const access_js_1 = require("./access.js");
let cachedClient = null;
// Canonical full enables writes. Legacy full still requires its original flag.
function assertWriteEnabled(tool) {
    const access = (0, access_js_1.resolveAccessPolicy)();
    if (access.writesEnabled)
        return;
    if (access.source === "canonical") {
        throw new Error(`${tool} is disabled in readonly mode. Set GSC_ACCESS_MODE=full to enable Google write operations.`);
    }
    if (access.scopeTier !== "full") {
        throw new Error(`${tool} needs full access, but this install is in read only mode. ` +
            `Set GSC_ACCESS_MODE=full to enable it explicitly. Legacy configuration requires GSC_SCOPES=full and GSC_ENABLE_WRITE=1.`);
    }
    throw new Error(`${tool} is disabled by legacy configuration. Set GSC_ACCESS_MODE=full to enable writes, or retain legacy GSC_ENABLE_WRITE=1.`);
}
function getAuthMode() {
    const mode = process.env.GSC_AUTH_MODE?.toLowerCase();
    if (mode === "oauth")
        return "oauth";
    return "service_account";
}
function getConfig() {
    const mode = getAuthMode();
    // Single centralized allowlist parser (profiles.envAllowlist): JSON-first,
    // legacy-compatible, fail-closed. Comma-bearing URL identifiers survive
    // exactly; malformed JSON throws instead of silently mis-splitting.
    const siteUrls = (0, profiles_js_1.envAllowlist)();
    if (mode === "service_account") {
        const keyFile = process.env.GSC_KEY_FILE;
        if (!keyFile) {
            throw new Error("GSC_KEY_FILE environment variable is required in service_account mode. " +
                "Set it to the path of your service account JSON key file, " +
                "or switch to OAuth by setting GSC_AUTH_MODE=oauth.");
        }
        if (!fs.existsSync(keyFile)) {
            throw new Error(`Service account key file not found at: ${keyFile}`);
        }
        return { keyFile, siteUrls };
    }
    // OAuth mode
    return { keyFile: undefined, siteUrls };
}
function resolveSiteUrl(siteUrlOverride) {
    const override = siteUrlOverride?.trim();
    if (!override) {
        throw new Error("site_url is required for this tool. Pass the exact Search Console property " +
            "(for example, https://example.com/ or sc-domain:example.com).");
    }
    return override;
}
async function getServiceAccountClient() {
    const { keyFile } = getConfig();
    const scopes = (0, oauth_js_1.scopesForTier)((0, oauth_js_1.getScopeTier)());
    const { google } = await import("googleapis");
    // Same scope set as the OAuth flow, including auth/indexing on the full
    // tier so submit tools work in service-account mode too (#2).
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes,
    });
    google.options({ auth });
    return google.searchconsole("v1");
}
async function getOAuthClient() {
    const oauth2Client = await (0, oauth_js_1.authenticateWithOAuth)();
    const { google } = await import("googleapis");
    google.options({ auth: oauth2Client });
    return google.searchconsole("v1");
}
async function getSearchConsoleClient() {
    if (cachedClient)
        return cachedClient;
    const mode = getAuthMode();
    if (mode === "oauth") {
        cachedClient = await getOAuthClient();
    }
    else {
        cachedClient = await getServiceAccountClient();
    }
    return cachedClient;
}
