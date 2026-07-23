#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  configPaths,
  saveConfig,
  validateConfig
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-config");
const {
  FORMAL_TIMEOUT_PROFILE,
  normalizeReviewConfig
} = require("../plugins/ravo/modules/ravo-review/scripts/review-config");

const repo = path.resolve(__dirname, "..");

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function semantics(result) {
  return {
    rounds: result.effectiveRounds,
    requiredModelCount: result.effectiveRequiredModelCount,
    fallbackPairs: result.effectiveFallbackPairs,
    retry: result.effectiveRetry,
    maxTokensMode: result.effectiveMaxTokensMode,
    maxTokens: result.effectiveMaxTokens,
    autoFallbackMaxTokens: result.effectiveAutoFallbackMaxTokens,
    enableReasoningParams: result.effectiveEnableReasoningParams,
    providers: result.normalized.providers.map((provider) => ({
      providerId: provider.providerId,
      label: provider.label,
      enabled: provider.enabled,
      apiMode: provider.apiMode,
      credentialConfigured: provider.credentialConfigured,
      endpointConfigured: provider.endpointConfigured,
      maxTokensMode: provider.maxTokensMode,
      maxTokens: provider.maxTokens,
      autoFallbackMaxTokens: provider.autoFallbackMaxTokens,
      enableReasoningParams: provider.enableReasoningParams,
      models: provider.models.map((model) => ({ modelId: model.modelId, enabled: model.enabled }))
    }))
  };
}

function canonicalValues(before, raw) {
  const legacyModels = typeof raw.models === "string"
    ? raw.models.split(/[,\s]+/).map((model) => model.trim()).filter(Boolean)
    : Array.isArray(raw.models) ? raw.models.map((model) => typeof model === "string" ? model : model.id).filter(Boolean) : [];
  return {
    rounds: before.effectiveRounds,
    requiredModelCount: before.effectiveRequiredModelCount,
    fallbackPairs: before.effectiveFallbackPairs,
    retry: {
      ...before.effectiveRetry,
      retryableStatusCodes: before.effectiveRetry.retryableStatusCodes.map(String)
    },
    maxTokensMode: before.effectiveMaxTokensMode,
    ...(before.effectiveMaxTokens === null ? {} : { maxTokens: before.effectiveMaxTokens }),
    autoFallbackMaxTokens: before.effectiveAutoFallbackMaxTokens,
    timeoutMs: Math.max(before.effectiveTimeoutMs, FORMAL_TIMEOUT_PROFILE.timeoutMs),
    firstEventTimeoutMs: Math.max(before.effectiveFirstEventTimeoutMs, FORMAL_TIMEOUT_PROFILE.firstEventTimeoutMs),
    firstContentTimeoutMs: Math.max(before.effectiveFirstContentTimeoutMs, FORMAL_TIMEOUT_PROFILE.firstContentTimeoutMs),
    idleTimeoutMs: Math.max(before.effectiveIdleTimeoutMs, FORMAL_TIMEOUT_PROFILE.idleTimeoutMs),
    stream: true,
    enableReasoningParams: before.effectiveEnableReasoningParams,
    providers: [{
      id: "default",
      label: "Default",
      enabled: true,
      apiMode: raw.apiMode,
      apiKey: { action: "keep" },
      models: legacyModels.map((id) => ({ id, enabled: true }))
    }]
  };
}

