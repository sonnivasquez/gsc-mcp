import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { currentRuntime } from "./client-config.js";
import { compareSemver, isStableVersion } from "./registry-version.js";

export const UPDATE_PACKAGE_SPEC = "@sonnivasquez/gsc-mcp";

interface Command {
  program: string;
  args: string[];
}

export type GlobalInstallation = {
  command: Command;
  entrypoint: string;
} & ({ manager: "npm"; prefix: string } | { manager: "bun" });

const execFileAsync = promisify(execFile);

function canonical(file: string): string | undefined {
  try { return fs.realpathSync.native(file); } catch { return undefined; }
}

function pathDirs(): string[] {
  const searchPath = process.env.PATH ?? process.env.Path ?? "";
  return searchPath.split(path.delimiter).filter(dir => path.isAbsolute(dir));
}

/** Locate npm-cli.js directly so Windows never has to spawn npm.cmd. */
function npmCommand(): Command | undefined {
  const windows = process.platform === "win32";
  const dirs = pathDirs();
  const node = currentRuntime() === "node" ? process.execPath : dirs
    .map(dir => path.join(dir, windows ? "node.exe" : "node"))
    .find(file => fs.existsSync(file));
  if (!node) return undefined;
  const candidates = [path.dirname(node), ...dirs].flatMap(dir => [
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    canonical(path.join(dir, "npm")),
  ]);
  const cli = candidates.find(file => file && path.basename(file) === "npm-cli.js" && fs.existsSync(file));
  return cli ? { program: node, args: [cli] } : undefined;
}

function bunCommand(): Command | undefined {
  if (currentRuntime() === "bun") return { program: process.execPath, args: [] };

  const binary = process.platform === "win32" ? "bun.exe" : "bun";
  const dirs = pathDirs();
  // A graphical MCP client may launch Node by absolute path with a reduced PATH.
  const prefix = process.env.BUN_INSTALL;
  if (prefix && path.isAbsolute(prefix)) dirs.push(path.join(prefix, "bin"));
  const home = homedir();
  if (path.isAbsolute(home)) dirs.push(path.join(home, ".bun", "bin"));
  const program = dirs
    .map(dir => path.join(dir, binary))
    .find(file => fs.existsSync(file));
  return program ? { program, args: [] } : undefined;
}

async function probe(command: Command, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command.program, [...command.args, ...args], {
      timeout: 2_000, maxBuffer: 256 * 1024, windowsHide: true,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function matchesEntrypoint(root: string, entrypoint: string): boolean {
  if (!path.isAbsolute(root)) return false;
  const packageDir = path.join(root, UPDATE_PACKAGE_SPEC);
  try {
    return !fs.lstatSync(packageDir).isSymbolicLink()
      && canonical(path.join(packageDir, "dist", "index.js")) === entrypoint;
  } catch {
    return false;
  }
}

/** An undefined result leaves room for recovery after an inconclusive probe. */
export async function findGlobalInstallation(file: string): Promise<GlobalInstallation | "not-global" | undefined> {
  const entrypoint = canonical(file);
  if (!entrypoint) return undefined;
  const modules = path.resolve(entrypoint, "../../../..");
  if (path.basename(modules) !== "node_modules") return "not-global";
  const cacheEntry = path.dirname(modules);
  // npm exec installs into _npx/<16-hex hash>/node_modules under its cache.
  if (path.basename(path.dirname(cacheEntry)) === "_npx" && /^[0-9a-f]{16}$/.test(path.basename(cacheEntry))) {
    return "not-global";
  }
  if (!matchesEntrypoint(modules, entrypoint)) return undefined;

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
  if ((npm && !path.isAbsolute(npmRoot ?? "")) || (bun && !path.isAbsolute(globalDir ?? ""))) return undefined;
  return "not-global";
}

type UpdateFailure = "install_error" | "verify_error" | "busy" | "changed";

export function installVersion(installation: GlobalInstallation, latest: string, run = spawnSync): UpdateFailure | undefined {
  if (!isStableVersion(latest)) return "install_error";
  const { command, entrypoint } = installation;
  const packageDir = path.resolve(entrypoint, "../..");
  // Lock beside the package so all profiles using this installation share it.
  const lock = path.join(path.dirname(packageDir), ".gsc-mcp-update.lock");
  try {
    fs.closeSync(fs.openSync(lock, "wx", 0o600));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? "busy" : "install_error";
  }

  try {
    const current = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version;
    const order = typeof current === "string" ? compareSemver(current, latest) : null;
    if (order === null || order > 0) return "changed";
    if (order < 0 || current !== latest) {
      const artifact = `https://registry.npmjs.org/${UPDATE_PACKAGE_SPEC}/-/gsc-mcp-${latest}.tgz`;
      const args = [
        ...command.args, "install", "--global", "--ignore-scripts",
        "--registry=https://registry.npmjs.org/",
        // A named tarball replaces Bun's existing registry dependency under the same key.
        installation.manager === "bun" ? `${UPDATE_PACKAGE_SPEC}@${artifact}` : artifact,
      ];
      if (installation.manager === "npm") {
        args.push("--prefix", installation.prefix, "--no-audit", "--no-fund");
      }
      const installed = run(command.program, args, { stdio: "inherit", timeout: 120_000, windowsHide: true });
      if (installed.error || installed.status !== 0) return "install_error";
    }
    const verified = run(process.execPath, [entrypoint, "--version"], {
      encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    if (verified.error || verified.status !== 0 || verified.stdout.trim() !== latest) return "verify_error";
    return undefined;
  } catch {
    return "install_error";
  } finally {
    try { fs.unlinkSync(lock); } catch { /* Leave a stale lock for explicit recovery. */ }
  }
}
