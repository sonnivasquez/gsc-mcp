import { AuditContext, type AuditDeps, integer, message } from "./context.js";
import { WebReader, pageFindings, normalized, type PageEvidence } from "./web.js";
import { discovery, discoverBatch } from "./sitemaps.js";
import { auditSessions, namespace, type AuditSession } from "./sessions.js";
import { HistoryStore } from "./history.js";
import { datasets } from "../gsc/datasets.js";
import { ok, fail, type ToolEnvelope, type Coverage } from "../gsc/envelope.js";
import { GscError } from "../gsc/errors.js";
import { resolvePeriods, shiftDays, type DateRange } from "../gsc/periods.js";
import type { AnalyticsRow, QueryResult } from "../gsc/client.js";
import { findOpportunities } from "../gsc/opportunities.js";

interface Common { siteUrl: string; preset?: string; startDate?: string; endDate?: string; resultLimit?: number; cursor?: string }
type Step<T> = { ok: true; value: T } | { ok: false; error: string; code: string };
type Work = Record<string, any>;
async function step<T>(ctx: AuditContext, work: Work, key: string, fn: () => Promise<T>): Promise<boolean> {
  if (work[key] !== undefined) return true;
  if (!ctx.canContinue()) return false;
  try { work[key] = { ok: true, value: await fn() }; }
  catch (err) {
    if (!ctx.canContinue() || (err instanceof GscError && ["REQUEST_BUDGET_EXCEEDED", "CANCELLED"].includes(err.code))) return false;
    work[key] = { ok: false, error: message(err), code: err instanceof GscError ? err.code : "UPSTREAM_ERROR" };
    ctx.warnings.push({ code: "PARTIAL", message: `${key}: ${message(err).slice(0, 240)}`, details: { persistentAuditFailure: true, step: key, failureCode: work[key].code } });
  }
  return true;
}
function value<T>(s: Step<T> | undefined): T | undefined { return s?.ok ? s.value : undefined; }
function window(input: Common): DateRange { return resolvePeriods(input.preset || input.startDate || input.endDate ? input : { preset: "last_28_days" }).current; }
async function analytics(ctx: AuditContext, site: string, url: string | undefined, range: DateRange, dimensions: string[] = [], maxFetchRows = 5000): Promise<QueryResult> {
  const result = await ctx.ds.queryAnalytics(site, { ...range, dimensions, dataState: "final", searchType: "web", filters: url ? [{ dimension: "page", operator: "equals", expression: url }] : undefined, maxFetchRows });
  ctx.source("google_search_console", site);
  if (result.truncated) ctx.warn("SOURCE_NOT_EXHAUSTIVE", "Analytic row retrieval reached its limit; missing keys are not zero");
  return result;
}
function summaryPage(p: PageEvidence) {
  const { text, links, ...rest } = p;
  return { ...rest, textExcerpt: text.slice(0, 500), extractedTextCharacters: text.length, linkCount: links.length, findings: pageFindings(p) };
}
function inspection(raw: unknown): unknown {
  const r = (raw as { inspectionResult?: { indexStatusResult?: Record<string, unknown> } })?.inspectionResult;
  const index = r?.indexStatusResult;
  if (!index) return { known: false, reason: "index status not returned by Google" };
  const fields = ["verdict", "coverageState", "robotsTxtState", "indexingState", "lastCrawlTime", "pageFetchState", "googleCanonical", "userCanonical", "crawledAs", "sitemap", "referringUrls"];
  return Object.fromEntries(fields.map((k) => [k, index[k] ?? null]));
}
function datesValid(date: string): void { resolvePeriods({ startDate: date, endDate: date }); }
function preview(data: any, maxItems = 20, maxText = 2000): any {
  if (typeof data === "string") return data.slice(0, maxText);
  if (Array.isArray(data)) return data.slice(0, maxItems).map((item) => preview(item, maxItems, maxText));
  if (data && typeof data === "object") return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, preview(v, maxItems, maxText)]));
  return data;
}
function evidenceRows(rows: unknown[]) {
  return rows.flatMap((row, index) => {
    const text = JSON.stringify(row), parts = Math.max(1, Math.ceil(text.length / 8000));
    return Array.from({ length: parts }, (_, part) => ({ index, part, parts, evidence: text.slice(part * 8000, (part + 1) * 8000) }));
  });
}
async function session<T extends Work>(kind: string, input: Work & { cursor?: string; resultLimit?: number }, sites: string[], deps: AuditDeps, init: (ctx: AuditContext) => T, run: (state: T, ctx: AuditContext, web: WebReader) => Promise<{ rows: unknown[]; complete: boolean; summary: Work }>): Promise<ToolEnvelope<unknown>> {
  let s: AuditSession<T> | undefined;
  try {
    const ctx = new AuditContext(sites, deps);
    const ns = namespace(ctx.alias, sites, ctx.allowlist);
    if (input.cursor) {
      s = auditSessions.get<T>(ns, kind, input.cursor, input);
      Object.assign(input, s.input);
    }
    else s = auditSessions.create(ns, kind, input, init(ctx));
    await ctx.authorize();
    ctx.warnings.push(...s.warnings);
    const state = s.state;
    let result;
    try { result = await run(state, ctx, new WebReader(ctx)); }
    catch (err) {
      if (err instanceof GscError && ["INVALID_ARGUMENT", "PROPERTY_NOT_ALLOWED", "PROPERTY_PERMISSION_DENIED"].includes(err.code)) throw err;
      ctx.warn("PARTIAL", message(err));
      result = { rows: state.output ?? [], complete: false, summary: { stopped: message(err) } };
    }
    s.warnings = [...new Map(ctx.warnings.filter((w) => w.details?.persistentAuditFailure === true).map((w) => [JSON.stringify(w), w])).values()];
    (state as Work).output = result.rows;
    if (!result.complete) ctx.warn("PARTIAL", "Explicit next call required; no work continues after this response");
    const store = deps.store ?? datasets;
    const created = store.create(ctx.alias, ["index", "part", "parts", "evidence"], evidenceRows([...result.rows, { kind: "audit_summary", summary: result.summary }]));
    const count = integer(input.resultLimit, 50, 200, "resultLimit");
    const retained = auditSessions.release(s);
    const auditId = s.id;
    const nextCursor = result.complete || !retained ? null : s.cursor;
    s = undefined;
    if (!retained && !result.complete) ctx.warn("PARTIAL", "Audit memory limit exceeded; evidence is available, but continuation requires a new audit with narrower scope");
    const coverage: Coverage = { sourceGuarantee: "resource_response", apiPaginationComplete: null, fetchedRows: result.rows.length, returnedRows: Math.min(count, result.rows.length), truncatedByProduct: result.rows.length > count || !result.complete, stoppedBecause: result.complete ? [] : ["explicit_next_batch"] };
    return ok({ auditId, nextCursor, complete: result.complete, summary: preview(result.summary), results: result.rows.slice(0, count).map((row: unknown) => preview(row)), evidencePreview: { arrayItemsMax: 20, stringCharactersMax: 2000, summaryEvidenceIndex: result.rows.length, fullEvidence: "gsc_get_dataset; concatenate evidence parts by index and part, then JSON.parse" }, resultsTotal: result.rows.length, ruleVersion: "audit.1" },
      { source: "local_dataset", fetchedAt: new Date().toISOString(), siteUrl: sites[0] }, {
        attempts: ctx.budget.attemptsUsed, warnings: ctx.warnings, sources: ctx.sources, datasetId: created.id, datasetExpiresAt: created.expiresAt,
        coverage,
        shrink: (data) => {
          if (data.results.length) {
            const results = data.results.slice(0, Math.floor(data.results.length / 2));
            coverage.returnedRows = results.length; coverage.truncatedByProduct = true;
            return { ...data, results };
          }
          const summary = preview(data.summary, 5, 512);
          return JSON.stringify(summary) !== JSON.stringify(data.summary) ? { ...data, summary } : null;
        },
      });
  } catch (err) { return fail(err); }
  finally { if (s) auditSessions.release(s); }
}

