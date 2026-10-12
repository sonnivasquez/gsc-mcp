import type { AnalyticsRow } from "./client.js";
export declare const SEGMENTS_RULE_VERSION = "t13.1";
export interface SegmentDef {
    id: string;
    label: string;
    brandTerms?: string[];
    pathPrefix?: string;
    country?: string;
    device?: string;
}
export interface SegmentResult {
    id: string;
    label: string;
    rule: SegmentDef;
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
    matchedRows: number;
}
export interface SegmentsAnalysis {
    segments: SegmentResult[];
    unattributedRows: number;
    unattributedNote: string;
    classificationMode: "local_dataset";
    warnings: string[];
}
export declare function analyzeSegments(rows: AnalyticsRow[], dimensions: string[], defs: SegmentDef[]): SegmentsAnalysis;
