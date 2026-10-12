export type ExportFormat = "json" | "csv" | "markdown";
export interface ExportResult {
    path: string;
    bytes: number;
    rows: number;
    sha256: string;
    sidecarPath?: string;
}
export declare function exportDataset(root: string, name: string, format: ExportFormat, columns: string[], rows: Array<Record<string, number | string | null>>, meta: Record<string, unknown>): ExportResult;
