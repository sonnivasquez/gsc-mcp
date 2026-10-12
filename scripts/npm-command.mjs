// Run npm's JavaScript entrypoint directly, including on Windows where npm.cmd
// cannot be spawned as an executable. Keep argv intact for paths with spaces.
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export function npmCommand() {
  const dirs = (process.env.PATH ?? process.env.Path ?? "").split(delimiter).filter(Boolean);
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const node = dirs.map(dir => join(dir, nodeName)).find(existsSync);
  if (!node) throw new Error("Node must be on PATH to run npm");
  const candidates = [process.env.npm_execpath];
  for (const dir of [dirname(node), ...dirs]) {
    candidates.push(join(dir, "node_modules/npm/bin/npm-cli.js"));
    candidates.push(join(dir, "../lib/node_modules/npm/bin/npm-cli.js"));
    const launcher = join(dir, "npm");
    if (existsSync(launcher)) candidates.push(realpathSync(launcher));
  }
  const cli = candidates.find(candidate => candidate?.endsWith("npm-cli.js") && existsSync(candidate));
  if (!cli) throw new Error("Cannot locate npm-cli.js alongside Node or on PATH");
  return { command: node, args: [cli] };
}
