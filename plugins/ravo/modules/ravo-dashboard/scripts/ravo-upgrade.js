#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  ConfigError,
  atomicWriteBuffer,
  atomicWriteJson,
  configPaths,
  semanticFingerprint,
  withMutationLock
} = require("./ravo-config");

const PRODUCT_VERSION = "0.6.2";

const REQUIRED_PLUGINS = Object.freeze(["ravo"]);
const JOURNAL_STATUSES = new Set(["planned", "backed_up", "installing", "verifying", "succeeded", "partial", "failed", "recovered", "indeterminate"]);
const PRIVATE_DIR_MODE = 0o700;
const SECRET_MODE = 0o600;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sha(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function treeFingerprint(root) {
  if (!root) return "";
  const entries = [];
  const visit = (file, relative) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      entries.push({ path: relative, type: "symlink", target: fs.readlinkSync(file) });
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), relative ? path.join(relative, name) : name);
      return;
    }
    if (stat.isFile()) entries.push({ path: relative, type: "file", size: stat.size, sha256: sha(fs.readFileSync(file)) });
  };
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return "";
    visit(root, "");
    return sha(JSON.stringify(entries));
  } catch (_error) {
    return "";
  }
}

function executeCodex(args, options = {}) {
  if (options.execute) return options.execute(args.slice());
  const output = execFileSync("codex", args, {
    encoding: "utf8",
    env: options.env || process.env,
    timeout: options.commandTimeoutMs || 120000
  });
  return output.trim() ? JSON.parse(output) : {};
}

function marketplaceRecord(result) {
  return (result?.marketplaces || []).find((entry) => entry.name === "ravo") || null;
}

function installedRecords(result) {
  return Array.isArray(result?.installed) ? result.installed : [];
}

function sourceManifest(root, plugin) {
  const file = path.join(root, "plugins", plugin, ".codex-plugin", "plugin.json");
  const manifest = readJson(file);
  return { file, manifest };
}

function installedCache(home, plugin) {
  const root = path.join(home, ".codex", "plugins", "cache", "ravo", plugin);
  let versions = [];
  try { versions = fs.readdirSync(root); } catch (_error) { return null; }
  return versions.map((version) => {
    const file = path.join(root, version, ".codex-plugin", "plugin.json");
    return { version, root: path.join(root, version), file, manifest: readJson(file) };
  }).filter((entry) => entry.manifest)
    .sort((left, right) => String(right.manifest.version || right.version).localeCompare(String(left.manifest.version || left.version)))[0] || null;
}

function sourceType(record) {
  return record?.marketplaceSource?.sourceType || (record?.root ? "local" : "unknown");
}

