// T03 — localized first-install client-target application feedback.
// Focused English/Spanish coverage for print/generic fallback, unavailable
// config paths, file dry-run previews, CLI dry-run previews, exact
// JSON/command/path/redaction token preservation, Spanish affirmative file
// confirmation in a temp directory, default-no decline, restart guidance,
// failure guidance, and no write/invocation during dry-run. No network, no
// Google, no real config edits: file targets resolve into temp directories
// and CLI targets use an injected runner.
import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const setup = await import("../dist/setup.js");
const clientConfig = await import("../dist/client-config.js");
const setupI18n = await import("../dist/setup/i18n.js");

const ENV = {
  GSC_AUTH_MODE: "oauth",
  GSC_ACCESS_MODE: "readonly",
  GSC_SITE_URLS: '["sc-domain:a.example"]',
};

function stubPrompter(answer = "n", onQuestion) {
  return {
    text: async (question, fallback) => {
      if (onQuestion) onQuestion(question);
      return answer;
    },
    choose: async (_question, _choices, defaultIndex) => defaultIndex,
    close: () => undefined,
  };
}

async function captureOutput(fn) {
  const logs = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (message) => logs.push(String(message));
  console.error = (message) => logs.push(String(message));
  try {
    const result = await fn();
    return { logs, result };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

function printedJson(logs) {
  const block = logs.find((line) => line.trim().startsWith("{"));
  assert.ok(block, `expected a printed JSON block in: ${logs.join("\n")}`);
  return JSON.parse(block);
}

// --- Print/generic fallback ---

test("print fallback heading localizes while JSON stays exact", async () => {
  const expectedCommand = process.execPath;
  const en = await captureOutput(() =>
    setup.applyTargets(["print"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "en" })
  );
  assert.equal(en.result.ok, true);
  assert.deepEqual(en.result.outcomes.map((o) => o.status), ["printed"]);
  assert.ok(en.logs.some((l) => l.includes("Add this to your MCP client config:")));
  const enJson = printedJson(en.logs);
  assert.equal(enJson.mcpServers.gsc.command, expectedCommand);
  assert.deepEqual(enJson.mcpServers.gsc.env, ENV);

  const es = await captureOutput(() =>
    setup.applyTargets(["print"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" })
  );
  assert.equal(es.result.ok, true);
  assert.deepEqual(es.result.outcomes.map((o) => o.status), ["printed"]);
  assert.ok(es.logs.some((l) => l.includes("Añada esto a la configuración de su cliente MCP:")));
  assert.ok(!es.logs.some((l) => l.includes("Add this to your MCP client config:")));
  const esJson = printedJson(es.logs);
  assert.deepEqual(esJson, enJson);
  // Structured notes stay English in both locales.
  assert.equal(es.result.outcomes[0].note, en.result.outcomes[0].note);
});

test("generic target uses the same localized heading", async () => {
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["generic"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" })
  );
  assert.equal(result.ok, true);
  assert.equal(result.outcomes[0].target, "generic");
  assert.ok(logs.some((l) => l.includes("Añada esto a la configuración de su cliente MCP:")));
  assert.ok(printedJson(logs).mcpServers.gsc);
});

// --- Unavailable config path ---

test("unavailable config path falls back to generic output with localized guidance", async () => {
  const noPath = { resolveFileConfigPath: () => null };
  const en = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "en" }, noPath)
  );
  assert.equal(en.result.ok, true);
  assert.equal(en.result.outcomes[0].status, "printed");
  assert.ok(en.logs.some((l) => l.includes("Cannot safely locate the desktop config on this machine")));
  assert.ok(printedJson(en.logs).mcpServers.gsc);

  const es = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" }, noPath)
  );
  assert.equal(es.result.ok, true);
  assert.equal(es.result.outcomes[0].status, "printed");
  assert.ok(es.logs.some((l) => l.includes("No se puede localizar de forma segura la configuración de desktop")));
  assert.ok(!es.logs.some((l) => l.includes("Cannot safely locate")));
  // The structured note is internal and stays English.
  assert.match(es.result.outcomes[0].note ?? "", /unavailable/);
  assert.equal(es.result.outcomes[0].note, en.result.outcomes[0].note);
});

// --- File dry-run preview ---

