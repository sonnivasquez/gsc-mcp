import assert from "node:assert/strict";
import test from "node:test";

const { imagePageAudit } = await import("../dist/tools/image-page-audit.js");
const { setInstanceAllowlist, isPageUrlAllowedByAllowlist } = await import("../dist/profiles.js");
const { isPrivateLiteral, assertPublicUrl, guardedFetch } = await import("../dist/fetch-guard.js");

const publicResolveHost = async () => ["93.184.216.34"];

test("imagePageAudit audits one synthetic page with maxImagesPerPage=0 and no image fetch", async () => {
  const pageUrl = "https://example.com/page";
  const html = [
    "<!doctype html><html><head>",
    '<meta name="robots" content="max-image-preview:large">',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","primaryImageOfPage":{"@type":"ImageObject","url":"https://example.com/img1.jpg"}}</script>',
    "</head><body>",
    '<img src="https://example.com/img1.jpg" alt="A descriptive alt for testing" width="800" height="600" srcset="https://example.com/img1.jpg 800w">',
    '<img src="https://example.com/img2.jpg" alt=\"\">',
    "</body></html>",
  ].join("");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === pageUrl) {
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    throw new Error(`unexpected remote fetch: ${String(url)}`);
  };
  try {
    // Stub DNS so this test performs zero real network (fetch is mocked
    // but the fetch guard would otherwise resolve example.com via DNS).
    const out = await imagePageAudit([pageUrl], true, 0, 20, { resolveHost: publicResolveHost });
    assert.equal(out.audits.length, 1);
    const audit = out.audits[0];
    assert.equal(audit.status, "ok");
    assert.equal(audit.http_status, 200);
    assert.equal(audit.page_checks.content_images, 2);
    assert.equal(audit.page_checks.images_fetched, 0);
    assert.equal(audit.images.length, 2);
    for (const img of audit.images) {
      assert.equal(img.fetched, false);
      assert.equal(img.bytes, null);
    }
    assert.deepEqual(calls, [pageUrl]);
    assert.ok(!calls.some((u) => u.endsWith(".jpg")));
    assert.equal(out.overall.pages_audited, 1);
    assert.equal(out.overall.pages_failed, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(globalThis.fetch, realFetch);
});

test("allowlist set passes member page and rejects non-member with zero fetches", async () => {
  const pageUrl = "https://example.com/page";
  const html = "<!doctype html><html><head></head><body><img src=\"https://example.com/a.jpg\" alt=\"A descriptive alt for testing\" width=\"800\" height=\"600\"></body></html>";
  const realFetch = globalThis.fetch;
  setInstanceAllowlist(["https://example.com/"]);
  try {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url) === pageUrl) {
        return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      throw new Error(`unexpected remote fetch: ${String(url)}`);
    };
    const out = await imagePageAudit([pageUrl], true, 0, 20, { resolveHost: publicResolveHost });
    assert.equal(out.audits[0].status, "ok");
    assert.deepEqual(calls, [pageUrl]);

    calls.length = 0;
    await assert.rejects(
      imagePageAudit(["https://evil.com/"], true, 0, 20, { resolveHost: publicResolveHost }),
      /PROPERTY_NOT_ALLOWED/
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});

test("literal private page URL fails closed without a fetch call", async () => {
  const realFetch = globalThis.fetch;
  setInstanceAllowlist(null);
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`unexpected remote fetch: ${String(url)}`);
  };
  try {
    assert.equal(isPrivateLiteral("127.0.0.1"), true);
    const out = await imagePageAudit(["http://127.0.0.1/"], true, 0, 20, { resolveHost: publicResolveHost });
    assert.equal(out.audits[0].status, "fetch_failed");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});

test("redirect from an allowed page to a non-member host is blocked", async () => {
  const pageUrl = "https://example.com/redirect";
  const evilUrl = "https://evil.com/";
  const realFetch = globalThis.fetch;
  setInstanceAllowlist(["https://example.com/"]);
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === pageUrl) {
      return new Response("", { status: 301, headers: { Location: evilUrl } });
    }
    throw new Error(`redirect escape fetched: ${String(url)}`);
  };
  try {
    const out = await imagePageAudit([pageUrl], true, 0, 20, { resolveHost: publicResolveHost });
    assert.equal(out.audits[0].status, "fetch_failed");
    assert.deepEqual(calls, [pageUrl]);
    assert.ok(!calls.includes(evilUrl));
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});

