import assert from "node:assert/strict";
import test from "node:test";

const { submitSitemap } = await import("../dist/tools/submit-sitemap.js");
const { submitUrl, submitBatch } = await import("../dist/tools/submit-url.js");
const { assertWriteEnabled } = await import("../dist/auth.js");
const { setInstanceAllowlist } = await import("../dist/profiles.js");

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const SITE = "sc-domain:selected.example";
test("write gate needs full scope and explicit flag", async () => {
  await withEnv({ GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () => {
    assert.throws(() => assertWriteEnabled("X"), /GSC_SCOPES=full/);
  });
  await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () => {
    assert.throws(() => assertWriteEnabled("X"), /GSC_ENABLE_WRITE=1/);
  });
  await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () => {
    assertWriteEnabled("X");
  });
});

test("submitSitemap refuses gated writes, submits when enabled", async () => {
  const fake = { sitemaps: { submit: async () => ({}) } };
  const deniedScope = await withEnv({ GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () =>
    submitSitemap("https://selected.example/sitemap.xml", SITE, fake)
  );
  assert.equal(deniedScope.success, false);
  assert.match(deniedScope.error, /GSC_SCOPES=full/);

  const deniedFlag = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () =>
    submitSitemap("https://selected.example/sitemap.xml", SITE, fake)
  );
  assert.equal(deniedFlag.success, false);
  assert.match(deniedFlag.error, /GSC_ENABLE_WRITE=1/);

  const allowed = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
    submitSitemap("https://selected.example/sitemap.xml", SITE, fake)
  );
  assert.equal(allowed.success, true);
  assert.equal(allowed.siteUrl, SITE);
});

test("submitUrl refuses gated writes before any client", async () => {
  const deniedScope = await withEnv({ GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, async () =>
    submitUrl("https://selected.example/p")
  );
  assert.equal(deniedScope.success, false);
  assert.match(deniedScope.error, /GSC_SCOPES=full/);
  const deniedFlag = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, async () =>
    submitUrl("https://selected.example/p")
  );
  assert.equal(deniedFlag.success, false);
  assert.match(deniedFlag.error, /GSC_ENABLE_WRITE=1/);
});

test("submitUrl succeeds and fails through the injected indexing seam (no Google)", async () => {
  const okClient = {
    urlNotifications: {
      publish: async ({ requestBody }) => {
        assert.ok(
          requestBody.url === "https://selected.example/p" || requestBody.url === "https://selected.example/q",
          `unexpected url ${requestBody.url}`
        );
        assert.equal(requestBody.type, "URL_UPDATED");
        return { data: { urlNotificationMetadata: { latestUpdate: { notifyTime: "2026-09-01T00:00:00Z" } } } };
      },
    },
  };
  const ok = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
    submitUrl("https://selected.example/p", "URL_UPDATED", okClient)
  );
  assert.equal(ok.success, true);
  assert.equal(ok.notifyTime, "2026-09-01T00:00:00Z");
  assert.equal(ok.url, "https://selected.example/p");
  assert.equal(ok.type, "URL_UPDATED");
  assert.equal(ok.error, null);

  const defaulted = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
    submitUrl("https://selected.example/q", undefined, okClient)
  );
  assert.equal(defaulted.type, "URL_UPDATED");
  assert.equal(defaulted.success, true);

  const failingClient = {
    urlNotifications: {
      publish: async () => {
        throw new Error("indexing API disabled");
      },
    },
  };
  const failed = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
    submitUrl("https://selected.example/p", "URL_DELETED", failingClient)
  );
  assert.equal(failed.success, false);
  assert.match(failed.error, /indexing API disabled/);
  assert.equal(failed.notifyTime, null);
  assert.equal(failed.type, "URL_DELETED");
});

test("submitUrl enforces the write gate before touching the injected client", async () => {
  let calls = 0;
  const counting = {
    urlNotifications: {
      publish: async () => {
        calls++;
        return { data: {} };
      },
    },
  };
  const deniedScope = await withEnv({ GSC_SCOPES: undefined, GSC_ENABLE_WRITE: undefined }, () =>
    submitUrl("https://selected.example/p", "URL_UPDATED", counting)
  );
  assert.equal(deniedScope.success, false);
  assert.match(deniedScope.error, /GSC_SCOPES=full/);
  const deniedFlag = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () =>
    submitUrl("https://selected.example/p", "URL_UPDATED", counting)
  );
  assert.equal(deniedFlag.success, false);
  assert.match(deniedFlag.error, /GSC_ENABLE_WRITE=1/);
  assert.equal(calls, 0);
});

