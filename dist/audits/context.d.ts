import { FetchGscDataSource } from "../gsc/client.js";
import { RequestBudget } from "../gsc/budget.js";
import type { ToolDeps } from "../gsc/tools.js";
import type { ResolveHost } from "../fetch-guard.js";
import type { Provenance, Warning } from "../gsc/envelope.js";
export interface AuditDeps extends ToolDeps {
    resolveHost?: ResolveHost;
    deadlineMs?: number;
    signal?: AbortSignal;
    historyRoot?: string;
}
export declare function integer(value: number | undefined, fallback: number, max: number, name: string, min?: number): number;
export declare function pageUrl(raw: string): string;
export declare function period(input: {
    preset?: string;
    startDate?: string;
    endDate?: string;
}): import("../gsc/periods.js").DateRange;
export declare function message(err: unknown): string;
export declare class AuditContext {
    readonly sites: string[];
    readonly deps: AuditDeps;
    readonly deadline: number;
    readonly signal: AbortSignal;
    readonly budget: RequestBudget;
    readonly ds: FetchGscDataSource;
    readonly alias: string;
    readonly allowlist: string[] | null;
    readonly warnings: Warning[];
    readonly sources: Array<Omit<Provenance, "servedAt">>;
    constructor(sites: string[], deps?: AuditDeps);
    authorize(): Promise<void>;
    accepts(raw: string, sites?: string[]): boolean;
    url(raw: string, site?: string): string;
    remaining(): number;
    canContinue(): boolean;
    warn(code: string, msg: string): void;
    source(source: Provenance["source"], siteUrl?: string): void;
}
