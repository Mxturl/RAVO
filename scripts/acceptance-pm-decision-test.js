#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pm-decision-")));
const writer = path.join(repo, "plugins/ravo/modules/ravo-acceptance/scripts/write-acceptance-artifact.js");
const checker = path.join(repo, "plugins/ravo/modules/ravo-acceptance/scripts/check-ravo-acceptance.js");
fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
fs.writeFileSync(path.join(workspace, "docs/spec.md"), "# v0.5.5 Spec\nR054-023 PM decision gate\n", "utf8");
fs.mkdirSync(path.join(workspace, "knowledge/.ravo/acceptance"), { recursive: true });
const baseline = { schemaVersion: "0.5.5", status: "committed", baselineRef: "git-commit:abc123", taskOwned: ["plugins/example.js"], preExisting: [], mixedOrUnknown: [] };
fs.writeFileSync(path.join(workspace, "knowledge/.ravo/acceptance/git-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
const item = {
  id: "pm-gate",
  name: "PM decision gate",
  required: true,
  expected: "Only an explicit PM acceptance can produce accepted.",
  implementation: "Writer and checker validate a bound pmDecision.",
  effect: "A bare confirmation cannot close the acceptance package.",
  fulfillmentStatus: "met",
  verificationStatus: "verified",
  verificationOwner: "codex",
  verificationReason: "Verified by the dedicated gate test.",
  verificationTasks: [],
  sourceRefs: ["test:pm-gate"],
  risk: "A vague confirmation could be misread as acceptance.",
  boundary: "This only changes acceptance status binding.",
  blockingReason: "",
  blockerImpact: "",
  temporaryFallback: "Keep pending_acceptance.",
  recoveryEntry: "Ask for an explicit acceptance decision.",
  dependencyImpact: ""
};

function args(status, extra = []) {
  return [
    writer, "--workspace", workspace, "--status", status, "--evidence-level", "smoke", "--summary", "v0.5.5 PM gate test",
    "--acceptance-scope", "release", "--subject-ref", "v0.5.5-pm-gate", "--release-ref", "v0.5.5-pm-gate", "--baseline-ref", baseline.baselineRef,
    "--spec-ref", "docs/spec.md", "--git-baseline-artifact", "knowledge/.ravo/acceptance/git-baseline.json", "--source-ref", "test:pm-gate",
    "--real-response-ref", "evidence:response", "--screenshot-ref", "evidence:screenshot", "--acceptance-item", JSON.stringify(item), ...extra
  ];
}

const pending = execFileSync(process.execPath, args("pending_acceptance"), { cwd: workspace, encoding: "utf8" });
assert.match(pending, /artifactPath/);

const missing = spawnSync(process.execPath, args("accepted", [
  "--security-pass", "data_privacy", "--security-pass", "credentials", "--security-pass", "permissions", "--security-pass", "destructive_actions",
  "--security-pass", "external_calls", "--security-pass", "dependencies", "--security-pass", "logs_artifacts", "--security-pass", "global_knowledge"
]), { cwd: workspace, encoding: "utf8" });
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /pmDecision/);

const commonSecurity = ["data_privacy", "credentials", "permissions", "destructive_actions", "external_calls", "dependencies", "logs_artifacts", "global_knowledge"].flatMap((id) => ["--security-pass", id]);
const ambiguous = spawnSync(process.execPath, args("accepted", [...commonSecurity, "--pm-decision-json", JSON.stringify({ verdict: "accepted", decisionText: "确认", sourceRef: "conversation:thread#turn", subjectRef: "v0.5.5-pm-gate", baselineRef: baseline.baselineRef, decidedAt: new Date().toISOString(), actor: "pm" })]), { cwd: workspace, encoding: "utf8" });
assert.notEqual(ambiguous.status, 0);
assert.match(ambiguous.stderr, /explicit acceptance action|decisionText/);

const valid = execFileSync(process.execPath, args("accepted", [...commonSecurity, "--pm-decision-json", JSON.stringify({ verdict: "accepted", decisionText: "确认本次验收包已完成验收通过，范围为当前版本 v0.5.5。", sourceRef: "conversation:thread#turn-42", subjectRef: "v0.5.5-pm-gate", baselineRef: baseline.baselineRef, decidedAt: new Date().toISOString(), actor: "pm" })]), { cwd: workspace, encoding: "utf8" });
const accepted = JSON.parse(valid);
const checked = JSON.parse(execFileSync(process.execPath, [checker, "--acceptance-artifact", path.relative(workspace, accepted.artifactPath)], { cwd: workspace, encoding: "utf8" }));
assert.equal(checked.status, "ready");
assert.equal(checked.checks.find((check) => check.id === "pmDecision").status, "pass");

console.log(JSON.stringify({ status: "pass", checks: ["v0.5.5-pending-without-decision", "accepted-without-decision-rejected", "ambiguous-confirmation-rejected", "explicit-bound-pm-decision-accepted", "checker-independent-decision-validation"], workspace }, null, 2));