test("submitBatch mixes success/failure through the seam, keeps defaults, and guards quota+gates", async () => {
  const mixed = {
    urlNotifications: {
      publish: async ({ requestBody }) => {
        if (requestBody.url.endsWith("/bad")) throw new Error("nope");
        return { data: { urlNotificationMetadata: { latestUpdate: { notifyTime: "2026-09-01T00:00:00Z" } } } };
      },
    },
  };
  const batch = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
    submitBatch(["https://selected.example/good", "https://selected.example/bad"], "URL_UPDATED", mixed)
  );
  assert.equal(batch.results.length, 2);
  assert.equal(batch.summary.total, 2);
  assert.equal(batch.summary.succeeded, 1);
  assert.equal(batch.summary.failed, 1);
  assert.equal(batch.results[0].success, true);
  assert.equal(batch.results[1].success, false);

  let quotaCalls = 0;
  const quotaClient = {
    urlNotifications: {
      publish: async () => {
        quotaCalls++;
        return { data: {} };
      },
    },
  };
  await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, async () => {
    await assert.rejects(
      () => submitBatch(Array.from({ length: 201 }, (_, i) => `https://selected.example/${i}`), "URL_UPDATED", quotaClient),
      /200/
    );
  });
  assert.equal(quotaCalls, 0);

  let gatedCalls = 0;
  const gatedClient = {
    urlNotifications: {
      publish: async () => {
        gatedCalls++;
        return { data: {} };
      },
    },
  };
  const gated = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: undefined }, () =>
    submitBatch(["https://selected.example/a"], "URL_UPDATED", gatedClient)
  );
  assert.equal(gated.results.length, 1);
  assert.equal(gated.results[0].success, false);
  assert.match(gated.results[0].error, /GSC_ENABLE_WRITE=1/);
  assert.equal(gated.summary.succeeded, 0);
  assert.equal(gated.summary.failed, 1);
  assert.equal(gatedCalls, 0);
});

test("submitUrl rejects off-allowlist URLs locally with zero client calls", async () => {
  setInstanceAllowlist(["https://selected.example/"]);
  try {
    let calls = 0;
    const counting = {
      urlNotifications: {
        publish: async () => {
          calls++;
          return { data: { urlNotificationMetadata: { latestUpdate: { notifyTime: "2026-09-01T00:00:00Z" } } } };
        },
      },
    };
    const denied = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
      submitUrl("https://other.example/x", "URL_UPDATED", counting)
    );
    assert.equal(denied.success, false);
    assert.match(denied.error, /PROPERTY_NOT_ALLOWED/);
    assert.equal(calls, 0);

    const allowed = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
      submitUrl("https://selected.example/allowed", "URL_UPDATED", counting)
    );
    assert.equal(allowed.success, true);
    assert.equal(allowed.error, null);
    assert.equal(calls, 1);
  } finally {
    setInstanceAllowlist(null);
  }
});

test("submitBatch returns mixed per-URL results for off-allowlist URLs", async () => {
  setInstanceAllowlist(["https://selected.example/"]);
  try {
    let calls = 0;
    const seen = [];
    const counting = {
      urlNotifications: {
        publish: async ({ requestBody }) => {
          calls++;
          seen.push(requestBody.url);
          return { data: { urlNotificationMetadata: { latestUpdate: { notifyTime: "2026-09-01T00:00:00Z" } } } };
        },
      },
    };
    const mixed = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
      submitBatch(
        ["https://selected.example/a", "https://other.example/x", "https://selected.example/b"],
        "URL_UPDATED",
        counting
      )
    );
    assert.equal(mixed.results.length, 3);
    assert.equal(mixed.summary.total, 3);
    assert.equal(mixed.summary.succeeded, 2);
    assert.equal(mixed.summary.failed, 1);
    assert.equal(mixed.results[0].url, "https://selected.example/a");
    assert.equal(mixed.results[0].success, true);
    assert.equal(mixed.results[1].url, "https://other.example/x");
    assert.equal(mixed.results[1].success, false);
    assert.match(mixed.results[1].error, /PROPERTY_NOT_ALLOWED/);
    assert.equal(mixed.results[1].notifyTime, null);
    assert.equal(mixed.results[2].url, "https://selected.example/b");
    assert.equal(mixed.results[2].success, true);
    assert.deepEqual(seen, ["https://selected.example/a", "https://selected.example/b"]);
    assert.equal(calls, 2);

    const allDenied = await withEnv({ GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, () =>
      submitBatch(["https://other.example/x", "https://other.example/y"], "URL_UPDATED", counting)
    );
    assert.equal(allDenied.results.length, 2);
    assert.equal(allDenied.summary.succeeded, 0);
    assert.equal(allDenied.summary.failed, 2);
    assert.equal(allDenied.results[0].success, false);
    assert.match(allDenied.results[0].error, /PROPERTY_NOT_ALLOWED/);
    assert.equal(allDenied.results[1].success, false);
    assert.match(allDenied.results[1].error, /PROPERTY_NOT_ALLOWED/);
    assert.equal(calls, 2);
  } finally {
    setInstanceAllowlist(null);
  }
});
