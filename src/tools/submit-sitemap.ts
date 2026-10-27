import { assertWriteEnabled, getSearchConsoleClient, resolveSiteUrl } from "../auth.js";
import { assertSiteAllowed } from "../profiles.js";

export interface SitemapSubmitResult {
  siteUrl: string;
  sitemapUrl: string;
  success: boolean;
  error: string | null;
  note?: string;
}

type SitemapClient = Awaited<ReturnType<typeof getSearchConsoleClient>>;

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const DOMAIN_PREFIX = "sc-domain:";

function domainOf(property: string): string {
  return property.slice(DOMAIN_PREFIX.length);
}

function propertyAttempts(configured: string): string[] {
  if (!configured.startsWith(DOMAIN_PREFIX)) return [configured];
  const domain = domainOf(configured);
  return [configured, `https://${domain}/`, `https://www.${domain}/`];
}

function feedFor(property: string, explicit?: string): string {
  if (explicit) return explicit;
  if (property.startsWith(DOMAIN_PREFIX)) return `https://${domainOf(property)}/sitemap.xml`;
  return `${property}sitemap.xml`;
}

function propertyNote(used: string, configured: string): string | undefined {
  if (used === configured) {
    return undefined;
  }
  return phrase([
    "The configured property (",
    configured,
    ") rejected the call, so the ",
    "URL-prefix property (",
    used,
    ") was used instead. The results belong to ",
    "that property, which may differ from the domain ",
    "property's own sitemap list.",
  ]);
}

function permissionSuffix(candidates: string[]): string {
  return phrase([
    " Tried: ",
    candidates.join(", "),
    ". Check that the authenticated account ",
    "has sitemap permission on the property in ",
    "Search Console.",
  ]);
}

function blocked(sitemapUrl: string | undefined, error: unknown): SitemapSubmitResult {
  const message = error instanceof Error ? error.message : String(error);
  return { siteUrl: "", sitemapUrl: sitemapUrl || "", success: false, error: message };
}

export async function submitSitemap(
  sitemapUrl?: string,
  siteUrlOverride?: string,
  clientOverride?: SitemapClient,
): Promise<SitemapSubmitResult> {
  try {
    assertWriteEnabled("Sitemap submission");
  } catch (error) {
    return blocked(sitemapUrl, error);
  }

  const client = clientOverride ?? (await getSearchConsoleClient());
  const configured = resolveSiteUrl(siteUrlOverride);
  assertSiteAllowed(configured);
  const attempts = propertyAttempts(configured);
  let firstFailure: { message?: string } | null = null;

  for (const property of attempts) {
    const feedpath = feedFor(property, sitemapUrl);
    try {
      await client.sitemaps.submit({
        siteUrl: property,
        feedpath,
      });
      const note = propertyNote(property, configured);
      return {
        siteUrl: property,
        sitemapUrl: feedpath,
        success: true,
        error: null,
        ...(note ? { note } : {}),
      };
    } catch (error) {
      if (!firstFailure) firstFailure = error as { message?: string };
    }
  }

  const reason = firstFailure?.message || String(firstFailure);
  return {
    siteUrl: configured,
    sitemapUrl: sitemapUrl || feedFor(configured),
    success: false,
    error: reason + permissionSuffix(attempts),
  };
}
