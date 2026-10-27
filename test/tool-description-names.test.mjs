import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "compatibility-manifest.json"), "utf8"));

function legacyNames() {
  const names = new Set(manifest.publicRegistry.retiredLegacy);
  for (const capability of manifest.capabilities) {
    if (typeof capability.legacy === "string" && capability.legacy !== "") names.add(capability.legacy);
  }
  return names;
}

async function registeredTools() {
  const home = mkdtempSync(join(tmpdir(), "gsc-tool-names-"));
  const child = spawn(process.execPath, [join(root, "dist/index.js")], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      GSC_DATA_DIR: join(home, "data"),
      GSC_AUTH_MODE: "oauth",
      LANG: "en_US.UTF-8",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const messages = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) messages.set(message.id, message);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "tool-description-names", version: "0" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list", params: {} });
    const deadline = Date.now() + 20_000;
    while (!messages.has(2) && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    assert.ok(messages.has(2), stderr || "tools/list did not answer");
    return messages.get(2).result.tools;
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

test("tool descriptions name only registered gsc_* tools", async () => {
  const tools = await registeredTools();
  assert.equal(tools.length, 29);
  const registered = new Set(tools.map((tool) => tool.name));
  const retired = legacyNames();
  const gscName = /\bgsc_[a-z0-9_]+\b/g;
  for (const tool of tools) {
    for (const mentioned of tool.description.match(gscName) ?? []) {
      assert.ok(registered.has(mentioned), `${tool.name} mentions unregistered ${mentioned}`);
    }
    for (const name of retired) {
      if (registered.has(name)) continue;
      const token = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
      assert.equal(token.test(tool.description), false, `${tool.name} mentions retired tool ${name}`);
    }
  }
  const image = tools.find((tool) => tool.name === "gsc_image_page_audit");
  assert.match(image.description, /gsc_find_opportunities/);
  assert.match(image.description, /gsc_search_analytics/);
  assert.doesNotMatch(image.description, /image_impressions_no_clicks|image_search_quick_wins/);
});
