#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  FORMAL_TIMEOUT_PROFILE,
  normalizeReviewConfig,
  providerModelKey,
  validateReviewConfig
} = require("../plugins/ravo/modules/ravo-review/scripts/review-config");

const secret = ["sk", "secret", "must", "not", "leak"].join("-");
const legacy = normalizeReviewConfig({
  apiBase: "https://api.example.com/v1/responses?token=hidden&tenant=private",
  apiMode: "responses",
  apiKey: secret,
  models: "shared-model, second-model",
  rounds: 2
});

assert.equal(legacy.valid, true);
assert.equal(legacy.configShape, "legacy_flat");
assert.equal(legacy.migrationStatus, "available");
assert.equal(legacy.providerCount, 1);
assert.equal(legacy.modelCount, 2);
assert.equal(legacy.normalized.providers[0].providerId, "default");
assert.equal(legacy.normalized.providers[0].models[0].modelId, "shared-model");
assert.equal(legacy.normalized.providers[0].models[1].modelId, "second-model");
assert.equal(legacy.normalized.providers[0].credentialConfigured, true);
assert.equal(legacy.normalized.providers[0].endpointConfigured, true);
assert.equal(legacy.effectiveMaxTokensMode, "auto");
assert.equal(legacy.effectiveMaxTokens, null);
assert.equal(legacy.effectiveAutoFallbackMaxTokens, 48000);
assert.deepEqual(legacy.effectiveTimeoutProfile, FORMAL_TIMEOUT_PROFILE);
assert.equal(legacy.runClass, "formal");
assert.equal(legacy.formalEvidenceEligible, true);
assert.equal(legacy.normalized.providers[0].maxTokensMode, "auto");
assert.equal(legacy.normalized.providers[0].maxTokens, null);
assert.equal(JSON.stringify(legacy).includes(secret), false);
assert.equal(JSON.stringify(legacy).includes("tenant=private"), false);

const legacyFixed = normalizeReviewConfig({
  apiBase: "https://api.example.com/v1/responses",
  apiMode: "responses",
  apiKey: secret,
  models: ["model-a"],
  maxTokens: 32000
});
assert.equal(legacyFixed.valid, true);
assert.equal(legacyFixed.effectiveMaxTokensMode, "fixed");
assert.equal(legacyFixed.effectiveMaxTokens, 32000);
assert.equal(legacyFixed.normalized.providers[0].maxTokensMode, "fixed");
assert.equal(legacyFixed.normalized.providers[0].maxTokens, 32000);

const explicitAuto = normalizeReviewConfig({
  apiMode: "fake",
  apiBase: "fake://review",
  models: ["model-a"],
  maxTokensMode: "auto",
  maxTokens: 32000,
  autoFallbackMaxTokens: 0
});
assert.equal(explicitAuto.valid, true);
assert.equal(explicitAuto.effectiveMaxTokensMode, "auto");
assert.equal(explicitAuto.effectiveMaxTokens, null);
assert.equal(explicitAuto.effectiveAutoFallbackMaxTokens, 0);

const cliAuto = normalizeReviewConfig({
  apiMode: "fake",
  apiBase: "fake://review",
  models: ["model-a"],
  maxTokens: 32000
}, { maxTokens: "auto" });
assert.equal(cliAuto.valid, true);
assert.equal(cliAuto.effectiveMaxTokensMode, "auto");
assert.equal(cliAuto.effectiveMaxTokens, null);

const providerBudgets = normalizeReviewConfig({
  maxTokensMode: "auto",
  autoFallbackMaxTokens: 48000,
  providers: [
    { id: "provider-a", apiMode: "fake", apiBase: "fake://a", maxTokens: 1234, models: ["model-a"] },
    { id: "provider-b", apiMode: "fake", apiBase: "fake://b", maxTokensMode: "auto", maxTokens: 9999, autoFallbackMaxTokens: 0, models: ["model-b"] }
  ]
});
assert.equal(providerBudgets.valid, true);
assert.equal(providerBudgets.normalized.providers[0].maxTokensMode, "fixed");
assert.equal(providerBudgets.normalized.providers[0].maxTokens, 1234);
assert.equal(providerBudgets.normalized.providers[1].maxTokensMode, "auto");
assert.equal(providerBudgets.normalized.providers[1].maxTokens, null);
assert.equal(providerBudgets.normalized.providers[1].autoFallbackMaxTokens, 0);

