#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { evaluateDiagnostic, evaluateReviewTrigger } = require("../plugins/ravo/modules/ravo-review/scripts/review-trigger-gate");

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-trigger-")));
const runner = path.join(__dirname, "../plugins/ravo/modules/ravo-review/scripts/run-review.js");
const config = path.join(workspace, "review.json");
fs.writeFileSync(config, JSON.stringify({ apiMode: "fake", apiBase: "fake://trigger", models: ["fake-a"], rounds: 1 }, null, 2));

const base = {
  workspace,
  governancePath: "governed_change",
  triggerReason: "user_explicit_formal_review",
  triggerSourceRef: "conversation:trigger-test#formal",
  decisionImpact: "Validate formal Review behavior in a controlled fixture.",
  subjectRef: "trigger-fixture",
  subjectVersion: "fixture-v1",
  subjectHash: "sha256:fixture"
};

assert.equal(evaluateReviewTrigger(base).decision, "allow");
assert.equal(evaluateReviewTrigger({ ...base, governancePath: "quick_answer" }).decision, "deny");
assert.equal(evaluateReviewTrigger({ ...base, triggerReason: "made_up" }).reason, "trigger_reason_not_allowlisted");
assert.equal(evaluateReviewTrigger({ ...base, triggerReason: "material_local_fact_conflict", triggerEvidenceRefs: ["docs/a.md#claim"] }).reason, "material_conflict_requires_two_evidence_refs");
assert.equal(evaluateDiagnostic({ diagnosticReason: "implementation_debug", modelCount: 1, fallbackCount: 0, rounds: 1 }).decision, "allow");
assert.equal(evaluateDiagnostic({ diagnosticReason: "implementation_debug", modelCount: 2, fallbackCount: 0, rounds: 1 }).reason, "diagnostic_requires_exactly_one_model");

fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
fs.writeFileSync(path.join(workspace, "docs", "spec.md"), "# Fixture\n\n状态：decision-complete\n\n需求集合：`R056-001`\n", "utf8");
assert.equal(evaluateReviewTrigger({
  ...base,
  triggerReason: "spec_required",
  triggerSourceRef: "docs/spec.md#R056-001"
}).decision, "allow");

function run(args) {
  return spawnSync(process.execPath, [runner, "--workspace", workspace, "--config", config, "--subject", "Review a stable fixture.", "--subject-ref", "trigger-fixture", "--subject-version", "fixture-v1", ...args], { encoding: "utf8" });
}

const denied = run([]);
assert.equal(denied.status, 2);
const deniedOutput = JSON.parse(denied.stdout);
assert.equal(deniedOutput.status, "review_gate_denied");
assert.equal(deniedOutput.externalRequestCount, 0);
assert.equal(fs.existsSync(path.join(workspace, "knowledge", ".ravo", "review")), false, "denied formal Review creates no artifact directory");

const preview = run(["--preview"]);
assert.equal(preview.status, 0);
assert.equal(JSON.parse(preview.stdout).status, "review_gate_denied");

const allowed = run([
  "--governance-path", "governed_change",
  "--trigger-reason", "user_explicit_formal_review",
  "--trigger-source-ref", "conversation:trigger-test#formal",
  "--decision-impact", "Validate formal Review behavior in a controlled fixture."
]);
assert.equal(allowed.status, 0, allowed.stderr);
const allowedOutput = JSON.parse(allowed.stdout);
assert.equal(allowedOutput.reviewTriggerGate.decision, "allow");
assert.equal(allowedOutput.callPlan.reviewTriggerGate.decision, "allow");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "formal trigger allowlist and stable subject pin",
    "conflict and diagnostic constraints",
    "denied formal Review has zero requests and zero artifacts",
    "preview exposes gate without a side effect",
    "allowed formal Review enters the existing call plan"
  ]
}, null, 2));
