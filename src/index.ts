#!/usr/bin/env node

import { runCli } from "./cli.js";

async function main() {
  const code = await runCli(process.argv.slice(2), {
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
