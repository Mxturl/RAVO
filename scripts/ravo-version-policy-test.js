#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  aggregateChangeLevel,
  nextPatchAfterRollback,
  parallelDependencyStatus,
  predecessorBaselineStatus,
  recommendation,
  scopeExpansionStatus,
  validateVersionBuildEvidence,
  versionAnomalies,
  versionLockStatus
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-version-policy");
const { checkSpecHealth } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt");
const { pmDocFor } = require("../plugins/ravo/modules/ravo-acceptance/scripts/write-acceptance-artifact");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "RAVO Test",
      GIT_AUTHOR_EMAIL: "ravo@example.invalid",
      GIT_COMMITTER_NAME: "RAVO Test",
      GIT_COMMITTER_EMAIL: "ravo@example.invalid"
    }
  }).trim();
}

function policy(patchAutoAssign = false) {
  return {
    schemaVersion: "1.0",
    scheme: "product-semver",
    effectiveAfter: "v0.5.12",
    bootstrapVersion: "v0.5.12",
    patchAutoAssign,
    versionAuthority: { major: "pm", minor: "pm", patch: "pm_or_preapproved" },
    buildNumberPolicy: "project_defined_monotonic"
  };
}

function item(overrides = {}) {
  return {
    id: "WI-version-fixture",
    legacyIds: ["R512-001"],
    confirmationStatus: "confirmed",
    decisionStatus: "approved",
    scopeClass: "must_ship",
    changeLevel: "patch",
    lockedChangeLevel: "patch",
    baseVersion: "v0.5.11",
    committedVersion: "v0.5.12",
    releaseSlice: "ravo-v0.5.12-product-version-governance",
    gitBaseline: "git-commit:fixture",
    predecessorVersion: "v0.5.11",
    predecessorBaselineRef: "git-commit:fixture",
    versionDecisionOwner: "pm",
    versionDecisionReason: "PM confirmed the v0.5.12 bootstrap version.",
    versionDecisionAt: "2026-07-17T00:00:00.000Z",
    ...overrides
  };
}

assert.equal(recommendation({ baseVersion: "v1.4.7", changeLevel: "major" }).recommendedVersion, "v2.0.0", "V1");
assert.equal(recommendation({ baseVersion: "v1.4.7", changeLevel: "minor" }).recommendedVersion, "v1.5.0", "V2");
assert.equal(recommendation({ baseVersion: "v1.4.7", changeLevel: "patch" }).recommendedVersion, "v1.4.8", "V3");
assert.equal(recommendation({ baseVersion: "v1.4.7", changeLevel: "none" }).recommendedVersion, "v1.4.7", "V4");
assert.equal(aggregateChangeLevel(["patch", "minor"]), "minor", "V5");
assert.ok(versionAnomalies({ baseVersion: "v1.0.10", level: "major", committedVersion: "v2.0.1" }).includes("major_low_components_not_reset"), "V6");

const missingPm = versionLockStatus({ policy: policy(), items: [item({ changeLevel: "minor", committedVersion: "v0.6.0", versionDecisionOwner: "", versionDecisionReason: "", versionDecisionAt: "" })] });
assert.equal(missingPm.status, "version_classification_pending", "V7");
assert.equal(versionLockStatus({ policy: policy(false), items: [item({ versionDecisionOwner: "", versionDecisionReason: "", versionDecisionAt: "" })] }).status, "version_classification_pending", "V8");
assert.equal(versionLockStatus({ policy: policy(true), items: [item({ versionDecisionOwner: "policy", versionDecisionReason: "Patch preauthorization is active.", versionDecisionAt: "" })] }).status, "version_locked", "V9");
assert.equal(versionLockStatus({ policy: policy(), items: [item({ committedVersion: "" })] }).status, "version_classification_pending", "V10");
assert.equal(versionLockStatus({
  policy: policy(),
  items: [item({ baseVersion: "v0.5.13", committedVersion: "v0.5.14", predecessorVersion: "v0.5.13" })]
}).status, "version_locked", "V10 later patches use their actual base version");
assert.equal(versionLockStatus({
  policy: policy(),
  items: [item({ baseVersion: "v0.5.13", committedVersion: "v0.5.14", predecessorVersion: "v0.5.11" })]
}).status, "base_dependency_pending", "V10 stale predecessor metadata is rejected");
assert.equal(scopeExpansionStatus("patch", [item({ changeLevel: "minor" })]).status, "stale", "V11");

