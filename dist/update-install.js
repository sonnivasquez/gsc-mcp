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
exports.UPDATE_PACKAGE_SPEC = void 0;
exports.findGlobalInstallation = findGlobalInstallation;
exports.installVersion = installVersion;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const node_os_1 = require("node:os");
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const client_config_js_1 = require("./client-config.js");
const registry_version_js_1 = require("./registry-version.js");
exports.UPDATE_PACKAGE_SPEC = "@sonnivasquez/gsc-mcp";
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function canonical(file) {
    try {
        return fs.realpathSync.native(file);
    }
    catch {
        return undefined;
    }
}
function pathDirs() {
    const searchPath = process.env.PATH ?? process.env.Path ?? "";
    return searchPath.split(path.delimiter).filter(dir => path.isAbsolute(dir));
}
/** Locate npm-cli.js directly so Windows never has to spawn npm.cmd. */
function npmCommand() {
    const windows = process.platform === "win32";
    const dirs = pathDirs();
    const node = (0, client_config_js_1.currentRuntime)() === "node" ? process.execPath : dirs
        .map(dir => path.join(dir, windows ? "node.exe" : "node"))
        .find(file => fs.existsSync(file));
    if (!node)
        return undefined;
    const candidates = [path.dirname(node), ...dirs].flatMap(dir => [
        path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
        canonical(path.join(dir, "npm")),
    ]);
    const cli = candidates.find(file => file && path.basename(file) === "npm-cli.js" && fs.existsSync(file));
    return cli ? { program: node, args: [cli] } : undefined;
}
function bunCommand() {
    if ((0, client_config_js_1.currentRuntime)() === "bun")
        return { program: process.execPath, args: [] };
    const binary = process.platform === "win32" ? "bun.exe" : "bun";
    const dirs = pathDirs();
    // A graphical MCP client may launch Node by absolute path with a reduced PATH.
    const prefix = process.env.BUN_INSTALL;
    if (prefix && path.isAbsolute(prefix))
        dirs.push(path.join(prefix, "bin"));
    const home = (0, node_os_1.homedir)();
    if (path.isAbsolute(home))
        dirs.push(path.join(home, ".bun", "bin"));
    const program = dirs
        .map(dir => path.join(dir, binary))
        .find(file => fs.existsSync(file));
    return program ? { program, args: [] } : undefined;
}
async function probe(command, args) {
    try {
        const { stdout } = await execFileAsync(command.program, [...command.args, ...args], {
            timeout: 2_000, maxBuffer: 256 * 1024, windowsHide: true,
            env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        });
        return stdout.trim();
    }
    catch {
        return undefined;
    }
}
function matchesEntrypoint(root, entrypoint) {
    if (!path.isAbsolute(root))
        return false;
    const packageDir = path.join(root, exports.UPDATE_PACKAGE_SPEC);
    try {
        return !fs.lstatSync(packageDir).isSymbolicLink()
            && canonical(path.join(packageDir, "dist", "index.js")) === entrypoint;
    }
    catch {
        return false;
    }
}
/** An undefined result leaves room for recovery after an inconclusive probe. */
async function findGlobalInstallation(file) {
    const entrypoint = canonical(file);
    if (!entrypoint)
        return undefined;
    const modules = path.resolve(entrypoint, "../../../..");
    if (path.basename(modules) !== "node_modules")
        return "not-global";
    if (!matchesEntrypoint(modules, entrypoint))
        return undefined;
    const npm = npmCommand();
    const bun = bunCommand();
    const [npmRoot, bunList] = await Promise.all([
        npm ? probe(npm, ["root", "--global"]) : undefined,
        bun ? probe(bun, ["pm", "ls", "--global"]) : undefined,
    ]);
    if (npm && npmRoot && matchesEntrypoint(npmRoot, entrypoint)) {
        const prefix = path.resolve(npmRoot, process.platform === "win32" ? ".." : "../..");
        return { manager: "npm", command: npm, entrypoint, prefix };
    }
    // bun pm ls -g reports "<global dir> node_modules (<count> installed)".
    const globalDir = /^(.+) node_modules \([\d,]+ installed\)/.exec(bunList ?? "")?.[1];
    if (bun && globalDir && matchesEntrypoint(path.join(globalDir, "node_modules"), entrypoint)) {
        return { manager: "bun", command: bun, entrypoint };
    }
    if ((npm && !path.isAbsolute(npmRoot ?? "")) || (bun && !path.isAbsolute(globalDir ?? "")))
        return undefined;
    return "not-global";
}
function installVersion(installation, latest, run = node_child_process_1.spawnSync) {
    if (!(0, registry_version_js_1.isStableVersion)(latest))
        return "install_error";
    const { command, entrypoint } = installation;
    const packageDir = path.resolve(entrypoint, "../..");
    // Lock beside the package so all profiles using this installation share it.
    const lock = path.join(path.dirname(packageDir), ".gsc-mcp-update.lock");
    try {
        fs.closeSync(fs.openSync(lock, "wx", 0o600));
    }
    catch (error) {
        return error.code === "EEXIST" ? "busy" : "install_error";
    }
    try {
        const current = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version;
        const order = typeof current === "string" ? (0, registry_version_js_1.compareSemver)(current, latest) : null;
        if (order === null || order > 0)
            return "changed";
        if (order < 0 || current !== latest) {
            const args = [
                ...command.args, "install", "--global", "--ignore-scripts",
                "--registry=https://registry.npmjs.org/",
                `https://registry.npmjs.org/${exports.UPDATE_PACKAGE_SPEC}/-/gsc-mcp-${latest}.tgz`,
            ];
            if (installation.manager === "npm") {
                args.push("--prefix", installation.prefix, "--no-audit", "--no-fund");
            }
            const installed = run(command.program, args, { stdio: "inherit", timeout: 120_000, windowsHide: true });
            if (installed.error || installed.status !== 0)
                return "install_error";
        }
        const verified = run(process.execPath, [entrypoint, "--version"], {
            encoding: "utf8", timeout: 10_000, windowsHide: true,
        });
        if (verified.error || verified.status !== 0 || verified.stdout.trim() !== latest)
            return "verify_error";
        return undefined;
    }
    catch {
        return "install_error";
    }
    finally {
        try {
            fs.unlinkSync(lock);
        }
        catch { /* Leave a stale lock for explicit recovery. */ }
    }
}