export interface PageAuditInput extends Common { urls?: string[] }
export async function gscPageAudit(input: PageAuditInput, deps: AuditDeps = {}) {
  return session("page", input, [input.siteUrl], deps, (ctx) => {
    if (!input.urls?.length || input.urls.length > 5) throw new GscError("INVALID_ARGUMENT", "provide 1..5 URLs");
    return { range: window(input), items: [...new Set(input.urls.map((u) => ctx.url(u, input.siteUrl)))].map((url) => ({ url } as Work)) };
  }, async (s, ctx, web) => {
    for (const item of s.items) {
      if (!await step(ctx, item, "html", async () => { const page = await web.page(item.url); item.matchText = page.text; return summaryPage(page); })) break;
      if (!await step(ctx, item, "totals", async () => await analytics(ctx, input.siteUrl, item.url, s.range))) break;
      if (!await step(ctx, item, "queries", async () => await analytics(ctx, input.siteUrl, item.url, s.range, ["query"]))) break;
      // Keep only snippets and matching evidence in the result, never arbitrary raw HTML.
      if (!item.matches && item.html.ok && item.queries.ok) {
        const p = item.html.value;
        // Literal matches use the extracted HTTP text, not semantic intent.
        const queryText = normalized(item.matchText ?? "");
        item.matches = item.queries.value.rows.filter((r: AnalyticsRow) => !!r.keys[0]).map((r: AnalyticsRow) => ({ query: r.keys[0], title: p.titles.some((t: string) => normalized(t).includes(normalized(r.keys[0]))), h1: p.h1.some((t: string) => normalized(t).includes(normalized(r.keys[0]))), text: item.matchText !== undefined ? queryText.includes(normalized(r.keys[0])) : null }));
        item.opportunities = findOpportunities("low_ctr", item.queries.value.rows);
      }
    }
    return { rows: s.items.map(({ matchText, ...rest }: Work) => rest), complete: s.items.every((i: Work) => i.html && i.totals && i.queries), summary: { period: s.range, pages: s.items.length, htmlRendering: "http_only; client-rendered content unknown", queryCoverage: "observed_rows_only" } };
  });
}

