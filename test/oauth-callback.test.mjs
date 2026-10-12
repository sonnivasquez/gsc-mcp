import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

import * as oauth from "../dist/oauth.js";

const LOOPBACK = "127.0.0.1";
const PRODUCT = "Sonni Vasquez's GSC MCP";
const DRIFT = [
  /successfully connected/i,
  /data connected/i,
  /you are connected/i,
  /connection successful/i,
  /connected to your/i,
  /access to your data/i,
];

function occupyLoopback() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    srv.on("error", reject);
    srv.listen(0, LOOPBACK, () => {
      const address = srv.address();
      if (typeof address === "object" && address !== null) {
        resolve({ srv, port: address.port });
      } else {
        reject(new Error("could not determine occupied port"));
      }
    });
  });
}

function closeServer(srv) {
  return new Promise((resolve) => srv.close(() => resolve()));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchCallback(port, query, acceptLanguage) {
  const headers = acceptLanguage ? { "Accept-Language": acceptLanguage } : undefined;
  const path = query.startsWith("/") ? query : `/${query}`;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await response.text();
  const collected = {};
  for (const [key, value] of response.headers.entries()) {
    collected[key.toLowerCase()] = value;
  }
  return { status: response.status, headers: collected, body };
}

function assertSecurityHeaders(headers, body, expectedLang) {
  assert.match(headers["content-type"], /text\/html; charset=utf-8/);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  const csp = headers["content-security-policy"];
  assert.ok(typeof csp === "string" && csp.length > 0, "CSP header must be present");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /style-src 'nonce-/);
  assert.match(csp, /script-src 'nonce-/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /https?:\/\//);
  const styleNonce = body.match(/<style nonce="([^"]+)">/);
  const scriptNonce = body.match(/<script nonce="([^"]+)">/);
  assert.ok(styleNonce, "inline style must carry the CSP nonce");
  assert.ok(scriptNonce, "history-cleanup script must carry the CSP nonce");
  assert.equal(styleNonce[1], scriptNonce[1]);
  assert.ok(csp.includes(`style-src 'nonce-${styleNonce[1]}'`));
  assert.ok(csp.includes(`script-src 'nonce-${scriptNonce[1]}'`));
  assert.match(body, new RegExp(`<html lang="${expectedLang}">`));
  assert.match(body, new RegExp(escapeRegExp(PRODUCT)));
  assert.match(body, /history\.replaceState\(null,"",location\.pathname\)/);
  assert.doesNotMatch(body, /https?:\/\//);
  assert.doesNotMatch(body, /<link/i);
  assert.doesNotMatch(body, /<img/i);
  assert.doesNotMatch(body, /\sstyle\s*=/i);
  assert.match(body, /<ol class="steps">/);
  assert.match(body, /data-state="(success|error)"/);
  for (const pattern of DRIFT) {
    assert.doesNotMatch(body, pattern);
  }
}

test("default callback window is ten minutes", () => {
  assert.equal(oauth.OAUTH_CALLBACK_TIMEOUT_MS, 10 * 60 * 1000);
  assert.equal(oauth.OAUTH_CALLBACK_TIMEOUT_MS, 600000);
});

test("loopback success renders English confirmation without echoing the code", async () => {
  const sentinel = "loopback-sentinel-code-9f8a1c-en";
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 5000 });
  const actualPort = await listener.ready;
  assert.ok(Number.isInteger(actualPort) && actualPort > 0);
  const { status, headers, body } = await fetchCallback(
    actualPort,
    `/?code=${encodeURIComponent(sentinel)}`,
    "en-US,en;q=0.9"
  );
  assert.equal(status, 200);
  assert.match(body, /Authorization received/);
  assert.match(body, /This local page captured your authorization\./);
  assert.match(body, /Close this tab and return to the terminal\./);
  assert.match(body, /to close this tab\./);
  assert.match(body, /What happens next/);
  assert.match(body, /Authorization reached this local page\./);
  assert.match(body, /Your terminal finishes the exchange/);
  assert.ok(!body.includes(sentinel), "authorization code must never appear in the HTML body");
  assertSecurityHeaders(headers, body, "en");
  assert.equal(await listener.code, sentinel);
});

test("loopback success renders Spanish confirmation when Accept-Language prefers es", async () => {
  const sentinel = "loopback-sentinel-code-9f8a1c-es";
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 5000 });
  const actualPort = await listener.ready;
  const { status, headers, body } = await fetchCallback(
    actualPort,
    `/?code=${encodeURIComponent(sentinel)}`,
    "es-ES,es;q=0.9,en;q=0.8"
  );
  assert.equal(status, 200);
  assert.match(body, /Autorizaci\u00f3n recibida/);
  assert.match(body, /Esta p\u00e1gina local captur\u00f3 tu autorizaci\u00f3n\./);
  assert.match(body, /Cierra esta pesta\u00f1a y vuelve a la terminal\./);
  assert.match(body, /para cerrar esta pesta\u00f1a\./);
  assert.match(body, /Qu\u00e9 pasa ahora/);
  assert.match(body, /lleg\u00f3 a esta p\u00e1gina local/);
  assert.match(body, /completa el intercambio/);
  assert.ok(!body.includes(sentinel), "authorization code must never appear in the HTML body");
  assertSecurityHeaders(headers, body, "es");
  assert.equal(await listener.code, sentinel);
});

