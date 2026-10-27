"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReportType = resolveReportType;
exports.assertSearchAnalyticsRules = assertSearchAnalyticsRules;
const errors_js_1 = require("./errors.js");
const REPORT_TYPES = ["web", "image", "video", "news", "discover", "googleNews"];
function isReportType(value) {
    return REPORT_TYPES.includes(value);
}
function resolveReportType(input) {
    return input.searchType ?? input.type ?? "web";
}
function reject(message, suggestedAction) {
    throw new errors_js_1.GscError("INVALID_ARGUMENT", message, { suggestedAction });
}
function discoverBan(names) {
    const blocked = names.filter((name) => name === "query" || name === "device");
    if (blocked.length === 0)
        return;
    const label = blocked.length === 2 ? "query or device dimensions" : `${blocked[0]} dimension`;
    const listed = blocked.join(" and ");
    reject(`type "discover" does not support the ${label}. Remove ${listed} from dimensions and filters. Group Discover by page, country, date, or searchAppearance.`, `Remove ${listed} and group Discover by page, country, date, or searchAppearance.`);
}
function newsQueryBan(reportType, names) {
    if (!names.includes("query"))
        return;
    reject(`type "${reportType}" does not support the query dimension. Remove query from dimensions and filters. Group by page, country, device, date, or searchAppearance.`, "Remove query and group by page, country, device, date, or searchAppearance.");
}
function appearanceRules(dimensions, filters) {
    if (dimensions.includes("searchAppearance") && dimensions.length !== 1) {
        reject('searchAppearance cannot be grouped with other dimensions. Group by searchAppearance alone to list the values, then filter with operator "equals" on a second query that groups by the other dimensions.', 'Group by searchAppearance alone, then filter with operator "equals".');
    }
    const mismatched = filters.find((filter) => filter.dimension === "searchAppearance" && filter.operator !== undefined && filter.operator !== "equals");
    if (mismatched) {
        reject('searchAppearance filters must use operator "equals". Group by searchAppearance alone to learn the values, then filter with equals.', 'Filter searchAppearance with operator "equals".');
    }
}
function propertyAggregation(reportType, aggregationType) {
    if (aggregationType !== "byProperty")
        return;
    if (reportType !== "discover" && reportType !== "googleNews")
        return;
    reject(`aggregationType "byProperty" is not supported for type "${reportType}". Use "byPage" or "auto", or omit aggregationType.`, 'Use aggregationType "byPage" or "auto", or omit aggregationType.');
}
function applyReportRules(reportType, names) {
    switch (reportType) {
        case "discover":
            discoverBan(names);
            return;
        case "news":
        case "googleNews":
            newsQueryBan(reportType, names);
            return;
        case "web":
        case "image":
        case "video":
            return;
        default: {
            const unexpected = reportType;
            reject(`unexpected report type "${unexpected}"`, "use web, image, video, news, discover, or googleNews");
        }
    }
}
function assertSearchAnalyticsRules(input) {
    const dimensions = input.dimensions ?? [];
    const filters = input.filters ?? [];
    const names = [...dimensions, ...filters.map((filter) => filter.dimension)];
    const reportType = resolveReportType(input);
    if (isReportType(reportType))
        applyReportRules(reportType, names);
    appearanceRules(dimensions, filters);
    propertyAggregation(reportType, input.aggregationType);
}
