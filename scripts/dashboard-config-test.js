#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CONTRACT,
  ConfigError,
  configPaths,
  getConfig,
  listModules,
  restoreConfig,
  saveConfig,
  validateConfig
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-config");

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-config-home-")));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-config-workspace-")));
const reviewPluginRoot = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-review");
const corePluginRoot = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-core");
const analysisPluginRoot = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-analysis");
const userOptions = { home, scope: "user", reviewPluginRoot, corePluginRoot, analysisPluginRoot };
const workspaceOptions = { home, scope: "workspace", workspace, reviewPluginRoot, corePluginRoot, analysisPluginRoot };
const paths = configPaths({ home });

assert.ok(listModules().some((module) => module.moduleId === "review" && module.configurable));
assert.ok(listModules().some((module) => module.moduleId === "analysis" && !module.configurable));
const reviewModule = CONTRACT.modules.find((module) => module.moduleId === "review");
assert.equal(reviewModule.fields.find((field) => field.path === "maxTokensMode").default, "auto");
assert.equal(reviewModule.fields.find((field) => field.path === "autoFallbackMaxTokens").default, 48000);

const defaults = getConfig("core", userOptions);
assert.equal(defaults.status, "missing");
assert.equal(defaults.targetPath, paths.userRavo);
assert.deepEqual(defaults.sourcePrecedence, ["user", "default"]);
assert.equal(defaults.fields.find((field) => field.path === "deliveryProfile").effectiveValue, "rapid");
assert.equal(defaults.fields.some((field) => ["technicalDetailLevel", "audience"].includes(field.path)), false);
assert.equal(defaults.effectiveDeliveryProfile.profile, "rapid");
assert.equal(defaults.effectiveDeliveryProfile.profileSource, "default");

fs.mkdirSync(path.dirname(paths.userRavo), { recursive: true });
fs.writeFileSync(paths.userRavo, `${JSON.stringify({ schemaVersion: "0.4.0", unknownFutureField: { keep: true }, technicalDetailLevel: 3 }, null, 2)}\n`, { mode: 0o644 });
const ignoredLegacy = saveConfig("core", { technicalDetailLevel: 1 }, userOptions);
assert.equal(ignoredLegacy.status, "deprecated_ignored");
assert.deepEqual(ignoredLegacy.deprecatedIgnored, ["technicalDetailLevel"]);
const legacyPreview = validateConfig("core", { audience: "engineering" }, userOptions);
assert.deepEqual(legacyPreview.deprecatedIgnored, ["audience"]);
assert.equal(Object.hasOwn(legacyPreview.candidate, "audience"), false);
const savedCore = saveConfig("core", { deliveryProfile: "balanced" }, userOptions);
assert.equal(savedCore.status, "saved");
const coreFile = JSON.parse(fs.readFileSync(paths.userRavo, "utf8"));
assert.equal(coreFile.technicalDetailLevel, 3, "legacy fields remain on disk but have no effect");
assert.deepEqual(coreFile.unknownFutureField, { keep: true }, "unknown existing fields survive known-field writes");
assert.equal(fs.statSync(paths.userRavo).mode & 0o777, 0o600);
assert.ok(savedCore.backup.backupId);
const coreBackupDir = path.join(paths.backupRoot, savedCore.backup.backupId);
assert.equal(fs.statSync(coreBackupDir).mode & 0o777, 0o700);
assert.equal(fs.statSync(path.join(coreBackupDir, "config.json")).mode & 0o777, 0o600);

const beforeInvalid = fs.readFileSync(paths.userRavo);
const beforeInvalidMtime = fs.statSync(paths.userRavo).mtimeMs;
const invalidLegacy = saveConfig("core", { technicalDetailLevel: 9 }, userOptions);
assert.equal(invalidLegacy.status, "deprecated_ignored");
assert.deepEqual(fs.readFileSync(paths.userRavo), beforeInvalid);
assert.equal(fs.statSync(paths.userRavo).mtimeMs, beforeInvalidMtime);
assert.throws(() => validateConfig("core", { arbitrary: true }, userOptions), (error) => error.code === "config_validation_failed" && error.fieldErrors.some((item) => item.code === "unknown_field"));
assert.throws(() => validateConfig("core", {
  capabilityRouting: {
    tiers: [{ id: "economy", model: "luna", reasoningEffort: "medium" }, { id: "economy", model: "terra", reasoningEffort: "medium" }],
    taskRoutes: [{ taskClass: "unknown", tier: "missing" }]
  }
}, userOptions), (error) => error.code === "config_validation_failed" && error.fieldErrors.some((item) => /capabilityRouting/.test(item.path)));

