export interface ChangeRecord {
    schemaVersion: 1;
    id: string;
    siteUrl: string;
    profile: string;
    date: string;
    label: string;
    description: string;
    urls: string[];
    createdAt: string;
    idempotencyKey?: string;
}
export declare class HistoryStore {
    readonly profile: string;
    readonly siteUrl: string;
    private readonly check;
    readonly root: string;
    readonly folder: string;
    constructor(profile: string, siteUrl: string, root?: string, check?: () => void);
    private gate;
    private directory;
    private validId;
    private readJson;
    private usage;
    private locked;
    private write;
    record(input: Omit<ChangeRecord, "id" | "schemaVersion" | "siteUrl" | "profile" | "createdAt">): Promise<ChangeRecord>;
    list(): Promise<ChangeRecord[]>;
    get(id: string): Promise<ChangeRecord>;
    snapshot(id: string, input: unknown, result: unknown): Promise<string>;
    snapshots(id: string): Promise<unknown[]>;
    snapshotPage(id: string, cursor?: string): Promise<Record<string, unknown>>;
    delete(id: string): Promise<void>;
}
