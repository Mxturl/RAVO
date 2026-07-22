#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const safety = require("../plugins/ravo/modules/ravo-safety/scripts/safety-model");

function valueFor(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function envelope(plan, id) {
  const request = safety.authorizationRequestFor(plan);
  return {
    id,
    confirmedBy: "fixture-pm",
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
    sourceRef: "fixture:structured-confirmation",
    status: "active"
  };
}

function redactPlan(plan) {
  return {
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    action: plan.action,
    guarantee: plan.guarantee,
    rootIdentity: plan.rootIdentity,
    quarantineIdentity: plan.quarantine.identity,
    affectedSet: plan.affectedSet.map((item) => ({
      id: item.id,
      logicalPath: item.logicalPath,
      targetIdentity: item.targetIdentity,
      classification: item.classification,
      recovery: { kind: item.recovery.kind, snapshotName: item.recovery.snapshotName }
    })),
    budgets: plan.budgets,
    previewStats: plan.previewStats,
    notCovered: plan.notCovered
  };
}

function redactReceipt(receipt) {
  return {
    planId: receipt.planId,
    planFingerprint: receipt.planFingerprint,
    action: receipt.action,
    status: receipt.status,
    guarantee: receipt.guarantee,
    attemptedSet: receipt.attemptedSet,
    actualAffectedSet: receipt.actualAffectedSet,
    reconciliation: receipt.reconciliation,
    items: receipt.items.map((item) => ({
      id: item.id,
      attempted: item.attempted,
      result: item.result,
      actualIdentity: item.actualIdentity,
      recovery: item.recovery ? { kind: item.recovery.kind, snapshotName: item.recovery.snapshotName, sourceIdentity: item.recovery.sourceIdentity } : null
    }))
  };
}

function updateManifest(workspace, artifactPath) {
  const manifestPath = path.join(workspace, "knowledge", ".ravo", "manifest.json");
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_error) { manifest = { schemaVersion: "0.5.1", workspace: ".", modules: {} }; }
  manifest.modules = manifest.modules || {};
  manifest.modules.safety = {
    ...(manifest.modules.safety || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/safety"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(valueFor("--workspace") || process.cwd());
  const outputRef = valueFor("--output");
  if (!outputRef) throw new Error("--output <workspace-relative-json-path> is required.");
  const output = path.resolve(workspace, outputRef);
  if (!output.startsWith(`${workspace}${path.sep}`)) throw new Error("--output must stay inside the workspace.");
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-safety-evidence-")));
  try {
    const root = path.join(temporary, "root");
    const quarantine = path.join(temporary, "quarantine");
    const target = path.join(root, "controlled.txt");
    fs.mkdirSync(root);
    fs.mkdirSync(quarantine);
    fs.writeFileSync(target, "controlled preimage\n", "utf8");
    const preview = safety.preview({
      action: "truncate_file",
      authorizedRoot: root,
      target: "controlled.txt",
      recovery: { quarantineDir: quarantine }
    });
    assert.equal(preview.status, "preview", JSON.stringify(preview));
    const confirmed = safety.confirmPlan(preview.plan, envelope(preview.plan, "fixture-mutation"));
    assert.equal(confirmed.status, "confirmed", JSON.stringify(confirmed));
    const mutation = safety.execute(confirmed.confirmedPlan);
    assert.equal(mutation.status, "executed", JSON.stringify(mutation));
    assert.equal(fs.readFileSync(target, "utf8"), "");
    const restorePreview = safety.previewRestore(mutation);
    assert.equal(restorePreview.status, "preview", JSON.stringify(restorePreview));
    const restoreConfirmed = safety.confirmPlan(restorePreview.plan, envelope(restorePreview.plan, "fixture-restore"));
    assert.equal(restoreConfirmed.status, "confirmed", JSON.stringify(restoreConfirmed));
    const restore = safety.executeRestore(restoreConfirmed.confirmedPlan);
    assert.equal(restore.status, "restored", JSON.stringify(restore));
    assert.equal(fs.readFileSync(target, "utf8"), "controlled preimage\n");
    const artifact = {
      schemaVersion: "0.5.8",
      id: `safety-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      subjectRef: "ravo-v0.5.8-data-safety",
      releaseRef: "ravo-v0.5.8-data-safety",
      status: "pass",
      guarantee: "ravo_guarded",
      action: "truncate_file",
      createdAt: new Date().toISOString(),
      preview: redactPlan(preview.plan),
      mutationReceipt: redactReceipt(mutation.receipt),
      restorePreview: redactPlan(restorePreview.plan),
      restoreReceipt: redactReceipt(restore.receipt),
      recoveryDrill: { status: "pass", restoredExactPreimage: true },
      notCovered: preview.plan.notCovered,
      dataBoundary: "fixture-only; no credentials, customer data, local workspace paths, or secret values were written"
    };
    writeJson(output, artifact);
    const manifestPath = updateManifest(workspace, output);
    process.stdout.write(`${JSON.stringify({ status: "pass", artifactPath: output, manifestPath }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`ravo-safety-evidence failed: ${error.message}\n`);
  process.exitCode = 1;
}
