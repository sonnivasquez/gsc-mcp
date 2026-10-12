"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitSitemap = submitSitemap;
const auth_js_1 = require("../auth.js");
const profiles_js_1 = require("../profiles.js");
/**
 * The Sitemaps API accepts sc-domain: properties directly, so the configured
 * property is always tried as-is first (#7). The URL-prefix conversions stay
 * on as fallbacks for accounts where the permission actually lives on a
 * matching URL-prefix property rather than the domain property.
 */
function sitemapPropertyCandidates(siteUrl) {
    if (siteUrl.startsWith("sc-domain:")) {
        const domain = siteUrl.replace("sc-domain:", "");
        return [siteUrl, `https://${domain}/`, `https://www.${domain}/`];
    }
    return [siteUrl];
}
function defaultSitemapUrl(property) {
    if (property.startsWith("sc-domain:")) {
        return `https://${property.replace("sc-domain:", "")}/sitemap.xml`;
    }
    return `${property}sitemap.xml`;
}
function fallbackNote(used, configured) {
    if (used === configured)
        return undefined;
    return (`The configured property (${configured}) rejected the call, so the ` +
        `URL-prefix property (${used}) was used instead. The results belong to ` +
        `that property, which may differ from the domain property's own sitemap list.`);
}
function permissionHint(candidates) {
    return (` Tried: ${candidates.join(", ")}. Check that the authenticated account ` +
        `has sitemap permission on the property in Search Console.`);
}
async function submitSitemap(sitemapUrl, siteUrlOverride, clientOverride) {
    try {
        (0, auth_js_1.assertWriteEnabled)("Sitemap submission");
    }
    catch (err) {
        return {
            siteUrl: "",
            sitemapUrl: sitemapUrl || "",
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    const client = clientOverride ?? await (0, auth_js_1.getSearchConsoleClient)();
    const configSiteUrl = (0, auth_js_1.resolveSiteUrl)(siteUrlOverride);
    (0, profiles_js_1.assertSiteAllowed)(configSiteUrl);
    const candidates = sitemapPropertyCandidates(configSiteUrl);
    let firstError = null;
    for (const property of candidates) {
        const feedpath = sitemapUrl || defaultSitemapUrl(property);
        try {
            await client.sitemaps.submit({ siteUrl: property, feedpath });
            const note = fallbackNote(property, configSiteUrl);
            return {
                siteUrl: property,
                sitemapUrl: feedpath,
                success: true,
                error: null,
                ...(note && { note }),
            };
        }
        catch (err) {
            if (!firstError)
                firstError = err;
        }
    }
    return {
        siteUrl: configSiteUrl,
        sitemapUrl: sitemapUrl || defaultSitemapUrl(configSiteUrl),
        success: false,
        error: (firstError?.message || String(firstError)) + permissionHint(candidates),
    };
}
