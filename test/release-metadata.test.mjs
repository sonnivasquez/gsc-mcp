import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { CLI_VERSION } from "../dist/version.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const json = (path) => JSON.parse(read(path));
const pkg = json("package.json");

test("release versions agree across package, lock, manifest, source and built CLI", () => {
  assert.equal(CLI_VERSION, pkg.version, "rebuild dist before packing");
  assert.equal(json("manifest.json").version, pkg.version);
  const registry = json("server.json");
  assert.equal(registry.version, pkg.version);
  assert.ok(registry.packages.every(entry => entry.version === pkg.version));
  const lock = json("package-lock.json");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(read("src/version.ts").match(/CLI_VERSION = "([^"]+)"/)[1], pkg.version);
  assert.equal(read("web/src/lib/site.ts").match(/PKG_VERSION = "([^"]+)"/)[1], pkg.version);
  assert.ok(read("CHANGELOG.md").includes(`## ${pkg.version}\n`));
});

test("Bun workspace metadata names the published package", () => {
  const workspace = read("bun.lock").split('"packages":')[0];
  assert.equal(workspace.match(/"name": "([^"]+)"/)[1], pkg.name);
});

test("npm includes the local documents linked from README and quickstarts", () => {
  for (const path of ["PRIVACY.md", "ROADMAP.md", "docs/tools.md", "docs/quickstart.md", "docs/quickstart.es.md"]) {
    assert.ok(pkg.files.includes(path), `missing packaged document: ${path}`);
    assert.ok(read(path).length > 0);
  }
});
