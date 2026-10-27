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
function phrase(parts) {
    return parts.join("");
}
function readonlyCanonicalMessage(tool) {
    return phrase([
        tool,
        " is disabled in readonly mode. ",
        "Set GSC_ACCESS_MODE=full to enable ",
        "Google write operations.",
    ]);
}
function legacyScopeMessage(tool) {
    return phrase([
        tool,
        " needs full access, but this install ",
        "is in read only mode. ",
        "Set GSC_ACCESS_MODE=full to enable it ",
        "explicitly. Legacy configuration ",
        "requires GSC_SCOPES=full and ",
        "GSC_ENABLE_WRITE=1.",
    ]);
}
function legacyFlagMessage(tool) {
    return phrase([
        tool,
        " is disabled by legacy configuration. ",
        "Set GSC_ACCESS_MODE=full to enable ",
        "writes, or retain legacy ",
        "GSC_ENABLE_WRITE=1.",
    ]);
}
function writeRefusal(tool, access) {
    switch (access.source) {
        case "canonical":
            return new Error(readonlyCanonicalMessage(tool));
        case "legacy":
            if (access.scopeTier !== "full")
                return new Error(legacyScopeMessage(tool));
            return new Error(legacyFlagMessage(tool));
        default: {
            const unexpected = access.source;
            return unexpected;
        }
    }
}
function assertWriteEnabled(tool) {
    const access = (0, access_js_1.resolveAccessPolicy)();
    if (access.writesEnabled)
        return;
    throw writeRefusal(tool, access);
}
function getAuthMode() {
    const configured = process.env.GSC_AUTH_MODE;
    if (typeof configured === "string" && configured.toLowerCase() === "oauth")
        return "oauth";
    return "service_account";
}
function missingKeyMessage() {
    return phrase([
        "GSC_KEY_FILE environment variable is ",
        "required in service_account mode. ",
        "Set it to the path of your service ",
        "account JSON key file, or switch to ",
        "OAuth by setting GSC_AUTH_MODE=oauth.",
    ]);
}
function getConfig() {
    const siteUrls = (0, profiles_js_1.envAllowlist)();
    const mode = getAuthMode();
    switch (mode) {
        case "oauth":
            return { keyFile: undefined, siteUrls };
        case "service_account": {
            const keyFile = process.env.GSC_KEY_FILE;
            if (!keyFile)
                throw new Error(missingKeyMessage());
            if (!fs.existsSync(keyFile)) {
                throw new Error(phrase(["Service account key file not found at: ", keyFile]));
            }
            return { keyFile, siteUrls };
        }
        default: {
            const unexpected = mode;
            return unexpected;
        }
    }
}
function resolveSiteUrl(siteUrlOverride) {
    const chosen = siteUrlOverride?.trim() ?? "";
    if (chosen.length === 0) {
        throw new Error(phrase([
            "site_url is required for this tool. ",
            "Pass the exact Search Console property ",
            "(for example, https://example.com/ or ",
            "sc-domain:example.com).",
        ]));
    }
    return chosen;
}
async function loadGoogle() {
    // Deferred on purpose: MCP startup and metadata requests must not load the SDK.
    return import("googleapis");
}
async function serviceAccountClient() {
    const { keyFile } = getConfig();
    const { google } = await loadGoogle();
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: (0, oauth_js_1.scopesForTier)((0, oauth_js_1.getScopeTier)()),
    });
    google.options({ auth });
    return google.searchconsole("v1");
}
async function oauthClient() {
    const oauth2Client = await (0, oauth_js_1.authenticateWithOAuth)();
    const { google } = await loadGoogle();
    google.options({ auth: oauth2Client });
    return google.searchconsole("v1");
}
async function getSearchConsoleClient() {
    if (cachedClient)
        return cachedClient;
    const mode = getAuthMode();
    switch (mode) {
        case "oauth":
            cachedClient = await oauthClient();
            break;
        case "service_account":
            cachedClient = await serviceAccountClient();
            break;
        default: {
            const unexpected = mode;
            return unexpected;
        }
    }
    return cachedClient;
}
