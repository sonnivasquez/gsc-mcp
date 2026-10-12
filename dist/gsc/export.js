"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportDataset = exportDataset;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("./errors.js");
// Writes only inside <root>/exports with a unique name (never overwrites).
// CSV text cells that could execute as spreadsheet formulas are neutralized;
// numeric columns pass through untouched.
function exportDataset(root, name, format, columns, rows, meta) {
    if (process.env.GSC_EXPORTS !== "1") {
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "exports are disabled: set GSC_EXPORTS=1 to enable local dataset export");
    }
    if (!["json", "csv", "markdown"].includes(format)) {
        throw new errors_js_1.GscError("INVALID_ARGUMENT", "format must be json, csv or markdown");
    }
    const safe = name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dataset";
    const dir = path.join(root, "exports");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    const file = path.join(dir, `${safe}-${stamp}-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}.${format}`);
    const body = format === "json" ? toJson(columns, rows, meta) : format === "csv" ? toCsv(columns, rows) : toMarkdown(columns, rows, meta);
    const sidecarFile = format === "csv" ? file.replace(/\.csv$/, ".meta.json") : null;
    const sidecarBody = format === "csv" ? JSON.stringify(meta, null, 2) + "\n" : null;
    const created = [];
    const writeExclusive = (destination, contents) => {
        let fd = null;
        let writeError = null;
        try {
            fd = fs.openSync(destination, "wx");
            created.push(destination);
            try {
                fs.writeFileSync(fd, contents, "utf8");
            }
            catch (err) {
                writeError = err;
                throw err;
            }
        }
        catch (err) {
            if (writeError !== null && err !== writeError)
                throw writeError;
            throw err;
        }
        finally {
            if (fd !== null) {
                try {
                    fs.closeSync(fd);
                }
                catch (closeErr) {
                    if (writeError !== null)
                        throw writeError;
                    throw closeErr;
                }
            }
        }
    };
    try {
        writeExclusive(file, body);
        if (sidecarFile !== null && sidecarBody !== null)
            writeExclusive(sidecarFile, sidecarBody);
    }
    catch (err) {
        for (const p of created) {
            try {
                fs.unlinkSync(p);
            }
            catch {
                // Preserve the original failure; cleanup is best-effort.
            }
        }
        if (err?.code === "EEXIST") {
            throw new errors_js_1.GscError("UPSTREAM_ERROR", "export collision: retry the export");
        }
        throw err;
    }
    const bytes = Buffer.byteLength(body, "utf8");
    const result = {
        path: file,
        bytes,
        rows: rows.length,
        sha256: (0, node_crypto_1.createHash)("sha256").update(body, "utf8").digest("hex"),
    };
    if (sidecarFile !== null)
        result.sidecarPath = sidecarFile;
    return result;
}
function toJson(columns, rows, meta) {
    return JSON.stringify({ columns, rows, meta }, null, 2);
}
function csvCell(value) {
    if (value === null)
        return "";
    if (typeof value === "number")
        return String(value);
    const text = value.includes('"') ? value.replace(/"/g, '""') : value;
    const risky = /^[=+\-@]/.test(text);
    return `"${risky ? `'${text}` : text}"`;
}
function toCsv(columns, rows) {
    const lines = [columns.map((c) => csvCell(c)).join(",")];
    for (const r of rows)
        lines.push(columns.map((c) => csvCell(r[c] ?? null)).join(","));
    return lines.join("\n") + "\n";
}
function toMarkdown(columns, rows, meta) {
    const head = `| ${columns.join(" | ")} |`;
    const sep = `| ${columns.map(() => "---").join(" | ")} |`;
    const lines = rows.map((r) => `| ${columns.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
    return `# Dataset export\n\nCoverage and methodology:\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n${head}\n${sep}\n${lines.join("\n")}\n`;
}
