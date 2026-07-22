#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { validatePmBrief } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pm-lifecycle-")));

function run(relativeScript, args) {
  const output = execFileSync(process.execPath, [path.join(repo, relativeScript), ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: path.join(workspace, "home") }
  });
  return JSON.parse(output);
}

function artifact(result) {
  return JSON.parse(fs.readFileSync(result.artifactPath, "utf8"));
}

function valid(brief, label) {
  assert.deepEqual(validatePmBrief(brief), [], `${label} emits a valid PM Brief`);
}

function fixedReader(value, label) {
  for (const field of ["technicalDetailLevel", "audience", "outputMode", "summaryMode"]) {
    assert.equal(Object.hasOwn(value, field), false, `${label} does not emit deprecated presentation field ${field}`);
  }
}

fs.mkdirSync(path.join(workspace, "home"), { recursive: true });

const capture = run("plugins/ravo/modules/ravo-core/scripts/capture-pool-item.js", [
  "--workspace", workspace,
  "--kind", "requirement",
  "--title", "让产品状态更容易理解",
  "--description", "产品经理需要先看到实际可用程度和下一步。",
  "--source-ref", "conversation:test"
]);
valid(capture.pmBrief, "requirement capture");
assert.equal(capture.pmBrief.actionRequired, "none");
assert.equal(capture.pmBrief.decisionCard, null);

const analysis = artifact(run("plugins/ravo/modules/ravo-analysis/scripts/write-analysis-artifact.js", [
  "--workspace", workspace,
  "--type", "requirement",
  "--status", "draft",
  "--title", "PM lifecycle fixture",
  "--source-ref", "conversation:test"
]));
valid(analysis.pmBrief, "analysis");
fixedReader(analysis, "analysis");
assert.equal(analysis.pmBrief.productState, "needs_alignment");

const workstreamResult = run("plugins/ravo/modules/ravo-workstream/scripts/write-workstream-artifact.js", [
  "--workspace", workspace,
  "--status", "active",
  "--goal", "完成产品状态展示",
  "--current-milestone", "产品展示",
  "--next-step", "Finish implementation",
  "--evidence-ref", "conversation:test"
]);
const workstream = artifact(workstreamResult);
valid(workstream.pmBrief, "workstream");
fixedReader(workstream, "workstream");
assert.equal(workstream.pmBrief.actionRequired, "none");

const invalidWorkstream = spawnSync(process.execPath, [
  path.join(repo, "plugins/ravo/modules/ravo-workstream/scripts/write-workstream-artifact.js"),
  "--workspace", workspace,
  "--status", "planned",
  "--goal", "Invalid PM action fixture",
  "--pm-action", "choose_option"
], { cwd: repo, encoding: "utf8" });
assert.notEqual(invalidWorkstream.status, 0);
assert.match(invalidWorkstream.stderr, /decisionCard is required/);

const quickValidation = artifact(run("plugins/ravo/modules/ravo-quick-validation/scripts/write-smoke-artifact.js", [
  "--workspace", workspace,
  "--kind", "smoke",
  "--scope", "PM lifecycle fixture",
  "--status", "pass",
  "--check", "PM Brief contract",
  "--evidence-ref", "conversation:test"
]));
valid(quickValidation.pmBrief, "quick validation");
fixedReader(quickValidation, "quick validation");
assert.equal(quickValidation.pmBrief.productState, "validated");

const review = artifact(run("plugins/ravo/modules/ravo-review/scripts/write-review-artifact.js", [
  "--workspace", workspace,
  "--domain", "product",
  "--coverage", "none",
  "--subject-ref", "pm-lifecycle-fixture",
  "--source-ref", "conversation:test",
  "--blocking-reason", "External review is not authorized.",
  "--blocker-impact", "External review cannot support acceptance.",
  "--temporary-fallback", "Use local validation.",
  "--recovery-entry", "Run external review after authorization."
]));
valid(review.pmBrief, "review");
fixedReader(review, "review");
assert.equal(review.pmBrief.actionRequired, "none");

const knowledge = artifact(run("plugins/ravo/modules/ravo-knowledge/scripts/write-knowledge-artifact.js", [
  "--workspace", workspace,
  "--kind", "lesson",
  "--title", "PM 状态表达",
  "--summary", "先说明产品影响和下一步。",
  "--content", "面向产品经理时，先说明是否可用、是否需要参与和下一步。",
  "--applicability", "产品状态汇报",
  "--source", "pm-lifecycle-test",
  "--source-ref", "conversation:test"
]));
valid(knowledge.pmBrief, "knowledge");
fixedReader(knowledge, "knowledge");
assert.equal(knowledge.pmBrief.stage, "learn");

const goal = run("plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt.js", [
  "--workspace", workspace,
  "--check-only"
]);
valid(goal.pmBrief, "goal preparation");
fixedReader(goal, "goal preparation");
assert.equal(goal.pmBrief.actionRequired, "clarify_scope");

const workspaceCheck = run("plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief.js", ["--workspace", workspace]);
assert.equal(workspaceCheck.status, "pass");
assert.ok(workspaceCheck.checked >= 5);

console.log(JSON.stringify({
  status: "pass",
  checkedArtifacts: workspaceCheck.checked,
  checks: [
    "explicit-requirement-capture-without-repeat-confirmation",
    "analysis-brief",
    "workstream-brief",
    "pm-action-without-card-rejected",
    "quick-validation-brief",
    "review-brief",
    "knowledge-brief",
    "goal-preparation-brief",
    "workspace-pm-brief-checker",
    "fixed-reader-artifact-contract"
  ]
}, null, 2));
