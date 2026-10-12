export interface Dataset {
    id: string;
    profileAlias: string;
    columns: string[];
    rows: Array<Record<string, number | string | null>>;
    createdAt: string;
    expiresAt: string;
    byteSize: number;
}
export interface DatasetPage {
    datasetId: string;
    rows: Array<Record<string, number | string | null>>;
    columns: string[];
    totalRows: number;
    nextCursor: string | null;
    expiresAt: string;
}
export declare class DatasetStore {
    private readonly sets;
    private usageBytes;
    private evictExpired;
    private evictOldestWhileOver;
    create(profileAlias: string, columns: string[], rows: Array<Record<string, number | string | null>>, now?: number): Dataset;
    page(datasetId: string, profileAlias: string, opts?: {
        cursor?: string;
        limit?: number;
        columns?: string[];
    }): DatasetPage;
}
export declare const datasets: DatasetStore;
