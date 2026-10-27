import type { searchconsole_v1 } from "googleapis";
import * as fs from "fs";
import { authenticateWithOAuth, getScopeTier, scopesForTier } from "./oauth.js";
import { envAllowlist } from "./profiles.js";
import { resolveAccessPolicy, type AccessPolicy } from "./access.js";

let cachedClient: searchconsole_v1.Searchconsole | null = null;

export type AuthMode = "service_account" | "oauth";

export type SearchConsoleClient = searchconsole_v1.Searchconsole;

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

function readonlyCanonicalMessage(tool: string): string {
  return phrase([
    tool,
    " is disabled in readonly mode. ",
    "Set GSC_ACCESS_MODE=full to enable ",
    "Google write operations.",
  ]);
}

function legacyScopeMessage(tool: string): string {
  return phrase([
    tool,
    " needs full access, but this install ",
    "is in read only mode. ",
    "Set GSC_ACCESS_MODE=full to enable it ",
    "explicitly. Legacy configuration ",
    "requires GSC_SCOPES=full and ",
    "GSC_ENABLE_WRITE=1.",
  ]);
}

function legacyFlagMessage(tool: string): string {
  return phrase([
    tool,
    " is disabled by legacy configuration. ",
    "Set GSC_ACCESS_MODE=full to enable ",
    "writes, or retain legacy ",
    "GSC_ENABLE_WRITE=1.",
  ]);
}

function writeRefusal(tool: string, access: AccessPolicy): Error {
  switch (access.source) {
    case "canonical":
      return new Error(readonlyCanonicalMessage(tool));
    case "legacy":
      if (access.scopeTier !== "full") return new Error(legacyScopeMessage(tool));
      return new Error(legacyFlagMessage(tool));
    default: {
      const unexpected: never = access.source;
      return unexpected;
    }
  }
}

export function assertWriteEnabled(tool: string): void {
  const access = resolveAccessPolicy();
  if (access.writesEnabled) return;
  throw writeRefusal(tool, access);
}

export function getAuthMode(): AuthMode {
  const configured = process.env.GSC_AUTH_MODE;
  if (typeof configured === "string" && configured.toLowerCase() === "oauth") return "oauth";
  return "service_account";
}

function missingKeyMessage(): string {
  return phrase([
    "GSC_KEY_FILE environment variable is ",
    "required in service_account mode. ",
    "Set it to the path of your service ",
    "account JSON key file, or switch to ",
    "OAuth by setting GSC_AUTH_MODE=oauth.",
  ]);
}

export function getConfig(): { keyFile: string | undefined; siteUrls: string[] } {
  const siteUrls = envAllowlist();
  const mode = getAuthMode();
  switch (mode) {
    case "oauth":
      return { keyFile: undefined, siteUrls };
    case "service_account": {
      const keyFile = process.env.GSC_KEY_FILE;
      if (!keyFile) throw new Error(missingKeyMessage());
      if (!fs.existsSync(keyFile)) {
        throw new Error(phrase(["Service account key file not found at: ", keyFile]));
      }
      return { keyFile, siteUrls };
    }
    default: {
      const unexpected: never = mode;
      return unexpected;
    }
  }
}

export function resolveSiteUrl(siteUrlOverride?: string): string {
  const chosen = siteUrlOverride?.trim() ?? "";
  if (chosen.length === 0) {
    throw new Error(phrase([
      "site_url is required for this tool. ",
      "Pass the exact Search Console property ",
      "(for example, https://example.com/ or ",
      "sc-domain:example.com).",
    ]));
  }
  return chosen;
}

async function loadGoogle() {
  // Deferred on purpose: MCP startup and metadata requests must not load the SDK.
  return import("googleapis");
}

async function serviceAccountClient(): Promise<searchconsole_v1.Searchconsole> {
  const { keyFile } = getConfig();
  const { google } = await loadGoogle();
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: scopesForTier(getScopeTier()),
  });
  google.options({ auth });
  return google.searchconsole("v1");
}

async function oauthClient(): Promise<searchconsole_v1.Searchconsole> {
  const oauth2Client = await authenticateWithOAuth();
  const { google } = await loadGoogle();
  google.options({ auth: oauth2Client });
  return google.searchconsole("v1");
}

export async function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole> {
  if (cachedClient) return cachedClient;
  const mode = getAuthMode();
  switch (mode) {
    case "oauth":
      cachedClient = await oauthClient();
      break;
    case "service_account":
      cachedClient = await serviceAccountClient();
      break;
    default: {
      const unexpected: never = mode;
      return unexpected;
    }
  }
  return cachedClient;
}
