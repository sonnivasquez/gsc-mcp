import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const examples = JSON.parse(await readFile(new URL('../src/data/examples.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../..', import.meta.url));
test('every published example matches the real MCP SDK tools/list input schema', { timeout: 30000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'gsc-web-contract-'));
  const build = join(home, 'dist');
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--outDir', build], { cwd: root });
  await symlink(join(root, 'node_modules'), join(home, 'node_modules'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GSC_/i.test(key)));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(build, 'index.js')], stderr: 'pipe', env: { ...env, HOME: home, GSC_DATA_DIR: join(home, 'data'), GSC_AUTH_MODE: 'oauth', GSC_SITE_URLS: 'https://example.com/,https://old.example.com/' } });
  transport.stderr?.resume();
  const client = new Client({ name: 'web-reference-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const ajv = new Ajv({ strict: false, allErrors: true });
    for (const [key, example] of Object.entries(examples)) {
      const tool = tools.find((entry) => entry.name === example.name);
      assert.ok(tool, `${key}: tool exists`);
      const validate = ajv.compile(tool.inputSchema);
      assert.ok(validate(example.arguments), `${key}: ${ajv.errorsText(validate.errors)}`);
      for (const field of Object.keys(example.arguments)) assert.ok(field in tool.inputSchema.properties, `${key}: exposed field ${field}`);
    }
    const { assertSearchAnalyticsRules } = await import(join(build, 'gsc/analytics-rules.js'));
    for (const key of ['hourly', 'appearance', 'appearanceDetail']) assert.doesNotThrow(() => assertSearchAnalyticsRules(examples[key].arguments));
  } finally { await client.close(); await rm(home, { recursive: true, force: true }); }
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