export interface IndexAuditInput extends Common { urls?: string[]; sitemapUrls?: string[]; selection?: "sitemap_order" | "recent_lastmod"; inspectLimit?: number }
export async function gscIndexingAudit(input: IndexAuditInput, deps: AuditDeps = {}) {
  return session("indexing", input, [input.siteUrl], deps, (ctx) => {
    if (input.urls && input.sitemapUrls) throw new GscError("INVALID_ARGUMENT", "provide URLs or sitemaps, not both");
    if (input.urls && (!input.urls.length || input.urls.length > 10000)) throw new GscError("INVALID_ARGUMENT", "provide 1..10000 URLs");
    if (input.sitemapUrls && (!input.sitemapUrls.length || input.sitemapUrls.length > 100)) throw new GscError("INVALID_ARGUMENT", "provide 1..100 sitemap roots");
    const entries = [...new Set(input.urls?.map((u) => ctx.url(u)) ?? [])].map((url) => ({ url, sitemap: null, lastmod: null }));
    const roots = input.sitemapUrls?.map((u) => ctx.url(u));
    return { discovery: discovery(roots), rootsLoaded: !!input.urls || !!roots, items: entries as Work[], selected: !!input.urls, selection: input.selection ?? "sitemap_order" };
  }, async (s, ctx, web) => {
    integer(input.inspectLimit, 10, 10, "inspectLimit");
    if (!s.rootsLoaded) {
      const roots = await ctx.ds.listSitemaps(input.siteUrl); s.discovery.queue = roots.map((r) => ctx.url(r.path)); s.rootsLoaded = true;
    }
    if (!s.selected) {
      await discoverBatch(s.discovery, web);
      if (!s.discovery.queue.length || s.discovery.capped) {
        let entries = [...s.discovery.entries];
        if (s.selection === "recent_lastmod") entries.sort((a, b) => (Number.isFinite(Date.parse(b.lastmod ?? "")) ? Date.parse(b.lastmod!) : -Infinity) - (Number.isFinite(Date.parse(a.lastmod ?? "")) ? Date.parse(a.lastmod!) : -Infinity) || a.url.localeCompare(b.url));
        s.items = entries; s.selected = true;
      }
    }
    let processed = 0;
    if (s.selected) for (const item of s.items) {
      if (item.inspection) continue;
      if (processed >= (input.inspectLimit ?? 10)) break;
      if (!await step(ctx, item, "inspection", async () => inspection(await ctx.ds.inspectUrl(input.siteUrl, item.url)))) break;
      processed++;
    }
    const failed = s.discovery.failures;
    if (failed.length) ctx.warn("PARTIAL", "Some sitemap resources could not be read; see discovery failures");
    const rows = s.items.map((i: Work) => {
      const index = value<Record<string, unknown>>(i.inspection);
      return { ...i, canonicalDifference: index?.googleCanonical && index?.userCanonical ? { differs: index.googleCanonical !== index.userCanonical, google: index.googleCanonical, declared: index.userCanonical } : null };
    });
    return { rows, complete: s.selected && s.items.every((i: Work) => i.inspection), summary: { discovered: s.items.length || s.discovery.entries.length, attempted: s.items.filter((i: Work) => i.inspection).length, inspected: s.items.filter((i: Work) => i.inspection?.ok).length, discoveryComplete: !s.discovery.queue.length && !s.discovery.capped && !failed.length, sitemapFailures: failed, remainingSitemaps: s.discovery.queue.length, sampleOnly: true, note: "Google indexed view; no live test or indexing request" } };
  });
}