test("file dry-run previews without writing and preserves exact tokens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "preview-config.json");
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "en" }, {
      resolveFileConfigPath: () => configPath,
    })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["previewed"]);
  assert.equal(result.outcomes[0].note, "preview only; no file written");
  assert.equal(existsSync(configPath), false, "dry-run must not write the client file");
  assert.deepEqual(readdirSync(dir), [], "dry-run must not create backups either");
  const text = logs.join("\n");
  assert.ok(text.includes(`Config file: ${configPath}`), "exact config path preserved");
  assert.ok(text.includes("mcpServers.gsc"), "config key preserved");
  assert.ok(text.includes("[redacted]") || text.includes("(no existing gsc entry)"));
  assert.ok(text.includes("[dry run]"), "dry-run marker preserved");
  assert.ok(text.includes("No file written"));
});

test("Spanish file dry-run localizes labels while tokens stay exact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "preview-config.json");
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" }, {
      resolveFileConfigPath: () => configPath,
    })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["previewed"]);
  assert.equal(existsSync(configPath), false, "dry-run must not write the client file");
  const text = logs.join("\n");
  assert.ok(text.includes(`Archivo de configuración: ${configPath}`), "exact config path preserved");
  assert.ok(text.includes("mcpServers.gsc"), "config key preserved");
  assert.ok(text.includes("[dry run]"), "dry-run marker preserved");
  assert.ok(text.includes("No se escribió ningún archivo"));
  assert.ok(!text.includes("Config file:"), "English label must not leak into the Spanish run");
  // The structured note stays English.
  assert.equal(result.outcomes[0].note, "preview only; no file written");
});

test("dry-run preview never displays existing secret values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "secret-config.json");
  const oldSecret = "SENTINEL_T03_OLD_7f2a";
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { gsc: { command: "old", args: [], env: { GSC_OAUTH_CLIENT_SECRET: oldSecret } } } })
  );
  try {
    const { logs, result } = await captureOutput(() =>
      setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" }, {
        resolveFileConfigPath: () => configPath,
      })
    );
    assert.equal(result.ok, true);
    const text = logs.join("\n");
    assert.ok(!text.includes(oldSecret), "existing secret leaked into the preview");
    assert.ok(text.includes("[redacted]"), "redaction marker preserved");
    assert.ok(text.includes("GSC_OAUTH_CLIENT_SECRET"), "key names survive redaction");
    assert.ok(text.includes(`"command": ${JSON.stringify(process.execPath)}`), "new entry still shown in full");
    assert.equal(readFileSync(configPath, "utf8").includes(oldSecret), true, "fixture untouched");
  } finally {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { gsc: { command: "old" } } }));
  }
});

// --- CLI dry-run preview ---

test("CLI dry-run previews the exact argv and invokes nothing", async () => {
  let calls = 0;
  const expected = clientConfig.formatPreviewCommand("claude", clientConfig.buildClaudeCodeArgs(ENV));
  assert.ok(expected.includes(process.execPath), "preview carries the selected absolute runtime");
  assert.ok(expected.includes(clientConfig.packageEntrypointPath()), "preview carries the installed package entry point");
  assert.ok(!expected.includes("npx") && !expected.includes("bunx"), "preview does not depend on a package runner");
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["code"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "en" }, {
      runner: () => {
        calls++;
        return { status: 0 };
      },
    })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["previewed"]);
  assert.equal(calls, 0, "dry-run must not invoke the CLI");
  const text = logs.join("\n");
  assert.ok(text.includes(`[dry run preview] ${expected}`), "exact argv preserved");
  assert.ok(text.includes("Nothing was invoked"));
});

test("Spanish CLI dry-run localizes the notice while the argv stays exact", async () => {
  let calls = 0;
  const expected = clientConfig.formatPreviewCommand("codex", clientConfig.buildCodexArgs(ENV));
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["codex"], ENV, stubPrompter(), { force: false, yes: true, dryRun: true, locale: "es" }, {
      runner: () => {
        calls++;
        return { status: 0 };
      },
    })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["previewed"]);
  assert.equal(calls, 0, "dry-run must not invoke the CLI");
  const text = logs.join("\n");
  assert.ok(text.includes(`[dry run preview] ${expected}`), "exact argv preserved");
  assert.ok(text.includes("No se invocó nada"));
  assert.ok(!text.includes("Nothing was invoked"));
  assert.equal(result.outcomes[0].note, "preview only; nothing invoked");
});

// --- Confirmation handling ---

