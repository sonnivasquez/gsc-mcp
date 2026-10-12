import type { searchconsole_v1 } from "googleapis";
import * as fs from "fs";
import { authenticateWithOAuth, getScopeTier, scopesForTier } from "./oauth.js";
import { envAllowlist } from "./profiles.js";
import { resolveAccessPolicy } from "./access.js";

let cachedClient: searchconsole_v1.Searchconsole | null = null;

export type AuthMode = "service_account" | "oauth";

export type SearchConsoleClient = searchconsole_v1.Searchconsole;

// Canonical full enables writes. Legacy full still requires its original flag.
export function assertWriteEnabled(tool: string): void {
  const access = resolveAccessPolicy();
  if (access.writesEnabled) return;
  if (access.source === "canonical") {
    throw new Error(`${tool} is disabled in readonly mode. Set GSC_ACCESS_MODE=full to enable Google write operations.`);
  }
  if (access.scopeTier !== "full") {
    throw new Error(
      `${tool} needs full access, but this install is in read only mode. ` +
      `Set GSC_ACCESS_MODE=full to enable it explicitly. Legacy configuration requires GSC_SCOPES=full and GSC_ENABLE_WRITE=1.`
    );
  }
  throw new Error(`${tool} is disabled by legacy configuration. Set GSC_ACCESS_MODE=full to enable writes, or retain legacy GSC_ENABLE_WRITE=1.`);
}

export function getAuthMode(): AuthMode {
  const mode = process.env.GSC_AUTH_MODE?.toLowerCase();
  if (mode === "oauth") return "oauth";
  return "service_account";
}

export function getConfig() {
  const mode = getAuthMode();
  // Single centralized allowlist parser (profiles.envAllowlist): JSON-first,
  // legacy-compatible, fail-closed. Comma-bearing URL identifiers survive
  // exactly; malformed JSON throws instead of silently mis-splitting.
  const siteUrls = envAllowlist();

  if (mode === "service_account") {
    const keyFile = process.env.GSC_KEY_FILE;
    if (!keyFile) {
      throw new Error(
        "GSC_KEY_FILE environment variable is required in service_account mode. " +
        "Set it to the path of your service account JSON key file, " +
        "or switch to OAuth by setting GSC_AUTH_MODE=oauth."
      );
    }
    if (!fs.existsSync(keyFile)) {
      throw new Error(`Service account key file not found at: ${keyFile}`);
    }
    return { keyFile, siteUrls };
  }

  // OAuth mode
  return { keyFile: undefined, siteUrls };
}

export function resolveSiteUrl(siteUrlOverride?: string): string {
  const override = siteUrlOverride?.trim();
  if (!override) {
    throw new Error(
      "site_url is required for this tool. Pass the exact Search Console property " +
      "(for example, https://example.com/ or sc-domain:example.com)."
    );
  }
  return override;
}

async function getServiceAccountClient(): Promise<searchconsole_v1.Searchconsole> {
  const { keyFile } = getConfig();
  const scopes = scopesForTier(getScopeTier());
  const { google } = await import("googleapis");

  // Same scope set as the OAuth flow, including auth/indexing on the full
  // tier so submit tools work in service-account mode too (#2).
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes,
  });

  google.options({ auth });
  return google.searchconsole("v1");
}

async function getOAuthClient(): Promise<searchconsole_v1.Searchconsole> {
  const oauth2Client = await authenticateWithOAuth();
  const { google } = await import("googleapis");
  google.options({ auth: oauth2Client });
  return google.searchconsole("v1");
}

export async function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole> {
  if (cachedClient) return cachedClient;

  const mode = getAuthMode();

  if (mode === "oauth") {
    cachedClient = await getOAuthClient();
  } else {
    cachedClient = await getServiceAccountClient();
  }

  return cachedClient;
}