function main() {
  const home = os.homedir();
  const configFile = configPaths(home).review;
  const beforeRaw = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const beforeBytes = fs.readFileSync(configFile);
  const beforeStat = fs.lstatSync(configFile);
  assert.equal(beforeStat.isFile() && !beforeStat.isSymbolicLink(), true);
  const beforeMode = beforeStat.mode & 0o777;
  const before = normalizeReviewConfig(beforeRaw);
  assert.equal(before.valid, true, JSON.stringify(before.errors));
  const beforeSemantics = semantics(before);
  const beforeApiBase = beforeRaw.apiBase || beforeRaw.providers?.[0]?.apiBase || "";
  const beforeApiKey = beforeRaw.apiKey || beforeRaw.providers?.[0]?.apiKey || "";

  let action = "already_canonical";
  let backup = null;
  let migrationPreview = { required: false, confirmationRequired: false };
  if (before.configShape === "legacy_flat") {
    const values = canonicalValues(before, beforeRaw);
    const previewed = validateConfig("review", values, { home, scope: "user" });
    migrationPreview = previewed.migrationPreview;
    assert.equal(migrationPreview.required, true);
    assert.equal(migrationPreview.confirmationRequired, true);
    assert.equal(migrationPreview.semanticChecks.nonTimeoutSemanticsPreserved, true);
    assert.equal(migrationPreview.secretHandling, "keep_without_echo");
    const saved = saveConfig("review", values, { home, scope: "user" });
    action = "migrated_legacy_to_providers";
    backup = saved.backup;
  } else if (beforeMode !== 0o600) {
    const saved = saveConfig("review", {}, { home, scope: "user" });
    action = "repaired_permissions";
    backup = saved.backup;
  }

  const afterRaw = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const after = normalizeReviewConfig(afterRaw);
  assert.equal(after.valid, true, JSON.stringify(after.errors));
  assert.equal(after.configShape, "providers");
  assert.equal(after.formalEvidenceEligible, true);
  assert.deepEqual(semantics(after), beforeSemantics, "non-timeout Review semantics changed during migration");
  assert.deepEqual(after.effectiveTimeoutProfile, FORMAL_TIMEOUT_PROFILE);
  assert.equal(afterRaw.schemaVersion, "0.5.1");
  assert.ok(Array.isArray(afterRaw.providers) && afterRaw.providers.length === 1);
  for (const key of ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs", "stream"]) {
    assert.equal(afterRaw.providers[0][key], undefined, `provider-level ${key} must not persist`);
  }
  for (const key of ["apiBase", "apiMode", "apiKey", "models", "credentialConfigured", "credentialStatus"]) {
    assert.equal(afterRaw[key], undefined, `legacy root field ${key} must be removed`);
  }
  assert.equal(hash(afterRaw.providers[0].apiBase), hash(beforeApiBase));
  assert.equal(hash(afterRaw.providers[0].apiKey), hash(beforeApiKey));
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);

  const evidence = {
    schemaVersion: "0.5.1",
    evidenceType: "current_review_config_canonical_migration",
    status: "pass",
    createdAt: new Date().toISOString(),
    action,
    configPath: configFile,
    before: {
      configShape: before.configShape,
      configHash: hash(beforeBytes),
      providerCount: before.providerCount,
      modelCount: before.modelCount,
      redactedConfigFingerprint: before.redactedConfigFingerprint,
      mode: beforeMode.toString(8).padStart(4, "0")
    },
    after: {
      configShape: after.configShape,
      configHash: hash(fs.readFileSync(configFile)),
      providerCount: after.providerCount,
      modelCount: after.modelCount,
      redactedConfigFingerprint: after.redactedConfigFingerprint,
      formalEvidenceEligible: after.formalEvidenceEligible,
      effectiveTimeoutProfile: after.effectiveTimeoutProfile,
      providerLevelTimeoutFieldsAbsent: true,
      mode: (fs.statSync(configFile).mode & 0o777).toString(8).padStart(4, "0")
    },
    semanticComparison: {
      nonTimeoutSemanticsPreserved: true,
      apiBaseHashPreserved: hash(afterRaw.providers[0].apiBase) === hash(beforeApiBase),
      apiKeyHashPreserved: hash(afterRaw.providers[0].apiKey) === hash(beforeApiKey),
      controlledTimeoutChangeOnly: before.configShape === "legacy_flat"
    },
    migrationPreview,
    backup: backup ? { backupId: backup.backupId, metadataPath: backup.metadataPath, dataPath: backup.dataPath } : null,
    secretEvidence: "No API URL, API key, credential value, request body, or Authorization header is stored in this artifact."
  };
  const output = path.join(
    repo,
    "knowledge",
    ".ravo",
    "evidence",
    "v0.5.1",
    action === "migrated_legacy_to_providers" ? "m6-review-config-migration-event.json" : "m6-review-config-current-verification.json"
  );
  writeJson(output, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main();
