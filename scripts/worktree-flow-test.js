#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  classifyGoal,
  integrationPlan,
  mergePreflight,
  milestone,
  preparePlan,
  prepareTask
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-worktree-flow");
const { captureGitBaseline, cleanWorktrees } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-git-baseline");
const { validateWorkstream } = require("../plugins/ravo/modules/ravo-workstream/scripts/workstream-model");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-worktree-flow-")));
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "RAVO Test",
  GIT_AUTHOR_EMAIL: "ravo@example.invalid",
  GIT_COMMITTER_NAME: "RAVO Test",
  GIT_COMMITTER_EMAIL: "ravo@example.invalid"
};
const git = (cwd, args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
const worktree = (name) => path.join(os.tmpdir(), `ravo-worktree-flow-${path.basename(root)}-${name}`);

git(root, ["init", "-q"]);
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, ".gitignore"), "knowledge/.ravo/\n");
fs.writeFileSync(path.join(root, "src", "conflict.txt"), "base\n");
fs.writeFileSync(path.join(root, "src", "producer.js"), "module.exports = { version: 1 };\n");
fs.writeFileSync(path.join(root, "src", "consumer.js"), "module.exports = { expected: 0 };\n");
fs.writeFileSync(path.join(root, "docs", "readme.md"), "read only\n");
git(root, ["add", "."]);
git(root, ["commit", "-qm", "initial"]);
const baseCommit = git(root, ["rev-parse", "HEAD"]);

assert.equal(classifyGoal({ confirmed: true, specCurrent: true, poolCurrent: true, productImplementation: true }).status, "not_required");
assert.equal(classifyGoal({ productImplementation: false }).status, "not_required");
assert.equal(classifyGoal({ confirmed: true, specCurrent: false, poolCurrent: true, productImplementation: true, longRunning: true }).status, "blocked");

git(root, ["checkout", "--detach", "-q", "HEAD"]);
fs.writeFileSync(path.join(root, "staged.txt"), "staged\n");
git(root, ["add", "staged.txt"]);
fs.appendFileSync(path.join(root, "src", "conflict.txt"), "unstaged\n");
fs.writeFileSync(path.join(root, "untracked.txt"), "untracked\n");
fs.mkdirSync(path.join(root, "knowledge", ".ravo"), { recursive: true });
fs.writeFileSync(path.join(root, "knowledge", ".ravo", "source-only.json"), "{\"source\":true}\n");
const sourceBefore = {
  staged: fs.readFileSync(path.join(root, "staged.txt"), "utf8"),
  conflict: fs.readFileSync(path.join(root, "src", "conflict.txt"), "utf8"),
  untracked: fs.readFileSync(path.join(root, "untracked.txt"), "utf8")
};

const taskWorktree = worktree("task");
const preparation = prepareTask(root, {
  goal: {
    confirmed: true,
    specCurrent: true,
    poolCurrent: true,
    productImplementation: true,
    longRunning: true,
    crossSession: true,
    protectDirtySource: true
  },
  taskId: "fixture",
  releaseSlice: "ravo-v0.5.7-fixture",
  baseCommit,
  taskWorktree,
  taskOwner: "fixture-owner",
  integrationOwner: "fixture-owner",
  rescueRef: "rescue/ravo-v0.5.7-fixture-source",
  ownership: {
    write: ["src/task-owned.js", "src/contract.js"],
    readOnly: ["docs"],
    shared: [{ path: "src/contract.js", owner: "fixture-owner" }],
    upstream: [],
    output: ["scripts/worktree-flow-test.js"],
    stop: "Stop direct edits and request the shared-contract owner."
  },
  ignoredInputs: [{ source: "knowledge/.ravo/source-only.json", required: false, regenerable: true, ownership: "fixture-owner", fallback: "regenerate" }]
}, { apply: true });

assert.equal(preparation.status, "prepared");
assert.equal(git(root, ["rev-parse", "rescue/ravo-v0.5.7-fixture-source"]), baseCommit, "rescue ref only preserves the existing source commit");
assert.deepEqual({
  staged: fs.readFileSync(path.join(root, "staged.txt"), "utf8"),
  conflict: fs.readFileSync(path.join(root, "src", "conflict.txt"), "utf8"),
  untracked: fs.readFileSync(path.join(root, "untracked.txt"), "utf8")
}, sourceBefore, "dirty detached source remains untouched");
assert.equal(git(taskWorktree, ["rev-parse", "HEAD"]), baseCommit);
assert.equal(git(taskWorktree, ["symbolic-ref", "--short", "HEAD"]), "task/ravo-v0.5.7-fixture");
assert.equal(fs.existsSync(path.join(taskWorktree, "knowledge", ".ravo", "source-only.json")), false, "ignored source state is not copied");
assert.ok(fs.existsSync(preparation.markerPath));
assert.ok(preparation.context.source.ignored.length > 0, "dirty detached startup records ignored source state");

