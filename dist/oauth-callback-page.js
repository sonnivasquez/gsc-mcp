"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CALLBACK_PRODUCT_NAME = void 0;
exports.pickCallbackLocale = pickCallbackLocale;
exports.createCallbackNonce = createCallbackNonce;
exports.callbackSecurityHeaders = callbackSecurityHeaders;
exports.renderCallbackPage = renderCallbackPage;
const node_crypto_1 = require("node:crypto");
/** Visible product name. Must appear verbatim in every rendered page. */
exports.CALLBACK_PRODUCT_NAME = "Sonni Vasquez's GSC MCP";
const COPY = {
    en: {
        success: {
            title: "Authorization received \u2014 Sonni Vasquez's GSC MCP",
            heading: "Authorization received",
            lead: "This local page captured your authorization.",
            closeHint: "Press <kbd>⌘W</kbd> or <kbd>Ctrl+W</kbd> to close this tab.",
            close: "Close this tab and return to the terminal.",
            handoffTitle: "What happens next",
            stepOne: "Authorization reached this local page.",
            stepTwo: "Your terminal finishes the exchange and confirms the final connection.",
            note: "This tab only handled the local redirect. Nothing else was transferred here.",
            langLabel: "en",
        },
        error: {
            title: "Authorization did not complete \u2014 Sonni Vasquez's GSC MCP",
            heading: "Authorization did not complete",
            lead: "No authorization reached this local page.",
            closeHint: "Press <kbd>⌘W</kbd> or <kbd>Ctrl+W</kbd> to close this tab.",
            close: "Close this tab and return to the terminal.",
            handoffTitle: "What happens next",
            stepOne: "No authorization was captured on this local page.",
            stepTwo: "Start again from your terminal; the terminal reports the final result.",
            note: "This tab only handled the local redirect. No details are shown here.",
            langLabel: "en",
        },
    },
    es: {
        success: {
            title: "Autorizaci\u00f3n recibida \u2014 Sonni Vasquez's GSC MCP",
            heading: "Autorizaci\u00f3n recibida",
            lead: "Esta p\u00e1gina local captur\u00f3 tu autorizaci\u00f3n.",
            closeHint: "Pulsa <kbd>⌘W</kbd> o <kbd>Ctrl+W</kbd> para cerrar esta pestaña.",
            close: "Cierra esta pesta\u00f1a y vuelve a la terminal.",
            handoffTitle: "Qu\u00e9 pasa ahora",
            stepOne: "La autorizaci\u00f3n lleg\u00f3 a esta p\u00e1gina local.",
            stepTwo: "Tu terminal completa el intercambio y confirma la conexi\u00f3n final.",
            note: "Esta pesta\u00f1a solo gestion\u00f3 la redirecci\u00f3n local. Aqu\u00ed no se transfiri\u00f3 nada m\u00e1s.",
            langLabel: "es",
        },
        error: {
            title: "La autorizaci\u00f3n no se complet\u00f3 \u2014 Sonni Vasquez's GSC MCP",
            heading: "La autorizaci\u00f3n no se complet\u00f3",
            lead: "Ninguna autorizaci\u00f3n lleg\u00f3 a esta p\u00e1gina local.",
            closeHint: "Pulsa <kbd>⌘W</kbd> o <kbd>Ctrl+W</kbd> para cerrar esta pestaña.",
            close: "Cierra esta pesta\u00f1a y vuelve a la terminal.",
            handoffTitle: "Qu\u00e9 pasa ahora",
            stepOne: "En esta p\u00e1gina local no se captur\u00f3 ninguna autorizaci\u00f3n.",
            stepTwo: "Empieza de nuevo desde la terminal; la terminal muestra el resultado final.",
            note: "Esta pesta\u00f1a solo gestion\u00f3 la redirecci\u00f3n local. Aqu\u00ed no se muestra ning\u00fan detalle.",
            langLabel: "es",
        },
    },
};
/**
 * Choose the page locale from an Accept-Language header value.
 * Spanish only when the caller's preference order puts `es` first among
 * the supported locales; every other input (missing, unparseable,
 * other languages, ties that do not prefer `es`) falls back to English.
 */
