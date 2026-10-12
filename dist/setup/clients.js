"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETUP_CLIENTS = void 0;
exports.parseClientFlags = parseClientFlags;
exports.validateClientTargets = validateClientTargets;
exports.parseClientSelectionAnswer = parseClientSelectionAnswer;
// Multi-target client selection for the guided setup flow.
// Deterministic and testable: parsing never touches the filesystem and
// never guesses a path. File/CLI application lives in
// `src/client-config.ts`; this module only resolves *which* targets apply.
const client_config_js_1 = require("../client-config.js");
exports.SETUP_CLIENTS = ["desktop", "code", "cursor", "codex", "opencode", "pi", "generic", "print"];
const PRINT_ONLY = new Set(["generic", "print"]);
/** Expand legacy aliases, split comma lists, dedupe while preserving order. */
function parseClientFlags(rawValues) {
    const expanded = [];
    for (const raw of rawValues) {
        for (const part of raw.split(",")) {
            const value = part.trim().toLowerCase();
            if (value.length === 0)
                continue;
            if (value === "both") {
                expanded.push("desktop", "code");
                continue;
            }
            expanded.push(value);
        }
    }
    const seen = new Set();
    const out = [];
    for (const value of expanded) {
        if (!seen.has(value)) {
            seen.add(value);
            out.push(value);
        }
    }
    return out;
}
function validateClientTargets(targets) {
    const allowed = new Set([...exports.SETUP_CLIENTS, ...client_config_js_1.CLIENT_KINDS, "both"]);
    for (const target of targets) {
        if (!allowed.has(target)) {
            // No input echo: the rejected value may hold sensitive text.
            throw new Error(`Invalid --client value. Use ${exports.SETUP_CLIENTS.join(", ")} (repeatable) or both.`);
        }
    }
    const printSelected = targets.filter((t) => PRINT_ONLY.has(t));
    const installSelected = targets.filter((t) => !PRINT_ONLY.has(t));
    if (printSelected.length > 0 && installSelected.length > 0) {
        throw new Error("Use --client print/generic alone: it only prints the config without writing or invoking.");
    }
    return targets;
}
/**
 * Parse one interactive client answer. The prompt lists numbered targets;
 * the answer is comma/space-separated 1-based indices, "all" for every
 * installing target, or "" for the default single target.
 */
function parseClientSelectionAnswer(answer, orderedTargets = ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"], defaultIndex = 0) {
    if (orderedTargets.length === 0)
        throw new Error("Invalid setup choice");
    const trimmed = answer.trim();
    if (trimmed === "")
        return [orderedTargets[defaultIndex]];
    if (trimmed.toLowerCase() === "all") {
        return orderedTargets.filter((t) => !PRINT_ONLY.has(t));
    }
    const tokens = trimmed.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
    const picked = [];
    const seen = new Set();
    // No input echo: the rejected token may hold sensitive text.
    for (const token of tokens) {
        if (!/^\d+$/.test(token)) {
            throw new Error(`Invalid client selection: use numbers like 1,3.`);
        }
        const index = Number(token) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= orderedTargets.length) {
            throw new Error(`Invalid client selection: choose 1-${orderedTargets.length}.`);
        }
        if (!seen.has(index)) {
            seen.add(index);
            picked.push(orderedTargets[index]);
        }
    }
    if (picked.length === 0)
        throw new Error("Invalid setup choice");
    return validateClientTargets(picked);
}
