#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseTomlDocument } = require("./ravo-config-integrity");
const { inspectPluginRoot } = require("./ravo-preflight");
const { restoreLegacy } = require("./ravo-legacy-restore");

const PRODUCT_VERSION = "0.6.3";
const LEGACY_VERSION = "0.5.5";
const LEGACY_PLUGIN_NAMES = [
  "ravo-core",
  "ravo-analysis",
  "ravo-workstream",
  "ravo-quick-validation",
  "ravo-acceptance",
  "ravo-knowledge",
  "ravo-review",
  "ravo-dashboard"
];

function executeCodexCommand(args) {
  const child = spawnSync("codex", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (child.error || child.status !== 0) throw new Error(String(child.stderr || child.error?.message || `codex exited ${child.status}`).trim());
  const output = String(child.stdout || "").trim();
  return output ? JSON.parse(output) : {};
}

function listInstalled(executeCodex) {
  const value = executeCodex(["plugin", "list", "--marketplace", "ravo", "--json"]);
  return Array.isArray(value?.installed) ? value.installed : [];
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function configuredLegacyEntries(home) {
  const configPath = path.join(home, ".codex", "config.toml");
  if (!fs.existsSync(configPath)) return [];
  const document = parseTomlDocument(fs.readFileSync(configPath, "utf8"));
  const sections = new Map(document.sections
    .filter((section) => section.parts.length === 2 && section.parts[0] === "plugins")
    .map((section) => [section.parts[1], section]));
  const entries = [];
  for (const name of LEGACY_PLUGIN_NAMES) {
    const pluginId = `${name}@ravo`;
    const section = sections.get(pluginId);
    if (!section) continue;
    const enabledMatch = section.text.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/mi);
    const enabled = enabledMatch ? enabledMatch[1].toLowerCase() === "true" : true;
    const cacheParent = path.join(home, ".codex", "plugins", "cache", "ravo", name);
    const candidates = fs.existsSync(cacheParent)
      ? fs.readdirSync(cacheParent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const root = path.join(cacheParent, entry.name);
          const manifest = readJson(path.join(root, ".codex-plugin", "plugin.json"));
          return manifest?.name === name && manifest?.version === entry.name
            ? { root, version: entry.name }
            : null;
        })
        .filter(Boolean)
      : [];
    const selected = candidates.length === 1 ? candidates[0] : null;
    entries.push({
      pluginId,
      name,
      version: selected?.version || "",
      installed: true,
      enabled,
      source: selected ? { source: "local-cache", path: selected.root } : {},
      marketplaceName: "ravo",
      marketplaceSource: { sourceType: "local-cache", source: cacheParent },
      discovery: "configured_cache",
      cacheVersions: candidates.map((candidate) => candidate.version).sort()
    });
  }
  return entries;
}

function inspectInstalled(executeCodex, home) {
  const installed = listInstalled(executeCodex);
  const byId = new Map(installed.map((entry) => [entry.pluginId, entry]));
  for (const entry of configuredLegacyEntries(home)) {
    if (!byId.has(entry.pluginId)) byId.set(entry.pluginId, entry);
  }
  return [...byId.values()];
}

function packageRoot(entry, home) {
  const candidates = [
    entry?.source?.path,
    path.join(home, ".codex", "plugins", "cache", "ravo", entry.name || "", entry.version || "")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, ".codex-plugin", "plugin.json"))) || "";
}

