export type AccessMode = "readonly" | "full";
export interface AccessPolicy {
    scopeTier: AccessMode;
    writesEnabled: boolean;
    source: "canonical" | "legacy";
}
export declare const INVALID_ACCESS_MODE = "Invalid GSC_ACCESS_MODE. Set it to readonly or full; legacy settings are ignored when it is present.";
/** Resolve on each call; an upgrade never promotes legacy full/write-off users. */
export declare function resolveAccessPolicy(env?: NodeJS.ProcessEnv): AccessPolicy;
