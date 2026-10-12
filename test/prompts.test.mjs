import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TEST_TIMEOUT_MS, withMcpClient } from "./helpers/mcp-client.mjs";

test("prompts list and resolve without credentials", { timeout: MCP_TEST_TIMEOUT_MS }, async () => {
  await withMcpClient({ name: "prompts-test" }, async (client, options) => {
    const { prompts } = await client.listPrompts(undefined, options);
    assert.deepEqual(prompts.map((p) => p.name).sort(), [
      "investigate_traffic_drop",
      "page_performance_review",
      "seo_weekly_report",
    ]);
    const got = await client.getPrompt({
      name: "page_performance_review",
      arguments: { siteUrl: "sc-domain:example.com", pageUrl: "https://example.com/p" },
    }, options);
    assert.equal(got.messages.length, 1);
    assert.match(got.messages[0].content.text, /gsc_page_queries/);
    assert.match(got.messages[0].content.text, /https:\/\/example\.com\/p/);
  });
});