function treeHash(root) {
  const hash = crypto.createHash("sha256");
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`unsafe_package_symlink:${relative}`);
      if (entry.isDirectory()) visit(absolute, relative);
      else {
        hash.update(relative);
        hash.update("\0");
        hash.update(fs.readFileSync(absolute));
        hash.update("\0");
      }
    }
  }
  visit(root);
  return hash.digest("hex");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function migrationId(now) {
  return `${now().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

function recoveryEntry(snapshotPath) {
  return `node ${JSON.stringify(path.join(snapshotPath, "restore-legacy.js"))} --apply`;
}

function sourceAssessment(installed, home) {
  const unified = installed.find((entry) => entry.pluginId === "ravo@ravo" && entry.installed !== false);
  const legacy = LEGACY_PLUGIN_NAMES.map((name) => installed.find((entry) => entry.pluginId === `${name}@ravo` && entry.installed !== false)).filter(Boolean);
  if (!unified || unified.version !== PRODUCT_VERSION || unified.enabled === false) {
    return { status: "unified_plugin_required", unified: unified || null, legacy };
  }
  if (legacy.length === 0) return { status: "already_migrated", unified, legacy };
  const roots = legacy.map((entry) => packageRoot(entry, home));
  const valid = legacy.length === LEGACY_PLUGIN_NAMES.length
    && legacy.every((entry) => entry.version === LEGACY_VERSION && entry.enabled !== false && entry.marketplaceName !== "not-ravo")
    && roots.every(Boolean);
  return { status: valid ? "supported" : "unsupported_source_state", unified, legacy, roots };
}

function snapshotMarketplace(snapshotPath, assessment, options) {
  const marketplaceRoot = path.join(snapshotPath, "legacy-marketplace");
  const pluginsRoot = path.join(marketplaceRoot, "plugins");
  fs.mkdirSync(pluginsRoot, { recursive: true, mode: 0o700 });
  const plugins = [];
  const statePlugins = [];
  for (let index = 0; index < assessment.legacy.length; index += 1) {
    const entry = assessment.legacy[index];
    const sourceRoot = assessment.roots[index];
    treeHash(sourceRoot);
    const destination = path.join(pluginsRoot, entry.name);
    fs.cpSync(sourceRoot, destination, { recursive: true, force: false, errorOnExist: true });
    const hash = treeHash(destination);
    plugins.push({
      name: entry.name,
      source: { source: "local", path: `./plugins/${entry.name}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools"
    });
    statePlugins.push({ pluginId: `${entry.name}@ravo`, name: entry.name, version: entry.version, enabled: entry.enabled !== false, sha256: hash });
  }
  writeJson(path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), {
    name: "ravo",
    interface: { displayName: "RAVO Legacy Restore" },
    plugins
  });
  const restoreSource = path.join(__dirname, "ravo-legacy-restore.js");
  fs.copyFileSync(restoreSource, path.join(snapshotPath, "restore-legacy.js"));
  fs.chmodSync(path.join(snapshotPath, "restore-legacy.js"), 0o700);
  const state = {
    schemaVersion: "0.5.0",
    kind: "ravo_legacy_restore_snapshot",
    createdAt: options.now().toISOString(),
    sourceProductVersion: LEGACY_VERSION,
    targetProductVersion: PRODUCT_VERSION,
    originalMarketplaceSource: assessment.legacy[0]?.marketplaceSource?.source || "",
    plugins: statePlugins
  };
  writeJson(path.join(snapshotPath, "state.json"), state);
  return state;
}

function writeResult(snapshotPath, result) {
  try { writeJson(path.join(snapshotPath, "result.json"), result); } catch (_error) { /* recovery data remains primary */ }
  return result;
}

