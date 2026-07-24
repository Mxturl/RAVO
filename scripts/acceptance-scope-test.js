#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-acceptance-scope-")));
const workstreamWriter = path.join(repo, "plugins", "ravo", "modules", "ravo-workstream", "scripts", "write-workstream-artifact.js");
const acceptanceWriter = path.join(repo, "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "write-acceptance-artifact.js");
const acceptanceChecker = path.join(repo, "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "check-ravo-acceptance.js");
const { buildResult, formalReviewTelemetryErrors, resolveReviewDispositionModulePath } = require(acceptanceChecker);
const { resolveGitBaselineModulePath } = require("../plugins/ravo/modules/ravo-acceptance/scripts/prepare-acceptance-baseline");
const { acceptanceScope, validateOverallStatus } = require("../plugins/ravo/modules/ravo-acceptance/scripts/acceptance-model");
const { formalReviewTelemetry } = require("./fixtures/review-v0.5.1-telemetry");

function run(script, args) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd: workspace, encoding: "utf8" }));
}

fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });

const installedAcceptanceScripts = path.join(workspace, "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-acceptance", "scripts");
const installedCoreScript = path.join(workspace, "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-core", "scripts", "ravo-git-baseline.js");
const installedReviewScript = path.join(workspace, "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-review", "scripts", "review-disposition.js");
fs.mkdirSync(installedAcceptanceScripts, { recursive: true });
fs.mkdirSync(path.dirname(installedCoreScript), { recursive: true });
fs.mkdirSync(path.dirname(installedReviewScript), { recursive: true });
fs.writeFileSync(installedCoreScript, "module.exports = {};\n", "utf8");
fs.writeFileSync(installedReviewScript, "module.exports = { checkLedger() { return { status: 'pass', unresolvedHigh: [] }; } };\n", "utf8");
assert.equal(resolveGitBaselineModulePath(installedAcceptanceScripts), installedCoreScript, "installed Acceptance module resolves unified sibling Core");
assert.equal(resolveReviewDispositionModulePath(installedAcceptanceScripts), installedReviewScript, "installed Acceptance module resolves unified sibling Review");

const specText = "# Spec\n\nStatus: accepted\n\nIf the second Provider is unavailable, the required cross-provider evidence may remain blocked_external with explicit impact, fallback, recovery, and PM decision.\n";
fs.writeFileSync(path.join(workspace, "docs", "spec.md"), specText, "utf8");

