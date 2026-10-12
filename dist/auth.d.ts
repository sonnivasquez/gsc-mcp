import type { searchconsole_v1 } from "googleapis";
export type AuthMode = "service_account" | "oauth";
export type SearchConsoleClient = searchconsole_v1.Searchconsole;
export declare function assertWriteEnabled(tool: string): void;
export declare function getAuthMode(): AuthMode;
export declare function getConfig(): {
    keyFile: string;
    siteUrls: string[];
} | {
    keyFile: undefined;
    siteUrls: string[];
};
export declare function resolveSiteUrl(siteUrlOverride?: string): string;
export declare function getSearchConsoleClient(): Promise<searchconsole_v1.Searchconsole>;