function runMigration(input = {}) {
  const options = {
    mode: input.mode || "preview",
    home: path.resolve(input.home || os.homedir()),
    pluginRoot: path.resolve(input.pluginRoot || path.join(__dirname, "..", "..", "..")),
    executeCodex: input.executeCodex || executeCodexCommand,
    inspectPluginRoot: input.inspectPluginRoot || inspectPluginRoot,
    now: input.now || (() => new Date()),
    snapshot: input.snapshot || ""
  };
  if (options.mode === "restore") return restoreLegacy(options.snapshot, { executeCodex: options.executeCodex });

  let installed;
  try {
    installed = inspectInstalled(options.executeCodex, options.home);
  } catch (error) {
    return { status: "inspection_failed", reason: error.message, recoveryEntry: "Re-run preview after Codex plugin status is readable." };
  }
  const assessment = sourceAssessment(installed, options.home);
  if (assessment.status === "already_migrated") return { status: "already_migrated", target: "ravo@ravo 0.6.3", freshSessionRequired: true };
  if (assessment.status !== "supported") {
    return { status: assessment.status, expectedSourceVersion: LEGACY_VERSION, observed: assessment.legacy.map((entry) => ({ pluginId: entry.pluginId, version: entry.version, enabled: entry.enabled !== false })) };
  }
  const preflight = options.inspectPluginRoot(options.pluginRoot);
  if (preflight.status !== "healthy") return { status: "preflight_failed", preflight, recoveryEntry: "Keep the eight legacy plugins active and repair the unified package." };

  const placeholder = path.join(options.home, ".codex", "ravo", "migrations", "<migration-id>");
  const common = {
    source: `eight legacy plugins at ${LEGACY_VERSION}`,
    target: `ravo@ravo ${PRODUCT_VERSION}`,
    legacyPlugins: assessment.legacy.map((entry) => ({ name: entry.name, pluginId: entry.pluginId, version: entry.version })),
    hookEventsAfterMigration: ["Stop"],
    freshSessionRequired: true
  };
  if (options.mode === "preview") return { status: "preview_ready", ...common, writes: [], recoveryEntry: recoveryEntry(placeholder) };
  if (options.mode !== "apply") return { status: "invalid_mode", mode: options.mode };

  const snapshotPath = path.join(options.home, ".codex", "ravo", "migrations", migrationId(options.now));
  try {
    snapshotMarketplace(snapshotPath, assessment, options);
  } catch (error) {
    fs.rmSync(snapshotPath, { recursive: true, force: true });
    return { status: "snapshot_failed", reason: error.message, recoveryEntry: "Keep the eight legacy plugins active; no plugin removal was attempted." };
  }
  const base = { ...common, snapshotPath, recoveryEntry: recoveryEntry(snapshotPath) };
  const removed = [];
  try {
    for (const plugin of assessment.legacy) {
      options.executeCodex(["plugin", "remove", plugin.pluginId, "--json"]);
      removed.push(plugin.pluginId);
    }
    const after = inspectInstalled(options.executeCodex, options.home);
    const active = after.filter((entry) => entry.installed !== false && entry.enabled !== false).map((entry) => entry.pluginId);
    if (!active.includes("ravo@ravo") || LEGACY_PLUGIN_NAMES.some((name) => active.includes(`${name}@ravo`))) {
      throw new Error(`post_migration_verification_failed:${JSON.stringify(active)}`);
    }
    return writeResult(snapshotPath, { status: "migrated", ...base, removed, activePlugins: active });
  } catch (migrationError) {
    try {
      const restored = restoreLegacy(snapshotPath, { executeCodex: options.executeCodex });
      return writeResult(snapshotPath, { status: "rolled_back", ...base, removed, migrationError: migrationError.message, restored });
    } catch (rollbackError) {
      let currentPluginState = [];
      try { currentPluginState = inspectInstalled(options.executeCodex, options.home).map((entry) => ({ pluginId: entry.pluginId, version: entry.version, enabled: entry.enabled !== false })); } catch (_error) { /* keep empty diagnostic */ }
      return writeResult(snapshotPath, { status: "rollback_failed", ...base, removed, migrationError: migrationError.message, rollbackError: rollbackError.message, currentPluginState });
    }
  }
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const restore = argValue("--restore", "");
  const mode = restore ? "restore" : process.argv.includes("--apply") ? "apply" : "preview";
  const result = runMigration({ mode, snapshot: restore });
  console.log(JSON.stringify(result, null, 2));
  if (["inspection_failed", "unified_plugin_required", "unsupported_source_state", "preflight_failed", "snapshot_failed", "rollback_failed", "invalid_mode"].includes(result.status)) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  LEGACY_PLUGIN_NAMES,
  LEGACY_VERSION,
  PRODUCT_VERSION,
  configuredLegacyEntries,
  executeCodexCommand,
  inspectInstalled,
  listInstalled,
  packageRoot,
  runMigration,
  snapshotMarketplace,
  sourceAssessment,
  treeHash
};