test("loopback provider error renders English retry page without echoing the error value", async () => {
  const sentinelError = "sentinel-error-en-7b3d9e";
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 5000 });
  const actualPort = await listener.ready;
  const { status, headers, body } = await fetchCallback(
    actualPort,
    `/?error=${encodeURIComponent(sentinelError)}`,
    "en-US,en;q=0.9"
  );
  assert.equal(status, 200);
  assert.match(body, /Authorization did not complete/);
  assert.match(body, /No authorization reached this local page\./);
  assert.match(body, /Close this tab and return to the terminal\./);
  assert.match(body, /What happens next/);
  assert.match(body, /No authorization was captured/);
  assert.ok(!body.includes(sentinelError), "OAuth error value must never appear in the HTML body");
  assert.doesNotMatch(body, /OAuth error:/);
  assertSecurityHeaders(headers, body, "en");
  await assert.rejects(listener.code, (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /OAuth authorization failed in the browser/);
    assert.ok(
      !err.message.includes(sentinelError),
      "OAuth error value must never appear in the rejection message"
    );
    assert.equal(err.code, "OAUTH_BROWSER_AUTHORIZATION_FAILED");
    return true;
  });
});

test("loopback present-but-empty error wins over code and echoes nothing", async () => {
  const sentinelCode = "sentinel-code-empty-error-4f1c";
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 5000 });
  const actualPort = await listener.ready;
  const { status, headers, body } = await fetchCallback(
    actualPort,
    `/?error=&code=${encodeURIComponent(sentinelCode)}`,
    "en-US,en;q=0.9"
  );
  assert.equal(status, 200);
  assert.match(body, /Authorization did not complete/);
  assert.match(body, /No authorization reached this local page\./);
  assert.ok(!body.includes(sentinelCode), "authorization code must never appear in the error page body");
  assert.doesNotMatch(body, /OAuth error:/);
  assertSecurityHeaders(headers, body, "en");
  await assert.rejects(listener.code, (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /OAuth authorization failed in the browser/);
    assert.ok(
      !err.message.includes(sentinelCode),
      "authorization code must never appear in the rejection message"
    );
    assert.equal(err.code, "OAUTH_BROWSER_AUTHORIZATION_FAILED");
    return true;
  });
});

test("loopback provider error renders Spanish retry page without echoing the error value", async () => {
  const sentinelError = "sentinel-error-es-7b3d9e";
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 5000 });
  const actualPort = await listener.ready;
  const { status, headers, body } = await fetchCallback(
    actualPort,
    `/?error=${encodeURIComponent(sentinelError)}`,
    "es-ES,es;q=0.9"
  );
  assert.equal(status, 200);
  assert.match(body, /autorizaci\u00f3n no se complet\u00f3/i);
  assert.match(body, /Ninguna autorizaci\u00f3n lleg\u00f3 a esta p\u00e1gina local\./);
  assert.match(body, /Cierra esta pesta\u00f1a y vuelve a la terminal\./);
  assert.match(body, /Qu\u00e9 pasa ahora/);
  assert.match(body, /no se captur\u00f3 ninguna autorizaci\u00f3n/);
  assert.ok(!body.includes(sentinelError), "OAuth error value must never appear in the HTML body");
  assertSecurityHeaders(headers, body, "es");
  await assert.rejects(listener.code, (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /OAuth authorization failed in the browser/);
    assert.ok(
      !err.message.includes(sentinelError),
      "OAuth error value must never appear in the rejection message"
    );
    assert.equal(err.code, "OAUTH_BROWSER_AUTHORIZATION_FAILED");
    return true;
  });
});

test("loopback bind conflict rejects promptly without waiting for timeout", async () => {
  const { srv, port } = await occupyLoopback();
  try {
    const timeoutMs = 5000;
    const start = Date.now();
    await assert.rejects(
      oauth.startLocalCallbackServer(port, { host: LOOPBACK, timeoutMs }),
      (err) => {
        // Bun reports bind conflicts as "Failed to start server. Is port ... in use?"
        // with code EADDRINUSE, while Node's message contains EADDRINUSE.
        // Assert the stable code on both runtimes.
        assert.equal(err.code, "EADDRINUSE");
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < timeoutMs, `bind error took ${elapsed}ms, expected prompt rejection`);
  } finally {
    await closeServer(srv);
  }
});

test("loopback listener times out and cleans up", async () => {
  const listener = oauth.createLocalCallbackListener(0, { host: LOOPBACK, timeoutMs: 100 });
  const actualPort = await listener.ready;
  assert.ok(Number.isInteger(actualPort) && actualPort > 0);
  const start = Date.now();
  await assert.rejects(listener.code, /timed out after 10 minutes/);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `timeout took ${elapsed}ms, expected fast test timeout`);
});