const lanes = {
  development: { milestoneRef: "M3", status: "active" },
  acceptance: { milestoneRef: "M2", baselineRef: "git-tree:abc", acceptanceArtifact: "pending", status: "in_progress", automatedChecksPassed: true },
  recovery: { status: "inactive", workers: [] }
};
const workstream = run(workstreamWriter, [
  "--workspace", workspace,
  "--status", "active",
  "--goal", "Milestone acceptance fixture",
  "--subject-ref", "milestone-subject",
  "--release-ref", "v0.5.1",
  "--spec-ref", "docs/spec.md",
  "--current-milestone", "M3",
  "--next-step", "Continue M3 independently.",
  "--execution-lanes-json", JSON.stringify(lanes)
]);
const workstreamRef = path.relative(workspace, workstream.artifactPath);
const item = {
  id: "m2-pm",
  name: "M2 PM check",
  required: true,
  expected: "The M2 lineage behavior is understandable.",
  implementation: "The UI exposes selection reasons and relations.",
  effect: "PM can distinguish current development from release acceptance.",
  fulfillmentStatus: "met",
  verificationStatus: "pending_pm",
  verificationOwner: "pm",
  verificationReason: "Product scanability needs PM judgment.",
  verificationTasks: [{
    id: "m2-pm-task",
    claim: "Inspect the milestone evidence view.",
    reason: "A human product judgment is required.",
    owner: "pm",
    preconditions: ["Open the fixture evidence view."],
    steps: ["Check the selected workstream and acceptance labels."],
    expectedResult: "The relationship is understandable without reading raw JSON.",
    evidenceRequired: ["PM result"],
    failureAction: "Record the confusing label and reopen M2.",
    blocking: false
  }],
  sourceRefs: ["git-tree:abc"],
  risk: "Milestone acceptance does not prove release completion.",
  boundary: "Only M2 is under acceptance.",
  blockingReason: "",
  blockerImpact: "",
  temporaryFallback: "",
  recoveryEntry: "",
  dependencyImpact: "A blocking M2 contract finding pauses dependent M3 work."
};
const acceptance = run(acceptanceWriter, [
  "--workspace", workspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "M2 milestone evidence is ready for PM judgment.",
  "--acceptance-scope", "milestone",
  "--milestone-ref", "M2",
  "--baseline-ref", "git-tree:abc",
  "--subject-ref", "milestone-subject",
  "--spec-ref", "docs/spec.md",
  "--workstream-artifact", workstreamRef,
  "--acceptance-item", JSON.stringify(item),
  "--source-ref", "git-tree:abc",
  "--real-response-ref", "evidence/response.txt",
  "--screenshot-ref", "evidence/screenshot.png",
  "--next-step", "PM reviews the M2 milestone package."
]);
const acceptanceRef = path.relative(workspace, acceptance.artifactPath);
const checked = run(acceptanceChecker, ["--acceptance-artifact", acceptanceRef]);
assert.equal(checked.status, "ready");
assert.equal(checked.acceptanceScope, "milestone");
assert.equal(checked.releaseEligible, false);
assert.match(checked.gate.reason, /release status is unchanged/);

