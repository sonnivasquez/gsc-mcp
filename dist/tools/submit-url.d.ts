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
type IndexAction = "URL_UPDATED" | "URL_DELETED";
export declare function submitUrl(url: string, action?: IndexAction, clientOverride?: IndexingClientLike): Promise<SubmitResult>;
export declare function submitBatch(urls: string[], action?: IndexAction, clientOverride?: IndexingClientLike): Promise<{
    results: SubmitResult[];
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        note: string;
    };
}>;
export {};