function pickCallbackLocale(acceptLanguage) {
    if (typeof acceptLanguage !== "string" || acceptLanguage.trim() === "")
        return "en";
    const entries = [];
    const parts = acceptLanguage.split(",");
    for (let index = 0; index < parts.length; index += 1) {
        const segment = parts[index].trim();
        if (segment === "")
            continue;
        const [range, ...params] = segment.split(";");
        const primary = range.trim().split("-")[0]?.toLowerCase() ?? "";
        if (primary === "" || primary === "*")
            continue;
        let q = 1;
        let hasInvalidQ = false;
        for (const param of params) {
            const trimmed = param.trim();
            if (!/^q\s*=/i.test(trimmed))
                continue;
            const match = trimmed.match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
            if (match) {
                q = Number(match[1]);
            }
            else {
                // Malformed q-value: the range carries no usable preference, so
                // skip it instead of treating it as q=1 and letting a bogus
                // range outrank a valid one.
                hasInvalidQ = true;
            }
            break;
        }
        if (hasInvalidQ)
            continue;
        if (!Number.isFinite(q) || q <= 0)
            continue;
        entries.push({ primary, q, index });
    }
    entries.sort((a, b) => b.q - a.q || a.index - b.index);
    for (const entry of entries) {
        if (entry.primary === "es")
            return "es";
        if (entry.primary === "en")
            return "en";
    }
    return "en";
}
function createCallbackNonce() {
    return (0, node_crypto_1.randomBytes)(16).toString("base64");
}
/**
 * Security headers for the callback HTML response. The CSP allows only
 * the per-request nonced inline style and script; there are no external
 * assets, fonts, images, or connections.
 */
