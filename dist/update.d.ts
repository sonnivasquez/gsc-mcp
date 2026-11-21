import { findGlobalInstallation, installVersion } from "./update-install.js";
export declare const UPDATE_USAGE: string;
export interface UpdateDeps {
    registryFetchImpl?: typeof fetch;
    findInstallation?: typeof findGlobalInstallation;
    install?: typeof installVersion;
    installedVersion?: string;
}
export declare function runUpdate(argv: string[], deps?: UpdateDeps): Promise<number>;
export declare function reportUpdateFailure(failure: NonNullable<ReturnType<typeof installVersion>>): void;
