#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  REQUIRED_PLUGINS,
  applyUpgrade,
  checkUpdates,
  createUpgradePlan,
  recoverConfig
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade");

function createFixture(name, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-marketplace-`)));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-home-`)));
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-workspace-`)));
  const sourceVersion = options.sourceVersion || "0.6.1";
  const initialVersion = options.initialVersion || "0.5.5";
  const state = new Map();
  const calls = [];
  for (const plugin of REQUIRED_PLUGINS) {
    const sourceManifest = path.join(root, "plugins", plugin, ".codex-plugin", "plugin.json");
    fs.mkdirSync(path.dirname(sourceManifest), { recursive: true });
    fs.writeFileSync(sourceManifest, JSON.stringify({ name: plugin, version: sourceVersion }), "utf8");
    state.set(plugin, { version: initialVersion, enabled: true, installed: true });
    const cacheManifest = path.join(home, ".codex", "plugins", "cache", "ravo", plugin, initialVersion, ".codex-plugin", "plugin.json");
    fs.mkdirSync(path.dirname(cacheManifest), { recursive: true });
    fs.writeFileSync(cacheManifest, JSON.stringify({ name: plugin, version: initialVersion }), "utf8");
  }
  const userConfig = path.join(home, ".codex", "skill-config", "ravo.json");
  const reviewConfig = path.join(home, ".codex", "skill-config", "ravo-review.json");
  const workspaceConfig = path.join(workspace, "knowledge", ".ravo", "config.json");
  const fixtureCredential = ["fixture", "secret"].join("-");
  for (const [file, value] of [
    [userConfig, { schemaVersion: "0.4.0", technicalDetailLevel: 2, audience: "engineering", unknown: "keep" }],
    [reviewConfig, { apiMode: "fake", apiBase: "fake://review", apiKey: fixtureCredential, models: ["model-a"], maxTokens: 65432 }],
    [workspaceConfig, { technicalDetailLevel: 4 }]
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  const execute = (args) => {
    calls.push(args.slice());
    if (args.join(" ") === "plugin marketplace list --json") {
      return {
        marketplaces: [{
          name: "ravo",
          root,
          marketplaceSource: { sourceType: options.sourceType || "local", source: root }
        }]
      };
    }
    if (args.join(" ") === "plugin marketplace upgrade ravo") return { status: "ok" };
    if (args.join(" ") === "plugin list --marketplace ravo --json") {
      return {
        installed: [...state.entries()].map(([plugin, record]) => ({
          pluginId: `${plugin}@ravo`,
          name: plugin,
          marketplaceName: "ravo",
          version: record.version,
          installed: record.installed,
          enabled: record.enabled,
          source: { source: "local", path: path.join(root, "plugins", plugin) }
        }))
      };
    }
    if (args[0] === "plugin" && args[1] === "remove") {
      const plugin = args[2].replace(/@ravo$/, "");
      state.set(plugin, { version: "", enabled: false, installed: false });
      fs.rmSync(path.join(home, ".codex", "plugins", "cache", "ravo", plugin), { recursive: true, force: true });
      return { status: "ok", pluginId: `${plugin}@ravo` };
    }
    if (args[0] === "plugin" && args[1] === "add") {
      const plugin = args[2].replace(/@ravo$/, "");
      if (options.failPlugin === plugin) {
        const error = new Error(`fixture failure for ${plugin}`);
        error.code = "fixture_plugin_failure";
        throw error;
      }
      state.set(plugin, { version: sourceVersion, enabled: true, installed: true });
      const sourcePlugin = path.join(root, "plugins", plugin);
      const cachePlugin = path.join(home, ".codex", "plugins", "cache", "ravo", plugin, sourceVersion);
      fs.rmSync(cachePlugin, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(cachePlugin), { recursive: true });
      fs.cpSync(sourcePlugin, cachePlugin, { recursive: true });
      if (options.mutateConfig && plugin === REQUIRED_PLUGINS[0]) fs.writeFileSync(reviewConfig, JSON.stringify({ changed: true }), "utf8");
      return { status: "ok", pluginId: `${plugin}@ravo` };
    }
    throw new Error(`unexpected fixture command: ${args.join(" ")}`);
  };
  return { root, home, workspace, state, calls, execute, userConfig, reviewConfig, workspaceConfig, sourceVersion };
}

const success = createFixture("ravo-upgrade-success");
const initialUser = fs.readFileSync(success.userConfig);
const initialReview = fs.readFileSync(success.reviewConfig);
const initialWorkspace = fs.readFileSync(success.workspaceConfig);
const checked = checkUpdates({ home: success.home, execute: success.execute, refresh: true });
assert.equal(checked.status, "update_or_repair_available");
assert.equal(checked.sourceType, "local");
assert.equal(success.calls.some((args) => args.join(" ") === "plugin marketplace upgrade ravo"), false, "local marketplace is never upgraded with git pull semantics");
const plan = createUpgradePlan(checked);
assert.deepEqual(plan.requiredPlugins, REQUIRED_PLUGINS);
const applied = applyUpgrade(plan, {
  home: success.home,
  execute: success.execute,
  workspaces: [success.workspace],
  installController: () => ({ plugin: { version: success.sourceVersion }, paths: { controller: path.join(success.home, ".codex", "ravo", "bin", "ravo-solodesk.js") } })
});
assert.equal(applied.status, "succeeded");
assert.equal(applied.controllerRefresh.status, "succeeded", "a successful upgrade refreshes the trusted SoloDesk controller");
assert.ok(applied.verification.allPluginsAligned);
assert.ok(applied.verification.allConfigsMatch);
assert.deepEqual(fs.readFileSync(success.userConfig), initialUser);
assert.deepEqual(fs.readFileSync(success.reviewConfig), initialReview);
assert.deepEqual(fs.readFileSync(success.workspaceConfig), initialWorkspace);
const addCalls = success.calls.filter((args) => args[0] === "plugin" && args[1] === "add");
const removeCalls = success.calls.filter((args) => args[0] === "plugin" && args[1] === "remove");
assert.equal(addCalls.length, REQUIRED_PLUGINS.length);
assert.equal(removeCalls.length, REQUIRED_PLUGINS.length);
assert.deepEqual(addCalls.map((args) => args.join(" ")), REQUIRED_PLUGINS.map((plugin) => `plugin add ${plugin}@ravo --json`));
assert.deepEqual(removeCalls.map((args) => args.join(" ")), REQUIRED_PLUGINS.map((plugin) => `plugin remove ${plugin}@ravo --json`));
const journalFile = path.join(success.home, ".codex", "ravo", "upgrades", `${plan.planId}.json`);
const snapshotDir = path.join(success.home, ".codex", "ravo", "backups", plan.planId);
assert.equal(fs.statSync(journalFile).mode & 0o777, 0o600);
assert.equal(fs.statSync(snapshotDir).mode & 0o777, 0o700);
for (const file of fs.readdirSync(snapshotDir).filter((name) => name.endsWith(".json"))) assert.equal(fs.statSync(path.join(snapshotDir, file)).mode & 0o777, 0o600);

fs.writeFileSync(success.userConfig, JSON.stringify({ changedAfterUpgrade: true }), "utf8");
fs.writeFileSync(success.reviewConfig, JSON.stringify({ changedAfterUpgrade: true }), "utf8");
const recovered = recoverConfig(plan.planId, { home: success.home, workspaces: [success.workspace] });
assert.equal(recovered.status, "recovered");
assert.deepEqual(fs.readFileSync(success.userConfig), initialUser);
assert.deepEqual(fs.readFileSync(success.reviewConfig), initialReview);

const partialFixture = createFixture("ravo-upgrade-partial", { failPlugin: "ravo" });
const partialPlan = createUpgradePlan(checkUpdates({ home: partialFixture.home, execute: partialFixture.execute }));
const partial = applyUpgrade(partialPlan, {
  home: partialFixture.home,
  execute: partialFixture.execute,
  workspaces: [partialFixture.workspace],
  installController: () => ({ plugin: { version: partialFixture.sourceVersion }, paths: { controller: path.join(partialFixture.home, ".codex", "ravo", "bin", "ravo-solodesk.js") } })
});
assert.equal(partial.status, "failed", "a unified plugin failure is total rather than a partial multi-plugin update");
assert.ok(partial.pluginResults.some((entry) => entry.pluginId === "ravo" && entry.status === "failed"));
assert.match(partial.recovery.entry, /Plugin code rollback is not claimed/);

const changedConfigFixture = createFixture("ravo-upgrade-config-recovery", { mutateConfig: true });
const changedOriginal = fs.readFileSync(changedConfigFixture.reviewConfig);
const changedPlan = createUpgradePlan(checkUpdates({ home: changedConfigFixture.home, execute: changedConfigFixture.execute }));
const changed = applyUpgrade(changedPlan, {
  home: changedConfigFixture.home,
  execute: changedConfigFixture.execute,
  workspaces: [changedConfigFixture.workspace],
  installController: () => ({ plugin: { version: changedConfigFixture.sourceVersion }, paths: { controller: path.join(changedConfigFixture.home, ".codex", "ravo", "bin", "ravo-solodesk.js") } })
});
assert.equal(changed.status, "recovered");
assert.deepEqual(fs.readFileSync(changedConfigFixture.reviewConfig), changedOriginal);

const invalidConfigFixture = createFixture("ravo-upgrade-invalid-config");
fs.writeFileSync(invalidConfigFixture.reviewConfig, "{invalid", "utf8");
const invalidPlan = createUpgradePlan(checkUpdates({ home: invalidConfigFixture.home, execute: invalidConfigFixture.execute }));
const callsBeforeInvalidApply = invalidConfigFixture.calls.length;
const invalid = applyUpgrade(invalidPlan, { home: invalidConfigFixture.home, execute: invalidConfigFixture.execute, workspaces: [invalidConfigFixture.workspace] });
assert.equal(invalid.status, "failed");
assert.equal(invalid.pluginResults.length, 0);
assert.equal(invalidConfigFixture.calls.slice(callsBeforeInvalidApply).some((args) => args[0] === "plugin" && args[1] === "add"), false);

const gitFixture = createFixture("ravo-upgrade-git", { sourceType: "git" });
checkUpdates({ home: gitFixture.home, execute: gitFixture.execute, refresh: true });
assert.ok(gitFixture.calls.some((args) => args.join(" ") === "plugin marketplace upgrade ravo"));

const contentDriftFixture = createFixture("ravo-upgrade-content-drift", { sourceVersion: "0.6.1", initialVersion: "0.6.1" });
const driftPlugin = "ravo";
const driftFile = path.join(contentDriftFixture.root, "plugins", driftPlugin, "scripts", "runtime.js");
fs.mkdirSync(path.dirname(driftFile), { recursive: true });
fs.writeFileSync(driftFile, "module.exports = 'new-runtime-behavior';\n", "utf8");
const contentDriftCheck = checkUpdates({ home: contentDriftFixture.home, execute: contentDriftFixture.execute });
assert.equal(contentDriftCheck.status, "update_or_repair_available", "same-version source/cache content drift requires repair");
assert.equal(contentDriftCheck.plugins.find((plugin) => plugin.pluginId === driftPlugin).driftReason, "cache_content_mismatch");
const contentDriftPlan = createUpgradePlan(contentDriftCheck);
assert.equal(contentDriftPlan.pluginActions.find((item) => item.pluginId === driftPlugin).action, "replace");
assert.equal(contentDriftPlan.pluginActions.filter((item) => item.action === "verify").length, REQUIRED_PLUGINS.length - 1);
const contentDriftApplied = applyUpgrade(contentDriftPlan, {
  home: contentDriftFixture.home,
  execute: contentDriftFixture.execute,
  workspaces: [contentDriftFixture.workspace],
  installController: () => ({ plugin: { version: contentDriftFixture.sourceVersion }, paths: { controller: path.join(contentDriftFixture.home, ".codex", "ravo", "bin", "ravo-solodesk.js") } })
});
assert.equal(contentDriftApplied.status, "succeeded");
assert.ok(contentDriftApplied.verification.allPluginsAligned);
assert.equal(contentDriftFixture.calls.filter((args) => args[0] === "plugin" && args[1] === "remove").length, 1);
assert.equal(contentDriftFixture.calls.filter((args) => args[0] === "plugin" && args[1] === "add").length, 1);

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "local-check-no-git-pull",
    "fixed-required-plugin-argv",
    "snapshot-permissions-integrity",
    "controller-refresh-after-plugin-upgrade",
    "happy-path-succeeded",
    "explicit-config-recovery",
    "partial-plugin-failure",
    "unexpected-config-change-recovered",
    "backup-preflight-blocks-installs",
    "git-refresh-explicit-only",
    "same-version-cache-content-refresh"
  ]
}, null, 2));
