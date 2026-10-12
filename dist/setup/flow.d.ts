export type SetupClient = "desktop" | "code" | "both" | "print";
export type SetupScope = "readonly" | "full";
export declare function parseChoiceAnswer(answer: string, choiceCount: number, defaultIndex: number): number;
export interface PromptAdapter {
    choose(question: string, choices: readonly string[], defaultIndex: number): Promise<number>;
    text(question: string, fallback: string): Promise<string>;
    close(): void;
    /** Set by terminalPromptAdapter: true only for live TTY prompting. Absent (test stubs) means quiet. */
    readonly interactive?: boolean;
}
/** Terminal I/O is deliberately outside the setup decision model. */
export declare function terminalPromptAdapter(nonInteractive: boolean): PromptAdapter;
export declare function validatedChoice<T extends string>(choices: readonly T[], index: number): T;
export interface SetupFlowState {
    scope: SetupScope;
    site: string;
    client: SetupClient;
}
export declare function createSetupState(scope: SetupScope, site: string, client: SetupClient): SetupFlowState;
export declare function chooseProperty(properties: readonly string[], index: number): string;
