import { MCP_TEST_TIMEOUT_MS, withMcpClient } from "./helpers/mcp-client.mjs";
import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CLIENT_KINDS, printClientConfig } from "../dist/client-config.js";

test("all client snippets and CLI config print use canonical readonly without legacy keys", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  for (const client of CLIENT_KINDS) {
    const snippet = printClientConfig(client, { command: "node", entrypoint: "/fixture/index.js" });
    const cli = spawnSync(process.execPath, ["dist/index.js", "config", "print", "--client", client], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    for (const output of [snippet, cli.stdout]) {
      assert.match(output, /GSC_ACCESS_MODE(?:=|": ")readonly/);
      assert.doesNotMatch(output, /GSC_SCOPES|GSC_ENABLE_WRITE/);
    }
  }
});

test("desktop bundle preserves the legacy saved access binding without granting writes", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const env = manifest.server.mcp_config.env;
  assert.equal(env.GSC_SCOPES, "${user_config.access_level}");
  assert.equal(Object.hasOwn(env, "GSC_ACCESS_MODE"), false);
  assert.equal(Object.hasOwn(env, "GSC_ENABLE_WRITE"), false);
  assert.match(manifest.user_config.access_level.description, /legacy/i);
  assert.match(manifest.user_config.access_level.description, /does not enable writes/);
});

test("CLI help distinguishes canonical access from deprecated write toggles", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  for (const args of [["--help"], ["setup", "--language", "en", "--help"]]) {
    const result = spawnSync(process.execPath, ["dist/index.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /setup access readonly\|full/);
  }
  const verbose = spawnSync(process.execPath, ["dist/index.js", "setup", "--language", "en", "--help", "--verbose"], { encoding: "utf8" });
  assert.equal(verbose.status, 0);
  assert.match(verbose.stdout, /setup access readonly\|full/);
  assert.match(verbose.stdout, /Deprecated.*GSC_ENABLE_WRITE/);
});

// Each server startup has its own operation/cleanup budget. Four sequential
// startups must not share a single 20s runner timeout on slower hosts.
for (const [label, access, writes] of [
  ["default readonly", {}, false],
  ["canonical full", { GSC_ACCESS_MODE: "full" }, true],
  ["canonical readonly overrides legacy", { GSC_ACCESS_MODE: "readonly", GSC_SCOPES: "full", GSC_ENABLE_WRITE: "1" }, false],
  ["legacy full without writes", { GSC_SCOPES: "full" }, false],
]) {
  test(`offline MCP capability matrix changes only the three submission tools: ${label}`, { timeout: MCP_TEST_TIMEOUT_MS }, async () => {
    const submit = ["gsc_submit_url", "gsc_submit_batch", "gsc_submit_sitemap"];
    const otherDisabled = ["gsc_image_page_audit", "gsc_genai_conversation_queries"];
    await withMcpClient({ name: "offline-access-contract", env: access }, async (client, options) => {
      const result = await client.callTool({ name: "gsc_capabilities", arguments: {} }, undefined, options);
      const envelope = JSON.parse(result.content.find((item) => item.type === "text").text);
      assert.equal(envelope.data.tools.length, 29);
      assert.deepEqual(envelope.data.disabledCapabilities, [...(writes ? [] : submit), ...otherDisabled]);
    });
  });
}
