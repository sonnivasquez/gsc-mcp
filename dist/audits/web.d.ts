import { AuditContext } from "./context.js";
export interface Redirect {
    from: string;
    to: string;
    status: number;
}
export interface PageLink {
    url: string;
    anchor: string;
    rel: string[];
    zone: "navigation" | "content";
}
export interface PageEvidence {
    url: string;
    finalUrl: string;
    status: number;
    fetchedAt: string;
    redirects: Redirect[];
    contentType: string;
    titles: string[];
    descriptions: string[];
    h1: string[];
    headings: string[];
    canonicals: string[];
    robots: string[];
    xRobotsTag: string | null;
    text: string;
    links: PageLink[];
    javascriptContentUnknown: boolean;
}
export declare class WebReader {
    readonly ctx: AuditContext;
    private readonly robots;
    constructor(ctx: AuditContext);
    fetch(raw: string, maxBytes?: number, robotsResource?: boolean, automatic?: boolean): Promise<{
        response: Response;
        finalUrl: string;
        redirects: Redirect[];
        bytes: Buffer<ArrayBufferLike>;
    }>;
    allowed(raw: string): Promise<boolean>;
    page(raw: string, automatic?: boolean): Promise<PageEvidence>;
}
export declare function normalized(text: string): string;
export interface Finding {
    code: string;
    priority: "high" | "medium" | "review";
    evidence: unknown;
    ruleVersion: "audit.1";
}
export declare function pageFindings(p: PageEvidence): Finding[];
