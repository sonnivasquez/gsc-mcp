import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
      const { assertSearchAnalyticsRules } = await import(pathToFileURL(join(build, 'gsc/analytics-rules.js')).href);
      for (const [key, example] of Object.entries(examples)) {
        const tool = tools.find((entry) => entry.name === example.name);
        assert.ok(tool, `${key}: tool exists`);
        const result = validator.getValidator(tool.inputSchema)(example.arguments);
        assert.ok(result.valid, `${key}: ${result.errorMessage}`);
        for (const field of Object.keys(example.arguments)) assert.ok(field in tool.inputSchema.properties, `${key}: exposed field ${field}`);
        if (example.name === 'gsc_search_analytics') assert.doesNotThrow(() => assertSearchAnalyticsRules(example.arguments), key);
      }
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
    const sitemapRoute = sitemap.match(new RegExp(`path: "/docs/${page}"[^}]+`))?.[0];
    assert.ok(sitemapRoute?.includes(`web/src/routes/docs.${page}.tsx`));
    const sitemapExamples = sitemapRoute.match(/examples: (\[[^\]]*\])/);
    const renderedExamples = [...route.matchAll(/<McpExample example="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(sitemapExamples ? JSON.parse(sitemapExamples[1]) : [], renderedExamples, page);
    assert.ok(route.includes(`path:"/docs/${page}"`) || route.includes(`path: "/docs/${page}"`));
    assert.ok(commands.includes(`/docs/${page}`));
  }
});

test('sitemap example dates follow the commits that changed them across a merge', async (t) => {
  const checkout = await mkdtemp(join(tmpdir(), 'gsc-sitemap-merge-'));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  const sourcePaths = ['src/gsc/catalog.ts', 'web/scripts/generate-sitemap.mjs', 'web/src', 'web/public'];
  await Promise.all([
    mkdir(join(checkout, 'src', 'gsc'), { recursive: true }),
    mkdir(join(checkout, 'web', 'scripts'), { recursive: true }),
  ]);
  await Promise.all(sourcePaths.map((path) => cp(join(root, path), join(checkout, path), { recursive: true })));
  const examplesPath = join(checkout, 'web', 'src', 'data', 'examples.json');
  const writeExamples = (data) => writeFile(examplesPath, `${JSON.stringify(data, null, 2)}\n`);
  const editExampleSite = (key, siteUrl) => {
    const example = examples[key];
    return writeExamples({ ...examples, [key]: { ...example, arguments: { ...example.arguments, siteUrl } } });
  };
  const runGit = (args, date) => execFileSync(
    'git',
    ['-c', 'user.name=Sitemap Test', '-c', 'user.email=sitemap-test@example.com', '-c', 'commit.gpgSign=false', ...args],
    {
      cwd: checkout,
      env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
      stdio: 'pipe',
    },
  );
  const commit = (message, date) => {
    runGit(['add', '--all', '--force']);
    runGit(['commit', '-qm', message], date);
  };

  runGit(['init', '--quiet', '--initial-branch=main', '--template=']);
  await writeExamples(examples);
  commit('Base', '2026-10-28T12:00:00Z');
  runGit(['branch', 'analytics']);

  await editExampleSite('analyze', 'https://audit.example/');
  commit('Edit the shared audit example', '2026-11-19T12:00:00Z');

  runGit(['switch', '--quiet', 'analytics']);
  await editExampleSite('hourly', 'https://analytics.example/');
  commit('Edit an Analytics example', '2026-11-20T12:00:00Z');

  runGit(['switch', '--quiet', 'main']);
  runGit(['merge', '--quiet', '--no-ff', '--no-edit', 'analytics'], '2026-11-22T12:00:00Z');
  execFileSync(process.execPath, [join(checkout, 'web', 'scripts', 'generate-sitemap.mjs')], { cwd: checkout });

  const sitemap = await readFile(join(checkout, 'web', 'public', 'sitemap.xml'), 'utf8');
  for (const [page, date] of [['audits', '2026-11-19'], ['history', '2026-11-19'], ['analytics', '2026-11-20']]) {
    assert.ok(sitemap.includes(`<loc>https://gscmcp.dev/docs/${page}</loc>\n    <lastmod>${date}</lastmod>`), page);
  }
});