const multiple = validateReviewConfig({
  providers: [
    {
      id: "provider-a",
      enabled: true,
      apiMode: "fake",
      apiBase: "fake://review",
      models: [{ id: "same-model", enabled: true }]
    },
    {
      id: "provider-b",
      enabled: true,
      apiMode: "fake",
      apiBase: "fake://review",
      models: [{ id: "same-model", enabled: true }]
    }
  ]
}, {
  rounds: "3",
  timeoutMs: "120000",
  maxTokens: "64000",
  firstEventTimeoutMs: "25000",
  firstContentTimeoutMs: "15000",
  idleTimeoutMs: "45000",
  enableReasoningParams: true,
  noStream: true,
  runClass: "diagnostic",
  retry: { maxAttempts: "3", baseDelayMs: "500", maxDelayMs: "2000" }
});

assert.equal(multiple.valid, true);
assert.equal(multiple.providerCount, 2);
assert.equal(multiple.modelCount, 2);
assert.equal(multiple.effectiveRounds, 3);
assert.equal(multiple.effectiveTimeoutMs, 120000);
assert.equal(multiple.effectiveMaxTokens, 64000);
assert.equal(multiple.effectiveMaxTokensMode, "fixed");
assert.equal(multiple.effectiveFirstEventTimeoutMs, 25000);
assert.equal(multiple.effectiveFirstContentTimeoutMs, 15000);
assert.equal(multiple.effectiveIdleTimeoutMs, 45000);
assert.equal(multiple.effectiveEnableReasoningParams, true);
assert.equal(multiple.effectiveStream, false);
assert.equal(multiple.runClass, "diagnostic");
assert.equal(multiple.formalEvidenceEligible, false);
assert.equal(multiple.effectiveRetry.maxAttempts, 3);
assert.deepEqual(
  multiple.normalized.providers.map((provider) => provider.models[0].providerModelKey),
  ["provider-a/same-model", "provider-b/same-model"]
);
assert.equal(providerModelKey("provider-a", "same-model"), "provider-a/same-model");

const formalIncrease = normalizeReviewConfig({
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["model-a"] }]
}, {
  runClass: "formal",
  timeoutMs: "1000000",
  firstEventTimeoutMs: "130000",
  firstContentTimeoutMs: "310000",
  idleTimeoutMs: "190000"
});
assert.equal(formalIncrease.valid, true);
assert.equal(formalIncrease.formalEvidenceEligible, true);
assert.equal(formalIncrease.effectiveTimeoutProfile.timeoutMs, 1000000);

const shortFormal = normalizeReviewConfig({
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["model-a"] }]
}, { runClass: "formal", timeoutMs: "60000", noStream: true });
assert.equal(shortFormal.valid, false);
assert.equal(shortFormal.formalEvidenceEligible, false);
assert.ok(shortFormal.errors.some((item) => item.code === "invalid_formal_timeout_profile"));
assert.ok(shortFormal.errors.some((item) => item.code === "formal_timeout_override_may_not_decrease"));

const providerTimeoutFormal = normalizeReviewConfig({
  providers: [{
    id: "provider-a",
    apiMode: "fake",
    apiBase: "fake://review",
    timeoutMs: FORMAL_TIMEOUT_PROFILE.timeoutMs,
    models: ["model-a"]
  }]
});
assert.equal(providerTimeoutFormal.valid, false);
assert.ok(providerTimeoutFormal.errors.some((item) => item.code === "provider_timeout_override_not_formal"));
const providerTimeoutDiagnostic = normalizeReviewConfig({
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", timeoutMs: 50, stream: false, models: ["model-a"] }]
}, { runClass: "diagnostic" });
assert.equal(providerTimeoutDiagnostic.valid, true);
assert.equal(providerTimeoutDiagnostic.formalEvidenceEligible, false);

const fallback = normalizeReviewConfig({
  requiredModelCount: 1,
  fallbackPairs: ["provider-a/model-b"],
  providers: [{
    id: "provider-a",
    apiMode: "fake",
    apiBase: "fake://review",
    models: ["model-a", "model-b"]
  }]
});
assert.equal(fallback.valid, true);
assert.deepEqual(fallback.effectiveFallbackPairs, ["provider-a/model-b"]);
assert.equal(fallback.effectiveRequiredModelCount, 1);
assert.deepEqual(fallback.normalized.fallbackPairs, ["provider-a/model-b"]);

