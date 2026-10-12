export declare const SETUP_CLIENTS: readonly ["desktop", "code", "cursor", "codex", "opencode", "pi", "generic", "print"];
export type SetupClientTarget = (typeof SETUP_CLIENTS)[number];
/** Expand legacy aliases, split comma lists, dedupe while preserving order. */
export declare function parseClientFlags(rawValues: string[]): string[];
export declare function validateClientTargets(targets: string[]): SetupClientTarget[];
/**
 * Parse one interactive client answer. The prompt lists numbered targets;
 * the answer is comma/space-separated 1-based indices, "all" for every
 * installing target, or "" for the default single target.
 */
export declare function parseClientSelectionAnswer(answer: string, orderedTargets?: readonly string[], defaultIndex?: number): SetupClientTarget[];
