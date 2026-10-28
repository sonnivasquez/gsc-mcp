import { z } from "zod";
import { withAbort } from "../fetch-guard.js";
import type { AuthProvider } from "../auth-provider.js";
import { isAllowAllAllowlist } from "../profiles.js";
import { RequestBudget } from "./budget.js";
import { assertSearchAnalyticsRules } from "./analytics-rules.js";
import { GscError, propertyNotAllowed, throwForResponse, throwForTransport } from "./errors.js";

export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";
export type DataState = "final" | "all" | "hourly_all";

export interface AnalyticsFilter {
  dimension: string;
  operator: string;
  expression: string;
}

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions: string[];
  filters?: AnalyticsFilter[];
  searchType?: SearchType;
  dataState?: DataState;
  rowLimit?: number;
  maxFetchRows?: number;
  aggregationType?: string;
}

export interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryResult {
  rows: AnalyticsRow[];
  pagesFetched: number;
  truncated: boolean;
  upstreamAggregationType?: string;
  metadata?: { first_incomplete_date?: string; first_incomplete_hour?: string };
}

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface SitemapEntry {
  path: string;
  lastSubmitted: string | null;
  warnings: number;
  errors: number;
}

const WEBMASTERS = "https://www.googleapis.com/webmasters/v3/sites";
const INSPECTION = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

const MAX_PAGE = 25_000;

// Provider responses are parsed once, here, with zod. Parse failures carry
// field paths only — never received values, which may hold user queries.
const AnalyticsRowSchema = z.object({
  keys: z.array(z.string()).default([]),
  clicks: z.coerce.number(),
  impressions: z.coerce.number(),
  ctr: z.coerce.number(),
  position: z.coerce.number(),
});

const SearchAnalyticsResponse = z.object({
  rows: z.array(AnalyticsRowSchema).default([]),
  responseAggregationType: z.string().optional(),
  metadata: z.object({ first_incomplete_date: z.string().optional(), first_incomplete_hour: z.string().optional() }).optional(),
});

const SitesResponse = z.object({
  siteEntry: z
    .array(z.object({ siteUrl: z.string().default(""), permissionLevel: z.string().default("") }))
    .default([]),
});

const SitemapsResponse = z.object({
  sitemap: z
    .array(
      z.object({
        path: z.string().default(""),
        lastSubmitted: z.string().optional(),
        warnings: z.coerce.number().default(0),
        errors: z.coerce.number().default(0),
      })
    )
    .default([]),
});

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, body: unknown, op: string): z.output<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new GscError("UPSTREAM_SCHEMA_CHANGED", `${op} response shape changed (fields: ${paths || "root"})`);
}

function errorDetail(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const nested = body.error;
    if (typeof nested === "object" && nested !== null && "message" in nested && typeof nested.message === "string") {
      return nested.message.slice(0, 300);
    }
  }
  return "provider error";
}

// The AuthProvider surfaces plain Errors with a CODE prefix; the envelope
// needs typed errors, so the adapter translates at its boundary.
function authFailure(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const expired = message.startsWith("REAUTH_REQUIRED");
  throw new GscError(expired ? "AUTH_EXPIRED" : "AUTH_REQUIRED", message, {
    suggestedAction: "run `gsc auth login` in a terminal",
  });
}

export interface DataSourceOpts {
  budget?: RequestBudget;
  fetchImpl?: typeof fetch;
  // null = unenforced (tests). serve passes the instance allowlist.
  allowlist?: string[] | null;
  timeoutMs?: number;
  deadline?: number;
  signal?: AbortSignal;
}
// Fetch-based Search Console reader. Readonly by construction: only
// GET/POST-query endpoints exist here, and the scope tier comes from the
// provider (readonly unless explicitly full).
export class FetchGscDataSource {
  private readonly budget: RequestBudget;
  private readonly fetchImpl: typeof fetch;
  private readonly allowlist: string[] | null;
  private readonly timeoutMs: number | undefined;
  private readonly deadline?: number;
  private readonly signal?: AbortSignal;

  constructor(
    private readonly provider: AuthProvider,
    opts: DataSourceOpts = {}
  ) {
    this.budget = opts.budget ?? new RequestBudget();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.allowlist = opts.allowlist ?? null;
    this.timeoutMs = opts.timeoutMs;
    this.deadline = opts.deadline;
    this.signal = opts.signal;
  }

  private checkSite(siteUrl: string): void {
    if (this.allowlist === null) return;
    // Explicit allow-all opt-in covers every current + future property.
    if (isAllowAllAllowlist(this.allowlist)) return;
    if (!this.allowlist.includes(siteUrl)) {
      throw propertyNotAllowed(siteUrl, this.allowlist.length);
    }
  }

