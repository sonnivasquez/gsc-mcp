import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLBACK_PRODUCT_NAME,
  callbackSecurityHeaders,
  createCallbackNonce,
  pickCallbackLocale,
  renderCallbackPage,
} from "../dist/oauth-callback-page.js";

const PRODUCT = "Sonni Vasquez's GSC MCP";
const DRIFT = [
  /successfully connected/i,
  /data connected/i,
  /you are connected/i,
  /connection successful/i,
  /connected to your/i,
  /access to your data/i,
];

test("product name constant is verbatim", () => {
  assert.equal(CALLBACK_PRODUCT_NAME, PRODUCT);
});

test("locale picker prefers Spanish only when es leads", () => {
  assert.equal(pickCallbackLocale(null), "en");
  assert.equal(pickCallbackLocale(undefined), "en");
  assert.equal(pickCallbackLocale(""), "en");
  assert.equal(pickCallbackLocale("en-US,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es-ES,es;q=0.9,en;q=0.8"), "es");
  assert.equal(pickCallbackLocale("es;q=0.9,en;q=0.8"), "es");
  assert.equal(pickCallbackLocale("en;q=0.9,es;q=0.8"), "en");
  assert.equal(pickCallbackLocale("fr-FR,fr;q=0.9"), "en");
  assert.equal(pickCallbackLocale("fr, es;q=0.9"), "es");
  assert.equal(pickCallbackLocale("es;q=0, en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("ES-es"), "es");
  assert.equal(pickCallbackLocale("*"), "en");
  assert.equal(pickCallbackLocale("not-a-language"), "en");
});

test("malformed q-values are skipped and q-order decides", () => {
  assert.equal(pickCallbackLocale("es;q=bogus,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;q=,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;q=2,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;Q=BOGUS,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;q = bogus,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;q=bogus"), "en");
  assert.equal(pickCallbackLocale("en;q=0.5,es;q=0.9"), "es");
  assert.equal(pickCallbackLocale("es;q=0.5,en;q=0.9"), "en");
  assert.equal(pickCallbackLocale("es;q=0.8,en;q=0.8"), "es");
  assert.equal(pickCallbackLocale("en;q=0.8,es;q=0.8"), "en");
});

test("Accept-Language header values never echo into the page", () => {
  const sentinel = "SENTINEL-LOCALE-4d2a";
  const malformed = renderCallbackPage("success", {
    acceptLanguage: `es;q=${sentinel},en;q=0.9`,
  });
  assert.equal(malformed.locale, "en");
  assert.ok(!malformed.html.includes(sentinel));
  const exotic = renderCallbackPage("error", {
    acceptLanguage: `xx-${sentinel};q=0.9,en;q=0.8`,
  });
  assert.equal(exotic.locale, "en");
  assert.ok(!exotic.html.includes(sentinel));
});

test("explicit locale overrides Accept-Language", () => {
  const page = renderCallbackPage("success", { locale: "es", acceptLanguage: "en-US,en;q=0.9" });
  assert.equal(page.locale, "es");
  assert.match(page.html, /Autorizaci\u00f3n recibida/);
});

test("success English copy states authorization received, not data connected", () => {
  const page = renderCallbackPage("success", { locale: "en", nonce: "test-nonce-1" });
  assert.equal(page.locale, "en");
  assert.match(page.html, /<html lang="en">/);
  assert.match(page.html, /Authorization received/);
  assert.match(page.html, /This local page captured your authorization\./);
  assert.match(page.html, /Close this tab and return to the terminal\./);
  assert.match(page.html, /What happens next/);
  assert.match(page.html, /Authorization reached this local page\./);
  assert.match(page.html, /Your terminal finishes the exchange and confirms the final connection\./);
  assert.match(page.html, /<ol class="steps">/);
  assert.match(page.html, new RegExp(PRODUCT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const pattern of DRIFT) {
    assert.doesNotMatch(page.html, pattern);
  }
});

test("success Spanish copy states authorization received, not data connected", () => {
  const page = renderCallbackPage("success", { locale: "es", nonce: "test-nonce-2" });
  assert.equal(page.locale, "es");
  assert.match(page.html, /<html lang="es">/);
  assert.match(page.html, /Autorizaci\u00f3n recibida/);
  assert.match(page.html, /Esta p\u00e1gina local captur\u00f3 tu autorizaci\u00f3n\./);
  assert.match(page.html, /Cierra esta pesta\u00f1a y vuelve a la terminal\./);
  assert.match(page.html, /Qu\u00e9 pasa ahora/);
  assert.match(page.html, /lleg\u00f3 a esta p\u00e1gina local/);
  assert.match(page.html, /completa el intercambio y confirma la conexi\u00f3n final/);
  assert.match(page.html, /<ol class="steps">/);
  assert.match(page.html, new RegExp(PRODUCT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const pattern of DRIFT) {
    assert.doesNotMatch(page.html, pattern);
  }
});

test("error pages give a concise retry instruction without echoing the provider value", () => {
  const en = renderCallbackPage("error", { locale: "en", nonce: "test-nonce-3" });
  assert.match(en.html, /Authorization did not complete/);
  assert.match(en.html, /No authorization reached this local page\./);
  assert.doesNotMatch(en.html, /access_denied/);
  assert.doesNotMatch(en.html, /error_description/);
  const es = renderCallbackPage("error", { locale: "es", nonce: "test-nonce-4" });
  assert.match(es.html, /autorizaci\u00f3n no se complet\u00f3/i);
  assert.match(es.html, /Ninguna autorizaci\u00f3n lleg\u00f3 a esta p\u00e1gina local\./);
  assert.doesNotMatch(es.html, /access_denied/);
  assert.match(en.html, /What happens next/);
  assert.match(en.html, /No authorization was captured on this local page\./);
  assert.match(en.html, /the terminal reports the final result\./);
  assert.match(es.html, /Qu\u00e9 pasa ahora/);
  assert.match(es.html, /no se captur\u00f3 ninguna autorizaci\u00f3n/);
  assert.match(es.html, /la terminal muestra el resultado final/);
});

test("security headers carry no-store, no-referrer, nosniff, and a restrictive nonce CSP", () => {
  const nonce = "header-check-nonce";
  const headers = callbackSecurityHeaders(nonce);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Type"], /text\/html; charset=utf-8/);
  const csp = headers["Content-Security-Policy"];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /img-src 'none'/);
  assert.match(csp, /font-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(csp.includes(`style-src 'nonce-${nonce}'`));
  assert.ok(csp.includes(`script-src 'nonce-${nonce}'`));
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /https?:\/\//);
});

test("rendered page wires the same nonce into CSP, style, and history-cleanup script", () => {
  const page = renderCallbackPage("success", { locale: "en" });
  assert.ok(page.nonce.length > 8);
  assert.ok(page.headers["Content-Security-Policy"].includes(`style-src 'nonce-${page.nonce}'`));
  assert.ok(page.headers["Content-Security-Policy"].includes(`script-src 'nonce-${page.nonce}'`));
  assert.ok(page.html.includes(`<style nonce="${page.nonce}">`));
  assert.ok(page.html.includes(`<script nonce="${page.nonce}">`));
  assert.doesNotMatch(page.html, /\sstyle\s*=/i);
  assert.match(page.html, /history\.replaceState\(null,"",location\.pathname\)/);
  assert.match(page.html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(page.html, /<meta name="referrer" content="no-referrer">/);
});

test("nonces are unique per render and a caller nonce is honored", () => {
  const a = renderCallbackPage("success", { locale: "en" });
  const b = renderCallbackPage("success", { locale: "en" });
  assert.notEqual(a.nonce, b.nonce);
  const fixed = renderCallbackPage("error", { locale: "en", nonce: "fixed-nonce-abc" });
  assert.equal(fixed.nonce, "fixed-nonce-abc");
  assert.ok(createCallbackNonce().length > 8);
});

test("page has no external assets, no secret interpolation surface", () => {
  const sentinel = "SENTINEL-9f8a1c-NO-INTERPOLATION";
  const page = renderCallbackPage("success", { locale: "en", nonce: "sentinel-nonce" });
  assert.doesNotMatch(page.html, /https?:\/\//);
  assert.doesNotMatch(page.html, /<link/i);
  assert.doesNotMatch(page.html, /<img/i);
  assert.doesNotMatch(page.html, /\ssrc\s*=/i);
  assert.doesNotMatch(page.html, /\sstyle\s*=/i);
  assert.match(page.html, /class="stage"/);
  assert.match(page.html, /class="thesis"/);
  assert.match(page.html, /class="handoff"/);
  assert.match(page.html, /<ol class="steps">/);
  assert.ok(!page.html.includes(sentinel));
  assert.ok(!page.headers["Content-Security-Policy"].includes(sentinel));
});

test("responsive, contrast, and reduced-motion rules ship inline", () => {
  const page = renderCallbackPage("success", { locale: "en", nonce: "css-nonce" });
  assert.match(page.html, /max-width/);
  assert.match(page.html, /clamp\(/);
  assert.match(page.html, /grid-template-columns/);
  assert.match(page.html, /max-width:\s*760px/);
  assert.match(page.html, /prefers-color-scheme:\s*dark/);
  assert.match(page.html, /prefers-reduced-motion:\s*reduce/);
  assert.match(page.html, /:focus-visible/);
  assert.match(page.html, /::selection/);
});

test("stage paints its own state wash over an always-resolved root canvas", () => {
  for (const kind of ["success", "error"]) {
    const page = renderCallbackPage(kind, { locale: "en", nonce: `canvas-${kind}` });
    const style = page.html.match(/<style nonce="[^"]+">([\s\S]*?)<\/style>/)[1];
    // The root canvas token resolves everywhere; body never depends on
    // the state-scoped --stage token, so no transparent canvas regresses in.
    assert.match(style, /:root\{[^}]*--canvas:/);
    assert.match(style, /body\{[^}]*background:var\(--canvas\)/);
    assert.doesNotMatch(style, /body\{[^}]*var\(--stage\)/);
    // The stage element itself paints the wash and carries the ink, so
    // light text always sits on its intended dark wash and vice versa.
    assert.match(style, /\.stage\{[^}]*background:var\(--stage\)/);
    assert.match(style, /\.stage\{[^}]*color:var\(--ink\)/);
    // The handoff keeps its own background; the element carries the state.
    assert.match(style, /\.handoff\{[^}]*background:var\(--handoff\)/);
    assert.match(page.html, new RegExp(`data-state="${kind}"`));
  }
  const style = renderCallbackPage("success", { locale: "en", nonce: "wash-x" }).html.match(
    /<style nonce="[^"]+">([\s\S]*?)<\/style>/
  )[1];
  const successWash = style.match(/\.stage\[data-state="success"\]\{--stage:([^;}]+)/)[1];
  const errorWash = style.match(/\.stage\[data-state="error"\]\{--stage:([^;}]+)/)[1];
  assert.notEqual(successWash, errorWash);
});

test("close instruction reads as an ordered action with a kbd hint on every kind and locale", () => {
  const cases = [
    ["success", "en", "Close this tab and return to the terminal.", "Press", "to close this tab."],
    ["error", "en", "Close this tab and return to the terminal.", "Press", "to close this tab."],
    ["success", "es", "Cierra esta pestaña y vuelve a la terminal.", "Pulsa", "para cerrar esta pestaña."],
    ["error", "es", "Cierra esta pestaña y vuelve a la terminal.", "Pulsa", "para cerrar esta pestaña."],
  ];
  for (const [kind, locale, close, leadWord, conjunction] of cases) {
    const page = renderCallbackPage(kind, { locale, nonce: `close-hint-${kind}-${locale}` });
    // Ordered action, not permission.
    assert.ok(page.html.includes(`<p class="close">${close}</p>`), `${kind}/${locale} orders the close`);
    // Hint paragraph follows the close line and names the shortcut in kbd elements.
    const hintAt = page.html.indexOf('<p class="hint">');
    const closeAt = page.html.indexOf('<p class="close">');
    assert.ok(closeAt !== -1 && hintAt > closeAt);
    const hint = page.html.slice(hintAt, page.html.indexOf("</p>", hintAt));
    assert.ok(hint.includes(leadWord));
    assert.ok(hint.includes(conjunction));
    assert.ok(hint.includes("<kbd>⌘W</kbd>"));
    assert.ok(hint.includes("<kbd>Ctrl+W</kbd>"));
    // No dead button remains anywhere.
    assert.doesNotMatch(page.html, /<button/i);
    assert.doesNotMatch(page.html, /close-tab/);
  }
});

test("inline script is history cleanup only", () => {
  const page = renderCallbackPage("success", { locale: "es", nonce: "history-only-nonce" });
  const script = page.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  assert.match(script, /history\.replaceState\(null,"",location\.pathname\)/);
  assert.doesNotMatch(script, /window\.close/);
  assert.doesNotMatch(script, /addEventListener/);
  assert.doesNotMatch(script, /getElementById/);
  // Single inline script: no extra script tags slipped in.
  assert.equal(page.html.match(/<script/g).length, 1);
});

test("page uses no inline event-handler attributes", () => {
  for (const kind of ["success", "error"]) {
    for (const locale of ["en", "es"]) {
      const page = renderCallbackPage(kind, { locale, nonce: `no-handler-${kind}-${locale}` });
      assert.doesNotMatch(page.html, /\son(click|load|error)\s*=/i);
      assert.doesNotMatch(page.html, /\son(click|load|error)=/i);
    }
  }
});

test("promoted fallback and kbd hint rules ship inline", () => {
  const page = renderCallbackPage("success", { locale: "en", nonce: "close-css-nonce" });
  const style = page.html.match(/<style nonce="[^"]+">([\s\S]*?)<\/style>/)[1];
  assert.match(style, /\.close\{[^}]*color:var\(--ink\)/);
  assert.match(style, /\.close\{[^}]*font-size:1\.05rem/);
  assert.match(style, /\.hint kbd\{[^}]*border:1px solid var\(--line\)/);
  assert.match(style, /\.hint kbd\{[^}]*background:var\(--handoff\)/);
  assert.match(style, /max-width:\s*760px/);
  assert.doesNotMatch(style, /close-tab/);
});

test("close markup introduces no secret interpolation surface", () => {
  const sentinel = "SENTINEL-9f8a1c-NO-INTERPOLATION";
  const page = renderCallbackPage("success", { locale: "en", nonce: "sentinel-nonce" });
  assert.ok(page.html.includes("<p class=\"close\">Close this tab and return to the terminal.</p>"));
  assert.ok(page.html.includes("<kbd>⌘W</kbd>"));
  assert.ok(!page.html.includes(sentinel));
  assert.ok(!page.headers["Content-Security-Policy"].includes(sentinel));
});