assert.equal(validateVersionBuildEvidence({ targetProductVersion: "v0.5.12", verificationStatus: "not_built" }).status, "not_built", "V12");
const built = {
  targetProductVersion: "v0.5.12",
  productVersion: "v0.5.12",
  buildNumber: 11068,
  releaseChannel: "staging",
  artifactRef: "artifacts/ravo-v0.5.12.zip",
  verificationCommandRef: "node scripts/version-check.js",
  verificationStatus: "verified",
  observedVersion: "v0.5.12",
  observedBuildNumber: 11068,
  createdAt: "2026-07-17T00:00:00.000Z",
  sourceRefs: ["scripts/version-check.js"],
  previousBuildNumbers: [11067]
};
assert.equal(validateVersionBuildEvidence(built).status, "verified", "V13");
assert.equal(validateVersionBuildEvidence({ ...built, previousBuildNumbers: [11068] }).status, "build_version_unverified", "V14");
const buildEvidenceDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-build-evidence-")));
try {
  const evidencePath = path.join(buildEvidenceDir, "ravo-version-build-evidence.json");
  write(evidencePath, `${JSON.stringify(built, null, 2)}\n`);
  const checked = spawnSync(process.execPath, [path.join(__dirname, "ravo-version-build-evidence.js"), "--evidence", evidencePath, "--require-built"], { encoding: "utf8" });
  assert.equal(checked.status, 0, "project-owned version/build evidence command accepts a verified build");
} finally {
  fs.rmSync(buildEvidenceDir, { recursive: true, force: true });
}
assert.equal(parallelDependencyStatus({ releasedPatchVersion: "v1.4.8", dependencyIds: [] }).status, "release_dependency_pending", "V15 pending");
assert.equal(parallelDependencyStatus({ releasedPatchVersion: "v1.4.8", dependencyIds: ["includes:v1.4.8"] }).status, "current", "V15 recorded");
assert.equal(versionLockStatus({
  policy: policy(),
  items: [item({ baseVersion: "v1.4.7", committedVersion: "v1.4.8" })],
  entries: [{ releaseSlice: "another-slice", versionBuildEvidence: { productVersion: "v1.4.8" } }]
}).status, "version_conflict", "V16");
assert.equal(nextPatchAfterRollback("v1.4.8"), "v1.4.9", "V17");

const pmDoc = pmDocFor({
  pmBrief: { headline: "版本治理验证", productState: "validated", userImpact: "状态分离可见", actionRequired: "none", nextStep: "等待 PM 体验" },
  acceptanceScope: "release",
  pmDecision: null,
  nextStep: "等待 PM 体验",
  versionGovernanceRequired: true,
  versionBuildEvidence: { targetProductVersion: "v0.5.12", verificationStatus: "not_built" },
  releaseRecord: { releaseStatus: "not_released" },
  acceptanceItems: [],
  sourceRefs: [], evidence: [], realResponseRefs: [], screenshotRefs: [], dataEvidenceRefs: [], notApplicableEvidence: [], unmetItems: [], knownGaps: [], pmGaps: []
});
assert.match(pmDoc, /尚未具备发布条件/, "V18 release readiness separation");
assert.match(pmDoc, /没有发布/, "V18 release separation");

function acceptanceItem() {
  return {
    id: "version-governance",
    name: "版本治理",
    required: true,
    expected: "版本、构建、验收与发布状态独立呈现。",
    implementation: "使用结构化版本构建证据。",
    effect: "PM 可以区分未构建和未发布。",
    fulfillmentStatus: "met",
    verificationStatus: "verified",
    verificationOwner: "codex",
    verificationReason: "定向测试通过。",
    verificationTasks: [],
    sourceRefs: ["scripts/ravo-version-policy-test.js"],
    risk: "",
    boundary: "不修改产品版本文件。",
    blockingReason: "",
    blockerImpact: "",
    temporaryFallback: "",
    recoveryEntry: "",
    dependencyImpact: ""
  };
}

const acceptanceWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-v0-5-12-acceptance-")));
try {
  write(path.join(acceptanceWorkspace, "docs", "spec.md"), "# RAVO v0.5.12 Fixture\n\nR512-001\n");
  const writer = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "write-acceptance-artifact.js");
  const result = spawnSync(process.execPath, [writer,
    "--workspace", acceptanceWorkspace,
    "--status", "pending_acceptance",
    "--evidence-level", "real_e2e",
    "--summary", "版本治理验收包",
    "--subject-ref", "ravo-v0.5.12-product-version-governance",
    "--spec-ref", "docs/spec.md",
    "--release-ref", "ravo-v0.5.12-product-version-governance",
    "--real-response-ref", "evidence/fresh-session.txt",
    "--not-applicable-evidence", "无图形界面，使用真实响应作为替代证据。",
    "--version-build-evidence", JSON.stringify({ targetProductVersion: "v0.5.12", verificationStatus: "not_built" }),
    "--release-record", JSON.stringify({ releaseStatus: "not_released" }),
    "--acceptance-item", JSON.stringify(acceptanceItem())
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, `V18 writer: ${result.stderr}`);
  const written = JSON.parse(result.stdout);
  const checker = path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "check-ravo-acceptance.js");
  const checked = spawnSync(process.execPath, [checker, "--acceptance-artifact", path.relative(acceptanceWorkspace, written.artifactPath)], { cwd: acceptanceWorkspace, encoding: "utf8" });
  assert.equal(checked.status, 0, `V18 checker: ${checked.stderr}`);
  const gate = JSON.parse(checked.stdout);
  assert.equal(gate.checks.find((entry) => entry.id === "versionBuildEvidence").status, "pass", "V18 version/build gate");
} finally {
  fs.rmSync(acceptanceWorkspace, { recursive: true, force: true });
}

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-v0-5-12-goal-")));
try {
  git(workspace, ["init", "-q"]);
  write(path.join(workspace, "README.md"), "fixture\n");
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "baseline"]);
  const baseline = git(workspace, ["rev-parse", "HEAD"]);
  write(path.join(workspace, "ravo-version-policy.json"), `${JSON.stringify(policy(), null, 2)}\n`);
  write(path.join(workspace, "docs", "alignment.md"), "# RAVO v0.5.12 Alignment\n\n状态：PM 已确认\n\n候选 Release Slice：`ravo-v0.5.12-product-version-governance`\n\n需求集合：`R512-001`\n");
  write(path.join(workspace, "docs", "spec.md"), "# RAVO v0.5.12 Version Governance\n\nStatus: decision-complete\n\nAlignmentRef: `docs/alignment.md`\n\nRelease Slice: `ravo-v0.5.12-product-version-governance`\n\nRequirement Set: `R512-001`\n\n## 产品定义\n\n- fixture\n\n## 模块契约\n\n- fixture\n\n## 验证矩阵\n\n- fixture\n\n## 触发规则\n\n- fixture\n\n## 假设\n\n- fixture\n");
  const entry = item({ predecessorBaselineRef: `git-commit:${baseline}`, gitBaseline: `git-commit:${baseline}`, detailRef: "knowledge/.ravo/pool/items/WI-version-fixture.json" });
  write(path.join(workspace, "knowledge", ".ravo", "pool", "index.json"), JSON.stringify({ entries: [entry] }, null, 2));
  assert.equal(checkSpecHealth(workspace, "docs/spec.md").status, "current", "Goal gate locks v0.5.12 only with policy, decision, and ancestry");
  write(path.join(workspace, "knowledge", ".ravo", "pool", "index.json"), JSON.stringify({ entries: [{ ...entry, changeLevel: "minor" }] }, null, 2));
  assert.equal(checkSpecHealth(workspace, "docs/spec.md").status, "stale", "V11 Goal becomes stale before a scope upgrade can be treated as a version anomaly");
  assert.equal(predecessorBaselineStatus(workspace, "git-commit:deadbeef").status, "base_dependency_pending", "V20");
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: "pass",
  checks: ["V1-V18", "V20", "Goal version gate", "PM version/build/release presentation"]
}, null, 2));
