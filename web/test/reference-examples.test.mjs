import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { createMcpClientRunner } from '../../test/helpers/mcp-client.mjs';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const examples = JSON.parse(await readFile(new URL('../src/data/examples.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../..', import.meta.url));
test('every published example matches the real MCP SDK tools/list input schema', { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'gsc-web-contract-'));
  const build = join(temporary, 'dist');
  let transportCreated = false;
  let transportClosed = false;
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--outDir', build], { cwd: root, timeout: 60000 });
    await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const withClient = createMcpClientRunner({
      makeTransport: (options) => {
        const transport = new StdioClientTransport({ ...options, args: [join(build, 'index.js')] });
        transportCreated = true;
        transport.onclose = () => { transportClosed = true; };
        return transport;
      },
    });
    await withClient({ name: 'web-reference-test', env: { GSC_SITE_URLS: 'https://example.com/,https://old.example.com/' } }, async (client, options) => {
      const { tools } = await client.listTools(undefined, options);
      const validator = new AjvJsonSchemaValidator();
      for (const [key, example] of Object.entries(examples)) {
        const tool = tools.find((entry) => entry.name === example.name);
        assert.ok(tool, `${key}: tool exists`);
        const result = validator.getValidator(tool.inputSchema)(example.arguments);
        assert.ok(result.valid, `${key}: ${result.errorMessage}`);
        for (const field of Object.keys(example.arguments)) assert.ok(field in tool.inputSchema.properties, `${key}: exposed field ${field}`);
      }
      const { assertSearchAnalyticsRules } = await import(join(build, 'gsc/analytics-rules.js'));
      for (const key of ['hourly', 'appearance', 'appearanceDetail']) assert.doesNotThrow(() => assertSearchAnalyticsRules(examples[key].arguments));
    });
  } finally {
    // The runner waits for transport close; retain the build if close was not confirmed.
    if (!transportCreated || transportClosed) await rm(temporary, { recursive: true, force: true });
    else console.error(`MCP process close unconfirmed; retained temporary build: ${temporary}`);
  }
});

test('reference routes, navigation and sitemap source lists stay aligned', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const [navigation, sections, sitemap, commands] = await Promise.all([read('../src/lib/site.ts'), read('../src/components/docs-layout.tsx'), read('../scripts/generate-sitemap.mjs'), read('../src/routes/docs.commands.tsx')]);
  for (const page of ['tools', 'audits', 'history', 'analytics']) {
    const route = await read(`../src/routes/docs.${page}.tsx`);
    assert.ok(navigation.includes(`to: "/docs/${page}"`));
    assert.ok(sections.includes(`"/docs/${page}"`));
    assert.ok(sitemap.includes(`path: "/docs/${page}"`));
    assert.ok(sitemap.includes(`web/src/routes/docs.${page}.tsx`));
    assert.ok(route.includes(`path:"/docs/${page}"`) || route.includes(`path: "/docs/${page}"`));
    assert.ok(commands.includes(`/docs/${page}`));
  }
});
