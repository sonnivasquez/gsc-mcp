import { CLI_TEST_TIMEOUT_MS } from "./helpers/subprocess.mjs";
// setup-skill — T02: safe agent-skill installation through the pinned Skills CLI.
// Deterministic: injected path/runner/skills-dir seams only. No network, no Google,
// no real home-directory writes (temp dirs and injected paths only; never
// in-process HOME mutation for path resolution).
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");

const skill = await import("../dist/setup/skill-install.js");
const finish = await import("../dist/setup/finish.js");
const setup = await import("../dist/setup.js");
const clientConfig = await import("../dist/client-config.js");

const FAKE_SKILLS_DIR = join(root, "skills", "google-search-console-mcp");
const PINNED = ["--yes", "skills@1.7.0", "add", FAKE_SKILLS_DIR];

test("compatible setup targets map to Skills CLI agents", () => {
  assert.deepEqual(skill.skillAgentsForTargets(["code"]), ["claude-code"]);
  assert.deepEqual(skill.skillAgentsForTargets(["cursor"]), ["cursor"]);
  assert.deepEqual(skill.skillAgentsForTargets(["codex"]), ["codex"]);
  assert.deepEqual(skill.skillAgentsForTargets(["desktop", "code", "cursor", "codex"]), [
    "claude-code",
    "cursor",
    "codex",
  ]);
  assert.deepEqual(skill.skillAgentsForTargets(["code", "code"]), ["claude-code"]);
  // Desktop, generic, and print never claim skill support.
  assert.deepEqual(skill.skillAgentsForTargets(["desktop"]), []);
  assert.deepEqual(skill.skillAgentsForTargets(["print"]), []);
  assert.deepEqual(skill.skillAgentsForTargets(["generic"]), []);
  assert.deepEqual(skill.skillAgentsForTargets(["desktop", "print"]), []);
});

test("skill install argv is the exact pinned no-shell command", () => {
  assert.equal(skill.SKILL_NAME, "google-search-console-mcp");
  assert.equal(skill.SKILLS_CLI_SPEC, "skills@1.7.0");
  assert.equal(skill.SKILL_INSTALL_PROGRAM, "npx");
  const runtime = clientConfig.currentRuntime();
  const expectedLead = runtime === "bun" ? "--bun" : "--yes";
  const expectedProgram = runtime === "bun" ? "bunx" : "npx";
  assert.deepEqual(skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, ["claude-code", "cursor"]), [
    expectedLead,
    "skills@1.7.0",
    "add",
    FAKE_SKILLS_DIR,
    "--global",
    "--skill",
    "google-search-console-mcp",
    "--agent",
    "claude-code",
    "--agent",
    "cursor",
    "--yes",
  ]);
  assert.deepEqual(skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, ["claude-code", "cursor"], "bun"), [
    "--bun",
    "skills@1.7.0",
    "add",
    FAKE_SKILLS_DIR,
    "--global",
    "--skill",
    "google-search-console-mcp",
    "--agent",
    "claude-code",
    "--agent",
    "cursor",
    "--yes",
  ]);
  assert.deepEqual(skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, ["claude-code", "cursor"], "node"), [
    "--yes",
    "skills@1.7.0",
    "add",
    FAKE_SKILLS_DIR,
    "--global",
    "--skill",
    "google-search-console-mcp",
    "--agent",
    "claude-code",
    "--agent",
    "cursor",
    "--yes",
  ]);
  assert.deepEqual(skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, [], runtime), [
    expectedLead,
    "skills@1.7.0",
    "add",
    FAKE_SKILLS_DIR,
    "--global",
    "--skill",
    "google-search-console-mcp",
    "--yes",
  ]);
  const preview = skill.formatSkillPreviewCommand(
    skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, ["codex"], runtime),
    runtime
  );
  assert.match(preview, new RegExp(`^${expectedProgram} ${expectedLead === "--bun" ? "--bun" : "--yes"} skills@1\\.7\\.0 add `));
  assert.match(preview, /--agent codex --yes$/);
});