export interface InternalLinkInput extends Common { startUrls?: string[]; sitemapUrls?: string[]; maxPages?: number; batchSize?: number }
export async function gscInternalLinkAudit(input: InternalLinkInput, deps: AuditDeps = {}) {
  return session("links", input, [input.siteUrl], deps, (ctx) => {
    if (!input.startUrls?.length || input.startUrls.length > 100) throw new GscError("INVALID_ARGUMENT", "provide 1..100 startUrls");
    const seeds = [...new Set(input.startUrls.map((u) => ctx.url(u)))];
    return { range: window(input), maxPages: integer(input.maxPages, 100, 500, "maxPages"), queue: seeds.map((url) => ({ url, depth: 0 } as Work)), seen: [] as string[], pages: [] as Work[], inventory: seeds, discovery: discovery(input.sitemapUrls?.map((u) => ctx.url(u))), analytics: undefined as Step<QueryResult> | undefined, contextQueries: {} as Work, queryTargets: undefined as string[] | undefined };
  }, async (s, ctx, web) => {
    const batch = integer(input.batchSize, 20, 50, "batchSize");
    if (s.discovery.queue.length) await discoverBatch(s.discovery, web);
    await step(ctx, s, "analytics", async () => await analytics(ctx, input.siteUrl, undefined, s.range, ["page"]));
    for (const e of s.discovery.entries) if (!s.inventory.includes(e.url)) s.inventory.push(e.url);
    for (const r of value(s.analytics)?.rows ?? []) if (ctx.accepts(r.keys[0]) && !s.inventory.includes(r.keys[0])) s.inventory.push(r.keys[0]);
    let count = 0;
    while (s.queue.length && s.seen.length < s.maxPages && count < batch && ctx.canContinue()) {
      const item = s.queue[0];
      if (s.seen.includes(item.url)) { s.queue.shift(); continue; }
      if (!await step(ctx, item, "html", async () => await web.page(item.url, true))) break;
      if (item.html.ok) {
        const p: PageEvidence = item.html.value;
        for (const link of p.links) if (ctx.accepts(link.url)) {
          if (!s.inventory.includes(link.url) && s.inventory.length < 10000) s.inventory.push(link.url);
          if (!link.rel.includes("nofollow") && !s.seen.includes(link.url) && !s.queue.some((q: Work) => q.url === link.url) && s.queue.length < 10000) s.queue.push({ url: link.url, depth: item.depth === null ? null : item.depth + 1 });
        }
      }
      s.pages.push(item); s.seen.push(item.url); s.queue.shift(); count++;
    }
    // Seeds and linked pages establish depth. Inventory-only pages are fetched afterwards with unknown depth.
    if (!s.queue.length && s.seen.length < s.maxPages) {
      for (const url of s.inventory) if (!s.seen.includes(url)) s.queue.push({ url, depth: null });
    }
    const incoming = new Map<string, Set<string>>();
    for (const item of s.pages) if (item.html.ok) for (const link of (item.html.value as PageEvidence).links) if (ctx.accepts(link.url)) {
      const source = (item.html.value as PageEvidence).finalUrl;
      if (link.url !== source) { const set = incoming.get(link.url) ?? new Set(); set.add(source); incoming.set(link.url, set); }
    }
    const metrics = new Map((value(s.analytics)?.rows ?? []).map((r: AnalyticsRow) => [r.keys[0], r]));
    const crawlDone = (!s.queue.length || s.seen.length >= s.maxPages) && (!s.discovery.queue.length || s.discovery.capped);
    if (crawlDone && !s.queryTargets) {
      s.queryTargets = s.pages.filter((i: Work) => i.html.ok && i.html.value.status === 200)
        .sort((a: Work, b: Work) => (metrics.get(b.url)?.impressions ?? 0) - (metrics.get(a.url)?.impressions ?? 0) || a.url.localeCompare(b.url))
        .slice(0, 5).map((i: Work) => i.url);
    }
    for (const url of s.queryTargets ?? []) {
      if (!await step(ctx, s.contextQueries, url, () => analytics(ctx, input.siteUrl, url, s.range, ["query"]))) break;
    }
    const normalizedText = new Map<string, string>();
    for (const p of s.pages) if (p.html.ok) normalizedText.set(p.url, normalized(p.html.value.text));
    const fetched = new Map(s.pages.map((p: Work) => [p.url, p]));
    const rows = s.inventory.map((url: string) => {
      const item = fetched.get(url) as Work | undefined; const page = value<PageEvidence>(item?.html); const metric = metrics.get(url) as AnalyticsRow | undefined;
      const suggestions: unknown[] = [];
      if (page && page.status === 200 && !pageFindings(page).some((f) => f.code === "NOINDEX")) {
        const suggestedSources = new Set<string>();
        const headingTerms = [...page.titles, ...page.h1].slice(0, 5).map((text) => ({ term: normalized(text), basis: "heading", impressions: null as number | null }));
        const queryTerms = (value<QueryResult>(s.contextQueries[url])?.rows ?? []).filter((r) => r.impressions >= 10 && !!r.keys[0]).sort((a, b) => b.impressions - a.impressions || a.keys[0].localeCompare(b.keys[0])).slice(0, 5).map((r) => ({ term: normalized(r.keys[0]), basis: "observed_query", impressions: r.impressions }));
        const terms = [...headingTerms, ...queryTerms].filter((t) => t.term.length >= 4);
        for (const origin of s.pages) {
          const p = value<PageEvidence>(origin.html);
          if (!p || p.status !== 200 || p.finalUrl === page.finalUrl || suggestedSources.has(p.finalUrl) || p.links.some((l) => l.url === url)) continue;
          const text = normalizedText.get(p.url) ?? ""; const matched = terms.find((t) => text.includes(t.term));
          if (matched) { const at = text.indexOf(matched.term); suggestedSources.add(p.finalUrl); suggestions.push({ sourceUrl: p.finalUrl, destinationUrl: url, matchedText: matched.term, basis: matched.basis, observedQueryImpressions: matched.impressions, excerpt: text.slice(Math.max(0, at - 60), at + matched.term.length + 100), score: matched.term.length }); }
        }
      }
      suggestions.sort((a: any, b: any) => b.score - a.score || a.sourceUrl.localeCompare(b.sourceUrl));
      const broken = page?.links.filter((l) => { const target = fetched.get(l.url) as Work | undefined; const evidence = value<PageEvidence>(target?.html); return evidence && (evidence.status >= 400 || evidence.redirects.length); }).map((l) => ({ ...l, status: value<PageEvidence>((fetched.get(l.url) as Work)?.html)?.status }));
      return { url, observedIncomingPages: incoming.get(url)?.size ?? 0, depth: item?.depth ?? null, metrics: metric ?? null, page: page ? summaryPage(page) : item?.html ?? { fetched: false }, linkIssues: broken ?? [], suggestions: suggestions.slice(0, 5) };
    }).sort((a: any, b: any) => (b.metrics?.impressions ?? 0) - (a.metrics?.impressions ?? 0) || a.observedIncomingPages - b.observedIncomingPages || a.url.localeCompare(b.url));
    const capped = s.seen.length >= s.maxPages && (s.queue.length > 0 || s.inventory.some((u: string) => !s.seen.includes(u)));
    if (capped) ctx.warn("CRAWL_LIMIT", "maxPages reached; graph is incomplete");
    if (s.discovery.failures.length) ctx.warn("PARTIAL", "Some sitemap resources or entries could not be read; see discovery failures");
    return { rows, complete: crawlDone && (s.queryTargets ?? []).every((url) => s.contextQueries[url]), summary: { contextQueryPages: s.queryTargets?.length ?? 0, contextQueryPagesCompleted: Object.keys(s.contextQueries).length, contextQueryPageLimit: 5, fetchedPages: s.seen.length, inventoryPages: s.inventory.length, remainingPages: s.queue.length, graphComplete: !capped && !s.queue.length && !s.discovery.queue.length && !s.discovery.capped && !s.discovery.failures.length && s.pages.every((i: Work) => i.html.ok), discoveryCapped: s.discovery.capped, remainingSitemaps: s.discovery.queue.length, sitemapFailures: s.discovery.failures, note: "No observed incoming links is not proof of an orphan page; JavaScript links are unknown" } };
  });
}

