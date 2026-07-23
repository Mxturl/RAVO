#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const safety = require("../plugins/ravo/modules/ravo-safety/scripts/safety-model");
const { runNative } = require("../plugins/ravo/modules/ravo-safety/scripts/safety-native");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function fixture(callback) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-safety-")));
  const root = path.join(temporary, "root");
  const quarantine = path.join(temporary, "quarantine");
  fs.mkdirSync(root);
  fs.mkdirSync(quarantine);
  try {
    return callback({ temporary, root, quarantine });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function envelope(plan, suffix = "authorization") {
  const request = safety.authorizationRequestFor(plan);
  return {
    id: `pm-${suffix}`,
    confirmedBy: "pm-fixture",
    actions: [request.action],
    targets: [request.target],
    accounts: [request.account],
    scope: request.scope,
    dataBoundary: request.dataBoundary,
    planFingerprint: request.planFingerprint,
    dependentTaskRefs: [],
    authorizedCeilings: {},
    issuedAt: new Date().toISOString(),
    expiresAt: "session_end",
    sourceRef: "fixture:pm-confirmation",
    status: "active"
  };
}

function confirmed(plan, suffix) {
  const result = safety.confirmPlan(plan, envelope(plan, suffix));
  assert.equal(result.status, "confirmed", JSON.stringify(result));
  return result.confirmedPlan;
}

function previewFile(root, quarantine, target, action = "truncate_file") {
  const result = safety.preview({ action, authorizedRoot: root, target, recovery: { quarantineDir: quarantine } });
  assert.equal(result.status, "preview", JSON.stringify(result));
  return result.plan;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr || ""}`);
  return result.stdout.trim();
}

function initGit(root) {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Safety Fixture"]);
  git(root, ["config", "user.email", "safety@example.invalid"]);
}

function testNativeProbe() {
  const probe = safety.compileNative();
  assert.equal(probe.available, true, JSON.stringify(probe));
  assert.ok(probe.probe.flags.noFollowAny);
  assert.ok(probe.probe.flags.resolveBeneath);
  assert.ok(probe.probe.flags.unique);
}

function testCliPreview() {
  fixture(({ temporary, root, quarantine }) => {
    write(path.join(root, "target.txt"), "cli target");
    const input = path.join(temporary, "request.json");
    write(input, JSON.stringify({ action: "truncate_file", authorizedRoot: root, target: "target.txt", recovery: { quarantineDir: quarantine } }));
    const cli = spawnSync(process.execPath, [path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-safety", "scripts", "ravo-safety.js"), "--mode", "preview", "--input", input], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).status, "preview");
    assert.equal(fs.readFileSync(path.join(root, "target.txt"), "utf8"), "cli target");
  });
}

function testEvidenceArtifact() {
  fixture(({ temporary }) => {
    const workspace = path.join(temporary, "workspace");
    fs.mkdirSync(workspace);
    const output = "knowledge/.ravo/safety/evidence.json";
    const command = spawnSync(process.execPath, [path.join(__dirname, "ravo-safety-evidence.js"), "--workspace", workspace, "--output", output], { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    const artifact = JSON.parse(fs.readFileSync(path.join(workspace, output), "utf8"));
    assert.equal(artifact.status, "pass");
    assert.equal(artifact.mutationReceipt.status, "executed");
    assert.equal(artifact.restoreReceipt.status, "restored");
    assert.equal(artifact.recoveryDrill.restoredExactPreimage, true);
    assert.doesNotMatch(JSON.stringify(artifact), /controlled preimage/);
  });
}

function testTargetMissing() {
  fixture(({ root, quarantine }) => {
    const result = safety.preview({ action: "truncate_file", authorizedRoot: root, target: "missing.txt", recovery: { quarantineDir: quarantine } });
    assert.equal(result.status, "target_missing");
  });
}

function testNestedQuarantineRejected() {
  fixture(({ root }) => {
    const nested = path.join(root, ".quarantine");
    fs.mkdirSync(nested);
    write(path.join(root, "target.txt"), "target");
    const result = safety.preview({ action: "truncate_file", authorizedRoot: root, target: "target.txt", recovery: { quarantineDir: nested } });
    assert.equal(result.status, "blocked", JSON.stringify(result));
  });
}

function testTargetSymlinkDrift() {
  fixture(({ temporary, root, quarantine }) => {
    const target = path.join(root, "target.txt");
    const outside = path.join(temporary, "outside.txt");
    write(target, "planned");
    write(outside, "outside remains intact");
    const plan = previewFile(root, quarantine, "target.txt");
    fs.renameSync(target, path.join(root, "original.txt"));
    fs.symlinkSync(outside, target);
    const result = safety.execute(confirmed(plan, "symlink"));
    assert.equal(result.status, "target_drift", JSON.stringify(result));
    assert.deepEqual(result.receipt.attemptedSet, []);
    assert.equal(fs.readFileSync(outside, "utf8"), "outside remains intact");
  });
}

function testAncestorSymlinkDrift() {
  fixture(({ temporary, root, quarantine }) => {
    const directory = path.join(root, "nested");
    const outside = path.join(temporary, "outside");
    fs.mkdirSync(directory);
    fs.mkdirSync(outside);
    write(path.join(directory, "target.txt"), "planned");
    write(path.join(outside, "target.txt"), "outside remains intact");
    const plan = previewFile(root, quarantine, "nested/target.txt");
    fs.renameSync(directory, path.join(root, "nested-original"));
    fs.symlinkSync(outside, directory);
    const result = safety.execute(confirmed(plan, "ancestor-symlink"));
    assert.equal(result.status, "target_drift", JSON.stringify(result));
    assert.deepEqual(result.receipt.attemptedSet, []);
    assert.equal(fs.readFileSync(path.join(outside, "target.txt"), "utf8"), "outside remains intact");
  });
}

function testHardlinkRejected() {
  fixture(({ root, quarantine }) => {
    const target = path.join(root, "target.txt");
    write(target, "hardlink target");
    fs.linkSync(target, path.join(root, "alias.txt"));
    const result = safety.preview({ action: "truncate_file", authorizedRoot: root, target: "target.txt", recovery: { quarantineDir: quarantine } });
    assert.equal(result.status, "not_supported", JSON.stringify(result));
  });
}

function nativeOptions(plan) {
  const item = plan.affectedSet[0];
  return {
    root: plan.authorizedRoot,
    relative: item.logicalPath,
    quarantine: plan.quarantine.physicalPath,
    snapshotName: item.recovery.snapshotName,
    rootIdentity: plan.rootIdentity,
    targetIdentity: item.targetIdentity,
    quarantineIdentity: plan.quarantine.identity
  };
}

function testNativeInodeAndHardlinkGuards() {
  fixture(({ root, quarantine }) => {
    const target = path.join(root, "target.txt");
    write(target, "planned inode");
    const plan = previewFile(root, quarantine, "target.txt");
    fs.renameSync(target, path.join(root, "old-target.txt"));
    write(target, "replacement inode");
    const replaced = runNative("truncate", nativeOptions(plan));
    assert.equal(replaced.status, "target_drift", JSON.stringify(replaced));
    assert.equal(fs.readFileSync(target, "utf8"), "replacement inode");
  });
  fixture(({ root, quarantine }) => {
    const target = path.join(root, "target.txt");
    write(target, "planned hardlink");
    const plan = previewFile(root, quarantine, "target.txt");
    fs.linkSync(target, path.join(root, "alias.txt"));
    const linked = runNative("truncate", nativeOptions(plan));
    assert.ok(["not_supported", "target_drift"].includes(linked.status), JSON.stringify(linked));
    assert.equal(fs.readFileSync(target, "utf8"), "planned hardlink");
  });
}

function testContentPermissionAndAuthorizationDrift() {
  fixture(({ root, quarantine }) => {
    const target = path.join(root, "target.txt");
    write(target, "same-size-a");
    const contentPlan = previewFile(root, quarantine, "target.txt");
    write(target, "same-size-b");
    const contentResult = safety.execute(confirmed(contentPlan, "content-drift"));
    assert.equal(contentResult.status, "target_drift", JSON.stringify(contentResult));

    write(target, "permission-target");
    const permissionPlan = previewFile(root, quarantine, "target.txt");
    fs.chmodSync(target, 0o600);
    const permissionResult = safety.execute(confirmed(permissionPlan, "permission-drift"));
    assert.equal(permissionResult.status, "target_drift", JSON.stringify(permissionResult));

    fs.chmodSync(target, 0o644);
    const authorizationPlan = previewFile(root, quarantine, "target.txt");
    const invalid = envelope(authorizationPlan, "invalid-fingerprint");
    invalid.planFingerprint = "sha256:invalid";
    const authorizationResult = safety.confirmPlan(authorizationPlan, invalid);
    assert.equal(authorizationResult.status, "authorization_drift", JSON.stringify(authorizationResult));
  });
}

function testIgnoredSecretRecoveryDrill() {
  fixture(({ root, quarantine }) => {
    initGit(root);
    write(path.join(root, ".gitignore"), ".env\n");
    write(path.join(root, "tracked.txt"), "committed\n");
    git(root, ["add", ".gitignore", "tracked.txt"]);
    git(root, ["commit", "-qm", "fixture"]);
    write(path.join(root, "tracked.txt"), "dirty tracked content\n");
    write(path.join(root, "untracked.txt"), "untracked content\n");
    const secret = "SECRET_VALUE_MUST_NOT_APPEAR";
    write(path.join(root, ".env"), secret);
    const plan = previewFile(root, quarantine, ".env");
    assert.equal(plan.affectedSet[0].classification, "ignored");
    const execution = safety.execute(confirmed(plan, "ignored-secret"));
    assert.equal(execution.status, "executed", JSON.stringify(execution));
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), "");
    assert.doesNotMatch(JSON.stringify(execution), new RegExp(secret));
    const restore = safety.previewRestore(execution);
    assert.equal(restore.status, "preview", JSON.stringify(restore));
    assert.equal(restore.plan.previewStats.byteCount, secret.length.toString());
    assert.ok(BigInt(restore.plan.budgets.maxBytes) >= BigInt(secret.length));
    const restored = safety.executeRestore(confirmed(restore.plan, "ignored-secret-restore"));
    assert.equal(restored.status, "restored", JSON.stringify(restored));
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), secret);
  });
}

function testGitRestoreAndRecovery() {
  fixture(({ root, quarantine }) => {
    initGit(root);
    write(path.join(root, "tracked.txt"), "committed content\n");
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-qm", "fixture"]);
    write(path.join(root, "tracked.txt"), "dirty content\n");
    const plan = previewFile(root, quarantine, "tracked.txt", "git_restore_file");
    assert.equal(plan.affectedSet[0].classification, "tracked");
    assert.ok(plan.gitIdentity.worktreeRoot);
    assert.ok(plan.gitIdentity.gitDir);
    assert.ok(plan.gitIdentity.commonDir);
    const execution = safety.execute(confirmed(plan, "git-restore"));
    assert.equal(execution.status, "executed", JSON.stringify(execution));
    assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8"), "committed content\n");
    const restore = safety.previewRestore(execution);
    assert.equal(restore.plan.previewStats.byteCount, "14");
    const restored = safety.executeRestore(confirmed(restore.plan, "git-restore-recovery"));
    assert.equal(restored.status, "restored", JSON.stringify(restored));
    assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8"), "dirty content\n");
  });
}

function testSemanticBypassClassification() {
  const direct = safety.preview({ action: "direct_shell" });
  const raw = safety.preview({ action: "truncate_file", command: "git clean -fdx" });
  const gitClean = safety.preview({ action: "git_clean" });
  const worktree = safety.preview({ action: "worktree_remove" });
  assert.equal(direct.status, "not_covered");
  assert.equal(raw.status, "not_covered");
  assert.equal(gitClean.status, "not_supported");
  assert.equal(worktree.status, "not_supported");
  assert.equal(direct.guarantee, "ravo_guarded");
  assert.ok(direct.notCovered.includes("direct_shell"));
}

function testAffectedSetGrowth() {
  fixture(({ root, quarantine }) => {
    const directory = path.join(root, "batch");
    fs.mkdirSync(directory);
    for (let index = 1; index <= 5; index += 1) write(path.join(directory, `file-${index}.txt`), `item-${index}`);
    const preview = safety.preview({
      action: "truncate_directory_files",
      authorizedRoot: root,
      targetDirectory: "batch",
      recovery: { quarantineDir: quarantine },
      budgets: { maxItems: 6, maxBytes: 1000, maxDepth: 2, allowedTypes: ["file"] }
    });
    assert.equal(preview.status, "preview", JSON.stringify(preview));
    assert.equal(preview.plan.affectedSet.length, 5);
    write(path.join(directory, "file-6.txt"), "item-6");
    const result = safety.execute(confirmed(preview.plan, "affected-set"));
    assert.equal(result.status, "safety_violation", JSON.stringify(result));
    assert.deepEqual(result.receipt.attemptedSet, []);
    assert.equal(fs.readFileSync(path.join(directory, "file-1.txt"), "utf8"), "item-1");
  });
}

function testReceiptReconciliation() {
  fixture(({ root, quarantine }) => {
    write(path.join(root, "target.txt"), "planned");
    const plan = previewFile(root, quarantine, "target.txt");
    const result = safety.reconcile(plan, {
      items: [
        { id: plan.affectedSet[0].id, attempted: true, result: "succeeded" },
        { id: "unexpected-item", attempted: true, result: "succeeded" }
      ]
    });
    assert.equal(result.status, "safety_violation");
  });
}

function testRetryDenied() {
  fixture(({ root, quarantine }) => {
    write(path.join(root, "target.txt"), "retry target");
    const plan = previewFile(root, quarantine, "target.txt");
    const approved = confirmed(plan, "retry");
    const first = safety.execute(approved);
    assert.equal(first.status, "executed", JSON.stringify(first));
    const second = safety.execute(approved);
    assert.equal(second.status, "retry_denied", JSON.stringify(second));
  });
}

function testExpiredRestoreRejected() {
  fixture(({ root, quarantine }) => {
    write(path.join(root, "target.txt"), "restore expiry");
    const mutationPlan = previewFile(root, quarantine, "target.txt");
    const mutation = safety.execute(confirmed(mutationPlan, "restore-expiry-mutation"));
    assert.equal(mutation.status, "executed", JSON.stringify(mutation));
    const restore = safety.previewRestore(mutation);
    const approved = confirmed(restore.plan, "restore-expiry");
    const expired = safety.executeRestore(approved, new Date(Date.parse(restore.plan.expiresAt) + 1).toISOString());
    assert.equal(expired.status, "expired", JSON.stringify(expired));
    assert.equal(fs.readFileSync(path.join(root, "target.txt"), "utf8"), "");
  });
}

testNativeProbe();
testCliPreview();
testEvidenceArtifact();
testTargetMissing();
testNestedQuarantineRejected();
testTargetSymlinkDrift();
testAncestorSymlinkDrift();
testHardlinkRejected();
testNativeInodeAndHardlinkGuards();
testContentPermissionAndAuthorizationDrift();
testIgnoredSecretRecoveryDrill();
testGitRestoreAndRecovery();
testSemanticBypassClassification();
testAffectedSetGrowth();
testReceiptReconciliation();
testRetryDenied();
testExpiredRestoreRejected();

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "macOS native no-follow/beneath/unique probe",
    "Safety Executor CLI preview",
    "redacted preview, receipt, and recovery-drill evidence artifact",
    "target missing",
    "nested quarantine rejection",
    "target and ancestor symlink drift",
    "hardlink rejection",
    "native inode replacement and hardlink guards",
    "content, permission, and authorization drift",
    "dirty tracked plus untracked and ignored secret recovery drill",
    "Git restore with recovery drill",
    "semantic command bypass and Worktree classification",
    "affected-set growth",
    "receipt reconciliation",
    "same-plan retry denial",
    "expired restore rejection"
  ]
}, null, 2));
