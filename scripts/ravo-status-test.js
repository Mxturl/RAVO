#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildStatus, REQUIRED_PLUGINS } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-status");
const { createSnapshot } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity");
const { validatePmBrief } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief");

const repo = path.resolve(__dirname, "..");
const reviewValidatorPath = path.join(repo, "plugins/ravo/modules/ravo-review/scripts/review-config.js");
const VERSION = "0.6.2";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-status-source-")));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-status-home-")));
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-status-workspace-")));
  const pluginRoot = path.join(root, "plugins", "ravo");
  const manifest = {
    name: "ravo",
    version: VERSION,
    skills: "./skills/",
    hooks: "./hooks/hooks.json",
    interface: { displayName: "RAVO" }
  };
  writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), manifest);
  writeJson(path.join(pluginRoot, "hooks", "hooks.json"), {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node stop.js" }] }]
    }
  });
  writeJson(path.join(pluginRoot, "modules", "ravo-review", ".codex-plugin", "plugin.json"), { name: "ravo-review", version: VERSION });
  writeJson(path.join(home, ".codex", "plugins", "cache", "ravo", "ravo", VERSION, ".codex-plugin", "plugin.json"), manifest);
  writeJson(path.join(workspace, "knowledge", ".ravo", "manifest.json"), { schemaVersion: "0.5.0", modules: {} });
  writeJson(path.join(workspace, "knowledge", ".ravo", "config.json"), { technicalDetailLevel: 2, audience: "engineering" });
  writeJson(path.join(home, ".codex", "skill-config", "ravo-review.json"), { apiMode: "fake", apiBase: "fake://review", models: ["fixture-model"] });

  const trustValue = "secret-trust-hash-must-not-leak";
  const trustFile = path.join(home, ".codex", "config.toml");
  const writeTrust = (events = ["stop"]) => {
    const text = [
      `[marketplaces.ravo]\nsource_type = "local"\nsource = ${JSON.stringify(root)}`,
      `[plugins."ravo@ravo"]\nenabled = true`,
      "[hooks.state]",
      ...events.map((event) => [
        `[hooks.state."ravo@ravo:hooks/hooks.json:${event}:0:0"]`,
        `trusted_hash = "${trustValue}"`
      ].join("\n"))
    ].join("\n\n");
    fs.mkdirSync(path.dirname(trustFile), { recursive: true });
    fs.writeFileSync(trustFile, `${text}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(trustFile, 0o600);
  };
  writeTrust();

  const pluginState = { installed: true, enabled: true, version: VERSION };
  const commandState = { marketplaceMissing: false, marketplaceError: false, pluginError: false, marketplaceRoot: root };
  const execute = (args) => {
    const command = args.join(" ");
    if (command === "plugin marketplace list --json") {
      if (commandState.marketplaceError) throw new Error("fixture marketplace error bearer-token-secret-marker");
      return { marketplaces: commandState.marketplaceMissing ? [] : [{ name: "ravo", root: commandState.marketplaceRoot, marketplaceSource: { sourceType: "local", source: commandState.marketplaceRoot } }] };
    }
    if (command === "plugin list --marketplace ravo --json") {
      if (commandState.pluginError) throw new Error("fixture plugin error bearer-token-secret-marker");
      return { installed: [{
        pluginId: "ravo@ravo",
        name: "ravo",
        marketplaceName: "ravo",
        version: pluginState.version,
        installed: pluginState.installed,
        enabled: pluginState.enabled,
        source: { source: "local", path: pluginRoot }
      }] };
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return {
    root, home, workspace, pluginRoot, pluginState, commandState, trustFile, trustValue, writeTrust,
    options: { home, execute, reviewValidatorPath }
  };
}

assert.deepEqual(REQUIRED_PLUGINS, ["ravo"]);
const healthy = fixture();
const configured = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(configured.marketplaceStatus, "present");
assert.equal(configured.pluginStatus, "healthy");
assert.equal(configured.versionStatus, "aligned");
assert.equal(configured.hookTrustEvidence, "recorded");
assert.deepEqual(configured.expectedHookEvents, ["Stop"]);
assert.equal(configured.runtimeProbeStatus, "missing");
assert.equal(configured.runtimeHealth, "degraded");
assert.equal(configured.configIntegrityStatus, "approval_required");
assert.equal(Object.hasOwn(configured.config, "technicalDetailLevel"), false);
assert.equal(Object.hasOwn(configured.config, "audience"), false);
assert.equal(JSON.stringify(configured).includes(healthy.trustValue), false);

const hijackedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-status-hijacked-source-")));
writeJson(path.join(hijackedRoot, "plugins", "ravo", ".codex-plugin", "plugin.json"), { name: "ravo", version: "9.9.9" });
healthy.commandState.marketplaceRoot = hijackedRoot;
const sourceAnchored = buildStatus(healthy.workspace, "", healthy.options);
assert.equal(sourceAnchored.sourceRoot, healthy.root, "installed plugin source anchors status over marketplace drift");
healthy.commandState.marketplaceRoot = healthy.root;

writeJson(path.join(healthy.workspace, "knowledge", ".ravo", "quick-validation", "runtime-probe.json"), {
  schemaVersion: "0.5.0",
  id: "runtime-probe",
  kind: "runtime_probe",
  scope: "RAVO Runtime",
  status: "pass",
  fingerprint: configured.fingerprint,
  expectedHookEvents: configured.expectedHookEvents,
  observedEvidence: configured.expectedHookEvents.map((event) => ({ event, status: "pass", sessionId: "session-1", promptRef: "prompt-1" })),
  sessionIds: ["session-1"],
  promptRefs: ["prompt-1"],
  createdAt: new Date().toISOString()
});
const probed = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(probed.runtimeProbeStatus, "pass");
assert.equal(probed.runtimeHealth, "configured_unverified");
assert.equal(probed.configIntegrityStatus, "no_snapshot");
createSnapshot({ home: healthy.home, runtimeStatus: probed, validateToml: () => ({ status: "pass" }), reason: "runtime_probe_verified" });
const snapshotted = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(snapshotted.runtimeHealth, "healthy");
assert.equal(snapshotted.configIntegrityStatus, "healthy");
assert.deepEqual(validatePmBrief(snapshotted.pmBrief), []);
assert.equal(snapshotted.pmBrief.productState, "locally_available");

healthy.pluginState.enabled = false;
const disabled = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(disabled.pluginStatus, "degraded");
assert.ok(disabled.recoverySteps.some((step) => step.includes("ravo@ravo")));
healthy.pluginState.enabled = true;

healthy.writeTrust([]);
const missingTrust = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(missingTrust.hookTrustEvidence, "missing");
assert.equal(missingTrust.runtimeHealth, "degraded");
assert.ok(missingTrust.recoverySteps.some((step) => step.includes("Settings > Hooks") && step.includes("/hooks")));
healthy.writeTrust();

writeJson(path.join(healthy.workspace, "knowledge", ".ravo", "quick-validation", "zz-stale-runtime-probe.json"), {
  schemaVersion: "0.5.0",
  id: "stale-runtime-probe",
  kind: "runtime_probe",
  status: "pass",
  fingerprint: "sha256:stale",
  observedEvidence: [],
  sessionIds: ["session-old"],
  promptRefs: ["prompt-old"],
  createdAt: new Date().toISOString()
});
const stale = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(stale.runtimeProbeStatus, "stale");
assert.notEqual(stale.runtimeHealth, "healthy");

healthy.commandState.marketplaceMissing = true;
assert.equal(buildStatus(healthy.workspace, healthy.root, healthy.options).runtimeHealth, "missing");
healthy.commandState.marketplaceMissing = false;
healthy.commandState.marketplaceError = true;
const commandError = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(commandError.runtimeHealth, "error");
assert.equal(JSON.stringify(commandError).includes("bearer-token-secret-marker"), false);
healthy.commandState.marketplaceError = false;

fs.writeFileSync(healthy.trustFile, "[hooks.state.\"ravo@ravo:broken\"\ntrusted_hash = \"x\"\n", "utf8");
const unknownTrust = buildStatus(healthy.workspace, healthy.root, healthy.options);
assert.equal(unknownTrust.hookTrustEvidence, "unknown");
healthy.writeTrust();

fs.writeFileSync(path.join(healthy.workspace, "knowledge", ".ravo", "config.json"), "{invalid", "utf8");
assert.equal(buildStatus(healthy.workspace, healthy.root, healthy.options).configStatus, "error");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "single-required-plugin",
    "single-hook-trust-scanner",
    "installed-source-anchor",
    "fresh-session-probe-and-snapshot",
    "disabled-plugin-degraded",
    "missing-trust-degraded",
    "actionable-hook-trust-recovery",
    "stale-probe-degraded",
    "marketplace-and-command-errors",
    "command-error-redaction",
    "unknown-trust-syntax",
    "config-error",
    "pm-brief-local-availability"
  ]
}, null, 2));