function checkUpdates(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  let marketplaceResult;
  let pluginResult;
  try {
    marketplaceResult = executeCodex(["plugin", "marketplace", "list", "--json"], options);
  } catch (error) {
    return { status: "error", marketplaceStatus: "error", errorCode: "marketplace_command_failed", message: error.message, requiredPlugins: REQUIRED_PLUGINS.slice(), checkedAt: new Date().toISOString() };
  }
  let marketplace = marketplaceRecord(marketplaceResult);
  if (!marketplace) return { status: "missing", marketplaceStatus: "missing", requiredPlugins: REQUIRED_PLUGINS.slice(), checkedAt: new Date().toISOString(), recoverySteps: ["Add the ravo marketplace before checking updates."] };
  const type = sourceType(marketplace);
  if (options.refresh === true && type === "git") {
    executeCodex(["plugin", "marketplace", "upgrade", "ravo"], options);
    marketplaceResult = executeCodex(["plugin", "marketplace", "list", "--json"], options);
    marketplace = marketplaceRecord(marketplaceResult) || marketplace;
  }
  try {
    pluginResult = executeCodex(["plugin", "list", "--marketplace", "ravo", "--json"], options);
  } catch (error) {
    return { status: "error", marketplaceStatus: "present", sourceType: type, errorCode: "plugin_list_failed", message: error.message, requiredPlugins: REQUIRED_PLUGINS.slice(), checkedAt: new Date().toISOString() };
  }
  const root = marketplace.root || marketplace.marketplaceSource?.source || "";
  const installed = installedRecords(pluginResult);
  const plugins = REQUIRED_PLUGINS.map((plugin) => {
    const source = sourceManifest(root, plugin);
    const installedRecord = installed.find((entry) => entry.name === plugin || entry.pluginId === `${plugin}@ravo`) || null;
    const cache = installedCache(home, plugin);
    const sourceContentFingerprint = treeFingerprint(path.join(root, "plugins", plugin));
    const cacheContentFingerprint = treeFingerprint(cache?.root || "");
    const sourceVersion = source.manifest?.version || "";
    const installedVersion = installedRecord?.version || "";
    const cacheVersion = cache?.manifest?.version || cache?.version || "";
    const present = Boolean(installedRecord?.installed);
    const enabled = Boolean(installedRecord?.enabled);
    const aligned = Boolean(
      sourceVersion
      && present
      && enabled
      && installedVersion === sourceVersion
      && cacheVersion === sourceVersion
      && sourceContentFingerprint
      && cacheContentFingerprint === sourceContentFingerprint
    );
    const driftReason = !source.manifest ? "source_missing"
      : !present ? "not_installed"
        : !enabled ? "disabled"
          : installedVersion !== sourceVersion ? "installed_version_mismatch"
            : cacheVersion !== sourceVersion ? "cache_version_mismatch"
              : !cacheContentFingerprint ? "cache_content_missing"
                : cacheContentFingerprint !== sourceContentFingerprint ? "cache_content_mismatch"
                  : "";
    return {
      pluginId: plugin,
      sourcePresent: Boolean(source.manifest),
      sourceVersion,
      installed: present,
      enabled,
      installedVersion,
      cacheVersion,
      sourceContentFingerprint,
      cacheContentFingerprint,
      aligned,
      driftReason,
      status: !source.manifest ? "source_missing" : !present ? "missing" : !enabled ? "disabled" : aligned ? "aligned" : "drift"
    };
  });
  const sourceVersions = [...new Set(plugins.map((plugin) => plugin.sourceVersion).filter(Boolean))];
  const installedVersions = [...new Set(plugins.map((plugin) => plugin.installedVersion).filter(Boolean))];
  const sourceFingerprint = sha(JSON.stringify({
    marketplace: { sourceType: type, source: marketplace.marketplaceSource?.source || root },
    plugins: plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      sourceVersion: plugin.sourceVersion,
      sourceContentFingerprint: plugin.sourceContentFingerprint
    }))
  }));
  const runtimeFingerprintInput = {
    marketplace: { sourceType: type, source: marketplace.marketplaceSource?.source || root },
    plugins: plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      enabled: plugin.enabled,
      installedVersion: plugin.installedVersion,
      cacheVersion: plugin.cacheVersion,
      sourceVersion: plugin.sourceVersion,
      sourceContentFingerprint: plugin.sourceContentFingerprint,
      cacheContentFingerprint: plugin.cacheContentFingerprint
    }))
  };
  const drift = plugins.some((plugin) => !plugin.aligned);
  return {
    status: plugins.some((plugin) => !plugin.sourcePresent) ? "error" : drift ? "update_or_repair_available" : "current",
    marketplaceStatus: "present",
    sourceType: type,
    sourceFingerprint,
    runtimeFingerprint: sha(JSON.stringify(runtimeFingerprintInput)),
    currentVersion: installedVersions.length === 1 ? installedVersions[0] : installedVersions.length ? "mixed" : "missing",
    availableVersion: sourceVersions.length === 1 ? sourceVersions[0] : sourceVersions.length ? "mixed" : "unknown",
    requiredPlugins: REQUIRED_PLUGINS.slice(),
    plugins,
    drift,
    freshSessionRequired: drift,
    checkedAt: new Date().toISOString(),
    recoverySteps: drift ? ["Create an upgrade plan, confirm it, replace the unified RAVO plugin, then verify it in a fresh Codex task."] : []
  };
}