test("Spanish affirmative file confirmation writes in a temp directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "nuevo", "mcp.json");
  const questions = [];
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter("si", (q) => questions.push(q)), {
      force: false,
      yes: false,
      dryRun: false,
      locale: "es",
    }, { resolveFileConfigPath: () => configPath })
  );
  assert.equal(result.ok, true, `stderr: ${logs.join("\n")}`);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["applied"]);
  assert.ok(questions.some((q) => q.includes("Escribir una nueva entrada")), `confirm in Spanish: ${questions.join(" | ")}`);
  assert.ok(questions.some((q) => q.includes("[y/N]")), "confirmation marker preserved");
  assert.ok(questions.some((q) => q.includes(configPath)), "exact path in the confirm");
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.mcpServers.gsc.command, process.execPath);
  assert.equal(written.mcpServers.gsc.args[0], clientConfig.packageEntrypointPath());
  assert.deepEqual(written.mcpServers.gsc.env, ENV);
  assert.ok(logs.some((l) => l.includes("Reinicie Claude Desktop")), "Spanish restart guidance");
});

test("English yes confirms and empty answer declines by default", async () => {
  const dirYes = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const yesPath = join(dirYes, "mcp.json");
  const approved = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter("yes"), {
      force: false,
      yes: false,
      dryRun: false,
      locale: "en",
    }, { resolveFileConfigPath: () => yesPath })
  );
  assert.equal(approved.result.ok, true);
  assert.deepEqual(approved.result.outcomes.map((o) => o.status), ["applied"]);
  assert.ok(existsSync(yesPath), "English yes confirms the write");

  const dirNo = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const noPath = join(dirNo, "mcp.json");
  const declined = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(""), {
      force: false,
      yes: false,
      dryRun: false,
      locale: "en",
    }, { resolveFileConfigPath: () => noPath })
  );
  assert.equal(declined.result.ok, false);
  assert.deepEqual(declined.result.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(declined.result.outcomes[0].note, "confirmation declined; nothing was changed");
  assert.equal(existsSync(noPath), false, "default-no decline writes nothing");
  assert.ok(declined.logs.some((l) => l.includes("Skipped writing the config file")));

  const dirEs = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const esPath = join(dirEs, "mcp.json");
  const esDeclined = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter("n"), {
      force: false,
      yes: false,
      dryRun: false,
      locale: "es",
    }, { resolveFileConfigPath: () => esPath })
  );
  assert.deepEqual(esDeclined.result.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(existsSync(esPath), false, "Spanish decline writes nothing");
  assert.ok(esDeclined.logs.some((l) => l.includes("Se omitió la escritura")));
  assert.equal(esDeclined.result.outcomes[0].note, "confirmation declined; nothing was changed");
});

// --- Restart and backup guidance ---

test("successful file apply prints restart guidance and a backup notice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "mcp.json");
  writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: "keep" } } }));
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["cursor"], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "en" }, {
      resolveFileConfigPath: () => configPath,
    })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["applied"]);
  const text = logs.join("\n");
  assert.ok(text.includes("Restart Cursor to pick it up."));
  assert.ok(text.includes("Backup:"), "backup notice printed");
  assert.ok(text.includes("mcpServers.gsc") || text.includes("only mcpServers.gsc changed"));
  const backups = readdirSync(dir).filter((f) => f.includes(".backup-"));
  assert.equal(backups.length, 1, "timestamped backup kept");
  const next = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(next.mcpServers.other, { command: "keep" }, "unrelated servers preserved");
});

// --- Failure guidance ---

test("file failure guidance localizes while bytes stay identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const badFile = join(dir, "bad-config.json");
  const original = "{invalid json";
  writeFileSync(badFile, original);
  const { logs, result } = await captureOutput(() =>
    setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "es" }, {
      resolveFileConfigPath: () => badFile,
    })
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.outcomes.map((o) => o.status), ["failed"]);
  const text = logs.join("\n");
  assert.ok(text.includes("JSON no válido"), `failure guidance in Spanish: ${text}`);
  assert.ok(text.includes(badFile), "exact path preserved");
  assert.equal(readFileSync(badFile, "utf8"), original, "failed write leaves bytes identical");
  assert.equal(result.outcomes[0].note, "helper reported failure; nothing was changed");
});

