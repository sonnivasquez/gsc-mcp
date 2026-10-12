export type ResolveHost = (host: string) => Promise<string[]>;
export declare const defaultResolveHost: ResolveHost;
export declare function isPrivateLiteral(hostOrIp: string): boolean;
export declare function assertPublicUrl(url: string, resolveHost?: ResolveHost): Promise<void>;
export interface GuardedFetchOpts {
    timeoutMs?: number;
    headers?: Record<string, string>;
    resolveHost?: ResolveHost;
    maxRedirects?: number;
    allowUrl?: (url: string) => boolean;
}
export interface GuardedFetchResult {
    response: Response;
    finalUrl: string;
}
export declare function guardedFetch(url: string, opts?: GuardedFetchOpts): Promise<GuardedFetchResult>;
export interface BoundedBodyOptions {
    maxBytes: number;
    timeoutMs: number;
}
export declare function readBoundedBody(response: Response, opts: BoundedBodyOptions): Promise<Buffer>;
