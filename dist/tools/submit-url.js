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
exports.submitUrl = submitUrl;
exports.submitBatch = submitBatch;
const auth_js_1 = require("../auth.js");
const oauth_js_1 = require("../oauth.js");
const profiles_js_1 = require("../profiles.js");
const errors_js_1 = require("../gsc/errors.js");
const fs = __importStar(require("fs"));
async function getIndexingClient() {
    (0, auth_js_1.assertWriteEnabled)("URL submission");
    // Metadata requests and MCP startup never need the Indexing SDK.
    // submitUrl has already checked the allowlist before reaching this path.
    const { google } = await import("googleapis");
    const mode = (0, auth_js_1.getAuthMode)();
    if (mode === "oauth") {
        const oauth2Client = await (0, oauth_js_1.authenticateWithOAuth)();
        google.options({ auth: oauth2Client });
    }
    else {
        const keyFile = process.env.GSC_KEY_FILE;
        if (!keyFile || !fs.existsSync(keyFile)) {
            throw new Error("GSC_KEY_FILE is required for indexing API in service_account mode.");
        }
        const auth = new google.auth.GoogleAuth({
            keyFile,
            scopes: ["https://www.googleapis.com/auth/indexing"],
        });
        google.options({ auth });
    }
    return google.indexing("v3");
}
// Whole-call allowlist rejection for submitted URLs, same matcher and error
// semantics as the image-audit page check. Null allowlist (library/test use)
// skips enforcement, matching assertSiteAllowed; empty allowlist denies all.
function assertSubmitUrlAllowed(url) {
    const allowlist = (0, profiles_js_1.getInstanceAllowlist)();
    if (allowlist === null)
        return;
    if (!(0, profiles_js_1.isPageUrlAllowedByAllowlist)(url, allowlist)) {
        throw (0, errors_js_1.propertyNotAllowed)(url, allowlist.length);
    }
}
async function submitUrl(url, action = "URL_UPDATED", clientOverride) {
    try {
        (0, auth_js_1.assertWriteEnabled)("URL submission");
        // Local allowlist fail-fast before any client use: off-allowlist URLs are
        // rejected here instead of noisily at Google. Null allowlist
        // (library/test use) skips enforcement, matching assertSiteAllowed.
        assertSubmitUrlAllowed(url);
        const indexing = clientOverride ?? (await getIndexingClient());
        const response = await indexing.urlNotifications.publish({
            requestBody: {
                url,
                type: action,
            },
        });
        return {
            url,
            type: action,
            notifyTime: response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null,
            success: true,
            error: null,
            note: "Google has been notified. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages.",
        };
    }
    catch (err) {
        return {
            url,
            type: action,
            notifyTime: null,
            success: false,
            error: err.message || String(err),
            note: "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
        };
    }
}
async function submitBatch(urls, action = "URL_UPDATED", clientOverride) {
    if (urls.length > 200) {
        throw new Error(`Google's Indexing API has a daily quota of 200 requests. You provided ${urls.length} URLs. Please reduce to 200 or fewer.`);
    }
    // Per-URL mixed results (after the quota check): each off-allowlist URL
    // fails locally with zero client calls for that item, while allowed URLs
    // publish via the submitUrl path below (which re-checks gate+allowlist).
    // Ambiguous writes are never retried; the summary counts succeeded/failed.
    const results = [];
    for (const url of urls) {
        try {
            assertSubmitUrlAllowed(url);
        }
        catch (err) {
            results.push({
                url,
                type: action,
                notifyTime: null,
                success: false,
                error: err.message || String(err),
                note: "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
            });
            continue;
        }
        const result = await submitUrl(url, action, clientOverride);
        results.push(result);
        // Small delay to avoid rate limiting
        if (urls.length > 10) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return {
        results,
        summary: {
            total: urls.length,
            succeeded,
            failed,
            note: `Daily quota is 200 URL notifications. ${succeeded} submitted successfully, ${failed} failed.`,
        },
    };
}
