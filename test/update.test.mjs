import assert from "node:assert/strict";
import test from "node:test";

const { runUpdate } = await import("../dist/update.js");
const { CLI_VERSION } = await import("../dist/version.js");

const installation = { manager: "bun", command: { program: "bun", args: [] }, entrypoint: "fixture" };
const latest = "9.9.9";
const registryBody = version => async () => ({
  ok: true,
  json: async () => ({ "dist-tags": { latest: version } }),
});

async function captureOutput(argv, deps = {}) {
  const messages = [];
  const { log, error } = console;
  console.log = console.error = (...args) => messages.push(args.join(" "));
  try {
    const code = await runUpdate(argv, {
      registryFetchImpl: async () => assert.fail("unexpected registry lookup"),
      findInstallation: async () => assert.fail("unexpected installation lookup"),
      install: () => assert.fail("unexpected installation"),
      ...deps,
    });
    return { code, output: messages.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("update help works offline", async () => {
  const { code, output } = await captureOutput(["--help"]);
  assert.equal(code, 0);
  assert.match(output, /--to <version>/);
});

test("update never installs a version equal to or older than the running version", async () => {
  for (const flags of [[], ["--check"]]) {
    const same = await captureOutput(flags, { registryFetchImpl: registryBody(CLI_VERSION) });
    assert.equal(same.code, 0);
    assert.match(same.output, /already up to date/);
    const older = await captureOutput(flags, { registryFetchImpl: registryBody("0.1.0") });
    assert.equal(older.code, 0);
    assert.match(older.output, /ahead of registry latest 0\.1\.0/);
  }
  const target = await captureOutput(["--to", "0.1.0"]);
  assert.equal(target.code, 0);
  assert.match(target.output, /ahead of requested version/);
});

test("update --check only compares versions", async () => {
  const { code, output } = await captureOutput(["--check"], { registryFetchImpl: registryBody(latest) });
  assert.equal(code, 0);
  assert.ok(output.includes(`installed ${CLI_VERSION}, registry latest ${latest}`));
});

test("update installs the checked or explicitly selected version, then reminds users to restart", async () => {
  for (const [flags, registry] of [[[], registryBody(latest)], [["--to", latest], undefined]]) {
    let installs = 0;
    const { code, output } = await captureOutput(flags, {
      ...(registry ? { registryFetchImpl: registry } : {}),
      findInstallation: async () => installation,
      install: (resolved, version) => {
        assert.equal(resolved, installation);
        assert.equal(version, latest);
        installs++;
      },
    });
    assert.equal(code, 0);
    assert.equal(installs, 1);
    assert.match(output, /verified.*restart your MCP client/);
  }
});

test("update refuses to mutate an installation it cannot identify", async () => {
  for (const result of [undefined, "not-global"]) {
    const { code, output } = await captureOutput([], {
      registryFetchImpl: registryBody(latest),
      findInstallation: async () => result,
    });
    assert.equal(code, 1);
    assert.match(output, /could not identify this global installation/);
  }
});

test("update reports installation, verification and concurrency failures", async () => {
  for (const failure of ["install_error", "verify_error", "busy", "changed"]) {
    const { code, output } = await captureOutput(["--to", latest], {
      findInstallation: async () => installation,
      install: () => failure,
    });
    assert.equal(code, 1);
    assert.ok(output.includes(`update failed (${failure})`));
  }
});

test("update handles registry outages and rejects invalid targets without echoing input", async () => {
  const sentinel = "SENTINEL-PRIVATE";
  const unavailable = await captureOutput([], {
    registryFetchImpl: async () => { throw new Error(`ETIMEDOUT ${sentinel}`); },
  });
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.output, /registry latest unknown \(timeout\)/);
  assert.ok(!unavailable.output.includes(sentinel));
  for (const args of [[`--${sentinel}`], ["--to", sentinel], ["--to", "9.9.9-rc.1"], ["--check", "--to", latest]]) {
    const invalid = await captureOutput(args);
    assert.equal(invalid.code, 2);
    assert.match(invalid.output, /invalid arguments|unknown flag/);
    assert.ok(!invalid.output.includes(sentinel));
  }
});
