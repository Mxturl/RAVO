#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  attemptFingerprint,
  evaluateAttempt,
  evaluateAuthorization,
  evaluateFastTrack,
  evaluateRecoveryWorkers,
  evaluateRules,
  normalizeWorkstream,
  planFingerprint,
  validateWorkstream
} = require("../plugins/ravo/modules/ravo-workstream/scripts/workstream-model");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ravo-v0.5.1-execution-governance.json"), "utf8"));
const NOW = "2026-07-12T00:30:00.000Z";

const planA = { actions: ["verify"], targets: ["workspace:test"], accounts: ["local-user"], scope: "fixture-only", dataBoundary: "local_only", parameters: { b: 2, a: 1 }, timestamp: "ignored" };
const planB = { dataBoundary: "local_only", parameters: { a: 1, b: 2 }, scope: "fixture-only", accounts: ["local-user"], targets: ["workspace:test"], actions: ["verify"], issuedAt: "also ignored" };
assert.equal(planFingerprint(planA), planFingerprint(planB), "plan fingerprint ignores order and volatile timestamps");

const attemptA = { hypothesis: "network path changed", command: "curl --retry 1", input: { url: "https://example.invalid" }, environment: { proxy: "on" }, timestamp: "ignored" };
assert.equal(attemptFingerprint(attemptA), attemptFingerprint({ environment: { proxy: "on" }, input: { url: "https://example.invalid" }, command: "curl --retry 1", hypothesis: "network path changed" }));

const validEnvelope = {
  ...fixture.authorizationEnvelope,
  actions: ["verify"],
  planFingerprint: planFingerprint(planA),
  issuedAt: "2026-07-12T00:00:00.000Z",
  expiresAt: "2026-07-12T01:00:00.000Z"
};
const request = { ...planA, action: "verify", target: "workspace:test", account: "local-user", planFingerprint: planFingerprint(planA) };
assert.equal(evaluateAuthorization(validEnvelope, request, NOW).valid, true);
assert.ok(evaluateAuthorization(validEnvelope, { ...request, target: "workspace:other" }, NOW).drift.includes("target"));
assert.ok(evaluateAuthorization(validEnvelope, { ...request, account: "other-user" }, NOW).drift.includes("account"));
assert.equal(evaluateAuthorization(validEnvelope, request, "2026-07-12T02:00:00.000Z").reason, "expired");

assert.equal(evaluateRules([{ sourceLevel: "boundary", binding: "prohibited" }], {}).mode, "prohibited");
assert.equal(evaluateRules([{ sourceLevel: "project", binding: "confirm_required" }], {}).mode, "must_confirm");
assert.equal(evaluateRules([{ sourceLevel: "spec", binding: "contract_required", contractRef: "spec:item" }], { contractEvidenceRefs: ["spec:item"] }).mode, "may_proceed");
assert.equal(evaluateRules([{ sourceLevel: "spec", binding: "contract_required", contractRef: "spec:item" }], { contractEvidenceRefs: [] }).mode, "must_confirm");
assert.equal(evaluateRules([{ sourceLevel: "runtime", binding: "overridable_default", deviation: true }], {}).mode, "proceed_and_log");
assert.equal(evaluateRules([
  { id: "one", sourceLevel: "project", binding: "overridable_default", value: "a" },
  { id: "two", sourceLevel: "project", binding: "confirm_required", value: "b" }
], {}).mode, "must_confirm", "same-level conflict uses the stricter binding");
assert.equal(evaluateRules([
  { id: "one", sourceLevel: "project", binding: "confirm_required", value: "a" },
  { id: "two", sourceLevel: "project", binding: "confirm_required", value: "b" }
], {}).reason, "same_binding_conflict");
assert.equal(evaluateRules([
  { id: "one", sourceLevel: "project", binding: "confirm_required", value: "a" },
  { id: "two", sourceLevel: "project", binding: "overridable_default", value: "b", supersedes: ["one"] }
], {}).mode, "may_proceed", "explicit supersedes resolves the old same-level rule");