test("CLI failure prints a localized manual fallback with the exact command", async () => {
  const expected = clientConfig.formatPreviewCommand("claude", clientConfig.buildClaudeCodeArgs(ENV));
  const es = await captureOutput(() =>
    setup.applyTargets(["code"], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "es" }, {
      runner: () => ({ status: 1 }),
    })
  );
  assert.equal(es.result.ok, false);
  assert.deepEqual(es.result.outcomes.map((o) => o.status), ["failed"]);
  const esText = es.logs.join("\n");
  assert.ok(esText.includes("Alternativa para copiar y pegar"), `fallback heading in Spanish: ${esText}`);
  assert.ok(esText.includes(`Comando manual: ${expected}`), "exact command preserved");
  assert.ok(printedJson(es.logs).mcpServers.gsc, "generic JSON fallback printed");

  const en = await captureOutput(() =>
    setup.applyTargets(["code"], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "en" }, {
      runner: () => ({ status: 1 }),
    })
  );
  const enText = en.logs.join("\n");
  assert.ok(enText.includes("Copy-paste fallback (generic JSON, no write performed):"));
  assert.ok(enText.includes(`Manual command: ${expected}`));
  assert.equal(es.result.outcomes[0].note, en.result.outcomes[0].note);
});

// --- T03 follow-up: mergeGscEntry validation failures in Spanish ---
// The canonical thrown messages stay English; the optional ClientConfigText
// seam maps those exact known errors at the helper rendering boundary.
// (End-to-end forwarding through setup's clientConfigTextForLocale is a
// two-line follow-up in src/setup.ts, outside this task's edit surfaces:
// these tests drive the helper directly with catalog-built Spanish text.)

function esClientText() {
  const t = (key) => setupI18n.translateSetup("es", key);
  return {
    configFile: t("fileConfigFile"),
    previewExisting: t("filePreviewExisting"),
    previewNew: t("filePreviewNew"),
    noExistingEntry: t("fileNoExisting"),
    unreadableEntry: t("fileUnreadable"),
    dryRunNote: t("fileDryRun"),
    confirmOverwrite: t("fileConfirmOverwrite"),
    confirmNew: t("fileConfirmNew"),
    skipped: t("fileSkipped"),
    backup: t("fileBackup"),
    couldNotRead: t("fileCouldNotRead"),
    invalidJson: t("fileInvalidJson"),
    backupFailed: t("fileBackupFailed"),
    mkdirFailed: t("fileMkdirFailed"),
    stageFailedExisting: t("fileStageFailedExisting"),
    stageFailedNew: t("fileStageFailedNew"),
    replaceFailedExisting: t("fileReplaceFailedExisting"),
    replaceFailedNew: t("fileReplaceFailedNew"),
    mergeInvalidRoot: t("fileMergeInvalidRoot"),
    mergeInvalidServers: t("fileMergeInvalidServers"),
    configured: t("fileConfigured"),
    cliDryRunPreview: t("cliDryRunPreview"),
    cliDryRunNote: t("cliDryRunNote"),
    cliConfirm: t("cliConfirm"),
    cliSkipped: t("cliSkipped"),
    cliLaunchFailed: t("cliLaunchFailed"),
    cliNotFound: t("cliNotFound"),
    cliAddFailed: t("cliAddFailed"),
    cliConfigured: t("cliConfigured"),
  };
}

test("Spanish merge failure on a non-object root keeps bytes identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "mcp.json");
  const original = JSON.stringify([1, 2]);
  writeFileSync(configPath, original);
  const logs = [];
  const ok = await clientConfig.applyFileConfig({
    configPath,
    entry: clientConfig.buildSetupEntry(ENV),
    force: true,
    yes: true,
    dryRun: false,
    confirm: async () => {
      throw new Error("must not confirm on force");
    },
    log: (m) => logs.push(m),
    text: esClientText(),
  });
  assert.equal(ok, false);
  const text = logs.join("\n");
  assert.ok(text.includes("no es un objeto JSON"), `Spanish merge guidance: ${text}`);
  assert.ok(text.includes("No se cambió nada"));
  assert.ok(!text.includes("is not a JSON object"), "English canonical must not leak into the Spanish run");
  assert.equal(readFileSync(configPath, "utf8"), original, "failed merge leaves bytes identical");
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes(".backup-")),
    [],
    "failed merge creates no backup"
  );
});