function createUpgradePlan(check) {
  if (!check || check.marketplaceStatus !== "present" || check.status === "error") throw new ConfigError("upgrade_check_invalid", "A healthy RAVO update check is required before planning.", 409);
  if (check.availableVersion === "mixed" || check.availableVersion === "unknown") throw new ConfigError("source_version_mixed", "Required plugin source versions are missing or mixed.", 409);
  return {
    schemaVersion: "0.5.0",
    planId: `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(5).toString("hex")}`,
    marketplace: "ravo",
    sourceType: check.sourceType,
    sourceFingerprint: check.sourceFingerprint,
    targetVersion: check.availableVersion,
    requiredPlugins: REQUIRED_PLUGINS.slice(),
    pluginActions: check.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      fromVersion: plugin.installedVersion || "missing",
      toVersion: plugin.sourceVersion,
      action: !plugin.installed ? "install" : plugin.aligned ? "verify" : "replace",
      driftReason: plugin.driftReason || ""
    })),
    freshSessionRequired: true,
    createdAt: new Date().toISOString()
  };
}

function snapshotCandidates(home, workspaces = []) {
  const paths = configPaths({ home });
  const entries = [
    { id: "user-ravo", originalPath: paths.userRavo },
    { id: "review", originalPath: paths.review }
  ];
  for (const workspace of workspaces) {
    let canonical;
    try { canonical = fs.realpathSync(path.resolve(workspace)); } catch (_error) { continue; }
    entries.push({ id: `workspace-${sha(canonical).slice(7, 19)}`, originalPath: path.join(canonical, "knowledge", ".ravo", "config.json"), workspace: canonical });
  }
  return entries;
}

function snapshotConfigs(home, workspaces, planId) {
  const root = path.join(home, ".codex", "ravo", "backups", planId);
  fs.mkdirSync(root, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.chmodSync(root, PRIVATE_DIR_MODE);
  const files = [];
  for (const candidate of snapshotCandidates(home, workspaces)) {
    if (!fs.existsSync(candidate.originalPath)) {
      files.push({ ...candidate, existed: false, backupName: "", status: "created" });
      continue;
    }
    let bytes;
    let value;
    try {
      bytes = fs.readFileSync(candidate.originalPath);
      value = JSON.parse(bytes.toString("utf8"));
    } catch (_error) {
      throw new ConfigError("upgrade_config_unreadable", `Config cannot be read and backed up: ${candidate.id}`, 409);
    }
    const backupName = `${candidate.id}.json`;
    const backupPath = path.join(root, backupName);
    fs.writeFileSync(backupPath, bytes, { mode: SECRET_MODE });
    fs.chmodSync(backupPath, SECRET_MODE);
    const readBack = fs.readFileSync(backupPath);
    if (readBack.length !== bytes.length || sha(readBack) !== sha(bytes)) throw new ConfigError("upgrade_backup_mismatch", `Config backup verification failed: ${candidate.id}`, 500);
    files.push({
      ...candidate,
      existed: true,
      backupName,
      size: bytes.length,
      hash: sha(bytes),
      semanticFingerprint: semanticFingerprint(value),
      mode: fs.statSync(candidate.originalPath).mode & 0o777,
      status: "match"
    });
  }
  const metadata = { schemaVersion: "0.5.0", snapshotId: planId, files, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: SECRET_MODE });
  fs.chmodSync(path.join(root, "metadata.json"), SECRET_MODE);
  return { root, metadata };
}

function journalRoot(home) {
  return path.join(home, ".codex", "ravo", "upgrades");
}

function journalPath(home, id) {
  return path.join(journalRoot(home), `${id}.json`);
}

function writeJournal(home, journal) {
  if (!JOURNAL_STATUSES.has(journal.status)) throw new ConfigError("invalid_journal_status", `Unsupported upgrade journal status: ${journal.status}`, 500);
  fs.mkdirSync(journalRoot(home), { recursive: true, mode: PRIVATE_DIR_MODE });
  atomicWriteJson(journalPath(home, journal.journalId), { ...journal, updatedAt: new Date().toISOString() });
}

function diskPreflight(home) {
  try {
    const stats = fs.statfsSync(home);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (freeBytes < 10 * 1024 * 1024) throw new ConfigError("insufficient_disk", "At least 10 MiB free space is required for RAVO upgrade backup and journal.", 409);
    return { freeBytesAtLeast10MiB: true };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    return { freeBytesAtLeast10MiB: "unknown" };
  }
}

