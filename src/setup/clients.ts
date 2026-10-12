// Multi-target client selection for the guided setup flow.
// Deterministic and testable: parsing never touches the filesystem and
// never guesses a path. File/CLI application lives in
// `src/client-config.ts`; this module only resolves *which* targets apply.
import { CLIENT_KINDS } from "../client-config.js";

export const SETUP_CLIENTS = ["desktop", "code", "cursor", "codex", "opencode", "pi", "generic", "print"] as const;
export type SetupClientTarget = (typeof SETUP_CLIENTS)[number];

const PRINT_ONLY: ReadonlySet<string> = new Set(["generic", "print"]);

/** Expand legacy aliases, split comma lists, dedupe while preserving order. */
export function parseClientFlags(rawValues: string[]): string[] {
  const expanded: string[] = [];
  for (const raw of rawValues) {
    for (const part of raw.split(",")) {
      const value = part.trim().toLowerCase();
      if (value.length === 0) continue;
      if (value === "both") {
        expanded.push("desktop", "code");
        continue;
      }
      expanded.push(value);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of expanded) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function validateClientTargets(targets: string[]): SetupClientTarget[] {
  const allowed = new Set<string>([...SETUP_CLIENTS, ...CLIENT_KINDS, "both"]);
  for (const target of targets) {
    if (!allowed.has(target)) {
      // No input echo: the rejected value may hold sensitive text.
      throw new Error(`Invalid --client value. Use ${SETUP_CLIENTS.join(", ")} (repeatable) or both.`);
    }
  }
  const printSelected = targets.filter((t) => PRINT_ONLY.has(t));
  const installSelected = targets.filter((t) => !PRINT_ONLY.has(t));
  if (printSelected.length > 0 && installSelected.length > 0) {
    throw new Error("Use --client print/generic alone: it only prints the config without writing or invoking.");
  }
  return targets as SetupClientTarget[];
}

/**
 * Parse one interactive client answer. The prompt lists numbered targets;
 * the answer is comma/space-separated 1-based indices, "all" for every
 * installing target, or "" for the default single target.
 */
export function parseClientSelectionAnswer(
  answer: string,
  orderedTargets: readonly string[] = ["desktop", "code", "cursor", "codex", "opencode", "pi", "print"],
  defaultIndex = 0
): SetupClientTarget[] {
  if (orderedTargets.length === 0) throw new Error("Invalid setup choice");
  const trimmed = answer.trim();
  if (trimmed === "") return [orderedTargets[defaultIndex] as SetupClientTarget];
  if (trimmed.toLowerCase() === "all") {
    return orderedTargets.filter((t) => !PRINT_ONLY.has(t)) as SetupClientTarget[];
  }
  const tokens = trimmed.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
  const picked: SetupClientTarget[] = [];
  const seen = new Set<number>();
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
      picked.push(orderedTargets[index] as SetupClientTarget);
    }
  }
  if (picked.length === 0) throw new Error("Invalid setup choice");
  return validateClientTargets(picked);
}
