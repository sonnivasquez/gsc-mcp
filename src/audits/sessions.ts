import { randomUUID, createHash } from "node:crypto";
import type { Warning } from "../gsc/envelope.js";
import { GscError } from "../gsc/errors.js";

export interface AuditSession<T> {
  id: string; cursor: string; namespace: string; kind: string; input: Record<string, unknown>;
  touchedAt: number; busy: boolean; warnings: Warning[]; state: T;
}
const TTL = 15 * 60000;
export class AuditSessionStore {
  private readonly sessions = new Map<string, AuditSession<unknown>>();
  private sweep(now = Date.now()): void {
    for (const [id, s] of this.sessions) if (!s.busy && now - s.touchedAt >= TTL) this.sessions.delete(id);
  }
  create<T>(namespace: string, kind: string, input: Record<string, unknown>, state: T): AuditSession<T> {
    this.sweep();
    const s = { id: randomUUID(), cursor: randomUUID(), namespace, kind, input, state, touchedAt: Date.now(), busy: true, warnings: [] as Warning[] };
    this.sessions.set(s.id, s); this.bound(s.id); return s;
  }
  get<T>(namespace: string, kind: string, cursor: string, supplied: Record<string, unknown>): AuditSession<T> {
    this.sweep();
    const s = [...this.sessions.values()].find((s) => s.cursor === cursor);
    if (!s) throw new GscError("DATASET_EXPIRED", "audit cursor expired or process restarted; start a new audit");
    if (s.namespace !== namespace || s.kind !== kind) throw new GscError("PROPERTY_NOT_ALLOWED", "audit cursor belongs to another profile or operation");
    if (s.busy) throw new GscError("INVALID_ARGUMENT", "audit is already running");
    for (const [key, value] of Object.entries(supplied)) {
      if (key !== "cursor" && value !== undefined && JSON.stringify(value) !== JSON.stringify(s.input[key])) throw new GscError("INVALID_ARGUMENT", `continuation cannot change ${key}`);
    }
    s.busy = true; return s as AuditSession<T>;
  }
  release<T>(s: AuditSession<T>): boolean {
    s.busy = false; s.touchedAt = Date.now();
    try { this.bound(s.id); return this.sessions.has(s.id); } catch { return false; }
  }
  private bound(current: string): void {
    const bytes = () => [...this.sessions.values()].reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s)), 0);
    while (this.sessions.size > 100 || bytes() > 64 * 1024 * 1024) {
      const candidate = [...this.sessions.values()].find((s) => s.id !== current && !s.busy);
      if (!candidate) { this.sessions.delete(current); throw new GscError("REQUEST_BUDGET_EXCEEDED", "audit memory limit exceeded; narrow scope"); }
      this.sessions.delete(candidate.id);
    }
  }
}
export const auditSessions = new AuditSessionStore();
export function namespace(alias: string, sites: string[], allowlist: string[] | null): string {
  return createHash("sha256").update(JSON.stringify([alias, sites, allowlist])).digest("hex");
}
