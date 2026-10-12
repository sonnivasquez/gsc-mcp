import assert from "node:assert/strict";
import test from "node:test";

const update = await import("../dist/update.js");
const { CLI_VERSION } = await import("../dist/version.js");

const PKG = "@sonnivasquez/gsc-mcp";

async function captureOutput(fn) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => out.push(args.join(" "));
  console.error = (...args) => err.push(args.join(" "));
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

const registryBody = (latest) => async () => ({
  status: 200,
  ok: true,
  json: async () => ({ "dist-tags": { latest } }),
});

const failingRegistry = (message = "getaddrinfo EAI_AGAIN registry.npmjs.org") => async () => {
  throw new Error(message);
};

test("update --help prints usage with exit 0", async () => {
  const { code, out } = await captureOutput(() => update.runUpdate(["--help"]));
  assert.equal(code, 0);
  assert.match(out.join("\n"), /gsc update/);
});

test("update reports already up to date and never spawns the installer", async () => {
  const spawns = [];
  const { code, out } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody(CLI_VERSION),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.match(out.join("\n"), new RegExp(`already up to date \\(${CLI_VERSION}\\)`));
  assert.equal(spawns.length, 0);
});
test("update never downgrades when installed is ahead of the registry", async () => {
  const spawns = [];
  const { code, out } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody("0.1.0"),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.match(out.join("\n"), /ahead of registry latest 0\.1\.0/);
  assert.doesNotMatch(out.join("\n"), /run gsc update/);
  assert.equal(spawns.length, 0);
});

test("update --check reports ahead without suggesting an update", async () => {
  const spawns = [];
  const { code, out } = await captureOutput(() =>
    update.runUpdate(["--check"], {
      registryFetchImpl: registryBody("0.1.0"),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.match(out.join("\n"), /ahead of registry latest 0\.1\.0/);
  assert.doesNotMatch(out.join("\n"), /run gsc update/);
  assert.equal(spawns.length, 0);
});

test("update on node installs canonically via npm, verifies, and reminds to restart", async () => {
  const spawns = [];
  const latest = "9.9.9";
  const { code, out } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody(latest),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        if (args.includes("--version")) return { status: 0, stdout: `${latest}\n` };
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.equal(spawns.length, 2);
  assert.deepEqual(spawns[0], {
    program: "npm",
    args: ["install", "-g", PKG],
    opts: { stdio: "inherit" },
  });
  assert.equal(spawns[1].program, process.execPath);
  assert.deepEqual(spawns[1].args, ["/fake/entry/index.js", "--version"]);
  assert.match(out.join("\n"), new RegExp(`updating ${CLI_VERSION} -> ${latest}`));
  assert.match(out.join("\n"), /restart your MCP client/);
});

test("update on bun installs canonically via bun", async () => {
  const spawns = [];
  const latest = "9.9.9";
  const { code } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody(latest),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        if (args.includes("--version")) return { status: 0, stdout: latest };
        return { status: 0 };
      },
      runtime: "bun",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.deepEqual(spawns[0], {
    program: "bun",
    args: ["install", "-g", PKG],
    opts: { stdio: "inherit" },
  });
});

test("update --check compares versions without ever spawning", async () => {
  const spawns = [];
  const latest = "9.9.9";
  const { code, out } = await captureOutput(() =>
    update.runUpdate(["--check"], {
      registryFetchImpl: registryBody(latest),
      runner: (program, args, opts) => {
        spawns.push({ program, args, opts });
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 0);
  assert.equal(spawns.length, 0);
  assert.match(out.join("\n"), new RegExp(`installed ${CLI_VERSION}, registry latest ${latest}`));
  assert.match(out.join("\n"), /gsc update/);
});

test("update surfaces installer failure as exit 1 with a fixed sentence", async () => {
  const sentinel = "SENTINEL-INSTALL-9c3a";
  const { code, out, err } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody("9.9.9"),
      runner: () => ({ status: 1, error: new Error(`boom ${sentinel}`) }),
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 1);
  assert.match([...out, ...err].join("\n"), /install_error/);
  assert.ok(![...out, ...err].join("\n").includes(sentinel));
});

test("update fails closed when verification reports the old version", async () => {
  const { code, out, err } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: registryBody("9.9.9"),
      runner: (program, args) => {
        if (args.includes("--version")) return { status: 0, stdout: CLI_VERSION };
        return { status: 0 };
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 1);
  assert.match([...out, ...err].join("\n"), /verify_error/);
});

test("update exits 1 with a fixed sentence when the registry is unreachable", async () => {
  const sentinel = "SENTINEL-REGISTRY-2f7b";
  const { code, out, err } = await captureOutput(() =>
    update.runUpdate([], {
      registryFetchImpl: failingRegistry(`getaddrinfo EAI_AGAIN ${sentinel}`),
      runner: () => {
        throw new Error("installer must stay untouched");
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 1);
  assert.match([...out, ...err].join("\n"), /registry latest unknown/);
  assert.ok(![...out, ...err].join("\n").includes(sentinel));
});

test("update rejects unknown flags without echoing them", async () => {
  const sentinel = "SENTINEL-UPDATEFLAG-5d1e";
  const { code, out, err } = await captureOutput(() =>
    update.runUpdate([`--mystery-${sentinel}`], {
      registryFetchImpl: registryBody("9.9.9"),
      runner: () => {
        throw new Error("installer must stay untouched");
      },
      runtime: "node",
      entrypoint: "/fake/entry/index.js",
    })
  );
  assert.equal(code, 2);
  assert.match(err.join("\n"), /unknown flag/);
  assert.ok(![...out, ...err].join("\n").includes(sentinel));
});