const sharedConflict = preparePlan(root, {
  goal: { confirmed: true, specCurrent: true, poolCurrent: true, productImplementation: true, longRunning: true },
  taskId: "consumer",
  releaseSlice: "ravo-v0.5.7-fixture",
  baseCommit,
  taskWorktree: worktree("consumer"),
  taskOwner: "consumer-owner",
  integrationOwner: "fixture-owner",
  ownership: {
    write: ["src/contract.js"],
    readOnly: ["docs"],
    shared: [{ path: "src/contract.js", owner: "consumer-owner" }],
    upstream: [],
    output: [],
    stop: "Stop direct edits and request the shared-contract owner."
  },
  ignoredInputs: []
});
assert.equal(sharedConflict.status, "blocked");
assert.ok(sharedConflict.conflicts.some((entry) => entry.type === "shared_contract_owner_conflict"));

const integrationOwnerConflict = preparePlan(root, {
  goal: { confirmed: true, specCurrent: true, poolCurrent: true, productImplementation: true, longRunning: true },
  taskId: "owner-conflict",
  releaseSlice: "ravo-v0.5.7-fixture",
  baseCommit,
  taskWorktree: worktree("owner-conflict"),
  taskOwner: "other-owner",
  integrationOwner: "other-owner",
  ownership: {
    write: ["other"],
    readOnly: ["docs"],
    shared: [{ path: "other/contract.js", owner: "other-owner" }],
    upstream: [],
    output: [],
    stop: "Stop direct edits and request the shared-contract owner."
  },
  ignoredInputs: []
});
assert.equal(integrationOwnerConflict.status, "blocked");
assert.ok(integrationOwnerConflict.conflicts.some((entry) => entry.type === "integration_owner_conflict"));

const unknownIntegrationBranch = "integration/ravo-v0.5.7-unknown-owner";
git(root, ["branch", unknownIntegrationBranch, baseCommit]);
const unknownIntegrationOwner = preparePlan(root, {
  goal: { confirmed: true, specCurrent: true, poolCurrent: true, productImplementation: true, longRunning: true },
  taskId: "unknown-owner",
  releaseSlice: "ravo-v0.5.7-unknown-owner",
  baseCommit,
  integrationBranch: unknownIntegrationBranch,
  taskWorktree: worktree("unknown-owner"),
  taskOwner: "unknown-owner",
  integrationOwner: "unknown-owner",
  ownership: {
    write: ["unknown-owner"],
    readOnly: ["docs"],
    shared: [{ path: "unknown-owner/contract.js", owner: "unknown-owner" }],
    upstream: [],
    output: [],
    stop: "Stop direct edits and request the shared-contract owner."
  },
  ignoredInputs: []
});
assert.equal(unknownIntegrationOwner.status, "blocked");
assert.equal(unknownIntegrationOwner.reason, "integration_owner_unknown");

const adoptedWorktree = worktree("adopt");
git(root, ["branch", "integration/ravo-v0.5.7-adopt", baseCommit]);
git(root, ["worktree", "add", "-q", "-b", "task/ravo-v0.5.7-adopt", adoptedWorktree, baseCommit]);
fs.writeFileSync(path.join(adoptedWorktree, "src", "adopted.js"), "module.exports = true;\n");
const adopted = prepareTask(root, {
  goal: { confirmed: true, specCurrent: true, poolCurrent: true, productImplementation: true, longRunning: true },
  taskId: "adopt",
  releaseSlice: "ravo-v0.5.7-adopt",
  baseCommit,
  taskBranch: "task/ravo-v0.5.7-adopt",
  integrationBranch: "integration/ravo-v0.5.7-adopt",
  taskWorktree: adoptedWorktree,
  taskOwner: "fixture-owner",
  integrationOwner: "fixture-owner",
  rescueRef: "rescue/ravo-v0.5.7-adopt-source",
  adoptExisting: true,
  initialTaskOwnedPaths: ["src/adopted.js"],
  ownership: {
    write: ["src/adopted.js"],
    readOnly: ["docs"],
    shared: [{ path: "src/contract.js", owner: "fixture-owner" }],
    upstream: [],
    output: [],
    stop: "Stop direct edits and request the shared-contract owner."
  }
}, { apply: true });
assert.equal(adopted.status, "prepared");
assert.equal(adopted.context.taskStartup.untracked.length, 0, "adoption records an explicit pre-change startup snapshot");

