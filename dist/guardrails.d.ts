export declare const GUARDRAIL_SUFFIX: string;
export declare const VISUAL_SUFFIX: string;
export declare const POSITION_CAVEAT: string;
export interface ToolProvenance {
    _meta: {
        source: string;
        tool: string;
        parameters: Record<string, unknown>;
        note: string;
    };
    data: unknown;
}
export declare function withMeta(data: unknown, toolName: string, params: Record<string, unknown>, source?: string, note?: string): ToolProvenance;