const routingSaved = saveConfig("core", {
  requestRouting: { budgets: { quick_answer: { wallClockMinutes: 4, modelSteps: 2 } } }
}, userOptions);
assert.equal(routingSaved.status, "saved");
assert.equal(JSON.parse(fs.readFileSync(paths.userRavo, "utf8")).requestRouting.budgets.quick_answer.wallClockMinutes, 4);
assert.throws(() => validateConfig("core", {
  requestRouting: { budgets: { focused_diagnosis: { contextCharacters: 250001 } } }
}, userOptions), (error) => error.code === "config_validation_failed" && error.fieldErrors.some((item) => /requestRouting/.test(item.path)));

const routed = saveConfig("core", {
  deliveryProfile: "balanced",
  execution: { wallClockBudgetMinutes: 300 },
  capabilityRouting: {
    tiers: [
      { id: "economy", model: "luna", reasoningEffort: "medium" },
      { id: "standard", model: "terra", reasoningEffort: "medium" },
      { id: "advanced", model: "sol", reasoningEffort: "high" }
    ],
    taskRoutes: [{ taskClass: "routine_test", tier: "economy" }]
  }
}, userOptions);
assert.equal(routed.config.effectiveDeliveryProfile.profile, "balanced");
assert.equal(routed.config.effectiveDeliveryProfile.budgets.wallClockBudgetMinutes, 300);

const workspaceConfigPath = path.join(workspace, "knowledge", ".ravo", "config.json");
fs.mkdirSync(path.dirname(workspaceConfigPath), { recursive: true });
fs.writeFileSync(workspaceConfigPath, `${JSON.stringify({ technicalDetailLevel: 5 }, null, 2)}\n`, { mode: 0o600 });
const workspaceLegacy = saveConfig("core", { technicalDetailLevel: 1 }, workspaceOptions);
assert.equal(workspaceLegacy.status, "deprecated_ignored");
assert.equal(JSON.parse(fs.readFileSync(workspaceConfigPath, "utf8")).technicalDetailLevel, 5);
assert.equal(JSON.parse(fs.readFileSync(paths.userRavo, "utf8")).technicalDetailLevel, 3, "workspace no-op does not change user config");
const workspaceProfile = saveConfig("core", { deliveryProfile: "strict" }, workspaceOptions);
assert.equal(workspaceProfile.config.targetPath, workspaceConfigPath);
assert.deepEqual(workspaceProfile.config.sourcePrecedence, ["workspace", "user", "default"]);
assert.equal(workspaceProfile.config.fields.some((field) => field.path === "technicalDetailLevel"), false);
assert.equal(workspaceProfile.config.effectiveDeliveryProfile.profile, "strict");
assert.equal(workspaceProfile.config.effectiveDeliveryProfile.profileSource, "workspace");

const fixtureCredential = ["sk", "secret", "never", "return"].join("-");
const unknownFixtureCredential = ["unknown", "secret", "never", "return"].join("-");
fs.writeFileSync(paths.review, `${JSON.stringify({
  apiBase: "https://api.example.test/v1/responses?token=private",
  apiMode: "responses",
  apiKey: fixtureCredential,
  models: "model-a,model-b",
  maxTokens: 7777,
  rounds: 2,
  futureCredential: unknownFixtureCredential
}, null, 2)}\n`, { mode: 0o600 });
const originalReview = fs.readFileSync(paths.review);
const reviewView = getConfig("review", userOptions);
assert.equal(reviewView.configShape, "legacy_flat");
assert.equal(reviewView.targetPath, paths.review);
assert.deepEqual(reviewView.sourcePrecedence, ["user", "default"]);
assert.equal(reviewView.migrationStatus, "available");
assert.equal(reviewView.values.legacyProvider.apiKey.configured, true);
assert.equal(reviewView.values.legacyProvider.apiBase.includes("token="), false);
assert.equal(JSON.stringify(reviewView).includes(fixtureCredential), false);
assert.equal(JSON.stringify(reviewView).includes(unknownFixtureCredential), false, "unknown config fields are preserved on disk but never projected through the API view");

