import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { packageEntrypointPath } from "./client-config.js";
import { dataDir } from "./profiles.js";
import { cachedRegistryLatest, compareSemver, isStableVersion } from "./registry-version.js";
import type { SetupLocale } from "./setup/i18n.js";
import { findGlobalInstallation, installVersion, type GlobalInstallation } from "./update-install.js";
import { reportUpdateFailure } from "./update.js";
import { CLI_VERSION } from "./version.js";

const AUTOMATIC_TIMEOUT_MS = 750;
const NOTICE_RESERVATION_TTL_MS = 60_000;

interface AvailableUpdate {
  version: string;
  installation: GlobalInstallation;
}

let installationLookup: ReturnType<typeof findGlobalInstallation> | undefined;

export async function findAvailableUpdate(): Promise<AvailableUpdate | undefined> {
  if (process.env.GSC_UPDATE_CHECK === "0") return undefined;
  const installation = await (installationLookup ??= findGlobalInstallation(packageEntrypointPath())
    .catch(() => undefined)
    .then(found => {
      // Keep conclusive results, including local installs, and share pending probes.
      if (found === undefined) installationLookup = undefined;
      return found;
    }));
  if (!installation || installation === "not-global") return undefined;
  const result = await cachedRegistryLatest({
    fetchImpl: fetch, cacheDir: dataDir(), nowMs: Date.now(), timeoutMs: AUTOMATIC_TIMEOUT_MS,
  });
  if (!result.ok || !isStableVersion(result.latest) || compareSemver(CLI_VERSION, result.latest) !== -1) {
    return undefined;
  }
  return { version: result.latest, installation };
}

type Release = () => void;
type NoticeReservation = "delivered" | "busy" | { complete: () => Release | undefined; release: Release };

const noop = () => {};

function markNoticeDelivered(marker: string): Release | undefined {
  try {
    fs.closeSync(fs.openSync(marker, "wx", 0o600));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? undefined : noop;
  }
  return () => {
    try { fs.unlinkSync(marker); } catch { /* Best effort when storage is unavailable. */ }
  };
}

function releaseReservation(directory: string, owner?: string): void {
  // The owner name is unique. Removing only an empty directory preserves a new reservation.
  if (owner !== undefined) {
    try { fs.unlinkSync(path.join(directory, owner)); } catch { /* Already released or reclaimed. */ }
  }
  try { fs.rmdirSync(directory); } catch { /* Missing or still owned. */ }
}

function hasActiveReservation(directory: string): boolean {
  let owner: string | undefined;
  try {
    [owner] = fs.readdirSync(directory);
    if (owner !== undefined) {
      const age = Date.now() - Math.floor(fs.statSync(path.join(directory, owner)).mtimeMs);
      if (age >= 0 && age < NOTICE_RESERVATION_TTL_MS) return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  releaseReservation(directory, owner);
  return false;
}

/** Hold one notice per version until delivery, cancellation or expiration. */
export function reserveUpdateNotice(version: string): NoticeReservation {
  const directory = path.join(dataDir(), "update-notices");
  const marker = path.join(directory, version);
  const reservation = `${marker}.pending`;
  try {
    if (fs.existsSync(marker)) return "delivered";
    if (hasActiveReservation(reservation)) return "busy";
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const staging = fs.mkdtempSync(path.join(directory, ".pending-"));
    const owner = path.basename(staging);
    try {
      fs.writeFileSync(path.join(staging, owner), "", { flag: "wx", mode: 0o600 });
      // Publish a non-empty directory atomically so another process cannot take it over mid-claim.
      fs.renameSync(staging, reservation);
    } catch (error) {
      releaseReservation(staging, owner);
      if (fs.existsSync(marker)) return "delivered";
      if (fs.existsSync(reservation)) return "busy";
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
          if (fs.existsSync(path.join(reservation, owner))) return markNoticeDelivered(marker);
        } finally {
          release();
        }
      },
      release,
    };
  } catch {
    // Without persistent storage the caller can still show a notice per session.
    return { complete: () => noop, release: noop };
  }
}

/** Returns the relaunched command exit code, or undefined to continue locally. */
export async function offerTerminalUpdate(argv: string[], locale?: SetupLocale): Promise<number | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.GSC_UPDATE_CHECK === "0") return undefined;
  const update = await findAvailableUpdate();
  if (!update) return undefined;

  const { resolveSetupLocale } = await import("./setup/i18n.js");
  const { terminalPromptAdapter } = await import("./setup/flow.js");
  const es = (locale ?? resolveSetupLocale()) === "es";
  const prompt = terminalPromptAdapter(false);
  let accepted = false;
  try {
    accepted = await prompt.choose(
      es
        ? `GSC MCP ${update.version} disponible. 1) Actualizar ahora  2) Continuar [2]: `
        : `GSC MCP ${update.version} is available. 1) Update now  2) Continue [2]: `,
      ["update", "continue"],
      1,
    ) === 0;
  } catch {
    // A cancelled or closed terminal never constitutes approval.
    return undefined;
  } finally {
    prompt.close();
  }
  if (!accepted) return undefined;

  const failure = installVersion(update.installation, update.version);
  if (failure) {
    reportUpdateFailure(failure);
    return 1;
  }
  console.log(es ? `Actualizado a ${update.version}.` : `Updated to ${update.version}.`);
  const resumed = spawnSync(process.execPath, [...process.execArgv, update.installation.entrypoint, ...argv], {
    stdio: "inherit",
    env: { ...process.env, GSC_UPDATE_CHECK: "0" },
  });
  if (resumed.error) {
    console.error(es ? "No se pudo reanudar el comando. Vuelve a ejecutarlo." : "Could not resume the command. Run it again.");
  }
  return resumed.status ?? 1;
}
