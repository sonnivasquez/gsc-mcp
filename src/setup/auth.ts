import * as fs from "node:fs";
import { CLI_VERSION } from "../version.js";
import type { PromptAdapter } from "./flow.js";
import type { ScopeTier } from "../oauth.js";
import { validatedChoice } from "./flow.js";
import { isSetupAffirmative, translateSetup, type SetupLocale } from "./i18n.js";

export type SetupAuth = "shared" | "custom" | "service-account";

export function validateCredentialFile(file: string, mode: "custom" | "service-account"): void {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Cannot read a valid ${mode} JSON credential file.`);
  }
  const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!object(value)) throw new Error(`Invalid ${mode} credential shape.`);
  if (mode === "custom") {
    const installed = value.installed;
    if (!object(installed) || typeof installed.client_id !== "string" || !installed.client_id.trim() ||
        typeof installed.client_secret !== "string" || !installed.client_secret.trim() ||
        !Array.isArray(installed.redirect_uris) || !installed.redirect_uris.some((uri) => typeof uri === "string" && uri.startsWith("http://127.0.0.1"))) {
      throw new Error("Custom OAuth requires a Desktop installed client JSON with client_id, client_secret, and loopback redirect_uris.");
    }
  } else if (value.type !== "service_account" || typeof value.client_email !== "string" ||
      !value.client_email.trim() || typeof value.private_key !== "string" || !value.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Service Account requires a service_account JSON with client_email and private_key.");
  }
}

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
export async function decideAuth(
  prompt: PromptAdapter,
  requested: SetupAuth | null,
  tier: ScopeTier | null,
  writeFlag: boolean,
  access?: ScopeTier | null,
  locale: SetupLocale = "en",
): Promise<{ mode: SetupAuth; scope: ScopeTier; write: boolean }> {
  const AUTH_MODES = ["shared", "custom", "service-account"] as const;
  const SCOPES = ["readonly", "full"] as const;
  const interactive = prompt.interactive === true;
  async function askSingle<T extends string>(
    titleKey: "authTitle" | "accessTitle",
    optionKeys: readonly ("authOptionShared" | "authOptionCustom" | "authOptionService" | "accessOptionReadonly" | "accessOptionFull" | "accessOptionFullExplained")[],
    choices: readonly T[],
    defaultIndex: number,
  ): Promise<T> {
    if (!interactive) {
      return validatedChoice(choices, await prompt.choose(translateSetup(locale, titleKey), choices, defaultIndex));
    }
    console.log(`\n${translateSetup(locale, titleKey)}`);
    optionKeys.forEach((key, i) => console.log(`  [${i + 1}] ${translateSetup(locale, key)}`));
    const trimmed = (await prompt.text(translateSetup(locale, "choosePrompt"), "")).trim();
    if (trimmed === "") return validatedChoice(choices, defaultIndex);
    // No input echo: the rejected token may hold sensitive text.
    if (!/^\d+$/.test(trimmed)) throw new Error("Invalid setup choice");
    return validatedChoice(choices, Number(trimmed) - 1);
  }
  const mode = requested ?? await askSingle("authTitle",
    ["authOptionShared", "authOptionCustom", "authOptionService"], AUTH_MODES, 0);
  if (access !== undefined) {
    const scope = access ?? (mode === "shared" ? "readonly" : await askSingle("accessTitle",
      ["accessOptionReadonly", "accessOptionFullExplained"], SCOPES, 0));
    if (mode === "shared" && scope === "full") {
      throw new Error(`Quick Connect is readonly-only in ${CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`);
    }
    return { mode, scope, write: scope === "full" };
  }
  if (mode === "shared" && (tier === "full" || writeFlag)) {
    throw new Error(`Quick Connect is readonly-only in ${CLI_VERSION}. Choose --auth custom or --auth service-account for full access.`);
  }
  const scope = tier ?? (mode === "shared" ? "readonly" : await askSingle("accessTitle",
    ["accessOptionReadonly", "accessOptionFull"], SCOPES, 0));
  let write = false;
  if (writeFlag && scope !== "full") throw new Error("--enable-write requires --scopes full and a custom or service-account authentication mode.");
  if (scope === "full") {
    write = writeFlag || isSetupAffirmative(await prompt.text(translateSetup(locale, "writeConfirm"), "n"), locale);
  }
  return { mode, scope, write };
}
