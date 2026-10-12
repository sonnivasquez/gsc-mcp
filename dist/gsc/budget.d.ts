export interface RunOpts {
    timeoutMs?: number;
    signal?: AbortSignal;
    deadlineMs?: number;
}
export declare class RequestBudget {
    private readonly maxAttempts;
    private used;
    constructor(maxAttempts?: number);
    get attemptsUsed(): number;
    run<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, opts?: RunOpts): Promise<T>;
}