const savedReview = saveConfig("review", { rounds: 3 }, userOptions);
assert.equal(JSON.parse(fs.readFileSync(paths.review, "utf8")).apiKey, fixtureCredential, "known non-secret patch preserves existing credential");
assert.equal(JSON.parse(fs.readFileSync(paths.review, "utf8")).maxTokens, 7777, "legacy numeric fixed budget survives unrelated writes");
assert.equal(JSON.stringify(savedReview).includes(fixtureCredential), false);
const legacyBackupId = savedReview.backup.backupId;
const legacyForMigration = JSON.parse(fs.readFileSync(paths.review, "utf8"));
Object.assign(legacyForMigration, {
  timeoutMs: 60000,
  firstEventTimeoutMs: 30000,
  firstContentTimeoutMs: 0,
  idleTimeoutMs: 60000,
  stream: false
});
fs.writeFileSync(paths.review, `${JSON.stringify(legacyForMigration, null, 2)}\n`, { mode: 0o600 });

const migrated = saveConfig("review", {
  requiredModelCount: 2,
  providers: [{
    id: "default",
    label: "Primary",
    enabled: true,
    apiMode: "responses",
    apiKey: { action: "keep" },
    models: [{ id: "model-a", enabled: true }, { id: "model-b", enabled: true }]
  }]
}, userOptions);
const migratedFile = JSON.parse(fs.readFileSync(paths.review, "utf8"));
assert.ok(Array.isArray(migratedFile.providers));
assert.equal(migratedFile.providers[0].apiKey, fixtureCredential);
assert.equal(migratedFile.providers[0].apiBase.includes("token=private"), true, "legacy endpoint is preserved when migration uses keep semantics");
assert.equal(migratedFile.providers[0].maxTokens, 7777, "legacy numeric fixed budget survives provider-array migration");
assert.equal(migratedFile.providers[0].maxTokensMode, "fixed");
assert.equal(migratedFile.timeoutMs, 900000);
assert.equal(migratedFile.firstEventTimeoutMs, 120000);
assert.equal(migratedFile.firstContentTimeoutMs, 300000);
assert.equal(migratedFile.idleTimeoutMs, 180000);
assert.equal(migratedFile.stream, true);
for (const key of ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs", "stream"]) {
  assert.equal(migratedFile.providers[0][key], undefined, `canonical provider must not persist ${key}`);
}
assert.equal(migratedFile.schemaVersion, "0.5.1");
assert.equal(migrated.config.configShape, "providers");

const oldCanonicalProfile = JSON.parse(JSON.stringify(migratedFile));
Object.assign(oldCanonicalProfile, {
  timeoutMs: 60000,
  firstEventTimeoutMs: 30000,
  firstContentTimeoutMs: 0,
  idleTimeoutMs: 60000,
  stream: false
});
oldCanonicalProfile.providers[0].timeoutMs = 61000;
oldCanonicalProfile.providers[0].stream = false;
fs.writeFileSync(paths.review, `${JSON.stringify(oldCanonicalProfile, null, 2)}\n`, { mode: 0o600 });
const canonicalMigrated = saveConfig("review", { rounds: 2 }, userOptions);
const canonicalMigratedFile = JSON.parse(fs.readFileSync(paths.review, "utf8"));
assert.equal(canonicalMigrated.config.configShape, "providers");
assert.equal(canonicalMigratedFile.timeoutMs, 900000);
assert.equal(canonicalMigratedFile.firstEventTimeoutMs, 120000);
assert.equal(canonicalMigratedFile.firstContentTimeoutMs, 300000);
assert.equal(canonicalMigratedFile.idleTimeoutMs, 180000);
assert.equal(canonicalMigratedFile.stream, true);
for (const key of ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs", "stream"]) {
  assert.equal(canonicalMigratedFile.providers[0][key], undefined, `old canonical provider override ${key} must migrate to the root profile`);
}
const beforeRejectedProviderTimeout = fs.readFileSync(paths.review);
assert.throws(() => saveConfig("review", {
  providers: [{ id: "default", timeoutMs: 1_000_000, apiKey: { action: "keep" } }]
}, userOptions), (error) => error.code === "config_validation_failed" && error.fieldErrors.some((item) => item.code === "provider_timeout_override_forbidden"));
assert.deepEqual(fs.readFileSync(paths.review), beforeRejectedProviderTimeout);