test("CDN image on an allowed page is fetched with public-host policy only", async () => {
  const pageUrl = "https://example.com/page";
  const imgUrl = "https://cdn.example.net/i.jpg";
  const html = `<!doctype html><html><head></head><body><img src="${imgUrl}" alt="A descriptive alt for testing" width="800" height="600"></body></html>`;
  const realFetch = globalThis.fetch;
  setInstanceAllowlist(["https://example.com/"]);
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === pageUrl) {
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (String(url) === imgUrl) {
      return new Response("fake-image-bytes", { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    throw new Error(`unexpected remote fetch: ${String(url)}`);
  };
  try {
    const out = await imagePageAudit([pageUrl], false, 12, 20, { resolveHost: publicResolveHost });
    assert.equal(out.audits[0].status, "ok");
    const finding = out.audits[0].images.find((i) => i.src === imgUrl);
    assert.ok(finding);
    assert.equal(finding.fetched, true);
    assert.ok(typeof finding.bytes === "number" && finding.bytes > 0);
    assert.ok(!finding.issues.includes("image fetch blocked by fetch policy"));
    assert.deepEqual(calls, [pageUrl, imgUrl]);
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});
test("oversized page body without Content-Length fails without fetching images", async () => {
  const bigUrl = "https://example.com/large";
  const smallUrl = "https://example.com/small";
  const smallHtml = '<!doctype html><html><head></head><body><img src="https://example.com/a.jpg" alt="A descriptive alt" width="800" height="600"></body></html>';
  let imageCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === bigUrl) {
      const chunk = new Uint8Array(256 * 1024);
      let emitted = 0;
      const stream = new ReadableStream({
        pull(c) {
          if (emitted >= 9) { c.close(); return; }
          emitted++;
          c.enqueue(chunk);
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (String(url) === smallUrl) return new Response(smallHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    imageCalls++;
    throw new Error(`unexpected image fetch: ${String(url)}`);
  };
  try {
    const out = await imagePageAudit([bigUrl, smallUrl], false, 0, 20, { allowlistOverride: ["https://example.com/"], resolveHost: publicResolveHost });
    assert.deepEqual(out.audits.map((a) => a.status), ["fetch_failed", "ok"]);
    assert.equal(imageCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("oversized image body stays unfetched and cancels the stream", async () => {
  const pageUrl = "https://example.com/page";
  const imgUrl = "https://cdn.example.net/big.jpg";
  const html = `<!doctype html><html><head></head><body><img src="${imgUrl}" alt="A descriptive alt for testing" width="800" height="600"></body></html>`;
  let consumed = 0;
  let cancelled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === pageUrl) return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    if (String(url) === imgUrl) {
      const chunk = new Uint8Array(1024 * 1024);
      let emitted = 0;
      const stream = new ReadableStream({
        pull(c) {
          if (emitted >= 25) { c.close(); return; }
          emitted++;
          consumed++;
          c.enqueue(chunk);
        },
        cancel() { cancelled = true; },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  };
  try {
    const out = await imagePageAudit([pageUrl], false, 12, 20, { allowlistOverride: ["https://example.com/"], resolveHost: publicResolveHost });
    assert.equal(out.audits[0].status, "ok");
    const finding = out.audits[0].images.find((i) => i.src === imgUrl);
    assert.ok(finding);
    assert.equal(finding.fetched, false);
    assert.equal(finding.bytes, null);
    assert.ok(consumed < 25, `expected early cancel, consumed ${consumed}`);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("isPageUrlAllowedByAllowlist rejects evil-suffix hosts but keeps exact/prefix matches", () => {
  const allowlist = ["https://example.com"];
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com.evil.com/x", allowlist), false);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com", allowlist), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com/page", allowlist), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com?x=1", allowlist), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com#frag", allowlist), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com/page", ["https://example.com/"]), true);
  assert.equal(isPageUrlAllowedByAllowlist("https://example.com.evil.com/x", ["https://example.com/"]), false);
});

test("assertPublicUrl fails closed on empty DNS resolution without fetching", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`unexpected remote fetch: ${String(url)}`);
  };
  try {
    const emptyResolveHost = async () => [];
    await assert.rejects(
      assertPublicUrl("https://example.com/page", emptyResolveHost),
      /cannot verify host is public/
    );
    await assert.rejects(
      guardedFetch("https://example.com/page", { resolveHost: emptyResolveHost }),
      /cannot verify host is public/
    );
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    setInstanceAllowlist(null);
  }
});