const invalidFallback = normalizeReviewConfig({
  fallbackPairs: ["shared-model"],
  providers: [
    { id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["shared-model"] },
    { id: "provider-b", apiMode: "fake", apiBase: "fake://review", models: ["shared-model"] }
  ]
});
assert.equal(invalidFallback.valid, false);
assert.ok(invalidFallback.errors.some((item) => item.code === "ambiguous_model_id"));

const allFallback = normalizeReviewConfig({
  fallbackPairs: ["provider-a/model-a"],
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["model-a"] }]
});
assert.equal(allFallback.valid, false);
assert.ok(allFallback.errors.some((item) => item.code === "no_primary_models"));

const duplicates = normalizeReviewConfig({
  providers: [
    {
      id: "duplicate",
      apiMode: "fake",
      apiBase: "fake://review",
      models: ["model-a", "model-a"]
    },
    {
      id: "duplicate",
      apiMode: "fake",
      apiBase: "fake://review",
      models: ["model-b"]
    }
  ]
});

assert.equal(duplicates.valid, false);
assert.ok(duplicates.errors.some((item) => item.code === "duplicate_provider_id"));
assert.ok(duplicates.errors.some((item) => item.code === "duplicate_model_id"));

const invalid = normalizeReviewConfig({
  rounds: 4,
  timeoutMs: 0,
  maxTokens: -1,
  stream: "yes",
  retry: { maxAttempts: 0, baseDelayMs: 9000, maxDelayMs: 1000, retryableStatusCodes: [99] },
  providers: [{ id: "provider-a", enabled: true, apiMode: "responses", models: [] }]
}, { apiKey: ["override", "secret"].join("-") });

assert.equal(invalid.valid, false);
for (const code of ["out_of_range", "invalid_type", "invalid_range", "invalid_status_codes", "forbidden_override", "endpoint_not_configured", "credential_not_configured", "no_enabled_models"]) {
  assert.ok(invalid.errors.some((item) => item.code === code), `missing ${code}`);
}
assert.equal(JSON.stringify(invalid).includes("override-secret"), false);

const missingFixedValue = normalizeReviewConfig({
  maxTokensMode: "fixed",
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["model-a"] }]
});
assert.equal(missingFixedValue.valid, false);
assert.ok(missingFixedValue.errors.some((item) => item.path === "maxTokens" && item.code === "required"));

const invalidBudgetMode = normalizeReviewConfig({
  maxTokensMode: "unbounded",
  autoFallbackMaxTokens: -1,
  providers: [{ id: "provider-a", apiMode: "fake", apiBase: "fake://review", models: ["model-a"] }]
});
assert.equal(invalidBudgetMode.valid, false);
assert.ok(invalidBudgetMode.errors.some((item) => item.path === "maxTokensMode" && item.code === "invalid_enum"));
assert.ok(invalidBudgetMode.errors.some((item) => item.path === "autoFallbackMaxTokens" && item.code === "out_of_range"));

const missingProviderFields = normalizeReviewConfig({
  providers: [{ id: "provider-a", apiBase: "https://api.example.com", apiKey: secret, models: [] }]
});
assert.equal(missingProviderFields.valid, false);
assert.ok(missingProviderFields.errors.some((item) => item.path === "providers[0].apiMode" && item.code === "required"));
assert.ok(missingProviderFields.errors.some((item) => item.code === "no_enabled_models"));
assert.equal(normalizeReviewConfig({ providers: [] }).valid, false);

const rotatedSecret = normalizeReviewConfig({
  apiBase: "https://api.example.com/v1/responses?token=different",
  apiMode: "responses",
  apiKey: "sk-rotated",
  models: "shared-model, second-model",
  rounds: 2
});
assert.equal(rotatedSecret.redactedConfigFingerprint, legacy.redactedConfigFingerprint);

const changedEndpoint = normalizeReviewConfig({
  apiBase: "https://other.example.com/v1/responses?token=hidden",
  apiMode: "responses",
  apiKey: secret,
  models: "shared-model, second-model",
  rounds: 2
});
assert.notEqual(changedEndpoint.redactedConfigFingerprint, legacy.redactedConfigFingerprint);

const cli = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-review", "scripts", "review-config-cli.js");
const cliResult = JSON.parse(execFileSync(process.execPath, [cli, "--validate"], {
  input: JSON.stringify({ apiMode: "fake", apiBase: "fake://review", apiKey: secret, models: ["model-a"] }),
  encoding: "utf8"
}));
assert.equal(cliResult.valid, true);
assert.equal(JSON.stringify(cliResult).includes(secret), false, "stdin validation never returns the credential");

console.log("review config tests passed");
