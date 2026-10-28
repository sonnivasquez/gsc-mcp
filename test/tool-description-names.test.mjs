import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CANONICAL_TOOLS } from '../dist/gsc/catalog.js';
import { toolDescription } from '../dist/tool-descriptions.js';

test('every registered tool has a description and all tool references are current', async () => {
  const sources = await Promise.all(['../src/server.ts', '../src/audits/register.ts'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const registered = sources.flatMap(source => [...source.matchAll(/toolDescription\("(gsc_[a-z0-9_]+)"/g)].map(match => match[1]));
  const names = new Set(CANONICAL_TOOLS.map(tool => tool.name));
  assert.equal(registered.length, names.size);
  assert.deepEqual(new Set(registered), names);
  for (const name of names) {
    const description = toolDescription(name);
    assert.ok(description.trim(), name);
    for (const reference of description.match(/\bgsc_[a-z0-9_]+\b/g) ?? []) {
      assert.ok(names.has(reference), `${name} references unknown tool ${reference}`);
    }
    assert.doesNotMatch(description, /\b(?:image_impressions_no_clicks|image_search_quick_wins)\b/);
  }
  assert.throws(() => toolDescription('gsc_retired_tool'), /Unknown tool description/);
});

test('image audit points to an available image-search page query', () => {
  const description = toolDescription('gsc_image_page_audit');
  assert.match(description, /gsc_search_analytics/);
  assert.match(description, /searchType=image/);
  assert.match(description, /dimensions=\[page\]/);
});

test('descriptions identify opt-in local history, export and write access', () => {
  assert.match(toolDescription('gsc_change_impact'), /GSC_HISTORY=1/);
  assert.match(toolDescription('gsc_export_dataset'), /GSC_EXPORTS=1/);
  for (const name of CANONICAL_TOOLS.filter(tool => tool.kind === 'write').map(tool => tool.name)) {
    assert.match(toolDescription(name), /write access/);
  }
});
