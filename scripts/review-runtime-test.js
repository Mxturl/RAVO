#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const runner = process.env.RAVO_REVIEW_RUNNER
  ? path.resolve(process.env.RAVO_REVIEW_RUNNER)
  : path.join(repo, "plugins/ravo/modules/ravo-review/scripts/run-review.js");
const manualWriter = path.join(repo, "plugins/ravo/modules/ravo-review/scripts/write-review-artifact.js");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-runtime-")));
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-configs-"));
const httpFixture = path.join(repo, "scripts", "review-http-fixture.js");

function writeConfig(name, value) {
  const file = path.join(configDir, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function run(config, args = []) {
  const diagnostic = args.includes("--run-class") && args[args.indexOf("--run-class") + 1] === "diagnostic";
  const diagnosticArgs = diagnostic ? ["--diagnostic-reason", "implementation_debug", "--model", "fixture-model"] : [];
  const output = execFileSync(process.execPath, [
    runner,
    "--workspace", workspace,
    "--config", config,
    "--subject-ref", "review-runtime-subject",
    "--subject-version", "review-runtime-fixture-v1",
    "--governance-path", "governed_change",
    "--trigger-reason", "user_explicit_formal_review",
    "--trigger-source-ref", "conversation:review-runtime#formal-fixture",
    "--decision-impact", "Verify the formal Review runner contract in a controlled fixture.",
    "--subject", "Review a generic evidence-integrity contract.",
    ...args,
    ...diagnosticArgs
  ], { cwd: workspace, encoding: "utf8" });
  return JSON.parse(output);
}

const twoProviderConfig = writeConfig("two-provider", {
  schemaVersion: "0.5.0",
  rounds: 2,
  retry: { maxAttempts: 2, baseDelayMs: 40, maxDelayMs: 80, retryableStatusCodes: [429, 502, 503, 504] },
  providers: [
    { id: "provider-a", enabled: true, apiMode: "fake", apiBase: "fake://a", models: [{ id: "fake-a", enabled: true }] },
    { id: "provider-b", enabled: true, apiMode: "fake", apiBase: "fake://b", models: [{ id: "fake-b", enabled: true }] }
  ]
});

const preview = run(twoProviderConfig, ["--preview"]);
assert.equal(preview.status, "ok");
assert.deepEqual(preview.callPlan.requestedPairs, ["provider-a/fake-a", "provider-b/fake-b"]);
assert.equal(preview.callPlan.rounds, 2);
assert.equal(preview.callPlan.maxAttempts, 2);
assert.equal(preview.callPlan.maximumRequests, 8);
assert.equal(preview.callPlan.runClass, "formal");
assert.equal(preview.callPlan.formalEvidenceEligible, true);
assert.ok(preview.callPlan.timeoutProfiles.every((entry) => entry.effective.timeoutMs === 900000
  && entry.effective.firstEventTimeoutMs === 120000
  && entry.effective.firstContentTimeoutMs === 300000
  && entry.effective.idleTimeoutMs === 180000
  && entry.effective.stream === true));
assert.ok(preview.callPlan.maximumRunMs >= preview.callPlan.maximumRequests * 900000);
assert.ok(preview.callPlan.outputBudgets.every((budget) => budget.maxTokensMode === "auto" && budget.requestedMaxTokens === null));
assert.equal(JSON.stringify(preview).includes("apiKey"), false);
assert.equal(JSON.stringify(preview).includes("fake://"), false);

const full = run(twoProviderConfig);
assert.equal(full.workflowCoverage, "full");
assert.equal(full.validResults, true);
assert.equal(full.parserStatus, "pass");
assert.deepEqual(full.modelsUsable.sort(), ["provider-a/fake-a", "provider-b/fake-b"]);
assert.ok(full.ledgerFindingCount >= 2);
const fullArtifact = JSON.parse(fs.readFileSync(full.artifactPath, "utf8"));
assert.equal(fullArtifact.coverage, fullArtifact.workflowCoverage);
assert.equal(fullArtifact.validResults, true);
assert.equal(fullArtifact.modelsResponded.length, 2);
assert.equal(fullArtifact.modelsUsable.length, 2);
assert.equal(fullArtifact.dataBoundary.decision, "safe_sanitized");
assert.equal(fullArtifact.dataBoundary.externalCallAllowed, true);
assert.equal(fullArtifact.config.counts.enabledProviderCount, 2);
assert.equal(fullArtifact.runClass, "formal");
assert.equal(fullArtifact.formalEvidenceEligible, true);
assert.equal(Object.hasOwn(fullArtifact, "technicalDetailLevel"), false);
assert.equal(Object.hasOwn(fullArtifact, "summaryMode"), false);
assert.ok(fullArtifact.attempts.every((attempt) => attempt.providerModelKey.includes("/")));
assert.ok(fullArtifact.attempts.every((attempt) => attempt.reviewRunId === full.reviewRunId));
assert.ok(fs.existsSync(path.join(workspace, fullArtifact.issueLedgerRef)));
const ledger = JSON.parse(fs.readFileSync(path.join(workspace, fullArtifact.issueLedgerRef), "utf8"));
assert.equal(ledger.rawFindingCount, fullArtifact.rawFindingCount);
assert.equal(ledger.ledgerFindingCount, fullArtifact.ledgerFindingCount);
assert.equal(JSON.stringify(ledger).includes("evidence may be incomplete"), false);

const partialConfig = writeConfig("partial", {
  rounds: 1,
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  providers: [
    { id: "provider-a", enabled: true, apiMode: "fake", apiBase: "fake://a", models: ["fake-a"] },
    { id: "provider-b", enabled: true, apiMode: "fake", apiBase: "fake://b", models: ["fake-error"] }
  ]
});
const partial = run(partialConfig);
assert.equal(partial.workflowCoverage, "partial");
assert.deepEqual(partial.modelsUsable, ["provider-a/fake-a"]);
assert.ok(partial.modelsFailed.includes("provider-b/fake-error"));

for (const model of ["fake-empty", "fake-reasoning", "fake-trunc", "fake-schema"]) {
  const config = writeConfig(model, {
    rounds: 1,
    retry: { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 5 },
    apiMode: "fake",
    apiBase: "fake://semantic",
    models: [model]
  });
  const result = run(config);
  assert.equal(result.workflowCoverage, "none", model);
  assert.equal(result.modelsUsable.length, 0, model);
  const expectedAttemptType = model === "fake-trunc" ? "output_budget_fallback" : "semantic_retry";
  assert.ok(result.attempts.some((attempt) => attempt.attemptType === expectedAttemptType), model);
}

const semanticRetryConfig = writeConfig("semantic-retry", {
  rounds: 1,
  retry: { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 50 },
  apiMode: "fake",
  apiBase: "fake://semantic",
  models: ["fake-schema-once"]
});
const semanticRetry = run(semanticRetryConfig);
assert.equal(semanticRetry.workflowCoverage, "full");
const semanticInitial = semanticRetry.attempts.find((attempt) => attempt.result === "responded_unusable");
assert.ok(semanticInitial);
assert.ok(semanticInitial.actualDelayMs >= Math.max(0, semanticInitial.plannedDelayMs - 25));
assert.ok(semanticRetry.attempts.some((attempt) => attempt.attemptType === "semantic_retry" && attempt.result === "usable"));

const semanticAuditConfig = writeConfig("semantic-audit", {
  rounds: 1,
  retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
  apiMode: "fake",
  apiBase: "fake://semantic",
  models: ["fake-invalid-finding-once"]
});
const semanticAudit = run(semanticAuditConfig);
assert.equal(semanticAudit.workflowCoverage, "full");
assert.equal(semanticAudit.parserStatus, "pass");
assert.equal(semanticAudit.rawFindingCount, 2, "all raw findings remain countable across semantic retry");
assert.equal(semanticAudit.ledgerFindingCount, 1);
assert.ok(semanticAudit.attempts[0].parserErrors.length > 0);

const transportRetryConfig = writeConfig("transport-retry", {
  rounds: 1,
  retry: { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 50, retryableStatusCodes: [429] },
  apiMode: "fake",
  apiBase: "fake://transport",
  models: ["fake-429-once"]
});
const transportRetry = run(transportRetryConfig);
assert.equal(transportRetry.workflowCoverage, "full");
const retrying = transportRetry.attempts.find((attempt) => attempt.result === "retrying");
assert.equal(retrying.attemptType, "initial");
assert.ok(retrying.actualDelayMs >= Math.max(0, retrying.plannedDelayMs - 25));
assert.ok(transportRetry.attempts.some((attempt) => attempt.attemptType === "transport_retry" && attempt.result === "usable"));

const laterRoundFailureConfig = writeConfig("later-round-failure", {
  rounds: 3,
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  apiMode: "fake",
  apiBase: "fake://rounds",
  models: ["fake-round2-timeout"]
});
const laterRoundFailure = run(laterRoundFailureConfig);
assert.equal(laterRoundFailure.workflowCoverage, "partial");
assert.equal(laterRoundFailure.validResults, true);
assert.equal(laterRoundFailure.challengeStatus, "incomplete");
assert.equal(laterRoundFailure.convergenceStatus, "incomplete");
assert.equal(laterRoundFailure.roundsExecuted, 2);
assert.equal(laterRoundFailure.roundStopReason, "round3_no_usable_models");
const laterRoundArtifact = JSON.parse(fs.readFileSync(laterRoundFailure.artifactPath, "utf8"));
assert.equal(laterRoundArtifact.validResults, true);
assert.equal(laterRoundArtifact.workflowCoverage, "partial");

const fallbackConfig = writeConfig("fallback", {
  rounds: 1,
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  fallbackPairs: ["provider-a/fake-good"],
  providers: [{
    id: "provider-a",
    enabled: true,
    apiMode: "fake",
    apiBase: "fake://fallback",
    models: ["fake-error", "fake-good"]
  }]
});
const fallbackPreview = run(fallbackConfig, ["--preview"]);
assert.deepEqual(fallbackPreview.callPlan.requestedPairs, ["provider-a/fake-error"]);
assert.deepEqual(fallbackPreview.callPlan.fallbackPairs, ["provider-a/fake-good"]);
assert.equal(fallbackPreview.callPlan.maximumRequests, 2);
const fallback = run(fallbackConfig);
assert.equal(fallback.workflowCoverage, "partial");
assert.ok(fallback.modelsUsable.includes("provider-a/fake-good"));
assert.ok(fallback.attempts.some((attempt) => attempt.attemptType === "model_fallback"));

const sensitive = run(twoProviderConfig, [
  "--data-boundary", "sensitive_requires_consent",
  "--authorization-source", "none"
]);
assert.equal(sensitive.workflowCoverage, "none");
assert.equal(sensitive.attempts.length, 0);
const sensitiveArtifact = JSON.parse(fs.readFileSync(sensitive.artifactPath, "utf8"));
assert.equal(sensitiveArtifact.dataBoundary.externalCallAllowed, false);

const consented = run(twoProviderConfig, [
  "--data-boundary", "sensitive_requires_consent",
  "--authorization-source", "conversation_confirmation",
  "--confirm-sensitive"
]);
assert.equal(consented.workflowCoverage, "full");

const prohibitedToken = ["sk", "secret", "value"].join("-");
const prohibited = execFileSync(process.execPath, [
  runner,
  "--workspace", workspace,
  "--config", twoProviderConfig,
  "--subject-ref", "prohibited-subject",
  "--subject-version", "review-runtime-fixture-v1",
  "--governance-path", "governed_change",
  "--trigger-reason", "user_explicit_formal_review",
  "--trigger-source-ref", "conversation:review-runtime#prohibited-fixture",
  "--decision-impact", "Verify data-boundary denial in a controlled formal Review fixture.",
  "--subject", `Authorization: Bearer ${prohibitedToken} CANARY_CUSTOMER_42`,
  "--data-boundary", "safe_sanitized",
  "--authorization-source", "explicit_user_action",
  "--confirm-sensitive"
], { cwd: workspace, encoding: "utf8" });
const prohibitedResult = JSON.parse(prohibited);
assert.equal(prohibitedResult.workflowCoverage, "none");
assert.equal(prohibitedResult.attempts.length, 0);
const prohibitedArtifact = JSON.parse(fs.readFileSync(prohibitedResult.artifactPath, "utf8"));
assert.equal(prohibitedArtifact.dataBoundary.decision, "prohibited");
assert.equal(JSON.stringify(prohibitedArtifact).includes(prohibitedToken), false);

const providerTest = run(twoProviderConfig, ["--provider-test", "provider-a/fake-a"]);
assert.equal(providerTest.status, "pass");
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"));
assert.notEqual(manifest.modules.review.latestArtifact, path.relative(workspace, providerTest.artifactPath), "provider test does not become formal Review evidence");

const manualArtifactCount = fs.readdirSync(path.join(workspace, "knowledge/.ravo/review")).length;
const manualClaim = spawnSync(process.execPath, [
  manualWriter,
  "--workspace", workspace,
  "--subject-ref", "manual-full-claim",
  "--coverage", "full",
  "--model-usable", "provider-a/model-a",
  "--parser-status", "pass",
  "--ledger-finding-count", "1",
  "--raw-finding-count", "1"
], { cwd: workspace, encoding: "utf8" });
assert.notEqual(manualClaim.status, 0, "manual writer rejects partial/full coverage claims");
assert.equal(fs.readdirSync(path.join(workspace, "knowledge/.ravo/review")).length, manualArtifactCount, "rejected manual coverage writes no artifact");

const portFile = path.join(configDir, "fixture-port");
const fixtureStateFile = path.join(configDir, "fixture-state.json");
const fixtureProcess = spawn(process.execPath, [httpFixture, portFile, fixtureStateFile], { stdio: ["ignore", "ignore", "pipe"] });
process.on("exit", () => {
  try { fixtureProcess.kill("SIGTERM"); } catch (_error) { /* Process may already be gone. */ }
});
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
const waitStarted = Date.now();
while (!fs.existsSync(portFile) && Date.now() - waitStarted < 5000) Atomics.wait(waitBuffer, 0, 0, 20);
assert.ok(fs.existsSync(portFile), "HTTP fixture starts");
const fixtureBase = `http://127.0.0.1:${fs.readFileSync(portFile, "utf8").trim()}`;

function streamConfig(name, route, values = {}) {
  const config = {
    rounds: 1,
    retry: {
      maxAttempts: values.maxAttempts || 1,
      baseDelayMs: values.baseDelayMs ?? 0,
      maxDelayMs: values.maxDelayMs ?? (values.baseDelayMs ?? 0)
    },
    timeoutMs: values.timeoutMs ?? 900000,
    firstEventTimeoutMs: values.firstEventTimeoutMs ?? 120000,
    firstContentTimeoutMs: values.firstContentTimeoutMs ?? 300000,
    idleTimeoutMs: values.idleTimeoutMs ?? 180000,
    stream: values.stream ?? true,
    apiMode: values.apiMode || "responses",
    apiBase: `${fixtureBase}/${route}`,
    apiKey: "fixture-key",
    models: ["fixture-model"]
  };
  if (values.maxTokensMode !== undefined) config.maxTokensMode = values.maxTokensMode;
  if (values.maxTokens !== undefined) config.maxTokens = values.maxTokens;
  if (values.autoFallbackMaxTokens !== undefined) config.autoFallbackMaxTokens = values.autoFallbackMaxTokens;
  return writeConfig(name, config);
}

const autoResponses = run(streamConfig("auto-responses", "auto-responses"), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(autoResponses.workflowCoverage, "full");
assert.equal(autoResponses.attempts[0].maxTokensMode, "auto");
assert.equal(autoResponses.attempts[0].requestedMaxTokens, null);
assert.equal(autoResponses.attempts[0].tokenField, "omitted");
assert.equal(autoResponses.attempts[0].providerStatus, "completed");
assert.equal(autoResponses.attempts[0].usage.output_tokens, 20);

const fixedResponses = run(streamConfig("fixed-responses", "fixed-responses", { maxTokens: 12345 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(fixedResponses.workflowCoverage, "full");
assert.equal(fixedResponses.attempts[0].maxTokensMode, "fixed");
assert.equal(fixedResponses.attempts[0].requestedMaxTokens, 12345);
assert.equal(fixedResponses.attempts[0].tokenField, "max_output_tokens");

const cliAutoOverride = run(streamConfig("cli-auto-responses", "auto-responses", { maxTokens: 12345 }), [
  "--authorization-source", "explicit_user_action",
  "--max-tokens", "auto"
]);
assert.equal(cliAutoOverride.workflowCoverage, "full");
assert.equal(cliAutoOverride.attempts[0].requestedMaxTokens, null);

const cliFixedOverride = run(streamConfig("cli-fixed-responses", "fixed-responses"), [
  "--authorization-source", "explicit_user_action",
  "--max-tokens", "12345"
]);
assert.equal(cliFixedOverride.workflowCoverage, "full");
assert.equal(cliFixedOverride.attempts[0].requestedMaxTokens, 12345);

const autoChat = run(streamConfig("auto-chat", "auto-chat", { apiMode: "chat" }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(autoChat.workflowCoverage, "full");
assert.equal(autoChat.attempts[0].requestedMaxTokens, null);
assert.equal(autoChat.attempts[0].finishReason, "stop");
assert.equal(autoChat.attempts[0].usage.completion_tokens, 20);

const fixedChat = run(streamConfig("fixed-chat", "fixed-chat", { apiMode: "chat", maxTokensMode: "fixed", maxTokens: 12345 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(fixedChat.workflowCoverage, "full");
assert.equal(fixedChat.attempts[0].requestedMaxTokens, 12345);
assert.equal(fixedChat.attempts[0].tokenField, "max_tokens");

const truncationFallback = run(streamConfig("auto-truncation", "auto-truncation", { maxAttempts: 2 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(truncationFallback.workflowCoverage, "full");
assert.equal(truncationFallback.attempts.length, 2);
assert.equal(truncationFallback.attempts[0].providerStatus, "incomplete");
assert.equal(truncationFallback.attempts[0].incompleteReason, "provider_default_limit");
assert.match(truncationFallback.attempts[0].reason, /^output_budget_fallback:/);
assert.equal(truncationFallback.attempts[1].attemptType, "output_budget_fallback");
assert.equal(truncationFallback.attempts[1].requestedMaxTokens, 48000);
assert.equal(truncationFallback.attempts[1].result, "usable");
assert.equal(truncationFallback.callPlan.maximumRequests, 2);
assert.deepEqual(truncationFallback.attempts[1].retryParameterDelta.requestedMaxTokens, { from: null, to: 48000 });
assert.equal(truncationFallback.attempts[0].remainingAttemptBudget, 1);

const fixedLowFallback = run(streamConfig("fixed-low-truncation", "fixed-low-truncation", {
  maxAttempts: 2,
  maxTokensMode: "fixed",
  maxTokens: 64,
  autoFallbackMaxTokens: 48000
}), ["--authorization-source", "explicit_user_action"]);
assert.equal(fixedLowFallback.workflowCoverage, "full");
assert.equal(fixedLowFallback.attempts.length, 2);
assert.equal(fixedLowFallback.attempts[0].requestedMaxTokens, 64);
assert.match(fixedLowFallback.attempts[0].reason, /^output_budget_fallback:/);
assert.equal(fixedLowFallback.attempts[1].attemptType, "output_budget_fallback");
assert.deepEqual(fixedLowFallback.attempts[1].retryParameterDelta.requestedMaxTokens, { from: 64, to: 48000 });
assert.equal(fixedLowFallback.attempts[1].requestedMaxTokens, 48000);

const requiredTokenFallback = run(streamConfig("token-required", "token-required", { maxAttempts: 2 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(requiredTokenFallback.workflowCoverage, "full");
assert.equal(requiredTokenFallback.attempts[0].reason, "output_budget_fallback:provider_token_field_required");
assert.equal(requiredTokenFallback.attempts[1].attemptType, "output_budget_fallback");
assert.equal(requiredTokenFallback.attempts[1].requestedMaxTokens, 48000);

const exhaustedOutputBudget = run(streamConfig("auto-truncation-exhausted", "auto-truncation", { maxAttempts: 1 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(exhaustedOutputBudget.workflowCoverage, "none");
assert.match(exhaustedOutputBudget.attempts[0].reason, /^output_budget_fallback_budget_exhausted:/);
assert.ok(exhaustedOutputBudget.outputBudgetWarnings.some((warning) => /no attempt remained/.test(warning)));

const disabledOutputBudget = run(streamConfig("auto-truncation-disabled", "auto-truncation", { maxAttempts: 2, autoFallbackMaxTokens: 0 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(disabledOutputBudget.workflowCoverage, "none");
assert.equal(disabledOutputBudget.attempts.length, 1);
assert.match(disabledOutputBudget.attempts[0].reason, /^output_budget_fallback_disabled:/);

const largeResponse = run(streamConfig("large-response", "large-response"), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(largeResponse.workflowCoverage, "full", "live Provider responses are not rejected by the legacy 10 MiB migration cap");

const streamFallback = run(streamConfig("stream-fallback", "stream-fallback", { maxAttempts: 2 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(streamFallback.workflowCoverage, "full");
assert.ok(streamFallback.attempts.some((attempt) => attempt.reason === "stream_fallback" && attempt.result === "retrying"));
assert.ok(streamFallback.attempts.some((attempt) => attempt.attemptType === "stream_fallback" && attempt.result === "usable"));
assert.equal(streamFallback.callPlan.streamFallbackConsumesAttempt, true);
assert.equal(streamFallback.attempts.length, 2, "stream fallback uses exactly two previewed attempt slots");

const noFallbackBudget = run(streamConfig("stream-no-fallback-budget", "stream-fallback", { maxAttempts: 1 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(noFallbackBudget.workflowCoverage, "none");
assert.equal(noFallbackBudget.callPlan.maximumRequests, 1);
assert.equal(noFallbackBudget.callPlan.streamFallbackAvailable, false);
assert.equal(noFallbackBudget.attempts.length, 1);
assert.equal(noFallbackBudget.attempts[0].reason, "stream_fallback_budget_exhausted");

function fixtureCount(route) {
  const state = JSON.parse(fs.readFileSync(fixtureStateFile, "utf8"));
  const prefix = `/${route}`;
  return Object.entries(state)
    .filter(([key]) => key === prefix || key.startsWith(`${prefix}/`))
    .reduce((total, [, count]) => total + Number(count || 0), 0);
}

function artifactRef(result) {
  return path.relative(workspace, result.artifactPath);
}

function attemptTelemetry(attempt) {
  return {
    attempt: attempt.attempt,
    attemptType: attempt.attemptType,
    result: attempt.result,
    reason: attempt.reason,
    timeoutType: attempt.timeoutType || "",
    requestedMaxTokens: attempt.requestedMaxTokens,
    plannedDelayMs: attempt.plannedDelayMs,
    actualDelayMs: attempt.actualDelayMs,
    delayStartedAt: attempt.delayStartedAt || "",
    delayEndedAt: attempt.delayEndedAt || "",
    remainingAttemptBudget: attempt.remainingAttemptBudget,
    partialBytes: attempt.partialBytes || 0,
    partialResponseRef: attempt.partialResponseRef || "",
    phaseTiming: attempt.phaseTiming,
    retryParameterDelta: attempt.retryParameterDelta || {}
  };
}

const rejectedRoute = "formal-rejected-before-request";
const rejectedBefore = fixtureCount(rejectedRoute);
const rejectedFormal = run(streamConfig("formal-rejected", rejectedRoute, { timeoutMs: 60000 }), [
  "--authorization-source", "explicit_user_action"
]);
assert.equal(rejectedFormal.workflowCoverage, "none");
assert.equal(rejectedFormal.formalEvidenceEligible, false);
assert.equal(rejectedFormal.attempts.length, 0);
assert.ok(rejectedFormal.callPlan.formalEvidenceEligible === false);
assert.equal(fixtureCount(rejectedRoute), rejectedBefore, "invalid formal timeout is rejected before an external request");
const rejectedAfter = fixtureCount(rejectedRoute);

const noStreamRoute = "formal-no-stream-rejected";
const noStreamBefore = fixtureCount(noStreamRoute);
const rejectedNoStream = run(streamConfig("formal-no-stream", noStreamRoute), [
  "--authorization-source", "explicit_user_action",
  "--no-stream"
]);
assert.equal(rejectedNoStream.workflowCoverage, "none");
assert.equal(rejectedNoStream.attempts.length, 0);
assert.equal(fixtureCount(noStreamRoute), noStreamBefore, "formal --no-stream is rejected before an external request");

const diagnostic = run(streamConfig("diagnostic-no-stream", "auto-responses"), [
  "--authorization-source", "explicit_user_action",
  "--run-class", "diagnostic",
  "--no-stream",
  "--timeout-ms", "1000",
  "--first-event-timeout-ms", "100",
  "--first-content-timeout-ms", "200",
  "--idle-timeout-ms", "100"
]);
assert.equal(diagnostic.runClass, "diagnostic");
assert.equal(diagnostic.formalEvidenceEligible, false);
assert.equal(diagnostic.workflowCoverage, "none");
assert.equal(diagnostic.computedWorkflowCoverage, "full");
assert.equal(diagnostic.diagnosticExecutionCoverage, "full");

const consecutiveRetryEvidence = {};
for (const scenario of [
  { name: "transport-retry-three", semantic: false },
  { name: "semantic-retry-three", semantic: true }
]) {
  const result = run(streamConfig(scenario.name, scenario.name, {
    maxAttempts: 4,
    baseDelayMs: 20,
    maxDelayMs: 80
  }), ["--authorization-source", "explicit_user_action"]);
  assert.equal(result.workflowCoverage, "full", scenario.name);
  assert.equal(result.attempts.length, 4, scenario.name);
  assert.deepEqual(result.attempts.slice(0, 3).map((attempt) => attempt.plannedDelayMs), [20, 40, 80]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.remainingAttemptBudget), [3, 2, 1, 0]);
  for (const attempt of result.attempts.slice(0, 3)) {
    assert.ok(attempt.actualDelayMs >= Math.max(0, attempt.plannedDelayMs - 15), scenario.name);
    assert.equal(attempt.jitterPolicy, "none");
    assert.deepEqual(attempt.jitterRangeMs, { min: 0, max: 0 });
    assert.ok(attempt.delayStartedAt && attempt.delayEndedAt);
  }
  assert.ok(result.attempts.every((attempt) => attempt.phaseTiming.requestStartedAt), scenario.name);
  assert.equal(result.attempts[3].result, "usable", scenario.name);
  if (scenario.semantic) assert.ok(result.attempts.slice(1).every((attempt) => attempt.attemptType === "semantic_retry"));
  else assert.ok(result.attempts.slice(1).every((attempt) => attempt.attemptType === "transport_retry"));
  consecutiveRetryEvidence[scenario.name] = {
    artifactRef: artifactRef(result),
    attempts: result.attempts.map(attemptTelemetry)
  };
}

const stagedTimeoutEvidence = {};
for (const scenario of [
  { name: "first-event-timeout", values: { firstEventTimeoutMs: 60 } },
  { name: "first-content-timeout", values: { firstEventTimeoutMs: 100, firstContentTimeoutMs: 70, idleTimeoutMs: 100 } },
  { name: "idle-timeout", values: { firstEventTimeoutMs: 100, idleTimeoutMs: 60 } },
  { name: "heartbeat-idle-timeout", values: { firstEventTimeoutMs: 100, idleTimeoutMs: 60 } },
  { name: "total-timeout", values: { timeoutMs: 60, stream: false } }
]) {
  const result = run(streamConfig(scenario.name, scenario.name, scenario.values), [
    "--authorization-source", "explicit_user_action",
    "--run-class", "diagnostic"
  ]);
  assert.equal(result.workflowCoverage, "none", scenario.name);
  assert.equal(result.runClass, "diagnostic", scenario.name);
  const expectedReason = scenario.name === "heartbeat-idle-timeout" ? "idle_timeout" : scenario.name.replaceAll("-", "_");
  const timedOut = result.attempts.find((attempt) => attempt.reason === expectedReason);
  assert.ok(timedOut, scenario.name);
  assert.equal(timedOut.timeoutType, expectedReason);
  assert.ok(timedOut.phaseTiming.requestStartedAt);
  assert.ok(timedOut.phaseTiming.abortAt);
  if (["first-content-timeout", "idle-timeout", "heartbeat-idle-timeout"].includes(scenario.name)) {
    assert.ok(timedOut.partialBytes > 0, scenario.name);
    assert.ok(timedOut.partialResponseRef, scenario.name);
    assert.ok(fs.existsSync(path.join(workspace, timedOut.partialResponseRef)), scenario.name);
  }
  stagedTimeoutEvidence[scenario.name] = {
    artifactRef: artifactRef(result),
    timedOutAttempt: attemptTelemetry(timedOut)
  };
}

const timeoutRetryEvidence = {};
for (const scenario of [
  { name: "first-event-timeout", values: { maxAttempts: 2, firstEventTimeoutMs: 60 }, expectedRequests: 2 },
  { name: "first-content-timeout", values: { maxAttempts: 2, firstEventTimeoutMs: 100, firstContentTimeoutMs: 70, idleTimeoutMs: 100 }, expectedRequests: 2 },
  { name: "partial-idle-timeout", values: { maxAttempts: 2, firstEventTimeoutMs: 100, firstContentTimeoutMs: 100, idleTimeoutMs: 60 }, expectedRequests: 1 },
  { name: "partial-total-timeout", values: { maxAttempts: 2, timeoutMs: 250, firstEventTimeoutMs: 400, firstContentTimeoutMs: 400, idleTimeoutMs: 700 }, expectedRequests: 1 }
]) {
  const before = fixtureCount(scenario.name);
  const result = run(streamConfig(`retry-${scenario.name}`, scenario.name, scenario.values), [
    "--authorization-source", "explicit_user_action",
    "--run-class", "diagnostic"
  ]);
  const after = fixtureCount(scenario.name);
  assert.equal(after - before, scenario.expectedRequests, `${scenario.name} request count`);
  assert.equal(result.workflowCoverage, "none", scenario.name);
  const lastAttempt = result.attempts.at(-1);
  assert.ok(lastAttempt, scenario.name);
  assert.equal(lastAttempt.result, "failed", scenario.name);
  if (scenario.expectedRequests === 1) {
    assert.equal(lastAttempt.timeoutType, scenario.name.replace("partial-", "").replaceAll("-", "_"), scenario.name);
    assert.ok(lastAttempt.partialBytes > 0, scenario.name);
    assert.ok(lastAttempt.partialResponseRef, scenario.name);
  } else {
    assert.equal(result.attempts.length, 2, scenario.name);
    assert.equal(result.attempts[0].result, "retrying", scenario.name);
    assert.equal(result.attempts[1].result, "failed", scenario.name);
  }
  timeoutRetryEvidence[scenario.name] = {
    expectedRequests: scenario.expectedRequests,
    actualRequests: after - before,
    attempts: result.attempts.map(attemptTelemetry)
  };
}

const partialWithOtherModelConfig = writeConfig("partial-with-other-model", {
  rounds: 1,
  retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
  providers: [
    { id: "provider-timeout", enabled: true, apiMode: "responses", apiBase: `${fixtureBase}/partial-idle-timeout`, apiKey: "fixture-key", models: ["timeout-model"] },
    { id: "provider-good", enabled: true, apiMode: "responses", apiBase: `${fixtureBase}/auto-responses`, apiKey: "fixture-key", models: ["good-model"] }
  ],
  timeoutMs: 1000,
  firstEventTimeoutMs: 100,
  firstContentTimeoutMs: 100,
  idleTimeoutMs: 60,
  stream: true
});
const partialWithOtherModelBefore = fixtureCount("partial-idle-timeout");
const multiModelDiagnostic = spawnSync(process.execPath, [
  runner,
  "--workspace", workspace,
  "--config", partialWithOtherModelConfig,
  "--subject-ref", "review-runtime-subject",
  "--subject-version", "review-runtime-fixture-v1",
  "--subject", "Review multi-model diagnostic behavior.",
  "--authorization-source", "explicit_user_action",
  "--run-class", "diagnostic",
  "--diagnostic-reason", "implementation_debug"
], { cwd: workspace, encoding: "utf8" });
assert.equal(multiModelDiagnostic.status, 2);
assert.equal(JSON.parse(multiModelDiagnostic.stdout).reviewTriggerGate.reason, "diagnostic_requires_exactly_one_model");
assert.equal(fixtureCount("partial-idle-timeout"), partialWithOtherModelBefore, "multi-model diagnostic is rejected before any request");

fixtureProcess.kill("SIGTERM");

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: [
    "preview",
    "two-provider-full",
    "partial-provider-failure",
    "semantic-failures",
    "semantic-retry",
    "semantic-attempt-audit",
    "transport-retry",
    "later-round-partial-preservation",
    "planned-fallback",
    "auto-fixed-request-bodies",
    "output-budget-fallback",
    "output-budget-warning-states",
    "large-live-response-no-legacy-cap",
    "stream-fallback",
    "stream-fallback-budget",
    "formal-unified-timeout-profile",
    "formal-short-timeout-preflight-rejection",
    "formal-no-stream-preflight-rejection",
    "diagnostic-coverage-isolation",
    "consecutive-transport-backoff",
    "consecutive-semantic-backoff",
    "fixed-low-output-budget-fallback",
    "staged-timeout-partial-telemetry",
    "timeout-retry-phase-gating",
    "multi-model-diagnostic-rejected-before-request",
    "multi-model-diagnostic-rejected-before-request",
    "sensitive-consent",
    "prohibited-data",
    "provider-test"
  ],
  resilienceEvidence: {
    formalTimeoutProfiles: preview.callPlan.timeoutProfiles,
    formalShortTimeoutRejection: {
      artifactRef: artifactRef(rejectedFormal),
      formalEvidenceEligible: rejectedFormal.formalEvidenceEligible,
      attempts: rejectedFormal.attempts.length,
      externalRequestsBefore: rejectedBefore,
      externalRequestsAfter: rejectedAfter
    },
    formalNoStreamRejection: {
      artifactRef: artifactRef(rejectedNoStream),
      attempts: rejectedNoStream.attempts.length,
      externalRequestsBefore: noStreamBefore,
      externalRequestsAfter: fixtureCount(noStreamRoute)
    },
    diagnosticIsolation: {
      artifactRef: artifactRef(diagnostic),
      runClass: diagnostic.runClass,
      formalEvidenceEligible: diagnostic.formalEvidenceEligible,
      workflowCoverage: diagnostic.workflowCoverage,
      diagnosticExecutionCoverage: diagnostic.diagnosticExecutionCoverage
    },
    fixedLowOutputBudgetFallback: {
      artifactRef: artifactRef(fixedLowFallback),
      attempts: fixedLowFallback.attempts.map(attemptTelemetry)
    },
    consecutiveRetries: consecutiveRetryEvidence,
    stagedTimeouts: stagedTimeoutEvidence,
    timeoutRetry: timeoutRetryEvidence,
    multiModelDiagnosticRejection: {
      status: multiModelDiagnostic.status,
      reason: JSON.parse(multiModelDiagnostic.stdout).reviewTriggerGate.reason,
      externalRequestsBefore: partialWithOtherModelBefore,
      externalRequestsAfter: fixtureCount("partial-idle-timeout")
    }
  }
}, null, 2));
