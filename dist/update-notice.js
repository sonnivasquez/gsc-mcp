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
exports.findAvailableUpdate = findAvailableUpdate;
exports.reserveUpdateNotice = reserveUpdateNotice;
exports.offerTerminalUpdate = offerTerminalUpdate;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const client_config_js_1 = require("./client-config.js");
const profiles_js_1 = require("./profiles.js");
const registry_version_js_1 = require("./registry-version.js");
const update_install_js_1 = require("./update-install.js");
const update_js_1 = require("./update.js");
const version_js_1 = require("./version.js");
const AUTOMATIC_TIMEOUT_MS = 750;
const NOTICE_RESERVATION_TTL_MS = 60_000;
let installationLookup;
async function findAvailableUpdate() {
    if (process.env.GSC_UPDATE_CHECK === "0")
        return undefined;
    const installation = await (installationLookup ??= (0, update_install_js_1.findGlobalInstallation)((0, client_config_js_1.packageEntrypointPath)())
        .catch(() => undefined)
        .then(found => {
        // Keep conclusive results, including local installs, and share pending probes.
        if (found === undefined)
            installationLookup = undefined;
        return found;
    }));
    if (!installation || installation === "not-global")
        return undefined;
    const result = await (0, registry_version_js_1.cachedRegistryLatest)({
        fetchImpl: fetch, cacheDir: (0, profiles_js_1.dataDir)(), nowMs: Date.now(), timeoutMs: AUTOMATIC_TIMEOUT_MS,
    });
    if (!result.ok || !(0, registry_version_js_1.isStableVersion)(result.latest) || (0, registry_version_js_1.compareSemver)(version_js_1.CLI_VERSION, result.latest) !== -1) {
        return undefined;
    }
    return { version: result.latest, installation };
}
const noop = () => { };
function markNoticeDelivered(marker) {
    try {
        fs.closeSync(fs.openSync(marker, "wx", 0o600));
    }
    catch (error) {
        return error.code === "EEXIST" ? undefined : noop;
    }
    return () => {
        try {
            fs.unlinkSync(marker);
        }
        catch { /* Best effort when storage is unavailable. */ }
    };
}
function releaseReservation(directory, owner) {
    // The owner name is unique. Removing only an empty directory preserves a new reservation.
    if (owner !== undefined) {
        try {
            fs.unlinkSync(path.join(directory, owner));
        }
        catch { /* Already released or reclaimed. */ }
    }
    try {
        fs.rmdirSync(directory);
    }
    catch { /* Missing or still owned. */ }
}
function hasActiveReservation(directory) {
    let owner;
    try {
        [owner] = fs.readdirSync(directory);
        if (owner !== undefined) {
            const age = Date.now() - Math.floor(fs.statSync(path.join(directory, owner)).mtimeMs);
            if (age >= 0 && age < NOTICE_RESERVATION_TTL_MS)
                return true;
        }
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    releaseReservation(directory, owner);
    return false;
}
/** Hold one notice per version until delivery, cancellation or expiration. */
function reserveUpdateNotice(version) {
    const directory = path.join((0, profiles_js_1.dataDir)(), "update-notices");
    const marker = path.join(directory, version);
    const reservation = `${marker}.pending`;
    try {
        if (fs.existsSync(marker))
            return "delivered";
        if (hasActiveReservation(reservation))
            return "busy";
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const staging = fs.mkdtempSync(path.join(directory, ".pending-"));
        const owner = path.basename(staging);
        try {
            fs.writeFileSync(path.join(staging, owner), "", { flag: "wx", mode: 0o600 });
            // Publish a non-empty directory atomically so another process cannot take it over mid-claim.
            fs.renameSync(staging, reservation);
        }
        catch (error) {
            releaseReservation(staging, owner);
            if (fs.existsSync(marker))
                return "delivered";
            if (fs.existsSync(reservation))
                return "busy";
            throw error;
        }
        const release = () => releaseReservation(reservation, owner);
        if (fs.existsSync(marker)) {
            release();
            return "delivered";
        }
        return {
            complete: () => {
                try {
                    if (fs.existsSync(path.join(reservation, owner)))
                        return markNoticeDelivered(marker);
                }
                finally {
                    release();
                }
            },
            release,
        };
    }
    catch {
        // Without persistent storage the caller can still show a notice per session.
        return { complete: () => noop, release: noop };
    }
}
/** Returns the relaunched command exit code, or undefined to continue locally. */
async function offerTerminalUpdate(argv, locale) {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.GSC_UPDATE_CHECK === "0")
        return undefined;
    const update = await findAvailableUpdate();
    if (!update)
        return undefined;
    const { resolveSetupLocale } = await import("./setup/i18n.js");
    const { terminalPromptAdapter } = await import("./setup/flow.js");
    const es = (locale ?? resolveSetupLocale()) === "es";
    const prompt = terminalPromptAdapter(false);
    let accepted = false;
    try {
        accepted = await prompt.choose(es
            ? `GSC MCP ${update.version} disponible. 1) Actualizar ahora  2) Continuar [2]: `
            : `GSC MCP ${update.version} is available. 1) Update now  2) Continue [2]: `, ["update", "continue"], 1) === 0;
    }
    catch {
        // A cancelled or closed terminal never constitutes approval.
        return undefined;
    }
    finally {
        prompt.close();
    }
    if (!accepted)
        return undefined;
    const failure = (0, update_install_js_1.installVersion)(update.installation, update.version);
    if (failure) {
        (0, update_js_1.reportUpdateFailure)(failure);
        return 1;
    }
    console.log(es ? `Actualizado a ${update.version}.` : `Updated to ${update.version}.`);
    const resumed = (0, node_child_process_1.spawnSync)(process.execPath, [...process.execArgv, update.installation.entrypoint, ...argv], {
        stdio: "inherit",
        env: { ...process.env, GSC_UPDATE_CHECK: "0" },
    });
    if (resumed.error) {
        console.error(es ? "No se pudo reanudar el comando. Vuelve a ejecutarlo." : "Could not resume the command. Run it again.");
    }
    return resumed.status ?? 1;
}
