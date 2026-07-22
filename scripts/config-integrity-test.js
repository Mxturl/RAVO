#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ConfigIntegrityError,
  RAVO_PLUGIN_NAMES,
  applyRepair,
  createSnapshot,
  getIntegrityStatus,
  listRepairJournals,
  makePrivateTempDir,
  parseTomlDocument,
  previewRepair,
  recoverRepair,
  sha
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity");

const RAVO_HOOK_KEY = "ravo@ravo:hooks/hooks.json:stop:0:0";
const PONYTAIL_HOOK_KEY = "ponytail@ponytail:hooks/claude-codex-hooks.json:session_start:0:0";

function writeConfig(home, value) {
  const file = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function pluginSections() {
  return RAVO_PLUGIN_NAMES.map((name) => `[plugins."${name}@ravo"]\nenabled = true\n`).join("\n");
}

function knownGoodConfig(sourceRoot) {
  return `model = "custom"
experimental_bearer_token = "snapshot-secret"
sample_matrix = [
  ["looks.like.a.table"]
]
message = """
[not.a.real.table]
"""

[model_providers.custom]
base_url = "https://snapshot.invalid/v1/responses"

[marketplaces.ravo]
source_type = "local"
source = "${sourceRoot}"

[marketplaces.ponytail]
source_type = "local"
source = "/opt/ponytail"

${pluginSections()}
[plugins."ponytail@ponytail"]
enabled = true

[features]
apps = true

[custom.unknown]
value = "snapshot"

[hooks.state]

[hooks.state."${RAVO_HOOK_KEY}"]
trusted_hash = "ravo-known-good"

[hooks.state."${PONYTAIL_HOOK_KEY}"]
trusted_hash = "ponytail-known-good"

[mcp_servers.node_repl]
command = "node"
`;
}

function driftedConfig(sourceRoot) {
  return `model = "custom"
experimental_bearer_token = "current-secret"
sample_matrix = [
  ["looks.like.a.table"]
]
message = """
[not.a.real.table]
"""

[model_providers.custom]
base_url = "https://current.invalid/v1/responses"

[plugins."ravo@ravo"]
enabled = false

[plugins."custom-tool@ravo"]
enabled = true

[features]
apps = false

[custom.unknown]
value = "current"
source_hint = "${sourceRoot}"

[hooks.state]

[hooks.state."custom-tool@ravo:hooks/custom.json:user_prompt_submit:0:0"]
trusted_hash = "custom-current"

[mcp_servers.node_repl]
command = "node-current"
`;
}

function runtimeStatus(sourceRoot, hookHash = "sha256:hook-a", runtimeProbeStatus = "pass") {
  return {
    sourceRoot,
    marketplaceStatus: "present",
    marketplace: { name: "ravo", sourceType: "local", root: sourceRoot },
    pluginStatus: "healthy",
    versionStatus: "aligned",
    hookTrustEvidence: "recorded",
    runtimeProbeStatus,
    configMutationEpoch: "initial",
    runtimeHealth: runtimeProbeStatus === "pass" ? "healthy" : "configured_unverified",
    pluginFingerprint: "sha256:plugins-a",
    plugins: RAVO_PLUGIN_NAMES.map((name) => ({ name, pluginId: `${name}@ravo`, installed: true, enabled: true })),
    hookTrust: { expected: [{ pluginId: "ravo@ravo", event: "Stop", key: RAVO_HOOK_KEY, recorded: true }], errors: [] },
    hookManifests: [{ pluginId: "ravo@ravo", hash: hookHash }],
    runtimeProbe: { artifactPath: "knowledge/.ravo/quick-validation/runtime-probe.json" }
  };
}

function options(home, runtime, overrides = {}) {
  return {
    home,
    runtimeStatus: runtime,
    validateToml: (text) => {
      const parsed = parseTomlDocument(text);
      assert.deepEqual(parsed.duplicates, []);
      return { status: "pass" };
    },
    pluginCheck: () => ({ status: "pass", missing: [] }),
    statusCheck: () => ({ marketplaceStatus: "present", pluginStatus: "healthy", hookTrustEvidence: "recorded", runtimeProbeStatus: "missing", runtimeHealth: "configured_unverified" }),
    ...overrides
  };
}

function assertPrivate(file, mode) {
  assert.equal(fs.statSync(file).mode & 0o777, mode, `${file} mode`);
}

function selectedExternalSections() {
  return [
    "marketplaces.ponytail",
    'plugins."ponytail@ponytail"',
    `hooks.state."${PONYTAIL_HOOK_KEY}"`
  ];
}

function main() {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-config-integrity-")));
  const home = path.join(temp, "home");
  const sourceRoot = path.join(temp, "RAVO");
  fs.mkdirSync(sourceRoot, { recursive: true });
  const runtime = runtimeStatus(sourceRoot);
  const configFile = writeConfig(home, knownGoodConfig(sourceRoot));
  const privateTemp = makePrivateTempDir("ravo-config-integrity-mode-");
  assertPrivate(privateTemp, 0o700);
  fs.rmSync(privateTemp, { recursive: true, force: true });

  const parsed = parseTomlDocument(fs.readFileSync(configFile, "utf8"));
  assert.equal(parsed.sections.some((section) => section.name === "not.a.real.table"), false, "multiline strings do not create fake tables");
  assert.equal(parsed.sections.some((section) => section.name === '"looks.like.a.table"'), false, "nested arrays do not create fake tables");
  assert.equal(parsed.byKey.size, parsed.sections.length);
  const arrayTables = parseTomlDocument("[[custom.items]]\nname = \"a\"\n[[custom.items]]\nname = \"b\"\n");
  assert.equal(arrayTables.duplicates.length, 0, "legal array-of-tables entries are not duplicate tables");
  assert.throws(() => parseTomlDocument('token = "unterminated\n[marketplaces.ravo]\n'), (error) => error instanceof ConfigIntegrityError && error.code === "toml_string_unterminated");
  assert.throws(() => createSnapshot(options(home, runtime, {
    validateToml: () => { throw new Error("bearer-token-secret-marker"); }
  })), (error) => error instanceof ConfigIntegrityError && error.code === "candidate_toml_invalid" && !error.message.includes("bearer-token-secret-marker"));

  const snapshotResult = createSnapshot(options(home, runtime, { reason: "test_known_good", maxSnapshots: 5 }));
  assert.equal(snapshotResult.status, "created");
  assert.equal(snapshotResult.snapshot.runtimeVerified, true);
  assertPrivate(snapshotResult.snapshot.configPath, 0o600);
  assertPrivate(snapshotResult.snapshot.metadataPath, 0o600);
  assertPrivate(path.dirname(snapshotResult.snapshot.configPath), 0o700);
  const metadataText = fs.readFileSync(snapshotResult.snapshot.metadataPath, "utf8");
  assert.equal(metadataText.includes("snapshot-secret"), false, "snapshot metadata must not contain secret values");
  assert.equal(metadataText.includes("ravo-known-good"), false, "snapshot metadata must not contain trusted_hash values");
  const mutationLockPath = path.join(home, ".codex", "ravo", "mutation.lock");
  fs.writeFileSync(mutationLockPath, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  assert.throws(() => createSnapshot(options(home, runtime)), (error) => error instanceof ConfigIntegrityError && error.code === "operation_in_progress");
  fs.unlinkSync(mutationLockPath);

  writeConfig(home, driftedConfig(sourceRoot));
  const preview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    selectedExternalSections: selectedExternalSections(),
    reenablePlugins: ["ravo@ravo"]
  }));
  assert.equal(preview.status, "changes_ready");
  assert.equal(preview.approvalRequired.length, 0);
  assert.ok(preview.managedChanges.some((entry) => entry.section === "marketplaces.ravo"));
  assert.ok(preview.managedChanges.some((entry) => entry.reason === "runtime_verified_hook_identity_unchanged"));
  assert.equal(preview.externalPreservedChanges.length, 3);
  assert.ok(preview.protectedSections.some((entry) => entry.section === "<root>" && entry.preserved), "top-level Provider/token fields are explicitly protected");
  assert.ok(preview.protectedSections.every((entry) => entry.preserved));
  assert.equal(JSON.stringify(preview).includes("current-secret"), false);
  assert.equal(JSON.stringify(preview).includes("snapshot-secret"), false);
  assert.equal(JSON.stringify(preview).includes("ravo-known-good"), false);

  const applied = applyRepair(preview, options(home, runtime));
  assert.equal(applied.status, "succeeded");
  assert.equal(applied.runtimeProbeRequired, true);
  assert.equal(applied.pluginCheck.status, "pass");
  const repaired = fs.readFileSync(configFile, "utf8");
  assert.match(repaired, /experimental_bearer_token = "current-secret"/);
  assert.match(repaired, /base_url = "https:\/\/current\.invalid\/v1\/responses"/);
  assert.match(repaired, /\[custom\.unknown\][\s\S]*value = "current"/);
  assert.match(repaired, /\[mcp_servers\.node_repl\][\s\S]*command = "node-current"/);
  assert.match(repaired, /\[marketplaces\.ravo\]/);
  for (const name of RAVO_PLUGIN_NAMES) assert.match(repaired, new RegExp(`\\[plugins\\.\\"${name}@ravo\\"\\]`));
  assert.match(repaired, new RegExp(RAVO_HOOK_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(repaired, /\[marketplaces\.ponytail\]/);
  assert.match(repaired, /\[plugins\."custom-tool@ravo"\]/, "unlisted @ravo plugins remain protected user configuration");
  assert.match(repaired, /custom-tool@ravo:hooks\/custom\.json/, "unlisted @ravo Hook tables remain protected user configuration");
  assert.match(repaired, new RegExp(PONYTAIL_HOOK_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assertPrivate(configFile, 0o600);
  assert.ok(applied.mutationEpoch?.epochId, "repair writes a config mutation epoch");
  assert.equal(listRepairJournals({ home })[0].status, "succeeded");

  const recovered = recoverRepair(applied.repairId, options(home, runtime));
  assert.equal(recovered.status, "recovered");
  assert.equal(fs.readFileSync(configFile, "utf8"), driftedConfig(sourceRoot), "explicit recovery restores the pre-repair config exactly");
  assert.ok(recovered.preRecoveryBackupPath && fs.existsSync(recovered.preRecoveryBackupPath));
  assert.notEqual(recovered.mutationEpoch.epochId, applied.mutationEpoch.epochId, "explicit recovery advances the mutation epoch");

  const changedHookPreview = previewRepair(options(home, runtimeStatus(sourceRoot, "sha256:hook-b"), {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  assert.equal(changedHookPreview.status, "attention_required");
  assert.equal(changedHookPreview.approvalRequired.length, 1);
  assert.equal(changedHookPreview.approvalRequired[0].reason, "hook_manifest_changed_or_snapshot_unverified");
  assert.equal(JSON.stringify(changedHookPreview).includes("ravo-known-good"), false);

  writeConfig(home, knownGoodConfig(sourceRoot).replace('trusted_hash = "ravo-known-good"', 'trusted_hash = "attacker-controlled"'));
  const fakeTrustPreview = previewRepair(options(home, { ...runtime, runtimeProbeStatus: "stale" }, {
    snapshotId: snapshotResult.snapshot.snapshotId
  }));
  assert.equal(fakeTrustPreview.status, "attention_required");
  assert.ok(fakeTrustPreview.approvalRequired.some((entry) => entry.reason === "hook_trust_differs_from_verified_snapshot"));
  assert.equal(JSON.stringify(fakeTrustPreview).includes("attacker-controlled"), false);

  const brokenHookRuntime = {
    ...runtime,
    runtimeProbeStatus: "stale",
    hookTrust: { ...runtime.hookTrust, errors: ["hook_manifest_invalid"] },
    hookManifests: []
  };
  const brokenHookPreview = previewRepair(options(home, brokenHookRuntime, {
    snapshotId: snapshotResult.snapshot.snapshotId
  }));
  assert.ok(brokenHookPreview.approvalRequired.some((entry) => entry.reason === "hook_definition_unavailable"));
  assert.ok(!brokenHookPreview.managedChanges.some((entry) => entry.action === "remove" && /hooks\.state/.test(entry.section)), "Hook definition errors never delete current trust tables");

  const stalePreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  fs.appendFileSync(configFile, "\n# current changed after preview\n");
  const staleHash = sha(fs.readFileSync(configFile));
  assert.throws(() => applyRepair(stalePreview, options(home, runtime)), (error) => error instanceof ConfigIntegrityError && error.code === "stale_plan");
  assert.equal(sha(fs.readFileSync(configFile)), staleHash, "stale plan does not write config");

  writeConfig(home, driftedConfig(sourceRoot));
  const rollbackPreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  const beforeRollbackHash = sha(fs.readFileSync(configFile));
  assert.throws(() => applyRepair(rollbackPreview, options(home, runtime, {
    beforeRename: () => { throw new Error("injected rename failure"); }
  })), (error) => error instanceof ConfigIntegrityError && error.code === "repair_failed");
  assert.equal(sha(fs.readFileSync(configFile)), beforeRollbackHash, "pre-rename failure leaves the exact current bytes");
  assert.equal(listRepairJournals({ home })[0].status, "failed");
  const leakedTemps = fs.readdirSync(path.dirname(configFile)).filter((name) => name.startsWith("config.toml.") && name.endsWith(".tmp"));
  assert.deepEqual(leakedTemps, [], "failed atomic writes leave no secret-bearing temp file");

  const concurrentPreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  assert.throws(() => applyRepair(concurrentPreview, options(home, runtime, {
    beforeRename: () => fs.appendFileSync(configFile, "\n# concurrent-user-change\n")
  })), (error) => error instanceof ConfigIntegrityError && error.code === "stale_plan");
  assert.match(fs.readFileSync(configFile, "utf8"), /concurrent-user-change/, "CAS preserves an external write made after preview");

  writeConfig(home, driftedConfig(sourceRoot));
  const afterRenamePreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  const beforeAfterRenameHash = sha(fs.readFileSync(configFile));
  assert.throws(() => applyRepair(afterRenamePreview, options(home, runtime, {
    afterRename: () => { throw new Error("injected post-rename failure"); }
  })), (error) => error instanceof ConfigIntegrityError && error.code === "repair_failed_recovered");
  assert.equal(sha(fs.readFileSync(configFile)), beforeAfterRenameHash, "post-rename failure performs a verified rollback");

  writeConfig(home, driftedConfig(sourceRoot));
  const recoveryGuardPreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  const recoveryGuardApply = applyRepair(recoveryGuardPreview, options(home, runtime));
  fs.appendFileSync(configFile, "\n# newer-change-before-recovery\n");
  assert.throws(() => recoverRepair(recoveryGuardApply.repairId, options(home, runtime)), (error) => error instanceof ConfigIntegrityError && error.code === "stale_recovery");
  assert.match(fs.readFileSync(configFile, "utf8"), /newer-change-before-recovery/, "stale recovery does not overwrite newer bytes");

  writeConfig(home, driftedConfig(sourceRoot));
  const statusFailurePreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  const statusFailure = applyRepair(statusFailurePreview, options(home, runtime, {
    statusCheck: () => ({ marketplaceStatus: "error", pluginStatus: "error", runtimeProbeStatus: "missing", runtimeHealth: "error" })
  }));
  assert.equal(statusFailure.status, "partial", "repair cannot report succeeded when post-write Runtime status fails");
  assert.equal(statusFailure.runtimeStatus.errorCode, "runtime_status_not_aligned");
  recoverRepair(statusFailure.repairId, options(home, runtime));

  writeConfig(home, driftedConfig(sourceRoot));
  const rollbackConflictPreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  assert.throws(() => applyRepair(rollbackConflictPreview, options(home, runtime, {
    afterRename: () => {
      fs.appendFileSync(configFile, "\n# external-change-after-rename\n");
      throw new Error("injected post-rename conflict");
    }
  })), (error) => error instanceof ConfigIntegrityError && error.code === "manual_recovery_required");
  assert.match(fs.readFileSync(configFile, "utf8"), /external-change-after-rename/, "rollback refuses to overwrite a post-rename external change");

  writeConfig(home, driftedConfig(sourceRoot));
  const staleLockPreview = previewRepair(options(home, runtime, {
    snapshotId: snapshotResult.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  fs.mkdirSync(path.dirname(mutationLockPath), { recursive: true });
  fs.writeFileSync(mutationLockPath, `${JSON.stringify({ pid: 99999999, startedAt: "2000-01-01T00:00:00.000Z" })}\n`, { mode: 0o600 });
  const staleLockApplied = applyRepair(staleLockPreview, options(home, runtime));
  assert.equal(staleLockApplied.status, "succeeded", "dead stale mutation locks are recovered once");
  recoverRepair(staleLockApplied.repairId, options(home, runtime));

  writeConfig(home, driftedConfig(sourceRoot));
  fs.chmodSync(configFile, 0o644);
  assert.throws(() => getIntegrityStatus(options(home, runtime)), (error) => error instanceof ConfigIntegrityError && error.code === "codex_config_mode_insecure");
  fs.chmodSync(configFile, 0o600);

  const unverifiedHome = path.join(temp, "unverified-home");
  const unverifiedConfig = writeConfig(unverifiedHome, knownGoodConfig(sourceRoot));
  const unverifiedRuntime = runtimeStatus(sourceRoot, "sha256:hook-a", "stale");
  const unverifiedSnapshot = createSnapshot(options(unverifiedHome, unverifiedRuntime, { reason: "configured_unverified" }));
  assert.equal(unverifiedSnapshot.snapshot.runtimeVerified, false);
  writeConfig(unverifiedHome, driftedConfig(sourceRoot));
  const unverifiedPreview = previewRepair(options(unverifiedHome, unverifiedRuntime, {
    snapshotId: unverifiedSnapshot.snapshot.snapshotId,
    reenablePlugins: ["ravo@ravo"]
  }));
  const unverifiedHookApproval = unverifiedPreview.approvalRequired.find((entry) => entry.reason === "hook_manifest_changed_or_snapshot_unverified");
  assert.ok(unverifiedHookApproval);
  assert.match(unverifiedHookApproval.recoveryEntry, /Settings > Hooks/);
  assert.match(unverifiedHookApproval.recoveryEntry, /\/hooks/);
  assert.ok(!unverifiedPreview.managedChanges.some((entry) => entry.action === "restore" && /hooks\.state/.test(entry.section)), "configured_unverified snapshots never auto-restore Hook trust");
  assertPrivate(unverifiedConfig, 0o600);

  const conflictHome = path.join(temp, "external-conflict-home");
  writeConfig(conflictHome, knownGoodConfig(sourceRoot));
  const conflictSnapshot = createSnapshot(options(conflictHome, runtime, { reason: "external_conflict_baseline" }));
  writeConfig(conflictHome, `${driftedConfig(sourceRoot)}
[marketplaces.ponytail]
source_type = "local"
source = "/current/ponytail"

[plugins."ponytail@ponytail"]
enabled = false

[hooks.state."${PONYTAIL_HOOK_KEY}"]
trusted_hash = "current-ponytail-trust"
`);
  const conflictPreview = previewRepair(options(conflictHome, runtime, {
    snapshotId: conflictSnapshot.snapshot.snapshotId,
    selectedExternalSections: selectedExternalSections(),
    reenablePlugins: ["ravo@ravo"]
  }));
  assert.equal(conflictPreview.conflicts.length, 3);
  assert.ok(conflictPreview.conflicts.every((entry) => entry.resolution === "keep_current"));
  assert.equal(conflictPreview.externalPreservedChanges.length, 0, "selected third-party conflicts keep current values instead of replacing them");

  writeConfig(home, knownGoodConfig(sourceRoot));
  const epoch = JSON.parse(fs.readFileSync(path.join(home, ".codex", "ravo", "config-integrity", "runtime-epoch.json"), "utf8"));
  const status = getIntegrityStatus(options(home, { ...runtime, configMutationEpoch: epoch.epochId }));
  assert.equal(status.configIntegrityStatus, "healthy");
  assert.equal(status.repairRequired, false);
  assert.equal(status.selectedSnapshotId, snapshotResult.snapshot.snapshotId);
  assert.equal(JSON.stringify(status).includes("snapshot-secret"), false);

  console.log(JSON.stringify({
    status: "pass",
    checks: [
      "lossless-section-scan-multiline-boundary",
      "codex-parser-error-redaction",
      "known-good-snapshot-permissions-metadata-redaction",
      "three-way-ravo-and-selected-external-restore",
      "protected-provider-secret-mcp-project-unknown-preservation",
      "hook-manifest-change-approval-required",
      "forged-hook-trust-approval-required",
      "hook-definition-error-does-not-delete-trust",
      "unverified-snapshot-does-not-restore-hook-trust",
      "actionable-hook-trust-recovery",
      "external-registration-conflict-keeps-current",
      "stale-plan-no-write",
      "atomic-pre-rename-no-write-and-temp-cleanup",
      "concurrent-write-cas",
      "atomic-post-rename-verified-rollback",
      "stale-recovery-no-overwrite",
      "post-status-failure-is-partial",
      "rollback-conflict-preserves-external-change",
      "dead-stale-lock-recovery",
      "insecure-config-mode-rejected",
      "explicit-recovery",
      "redacted-integrity-status"
    ]
  }, null, 2));
}

main();
