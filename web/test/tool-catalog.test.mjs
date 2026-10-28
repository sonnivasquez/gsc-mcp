import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the website renders the canonical catalog and derives its displayed counts", async () => {
  const canonical = await readFile(new URL("../../src/gsc/catalog.ts", import.meta.url), "utf8");
  const names = [...canonical.matchAll(/\{ name: "(gsc_[a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, "canonical names must be unique");
  assert.ok(names.includes("gsc_page_audit") && names.includes("gsc_migration_audit"));
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [source, commands, home, flow] = await Promise.all([
    read("../src/lib/tools.ts"), read("../src/routes/docs.commands.tsx"),
    read("../src/routes/index.tsx"), read("../src/components/data-flow.tsx"),
  ]);
  assert.match(source, /export\s*\{\s*CANONICAL_TOOLS\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/src\/gsc\/catalog["']/);
  assert.match(commands, /CANONICAL_TOOLS\.map\(/);
  for (const content of [commands, home, flow]) assert.match(content, /CANONICAL_TOOLS\.length/);
});
