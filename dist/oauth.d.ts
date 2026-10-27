export declare function tokenDir(): string;
export declare function cachedTokenPath(): string;
export type ScopeTier = "readonly" | "full";
export declare function getScopeTier(): ScopeTier;
export declare function scopesForTier(tier: ScopeTier): string[];
export declare function clearCachedToken(): void;
export declare function tokenPath(): string;
export declare function loadCachedToken(): any | null;
export declare function credentialsOnly(token: any): any;
export declare function cachedTokenCoversScopes(cachedToken: any): boolean;
export declare function cachedTokenSuitable(token: any, clientId: string): boolean;
export declare function saveCachedToken(token: any): void;
interface OAuthConfig {
    clientId: string;
    clientSecret: string;
}
export declare function getOAuthConfig(): OAuthConfig;
export declare const OAUTH_CALLBACK_HOST = "127.0.0.1";
export declare const OAUTH_CALLBACK_TIMEOUT_MS: number;
export interface LocalCallbackOptions {
    host?: string;
    timeoutMs?: number;
}
export declare function createLocalCallbackListener(port: number, options?: LocalCallbackOptions): {
    ready: Promise<number>;
    code: Promise<string>;
};
export declare function startLocalCallbackServer(port: number, options?: LocalCallbackOptions): Promise<string>;
export declare function generateCodeVerifier(): string;
export declare function codeChallenge(verifier: string): string;
export declare function authenticateWithOAuth(): Promise<any>;
export {};
