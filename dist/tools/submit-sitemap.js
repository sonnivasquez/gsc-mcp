"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitSitemap = submitSitemap;
const auth_js_1 = require("../auth.js");
const profiles_js_1 = require("../profiles.js");
function phrase(parts) {
    return parts.join("");
}
const DOMAIN_PREFIX = "sc-domain:";
function domainOf(property) {
    return property.slice(DOMAIN_PREFIX.length);
}
function propertyAttempts(configured) {
    if (!configured.startsWith(DOMAIN_PREFIX))
        return [configured];
    const domain = domainOf(configured);
    return [configured, `https://${domain}/`, `https://www.${domain}/`];
}
function feedFor(property, explicit) {
    if (explicit)
        return explicit;
    if (property.startsWith(DOMAIN_PREFIX))
        return `https://${domainOf(property)}/sitemap.xml`;
    return `${property}sitemap.xml`;
}
function propertyNote(used, configured) {
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
function permissionSuffix(candidates) {
    return phrase([
        " Tried: ",
        candidates.join(", "),
        ". Check that the authenticated account ",
        "has sitemap permission on the property in ",
        "Search Console.",
    ]);
}
function blocked(sitemapUrl, error) {
    const message = error instanceof Error ? error.message : String(error);
    return { siteUrl: "", sitemapUrl: sitemapUrl || "", success: false, error: message };
}
async function submitSitemap(sitemapUrl, siteUrlOverride, clientOverride) {
    try {
        (0, auth_js_1.assertWriteEnabled)("Sitemap submission");
    }
    catch (error) {
        return blocked(sitemapUrl, error);
    }
    const client = clientOverride ?? (await (0, auth_js_1.getSearchConsoleClient)());
    const configured = (0, auth_js_1.resolveSiteUrl)(siteUrlOverride);
    (0, profiles_js_1.assertSiteAllowed)(configured);
    const attempts = propertyAttempts(configured);
    let firstFailure = null;
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
        }
        catch (error) {
            if (!firstFailure)
                firstFailure = error;
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