function configIntegrity(snapshot) {
  return snapshot.metadata.files.map((entry) => {
    if (!entry.existed) return { id: entry.id, status: fs.existsSync(entry.originalPath) ? "unexpected_created" : "match" };
    if (!fs.existsSync(entry.originalPath)) return { id: entry.id, status: "missing" };
    const bytes = fs.readFileSync(entry.originalPath);
    return { id: entry.id, status: bytes.length === entry.size && sha(bytes) === entry.hash ? "match" : "changed" };
  });
}

function restoreSnapshot(snapshot) {
  const restored = [];
  for (const entry of snapshot.metadata.files) {
    if (!entry.existed) {
      if (fs.existsSync(entry.originalPath)) fs.unlinkSync(entry.originalPath);
      restored.push({ id: entry.id, status: "removed_unexpected_file" });
      continue;
    }
    const backupPath = path.join(snapshot.root, entry.backupName);
    const bytes = fs.readFileSync(backupPath);
    if (bytes.length !== entry.size || sha(bytes) !== entry.hash) throw new ConfigError("upgrade_backup_integrity_failed", `Backup integrity failed during recovery: ${entry.id}`, 409);
    const previousStat = fs.existsSync(entry.originalPath) ? fs.statSync(entry.originalPath) : null;
    atomicWriteBuffer(entry.originalPath, bytes, previousStat);
    restored.push({ id: entry.id, status: "restored" });
  }
  return restored;
}

function refreshSoloDeskController(home, options = {}) {
  if (typeof options.installController === "function") return options.installController({ home });
  const { install } = require("./ravo-solodesk");
  return install({
    home,
    executeCodex: options.execute,
    codexPath: options.codexPath,
    nodePath: options.nodePath
  });
}