interface ChangeInput {
  date: string; label?: string; description?: string; urls: string[];
}
export interface ImpactInput extends Common {
  action: "record" | "list" | "analyze" | "delete";
  change?: ChangeInput; changeId?: string; idempotencyKey?: string; saveSnapshot?: boolean;
  before?: DateRange; after?: DateRange; controlUrls?: string[]; batchSize?: number;
}
function comparisonWindows(date: string, before?: DateRange, after?: DateRange) {
  datesValid(date);
  const day = { startDate: date, endDate: date };
  const baseline = before ?? { startDate: shiftDays(day, -28).startDate, endDate: shiftDays(day, -1).endDate };
  const planned = after ?? { startDate: shiftDays(day, 7).startDate, endDate: shiftDays(day, 34).endDate };
  resolvePeriods(baseline); resolvePeriods(planned);
  if (baseline.endDate >= date || planned.startDate <= date) throw new GscError("INVALID_ARGUMENT", "before must end before the change; after must start after it");
  const cutoff = resolvePeriods({ preset: "last_7_days" }).current.endDate;
  const available = { ...planned, endDate: planned.endDate < cutoff ? planned.endDate : cutoff };
  return { before: baseline, plannedAfter: planned, after: available.startDate > available.endDate ? null : available, preliminary: available.endDate < planned.endDate, cutoff };
}
function duration(p: DateRange): number { return (Date.parse(p.endDate) - Date.parse(p.startDate)) / 86400000 + 1; }
function totals(r: QueryResult | undefined): AnalyticsRow | null { return r?.rows[0] ?? null; }
function changes(before: AnalyticsRow | null, after: AnalyticsRow | null, oldRange: DateRange, newRange: DateRange | null) {
  if (!before || !after || !newRange) return { comparable: false, before, after, reason: "missing observed aggregate or post-change window" };
  const beforeDaily = before.clicks / duration(oldRange), afterDaily = after.clicks / duration(newRange);
  return { comparable: true, before, after, dailyClicksBefore: beforeDaily, dailyClicksAfter: afterDaily, dailyClicksDelta: afterDaily - beforeDaily, dailyClicksDeltaPct: beforeDaily > 0 ? (afterDaily - beforeDaily) / beforeDaily * 100 : null, ctrDelta: after.ctr - before.ctr, positionImprovement: before.position - after.position };
}
function queryChanges(before: QueryResult | undefined, after: QueryResult | undefined) {
  const b = new Map(before?.rows.map((r) => [r.keys[0], r]) ?? []);
  const a = new Map(after?.rows.map((r) => [r.keys[0], r]) ?? []);
  return [...new Set([...b.keys(), ...a.keys()])].sort().map((query) => ({ query, before: b.get(query) ?? null, after: a.get(query) ?? null, observation: b.has(query) && a.has(query) ? "both" : b.has(query) ? "not_observed_after" : "not_observed_before" }));
}
function validateChange(c: ChangeInput | undefined, ctx: AuditContext): ChangeInput {
  if (!c || !c.urls?.length || c.urls.length > 100) throw new GscError("INVALID_ARGUMENT", "change needs date and 1..100 URLs");
  datesValid(c.date);
  if ((c.label?.length ?? 0) > 200 || (c.description?.length ?? 0) > 2000) throw new GscError("INVALID_ARGUMENT", "change label/description too long");
  return { ...c, urls: [...new Set(c.urls.map((u) => ctx.url(u)))] };
}
export async function gscChangeImpact(input: ImpactInput, deps: AuditDeps = {}): Promise<ToolEnvelope<unknown>> {
  try {
    const ctx = new AuditContext([input.siteUrl], deps);
    const history = new HistoryStore(ctx.alias, input.siteUrl, deps.historyRoot, () => { ctx.remaining(); });
    if (input.action !== "analyze") {
      if (input.cursor && (input.action !== "list" || !input.changeId)) throw new GscError("INVALID_ARGUMENT", "history cursor requires list with changeId");
      ctx.remaining();
      let result: unknown;
      if (input.action === "record") {
        const change = validateChange(input.change, ctx);
        if ((input.idempotencyKey?.length ?? 0) > 200) throw new GscError("INVALID_ARGUMENT", "idempotencyKey too long");
        result = await history.record({ date: change.date, label: change.label ?? "", description: change.description ?? "", urls: change.urls, idempotencyKey: input.idempotencyKey });
      } else if (input.action === "list") result = input.changeId ? await history.snapshotPage(input.changeId, input.cursor) : { changes: await history.list() };
      else if (input.action === "delete") { if (!input.changeId) throw new GscError("INVALID_ARGUMENT", "delete needs changeId"); await history.delete(input.changeId); result = { deleted: input.changeId }; }
      else throw new GscError("INVALID_ARGUMENT", "invalid change action");
      if ((result as Work).snapshotChunk) return ok(result, { source: "local_history", fetchedAt: new Date().toISOString(), siteUrl: input.siteUrl });
      const store = deps.store ?? datasets;
      const content = result as Work;
      const rows = Array.isArray(content.changes) ? content.changes : Array.isArray(content.snapshots) ? content.snapshots : [result];
      const ds = store.create(ctx.alias, ["index", "part", "parts", "evidence"], evidenceRows(rows));
      content.evidencePreview = { arrayItemsMax: 20, stringCharactersMax: 2000, fullEvidence: "gsc_get_dataset; group index and concatenate evidence parts" };
      if (input.action === "list") {
        if (content.changes) content.changesTotal = content.changes.length;
        if (content.snapshots && content.snapshotsTotal === undefined) content.snapshotsTotal = content.snapshots.length;
      }
      return ok(preview(result), { source: "local_history", fetchedAt: new Date().toISOString(), siteUrl: input.siteUrl }, { datasetId: ds.id, datasetExpiresAt: ds.expiresAt, shrink: (data: any) => data.snapshots?.length ? { ...data, snapshots: data.snapshots.slice(0, Math.floor(data.snapshots.length / 2)) } : data.changes?.length ? { ...data, changes: data.changes.slice(0, Math.floor(data.changes.length / 2)) } : null });
    }
    if (input.change && input.changeId) throw new GscError("INVALID_ARGUMENT", "provide change or changeId, not both");
    if (input.saveSnapshot && !input.changeId) throw new GscError("INVALID_ARGUMENT", "saveSnapshot requires a stored changeId");
    if (input.saveSnapshot && process.env.GSC_HISTORY !== "1") throw new GscError("INVALID_ARGUMENT", "saveSnapshot requires GSC_HISTORY=1");
    return await session("impact", input, [input.siteUrl], deps, (): Work => ({ initialized: false, items: [] as Work[], controls: [] as Work[] }), async (s, call) => {
      const callHistory = new HistoryStore(call.alias, input.siteUrl, deps.historyRoot, () => { call.remaining(); });
      if (!s.initialized) {
        const saved = input.changeId ? await callHistory.get(input.changeId) : undefined;
        const change = validateChange(saved ?? input.change, call);
        if ((input.controlUrls?.length ?? 0) > 3) throw new GscError("INVALID_ARGUMENT", "up to 3 explicit control URLs");
        s.change = change; s.windows = comparisonWindows(change.date, input.before, input.after);
        s.items = change.urls.map((url) => ({ url }));
        s.controls = [...new Set(input.controlUrls?.map((u) => call.url(u)) ?? [])].map((url) => ({ url }));
        if (s.controls.some((c: Work) => change.urls.includes(c.url))) throw new GscError("INVALID_ARGUMENT", "control URLs must differ from changed URLs");
        s.initialized = true;
      }
      const batchSize = integer(input.batchSize, 1, 3, "batchSize");
      const batchItems = s.items.filter((i: Work) => !(i.before && i.after && i.queriesBefore && i.queriesAfter)).slice(0, batchSize);
      for (const item of [...s.controls, ...batchItems]) {
        if (!await step(call, item, "before", async () => await analytics(call, input.siteUrl, item.url, s.windows.before))) break;
        if (!await step(call, item, "after", async () => s.windows.after ? await analytics(call, input.siteUrl, item.url, s.windows.after) : { rows: [], pagesFetched: 0, truncated: false })) break;
        if (s.items.includes(item)) {
          if (!await step(call, item, "queriesBefore", async () => await analytics(call, input.siteUrl, item.url, s.windows.before, ["query"]))) break;
          if (!await step(call, item, "queriesAfter", async () => s.windows.after ? await analytics(call, input.siteUrl, item.url, s.windows.after, ["query"]) : { rows: [], pagesFetched: 0, truncated: false })) break;
        }
      }
      const controls = s.controls.map((c: Work) => ({ url: c.url, comparison: changes(totals(value(c.before)), totals(value(c.after)), s.windows.before, s.windows.after) }));
      const validControls = controls.filter((c: any) => c.comparison.comparable && c.comparison.dailyClicksDeltaPct !== null);
      const controlMean = validControls.length ? validControls.reduce((sum: number, c: any) => sum + c.comparison.dailyClicksDeltaPct, 0) / validControls.length : null;
      const rows = s.items.map((i: Work) => {
        const comparison = changes(totals(value(i.before)), totals(value(i.after)), s.windows.before, s.windows.after);
        return { url: i.url, comparison, queryChanges: queryChanges(value(i.queriesBefore), value(i.queriesAfter)), steps: { before: i.before, after: i.after, queriesBefore: i.queriesBefore, queriesAfter: i.queriesAfter }, controlRelativeDeltaPp: comparison.comparable && comparison.dailyClicksDeltaPct !== null && controlMean !== null ? comparison.dailyClicksDeltaPct! - controlMean : null };
      });
      if (s.windows.preliminary) call.warn("PRELIMINARY", "Full post-change window not available; no extrapolation");
      const complete = s.items.every((i: Work) => i.before && i.after && i.queriesBefore && i.queriesAfter) && s.controls.every((i: Work) => i.before && i.after);
      const summary: Work = { change: s.change, windows: s.windows, controls, controlMeanDailyClicksDeltaPct: controlMean, note: "Observational before/after comparison; control differences are descriptive, not causal" };
      if (input.saveSnapshot) {
        try { summary.snapshotPath = await callHistory.snapshot(input.changeId!, { changeId: input.changeId, windows: s.windows, controls: s.controls.map((c: Work) => c.url), ruleVersion: "audit.1" }, { summary: { ...summary }, results: rows, complete }); }
        catch (err) { call.warn("PARTIAL", `Analysis succeeded but snapshot was not saved: ${message(err)}`); }
      }
      return { rows, complete, summary };
    });
  } catch (err) { return fail(err); }
}

