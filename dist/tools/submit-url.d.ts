/** Narrow injected seam for mocked contract tests (no Google). */
export interface IndexingClientLike {
    urlNotifications: {
        publish: (args: {
            requestBody: {
                url: string;
                type: string;
            };
        }) => Promise<{
            data: {
                urlNotificationMetadata?: {
                    latestUpdate?: {
                        notifyTime?: string | null;
                    } | null;
                } | null;
            };
        }>;
    };
}
interface SubmitResult {
    url: string;
    type: string;
    notifyTime: string | null;
    success: boolean;
    error: string | null;
    note: string;
}
export declare function submitUrl(url: string, action?: "URL_UPDATED" | "URL_DELETED", clientOverride?: IndexingClientLike): Promise<SubmitResult>;
export declare function submitBatch(urls: string[], action?: "URL_UPDATED" | "URL_DELETED", clientOverride?: IndexingClientLike): Promise<{
    results: SubmitResult[];
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        note: string;
    };
}>;
export {};
