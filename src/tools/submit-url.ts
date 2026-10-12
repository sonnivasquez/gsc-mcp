import { assertWriteEnabled, getAuthMode } from "../auth.js";
import { authenticateWithOAuth } from "../oauth.js";
import { getInstanceAllowlist, isPageUrlAllowedByAllowlist } from "../profiles.js";
import { propertyNotAllowed } from "../gsc/errors.js";
import * as fs from "fs";

async function getIndexingClient(): Promise<IndexingClientLike> {

  assertWriteEnabled("URL submission");

  // Metadata requests and MCP startup never need the Indexing SDK.
  // submitUrl has already checked the allowlist before reaching this path.
  const { google } = await import("googleapis");
  const mode = getAuthMode();

  if (mode === "oauth") {
    const oauth2Client = await authenticateWithOAuth();
    google.options({ auth: oauth2Client });
  } else {
    const keyFile = process.env.GSC_KEY_FILE;
    if (!keyFile || !fs.existsSync(keyFile)) {
      throw new Error("GSC_KEY_FILE is required for indexing API in service_account mode.");
    }
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });
    google.options({ auth });
  }

  return google.indexing("v3") as unknown as IndexingClientLike;
}

/** Narrow injected seam for mocked contract tests (no Google). */
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

// Whole-call allowlist rejection for submitted URLs, same matcher and error
// semantics as the image-audit page check. Null allowlist (library/test use)
// skips enforcement, matching assertSiteAllowed; empty allowlist denies all.
function assertSubmitUrlAllowed(url: string): void {
  const allowlist = getInstanceAllowlist();
  if (allowlist === null) return;
  if (!isPageUrlAllowedByAllowlist(url, allowlist)) {
    throw propertyNotAllowed(url, allowlist.length);
  }
}

interface SubmitResult {
  url: string;
  type: string;
  notifyTime: string | null;
  success: boolean;
  error: string | null;
  note: string;
}

export async function submitUrl(
  url: string,
  action: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED",
  clientOverride?: IndexingClientLike
): Promise<SubmitResult> {
  try {
    assertWriteEnabled("URL submission");
    // Local allowlist fail-fast before any client use: off-allowlist URLs are
    // rejected here instead of noisily at Google. Null allowlist
    // (library/test use) skips enforcement, matching assertSiteAllowed.
    assertSubmitUrlAllowed(url);

    const indexing: IndexingClientLike = clientOverride ?? (await getIndexingClient());

    const response = await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: action,
      },
    });

    return {
      url,
      type: action,
      notifyTime: response.data.urlNotificationMetadata?.latestUpdate?.notifyTime || null,
      success: true,
      error: null,
      note:
        "Google has been notified. The Indexing API officially supports JobPosting and BroadcastEvent schema types, but processes requests for all page types. Priority is not guaranteed for non-job pages.",
    };
  } catch (err: any) {
    return {
      url,
      type: action,
      notifyTime: null,
      success: false,
      error: err.message || String(err),
      note:
        "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
    };
  }
}

export async function submitBatch(
  urls: string[],
  action: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED",
  clientOverride?: IndexingClientLike
): Promise<{ results: SubmitResult[]; summary: { total: number; succeeded: number; failed: number; note: string } }> {
  if (urls.length > 200) {
    throw new Error(
      `Google's Indexing API has a daily quota of 200 requests. You provided ${urls.length} URLs. Please reduce to 200 or fewer.`
    );
  }

  // Per-URL mixed results (after the quota check): each off-allowlist URL
  // fails locally with zero client calls for that item, while allowed URLs
  // publish via the submitUrl path below (which re-checks gate+allowlist).
  // Ambiguous writes are never retried; the summary counts succeeded/failed.
  const results: SubmitResult[] = [];

  for (const url of urls) {
    try {
      assertSubmitUrlAllowed(url);
    } catch (err: any) {
      results.push({
        url,
        type: action,
        notifyTime: null,
        success: false,
        error: err.message || String(err),
        note:
          "Submission failed. Ensure the Indexing API is enabled in your Google Cloud project and the service account has owner access in Search Console.",
      });
      continue;
    }
    const result = await submitUrl(url, action, clientOverride);
    results.push(result);

    // Small delay to avoid rate limiting
    if (urls.length > 10) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    results,
    summary: {
      total: urls.length,
      succeeded,
      failed,
      note: `Daily quota is 200 URL notifications. ${succeeded} submitted successfully, ${failed} failed.`,
    },
  };
}
