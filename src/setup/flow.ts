import * as readline from "node:readline/promises";

export type SetupClient = "desktop" | "code" | "both" | "print";
export type SetupScope = "readonly" | "full";

export function parseChoiceAnswer(answer: string, choiceCount: number, defaultIndex: number): number {
  const trimmed = answer.trim();
  const index = Number(trimmed) - 1;
  return /^\d+$/.test(trimmed) && index >= 0 && index < choiceCount ? index : defaultIndex;
}

export interface PromptAdapter {
  choose(question: string, choices: readonly string[], defaultIndex: number): Promise<number>;
  text(question: string, fallback: string): Promise<string>;
  close(): void;
  /** Set by terminalPromptAdapter: true only for live TTY prompting. Absent (test stubs) means quiet. */
  readonly interactive?: boolean;
}

/** Terminal I/O is deliberately outside the setup decision model. */
export function terminalPromptAdapter(nonInteractive: boolean): PromptAdapter {
  if (nonInteractive || !process.stdin.isTTY) {
    return {
      choose: async (_question, _choices, defaultIndex) => defaultIndex,
      text: async (_question, fallback) => fallback,
      close: () => undefined,
      interactive: false,
    };
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    choose: async (question, choices, defaultIndex) => {
      return parseChoiceAnswer(await rl.question(question), choices.length, defaultIndex);
    },
    text: async (question, fallback) => (await rl.question(question)).trim() || fallback,
    close: () => rl.close(),
    interactive: true,
  };
}

export function validatedChoice<T extends string>(choices: readonly T[], index: number): T {
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new Error("Invalid setup choice");
  }
  return choices[index];
}

export interface SetupFlowState {
  scope: SetupScope;
  site: string;
  client: SetupClient;
}

export function createSetupState(scope: SetupScope, site: string, client: SetupClient): SetupFlowState {
  if (scope !== "readonly" && scope !== "full") throw new Error("Invalid setup scope");
  if (!site.trim()) throw new Error("A dashboard property is required");
  if (!["desktop", "code", "both", "print"].includes(client)) throw new Error("Invalid setup client");
  return { scope, site, client };
}

export function chooseProperty(properties: readonly string[], index: number): string {
  if (properties.length === 0) throw new Error("No Search Console properties available");
  return validatedChoice(properties, index);
}