test("skills source resolves inside the package", () => {
  assert.equal(skill.resolvePackageSkillsDir("/pkg"), join("/pkg", "skills", "google-search-console-mcp"));
  assert.equal(skill.defaultPackageSkillsDir(), FAKE_SKILLS_DIR);
});

test("skill confirmation is explicit opt-in only", () => {
  for (const yes of ["y", "Y", "yes", "YES", "  y  "]) {
    assert.equal(skill.parseInstallSkillAnswer(yes), true, JSON.stringify(yes));
  }
  for (const no of ["", "n", "N", "no", "yeah", "1", "yep"]) {
    assert.equal(skill.parseInstallSkillAnswer(no), false, JSON.stringify(no));
  }
});

test("skill list selection defaults to skip with least privilege", () => {
  const agents = ["claude-code", "cursor", "codex"];
  // Empty default and 0 skip (least privilege: nothing installs by default).
  assert.deepEqual(skill.parseSkillSelectionAnswer("", agents), []);
  assert.deepEqual(skill.parseSkillSelectionAnswer("   ", agents), []);
  assert.deepEqual(skill.parseSkillSelectionAnswer("0", agents), []);
  assert.deepEqual(skill.parseSkillSelectionAnswer("0,2", agents), []);
  // 1 and all select every derived agent, in order.
  assert.deepEqual(skill.parseSkillSelectionAnswer("1", agents), agents);
  for (const all of ["all", "ALL", " All "]) {
    assert.deepEqual(skill.parseSkillSelectionAnswer(all, agents), agents, JSON.stringify(all));
  }
  // Display numbers are fixed: 2..N+1 pick individual agents in order.
  assert.deepEqual(skill.parseSkillSelectionAnswer("2", agents), ["claude-code"]);
  assert.deepEqual(skill.parseSkillSelectionAnswer("3", agents), ["cursor"]);
  assert.deepEqual(skill.parseSkillSelectionAnswer("4", agents), ["codex"]);
  assert.deepEqual(skill.parseSkillSelectionAnswer("2,4", agents), ["claude-code", "codex"]);
  assert.deepEqual(skill.parseSkillSelectionAnswer("4 2 2", agents), ["codex", "claude-code"]);
  // A 1 token anywhere selects all.
  assert.deepEqual(skill.parseSkillSelectionAnswer("1,4", agents), agents);
});

test("skill list selection rejects invalid tokens without echo", () => {
  const agents = ["claude-code", "cursor"];
  for (const bad of ["y", "yes", "n", "5", "-1", "2.5", "claude-code", "all!"]) {
    assert.throws(() => skill.parseSkillSelectionAnswer(bad, agents), (err) => {
      assert.ok(err instanceof Error);
      // Static copy, byte-identical for every input: rejected text is never echoed.
      assert.equal(err.message, skill.INVALID_SKILL_SELECTION_ERROR);
      return true;
    }, JSON.stringify(bad));
  }
  // Trailing separators still parse; empty and agent-less lists reject.
  assert.deepEqual(skill.parseSkillSelectionAnswer("2,", agents), ["claude-code"]);
  assert.throws(() => skill.parseSkillSelectionAnswer("1", []));
  assert.throws(() => skill.parseSkillSelectionAnswer("", []));
});

