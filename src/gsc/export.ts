import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { GscError } from "./errors.js";

export type ExportFormat = "json" | "csv" | "markdown";

export interface ExportResult {
  path: string;
  bytes: number;
  rows: number;
  sha256: string;
  sidecarPath?: string;
}

// Writes only inside <root>/exports with a unique name (never overwrites).
// CSV text cells that could execute as spreadsheet formulas are neutralized;
// numeric columns pass through untouched.
export function exportDataset(
  root: string,
  name: string,
  format: ExportFormat,
  columns: string[],
  rows: Array<Record<string, number | string | null>>,
  meta: Record<string, unknown>
): ExportResult {
  if (process.env.GSC_EXPORTS !== "1") {
    throw new GscError("INVALID_ARGUMENT", "exports are disabled: set GSC_EXPORTS=1 to enable local dataset export");
  }
  if (!["json", "csv", "markdown"].includes(format)) {
    throw new GscError("INVALID_ARGUMENT", "format must be json, csv or markdown");
  }
  const safe = name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dataset";
  const dir = path.join(root, "exports");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const file = path.join(dir, `${safe}-${stamp}-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}.${format}`);
  const body = format === "json" ? toJson(columns, rows, meta) : format === "csv" ? toCsv(columns, rows) : toMarkdown(columns, rows, meta);
  const sidecarFile = format === "csv" ? file.replace(/\.csv$/, ".meta.json") : null;
  const sidecarBody = format === "csv" ? JSON.stringify(meta, null, 2) + "\n" : null;
  const created: string[] = [];
  const writeExclusive = (destination: string, contents: string): void => {
    let fd: number | null = null;
    let writeError: unknown = null;
    try {
      fd = fs.openSync(destination, "wx");
      created.push(destination);
      try {
        fs.writeFileSync(fd, contents, "utf8");
      } catch (err) {
        writeError = err;
        throw err;
      }
    } catch (err) {
      if (writeError !== null && err !== writeError) throw writeError;
      throw err;
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch (closeErr) {
          if (writeError !== null) throw writeError;
          throw closeErr;
        }
      }
    }
  };
  try {
    writeExclusive(file, body);
    if (sidecarFile !== null && sidecarBody !== null) writeExclusive(sidecarFile, sidecarBody);
  } catch (err) {
    for (const p of created) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Preserve the original failure; cleanup is best-effort.
      }
    }
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new GscError("UPSTREAM_ERROR", "export collision: retry the export");
    }
    throw err;
  }
  const bytes = Buffer.byteLength(body, "utf8");
  const result: ExportResult = {
    path: file,
    bytes,
    rows: rows.length,
    sha256: createHash("sha256").update(body, "utf8").digest("hex"),
  };
  if (sidecarFile !== null) result.sidecarPath = sidecarFile;
  return result;
}

function toJson(columns: string[], rows: Array<Record<string, number | string | null>>, meta: Record<string, unknown>): string {
  return JSON.stringify({ columns, rows, meta }, null, 2);
}

function csvCell(value: number | string | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const text = value.includes('"') ? value.replace(/"/g, '""') : value;
  const risky = /^[=+\-@]/.test(text);
  return `"${risky ? `'${text}` : text}"`;
}

function toCsv(columns: string[], rows: Array<Record<string, number | string | null>>): string {
  const lines = [columns.map((c) => csvCell(c)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c] ?? null)).join(","));
  return lines.join("\n") + "\n";
}

function toMarkdown(columns: string[], rows: Array<Record<string, number | string | null>>, meta: Record<string, unknown>): string {
  const head = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const lines = rows.map((r) => `| ${columns.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return `# Dataset export\n\nCoverage and methodology:\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n${head}\n${sep}\n${lines.join("\n")}\n`;
}
