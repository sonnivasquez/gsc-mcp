#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_js_1 = require("./cli.js");
async function main() {
    const code = await (0, cli_js_1.runCli)(process.argv.slice(2), {
        serve: async (opts) => {
            const { serve } = await import("./server.js");
            await serve(opts);
        },
        setup: async (args) => {
            const { runSetup } = await import("./setup.js");
            return runSetup(args);
        },
    });
    process.exit(code);
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