const contextPath = preparation.contextPath;
fs.writeFileSync(path.join(taskWorktree, "src", "task-owned.js"), "module.exports = 1;\n");
assert.equal(milestone(taskWorktree, { contextPath, taskOwnedPaths: ["src/task-owned.js"] }).status, "changes_ready");
const firstMilestone = milestone(taskWorktree, {
  contextPath,
  taskOwnedPaths: ["src/task-owned.js"],
  apply: true,
  commitMessage: "RAVO fixture task-owned milestone"
});
assert.equal(firstMilestone.status, "committed");
assert.equal(git(taskWorktree, ["status", "--porcelain"]), "");
assert.equal(milestone(taskWorktree, { contextPath, taskOwnedPaths: ["src/contract.js"] }).status, "changes_ready", "the declared shared-contract owner may stage its own contract path");

fs.writeFileSync(path.join(taskWorktree, "src", "mixed.js"), "module.exports = 'unknown';\n");
const blockedMilestone = milestone(taskWorktree, { contextPath, taskOwnedPaths: ["src/task-owned.js"], apply: true });
assert.equal(blockedMilestone.status, "commit_blocked", "mixed or unknown paths cannot enter a milestone commit");

const conflictCandidate = worktree("conflict-candidate");
const conflictIntegration = worktree("conflict-integration");
git(root, ["worktree", "add", "-q", "-b", "candidate/conflict", conflictCandidate, baseCommit]);
git(root, ["worktree", "add", "-q", conflictIntegration, "integration/ravo-v0.5.7-fixture"]);
fs.writeFileSync(path.join(conflictCandidate, "src", "conflict.txt"), "candidate\n");
git(conflictCandidate, ["add", "src/conflict.txt"]);
git(conflictCandidate, ["commit", "-qm", "candidate conflict"]);
fs.writeFileSync(path.join(conflictIntegration, "src", "conflict.txt"), "integration\n");
git(conflictIntegration, ["add", "src/conflict.txt"]);
git(conflictIntegration, ["commit", "-qm", "integration conflict"]);
const conflict = mergePreflight(taskWorktree, { contextPath, candidateBranch: "candidate/conflict" });
assert.equal(conflict.status, "pending_codex");
assert.ok(conflict.conflictPaths.includes("src/conflict.txt"), JSON.stringify(conflict));

const semanticIntegration = "integration/ravo-v0.5.7-semantic";
const semanticCandidate = "candidate/semantic";
const semanticIntegrationTree = worktree("semantic-integration");
const semanticCandidateTree = worktree("semantic-candidate");
git(root, ["branch", semanticIntegration, baseCommit]);
git(root, ["worktree", "add", "-q", semanticIntegrationTree, semanticIntegration]);
git(root, ["worktree", "add", "-q", "-b", semanticCandidate, semanticCandidateTree, baseCommit]);
fs.writeFileSync(path.join(semanticIntegrationTree, "src", "producer.js"), "module.exports = { version: 2 };\n");
git(semanticIntegrationTree, ["add", "src/producer.js"]);
git(semanticIntegrationTree, ["commit", "-qm", "producer v2"]);
fs.writeFileSync(path.join(semanticCandidateTree, "src", "consumer.js"), "module.exports = { expected: 1 };\n");
git(semanticCandidateTree, ["add", "src/consumer.js"]);
git(semanticCandidateTree, ["commit", "-qm", "consumer v1"]);
const clean = mergePreflight(taskWorktree, { contextPath, integrationBranch: semanticIntegration, candidateBranch: semanticCandidate });
assert.equal(clean.status, "ready_for_integration");
assert.equal(clean.semanticValidationRequired, true, "clean merge-tree never proves semantic compatibility");
const producedVersion = fs.readFileSync(path.join(semanticIntegrationTree, "src", "producer.js"), "utf8").match(/version: (\d+)/)[1];
const expectedVersion = fs.readFileSync(path.join(semanticCandidateTree, "src", "consumer.js"), "utf8").match(/expected: (\d+)/)[1];
assert.throws(() => assert.equal(producedVersion, expectedVersion), "fixture proves an integration semantic check fails after a clean merge-tree preflight");

const intended = mergePreflight(taskWorktree, { contextPath });
assert.equal(intended.status, "ready_for_integration");

