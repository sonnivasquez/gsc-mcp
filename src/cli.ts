import { CLI_VERSION } from "./version.js";
import { CANONICAL_TOOLS } from "./gsc/catalog.js";
import { initInstance } from "./profiles.js";
import { CLIENT_KINDS, packageEntrypointPath, printClientConfig } from "./client-config.js";

export { CLI_VERSION };

export interface ServeOpts {
  profile?: string;
}

export interface CliHandlers {
  serve: (opts: ServeOpts) => Promise<void>;
  setup: (args: string[]) => Promise<number>;
}

export const HELP_TEXT = `gsc ${CLI_VERSION} — Google Search Console MCP server (local, readonly by default)

  gsc [serve] [--profile <alias>]       Start the MCP stdio server (default)
  gsc setup [options]                   Guided Google sign-in and client config
  gsc setup access readonly|full [--client <name>] [--dry-run] [--yes]
                                       Change access on an existing client entry
  gsc setup enable-write [--client <name>] [--dry-run] [--yes]
                                       Deprecated: add legacy GSC_ENABLE_WRITE=1
  gsc setup disable-write [--client <name>] [--dry-run] [--yes]
                                       Deprecated: remove legacy GSC_ENABLE_WRITE
  gsc doctor [--online]                Offline check: runtime, paths, env, auth state
                                     (--online adds one bounded sites.list call)
  gsc update [--check]                Assisted update: reinstall the latest release
  gsc auth login                        Connect Google in this terminal (browser)
  gsc auth status [--online]            Show session state without secrets
  gsc auth logout                       Delete the local OAuth session
  gsc auth revoke --yes                 Revoke at Google and delete locally
  gsc config print --client <name> [--profile <alias>]
                                       Print an MCP client snippet to copy
  gsc --version                         Print version
  gsc --help                            This help

Clients: ${CLIENT_KINDS.join(", ")}

Environment:
  GSC_AUTH_MODE=oauth|service_account (default service_account)
  GSC_ACCESS_MODE=readonly|full Readonly or full Google access including writes
  GSC_ENABLE_WRITE=1          Legacy write opt-in (only without GSC_ACCESS_MODE)
  GSC_SITE_URLS               JSON array of exact property IDs, or "all" alone for all current + future properties (explicit opt-in; legacy comma list read)
  GSC_DATA_DIR                Local state dir (default ~/.gsc-mcp)
  GSC_KEY_FILE                Service account JSON (service_account mode)
  GSC_SCOPES=readonly|full    Legacy scope tier (only without GSC_ACCESS_MODE)
`;

function parseServeArgs(args: string[]): ServeOpts {
  const opts: ServeOpts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile") {
      const value = args[i + 1];
      if (value === undefined || value === "") {
        throw new Error("--profile needs a value: --profile <alias>");
      }
      opts.profile = value;
      i++;
    } else {
      throw new Error(`Unknown serve flag: ${args[i]}`);
    }
  }
  return opts;
}

export async function runCli(argv: string[], handlers: CliHandlers): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === "serve") {
    const serveArgs = cmd === undefined ? [] : argv.slice(1);
    let opts: ServeOpts;
    try {
      opts = parseServeArgs(serveArgs);
      initInstance(opts.profile);
    } catch (err) {
      console.error(`serve: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    await handlers.serve(opts);
    // serve is a daemon: connect() resolves once listening, but the process
    // must stay alive on the stdio event loop. Never return an exit code.
    await new Promise<never>(() => {});
  }
  switch (cmd) {
    case "setup":
      return handlers.setup(argv.slice(1));
    case "auth": {
      const sub = argv[1];
      try {
        if (!["login", "status", "logout", "revoke"].includes(sub ?? "")) {
          console.error("auth: expected login|status|logout|revoke. See --help.");
          return 2;
        }
        const { authLogin, authLogout, authRevoke, authStatusOffline, authStatusOnline } = await import("./auth-provider.js");
        if (sub === "login") {
          console.log(await authLogin());
          return 0;
        }
        if (sub === "status") {
          const online = argv.includes("--online");
          console.log(JSON.stringify(online ? await authStatusOnline() : authStatusOffline(), null, 2));
          return 0;
        }
        if (sub === "logout") {
          console.log(authLogout());
          return 0;
        }
        if (sub === "revoke") {
          console.log(await authRevoke(argv.includes("--yes")));
          return 0;
        }
      } catch (err) {
        console.error(`auth: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
      console.error("auth: expected login|status|logout|revoke. See --help.");
      return 2;
    }
    case "doctor": {
      const rest = argv.slice(1);
      if (rest.includes("--help") || rest.includes("-h")) {
        const { DOCTOR_USAGE } = await import("./doctor.js");
        console.log(DOCTOR_USAGE);
        return 0;
      }
      const online = rest.includes("--online");
      const unknown = rest.find((flag) => flag !== "--online");
      if (unknown !== undefined) {
        // No argv echo: the unknown token may hold sensitive text.
        void unknown;
        console.error("doctor: unknown flag. See: gsc doctor --help.");
        return 2;
      }
      const { runDoctor, runDoctorOnline } = await import("./doctor.js");
      console.log(JSON.stringify(online ? await runDoctorOnline({ toolCount: CANONICAL_TOOLS.length }) : runDoctor(), null, 2));
      return 0;
    }
    case "update": {
      // Lazy like the doctor/auth siblings so --version and --help stay light.
      const { runUpdate } = await import("./update.js");
      return runUpdate(argv.slice(1));
    }
    case "config": {
      if (argv[1] !== "print") {
        console.error(`config: expected "print". Usage: gsc config print --client <name> [--profile <alias>]`);
        return 2;
      }
      const clientFlag = argv.indexOf("--client");
      const client = clientFlag === -1 ? "" : (argv[clientFlag + 1] ?? "");
      const profileFlag = argv.indexOf("--profile");
      const profile = profileFlag === -1 ? undefined : argv[profileFlag + 1];
      try {
        console.log(
          printClientConfig(client, {
            command: process.execPath,
            entrypoint: packageEntrypointPath(),
            profile,
          })
        );
        return 0;
      } catch (err) {
        console.error(`config: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
    }
    case "--version":
    case "-v":
      console.log(CLI_VERSION);
      return 0;
    case "--help":
    case "-h":
    case "help":
      console.log(HELP_TEXT);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP_TEXT}`);
      return 2;
  }
}
