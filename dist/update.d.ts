import type { SetupRuntime } from "./client-config.js";
/** Package spec reinstalled globally by the assisted updater. */
export declare const UPDATE_PACKAGE_SPEC = "@sonnivasquez/gsc-mcp";
export declare const UPDATE_USAGE: string;
/**
 * Spawn seam mirroring the client-config SpawnRunner (exact argv, no shell),
 * plus piped stdout for the post-install --version verification.
 */
export type UpdateRunner = (program: string, args: string[], opts: {
    stdio: "inherit" | "pipe";
}) => {
    status: number | null;
    error?: Error;
    stdout?: string;
};
export interface UpdateDeps {
    registryFetchImpl?: typeof fetch;
    runner?: UpdateRunner;
    runtime?: SetupRuntime;
    /** On-disk entry verified after install; defaults to this package's index.js. */
    entrypoint?: string;
    installedVersion?: string;
}
export declare function runUpdate(argv: string[], deps?: UpdateDeps): Promise<number>;