test("Spanish merge failure on a non-object mcpServers key preserves the exact key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "mcp.json");
  const original = JSON.stringify({ mcpServers: ["not", "an", "object"], top: 1 });
  writeFileSync(configPath, original);
  const logs = [];
  const ok = await clientConfig.applyFileConfig({
    configPath,
    entry: clientConfig.buildSetupEntry(ENV),
    force: true,
    yes: true,
    dryRun: false,
    confirm: async () => {
      throw new Error("must not confirm on force");
    },
    log: (m) => logs.push(m),
    text: esClientText(),
  });
  assert.equal(ok, false);
  const text = logs.join("\n");
  assert.ok(text.includes('"mcpServers"'), `exact key preserved: ${text}`);
  assert.ok(text.includes("que no es un objeto"), `Spanish merge guidance: ${text}`);
  assert.ok(!text.includes('non-object "mcpServers" key'), "English canonical must not leak into the Spanish run");
  assert.equal(readFileSync(configPath, "utf8"), original, "failed merge leaves bytes identical");
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes(".backup-")),
    [],
    "failed merge creates no backup"
  );
});

test("merge validation failures stay English-canonical for existing callers", async () => {
  const entry = clientConfig.buildSetupEntry(ENV);
  assert.equal(clientConfig.MERGE_INVALID_ROOT_ERROR, "Existing MCP config is not a JSON object; fix it first. Nothing was changed.");
  assert.equal(
    clientConfig.MERGE_INVALID_SERVERS_ERROR,
    'Existing MCP config has a non-object "mcpServers" key; fix it first. Nothing was changed.'
  );
  assert.throws(() => clientConfig.mergeGscEntry([1, 2], "gsc", entry), (err) => {
    assert.equal(err.message, clientConfig.MERGE_INVALID_ROOT_ERROR);
    return true;
  });
  assert.throws(() => clientConfig.mergeGscEntry({ mcpServers: 42 }, "gsc", entry), (err) => {
    assert.equal(err.message, clientConfig.MERGE_INVALID_SERVERS_ERROR);
    return true;
  });
  // Default-text helper renders the exact historical bytes.
  const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
  const configPath = join(dir, "mcp.json");
  writeFileSync(configPath, JSON.stringify([1, 2]));
  const logs = [];
  const ok = await clientConfig.applyFileConfig({
    configPath,
    entry,
    force: true,
    yes: true,
    dryRun: false,
    confirm: async () => "y",
    log: (m) => logs.push(m),
  });
  assert.equal(ok, false);
  assert.ok(
    logs.some((l) => l === clientConfig.MERGE_INVALID_ROOT_ERROR),
    `byte-identical English line in: ${logs.join("\n")}`
  );
});

test("merge error mapping is exact-match and never echoes unknown text", () => {
  const es = esClientText();
  assert.equal(
    clientConfig.localizeMergeErrorMessage(clientConfig.MERGE_INVALID_ROOT_ERROR, es),
    "La configuración MCP existente no es un objeto JSON; corríjala primero. No se cambió nada."
  );
  const serversMapped = clientConfig.localizeMergeErrorMessage(clientConfig.MERGE_INVALID_SERVERS_ERROR, es);
  assert.ok(serversMapped.includes('"mcpServers"'), "exact key preserved in the mapping");
  assert.ok(serversMapped.includes("que no es un objeto"));
  // Forged text (exact canonical plus a secret suffix) never maps and is
  // never echoed: unknown errors stay fail-closed.
  const forged = `${clientConfig.MERGE_INVALID_ROOT_ERROR} SECRET=SENTINEL_T03_FORGED_9d4c`;
  assert.equal(clientConfig.localizeMergeErrorMessage(forged, es), null);
  assert.equal(clientConfig.localizeMergeErrorMessage("", es), null);
  assert.equal(clientConfig.localizeMergeErrorMessage("boom", es), null);
  // English default renders verbatim for existing callers.
  assert.equal(
    clientConfig.localizeMergeErrorMessage(clientConfig.MERGE_INVALID_ROOT_ERROR),
    clientConfig.MERGE_INVALID_ROOT_ERROR
  );
  assert.equal(clientConfig.localizeMergeErrorMessage(forged), null);
});

// --- T03 follow-up: remaining helper failure templates in Spanish ---
// Read/backup/mkdir go end-to-end through setup.applyTargets (locale es);
// stage/replace use the injected-hook seam directly with catalog-built
// Spanish text; CLI failures use the injected runner end-to-end.

