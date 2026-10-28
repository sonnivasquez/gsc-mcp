import { getAuthProvider } from "../auth-provider.js";
import { getInstanceAlias, getInstanceAllowlist, isAllowAllAllowlist, isPageUrlAllowedByAllowlist } from "../profiles.js";
import { FetchGscDataSource } from "../gsc/client.js";
import { RequestBudget } from "../gsc/budget.js";
import { GscError, propertyNotAllowed } from "../gsc/errors.js";
import type { ToolDeps } from "../gsc/tools.js";
import type { ResolveHost } from "../fetch-guard.js";
import type { Provenance, Warning } from "../gsc/envelope.js";
import { resolvePeriods } from "../gsc/periods.js";

export interface AuditDeps extends ToolDeps { resolveHost?: ResolveHost; deadlineMs?: number; signal?: AbortSignal; historyRoot?: string }
export function integer(value: number | undefined, fallback: number, max: number, name: string, min = 1): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new GscError("INVALID_ARGUMENT", `${name} must be ${min}..${max}`);
  return n;
}
export function pageUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new GscError("INVALID_ARGUMENT", "invalid absolute URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new GscError("INVALID_ARGUMENT", "only public http(s) URLs without credentials are supported");
  url.hash = "";
  return url.href;
}
export function period(input: { preset?: string; startDate?: string; endDate?: string }) {
  return resolvePeriods(input.preset || input.startDate || input.endDate ? input : { preset: "last_28_days" }).current;
}
export function message(err: unknown): string { return err instanceof Error ? err.message : String(err); }
export class AuditContext {
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly budget: RequestBudget;
  readonly ds: FetchGscDataSource;
  readonly alias: string;
  readonly allowlist: string[] | null;
  readonly warnings: Warning[] = [];
  readonly sources: Array<Omit<Provenance, "servedAt">> = [];
  constructor(readonly sites: string[], readonly deps: AuditDeps = {}) {
    this.alias = deps.profileAlias ?? getInstanceAlias() ?? "default(env)";
    this.allowlist = deps.allowlist === undefined ? getInstanceAllowlist() : deps.allowlist;
    this.deadline = Date.now() + Math.min(deps.deadlineMs ?? 60000, 60000);
    this.signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(Math.max(1, this.deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, this.deadline - Date.now()));
    this.budget = deps.budget ?? new RequestBudget();
    for (const site of sites) {
      if (!(site.startsWith("sc-domain:") ? /^sc-domain:[a-z0-9.-]+$/i.test(site) : /^https?:\/\//.test(site))) throw new GscError("INVALID_ARGUMENT", "invalid property identifier");
      if (this.allowlist !== null && !isAllowAllAllowlist(this.allowlist) && !this.allowlist.includes(site)) throw propertyNotAllowed(site, this.allowlist.length);
    }
    this.ds = new FetchGscDataSource(deps.provider ?? getAuthProvider(), { budget: this.budget, fetchImpl: deps.fetchImpl, allowlist: this.allowlist, deadline: this.deadline, signal: this.signal });
  }
  async authorize(): Promise<void> {
    // An all-properties profile still grants website access only to actual GSC properties.
    if (isAllowAllAllowlist(this.allowlist)) {
      const visible = await this.ds.listSites();
      for (const site of this.sites) if (!visible.some((s) => s.siteUrl === site)) throw new GscError("PROPERTY_PERMISSION_DENIED", "property is not visible to this account");
    }
  }
  accepts(raw: string, sites = this.sites): boolean {
    try { const url = pageUrl(raw); return isPageUrlAllowedByAllowlist(url, sites); } catch { return false; }
  }
  url(raw: string, site?: string): string {
    const url = pageUrl(raw);
    if (!this.accepts(url, site ? [site] : this.sites)) throw propertyNotAllowed(url, this.sites.length);
    return url;
  }
  remaining(): number {
    if (this.signal.aborted || Date.now() >= this.deadline) throw new GscError(this.deps.signal?.aborted ? "CANCELLED" : "REQUEST_BUDGET_EXCEEDED", "call stopped; request the next batch explicitly");
    return this.deadline - Date.now();
  }
  canContinue(): boolean { return !this.signal.aborted && Date.now() < this.deadline && this.budget.attemptsUsed < 12; }
  warn(code: string, msg: string): void { this.warnings.push({ code, message: msg }); }
  source(source: Provenance["source"], siteUrl?: string): void {
    if (this.sources.length < 20) this.sources.push({ source, siteUrl, fetchedAt: new Date().toISOString() });
  }
}
