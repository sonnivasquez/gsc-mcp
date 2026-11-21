import { compareSemver, fetchRegistryLatest, isStableVersion } from "./registry-version.js";
import { packageEntrypointPath } from "./client-config.js";
import { findGlobalInstallation, installVersion } from "./update-install.js";
import { CLI_VERSION } from "./version.js";

export const UPDATE_USAGE = `
Usage: gsc update [--check | --to <version>]

Assisted update for global npm and Bun installations. Installs the selected
release, verifies it, and reminds you to reload the MCP connection.

  --check          Compare installed and registry versions without installing
  --to <version>   Install a specific newer stable version
  --help           Show this help

Updating preserves Google tokens, profiles, and client configurations.
`.trim();

export interface UpdateDeps {
  registryFetchImpl?: typeof fetch;
  findInstallation?: typeof findGlobalInstallation;
  install?: typeof installVersion;
  installedVersion?: string;
}

export async function runUpdate(argv: string[], deps: UpdateDeps = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(UPDATE_USAGE);
    return 0;
  }
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  const target = argv.length === 2 && argv[0] === "--to" && isStableVersion(argv[1]) ? argv[1] : undefined;
  if (argv.length && !checkOnly && !target) {
    const problem = argv.some(flag => flag.startsWith("--") && flag !== "--check" && flag !== "--to")
      ? "unknown flag"
      : "invalid arguments";
    console.error(`update: ${problem}. See: gsc update --help.`);
    return 2;
  }

  const installed = deps.installedVersion ?? CLI_VERSION;
  const result = target
    ? { ok: true as const, latest: target }
    : await fetchRegistryLatest(deps.registryFetchImpl ?? fetch);
  if (!result.ok) {
    console.log(`update check failed: registry latest unknown (${result.reason}); retry later.`);
    return 1;
  }
  const latest = result.latest;
  const order = isStableVersion(latest) ? compareSemver(installed, latest) : null;
  if (order === null) {
    console.log("update check failed: registry latest unknown (unexpected-response); retry later.");
    return 1;
  }
  if (order === 0) {
    console.log(`already up to date (${installed})`);
    return 0;
  }
  if (order > 0) {
    const label = target ? "requested version" : "registry latest";
    console.log(`installed ${installed} is ahead of ${label} ${latest}; nothing to update`);
    return 0;
  }
  if (checkOnly) {
    console.log(`installed ${installed}, registry latest ${latest} — run gsc update`);
    return 0;
  }
  const installation = await (deps.findInstallation ?? findGlobalInstallation)(packageEntrypointPath());
  if (!installation || installation === "not-global") {
    console.error("update: could not identify this global installation. Update it with its original package manager.");
    return 1;
  }
  console.log(`updating ${installed} -> ${latest} (${installation.manager})`);
  const failure = (deps.install ?? installVersion)(installation, latest);
  if (failure) {
    reportUpdateFailure(failure);
    return 1;
  }
  console.log(`updated to ${latest} (verified); restart your MCP client to use the new version.`);
  return 0;
}

export function reportUpdateFailure(failure: NonNullable<ReturnType<typeof installVersion>>): void {
  if (failure === "busy") {
    console.error("update failed (busy): another update holds .gsc-mcp-update.lock beside the package. Retry when it finishes. If the updater crashed, remove that lock after ensuring the installer has stopped.");
    return;
  }
  console.error(`update failed (${failure}); check gsc --version and retry with the original package manager if needed.`);
}