function applyUpgrade(plan, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  if (!plan || plan.marketplace !== "ravo" || JSON.stringify(plan.requiredPlugins) !== JSON.stringify(REQUIRED_PLUGINS)) {
    throw new ConfigError("invalid_upgrade_plan", "Upgrade plan must target the fixed RAVO required plugin set.", 409);
  }
  return withMutationLock({ home }, () => {
    const currentCheck = checkUpdates({ ...options, home, refresh: false });
    if (currentCheck.sourceFingerprint !== plan.sourceFingerprint || currentCheck.availableVersion !== plan.targetVersion) {
      throw new ConfigError("stale_upgrade_plan", "Marketplace source changed after preview; create a new upgrade plan.", 409);
    }
    const plannedActions = new Map((plan.pluginActions || []).map((entry) => [entry.pluginId, entry.action]));
    for (const plugin of currentCheck.plugins || []) {
      const expectedAction = !plugin.installed ? "install" : plugin.aligned ? "verify" : "replace";
      if (plannedActions.get(plugin.pluginId) !== expectedAction) {
        throw new ConfigError("stale_upgrade_plan", "Installed plugin state changed after preview; create a new upgrade plan.", 409);
      }
    }
    const preflight = {
      disk: diskPreflight(home),
      marketplaceStatus: currentCheck.marketplaceStatus,
      sourceVersion: currentCheck.availableVersion,
      configReadable: true
    };
    const journal = {
      schemaVersion: "0.5.0",
      journalId: plan.planId,
      plan: clone(plan),
      status: "planned",
      preflight,
      snapshot: null,
      pluginResults: [],
      migrations: [],
      controllerRefresh: { status: "pending" },
      verification: null,
      recovery: null,
      freshSessionRequired: true,
      createdAt: new Date().toISOString()
    };
    writeJournal(home, journal);
    let snapshot;
    try {
      snapshot = snapshotConfigs(home, options.workspaces || [], plan.planId);
      journal.snapshot = { root: snapshot.root, files: snapshot.metadata.files.map((entry) => ({ id: entry.id, existed: entry.existed, backupName: entry.backupName, status: entry.status })) };
      journal.status = "backed_up";
      writeJournal(home, journal);
    } catch (error) {
      journal.status = "failed";
      journal.recovery = { reason: error.code || "backup_failed", message: error.message, entry: "Fix config readability/permissions and create a new plan." };
      writeJournal(home, journal);
      return journal;
    }

    journal.status = "installing";
    writeJournal(home, journal);
    for (const plugin of currentCheck.plugins || []) {
      const startedAt = new Date().toISOString();
      const action = !plugin.installed ? "install" : plugin.aligned ? "verify" : "replace";
      if (action === "verify") {
        journal.pluginResults.push({ pluginId: plugin.pluginId, action, status: "verified", startedAt, endedAt: new Date().toISOString() });
        writeJournal(home, journal);
        continue;
      }
      try {
        let removeResult = null;
        if (action === "replace") removeResult = executeCodex(["plugin", "remove", `${plugin.pluginId}@ravo`, "--json"], options);
        const result = executeCodex(["plugin", "add", `${plugin.pluginId}@ravo`, "--json"], options);
        journal.pluginResults.push({
          pluginId: plugin.pluginId,
          action,
          status: "succeeded",
          startedAt,
          endedAt: new Date().toISOString(),
          removeStatus: removeResult?.status || (action === "replace" ? "ok" : "not_required"),
          resultStatus: result?.status || "ok"
        });
      } catch (error) {
        journal.pluginResults.push({ pluginId: plugin.pluginId, action, status: "failed", startedAt, endedAt: new Date().toISOString(), errorCode: error.code || "plugin_replace_failed", message: error.message });
      }
      writeJournal(home, journal);
    }

    try {
      const controller = refreshSoloDeskController(home, options);
      journal.controllerRefresh = {
        status: "succeeded",
        controllerVersion: controller?.plugin?.version || "",
        controllerPath: controller?.paths?.controller || ""
      };
    } catch (error) {
      journal.controllerRefresh = {
        status: "failed",
        errorCode: error.code || "controller_refresh_failed",
        message: error.message,
        recoveryEntry: "Run ravo-solodesk install, then restart SoloDesk."
      };
    }
    writeJournal(home, journal);

    journal.status = "verifying";
    writeJournal(home, journal);
    const verification = checkUpdates({ ...options, home, refresh: false });
    const configChecks = configIntegrity(snapshot);
    journal.verification = {
      updateStatus: verification.status,
      runtimeFingerprint: verification.runtimeFingerprint,
      plugins: verification.plugins,
      configChecks,
      allPluginsAligned: verification.plugins?.every((plugin) => plugin.aligned) || false,
      allConfigsMatch: configChecks.every((entry) => entry.status === "match")
    };
    const configChanged = !journal.verification.allConfigsMatch;
    if (configChanged) {
      try {
        journal.recovery = { reason: "unexpected_config_change", results: restoreSnapshot(snapshot), entry: "Review the recovered config and rerun the upgrade from a new plan." };
      } catch (error) {
        journal.recovery = { reason: "config_recovery_failed", message: error.message, entry: `Use the verified snapshot at ${snapshot.root}.` };
        journal.status = "indeterminate";
        writeJournal(home, journal);
        return journal;
      }
    }
    const completedCount = journal.pluginResults.filter((entry) => ["succeeded", "verified"].includes(entry.status)).length;
    const changedCount = journal.pluginResults.filter((entry) => entry.status === "succeeded").length;
    const allInstalled = journal.pluginResults.length === REQUIRED_PLUGINS.length && completedCount === REQUIRED_PLUGINS.length;
    if (allInstalled && journal.verification.allPluginsAligned && !configChanged && journal.controllerRefresh.status === "succeeded") journal.status = "succeeded";
    else if (configChanged) journal.status = "recovered";
    else if (changedCount > 0 || completedCount > 0) journal.status = "partial";
    else journal.status = "failed";
    if (["partial", "failed"].includes(journal.status)) {
      journal.recovery = journal.recovery || {
        reason: journal.controllerRefresh.status === "failed" ? "controller_refresh_failed" : "plugin_set_incomplete",
        entry: journal.controllerRefresh.recoveryEntry || "Fix the failed plugin result, rerun update check, and create a new plan. Plugin code rollback is not claimed."
      };
    }
    writeJournal(home, journal);
    return journal;
  });
}

