import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { npmCommand } from "../scripts/npm-command.mjs";
import { homeEnvironment } from "./helpers/subprocess.mjs";

const moduleFile = fileURLToPath(new URL("../dist/update-install.js", import.meta.url));
const windows = process.platform === "win32";
const name = "@sonnivasquez/gsc-mcp";
const tarballUrl = `https://registry.npmjs.org/${name}/-/gsc-mcp-1.0.1.tgz`;

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 25_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function installationEnvironment(base) {
  const home = path.join(base, "home");
  fs.mkdirSync(home);
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_|bun_|node_options|xdg_|gsc_)/i.test(key))),
    ...homeEnvironment(home),
    npm_config_prefix: path.join(base, "npm prefix"),
    npm_config_cache: path.join(base, "npm cache"),
    npm_config_userconfig: path.join(home, ".npmrc"),
    npm_config_globalconfig: path.join(home, "global-npmrc"),
    npm_config_offline: "true",
  };
}

for (const [manager, bunPrefix] of [["npm"], ["bun", "configured"], ["bun", "default"]]) {
  const label = bunPrefix ? `${manager} (${bunPrefix} prefix, reduced PATH)` : manager;
  test(`global ${label} replacement updates the matching entrypoint under Node`, { timeout: 60_000 }, t => {
    const bunName = windows ? "bun.exe" : "bun";
    const bun = spawnSync(bunName, ["-p", "process.execPath"], { encoding: "utf8", timeout: 5_000 });
    if (manager === "bun" && bun.status !== 0) return t.skip("Bun is unavailable");
    const npm = npmCommand();
    const base = fs.mkdtempSync(path.join(tmpdir(), "gsc update "));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const env = installationEnvironment(base);
    const node = run(npm.command, ["-p", "process.execPath"], base, env);

    function pack(version) {
      const fixture = path.join(base, version);
      fs.mkdirSync(path.join(fixture, "dist"), { recursive: true });
      fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name, version, bin: { gsc: "./dist/index.js" } }));
      fs.writeFileSync(path.join(fixture, "dist", "index.js"), `#!/usr/bin/env node\nconsole.log("${version}");\n`);
      const archive = run(npm.command, [...npm.args, "pack", "--ignore-scripts"], fixture, env);
      return path.join(fixture, archive);
    }

    const old = pack("1.0.0");
    const next = pack("1.0.1");
    let modules;
    let updateEnv = env;
    if (manager === "npm") {
      run(npm.command, [...npm.args, "install", "--global", "--ignore-scripts", "--no-audit", old], base, env);
      modules = path.join(env.npm_config_prefix, ...(windows ? [] : ["lib"]), "node_modules");
    } else {
      const prefix = bunPrefix === "default" ? path.join(env.HOME, ".bun") : path.join(base, "bun prefix");
      if (bunPrefix === "configured") env.BUN_INSTALL = prefix;
      const binDir = path.join(prefix, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const executable = path.join(binDir, bunName);
      fs.copyFileSync(bun.stdout.trim(), executable);
      run(executable, ["install", "--global", "--ignore-scripts", old], base, env);
      modules = path.join(prefix, "install", "global", "node_modules");
      updateEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"));
      updateEnv.PATH = path.join(base, "empty PATH");
    }
    const entry = path.join(modules, name, "dist", "index.js");
    assert.equal(run(npm.command, [entry, "--version"], base, env), "1.0.0");

    const harness = `
      const assert = require("node:assert/strict");
      const { spawnSync } = require("node:child_process");
      const fs = require("node:fs");
      const path = require("node:path");
      const [moduleFile, entry, manager, url, tarball] = process.argv.slice(1);
      const { findGlobalInstallation, installVersion } = require(moduleFile);
      (async () => {
        const found = await findGlobalInstallation(entry);
        assert.equal(found?.manager, manager);
        assert.equal(await findGlobalInstallation(__filename), undefined);
        const lock = path.resolve(entry, "../../../.gsc-mcp-update.lock");
        fs.writeFileSync(lock, "");
        assert.equal(installVersion(found, "1.0.1"), "busy");
        fs.unlinkSync(lock);

        assert.equal(installVersion(found, "1.0.1", (command, args, opts) => {
          if (!args.includes("--version")) {
            assert(args.includes(url), "Install must use the explicitly selected public artifact");
            assert(args.includes("--ignore-scripts"));
            args = args.map(arg => arg === url ? tarball : arg);
          }
          return spawnSync(command, args, opts);
        }), undefined);
        assert.equal(fs.existsSync(lock), false);
        assert.equal(installVersion(found, "1.0.0"), "changed");
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    run(node, ["-e", harness, moduleFile, entry, manager, tarballUrl, next], base, updateEnv);
    assert.equal(run(npm.command, [entry, "--version"], base, env), "1.0.1");
  });
}

test("automatic updates remember that an npx cache entry is not a global installation", { timeout: 30_000 }, t => {
  const npm = npmCommand();
  const base = fs.mkdtempSync(path.join(tmpdir(), "gsc npx "));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = installationEnvironment(base);
  const entry = path.join(env.npm_config_cache, "_npx", "0123456789abcdef", "node_modules", name, "dist", "index.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "");
  const harness = `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const [moduleFile, entry] = process.argv.slice(1);
    const dist = path.dirname(moduleFile);
    const install = require(moduleFile);
    const findGlobalInstallation = install.findGlobalInstallation;
    require(path.join(dist, "client-config.js")).packageEntrypointPath = () => entry;
    require(path.join(dist, "registry-version.js")).cachedRegistryLatest = () => assert.fail("unexpected registry check");
    let probes = 0;
    install.findGlobalInstallation = file => {
      probes++;
      return findGlobalInstallation(file);
    };
    const { findAvailableUpdate } = require(path.join(dist, "update-notice.js"));
    (async () => {
      assert.equal(await findGlobalInstallation(entry), "not-global");
      assert.equal(await findAvailableUpdate(), undefined);
      assert.equal(await findAvailableUpdate(), undefined);
      assert.equal(probes, 1);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  run(npm.command, ["-e", harness, moduleFile, entry], base, env);
});
