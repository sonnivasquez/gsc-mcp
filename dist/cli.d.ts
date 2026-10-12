import { CLI_VERSION } from "./version.js";
export { CLI_VERSION };
export interface ServeOpts {
    profile?: string;
}
export interface CliHandlers {
    serve: (opts: ServeOpts) => Promise<void>;
    setup: (args: string[]) => Promise<number>;
}
export declare const HELP_TEXT: string;
export declare function runCli(argv: string[], handlers: CliHandlers): Promise<number>;
