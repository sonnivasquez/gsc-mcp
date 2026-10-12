export type CapabilityKind = "read" | "write" | "fetch" | "local";
export interface CapabilityInfo {
    name: string;
    description: string;
    kind: CapabilityKind;
}
export declare const CANONICAL_TOOLS: CapabilityInfo[];