const providerUnknownCredential = ["provider", "unknown", "secret"].join("-");
canonicalMigratedFile.providers[0].futureCredential = providerUnknownCredential;
fs.writeFileSync(paths.review, `${JSON.stringify(canonicalMigratedFile, null, 2)}\n`, { mode: 0o600 });
assert.equal(JSON.stringify(getConfig("review", userOptions)).includes(providerUnknownCredential), false);

const replacement = "live-credential-value";
const replaced = saveConfig("review", {
  providers: [{ id: "default", apiKey: { action: "replace", value: replacement } }]
}, userOptions);
assert.equal(JSON.parse(fs.readFileSync(paths.review, "utf8")).providers[0].apiKey, replacement);
assert.equal(JSON.parse(fs.readFileSync(paths.review, "utf8")).providers[0].futureCredential, providerUnknownCredential, "unknown provider fields survive known-field writes");
assert.equal(JSON.stringify(replaced).includes(replacement), false);

saveConfig("review", {
  providers: [{ id: "default", enabled: false, apiKey: { action: "clear" } }]
}, userOptions);
assert.equal(JSON.parse(fs.readFileSync(paths.review, "utf8")).providers[0].apiKey, "");

const restored = restoreConfig("review", legacyBackupId, userOptions);
assert.equal(restored.status, "restored");
assert.deepEqual(fs.readFileSync(paths.review), originalReview, "restore returns exact prior bytes");
assert.ok(restored.preRestoreBackup.backupId);
assert.throws(() => restoreConfig("core", legacyBackupId, userOptions), (error) => ["backup_scope_mismatch", "backup_not_found"].includes(error.code));
assert.throws(() => restoreConfig("review", "../../escape", userOptions), (error) => error.code === "invalid_backup_id");

fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
fs.writeFileSync(paths.lockPath, "busy", { mode: 0o600 });
assert.throws(() => saveConfig("core", { deliveryProfile: "rapid" }, userOptions), (error) => error.code === "operation_in_progress" && error.status === 409);
fs.unlinkSync(paths.lockPath);

const previousOverride = process.env.RAVO_REVIEW_CONFIG;
process.env.RAVO_REVIEW_CONFIG = "/tmp/ignored-runtime-override.json";
assert.equal(getConfig("review", userOptions).runtimeOverride, "present");
if (previousOverride === undefined) delete process.env.RAVO_REVIEW_CONFIG;
else process.env.RAVO_REVIEW_CONFIG = previousOverride;

assert.throws(() => saveConfig("analysis", {}, userOptions), (error) => error.code === "no_configurable_fields");

console.log(JSON.stringify({
  status: "pass",
  home,
  workspace,
  checks: [
    "contract-defaults",
    "target-path-source-precedence",
    "unknown-field-preservation",
    "atomic-permissions-backup",
    "invalid-no-write",
    "delivery-profile-routing-validation",
    "request-routing-budget-validation",
    "workspace-scope",
    "secret-redaction-actions",
    "legacy-provider-migration",
    "canonical-timeout-profile-migration",
    "provider-timeout-persistence-rejected",
    "restore-scope-integrity",
    "mutation-lock",
    "runtime-override-warning",
    "no-configurable-fields"
  ]
}, null, 2));