const baseBlocker = {
  ...fixture.blockers[0],
  attempts: [],
  attemptBudget: { default: 2, standardExtension: 1, hardCeiling: 4, used: 0 }
};
const attempt = (index, overrides = {}) => ({
  hypothesis: `hypothesis-${index}`,
  command: `command-${index}`,
  input: { index },
  environment: { revision: index },
  changeType: index === 1 ? "new_evidence" : "parameter_change",
  normalizedDiff: `change-${index}`,
  expectedInformationGain: `evidence-${index}`,
  ...overrides
});
const first = evaluateAttempt(baseBlocker, attempt(1));
assert.equal(first.allowed, true);
assert.equal(first.mode, "may_proceed");
const afterFirst = { ...baseBlocker, attempts: [{ ...attempt(1), fingerprint: first.fingerprint }], attemptBudget: { ...baseBlocker.attemptBudget, used: 1 } };
assert.equal(evaluateAttempt(afterFirst, attempt(1)).reason, "duplicate_attempt");
const second = evaluateAttempt(afterFirst, attempt(2));
assert.equal(second.allowed, true);
const afterSecond = { ...afterFirst, attempts: [...afterFirst.attempts, { ...attempt(2), fingerprint: second.fingerprint }], attemptBudget: { ...afterFirst.attemptBudget, used: 2 } };
assert.equal(evaluateAttempt(afterSecond, attempt(3, { normalizedDiff: "none", input: { index: 2 }, environment: { revision: 2 } })).reason, "standard_extension_requires_new_condition");
const third = evaluateAttempt(afterSecond, attempt(3, { changeType: "new_external_state" }));
assert.equal(third.allowed, true);
assert.equal(third.mode, "may_proceed");
const afterThird = { ...afterSecond, attempts: [...afterSecond.attempts, { ...attempt(3), fingerprint: third.fingerprint }], attemptBudget: { ...afterSecond.attemptBudget, used: 3 } };
const fourth = evaluateAttempt(afterThird, attempt(4));
assert.equal(fourth.mode, "proceed_and_log");
const afterFourth = { ...afterThird, attempts: [...afterThird.attempts, { ...attempt(4), fingerprint: fourth.fingerprint }], attemptBudget: { ...afterThird.attemptBudget, used: 4 } };
assert.equal(evaluateAttempt(afterFourth, attempt(5)).reason, "authorization_required_above_hard_ceiling");
const raisedEnvelope = { ...validEnvelope, authorizedCeilings: { ...validEnvelope.authorizedCeilings, attemptsPerBlocker: 5 } };
assert.equal(evaluateAttempt(afterFourth, attempt(5), { authorization: raisedEnvelope, authorizationRequest: request, now: NOW }).allowed, true);

const external = evaluateAttempt(fixture.blockers[1], attempt(1));
assert.equal(external.allowed, false);
assert.equal(external.executionStatus, "blocked_external");
assert.equal(external.subagentAllowed, false);

assert.equal(evaluateRecoveryWorkers({ runningWorkers: 1, requestedWorkers: 1, nested: false }).allowed, true);
assert.equal(evaluateRecoveryWorkers({ runningWorkers: 2, requestedWorkers: 1, nested: false }).reason, "recovery_worker_limit");
assert.equal(evaluateRecoveryWorkers({ runningWorkers: 0, requestedWorkers: 1, nested: true }).reason, "nested_recovery_forbidden");

const fastTrack = evaluateFastTrack({
  development: { milestoneRef: "M2", status: "active", independent: true },
  acceptance: { milestoneRef: "M1", status: "in_progress", baselineRef: "git-tree:abc", acceptanceArtifact: "acceptance.json", automatedChecksPassed: true },
  recovery: { status: "parked" },
  contractsStable: true,
  environmentIsolated: true,
  blockingFindings: []
});
assert.equal(fastTrack.allowed, true);
assert.equal(evaluateFastTrack({ ...fastTrack.input, environmentIsolated: false }).reason, "serial_required_shared_environment");
assert.equal(evaluateFastTrack({ ...fastTrack.input, blockingFindings: [{ affectedMilestones: ["M2"] }] }).reason, "blocking_finding_dependency");

const normalizedLegacy = normalizeWorkstream({ schemaVersion: "0.3.1", status: "complete", blockers: ["Legacy blocker"], recovery: "Retry from settings" });
assert.equal(normalizedLegacy.status, "closed");
assert.equal(normalizedLegacy.blockerLedger[0].required, true);