function callbackSecurityHeaders(nonce) {
    return {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": [
            "default-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "img-src 'none'",
            "font-src 'none'",
            "connect-src 'none'",
            `style-src 'nonce-${nonce}'`,
            `script-src 'nonce-${nonce}'`,
        ].join("; "),
    };
}
function statusEmblem(kind) {
    if (kind === "success") {
        return `<svg width="56" height="56" viewBox="0 0 44 44" fill="none" focusable="false" aria-hidden="true"><circle cx="22" cy="22" r="20" stroke="currentColor" stroke-width="2"/><path d="M14.5 22.6l5.4 5.4L29.7 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    return `<svg width="56" height="56" viewBox="0 0 44 44" fill="none" focusable="false" aria-hidden="true"><circle cx="22" cy="22" r="20" stroke="currentColor" stroke-width="2"/><path d="M22 13.5v10.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="29.4" r="1.7" fill="currentColor"/></svg>`;
}
function pageStyle() {
    return [
        // Tokens: neutral ink/line, an always-resolved root canvas, plus a
        // per-state stage wash and accent. --stage is scoped to .stage
        // (which paints it); body uses --canvas so it never depends on a
        // state-scoped token.
        ":root{color-scheme:light dark;--ink:#13211a;--muted:#43564d;--line:#d8e0d9;--ring:#0b5fff;--canvas:#e4eae3;--sel-bg:#13211a;--sel-fg:#f4f6f4}",
        ".stage[data-state=\"success\"]{--stage:#e9f1e8;--handoff:#ffffff;--accent:#166534}",
        ".stage[data-state=\"error\"]{--stage:#f6e7e3;--handoff:#ffffff;--accent:#a61f14}",
        "@media (prefers-color-scheme:dark){:root{--ink:#e8efe9;--muted:#a9bcb1;--line:#26352d;--ring:#8ab4ff;--canvas:#101613;--sel-bg:#e8efe9;--sel-fg:#0c1310}.stage[data-state=\"success\"]{--stage:#0d1811;--handoff:#111b15;--accent:#5dd39a}.stage[data-state=\"error\"]{--stage:#211210;--handoff:#1a1412;--accent:#ff9a8a}}",
        "*{box-sizing:border-box}",
        "html{-webkit-text-size-adjust:100%}",
        "body{margin:0;min-height:100svh;background:var(--canvas);color:var(--ink);font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}",
        // Two-region surface: thesis + handoff share the viewport, no card.
        // .stage paints the state wash itself; the handoff keeps its own bg.
        ".stage{min-height:100svh;min-height:100dvh;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);background:var(--stage);color:var(--ink)}",
        ".thesis{padding:clamp(30px,4rem + 2vw,76px);display:flex;flex-direction:column;justify-content:center;max-width:46rem}",
        ".handoff{background:var(--handoff);border-left:1px solid var(--line);padding:clamp(30px,4rem + 2vw,76px);display:flex;flex-direction:column;justify-content:center}",
        ".emblem{margin:0 0 22px;color:var(--accent)}",
        ".emblem svg{display:block}",
        "h1{font-size:clamp(2.1rem,1.4rem + 3.6vw,3.3rem);line-height:1.05;letter-spacing:-.025em;text-wrap:balance;margin:0 0 12px}",
        ".lead{font-size:clamp(1.05rem,1rem + .5vw,1.25rem);margin:0 0 10px;max-width:34rem}",
        ".close{margin:14px 0 0;color:var(--ink);font-size:1.05rem}",
        ".hint{margin:10px 0 0;color:var(--muted);font-size:.95rem}",
        ".hint kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;padding:.1em .45em;background:var(--handoff);color:var(--ink);white-space:nowrap}",
        ".brand{display:flex;align-items:center;gap:10px;margin:clamp(30px,4vw,52px) 0 0;font-size:.92rem;font-weight:600;color:var(--muted)}",
        ".dot{width:10px;height:10px;border-radius:999px;background:var(--accent);flex:none}",
        ".handoff h2{font-size:1.02rem;letter-spacing:.01em;margin:0 0 4px}",
        ".steps{list-style:none;counter-reset:step;margin:18px 0 0;padding:0;display:grid;gap:16px}",
        ".steps li{counter-increment:step;display:grid;grid-template-columns:2rem minmax(0,1fr);gap:12px;align-items:start;max-width:30rem}",
        ".steps li::before{content:counter(step);width:2rem;height:2rem;border-radius:999px;border:2px solid var(--accent);color:var(--accent);display:grid;place-items:center;font-weight:700;font-size:.95rem;line-height:1}",
        ".note{margin:24px 0 0;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:.86rem;max-width:60ch}",
        "::selection{background:var(--sel-bg);color:var(--sel-fg)}",
        ":focus-visible{outline:2px solid var(--ring);outline-offset:3px;border-radius:6px}",
        // Mobile: plain vertical stack, no floating card, no empty margins.
        "@media (max-width:760px){.stage{grid-template-columns:minmax(0,1fr)}.thesis{padding:32px 22px;max-width:none}.handoff{border-left:none;border-top:1px solid var(--line);padding:28px 22px}h1{font-size:clamp(1.9rem,1.5rem + 5vw,2.5rem);letter-spacing:-.02em}}",
        // No animation on this surface; the guard stays so none can regress in.
        "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none !important;transition:none !important}}",
    ].join("\n");
}
/**
 * Render the one-screen operating confirmation. Only `kind`, locale, and
 * the CSP nonce influence the output: authorization codes, errors, and
 * tokens must never be passed in or interpolated.
 */
function renderCallbackPage(kind, options) {
    const locale = options?.locale ?? pickCallbackLocale(options?.acceptLanguage ?? null);
    const nonce = options?.nonce ?? createCallbackNonce();
    const copy = COPY[locale][kind];
    const state = kind === "success" ? "success" : "error";
    const html = [
        "<!doctype html>",
        `<html lang="${copy.langLabel}">`,
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="referrer" content="no-referrer">',
        `<title>${copy.title}</title>`,
        `<style nonce="${nonce}">`,
        pageStyle(),
        "</style>",
        "</head>",
        "<body>",
        `<main class="stage" data-state="${state}" aria-labelledby="callback-title">`,
        `<section class="thesis">`,
        `<p class="emblem">${statusEmblem(kind)}</p>`,
        `<h1 id="callback-title">${copy.heading}</h1>`,
        `<p class="lead">${copy.lead}</p>`,
        `<p class="close">${copy.close}</p>`,
        `<p class="hint">${copy.closeHint}</p>`,
        `<p class="brand"><span class="dot" aria-hidden="true"></span><span>${exports.CALLBACK_PRODUCT_NAME}</span></p>`,
        `</section>`,
        `<aside class="handoff" aria-labelledby="handoff-title">`,
        `<h2 id="handoff-title">${copy.handoffTitle}</h2>`,
        `<ol class="steps">`,
        `<li>${copy.stepOne}</li>`,
        `<li>${copy.stepTwo}</li>`,
        `</ol>`,
        `<p class="note">${copy.note}</p>`,
        `</aside>`,
        "</main>",
        `<script nonce="${nonce}">try{history.replaceState(null,"",location.pathname)}catch(e){}</script>`,
        "</body>",
        "</html>",
        "",
    ].join("\n");
    return { html, nonce, locale, headers: callbackSecurityHeaders(nonce) };
}