test("injected backup failure preserves config and redacts output on every platform", async () => {
  const secret = "SENTINEL_BACKUP_SECRET";
  const internal = "SENTINEL_BACKUP_ERROR";
  for (const [text, expected, otherLanguage] of [
    [undefined, "Could not create a backup", "No se pudo crear una copia de seguridad"],
    [esClientText(), "No se pudo crear una copia de seguridad", "Could not create a backup"],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), "gsc-backup-failure-"));
    const configPath = join(dir, "mcp.json");
    const original = Buffer.from(JSON.stringify({
      mcpServers: {
        gsc: { command: "old", env: { GSC_OAUTH_CLIENT_SECRET: secret } },
        unrelated: { command: "keep-this-server" },
      },
    }, null, 2) + "\n");
    writeFileSync(configPath, original);
    const logs = [];
    const backups = [];
    let stages = 0;
    let commits = 0;
    try {
      const ok = await clientConfig.applyFileConfig({
        configPath,
        entry: clientConfig.buildSetupEntry(ENV),
        force: true,
        yes: true,
        dryRun: false,
        confirm: async () => { throw new Error("unexpected confirmation"); },
        log: message => logs.push(message),
        text,
        hooks: {
          createBackup: (source, destination) => {
            backups.push({ source, destination });
            throw Object.assign(new Error(`${internal}: ${secret}`), { code: "EACCES" });
          },
          stageTemp: () => { stages++; },
          commitTemp: () => { commits++; },
        },
      });
      assert.equal(ok, false);
      assert.equal(backups.length, 1, "backup must be attempted exactly once");
      assert.equal(backups[0].source, configPath);
      assert.ok(backups[0].destination.startsWith(configPath + ".backup-"));
      assert.equal(stages, 0, "do not stage changes after backup failure");
      assert.equal(commits, 0, "do not replace config after backup failure");
      assert.deepEqual(readFileSync(configPath), original, "preserve all original bytes");
      assert.deepEqual(readdirSync(dir), ["mcp.json"], "create no backup or temp files");
      const output = logs.join("\n");
      assert.ok(output.includes(expected));
      assert.ok(output.includes(configPath));
      assert.ok(!output.includes(otherLanguage));
      assert.ok(output.includes("[redacted]"));
      assert.ok(output.includes("GSC_OAUTH_CLIENT_SECRET"));
      assert.ok(!output.includes(secret), "never print existing secrets");
      assert.ok(!output.includes(internal), "never print injected error details");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// Keep the real permission test as additional POSIX coverage. The injected
// backup-failure test above also runs on Windows and under root.
test("Spanish file failure templates keep exact paths and leak nothing", async (t) => {
  const secret = "SENTINEL_T03_FILE_5e8f";
  const withSecret = () =>
    JSON.stringify({
      mcpServers: { gsc: { command: "old", args: [], env: { GSC_OAUTH_CLIENT_SECRET: secret } } },
    });
  const skipPerm =
    process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0)
      ? "POSIX permission gate only"
      : false;
  const cases = [
    {
      id: "unreadable path renders couldNotRead",
      kind: "dir-as-file",
      es: ["No se pudo leer", "No se cambió nada"],
      enAbsent: ["Could not read"],
      skip: false,
    },
    {
      id: "backup failure renders backupFailed",
      kind: "existing-locked-dir",
      es: ["No se pudo crear una copia de seguridad", "No se cambió nada"],
      enAbsent: ["Could not create a backup"],
      skip: skipPerm,
    },
    {
      id: "mkdir failure renders mkdirFailed",
      kind: "file-as-parent",
      es: ["No se pudo crear la carpeta de configuración", "No se escribió ningún archivo de configuración"],
      enAbsent: ["Could not create the config folder"],
      skip: false,
    },
  ];
  for (const c of cases) {
    await t.test(c.id, { skip: c.skip }, async () => {
      const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
      let configPath;
      let original = null;
      if (c.kind === "dir-as-file") {
        configPath = dir;
      } else if (c.kind === "existing-locked-dir") {
        configPath = join(dir, "mcp.json");
        original = withSecret();
        writeFileSync(configPath, original);
        chmodSync(dir, 0o555);
      } else {
        const parentFile = join(dir, "parent");
        writeFileSync(parentFile, "blocking file");
        configPath = join(parentFile, "mcp.json");
        original = "blocking file";
      }
      let captured;
      try {
        captured = await captureOutput(() =>
          setup.applyTargets(["desktop"], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "es" }, {
            resolveFileConfigPath: () => configPath,
          })
        );
      } finally {
        if (c.kind === "existing-locked-dir") chmodSync(dir, 0o755);
      }
      assert.equal(captured.result.ok, false);
      assert.deepEqual(captured.result.outcomes.map((o) => o.status), ["failed"]);
      assert.equal(captured.result.outcomes[0].note, "helper reported failure; nothing was changed");
      const text = captured.logs.join("\n");
      for (const snippet of c.es) assert.ok(text.includes(snippet), `missing ${snippet} in: ${text}`);
      assert.ok(text.includes(configPath), "exact path preserved");
      for (const english of c.enAbsent) assert.ok(!text.includes(english), `English leak: ${english}`);
      assert.ok(!text.includes(secret), "existing secret leaked into failure output");
      if (c.kind === "existing-locked-dir") {
        assert.ok(text.includes("[redacted]"), "redaction marker preserved");
        assert.ok(text.includes("GSC_OAUTH_CLIENT_SECRET"), "key names survive redaction");
        assert.equal(readFileSync(configPath, "utf8"), original, "failed write leaves bytes identical");
        assert.deepEqual(
          readdirSync(dir).filter((f) => f.includes(".backup-")),
          [],
          "failed backup creates no backup file"
        );
      } else if (c.kind === "dir-as-file") {
        assert.deepEqual(readdirSync(dir), [], "failed read creates nothing");
      } else if (c.kind === "file-as-parent") {
        assert.equal(existsSync(configPath), false, "failed mkdir writes no config");
        assert.equal(readFileSync(dirname(configPath), "utf8"), "blocking file", "blocking parent file untouched");
      }
    });
  }
});

