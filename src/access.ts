export type AccessMode = "readonly" | "full";

export interface AccessPolicy {
  scopeTier: AccessMode;
  writesEnabled: boolean;
  source: "canonical" | "legacy";
}

export const INVALID_ACCESS_MODE =
  "Invalid GSC_ACCESS_MODE. Set it to readonly or full; legacy settings are ignored when it is present.";

/** Resolve on each call; an upgrade never promotes legacy full/write-off users. */
export function resolveAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  if (env.GSC_ACCESS_MODE !== undefined) {
    const mode = env.GSC_ACCESS_MODE;
    if (mode !== "readonly" && mode !== "full") throw new Error(INVALID_ACCESS_MODE);
    return { scopeTier: mode, writesEnabled: mode === "full", source: "canonical" };
  }
  // Preserve legacy parsing exactly, including case handling and the strict "1" flag.
  const scopeTier = env.GSC_SCOPES?.toLowerCase() === "full" ? "full" : "readonly";
  return { scopeTier, writesEnabled: scopeTier === "full" && env.GSC_ENABLE_WRITE === "1", source: "legacy" };
}
