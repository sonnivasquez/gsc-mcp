"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_USAGE = exports.UPDATE_PACKAGE_SPEC = void 0;
exports.runUpdate = runUpdate;
// Assisted updater: `gsc update` compares the installed version against the
// npm registry and, when behind, reinstalls the package globally for the
// current runtime, then verifies the on-disk entry reports the new version.
// Never reads or writes tokens, profiles, or client configs; the only network
// use is the read-only registry GET shared with the doctor version check.
const node_child_process_1 = require("node:child_process");
const registry_version_js_1 = require("./registry-version.js");
const client_config_js_1 = require("./client-config.js");
const version_js_1 = require("./version.js");
/** Package spec reinstalled globally by the assisted updater. */
exports.UPDATE_PACKAGE_SPEC = "@sonnivasquez/gsc-mcp";
exports.UPDATE_USAGE = `
Usage: gsc update [--check]

Assisted update: fetches the latest release from the npm registry and, when
the installed CLI is behind, reinstalls ${exports.UPDATE_PACKAGE_SPEC} globally for
the current runtime (npm for Node, bun for Bun), verifies the new version,
and reminds you to restart your MCP client.

  --check     Compare installed and registry versions only; never installs
  --help      Show this help

Updating never touches Google tokens, profiles, or client configurations.
`.trim();
const defaultUpdateRunner = (program, args, opts) => {
    const result = (0, node_child_process_1.spawnSync)(program, args, { stdio: opts.stdio, encoding: "utf8" });
    return {
        status: result.status,
        error: result.error ?? undefined,
        stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    };
};
/** Canonical global reinstall for the invoking runtime (bare program, no shell). */
function installCommandFor(runtime) {
    return runtime === "bun"
        ? { program: "bun", args: ["install", "-g", exports.UPDATE_PACKAGE_SPEC] }
        : { program: "npm", args: ["install", "-g", exports.UPDATE_PACKAGE_SPEC] };
}
async function runUpdate(argv, deps = {}) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(exports.UPDATE_USAGE);
        return 0;
    }
    const checkOnly = argv.includes("--check");
    const unknown = argv.find((flag) => flag !== "--check");
    if (unknown !== undefined) {
        // No argv echo: the unknown token may hold sensitive text.
        void unknown;
        console.error("update: unknown flag. See: gsc update --help.");
        return 2;
    }
    const installed = deps.installedVersion ?? version_js_1.CLI_VERSION;
    const result = await (0, registry_version_js_1.fetchRegistryLatest)(deps.registryFetchImpl ?? fetch, registry_version_js_1.REGISTRY_TIMEOUT_MS);
    if (!result.ok) {
        console.log(`update check failed: registry latest unknown (${result.reason}); retry later.`);
        return 1;
    }
    const latest = result.latest;
    const cmp = (0, registry_version_js_1.compareSemver)(installed, latest);
    if (cmp === null) {
        console.log("update check failed: registry latest unknown (unexpected-response); retry later.");
        return 1;
    }
    if (cmp === 0) {
        console.log(`already up to date (${installed})`);
        return 0;
    }
    if (cmp === 1) {
        // Installed is ahead (unpublished local build): reinstalling would
        // downgrade, so report and stop without touching the install.
        console.log(`installed ${installed} is ahead of registry latest ${latest}; nothing to update`);
        return 0;
    }
    if (checkOnly) {
        console.log(`installed ${installed}, registry latest ${latest} — run gsc update`);
        return 0;
    }
    console.log(`updating ${installed} -> ${latest}`);
    const runtime = deps.runtime ?? (0, client_config_js_1.currentRuntime)();
    const install = installCommandFor(runtime);
    const runner = deps.runner ?? defaultUpdateRunner;
    const installResult = runner(install.program, install.args, { stdio: "inherit" });
    if (installResult.error !== undefined || installResult.status !== 0) {
        console.log("update failed (install_error); retry later.");
        return 1;
    }
    const entrypoint = deps.entrypoint ?? (0, client_config_js_1.packageEntrypointPath)();
    const verifyProgram = runtime === "bun" ? "bun" : process.execPath;
    const verified = runner(verifyProgram, [entrypoint, "--version"], { stdio: "pipe" });
    if (verified.error !== undefined || verified.status !== 0 || (verified.stdout ?? "").trim() !== latest) {
        console.log(`update failed (verify_error): expected ${latest} after reinstall; retry later.`);
        return 1;
    }
    console.log(`updated to ${latest} (verified); restart your MCP client to use the new version.`);
    return 0;
}