test("Spanish stage/replace failures keep exact dirs, backups, and commands", async (t) => {
  const secret = "SENTINEL_T03_STAGE_7a1d";
  const withSecret = () =>
    JSON.stringify({
      mcpServers: { gsc: { command: "old", args: [], env: { GSC_OAUTH_CLIENT_SECRET: secret } } },
    });
  const boom = () => {
    throw new Error("injected failure");
  };
  const cases = [
    {
      id: "stage failure on existing config renders stageFailedExisting",
      kind: "existing",
      hooks: { stageTemp: boom },
      es: ["No se pudo preparar la configuración actualizada", "no se modificó", "se conservó una copia de seguridad"],
      enAbsent: ["Could not stage the updated config", "left untouched", "Nothing was changed"],
      forbidChangedClaim: true,
    },
    {
      id: "stage failure on a new config renders stageFailedNew",
      kind: "missing",
      hooks: { stageTemp: boom },
      es: ["No se pudo preparar la nueva configuración", "No se escribió ningún archivo de configuración"],
      enAbsent: ["Could not stage the new config"],
      forbidChangedClaim: false,
    },
    {
      id: "replace failure on existing config renders replaceFailedExisting",
      kind: "existing",
      hooks: { commitTemp: boom },
      es: ["No se pudo reemplazar", "Se conservó una copia de seguridad", "compruebe el archivo de configuración"],
      enAbsent: ["Could not replace", "A backup was kept", "Nothing was changed"],
      forbidChangedClaim: true,
    },
    {
      id: "replace failure on a new config renders replaceFailedNew",
      kind: "missing",
      hooks: { commitTemp: boom },
      es: ["No se pudo escribir", "No se confirmó ninguna entrada", "compruebe la carpeta"],
      enAbsent: ["Could not write", "No config entry was committed"],
      forbidChangedClaim: false,
    },
  ];
  for (const c of cases) {
    await t.test(c.id, async () => {
      const dir = mkdtempSync(join(tmpdir(), "gsc-t03-"));
      const configPath = c.kind === "existing" ? join(dir, "mcp.json") : join(dir, "sub", "mcp.json");
      const original = c.kind === "existing" ? withSecret() : null;
      if (original !== null) writeFileSync(configPath, original);
      const logs = [];
      const ok = await clientConfig.applyFileConfig({
        configPath,
        entry: clientConfig.buildSetupEntry(ENV),
        force: true,
        yes: true,
        dryRun: false,
        confirm: async () => {
          throw new Error("must not confirm on force");
        },
        log: (m) => logs.push(m),
        text: esClientText(),
        hooks: c.hooks,
      });
      assert.equal(ok, false);
      const text = logs.join("\n");
      for (const snippet of c.es) assert.ok(text.includes(snippet), `missing ${snippet} in: ${text}`);
      for (const english of c.enAbsent) assert.ok(!text.includes(english), `English leak: ${english}`);
      assert.ok(!text.includes(secret), "existing secret leaked into failure output");
      assert.ok(!text.includes("injected failure"), "hook internals leaked into output");
      if (c.kind === "existing") {
        assert.ok(text.includes(dirname(configPath)) || text.includes(configPath), "exact dir/path preserved");
        const backupLine = logs.find((l) => l.startsWith("Copia de seguridad: "));
        assert.ok(backupLine, `backup notice printed in: ${text}`);
        const backup = backupLine.slice("Copia de seguridad: ".length).trim();
        assert.ok(text.includes(backup), "exact backup path preserved in the failure line");
        assert.equal(readFileSync(backup, "utf8"), original, "backup keeps the original bytes");
        assert.equal(readFileSync(configPath, "utf8"), original, "failed write leaves bytes identical");
        assert.ok(text.includes("GSC_OAUTH_CLIENT_SECRET"), "key names survive redaction");
        if (c.forbidChangedClaim) assert.ok(!text.includes("No se cambió nada"), "must not claim nothing changed after a mutation");
      } else {
        assert.ok(text.includes(dirname(configPath)) || text.includes(configPath), "exact dir/path preserved");
        assert.equal(existsSync(configPath), false, "failed write creates no config");
        assert.deepEqual(
          readdirSync(dir, { recursive: true }).filter((f) => String(f).includes(".backup-")),
          [],
          "failed write on a new config creates no backup"
        );
        assert.deepEqual(
          readdirSync(dir, { recursive: true }).filter((f) => String(f).includes(".tmp-")),
          [],
          "failed write leaves no temp files"
        );
      }
    });
  }
});

