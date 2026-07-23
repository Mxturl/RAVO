#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  LEGACY_PLUGIN_NAMES,
  runMigration
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-migrate");

const pluginRoot = path.join(__dirname, "..", "plugins", "ravo");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const home = path.join(root, "home");
  const source = path.join(root, "legacy-source");
  fs.mkdirSync(home, { recursive: true });
  const installed = [{
    pluginId: "ravo@ravo",
    name: "ravo",
    version: "0.6.2",
    installed: true,
    enabled: true,
    source: { path: pluginRoot },
    marketplaceSource: { sourceType: "local", source: path.join(__dirname, "..") }
  }];
  for (const pluginName of LEGACY_PLUGIN_NAMES) {
    const packageRoot = path.join(source, pluginName);
    writeJson(path.join(packageRoot, ".codex-plugin", "plugin.json"), {
      name: pluginName,
      version: options.legacyVersion || "0.5.5"
    });
    fs.mkdirSync(path.join(packageRoot, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "hooks", "legacy.js"), "module.exports = {};\n");
    installed.push({
      pluginId: `${pluginName}@ravo`,
      name: pluginName,
      version: options.legacyVersion || "0.5.5",
      installed: true,
      enabled: true,
      source: { path: packageRoot },
      marketplaceSource: { sourceType: "local", source }
    });
  }

  const state = {
    installed,
    marketplaceRoot: path.join(__dirname, ".."),
    calls: [],
    legacyRemoveCount: 0,
    failRemoveAt: options.failRemoveAt || 0,
    failRollbackAdd: options.failRollbackAdd || false
  };

  function writeConfiguredPlugins() {
    if (!options.hideLegacyFromList) return;
    const config = state.installed
      .map((entry) => `[plugins.${JSON.stringify(entry.pluginId)}]\nenabled = ${entry.enabled !== false}\n`)
      .join("\n");
    const configPath = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, config);
  }

  if (options.hideLegacyFromList) {
    for (const entry of installed.filter((candidate) => candidate.pluginId !== "ravo@ravo")) {
      fs.cpSync(
        entry.source.path,
        path.join(home, ".codex", "plugins", "cache", "ravo", entry.name, entry.version),
        { recursive: true }
      );
    }
    writeConfiguredPlugins();
  }

  function executeCodex(args) {
    state.calls.push([...args]);
    if (args.join(" ") === "plugin list --marketplace ravo --json") {
      const visible = options.hideLegacyFromList
        ? state.installed.filter((entry) => entry.pluginId === "ravo@ravo")
        : state.installed;
      return { installed: visible.map((entry) => ({ ...entry })) };
    }
    if (args[0] === "plugin" && args[1] === "remove") {
      const selector = args[2];
      if (selector !== "ravo@ravo") {
        state.legacyRemoveCount += 1;
        if (state.failRemoveAt === state.legacyRemoveCount) throw new Error("fixture legacy removal failure");
      }
      state.installed = state.installed.filter((entry) => entry.pluginId !== selector);
      writeConfiguredPlugins();
      return { status: "removed", pluginId: selector };
    }
    if (args.join(" ") === "plugin marketplace remove ravo --json") {
      state.marketplaceRoot = "";
      return { status: "removed", name: "ravo" };
    }
    if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
      state.marketplaceRoot = args[3];
      return { status: "added", name: "ravo", root: args[3] };
    }
    if (args[0] === "plugin" && args[1] === "add") {
      const selector = args[2];
      if (state.failRollbackAdd) throw new Error("fixture rollback add failure");
      const pluginName = selector.split("@")[0];
      state.installed = state.installed.filter((entry) => entry.pluginId !== selector);
      state.installed.push({
        pluginId: selector,
        name: pluginName,
        version: "0.5.5",
        installed: true,
        enabled: true,
        source: { path: path.join(state.marketplaceRoot, "plugins", pluginName) },
        marketplaceSource: { sourceType: "local", source: state.marketplaceRoot }
      });
      return { status: "installed", pluginId: selector };
    }
    throw new Error(`Unexpected Codex command: ${args.join(" ")}`);
  }

  const reviewConfig = path.join(home, ".codex", "skill-config", "ravo-review.json");
  writeJson(reviewConfig, { marker: "must-remain-untouched" });
  return { root, home, source, state, executeCodex, reviewConfig };
}

function options(fixture, mode) {
  return {
    mode,
    home: fixture.home,
    pluginRoot,
    executeCodex: fixture.executeCodex,
    now: () => new Date("2026-07-21T04:00:00.000Z")
  };
}