assert.equal(integrationPlan(taskWorktree, { contextPath, integrationOwner: "other", stage: "contract" }).status, "blocked");
const integration = integrationPlan(taskWorktree, { contextPath, integrationOwner: "fixture-owner", stage: "contract" });
assert.equal(integration.status, "ready_for_owner");
assert.equal(integration.semanticValidationRequired, true);
git(conflictIntegration, ["merge", "--no-ff", "--no-edit", "task/ravo-v0.5.7-fixture"]);
assert.equal(git(conflictIntegration, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length, 3, "integration keeps a local merge commit as a recovery point");

function markRavoOwned(worktreePath, recoveryRef) {
  fs.mkdirSync(path.join(worktreePath, "knowledge", ".ravo"), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, "knowledge", ".ravo", "worktree-owner.json"), JSON.stringify({ owner: "ravo", recoveryRef }));
}

const cleanupClean = worktree("cleanup-clean");
const cleanupDirty = worktree("cleanup-dirty");
const cleanupActive = worktree("cleanup-active");
const cleanupUnknown = worktree("cleanup-unknown");
git(root, ["worktree", "add", "-q", "-b", "task/cleanup-clean", cleanupClean, baseCommit]);
git(root, ["worktree", "add", "-q", "-b", "task/cleanup-dirty", cleanupDirty, baseCommit]);
git(root, ["worktree", "add", "-q", "-b", "task/cleanup-active", cleanupActive, baseCommit]);
git(root, ["worktree", "add", "-q", "-b", "task/cleanup-unknown", cleanupUnknown, baseCommit]);
markRavoOwned(cleanupClean, "git:task/cleanup-clean");
markRavoOwned(cleanupDirty, "git:task/cleanup-dirty");
markRavoOwned(cleanupActive, "git:task/cleanup-active");
fs.writeFileSync(path.join(cleanupDirty, "src", "dirty.js"), "module.exports = 'dirty';\n");
const cleanupPaths = {
  clean: fs.realpathSync(cleanupClean),
  dirty: fs.realpathSync(cleanupDirty),
  active: fs.realpathSync(cleanupActive),
  unknown: fs.realpathSync(cleanupUnknown)
};
const cleanup = cleanWorktrees(captureGitBaseline(root, { env }), { env, activeWorktrees: [cleanupActive] });
const cleanupEntry = (name) => cleanup.results.find((entry) => entry.path === cleanupPaths[name]);
assert.equal(cleanupEntry("clean").action, "removed");
assert.equal(cleanupEntry("dirty").reason, "dirty");
assert.equal(cleanupEntry("active").reason, "active_session");
assert.equal(cleanupEntry("unknown").reason, "ownership_unknown");

const writer = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-workstream", "scripts", "write-workstream-artifact.js");
const writerResult = JSON.parse(execFileSync(process.execPath, [writer,
  "--workspace", taskWorktree,
  "--status", "active",
  "--goal", "Worktree flow fixture",
  "--current-milestone", "M1",
  "--next-step", "Run fixture validation.",
  "--worktree-context-json", JSON.stringify({
    baseCommit,
    baseBranch: null,
    releaseSlice: "ravo-v0.5.7-fixture",
    taskId: "fixture",
    taskBranch: "task/ravo-v0.5.7-fixture",
    taskWorktree,
    taskOwner: "fixture-owner",
    integrationBranch: "integration/ravo-v0.5.7-fixture",
    integrationOwner: "fixture-owner",
    ownership: preparation.context.ownership,
    milestones: [firstMilestone.milestone]
  })
], { cwd: taskWorktree, encoding: "utf8" }));
const workstream = JSON.parse(fs.readFileSync(writerResult.artifactPath, "utf8"));
assert.equal(workstream.worktreeContext.baseCommit, baseCommit);
assert.deepEqual(validateWorkstream(workstream), []);

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "small-goal-not-required",
    "dirty-detached-rescue-and-isolation",
    "ignored-source-state-recorded",
    "shared-contract-and-integration-owner-conflicts",
    "unknown-integration-owner-blocked",
    "safe-adopt-existing-task-worktree",
    "ignored-state-not-copied",
    "task-owned-milestone-and-mixed-block",
    "merge-tree-conflict-paths",
    "clean-merge-requires-semantic-validation",
    "integration-owner-order-and-local-merge",
    "cleanup-keeps-dirty-active-and-unknown-worktrees",
    "structured-workstream-context"
  ]
}, null, 2));