test("skill list copy matches steps 2/3 style in both locales", async () => {
  const i18n = await import("../dist/setup/i18n.js");
  assert.equal(i18n.translateSetup("en", "skillListTitle"), "Install the agent skill?");
  assert.equal(i18n.translateSetup("en", "skillListAll"), "All compatible agents (global, recommended)");
  assert.equal(i18n.translateSetup("en", "skillListSkip"), "Skip");
  assert.equal(i18n.translateSetup("en", "skillListPrompt"), "Choose [0]: ");
  assert.equal(i18n.translateSetup("es", "skillListTitle"), "¿Instalar la skill del agente?");
  assert.equal(i18n.translateSetup("es", "skillListAll"), "Todos los agentes compatibles (global, recomendado)");
  assert.equal(i18n.translateSetup("es", "skillListSkip"), "Omitir");
  assert.equal(i18n.translateSetup("es", "skillListPrompt"), "Elige [0]: ");
  // Product rows stay identical in both locales.
  assert.equal(skill.skillAgentDisplayName("claude-code", "en"), "Claude Code");
  assert.equal(skill.skillAgentDisplayName("cursor", "en"), "Cursor");
  assert.equal(skill.skillAgentDisplayName("codex", "en"), "Codex");
  assert.equal(skill.skillAgentDisplayName("claude-code", "es"), "Claude Code");
  assert.equal(skill.skillAgentDisplayName("cursor", "es"), "Cursor");
  assert.equal(skill.skillAgentDisplayName("codex", "es"), "Codex");
  assert.equal(skill.skillAgentDisplayName("unknown-agent", "en"), "unknown-agent");
});

test("non-interactive run shows no skill screen and omits by default", async () => {
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--dry-run", "--verbose", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "code"],
      {
        skillsDir: FAKE_SKILLS_DIR,
        skillRunner: () => {
          calls++;
          return { status: 0 };
        },
      }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  assert.equal(code, 0);
  assert.equal(calls, 0);
  const stdout = logs.join("\n");
  assert.ok(!stdout.includes("Install the agent skill?"), "no interactive screen without a TTY");
  assert.ok(!stdout.includes("All compatible agents"), "no list rows without a TTY");
  assert.ok(errors.join("\n").includes("Skill install skipped (pass --install-skill"));
});

test("dry-run previews the exact command and invokes nothing", async () => {
  let calls = 0;
  const logs = [];
  const outcome = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: ["claude-code"],
    dryRun: true,
    log: (m) => logs.push(m),
    runner: () => {
      calls++;
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "previewed");
  assert.equal(calls, 0);
  assert.deepEqual(outcome.agents, ["claude-code"]);
  assert.ok(outcome.command.includes("skills@1.7.0"));
  assert.ok(logs.join("\n").includes("Nothing was invoked"));
});