const externalBlockerItem = {
  ...item,
  id: "m2-external-provider",
  name: "Cross-provider evidence",
  verificationStatus: "blocked",
  verificationOwner: "external",
  verificationReason: "A second external Provider and authorization are unavailable.",
  verificationTasks: [{
    id: "m2-external-provider-recovery",
    claim: "Run one model on each of two distinct Providers.",
    reason: "Cross-provider evidence requires an independently configured external endpoint.",
    owner: "external",
    preconditions: ["Configure and authorize a second Provider."],
    steps: ["Preview the two-Provider plan.", "Run the bounded formal Review."],
    expectedResult: "Both Provider attempts and coverage are independently recorded.",
    evidenceRequired: ["Review artifact", "Provider/model attempt telemetry"],
    failureAction: "Keep the item blocked_external and retain the fallback.",
    blocking: true
  }],
  blockingReason: "Only one Provider is configured.",
  blockerImpact: "True cross-provider compatibility remains unverified.",
  temporaryFallback: "Use the verified single-Provider multi-model path without claiming cross-provider coverage.",
  recoveryEntry: "Configure and authorize a second Provider, then run the bounded E2E.",
  blockerExecutionStatus: "blocked_external",
  externalBlockerSpecRef: "docs/spec.md",
  externalBlockerSpecAnchor: "If the second Provider is unavailable",
  externalBlockerDecision: "pending_pm"
};
const externalBlockerAcceptance = run(acceptanceWriter, [
  "--workspace", workspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "M2 is ready with one Spec-allowed external evidence blocker.",
  "--acceptance-scope", "milestone",
  "--milestone-ref", "M2",
  "--baseline-ref", "git-tree:abc",
  "--subject-ref", "milestone-subject",
  "--spec-ref", "docs/spec.md",
  "--workstream-artifact", workstreamRef,
  "--acceptance-item", JSON.stringify(externalBlockerItem),
  "--source-ref", "git-tree:abc",
  "--real-response-ref", "evidence/response.txt",
  "--screenshot-ref", "evidence/screenshot.png"
]);
const externalBlockerArtifact = JSON.parse(fs.readFileSync(externalBlockerAcceptance.artifactPath, "utf8"));
assert.equal(externalBlockerArtifact.statusCeiling, "pending_acceptance");
assert.deepEqual(externalBlockerArtifact.pmChecklistItemIds, ["m2-external-provider"]);
const externalBlockerPmDoc = fs.readFileSync(externalBlockerAcceptance.pmChecklistPath, "utf8");
assert.match(externalBlockerPmDoc, /仍有外部条件未满足/);
assert.match(externalBlockerPmDoc, /## 需要你的判断/);
const checkedExternalBlocker = run(acceptanceChecker, ["--acceptance-artifact", path.relative(workspace, externalBlockerAcceptance.artifactPath)]);
assert.equal(checkedExternalBlocker.status, "ready");
assert.equal(checkedExternalBlocker.externalBlockers[0].allowedBySpec, true);
assert.match(checkedExternalBlocker.gate.reason, /blocked_external.*PM degradation decision/);

const releasePendingAcceptance = run(acceptanceWriter, [
  "--workspace", workspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Release evidence is ready for PM judgment, not release.",
  "--acceptance-scope", "release",
  "--subject-ref", "milestone-subject",
  "--release-ref", "milestone-subject",
  "--spec-ref", "docs/spec.md",
  "--workstream-artifact", workstreamRef,
  "--acceptance-item", JSON.stringify(item),
  "--real-response-ref", "evidence/response.txt",
  "--screenshot-ref", "evidence/screenshot.png"
]);
const checkedReleasePending = run(acceptanceChecker, ["--acceptance-artifact", path.relative(workspace, releasePendingAcceptance.artifactPath)]);
assert.equal(checkedReleasePending.status, "ready");
assert.equal(checkedReleasePending.acceptanceScope, "release");
assert.equal(checkedReleasePending.acceptanceStatus, "pending_acceptance");
assert.equal(checkedReleasePending.releaseEligible, false);

const invalidAnchor = spawnSync(process.execPath, [acceptanceWriter,
  "--workspace", workspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Invalid external blocker allowance anchor.",
  "--acceptance-scope", "milestone",
  "--milestone-ref", "M2",
  "--baseline-ref", "git-tree:abc",
  "--subject-ref", "milestone-subject",
  "--spec-ref", "docs/spec.md",
  "--workstream-artifact", workstreamRef,
  "--acceptance-item", JSON.stringify({ ...externalBlockerItem, externalBlockerSpecAnchor: "missing allowance anchor" }),
  "--real-response-ref", "evidence/response.txt",
  "--screenshot-ref", "evidence/screenshot.png"
], { cwd: workspace, encoding: "utf8" });
assert.notEqual(invalidAnchor.status, 0);
assert.match(invalidAnchor.stderr, /exceeds item evidence ceiling not_ready/);

const acceptedExternal = validateOverallStatus({
  ...externalBlockerArtifact,
  acceptanceScope: "release",
  milestoneRef: "",
  baselineRef: "",
  status: "accepted",
  evidenceLevel: "smoke",
  externalBlockerDecisionRef: "",
  acceptanceItems: [{ ...externalBlockerItem, externalBlockerDecision: "accepted", externalBlockerDecisionRef: "pm:accepted-degradation" }],
  securityChecklist: ["data_privacy", "credentials", "permissions", "destructive_actions", "external_calls", "dependencies", "logs_artifacts", "global_knowledge"].map((id) => ({ id, status: "pass" }))
}, { specText });
assert.equal(acceptedExternal.statusCeiling, "accepted");
assert.deepEqual(acceptedExternal.errors, []);

const reviewDir = path.join(workspace, "knowledge", ".ravo", "review");
fs.mkdirSync(reviewDir, { recursive: true });
const reviewPath = path.join(reviewDir, "review.json");
const reviewRef = path.relative(workspace, reviewPath);
const externalAcceptancePath = path.join(workspace, "knowledge", ".ravo", "acceptance", "external-review.json");
const externalAcceptanceRef = path.relative(workspace, externalAcceptancePath);
const externalAcceptance = {
  ...JSON.parse(fs.readFileSync(acceptance.artifactPath, "utf8")),
  evidenceLevel: "partial_external_review",
  reviewArtifact: reviewRef
};
fs.writeFileSync(externalAcceptancePath, `${JSON.stringify(externalAcceptance, null, 2)}\n`);
const usableReview = {
  subjectRef: "milestone-subject",
  workflowCoverage: "partial",
  coverage: "partial",
  parserStatus: "pass",
  validResults: true,
  modelsUsable: ["provider/model"],
  dataBoundary: { decision: "safe_sanitized", authorizationSource: "policy_safe_sanitized", externalCallAllowed: true },
  ledgerFindingCount: 1
};
function checkReview(review) {
  fs.writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return buildResult(workspace, { acceptanceArtifact: externalAcceptanceRef });
}

assert.equal(checkReview({ ...usableReview, ...formalReviewTelemetry() }).status, "ready");
const v056SpecRef = "docs/v056-spec.md";
fs.writeFileSync(path.join(workspace, v056SpecRef), "# v0.5.6 Fixture\n\n需求集合：`R056-010`\n", "utf8");
const dispositionLedgerPath = path.join(reviewDir, "issues", "disposition.json");
const dispositionLedgerRef = path.relative(workspace, dispositionLedgerPath);
fs.mkdirSync(path.dirname(dispositionLedgerPath), { recursive: true });
fs.writeFileSync(dispositionLedgerPath, `${JSON.stringify({
  schemaVersion: "0.5.6",
  issues: [{
    id: "RR-PENDING-HIGH",
    severity: "high",
    verificationStatus: "ready",
    localDisposition: { status: "pending", verificationMethod: "none", evidenceRefs: [], observed: "", reason: "", environment: "", decidedAt: "" }
  }]
}, null, 2)}\n`, "utf8");
externalAcceptance.specRef = v056SpecRef;
fs.writeFileSync(externalAcceptancePath, `${JSON.stringify(externalAcceptance, null, 2)}\n`, "utf8");
const pendingDisposition = checkReview({ ...usableReview, ...formalReviewTelemetry(), issueLedgerRef: dispositionLedgerRef });
assert.equal(pendingDisposition.checks.find((check) => check.id === "reviewDisposition").status, "skip", "pending acceptance may expose but not hide an unresolved high finding");
externalAcceptance.status = "accepted";
externalAcceptance.acceptanceScope = "release";
externalAcceptance.milestoneRef = "";
externalAcceptance.releaseRef = "milestone-subject";
externalAcceptance.baselineRef = "git-tree:disposition";
externalAcceptance.statusCeiling = "accepted";
externalAcceptance.evidenceLevel = "full_external_review";
externalAcceptance.acceptanceItems = [{ ...item, verificationStatus: "verified", verificationOwner: "codex", verificationReason: "Fixture verified.", verificationTasks: [] }];
externalAcceptance.codexVerificationItemIds = [];
externalAcceptance.pmChecklistItemIds = [];
externalAcceptance.securityChecklist = ["data_privacy", "credentials", "permissions", "destructive_actions", "external_calls", "dependencies", "logs_artifacts", "global_knowledge"].map((id) => ({ id, status: "pass" }));
fs.writeFileSync(externalAcceptancePath, `${JSON.stringify(externalAcceptance, null, 2)}\n`, "utf8");
const terminalPendingDisposition = checkReview({ ...usableReview, ...formalReviewTelemetry(), issueLedgerRef: dispositionLedgerRef });
assert.equal(terminalPendingDisposition.checks.find((check) => check.id === "reviewDisposition").status, "fail", "accepted/release_ready cannot rely on an unresolved high finding");
const resolvedLedger = JSON.parse(fs.readFileSync(dispositionLedgerPath, "utf8"));
resolvedLedger.issues[0].localDisposition = {
  status: "rejected",
  verificationMethod: "file_inspection",
  evidenceRefs: ["evidence/xcode-help.txt"],
  observed: "Current local help contradicts the finding.",
  reason: "",
  environment: "Xcode 26.6",
  decidedAt: new Date().toISOString()
};
fs.writeFileSync(dispositionLedgerPath, `${JSON.stringify(resolvedLedger, null, 2)}\n`, "utf8");
const terminalResolvedDisposition = checkReview({ ...usableReview, ...formalReviewTelemetry(), issueLedgerRef: dispositionLedgerRef });
assert.equal(terminalResolvedDisposition.checks.find((check) => check.id === "reviewDisposition").status, "pass");
const missingPairAttempt = formalReviewTelemetry("provider/model-a");
missingPairAttempt.callPlan.requestedPairs.push("provider/model-b");
missingPairAttempt.callPlan.timeoutProfiles.push({
  providerModelKey: "provider/model-b",
  requested: { ...missingPairAttempt.callPlan.requestedTimeoutProfile },
  effective: { ...missingPairAttempt.callPlan.requestedTimeoutProfile }
});
assert.match(formalReviewTelemetryErrors(missingPairAttempt).join(" "), /Missing attempt telemetry for provider\/model-b/);
const invalidJitter = formalReviewTelemetry();
invalidJitter.dataBoundary = usableReview.dataBoundary;
invalidJitter.attempts[0].jitterRangeMs = { min: 10, max: 5 };
assert.match(formalReviewTelemetryErrors(invalidJitter).join(" "), /jitterRangeMs is invalid/);
const secretTelemetry = formalReviewTelemetry();
secretTelemetry.dataBoundary = usableReview.dataBoundary;
secretTelemetry.attempts[0].partialResponseRef = ["sk", "example", "secret", "123456789"].join("-");
assert.match(formalReviewTelemetryErrors(secretTelemetry).join(" "), /secret-like value/);
assert.equal(checkReview({ ...usableReview, ...formalReviewTelemetry(), runClass: "diagnostic", formalEvidenceEligible: true }).status, "not_ready");
assert.equal(checkReview({ ...usableReview, ...formalReviewTelemetry(), formalEvidenceEligible: false }).status, "not_ready");
assert.equal(checkReview({ ...usableReview, schemaVersion: "0.5.1" }).status, "not_ready");
const missingTelemetry = checkReview({ ...usableReview, schemaVersion: "0.5.1", runClass: "formal", formalEvidenceEligible: true });
assert.equal(missingTelemetry.status, "not_ready");
assert.match(missingTelemetry.checks.find((check) => check.id === "reviewEvidence").details.join(" "), /callPlan is missing/);
assert.equal(checkReview({ ...usableReview, schemaVersion: "0.5.0" }).status, "not_ready");
assert.equal(checkReview({ ...usableReview, schemaVersion: "0.5.0", formalEvidenceEligible: false }).status, "not_ready");
const legacyDiagnostic = checkReview({ ...usableReview, schemaVersion: "0.5.0", runClass: "diagnostic" });
assert.equal(legacyDiagnostic.status, "not_ready");
assert.match(legacyDiagnostic.checks.find((check) => check.id === "reviewEvidence").details.join(" "), /not eligible for formal evidence/);

const legacyReleaseArtifact = { schemaVersion: "0.5.0", milestoneRef: "legacy-informational-milestone", subjectRef: "legacy-release" };
assert.equal(acceptanceScope(legacyReleaseArtifact), "release", "pre-0.5.1 artifacts retain release semantics unless they explicitly carry the new scope contract");
assert.deepEqual(validateOverallStatus(legacyReleaseArtifact).scopeErrors, []);

const missingAcceptancePath = spawnSync(process.execPath, [acceptanceChecker, "--acceptance-artifact"], { cwd: workspace, encoding: "utf8" });
assert.notEqual(missingAcceptancePath.status, 0);
assert.match(missingAcceptancePath.stderr, /--acceptance-artifact requires a value/);

const invalidTerminal = spawnSync(process.execPath, [acceptanceWriter,
  "--workspace", workspace,
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Invalid milestone terminal status.",
  "--acceptance-scope", "milestone",
  "--milestone-ref", "M2",
  "--baseline-ref", "git-tree:abc",
  "--subject-ref", "milestone-subject",
  "--spec-ref", "docs/spec.md",
  "--workstream-artifact", workstreamRef,
  "--acceptance-item", JSON.stringify({ ...item, verificationStatus: "verified", verificationTasks: [], sourceRefs: ["git-tree:abc"], verificationReason: "Verified fixture." }),
  "--security-pass", "data_privacy",
  "--security-pass", "credentials",
  "--security-pass", "permissions",
  "--security-pass", "destructive_actions",
  "--security-pass", "external_calls",
  "--security-pass", "dependencies",
  "--security-pass", "logs_artifacts",
  "--security-pass", "global_knowledge"
], { cwd: workspace, encoding: "utf8" });
assert.notEqual(invalidTerminal.status, 0);
assert.match(invalidTerminal.stderr, /milestone acceptance cannot claim accepted or release_ready/);

fs.writeFileSync(path.join(workspace, "knowledge", ".ravo", "config.json"), JSON.stringify({
  audience: "product_manager",
  technicalDetailLevel: 1
}, null, 2), "utf8");
const productPmItem = {
  ...item,
  id: "product-pm",
  name: "状态页展示",
  verificationReason: "产品经理需要判断状态页是否清楚。",
  verificationTasks: [{
    id: "product-pm-task",
    claim: "确认状态页是否足够清楚。",
    reason: "你应能直接知道当前版本、当前状态和下一步。",
    owner: "pm",
    preconditions: ["打开状态页。"],
    steps: ["查看当前版本和状态。", "确认下一步是否清楚。"],
    expectedResult: "无需阅读日志或内部术语即可完成判断。",
    evidenceRequired: ["PM 的验收结论或具体困惑。"],
    failureAction: "记录不清楚的位置并退回 Codex 修复。",
    blocking: true
  }],
  risk: "当前结论必须与真实证据一致。",
  boundary: "不以旧 cache、脚本或口头确认替代真实证据。"
};
const productAcceptance = run(acceptanceWriter, [
  "--workspace", workspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Technical runtime details are available.",
  "--pm-summary", "当前版本已经完成核心验证。请你只判断状态页是否足够清楚。",
  "--pm-gap", "状态页仍有一项提示待刷新，但当前版本已经正确切换；Codex 会继续处理该提示。",
  "--known-gap", "runtimeProbeStatus=stale; coreRuntimeStatus=unknown; runtimeHealth=degraded",
  "--acceptance-scope", "release",
  "--subject-ref", "product-pm-release",
  "--release-ref", "product-pm-release",
  "--spec-ref", "docs/spec.md",
  "--acceptance-item", JSON.stringify(productPmItem),
  "--real-response-ref", "response:product-pm",
  "--not-applicable-evidence", "No separate screenshot is needed for this fixture."
]);
const productArtifact = JSON.parse(fs.readFileSync(productAcceptance.artifactPath, "utf8"));
const productPmDoc = fs.readFileSync(productAcceptance.pmChecklistPath, "utf8");
assert.equal(Object.hasOwn(productArtifact, "pmPresentationVersion"), false);
assert.equal(Object.hasOwn(productArtifact, "audience"), false);
assert.equal(productArtifact.pmBrief.productState, "awaiting_pm");
assert.equal(productArtifact.pmBrief.actionRequired, "experience_acceptance");
assert.equal(productArtifact.pmBrief.decisionCard.options.length, 2);
assert.match(productPmDoc, /# 请体验当前成果/);
assert.match(productPmDoc, /当前版本已经完成核心验证/);
assert.match(productPmDoc, /## 建议体验/);
assert.match(productPmDoc, /## 需要你的判断/);
assert.doesNotMatch(productPmDoc, /runtimeProbeStatus=stale|当前结论必须与真实证据一致/);
assert.equal((productPmDoc.match(/当前结论必须与真实证据一致/g) || []).length, 0);
assert.doesNotMatch(productPmDoc, /技术证据附录|需求预期、当前方案与实现效果/);
assert.equal(run(acceptanceChecker, ["--acceptance-artifact", path.relative(workspace, productAcceptance.artifactPath)]).status, "ready");
const historicalPresentationPath = path.join(workspace, "knowledge", ".ravo", "acceptance", "historical-presentation-fields.json");
fs.writeFileSync(historicalPresentationPath, `${JSON.stringify({ ...productArtifact, audience: "engineering", technicalDetailLevel: 5, outputMode: "engineering", pmPresentationVersion: 1 }, null, 2)}\n`);
assert.equal(run(acceptanceChecker, ["--acceptance-artifact", path.relative(workspace, historicalPresentationPath)]).status, "ready");

const codexBeforePmItem = {
  ...productPmItem,
  id: "product-codex-before-pm",
  name: "真实浏览器补证",
  verificationStatus: "pending_codex",
  verificationOwner: "codex",
  verificationReason: "Codex 仍需完成真实浏览器验证。",
  verificationTasks: [{
    id: "product-codex-browser-task",
    claim: "完成真实浏览器验证。",
    reason: "PM 体验前应先排除可自动发现的问题。",
    owner: "codex",
    preconditions: ["启动本地页面。"],
    steps: ["检查桌面和移动端核心路径。"],
    expectedResult: "核心路径无错误或布局问题。",
    evidenceRequired: ["浏览器记录"],
    failureAction: "修复后重新验证。",
    blocking: true
  }]
};
const codexFirstAcceptance = run(acceptanceWriter, [
  "--workspace", workspace,
  "--status", "in_progress",
  "--evidence-level", "smoke",
  "--summary", "Codex verification precedes PM judgment.",
  "--subject-ref", "product-codex-first",
  "--acceptance-item", JSON.stringify(codexBeforePmItem),
  "--acceptance-item", JSON.stringify(productPmItem)
]);
const codexFirstArtifact = JSON.parse(fs.readFileSync(codexFirstAcceptance.artifactPath, "utf8"));
const codexFirstPmDoc = fs.readFileSync(codexFirstAcceptance.pmChecklistPath, "utf8");
assert.equal(codexFirstArtifact.pmBrief.actionRequired, "none");
assert.equal(codexFirstArtifact.pmBrief.productState, "in_progress");
assert.equal(codexFirstArtifact.pmBrief.decisionCard, null);
assert.match(codexFirstPmDoc, /你暂时不用行动/);
assert.match(codexFirstPmDoc, /实现还有缺口|自动验证还未完成/);
assert.match(codexFirstPmDoc, /尚未具备发布条件，也没有发布/);
assert.doesNotMatch(codexFirstPmDoc, /技术证据附录|Git 验收基线|\| 验收项 \|/);

console.log(JSON.stringify({
  status: "pass",
  workspace,
  workstreamArtifact: workstreamRef,
  acceptanceArtifact: acceptanceRef,
  checks: [
    "v0.5.1-workstream-writer",
    "milestone-scope-baseline",
    "explicit-acceptance-checker",
    "milestone-release-ineligible",
    "pending-release-acceptance-ineligible",
    "milestone-terminal-status-rejected",
    "pm-dependency-impact",
    "v0.5.1-formal-review-required",
    "formal-review-telemetry-required",
    "diagnostic-review-rejected",
    "legacy-review-not-current-formal-evidence",
    "legacy-acceptance-release-semantics",
    "checker-missing-value-rejected",
    "pm-product-presentation",
    "codex-verification-precedes-pm-action"
  ]
}, null, 2));
