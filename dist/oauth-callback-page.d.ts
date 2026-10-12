/**
 * Operating confirmation page for the local OAuth loopback callback.
 *
 * Full-viewport two-region surface, not a floating card and not a
 * marketing page. Region one is the typographic status thesis; region two
 * is a content-bearing handoff panel that states the REAL two-step truth:
 * authorization reached this local page, and the terminal finishes the
 * exchange and confirms the final connection. Success copy must never
 * claim data is connected and no metrics are invented.
 *
 * Privacy: no third-party assets or requests, no token/code/error values
 * in markup, strict per-request CSP nonce, no-store history.
 */
export type CallbackPageKind = "success" | "error";
export type CallbackPageLocale = "es" | "en";
/** Visible product name. Must appear verbatim in every rendered page. */
export declare const CALLBACK_PRODUCT_NAME = "Sonni Vasquez's GSC MCP";
export interface RenderCallbackPageOptions {
    locale?: CallbackPageLocale;
    acceptLanguage?: string | null;
    nonce?: string;
}
export interface RenderedCallbackPage {
    html: string;
    nonce: string;
    locale: CallbackPageLocale;
    headers: Record<string, string>;
}
/**
 * Choose the page locale from an Accept-Language header value.
 * Spanish only when the caller's preference order puts `es` first among
 * the supported locales; every other input (missing, unparseable,
 * other languages, ties that do not prefer `es`) falls back to English.
 */
export declare function pickCallbackLocale(acceptLanguage?: string | null): CallbackPageLocale;
export declare function createCallbackNonce(): string;
/**
 * Security headers for the callback HTML response. The CSP allows only
 * the per-request nonced inline style and script; there are no external
 * assets, fonts, images, or connections.
 */
export declare function callbackSecurityHeaders(nonce: string): Record<string, string>;
/**
 * Render the one-screen operating confirmation. Only `kind`, locale, and
 * the CSP nonce influence the output: authorization codes, errors, and
 * tokens must never be passed in or interpolated.
 */
export declare function renderCallbackPage(kind: CallbackPageKind, options?: RenderCallbackPageOptions): RenderedCallbackPage;
