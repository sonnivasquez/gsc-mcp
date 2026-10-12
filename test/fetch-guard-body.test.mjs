import assert from "node:assert/strict";
import test from "node:test";

const { readBoundedBody } = await import("../dist/fetch-guard.js");

const streamOf = (chunks, { cancel } = {}) => new Response(
  new ReadableStream({
    pull(c) {
      const next = chunks.shift();
      if (next === undefined) { c.close(); return; }
      c.enqueue(next);
    },
    cancel,
  }),
);

test("bounded reader accepts exactly-at-limit and rejects overflow with cancel", async () => {
  const res = streamOf([new Uint8Array(3), new Uint8Array(3)]);
  const out = await readBoundedBody(res, { maxBytes: 6, timeoutMs: 1000 });
  assert.equal(out.length, 6);
  let cancelled = false;
  const res2 = streamOf([new Uint8Array(3), new Uint8Array(4)], { cancel: () => { cancelled = true; } });
  await assert.rejects(readBoundedBody(res2, { maxBytes: 6, timeoutMs: 1000 }), /body exceeded 6 bytes/);
  assert.equal(cancelled, true);
});

test("unicode bytes counted as UTF-8 and lying Content-Length cannot bypass", async () => {
  const bytes = Buffer.from("漢漢", "utf8");
  assert.equal(bytes.length, 6);
  const okRes = new Response(streamOf([bytes]).body, { headers: { "Content-Length": "1" } });
  const out = await readBoundedBody(okRes, { maxBytes: 6, timeoutMs: 1000 });
  assert.equal(out.length, 6);
  const overRes = new Response(streamOf([bytes]).body, { headers: { "Content-Length": "1" } });
  await assert.rejects(readBoundedBody(overRes, { maxBytes: 5, timeoutMs: 1000 }), /body exceeded 5 bytes/);
});

test("declared oversize rejects without reading chunks", async () => {
  let read = false;
  const res = new Response(
    new ReadableStream({ pull(c) { read = true; c.enqueue(new Uint8Array(1)); c.close(); } }),
    { headers: { "Content-Length": String(10 * 1024 * 1024) } },
  );
  await assert.rejects(readBoundedBody(res, { maxBytes: 1024, timeoutMs: 1000 }), /body exceeded 1024 bytes/);
  assert.equal(read, false);
});

test("null body returns empty without fallback", async () => {
  const out = await readBoundedBody(new Response(null), { maxBytes: 10, timeoutMs: 1000 });
  assert.equal(out.length, 0);
});

test("body stream errors propagate", async () => {
  const res = new Response(new ReadableStream({ pull() { throw new Error("boom"); } }));
  await assert.rejects(readBoundedBody(res, { maxBytes: 1024, timeoutMs: 1000 }), /boom/);
});

test("stalled stream times out with cancellation despite never-settling cancel", async () => {
  const res = new Response(
    new ReadableStream({ pull() {}, cancel() { return new Promise(() => {}); } }),
  );
  const start = Date.now();
  await assert.rejects(readBoundedBody(res, { maxBytes: 1024, timeoutMs: 20 }), (e) => e.code === "UPSTREAM_TIMEOUT");
  assert.ok(Date.now() - start < 2000, "timeout must reject promptly");
});

test("oversize rejects promptly despite never-settling cancel", async () => {
  const res = new Response(
    new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(10)); },
      cancel() { return new Promise(() => {}); },
    }),
  );
  const start = Date.now();
  await assert.rejects(readBoundedBody(res, { maxBytes: 5, timeoutMs: 1000 }), /body exceeded 5 bytes/);
  assert.ok(Date.now() - start < 2000, "oversize must reject promptly");
});
