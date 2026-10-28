import { randomUUID } from "node:crypto";
import { GscError } from "./errors.js";

export interface Dataset {
  id: string;
  profileAlias: string;
  columns: string[];
  rows: Array<Record<string, number | string | null>>;
  createdAt: string;
  expiresAt: string;
  byteSize: number;
}

export interface DatasetPage {
  datasetId: string;
  rows: Array<Record<string, number | string | null>>;
  columns: string[];
  totalRows: number;
  nextCursor: string | null;
  expiresAt: string;
}

const TTL_MS = 15 * 60_000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DATASETS = 100;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (typeof parsed.offset !== "number" || parsed.offset < 0 || !Number.isInteger(parsed.offset)) {
      throw new Error("bad offset");
    }
    return parsed.offset;
  } catch {
    throw new GscError("INVALID_ARGUMENT", "cursor is not a valid dataset cursor for this dataset");
  }
}

// Process-local navigation store: zero new Google calls while paging.
// Namespaced by profile alias: a handle from another profile is rejected,
// never served.
export class DatasetStore {
  private readonly sets = new Map<string, Dataset>();

  private usageBytes(): number {
    let total = 0;
    for (const ds of this.sets.values()) total += ds.byteSize;
    return total;
  }

  private evictExpired(now: number): void {
    for (const [id, ds] of this.sets) {
      if (Date.parse(ds.expiresAt) <= now) this.sets.delete(id);
    }
  }

  private evictOldestWhileOver(): void {
    while ((this.sets.size > MAX_DATASETS || this.usageBytes() > MAX_BYTES) && this.sets.size > 0) {
      const oldest = this.sets.keys().next();
      if (oldest.done) break;
      this.sets.delete(oldest.value);
    }
  }

  create(profileAlias: string, columns: string[], rows: Array<Record<string, number | string | null>>, now = Date.now()): Dataset {
    this.evictExpired(now);
    const createdAt = new Date(now).toISOString();
    const ds: Dataset = {
      id: randomUUID(),
      profileAlias,
      columns,
      rows,
      createdAt,
      expiresAt: new Date(now + TTL_MS).toISOString(),
      byteSize: Buffer.byteLength(JSON.stringify(rows), "utf8"),
    };
    this.sets.set(ds.id, ds);
    this.evictOldestWhileOver();
    if (!this.sets.has(ds.id)) {
      throw new GscError("REQUEST_BUDGET_EXCEEDED", "dataset store is full; narrow the query", {
        suggestedAction: "reduce maxFetchRows and retry",
      });
    }
    return ds;
  }

  page(datasetId: string, profileAlias: string, opts: { cursor?: string; limit?: number; columns?: string[] } = {}): DatasetPage {
    const ds = this.sets.get(datasetId);
    if (ds === undefined) {
      throw new GscError("DATASET_NOT_FOUND", "dataset id is unknown; re-run the query explicitly", {
        suggestedAction: "re-run the originating tool call",
      });
    }
    if (Date.parse(ds.expiresAt) <= Date.now()) {
      this.sets.delete(datasetId);
      throw new GscError("DATASET_EXPIRED", "dataset expired; re-run the query explicitly", {
        suggestedAction: "re-run the originating tool call",
      });
    }
    if (ds.profileAlias !== profileAlias) {
      throw new GscError("DATASET_NOT_FOUND", "dataset is unknown under the current profile", {
        suggestedAction: "re-run the query under the current profile",
      });
    }
    const offset = opts.cursor === undefined ? 0 : decodeCursor(opts.cursor);
    const limit = opts.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new GscError("INVALID_ARGUMENT", "limit must be an integer between 1 and 200");
    }
    const columns = opts.columns ?? ds.columns;
    for (const c of columns) {
      if (!ds.columns.includes(c)) {
        throw new GscError("INVALID_ARGUMENT", `column "${c}" was not in the original result`);
      }
    }
    const slice = ds.rows.slice(offset, offset + limit);
    let projected = slice.map((row) => {
      const out: Record<string, number | string | null> = {};
      for (const c of columns) out[c] = row[c] ?? null;
      return out;
    });
    let bytes = 0;
    projected = projected.filter((row, index) => {
      bytes += Buffer.byteLength(JSON.stringify(row), "utf8");
      return index === 0 || bytes <= 40000;
    });
    const next = offset + projected.length;
    return {
      datasetId,
      rows: projected,
      columns,
      totalRows: ds.rows.length,
      nextCursor: next < ds.rows.length ? encodeCursor(next) : null,
      expiresAt: ds.expiresAt,
    };
  }
}

export const datasets = new DatasetStore();
