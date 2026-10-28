import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CANONICAL_TOOLS } from '../dist/gsc/catalog.js';
import { assertSearchAnalyticsRules } from '../dist/gsc/analytics-rules.js';

const read = async path => readFile(new URL(path, import.meta.url), 'utf8');
const fixture = JSON.parse(await read('../fixtures/mcp-tool-list-current.json'));
const docs = await read('../docs/tools.md');

function check(value, schema, label) {
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${label}: missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      assert.ok(schema.properties?.[key], `${label}: unsupported field ${key}`);
      check(child, schema.properties[key], `${label}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), label);
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, label);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, label);
    for (const item of value) check(item, schema.items, label);
  } else if (schema.type === 'string') {
    assert.equal(typeof value, 'string', label);
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, label);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, label);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    assert.equal(typeof value, 'number', label);
    if (schema.type === 'integer') assert.ok(Number.isInteger(value), label);
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, label);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, label);
  } else if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', label);
  else assert.fail(`${label}: unhandled schema type ${schema.type}`);
  if (schema.enum) assert.ok(schema.enum.includes(value), label);
}

test('catalog tables cover the live fixture and kinds', async () => {
  const catalog = docs.split('## Catálogo\n')[1].split('\n## Errores')[0];
  const names = [...catalog.matchAll(/^\| `(gsc_[a-z0-9_]+)` \|/gm)].map(m => m[1]);
  const expected = CANONICAL_TOOLS.map(t => t.name);
  assert.equal(names.length, expected.length);
  assert.deepEqual(new Set(names), new Set(expected));
  assert.deepEqual(new Set(fixture.map(t => t.name)), new Set(expected));
  const skillCatalog = await read('../skills/google-search-console-mcp/references/tool-catalog.md');
  for (const { name, kind } of CANONICAL_TOOLS) {
    assert.ok(skillCatalog.includes(`| \`${name}\` | ${kind} |`), name);
    assert.ok(catalog.includes(`| \`${name}\` | \`${kind}\` |`), name);
  }
});

test('documented calls use fields and constraints in the SDK tool-list fixture', () => {
  const examples = [...docs.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
  assert.ok(examples.length >= 10);
  for (const example of examples) {
    const tool = fixture.find(t => t.name === example.tool);
    assert.ok(tool, example.tool);
    check(example.arguments, tool.inputSchema, example.tool);
    if (example.tool === 'gsc_search_analytics') {
      assertSearchAnalyticsRules(example.arguments);
      assert.equal(example.arguments.dimensions.includes('hour'), example.arguments.dataState === 'hourly_all');
    }
  }
});