const current = normalizeWorkstream({
  schemaVersion: "0.5.1",
  id: "workstream-current",
  status: "active",
  goal: "Validate governance",
  currentMilestone: "M3",
  nextStep: "Continue",
  blockerLedger: fixture.blockers,
  executionLanes: fixture.executionLanes,
  executionDecisions: [],
  authorizationEnvelopes: [validEnvelope],
  createdAt: NOW,
  updatedAt: NOW
});
assert.deepEqual(validateWorkstream(current), []);

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-workstream-governance-")));
const writer = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-workstream", "scripts", "write-workstream-artifact.js");
const written = JSON.parse(execFileSync(process.execPath, [writer,
  "--workspace", workspace,
  "--status", "active",
  "--goal", "Governance writer fixture",
  "--subject-ref", "governance-fixture",
  "--current-milestone", "M3",
  "--next-step", "Continue the fixture.",
  "--blocker-json", JSON.stringify(fixture.blockers[0]),
  "--execution-lanes-json", JSON.stringify(fixture.executionLanes),
  "--execution-decision-json", JSON.stringify({ id: "decision-1", ...fixture.blockers[0].executionDecision }),
  "--authorization-envelope-json", JSON.stringify(validEnvelope)
], { cwd: workspace, encoding: "utf8" }));
const writtenArtifact = JSON.parse(fs.readFileSync(written.artifactPath, "utf8"));
assert.equal(writtenArtifact.schemaVersion, "0.5.1");
assert.equal(writtenArtifact.blockerLedger.length, 1);
assert.deepEqual(writtenArtifact.blockers, [fixture.blockers[0].title]);
assert.equal(writtenArtifact.authorizationEnvelopes[0].id, validEnvelope.id);
assert.deepEqual(validateWorkstream(writtenArtifact), []);

const invalidWriter = spawnSync(process.execPath, [writer,
  "--workspace", workspace,
  "--status", "active",
  "--goal", "Invalid fixture",
  "--next-step", "Stop.",
  "--blocker-json", "{invalid"
], { cwd: workspace, encoding: "utf8" });
assert.notEqual(invalidWriter.status, 0);
assert.match(invalidWriter.stderr, /valid JSON object/);

const gate = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-workstream", "scripts", "ravo-execution-gate.js");
function runGate(input) {
  return spawnSync(process.execPath, [gate, "--input-json", JSON.stringify(input)], { encoding: "utf8" });
}
const recoveryGate = runGate({ kind: "recovery", request: { runningWorkers: 2, requestedWorkers: 1, nested: false } });
assert.equal(recoveryGate.status, 2);
assert.equal(JSON.parse(recoveryGate.stdout).reason, "recovery_worker_limit");
const authorizationGate = runGate({ kind: "authorization", envelope: validEnvelope, request: { ...request, target: "workspace:other" }, now: NOW });
assert.equal(authorizationGate.status, 2);
assert.equal(JSON.parse(authorizationGate.stdout).reason, "authorization_drift");
const attemptGate = runGate({ kind: "attempt", blocker: afterFirst, attempt: attempt(1) });
assert.equal(attemptGate.status, 2);
assert.equal(JSON.parse(attemptGate.stdout).reason, "duplicate_attempt");
const fastTrackGate = runGate({ kind: "fast_track", request: { ...fastTrack.input, environmentIsolated: false } });
assert.equal(fastTrackGate.status, 2);
assert.equal(JSON.parse(fastTrackGate.stdout).reason, "serial_required_shared_environment");
const rulesGate = runGate({ kind: "rules", rules: [{ sourceLevel: "boundary", binding: "prohibited" }], context: {} });
assert.equal(rulesGate.status, 2);
assert.equal(JSON.parse(rulesGate.stdout).mode, "prohibited");
const invalidGate = runGate({ kind: "unknown" });
assert.equal(invalidGate.status, 1);
assert.match(invalidGate.stderr, /kind must be/);

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "stable-plan-and-attempt-fingerprints",
    "authorization-reuse-drift-expiry",
    "rule-hierarchy-conflict-supersedes",
    "duplicate-and-2-3-4-5-attempt-budget",
    "external-blocker-no-subagent",
    "recovery-worker-hard-limit",
    "fast-track-gates",
    "legacy-workstream-compatibility",
    "v0.5.1-workstream-validation",
    "structured-writer-and-strict-json",
    "execution-gate-cli-all-kinds-and-exit-codes"
  ]
}, null, 2));
