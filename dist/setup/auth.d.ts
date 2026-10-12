import type { PromptAdapter } from "./flow.js";
import type { ScopeTier } from "../oauth.js";
import { type SetupLocale } from "./i18n.js";
export type SetupAuth = "shared" | "custom" | "service-account";
export declare function validateCredentialFile(file: string, mode: "custom" | "service-account"): void;
/**
 * An undefined access preserves legacy callers; null selects the canonical prompt/default.
 * The trailing locale selects the step-oriented prompt copy only: thrown
 * validation errors stay English-canonical and are localized at the
 * fail-closed rendering boundary in src/setup.ts.
 *
 * Interactively the auth and access prompts print a numbered list in the
 * same style as steps 2/3 (`  [1] label`) followed by a short
 * `Choose [1]: ` prompt; an empty answer selects the default (index 0)
 * while a non-numeric or out-of-range token throws the controlled
 * `Invalid setup choice` error without echoing input. Non-interactive
 * prompts (`--yes`/no TTY, or adapters without the interactive flag) fall
 * back to `choose` defaults and print no lists, preserving quiet output.
 */
export declare function decideAuth(prompt: PromptAdapter, requested: SetupAuth | null, tier: ScopeTier | null, writeFlag: boolean, access?: ScopeTier | null, locale?: SetupLocale): Promise<{
    mode: SetupAuth;
    scope: ScopeTier;
    write: boolean;
}>;
