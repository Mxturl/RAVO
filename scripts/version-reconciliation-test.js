#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  planningGate,
  releaseCandidates,
  scanVersionInventory,
  versionList
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-version-reconciliation");

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "RAVO Test",
  GIT_AUTHOR_EMAIL: "ravo@example.invalid",
  GIT_COMMITTER_NAME: "RAVO Test",
  GIT_COMMITTER_EMAIL: "ravo@example.invalid"
};

function git(cwd, args) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function document(version, releaseSlice, requirement) {
  return `# RAVO ${version}\n\nStatus: decision-complete\n\nRelease Slice: \`${releaseSlice}\`\n\nRequirement Set: \`${requirement}\`\n`;
}

function pool(version, releaseSlice, requirement, acceptedAt) {
  return {
    id: `WI-${version}-${releaseSlice}`.replace(/[^a-z0-9]+/gi, "-"),
    committedVersion: version,
    releaseSlice,
    legacyIds: [requirement],
    pmAcceptanceStatus: "accepted",
    pmAcceptedAt: acceptedAt,
    pmFeedback: "Explicit PM acceptance for this bound scope.",
    deliveryStatus: "code_complete",
    releaseStatus: "planned",
    sourceRefs: ["docs/ravo-v0.5.11-decision-complete-spec-zh.md"]
  };
}

function createRepository(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(root, ["init", "-q"]);
  write(path.join(root, "docs", "ravo-v0.5.9-spec.md"), document("v0.5.9", "ravo-v0.5.9-fixture", "R509-001"));
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "initial"]);
  return root;
}

const root = createRepository("ravo-version-reconciliation-");
const detached = `${root}-detached`;
const conflictRoot = createRepository("ravo-version-conflict-");

try {
  assert.deepEqual(versionList("ravo-v0-5-10-spec.md"), ["v0.5.10"], "hyphenated version references normalize to semver");
  git(root, ["worktree", "add", "--detach", "-q", detached, "HEAD"]);
  const slice = "ravo-v0.5.10-fixture";
  write(path.join(detached, "docs", "ravo-v0.5.10-spec.md"), document("v0.5.10", slice, "R510-001"));
  write(path.join(detached, "knowledge", ".ravo", "pool", "items", "v010.json"), JSON.stringify(pool("v0.5.10", slice, "R510-001", "2026-01-02T00:00:00.000Z")));
  write(path.join(detached, "knowledge", ".ravo", "pool", "items", "old-baseline.json"), JSON.stringify({
    ...pool("v0.5.10", slice, "R510-001", "2025-01-01T00:00:00.000Z"),
    releaseCommit: git(root, ["rev-parse", "HEAD"])
  }));
  write(path.join(detached, "knowledge", ".ravo", "acceptance", "old-v010.json"), JSON.stringify({
    subjectRef: "legacy-v0.5.10-evidence",
    specRef: "docs/ravo-v0.5.10-spec.md",
    status: "not_ready",
    createdAt: "2026-01-01T00:00:00.000Z"
  }));

  const inventory = scanVersionInventory(root);
  const accepted = inventory.versions.find((item) => item.version === "v0.5.10");
  assert.equal(inventory.scanStatus, "complete", "V1 fixture scan is complete");
  assert.equal(inventory.worktrees.length, 2, "V6 scans every registered worktree");
  assert.equal(inventory.latestAcceptedVersion, "v0.5.10", "V1 finds accepted detached dirty worktree");
  assert.equal(inventory.nextVersionCandidate, "v0.5.11", "V1 increments the accepted version");
  assert.equal(inventory.versions.some((item) => item.version === "v0.5.11"), false, "source references do not become version ownership");
  assert.equal(accepted.productState, "accepted", "V3 PM evidence supersedes old not_ready acceptance");
  assert.equal(accepted.engineeringState, "dirty_detached", "V1 keeps product and engineering states independent");
  assert.ok(accepted.supersededEvidenceRefs.includes("knowledge/.ravo/acceptance/old-v010.json"), "V3 exposes old evidence as superseded");
  assert.equal(planningGate(inventory, "v0.5.10").status, "version_exists", "V2 blocks duplicate planning");
  assert.equal(planningGate(inventory, "v0.5.11").status, "available", "V2 permits an unused version");

  write(path.join(detached, "knowledge", ".ravo", "pool", "items", "v010-second-requirement.json"), JSON.stringify(pool("v0.5.10", slice, "R510-002", "2026-01-03T00:00:00.000Z")));
  const multiRequirement = scanVersionInventory(root).versions.find((item) => item.version === "v0.5.10");
  assert.equal(multiRequirement.productState, "accepted", "same-slice accepted requirements are compatible");

  const candidates = releaseCandidates(inventory);
  assert.equal(candidates.find((item) => item.version === "v0.5.10").releaseDestination, "blocked", "V10 does not call a dirty source release-ready");
  assert.equal(candidates.some((item) => item.releaseState === "release_ready"), false, "V10 never infers release-ready from local evidence");
  assert.equal(JSON.stringify(inventory.pmBrief).includes(root), false, "V12 PM summary has no absolute workspace path");

  const incomplete = scanVersionInventory(root, {
    worktrees: [
      { path: root, head: git(root, ["rev-parse", "HEAD"]), branch: "master", detached: false },
      { path: path.join(root, "missing-worktree"), head: "0000000", branch: "", detached: true }
    ]
  });
  assert.equal(incomplete.scanStatus, "incomplete", "V5 marks an unreadable worktree incomplete");
  assert.equal(incomplete.nextVersionCandidate, null, "V5 does not guess a next version");
  assert.equal(planningGate(incomplete, "v0.5.11").status, "version_inventory_incomplete", "V5 blocks planning while incomplete");

  write(path.join(conflictRoot, "docs", "ravo-v0.5.10-spec.md"), document("v0.5.10", "ravo-v0.5.10-alpha", "R510-001"));
  write(path.join(conflictRoot, "knowledge", ".ravo", "pool", "items", "alpha.json"), JSON.stringify(pool("v0.5.10", "ravo-v0.5.10-alpha", "R510-001", "2026-01-01T00:00:00.000Z")));
  write(path.join(conflictRoot, "knowledge", ".ravo", "pool", "items", "beta.json"), JSON.stringify(pool("v0.5.10", "ravo-v0.5.10-beta", "R510-002", "2026-01-03T00:00:00.000Z")));
  const conflict = scanVersionInventory(conflictRoot).versions.find((item) => item.version === "v0.5.10");
  assert.equal(conflict.productState, "unknown", "V4 keeps incompatible PM scopes parallel instead of overwriting");
  assert.ok(conflict.conflicts.some((item) => item.type === "status_conflict"), "V4 reports the scope conflict");

  console.log(JSON.stringify({
    status: "pass",
    checks: ["V1", "V2", "V3", "V4", "V5", "V6", "V10", "V12"]
  }, null, 2));
} finally {
  try { git(root, ["worktree", "remove", "--force", detached]); } catch (_error) { /* temp fixture cleanup */ }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(detached, { recursive: true, force: true });
  fs.rmSync(conflictRoot, { recursive: true, force: true });
}