function loadSnapshot(home, journal) {
  const root = path.join(home, ".codex", "ravo", "backups", journal.journalId);
  const metadata = readJson(path.join(root, "metadata.json"));
  if (!metadata || metadata.snapshotId !== journal.journalId) throw new ConfigError("snapshot_not_found", "Upgrade config snapshot is missing or invalid.", 404);
  return { root, metadata };
}

function recoverConfig(journalIdValue, options = {}) {
  if (!/^[A-Za-z0-9-]+$/.test(String(journalIdValue || ""))) throw new ConfigError("invalid_journal_id", "Upgrade journal id is invalid.");
  const home = path.resolve(options.home || os.homedir());
  return withMutationLock({ home }, () => {
    const file = journalPath(home, journalIdValue);
    const journal = readJson(file);
    if (!journal) throw new ConfigError("journal_not_found", "Upgrade journal was not found.", 404);
    const snapshot = loadSnapshot(home, journal);
    const allowed = new Set(snapshotCandidates(home, options.workspaces || []).map((entry) => entry.originalPath));
    if (snapshot.metadata.files.some((entry) => !allowed.has(entry.originalPath))) throw new ConfigError("snapshot_scope_mismatch", "Snapshot references a config outside the current fixed/allowlisted targets.", 403);
    const results = restoreSnapshot(snapshot);
    journal.status = "recovered";
    journal.recovery = { reason: "explicit_recover_config", results, entry: "Run update check and a fresh-session Runtime probe before trusting RAVO Runtime." };
    writeJournal(home, journal);
    return journal;
  });
}

function listJournals(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  let files = [];
  try { files = fs.readdirSync(journalRoot(home)).filter((file) => file.endsWith(".json")); } catch (_error) { return []; }
  return files.map((file) => readJson(path.join(journalRoot(home), file))).filter(Boolean)
    .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-upgrade.js --check [--refresh] | --plan | --apply --confirm | --apply-plan-stdin | --recover-config <journal-id>");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const home = os.homedir();
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(checkUpdates({ home, refresh: process.argv.includes("--refresh") }), null, 2));
    return;
  }
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify(createUpgradePlan(checkUpdates({ home, refresh: false })), null, 2));
    return;
  }
  if (process.argv.includes("--apply")) {
    if (!process.argv.includes("--confirm")) throw new ConfigError("confirmation_required", "--apply requires --confirm after reviewing a fresh plan.", 409);
    const plan = createUpgradePlan(checkUpdates({ home, refresh: false }));
    console.log(JSON.stringify(applyUpgrade(plan, { home }), null, 2));
    return;
  }
  if (process.argv.includes("--apply-plan-stdin")) {
    const bytes = fs.readFileSync(0);
    if (bytes.length > 1024 * 1024) throw new ConfigError("upgrade_input_too_large", "Upgrade plan input exceeds 1 MiB.", 413);
    let input;
    try { input = JSON.parse(bytes.toString("utf8")); } catch (_error) {
      throw new ConfigError("upgrade_input_invalid", "Upgrade plan input is not valid JSON.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConfigError("upgrade_input_invalid", "Upgrade plan input must be an object.");
    const workspaces = Array.isArray(input.workspaces) ? input.workspaces : [];
    if (workspaces.length > 100 || workspaces.some((workspace) => typeof workspace !== "string" || !path.isAbsolute(workspace))) {
      throw new ConfigError("upgrade_workspace_invalid", "Upgrade workspaces must be at most 100 canonical absolute paths.");
    }
    console.log(JSON.stringify(applyUpgrade(input.plan, { home, workspaces }), null, 2));
    return;
  }
  const recoverIndex = process.argv.indexOf("--recover-config");
  if (recoverIndex >= 0) {
    console.log(JSON.stringify(recoverConfig(process.argv[recoverIndex + 1], { home }), null, 2));
    return;
  }
  throw new ConfigError("missing_action", "Use --check, --plan, --apply --confirm, or --recover-config.");
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || "upgrade_error", message: error.message })}\n`);
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_PLUGINS,
  applyUpgrade,
  checkUpdates,
  createUpgradePlan,
  listJournals,
  recoverConfig,
  snapshotConfigs,
  treeFingerprint
};