test("live install invokes runner once by argv with inherited stdio", async () => {
  const calls = [];
  const logs = [];
  const runtime = clientConfig.currentRuntime();
  const expectedProgram = runtime === "bun" ? "bunx" : "npx";
  const outcome = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: ["claude-code", "cursor"],
    dryRun: false,
    log: (m) => logs.push(m),
    runner: (program, args, opts) => {
      calls.push([program, [...args], opts]);
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "installed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], expectedProgram);
  assert.deepEqual(calls[0][1], skill.buildSkillInstallArgs(FAKE_SKILLS_DIR, ["claude-code", "cursor"], runtime));
  assert.deepEqual(calls[0][2], { stdio: "inherit" });
  assert.match(outcome.detail, /pinned skills@1\.7\.0/);
  assert.match(outcome.detail, /claude-code, cursor/);
});

test("unsupported targets invoke nothing and fail nothing", async () => {
  let calls = 0;
  const logs = [];
  const outcome = await skill.installSkill({
    skillsDir: FAKE_SKILLS_DIR,
    agents: [],
    dryRun: false,
    log: (m) => logs.push(m),
    runner: () => {
      calls++;
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "unsupported");
  assert.equal(calls, 0);
  assert.match(outcome.detail, /no compatible agent targets/);
  assert.match(logs.join("\n"), /Nothing was invoked/);
});

test("skill failures report truthfully without touching MCP config", async () => {
  // Independence proof: a real temp MCP config keeps byte-identical bytes
  // across every skill failure mode.
  const dir = mkdtempSync(join(tmpdir(), "gsc-skill-"));
  const configPath = join(dir, "mcp.json");
  const { applyFileConfig, buildSetupEntry } = await import("../dist/client-config.js");
  const entryEnv = { GSC_AUTH_MODE: "oauth", GSC_SCOPES: "readonly" };
  const written = await applyFileConfig({
    configPath,
    entry: buildSetupEntry(entryEnv),
    force: true,
    yes: true,
    dryRun: false,
    confirm: async () => "y",
    log: () => {},
  });
  assert.equal(written, true);
  const before = readFileSync(configPath, "utf8");

  const cases = [
    ["nonzero exit", () => ({ status: 1 }), /exit_nonzero/],
    ["throw", () => { throw new Error("spawn down"); }, /launch_error/],
    ["ENOENT", () => ({ status: null, error: Object.assign(new Error("missing"), { code: "ENOENT" }) }), /cli_missing/],
  ];
  for (const [name, runner, code] of cases) {
    const logs = [];
    const outcome = await skill.installSkill({
      skillsDir: FAKE_SKILLS_DIR,
      agents: ["codex"],
      dryRun: false,
      log: (m) => logs.push(m),
      runner,
    });
    assert.equal(outcome.status, "failed", name);
    assert.match(outcome.detail, code, name);
    assert.match(outcome.detail, /MCP client config unchanged/, name);
    assert.equal(readFileSync(configPath, "utf8"), before, `MCP config mutated by ${name}`);
    assert.match(logs.join("\n"), /MCP client config above is unchanged|no MCP config was touched/, name);
  }
});

test("missing skill bundle fails without invoking the runner", async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "gsc-skill-missing-"));
  const missingFile = join(emptyDir, "SKILL.md");
  assert.equal(skill.resolveSkillBundleFile(emptyDir), missingFile);
  assert.equal(skill.hasSkillBundle(emptyDir), false);
  assert.equal(skill.hasSkillBundle(FAKE_SKILLS_DIR), true);

  let calls = 0;
  const logs = [];
  const outcome = await skill.installSkill({
    skillsDir: emptyDir,
    agents: ["codex"],
    dryRun: false,
    log: (m) => logs.push(m),
    runner: () => {
      calls++;
      return { status: 0 };
    },
  });
  assert.equal(outcome.status, "failed");
  assert.equal(calls, 0);
  assert.match(outcome.detail, /missing_bundle/);
  assert.match(outcome.detail, /MCP client config unchanged/);
  assert.match(logs.join("\n"), /Skill source is missing/);
  assert.match(logs.join("\n"), /Nothing was invoked/);
  assert.match(logs.join("\n"), /no MCP config was touched/);

  // Unsupported stays unsupported even when the bundle is missing: the
  // deliberate global-only contract for desktop/generic/print is unchanged.
  let unsupportedCalls = 0;
  const unsupported = await skill.installSkill({
    skillsDir: emptyDir,
    agents: [],
    dryRun: false,
    log: () => {},
    runner: () => {
      unsupportedCalls++;
      return { status: 0 };
    },
  });
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupportedCalls, 0);
});

test("finish skill section is optional and fails honestly", () => {
  const base = {
    authMode: "oauth (Quick Connect)",
    scope: "readonly",
    writeEnabled: false,
    allowlist: ["sc-domain:a.example"],
    clientOutcomes: [{ target: "code", status: "applied" }],
    siteEntries: [{ siteUrl: "sc-domain:a.example" }],
    dryRun: false,
  };
  const without = finish.buildFinishReport({ ...base });
  assert.deepEqual(
    without.sections.map((s) => s.id),
    ["runtime", "auth", "api", "properties", "write_ops", "clients", "tools"]
  );

  const installed = finish.buildFinishReport({
    ...base,
    skill: { status: "installed", detail: "installed globally via pinned skills@1.7.0 (agents: claude-code)" },
  });
  assert.deepEqual(
    installed.sections.map((s) => s.id),
    ["runtime", "auth", "api", "properties", "write_ops", "clients", "tools", "skill"]
  );
  assert.equal(installed.sections.find((s) => s.id === "skill").ok, true);
  assert.equal(installed.ok, true);

  const failed = finish.buildFinishReport({
    ...base,
    skill: { status: "failed", detail: "skill install failed (exit_nonzero); MCP client config unchanged" },
  });
  const skillSection = failed.sections.find((s) => s.id === "skill");
  assert.equal(skillSection.ok, false);
  assert.equal(failed.ok, false);
  assert.match(skillSection.detail, /MCP client config unchanged/);

  for (const status of ["previewed", "unsupported"]) {
    const report = finish.buildFinishReport({ ...base, skill: { status, detail: `${status} detail` } });
    assert.equal(report.sections.find((s) => s.id === "skill").ok, true, status);
    assert.equal(report.ok, true, status);
  }
});

