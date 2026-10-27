"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDateRange = getDateRange;
exports.getPriorDateRange = getPriorDateRange;
exports.fetchAllRows = fetchAllRows;
const auth_js_1 = require("./auth.js");
const profiles_js_1 = require("./profiles.js");
const errors_js_1 = require("./gsc/errors.js");
function phrase(parts) {
    return parts.join("");
}
function dayStamp(date) {
    return date.toISOString().slice(0, 10);
}
function moveDays(date, delta) {
    const moved = new Date(date.getTime());
    moved.setDate(moved.getDate() + delta);
    return moved;
}
function windowEndingYesterday(days, extraShift) {
    const end = moveDays(new Date(), -1 + extraShift);
    const start = moveDays(end, 1 - days);
    return { startDate: dayStamp(start), endDate: dayStamp(end) };
}
function getDateRange(days) {
    return windowEndingYesterday(days, 0);
}
function getPriorDateRange(days) {
    return windowEndingYesterday(days, -days);
}
function budgetExceeded(limit) {
    return new errors_js_1.GscError("REQUEST_BUDGET_EXCEEDED", phrase([
        "GenAI pull exceeded ",
        String(limit),
        " rows; narrow `days` and retry ",
        "(no partial data returned)",
    ]), { suggestedAction: phrase(["narrow `days` to a smaller window ", "and retry"]) });
}
function asRow(raw) {
    return {
        keys: raw.keys || [],
        clicks: raw.clicks || 0,
        impressions: raw.impressions || 0,
        ctr: raw.ctr || 0,
        position: raw.position || 0,
    };
}
function requestBody(params, startRow, pageSize) {
    const body = {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        dimensionFilterGroups: params.dimensionFilterGroups,
        rowLimit: pageSize,
        startRow,
        dataState: "all",
    };
    if (params.type)
        body.type = params.type;
    return body;
}
async function fetchAllRows(params, siteUrlOverride, clientOverride) {
    const client = clientOverride ?? (await (0, auth_js_1.getSearchConsoleClient)());
    const siteUrl = (0, auth_js_1.resolveSiteUrl)(siteUrlOverride);
    (0, profiles_js_1.assertSiteAllowed)(siteUrl);
    const collected = [];
    const pageSize = params.rowLimit || 25000;
    let startRow = 0;
    for (;;) {
        const response = await client.searchanalytics.query({
            siteUrl,
            requestBody: requestBody(params, startRow, pageSize),
        });
        const page = response.data.rows;
        if (!page || page.length === 0)
            break;
        for (const raw of page)
            collected.push(asRow(raw));
        const reachedCap = params.maxTotalRows !== undefined && collected.length >= params.maxTotalRows;
        const fullPage = page.length === pageSize;
        if (reachedCap && fullPage)
            throw budgetExceeded(params.maxTotalRows);
        if (reachedCap || !fullPage)
            break;
        startRow += pageSize;
    }
    return collected;
}