test("Spanish CLI failures keep exact commands and leak nothing", async (t) => {
  const cases = [
    {
      id: "launch throw renders cliLaunchFailed",
      target: "code",
      program: "claude",
      buildArgs: (env) => clientConfig.buildClaudeCodeArgs(env),
      runner: () => {
        throw new Error("spawn boom T03");
      },
      es: ["No se pudo iniciar claude", "Alternativa para copiar y pegar", "Comando manual:"],
      enAbsent: ["Could not launch"],
      absent: ["spawn boom T03"],
    },
    {
      id: "ENOENT renders cliNotFound",
      target: "codex",
      program: "codex",
      buildArgs: (env) => clientConfig.buildCodexArgs(env),
      runner: () => ({ status: null, error: Object.assign(new Error("missing"), { code: "ENOENT" }) }),
      es: ["No se encontró la CLI codex en PATH"],
      enAbsent: ["was not found on PATH"],
      absent: [],
    },
    {
      id: "nonzero exit renders cliAddFailed with exact steps",
      target: "code",
      program: "claude",
      buildArgs: (env) => clientConfig.buildClaudeCodeArgs(env),
      removeArgs: () => clientConfig.claudeCodeRemoveArgs(),
      runner: () => ({ status: 1 }),
      es: ["no se completó", "No se eliminó nada automáticamente"],
      enAbsent: ["did not succeed", "Nothing was removed automatically"],
      absent: [],
    },
  ];
  for (const c of cases) {
    await t.test(c.id, async () => {
      const expected = clientConfig.formatPreviewCommand(c.program, c.buildArgs(ENV));
      const { logs, result } = await captureOutput(() =>
        setup.applyTargets([c.target], ENV, stubPrompter(), { force: false, yes: true, dryRun: false, locale: "es" }, {
          runner: c.runner,
        })
      );
      assert.equal(result.ok, false);
      assert.deepEqual(result.outcomes.map((o) => o.status), ["failed"]);
      assert.equal(result.outcomes[0].note, "CLI invocation failed; manual fallback printed, no write performed");
      const text = logs.join("\n");
      for (const snippet of c.es) assert.ok(text.includes(snippet), `missing ${snippet} in: ${text}`);
      assert.ok(text.includes(`Comando manual: ${expected}`), "exact command preserved");
      for (const english of c.enAbsent) assert.ok(!text.includes(english), `English leak: ${english}`);
      for (const leaked of c.absent) assert.ok(!text.includes(leaked), `runner internals leaked: ${leaked}`);
      if (c.removeArgs) {
        const removePreview = clientConfig.formatPreviewCommand(c.program, c.removeArgs());
        assert.ok(text.includes(`  ${removePreview}`), "exact remove step preserved");
        assert.ok(text.includes(`  ${expected}`), "exact add step preserved");
      }
      assert.deepEqual(printedJson(logs).mcpServers.gsc.env, ENV, "generic JSON fallback stays exact");
    });
  }
});