test("setup --help documents the explicit install-skill flag", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(process.execPath, [entry, "setup", "--help", "--verbose"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--install-skill/);
  assert.match(r.stdout, /skills@1\.7\.0/);
  assert.match(r.stdout, /--yes never enables it/);
  assert.match(r.stdout, /code->claude-code/);
});

test("--yes alone never opts into the skill install", async () => {
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "print"],
      {
        skillsDir: FAKE_SKILLS_DIR,
        skillRunner: () => {
          calls++;
          return { status: 0 };
        },
      }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.ok(errors.join("\n").includes("Skill install skipped (pass --install-skill"));
  assert.ok(!errors.join("\n").includes("[ok] skill:"));
});

test("dry-run with --install-skill previews and invokes nothing", async () => {
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  let calls = 0;
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "code", "--install-skill"],
      {
        skillsDir: FAKE_SKILLS_DIR,
        skillRunner: () => {
          calls++;
          return { status: 0 };
        },
      }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  assert.equal(code, 0);
  assert.equal(calls, 0);
  const stderr = errors.join("\n");
  const expectedSkillPreview = clientConfig.currentRuntime() === "bun" ? /dry run preview\] bunx --bun skills@1\.7\.0 add / : /dry run preview\] npx --yes skills@1\.7\.0 add /;
  assert.match(stderr, expectedSkillPreview);
  assert.match(stderr, /Nothing was invoked/);
  assert.match(stderr, /\[ok\] skill: preview:/);
});

function writeTempKeyFile(dir) {
  const keyFile = join(dir, "sa.json");
  writeFileSync(keyFile, JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  }));
  return keyFile;
}

