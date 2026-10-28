import type { Warning } from "../gsc/envelope.js";
export interface AuditSession<T> {
    id: string;
    cursor: string;
    namespace: string;
    kind: string;
    input: Record<string, unknown>;
    touchedAt: number;
    busy: boolean;
    warnings: Warning[];
    state: T;
}
export declare class AuditSessionStore {
    private readonly sessions;
    private sweep;
    create<T>(namespace: string, kind: string, input: Record<string, unknown>, state: T): AuditSession<T>;
    get<T>(namespace: string, kind: string, cursor: string, supplied: Record<string, unknown>): AuditSession<T>;
    release<T>(s: AuditSession<T>): boolean;
    private bound;
}
export declare const auditSessions: AuditSessionStore;
export declare function namespace(alias: string, sites: string[], allowlist: string[] | null): string;
