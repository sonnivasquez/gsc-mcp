import { spawnSync } from "node:child_process";
export declare const UPDATE_PACKAGE_SPEC = "@sonnivasquez/gsc-mcp";
interface Command {
    program: string;
    args: string[];
}
export type GlobalInstallation = {
    command: Command;
    entrypoint: string;
} & ({
    manager: "npm";
    prefix: string;
} | {
    manager: "bun";
});
/** An undefined result leaves room for recovery after an inconclusive probe. */
export declare function findGlobalInstallation(file: string): Promise<GlobalInstallation | "not-global" | undefined>;
type UpdateFailure = "install_error" | "verify_error" | "busy" | "changed";
export declare function installVersion(installation: GlobalInstallation, latest: string, run?: typeof spawnSync): UpdateFailure | undefined;
export {};