function saveSkillEnv() {
  const saved = {};
  for (const k of ["GSC_ACCESS_MODE", "GSC_SCOPES", "GSC_AUTH_MODE", "GSC_KEY_FILE", "GSC_OAUTH_SECRETS_FILE", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_SITE_URLS", "GSC_ENABLE_WRITE"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return saved;
}

function restoreSkillEnv(saved, savedHome) {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

test("live skill failure exits nonzero while the MCP config stays applied", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-skill-home-"));
  const keyFile = writeTempKeyFile(home);
  const savedHome = process.env.HOME;
  const saved = saveSkillEnv();
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  const invocations = [];
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--verbose", "--yes", "--auth", "service-account", "--key-file", keyFile, "--site", "sc-domain:a.example", "--client", "cursor", "--install-skill"],
      {
        // Single-call seam: no Google, no network, no OAuth browser.
        listSitesRaw: async () => ({ siteEntry: [{ siteUrl: "sc-domain:a.example" }] }),
        skillsDir: FAKE_SKILLS_DIR,
        resolveFileConfigPath: (target) => clientConfig.resolveFileConfigPath(target, home),
        skillRunner: (program, args, opts) => {
          invocations.push([program, [...args], opts]);
          return { status: 1 };
        },
      }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
    restoreSkillEnv(saved, savedHome);
  }
  // Pinned argv invoked exactly once, by program+argv, never a shell.
  assert.equal(invocations.length, 1);
  const expectedProgram = clientConfig.currentRuntime() === "bun" ? "bunx" : "npx";
  const expectedLead = clientConfig.currentRuntime() === "bun" ? "--bun" : "--yes";
  assert.equal(invocations[0][0], expectedProgram);
  assert.deepEqual(invocations[0][1][0], expectedLead);
  assert.equal(invocations[0][1][1], "skills@1.7.0");
  assert.deepEqual(invocations[0][2], { stdio: "inherit" });
  assert.ok(invocations[0][1].includes("--agent"));
  assert.ok(invocations[0][1].includes("cursor"));
  // Truthful nonzero with the MCP config still applied underneath.
  assert.equal(code, 1);
  const stderr = errors.join("\n");
  assert.match(stderr, /Skill install failed; the MCP client config above is unchanged/);
  assert.match(stderr, /\[!!\] skill: skill install failed/);
  assert.match(stderr, /cursor previewed|configured: cursor/);
  // Skill-only failure keeps the success header: the MCP config applied, so
  // the finish report must not claim configuration failed.
  assert.match(stderr, /Finish verification:/);
  assert.ok(!stderr.includes("configuration failed"), "skill-only failure must not claim MCP configuration failed");
  const configPath = join(home, ".cursor", "mcp.json");
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.mcpServers.gsc.command, process.execPath);
  assert.deepEqual(written.mcpServers.gsc.args, [clientConfig.packageEntrypointPath(), "serve"]);
});
test("live skill success keeps exit zero with the MCP config applied", async () => {
  const home = mkdtempSync(join(tmpdir(), "gsc-skill-home-"));
  const keyFile = writeTempKeyFile(home);
  const savedHome = process.env.HOME;
  const saved = saveSkillEnv();
  const errors = [];
  const logs = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (msg) => errors.push(String(msg));
  console.log = (msg) => logs.push(String(msg));
  const invocations = [];
  let code = -1;
  try {
    code = await setup.runSetup(
      ["--language", "en", "--verbose", "--yes", "--auth", "service-account", "--key-file", keyFile, "--site", "sc-domain:a.example", "--client", "cursor", "--install-skill"],
      {
        listSitesRaw: async () => ({ siteEntry: [{ siteUrl: "sc-domain:a.example" }] }),
        skillsDir: FAKE_SKILLS_DIR,
        resolveFileConfigPath: (target) => clientConfig.resolveFileConfigPath(target, home),
        skillRunner: (program, args, opts) => {
          invocations.push([program, [...args], opts]);
          return { status: 0 };
        },
      }
    );
  } finally {
    console.error = origError;
    console.log = origLog;
    restoreSkillEnv(saved, savedHome);
  }
  // File target (cursor) applies locally under the injected temp path; the injected
  // skill runner proves the skill path ran without any real CLI or network.
  assert.equal(invocations.length, 1);
  const expectedProgram2 = clientConfig.currentRuntime() === "bun" ? "bunx" : "npx";
  assert.equal(invocations[0][0], expectedProgram2);
  assert.equal(invocations[0][1][1], "skills@1.7.0");
  assert.ok(invocations[0][1].includes("--agent"));
  assert.ok(invocations[0][1].includes("cursor"));
  assert.deepEqual(invocations[0][2], { stdio: "inherit" });
  assert.equal(code, 0);
  assert.match(errors.join("\n"), /\[ok\] skill: installed globally/);
  assert.match(errors.join("\n"), /configured: cursor/);
  const written = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(written.mcpServers.gsc.command, process.execPath);
  assert.deepEqual(written.mcpServers.gsc.args, [clientConfig.packageEntrypointPath(), "serve"]);
});
test("setup dry-run CLI previews the skill command without invoking", { timeout: CLI_TEST_TIMEOUT_MS }, () => {
  const r = spawnSync(
    process.execPath,
    [entry, "setup", "--language", "en", "--dry-run", "--verbose", "--yes", "--auth", "shared", "--site", "sc-domain:a.example", "--client", "code", "--install-skill"],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0);
  const expectedPreview = clientConfig.currentRuntime() === "bun" ? /dry run preview\] bunx --bun skills@1\.7\.0 add / : /dry run preview\] npx --yes skills@1\.7\.0 add /;
  assert.match(r.stderr, expectedPreview);
  assert.match(r.stderr, /--agent claude-code --yes/);
  assert.match(r.stderr, /\[ok\] skill: preview:/);
});
