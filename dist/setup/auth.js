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
exports.validateCredentialFile = validateCredentialFile;
exports.decideAuth = decideAuth;
const fs = __importStar(require("node:fs"));
const version_js_1 = require("../version.js");
const flow_js_1 = require("./flow.js");
const i18n_js_1 = require("./i18n.js");
function validateCredentialFile(file, mode) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        throw new Error(`Cannot read a valid ${mode} JSON credential file.`);
    }
    const object = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
    if (!object(value))
        throw new Error(`Invalid ${mode} credential shape.`);
    if (mode === "custom") {
        const installed = value.installed;
        if (!object(installed) || typeof installed.client_id !== "string" || !installed.client_id.trim() ||
            typeof installed.client_secret !== "string" || !installed.client_secret.trim() ||
            !Array.isArray(installed.redirect_uris) || !installed.redirect_uris.some((uri) => typeof uri === "string" && uri.startsWith("http://127.0.0.1"))) {
            throw new Error("Custom OAuth requires a Desktop installed client JSON with client_id, client_secret, and loopback redirect_uris.");
        }
    }
    else if (value.type !== "service_account" || typeof value.client_email !== "string" ||
        !value.client_email.trim() || typeof value.private_key !== "string" || !value.private_key.includes("BEGIN PRIVATE KEY")) {
        throw new Error("Service Account requires a service_account JSON with client_email and private_key.");
    }
}
/**
 * An undefined access preserves legacy callers; null selects the canonical prompt/default.
 * The trailing locale selects the step-oriented prompt copy only: thrown
 * validation errors stay English-canonical and are localized at the
 * fail-closed rendering boundary in src/setup.ts.
 *
 * Interactively the auth and access prompts print a numbered list in the
 * same style as steps 2/3 (`  [1] label`) followed by a short
 * `Choose [1]: ` prompt; an empty answer selects the default (index 0)
 * while a non-numeric or out-of-range token throws the controlled
 * `Invalid setup choice` error without echoing input. Non-interactive
 * prompts (`--yes`/no TTY, or adapters without the interactive flag) fall
 * back to `choose` defaults and print no lists, preserving quiet output.
 */
async function decideAuth(prompt, requested, tier, writeFlag, access, locale = "en") {
    const AUTH_MODES = ["shared", "custom", "service-account"];
    const SCOPES = ["readonly", "full"];
    const interactive = prompt.interactive === true;
    async function askSingle(titleKey, optionKeys, choices, defaultIndex) {
        if (!interactive) {
            return (0, flow_js_1.validatedChoice)(choices, await prompt.choose((0, i18n_js_1.translateSetup)(locale, titleKey), choices, defaultIndex));
        }
        console.log(`\n${(0, i18n_js_1.translateSetup)(locale, titleKey)}`);
        optionKeys.forEach((key, i) => console.log(`  [${i + 1}] ${(0, i18n_js_1.translateSetup)(locale, key)}`));
        const trimmed = (await prompt.text((0, i18n_js_1.translateSetup)(locale, "choosePrompt"), "")).trim();
        if (trimmed === "")
            return (0, flow_js_1.validatedChoice)(choices, defaultIndex);
        // No input echo: the rejected token may hold sensitive text.
        if (!/^\d+$/.test(trimmed))
            throw new Error("Invalid setup choice");
        return (0, flow_js_1.validatedChoice)(choices, Number(trimmed) - 1);
    }
    const mode = requested ?? await askSingle("authTitle", ["authOptionShared", "authOptionCustom", "authOptionService"], AUTH_MODES, 0);
    if (access !== undefined) {
        const scope = access ?? (mode === "shared" ? "readonly" : await askSingle("accessTitle", ["accessOptionReadonly", "accessOptionFullExplained"], SCOPES, 0));
        if (mode === "shared" && scope === "full") {
            throw new Error(`Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`);
        }
        return { mode, scope, write: scope === "full" };
    }
    if (mode === "shared" && (tier === "full" || writeFlag)) {
        throw new Error(`Quick Connect is readonly-only in ${version_js_1.CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`);
    }
    const scope = tier ?? (mode === "shared" ? "readonly" : await askSingle("accessTitle", ["accessOptionReadonly", "accessOptionFull"], SCOPES, 0));
    let write = false;
    if (writeFlag && scope !== "full")
        throw new Error("--enable-write requires --scopes full and a custom or service-account authentication mode.");
    if (scope === "full") {
        write = writeFlag || (0, i18n_js_1.isSetupAffirmative)(await prompt.text((0, i18n_js_1.translateSetup)(locale, "writeConfirm"), "n"), locale);
    }
    return { mode, scope, write };
}
