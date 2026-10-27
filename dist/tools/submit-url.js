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
function phrase(parts) {
    return parts.join("");
}
const SUCCESS_NOTE = phrase([
    "Google has been notified. The Indexing ",
    "API officially supports JobPosting and ",
    "BroadcastEvent schema types, but processes ",
    "requests for all page types. Priority is ",
    "not guaranteed for non-job pages.",
]);
const FAILURE_NOTE = phrase([
    "Submission failed. Ensure the Indexing ",
    "API is enabled in your Google Cloud ",
    "project and the service account has ",
    "owner access in Search Console.",
]);
const QUOTA_LIMIT = 200;
const PACE_AFTER = 10;
const PACE_MS = 100;
function assertUrlAllowed(url) {
    const allowlist = (0, profiles_js_1.getInstanceAllowlist)();
    if (allowlist === null)
        return;
    if (!(0, profiles_js_1.isPageUrlAllowedByAllowlist)(url, allowlist)) {
        throw (0, errors_js_1.propertyNotAllowed)(url, allowlist.length);
    }
}
function failed(url, action, error) {
    const message = error?.message || String(error);
    return { url, type: action, notifyTime: null, success: false, error: message, note: FAILURE_NOTE };
}
async function indexingClient() {
    (0, auth_js_1.assertWriteEnabled)("URL submission");
    // Deferred on purpose: startup and metadata requests must not load the Indexing SDK.
    const { google } = await import("googleapis");
    const mode = (0, auth_js_1.getAuthMode)();
    switch (mode) {
        case "oauth": {
            const oauth2Client = await (0, oauth_js_1.authenticateWithOAuth)();
            google.options({ auth: oauth2Client });
            break;
        }
        case "service_account": {
            const keyFile = process.env.GSC_KEY_FILE;
            if (!keyFile || !fs.existsSync(keyFile)) {
                throw new Error(phrase([
                    "GSC_KEY_FILE is required for indexing ",
                    "API in service_account mode.",
                ]));
            }
            const auth = new google.auth.GoogleAuth({
                keyFile,
                scopes: ["https://www.googleapis.com/auth/indexing"],
            });
            google.options({ auth });
            break;
        }
        default: {
            const unexpected = mode;
            return unexpected;
        }
    }
    return google.indexing("v3");
}
function pace(count) {
    if (count <= PACE_AFTER)
        return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, PACE_MS));
}
async function submitUrl(url, action = "URL_UPDATED", clientOverride) {
    try {
        (0, auth_js_1.assertWriteEnabled)("URL submission");
        assertUrlAllowed(url);
        const indexing = clientOverride ?? (await indexingClient());
        const response = await indexing.urlNotifications.publish({
            requestBody: { url, type: action },
        });
        const notifyTime = response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null;
        return { url, type: action, notifyTime, success: true, error: null, note: SUCCESS_NOTE };
    }
    catch (error) {
        return failed(url, action, error);
    }
}
async function submitBatch(urls, action = "URL_UPDATED", clientOverride) {
    if (urls.length > QUOTA_LIMIT) {
        throw new Error(phrase([
            "Google's Indexing API has a daily quota ",
            "of 200 requests. You provided ",
            String(urls.length),
            " URLs. Please reduce to 200 or fewer.",
        ]));
    }
    const results = [];
    for (const url of urls) {
        try {
            assertUrlAllowed(url);
        }
        catch (error) {
            results.push(failed(url, action, error));
            continue;
        }
        results.push(await submitUrl(url, action, clientOverride));
        await pace(urls.length);
    }
    const succeeded = results.filter((item) => item.success).length;
    const failedCount = results.length - succeeded;
    return {
        results,
        summary: {
            total: urls.length,
            succeeded,
            failed: failedCount,
            note: phrase([
                "Daily quota is 200 URL notifications. ",
                String(succeeded),
                " submitted successfully, ",
                String(failedCount),
                " failed.",
            ]),
        },
    };
}