export interface MigrationInput extends Omit<Common, "siteUrl"> {
  sourceSiteUrl: string; targetSiteUrl: string; mappings?: Array<{ oldUrl: string; newUrl: string }>;
  migrationDate?: string; batchSize?: number; before?: DateRange; after?: DateRange;
}
export async function gscMigrationAudit(input: MigrationInput, deps: AuditDeps = {}) {
  const sites = [...new Set([input.sourceSiteUrl, input.targetSiteUrl])];
  return session("migration", input, sites, deps, (ctx) => {
    if (!input.mappings?.length || input.mappings.length > 500 || !input.migrationDate) throw new GscError("INVALID_ARGUMENT", "provide migrationDate and 1..500 mappings");
    const mappings = new Map<string, string>();
    for (const m of input.mappings) {
      const old = ctx.url(m.oldUrl, input.sourceSiteUrl), target = ctx.url(m.newUrl, input.targetSiteUrl);
      if (mappings.has(old) && mappings.get(old) !== target) throw new GscError("INVALID_ARGUMENT", "old URL has contradictory destinations");
      if (old === target) throw new GscError("INVALID_ARGUMENT", "migration URLs must differ");
      mappings.set(old, target);
    }
    return { items: [...mappings].map(([oldUrl, newUrl]) => ({ oldUrl, newUrl } as Work)), windows: comparisonWindows(input.migrationDate, input.before, input.after), cache: {} as Work };
  }, async (s, ctx, web) => {
    const batch = integer(input.batchSize, 2, 5, "batchSize"); let processed = 0;
    const cached = async (key: string, fn: () => Promise<unknown>) => {
      if (!s.cache[key]) s.cache[key] = { value: await fn() };
      return s.cache[key].value;
    };
    for (const item of s.items) {
      if (item.done) continue;
      if (processed >= batch) break;
      if (!await step(ctx, item, "oldPage", async () => cached(`html:${item.oldUrl}`, async () => summaryPage(await web.page(item.oldUrl))))) break;
      if (!await step(ctx, item, "newPage", async () => cached(`html:${item.newUrl}`, async () => summaryPage(await web.page(item.newUrl))))) break;
      if (!await step(ctx, item, "oldInspection", async () => cached(`inspect:${input.sourceSiteUrl}:${item.oldUrl}`, async () => inspection(await ctx.ds.inspectUrl(input.sourceSiteUrl, item.oldUrl))))) break;
      if (!await step(ctx, item, "newInspection", async () => cached(`inspect:${input.targetSiteUrl}:${item.newUrl}`, async () => inspection(await ctx.ds.inspectUrl(input.targetSiteUrl, item.newUrl))))) break;
      for (const [name, site, url, range] of [
        ["oldBefore", input.sourceSiteUrl, item.oldUrl, s.windows.before], ["oldAfter", input.sourceSiteUrl, item.oldUrl, s.windows.after],
        ["newBefore", input.targetSiteUrl, item.newUrl, s.windows.before], ["newAfter", input.targetSiteUrl, item.newUrl, s.windows.after],
      ] as const) {
        if (!await step(ctx, item, name, async () => range ? cached(JSON.stringify([site, url, range]), () => analytics(ctx, site, url, range)) : { rows: [], pagesFetched: 0, truncated: false })) break;
      }
      if (!["oldBefore", "oldAfter", "newBefore", "newAfter"].every((k) => item[k])) break;
      item.done = true; processed++;
    }
    const rows = s.items.map((i: Work) => {
      const old = value<ReturnType<typeof summaryPage>>(i.oldPage), target = value<ReturnType<typeof summaryPage>>(i.newPage);
      const findings = [...(target?.findings ?? [])];
      const finding = (code: string, evidence: unknown) => findings.push({ code, evidence, priority: "review", ruleVersion: "audit.1" });
      if (old?.finalUrl !== undefined && old.finalUrl !== i.newUrl) finding("UNEXPECTED_DESTINATION", { expected: i.newUrl, actual: old.finalUrl });
      if (old && !old.redirects.length && old.status === 200) finding("OLD_URL_STILL_200", old.url);
      if (old?.redirects.some((r) => ![301, 308].includes(r.status))) finding("TEMPORARY_REDIRECT", old.redirects);
      if (old && old.redirects.length > 1) finding("REDIRECT_CHAIN", old.redirects);
      if (target?.canonicals.includes(i.oldUrl)) finding("CANONICAL_BACK_TO_OLD", i.oldUrl);
      const indexed = value<Record<string, unknown>>(i.newInspection);
      if (target?.canonicals[0] && indexed?.googleCanonical && indexed.googleCanonical !== target.canonicals[0]) finding("GOOGLE_CANONICAL_DIFFERS", { html: target.canonicals[0], google: indexed.googleCanonical });
      return { ...i, findings, oldComparison: changes(totals(value(i.oldBefore)), totals(value(i.oldAfter)), s.windows.before, s.windows.after), newComparison: changes(totals(value(i.newBefore)), totals(value(i.newAfter)), s.windows.before, s.windows.after) };
    });
    if (s.windows.preliminary) ctx.warn("PRELIMINARY", "Post-migration window incomplete");
    return { rows, complete: s.items.every((i: Work) => i.done), summary: { windows: s.windows, sourceSiteUrl: input.sourceSiteUrl, targetSiteUrl: input.targetSiteUrl, completedPairs: s.items.filter((i: Work) => i.done).length, totalPairs: s.items.length, note: "HTTP state is current; index state may lag; destination metrics are not summed across mappings" } };
  });
}