  private async fetchOnce(path: string, init: RequestInit, token: string, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal,
      });
    } catch (err) {
      throwForTransport(err);
    }
  }

  private async call(path: string, init: RequestInit, op: string): Promise<unknown> {
    if (this.deadline !== undefined && Date.now() >= this.deadline) throw new GscError("REQUEST_BUDGET_EXCEEDED", "call deadline reached");
    let token: string;
    try {
      token = this.signal
        ? await withAbort(this.provider.getAccessToken(), this.signal)
        : await this.provider.getAccessToken();
    } catch (err) {
      authFailure(err);
      throw new GscError("AUTH_REQUIRED", "unreachable");
    }
    return this.budget.run(async (_attempt, signal) => {
      const response = await this.fetchOnce(path, init, token, signal);
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        throwForResponse(response.status, response.statusText, errorDetail(body), response.headers);
      }
      if (body === null) {
        throw new GscError("UPSTREAM_SCHEMA_CHANGED", `${op} returned no JSON body`);
      }
      return body;
    }, {
      timeoutMs: this.deadline === undefined ? this.timeoutMs : Math.min(this.timeoutMs ?? 15000, Math.max(1, this.deadline - Date.now())),
      deadlineMs: this.deadline === undefined ? undefined : Math.max(0, this.deadline - Date.now()),
      signal: this.signal,
    });
  }

  async listSites(): Promise<SiteEntry[]> {
    const parsed = parseOrThrow(SitesResponse, await this.call(WEBMASTERS, { method: "GET" }, "sites.list"), "sites.list");
    return parsed.siteEntry;
  }

  async queryAnalytics(siteUrl: string, q: AnalyticsQuery): Promise<QueryResult> {
    this.checkSite(siteUrl);
    assertSearchAnalyticsRules(q);
    const pageSize = Math.min(q.rowLimit ?? MAX_PAGE, MAX_PAGE);
    const maxFetch = q.maxFetchRows ?? 5_000;
    const rows: AnalyticsRow[] = [];
    let startRow = 0;
    let pagesFetched = 0;
    let upstreamAggregationType: string | undefined;
    let metadata: QueryResult["metadata"];
    for (;;) {
      const body = await this.call(
        `${WEBMASTERS}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: q.startDate,
            endDate: q.endDate,
            dimensions: q.dimensions,
            dimensionFilterGroups: q.filters?.length
              ? [
                  {
                    filters: q.filters.map((f) => ({
                      dimension: f.dimension,
                      operator: f.operator,
                      expression: f.expression,
                    })),
                  },
                ]
              : undefined,
            type: q.searchType ?? "web",
            ...(q.aggregationType ? { aggregationType: q.aggregationType } : {}),
            dataState: q.dataState ?? "final",
            rowLimit: pageSize,
            startRow,
          }),
        },
        "searchAnalytics.query"
      );
      const parsed = parseOrThrow(SearchAnalyticsResponse, body, "searchAnalytics.query");
      const page = parsed.rows;
      upstreamAggregationType = parsed.responseAggregationType ?? upstreamAggregationType;
      if (parsed.metadata) {
        metadata ??= {};
        for (const key of ["first_incomplete_date", "first_incomplete_hour"] as const) {
          const value = parsed.metadata[key];
          if (value && (!metadata[key] || (key === "first_incomplete_hour" ? Date.parse(value) < Date.parse(metadata[key]!) : value < metadata[key]!))) metadata[key] = value;
        }
      }
      pagesFetched++;
      const room = maxFetch - rows.length;
      if (room <= 0) return { rows, pagesFetched, truncated: true, upstreamAggregationType, metadata };
      rows.push(...page.slice(0, room));
      if (page.length < pageSize) return { rows, pagesFetched, truncated: false, upstreamAggregationType, metadata };
      if (rows.length >= maxFetch) return { rows, pagesFetched, truncated: true, upstreamAggregationType, metadata };
      startRow += pageSize;
    }
  }

  async inspectUrl(siteUrl: string, inspectionUrl: string, languageCode?: string): Promise<unknown> {
    this.checkSite(siteUrl);
    return this.call(
      INSPECTION,
      {
        method: "POST",
        body: JSON.stringify({ inspectionUrl, siteUrl, ...(languageCode ? { languageCode } : {}) }),
      },
      "urlInspection.index.inspect"
    );
  }

  async listSitemaps(siteUrl: string): Promise<SitemapEntry[]> {
    this.checkSite(siteUrl);
    const parsed = parseOrThrow(
      SitemapsResponse,
      await this.call(`${WEBMASTERS}/${encodeURIComponent(siteUrl)}/sitemaps`, { method: "GET" }, "sitemaps.list"),
      "sitemaps.list"
    );
    return parsed.sitemap.map((s) => ({
      path: s.path,
      lastSubmitted: s.lastSubmitted ?? null,
      warnings: s.warnings,
      errors: s.errors,
    }));
  }
}