const previewFixture = createFixture("ravo-v060-preview");
const preview = runMigration(options(previewFixture, "preview"));
assert.equal(preview.status, "preview_ready");
assert.deepEqual(preview.legacyPlugins.map((entry) => entry.name), LEGACY_PLUGIN_NAMES);
assert.match(preview.recoveryEntry, /restore-legacy\.js/);
assert.equal(fs.existsSync(path.join(previewFixture.home, ".codex", "ravo")), false, "preview must make zero writes");
assert.equal(previewFixture.state.calls.filter((args) => args.includes("remove")).length, 0);
fs.rmSync(previewFixture.root, { recursive: true, force: true });

const hiddenLegacyFixture = createFixture("ravo-v060-hidden-legacy", { hideLegacyFromList: true });
const hiddenPreview = runMigration(options(hiddenLegacyFixture, "preview"));
assert.equal(hiddenPreview.status, "preview_ready", "configured legacy plugins must remain discoverable after the new marketplace stops listing them");
assert.deepEqual(hiddenPreview.legacyPlugins.map((entry) => entry.name), LEGACY_PLUGIN_NAMES);
const hiddenMigration = runMigration(options(hiddenLegacyFixture, "apply"));
assert.equal(hiddenMigration.status, "migrated");
assert.deepEqual(hiddenLegacyFixture.state.installed.map((entry) => entry.pluginId), ["ravo@ravo"]);
fs.rmSync(hiddenLegacyFixture.root, { recursive: true, force: true });

const unsupportedFixture = createFixture("ravo-v060-unsupported", { legacyVersion: "0.5.4" });
const unsupported = runMigration(options(unsupportedFixture, "apply"));
assert.equal(unsupported.status, "unsupported_source_state");
assert.equal(unsupportedFixture.state.calls.filter((args) => args.includes("remove")).length, 0);
assert.equal(fs.existsSync(path.join(unsupportedFixture.home, ".codex", "ravo")), false);
fs.rmSync(unsupportedFixture.root, { recursive: true, force: true });

const successFixture = createFixture("ravo-v060-success");
const success = runMigration(options(successFixture, "apply"));
assert.equal(success.status, "migrated");
assert.deepEqual(successFixture.state.installed.map((entry) => entry.pluginId), ["ravo@ravo"]);
assert.ok(fs.existsSync(path.join(success.snapshotPath, "state.json")));
assert.ok(fs.existsSync(path.join(success.snapshotPath, "restore-legacy.js")));
assert.ok(fs.existsSync(path.join(success.snapshotPath, "legacy-marketplace", ".agents", "plugins", "marketplace.json")));
assert.deepEqual(JSON.parse(fs.readFileSync(successFixture.reviewConfig, "utf8")), { marker: "must-remain-untouched" });
assert.equal(JSON.stringify(readTree(success.snapshotPath)).includes("must-remain-untouched"), false);
fs.rmSync(successFixture.root, { recursive: true, force: true });

const rollbackFixture = createFixture("ravo-v060-rollback", { failRemoveAt: 3 });
const rolledBack = runMigration(options(rollbackFixture, "apply"));
assert.equal(rolledBack.status, "rolled_back");
assert.deepEqual(rollbackFixture.state.installed.map((entry) => entry.pluginId).sort(), LEGACY_PLUGIN_NAMES.map((name) => `${name}@ravo`).sort());
assert.equal(rollbackFixture.state.installed.some((entry) => entry.pluginId === "ravo@ravo"), false);
assert.match(rolledBack.recoveryEntry, /restore-legacy\.js/);
fs.rmSync(rollbackFixture.root, { recursive: true, force: true });

const failedRollbackFixture = createFixture("ravo-v060-rollback-failed", { failRemoveAt: 2, failRollbackAdd: true });
const rollbackFailed = runMigration(options(failedRollbackFixture, "apply"));
assert.equal(rollbackFailed.status, "rollback_failed");
assert.match(rollbackFailed.recoveryEntry, /restore-legacy\.js/);
assert.ok(Array.isArray(rollbackFailed.currentPluginState));
fs.rmSync(failedRollbackFixture.root, { recursive: true, force: true });

function readTree(root) {
  const values = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) values.push(...readTree(target));
    else values.push(fs.readFileSync(target, "utf8"));
  }
  return values;
}

console.log(JSON.stringify({
  status: "pass",
  scenarios: [
    "preview-zero-write",
    "configured-cache-legacy-discovery",
    "unsupported-source-state-stops",
    "apply-creates-offline-snapshot",
    "apply-removes-eight-legacy-plugins",
    "mid-removal-failure-auto-restores",
    "rollback-failure-exposes-single-recovery-entry",
    "review-provider-config-untouched"
  ]
}, null, 2));
