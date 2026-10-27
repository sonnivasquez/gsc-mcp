import { assertWriteEnabled, getAuthMode } from "../auth.js";
import { authenticateWithOAuth } from "../oauth.js";
import { getInstanceAllowlist, isPageUrlAllowedByAllowlist } from "../profiles.js";
import { propertyNotAllowed } from "../gsc/errors.js";
import * as fs from "fs";

export interface IndexingClientLike {
  urlNotifications: {
    publish: (args: {
      requestBody: { url: string; type: string };
    }) => Promise<{
      data: {
        urlNotificationMetadata?: {
          latestUpdate?: { notifyTime?: string | null } | null;
        } | null;
      };
    }>;
  };
}

interface SubmitResult {
  url: string;
  type: string;
  notifyTime: string | null;
  success: boolean;
  error: string | null;
  note: string;
}

type IndexAction = "URL_UPDATED" | "URL_DELETED";

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const SUCCESS_NOTE = phrase([
  "Google has been notified. The Indexing ",
  "API officially supports JobPosting and ",
  "BroadcastEvent schema types, but processes ",
  "requests for all page types. Priority is ",
  "not guaranteed for non-job pages.",
]);

const FAILURE_NOTE = phrase([
  "Submission failed. Ensure the Indexing ",
  "API is enabled in your Google Cloud ",
  "project and the service account has ",
  "owner access in Search Console.",
]);

const QUOTA_LIMIT = 200;
const PACE_AFTER = 10;
const PACE_MS = 100;

function assertUrlAllowed(url: string): void {
  const allowlist = getInstanceAllowlist();
  if (allowlist === null) return;
  if (!isPageUrlAllowedByAllowlist(url, allowlist)) {
    throw propertyNotAllowed(url, allowlist.length);
  }
}

function failed(url: string, action: string, error: unknown): SubmitResult {
  const message = (error as { message?: string } | null)?.message || String(error);
  return { url, type: action, notifyTime: null, success: false, error: message, note: FAILURE_NOTE };
}

async function indexingClient(): Promise<IndexingClientLike> {
  assertWriteEnabled("URL submission");
  // Deferred on purpose: startup and metadata requests must not load the Indexing SDK.
  const { google } = await import("googleapis");
  const mode = getAuthMode();
  switch (mode) {
    case "oauth": {
      const oauth2Client = await authenticateWithOAuth();
      google.options({ auth: oauth2Client });
      break;
    }
    case "service_account": {
      const keyFile = process.env.GSC_KEY_FILE;
      if (!keyFile || !fs.existsSync(keyFile)) {
        throw new Error(phrase([
          "GSC_KEY_FILE is required for indexing ",
          "API in service_account mode.",
        ]));
      }
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ["https://www.googleapis.com/auth/indexing"],
      });
      google.options({ auth });
      break;
    }
    default: {
      const unexpected: never = mode;
      return unexpected;
    }
  }
  return google.indexing("v3") as unknown as IndexingClientLike;
}

function pace(count: number): Promise<void> {
  if (count <= PACE_AFTER) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, PACE_MS));
}

export async function submitUrl(
  url: string,
  action: IndexAction = "URL_UPDATED",
  clientOverride?: IndexingClientLike,
): Promise<SubmitResult> {
  try {
    assertWriteEnabled("URL submission");
    assertUrlAllowed(url);
    const indexing = clientOverride ?? (await indexingClient());
    const response = await indexing.urlNotifications.publish({
      requestBody: { url, type: action },
    });
    const notifyTime = response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null;
    return { url, type: action, notifyTime, success: true, error: null, note: SUCCESS_NOTE };
  } catch (error) {
    return failed(url, action, error);
  }
}

export async function submitBatch(
  urls: string[],
  action: IndexAction = "URL_UPDATED",
  clientOverride?: IndexingClientLike,
): Promise<{
  results: SubmitResult[];
  summary: { total: number; succeeded: number; failed: number; note: string };
}> {
  if (urls.length > QUOTA_LIMIT) {
    throw new Error(phrase([
      "Google's Indexing API has a daily quota ",
      "of 200 requests. You provided ",
      String(urls.length),
      " URLs. Please reduce to 200 or fewer.",
    ]));
  }

  const results: SubmitResult[] = [];
  for (const url of urls) {
    try {
      assertUrlAllowed(url);
    } catch (error) {
      results.push(failed(url, action, error));
      continue;
    }
    results.push(await submitUrl(url, action, clientOverride));
    await pace(urls.length);
  }

  const succeeded = results.filter((item) => item.success).length;
  const failedCount = results.length - succeeded;
  return {
    results,
    summary: {
      total: urls.length,
      succeeded,
      failed: failedCount,
      note: phrase([
        "Daily quota is 200 URL notifications. ",
        String(succeeded),
        " submitted successfully, ",
        String(failedCount),
        " failed.",
      ]),
    },
  };
}
