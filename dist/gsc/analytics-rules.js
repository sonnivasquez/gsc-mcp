"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsFilterListsSchema = exports.FILTER_LIST_DIMENSIONS = void 0;
exports.resolveReportType = resolveReportType;
exports.assertSearchAnalyticsRules = assertSearchAnalyticsRules;
const zod_1 = require("zod");
const errors_js_1 = require("./errors.js");
exports.FILTER_LIST_DIMENSIONS = ["country", "device"];
exports.analyticsFilterListsSchema = zod_1.z.array(zod_1.z.object({
    dimension: zod_1.z.enum(exports.FILTER_LIST_DIMENSIONS),
    expressions: zod_1.z.array(zod_1.z.string()).min(1),
}).strict()).min(1);
function resolveReportType(input) {
    return input.searchType ?? input.type ?? "web";
}
function reject(message, suggestedAction) {
    throw new errors_js_1.GscError("INVALID_ARGUMENT", message, { suggestedAction });
}
function assertSearchAnalyticsRules(input) {
    const dimensions = input.dimensions ?? [];
    const groups = [input, ...(input.dimensionFilterGroups ?? [])];
    const filters = groups.flatMap(group => group.filters ?? []);
    const filterDimensions = new Set(filters.map(filter => filter.dimension));
    const names = [...dimensions, ...filterDimensions];
    for (const group of groups) {
        if (group.filterLists === undefined)
            continue;
        const parsed = exports.analyticsFilterListsSchema.safeParse(group.filterLists);
        if (!parsed.success) {
            reject('filterLists must contain country or device entries with non-empty string arrays.', 'Omit filterLists or provide entries with a dimension and one or more expressions.');
        }
        for (const { dimension, expressions } of parsed.data) {
            if (filterDimensions.has(dimension)) {
                reject(`"${dimension}" cannot appear in both filters and filterLists in the same request.`, `Use only filters or only filterLists for "${dimension}".`);
            }
            if (dimension === "country" && expressions.some(value => !/^[a-z]{3}$/i.test(value))) {
                reject('country filterLists require three-letter country codes.', 'Use ISO 3166-1 alpha-3 codes such as PER or USA.');
            }
            if (dimension === "device" && expressions.some(value => !["DESKTOP", "MOBILE", "TABLET"].includes(value))) {
                reject('device filterLists require DESKTOP, MOBILE, or TABLET.', 'Use one or more of DESKTOP, MOBILE, and TABLET.');
            }
            names.push(dimension);
        }
    }
    const reportType = resolveReportType(input);
    if (reportType === "webMultimodal" && names.includes("query")) {
        reject('type "webMultimodal" does not support the query dimension or filter.', 'Remove query from dimensions and filters. Group by page, country, or date.');
    }
    if ((dimensions.includes("brandedClassification") || filterDimensions.has("brandedClassification")) && filterDimensions.has("query")) {
        reject('brandedClassification cannot be combined with a query filter.', 'Remove the query filter or remove brandedClassification from the request.');
    }
    if (filters.some(f => f.dimension === "brandedClassification" && (f.operator !== "equals" || (f.expression !== "BRANDED" && f.expression !== "NON_BRANDED")))) {
        reject('brandedClassification filters require equals and a supported classification.', 'Use operator "equals" with "BRANDED" or "NON_BRANDED".');
    }
    if (reportType === "discover") {
        const blocked = ["query", "device"].filter((name) => names.includes(name));
        if (blocked.length)
            reject(`type "discover" does not support ${blocked.join(" or ")} dimensions or filters.`, `Remove ${blocked.join(" and ")} from dimensions and filters.`);
    }
    if (reportType === "googleNews" && names.includes("query")) {
        reject('type "googleNews" does not support the query dimension or filter.', 'Remove query from dimensions and filters.');
    }
    if (dimensions.includes("searchAppearance") && dimensions.length !== 1) {
        reject('searchAppearance must be queried alone; filter a returned appearance in a second query.', 'Group by searchAppearance alone, then filter with operator "equals".');
    }
    if (filters.some((f) => f.dimension === "searchAppearance" && f.operator !== undefined && f.operator !== "equals")) {
        reject('searchAppearance filters must use operator "equals".', 'Filter searchAppearance with operator "equals".');
    }
    const aggregation = input.aggregationType;
    if (aggregation !== undefined && aggregation !== "" && !["auto", "byPage", "byProperty", "byNewsShowcasePanel"].includes(aggregation)) {
        reject('invalid aggregationType', 'Use auto, byPage, byProperty, or byNewsShowcasePanel.');
    }
    if (aggregation === "byProperty" && (reportType === "discover" || reportType === "googleNews")) {
        reject(`aggregationType "byProperty" is not supported for type "${reportType}".`, 'Use aggregationType "byPage" or "auto".');
    }
    if (aggregation === "byProperty" && names.includes("page")) {
        reject('aggregationType "byProperty" cannot be combined with page dimensions or filters.', 'Remove page or use aggregationType "auto".');
    }
    if (aggregation === "byNewsShowcasePanel") {
        const appearances = filters.filter(f => f.dimension === "searchAppearance");
        if (!["discover", "googleNews"].includes(reportType) || names.includes("page") || appearances.length !== 1 || (appearances[0].operator ?? "equals") !== "equals" || appearances[0].expression !== "NEWS_SHOWCASE") {
            reject('aggregationType "byNewsShowcasePanel" requires discover or googleNews, a NEWS_SHOWCASE equals filter, and no page dimension or filter.', 'Use the NEWS_SHOWCASE filter and remove page, or use auto.');
        }
    }
}
