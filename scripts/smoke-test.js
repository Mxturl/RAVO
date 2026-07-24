#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { securityReady } = require("../plugins/ravo/modules/ravo-acceptance/scripts/acceptance-model");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-smoke-")));

function run(script, args = [], cwd = workspace) {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8"
  });
  return JSON.parse(output);
}

function runEnv(script, args = [], env = {}, cwd = workspace) {
  const reviewGateArgs = script === runReview ? [
    "--subject-ref", "ravo-smoke-formal-review",
    "--subject-version", "ravo-smoke-fixture-v1",
    "--governance-path", "governed_change",
    "--trigger-reason", "user_explicit_formal_review",
    "--trigger-source-ref", "conversation:ravo-smoke#formal-review",
    "--decision-impact", "Verify the Review runner behavior in a controlled smoke fixture."
  ] : [];
  const output = execFileSync(process.execPath, [script, ...args, ...reviewGateArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return JSON.parse(output);
}

function runStatus(script, args = [], cwd = workspace) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function exists(relative) {
  return fs.existsSync(path.join(workspace, relative));
}

const coreInit = path.join(repo, "plugins", "ravo", "modules", "ravo-core", "scripts", "ravo-init.js");
const writeAnalysis = path.join(repo, "plugins", "ravo", "modules", "ravo-analysis", "scripts", "write-analysis-artifact.js");
const writeAcceptance = path.join(repo, "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "write-acceptance-artifact.js");
const checkAcceptance = path.join(repo, "plugins", "ravo", "modules", "ravo-acceptance", "scripts", "check-ravo-acceptance.js");
const writeWorkstream = path.join(repo, "plugins", "ravo", "modules", "ravo-workstream", "scripts", "write-workstream-artifact.js");
const writeSmoke = path.join(repo, "plugins", "ravo", "modules", "ravo-quick-validation", "scripts", "write-smoke-artifact.js");
const checkSmoke = path.join(repo, "plugins", "ravo", "modules", "ravo-quick-validation", "scripts", "check-smoke-artifact.js");
const writeKnowledge = path.join(repo, "plugins", "ravo", "modules", "ravo-knowledge", "scripts", "write-knowledge-artifact.js");
const retrieveKnowledge = path.join(repo, "plugins", "ravo", "modules", "ravo-knowledge", "scripts", "retrieve-knowledge.js");
const goalPrompt = path.join(repo, "plugins", "ravo", "modules", "ravo-core", "scripts", "ravo-goal-prompt.js");
const ravoStatus = path.join(repo, "plugins", "ravo", "modules", "ravo-core", "scripts", "ravo-status.js");
const writeDecisionSpec = path.join(repo, "plugins", "ravo", "modules", "ravo-analysis", "scripts", "write-decision-spec.js");
const writeReview = path.join(repo, "plugins", "ravo", "modules", "ravo-review", "scripts", "write-review-artifact.js");
const runReview = path.join(repo, "plugins", "ravo", "modules", "ravo-review", "scripts", "run-review.js");
const captureKnowledge = path.join(repo, "plugins", "ravo", "modules", "ravo-knowledge", "scripts", "capture-knowledge.js");
const reviewRuntimeTest = path.join(repo, "scripts", "review-runtime-test.js");
const reviewMigrationTest = path.join(repo, "scripts", "review-migration-test.js");
const ravoStatusTest = path.join(repo, "scripts", "ravo-status-test.js");
const runtimeProbeTest = path.join(repo, "scripts", "runtime-probe-test.js");
const dashboardFreshnessTest = path.join(repo, "scripts", "dashboard-freshness-test.js");
const dashboardLineageTest = path.join(repo, "scripts", "dashboard-lineage-test.js");
const dashboardConfigTest = path.join(repo, "scripts", "dashboard-config-test.js");
const dashboardUpgradeTest = path.join(repo, "scripts", "dashboard-upgrade-test.js");
const dashboardDataTest = path.join(repo, "scripts", "dashboard-data-test.js");
const dashboardApiTest = path.join(repo, "scripts", "dashboard-api-test.js");
const dashboardUiTest = path.join(repo, "scripts", "dashboard-ui-test.js");
const dashboardShortcutTest = path.join(repo, "scripts", "dashboard-shortcut-test.js");
const pluginResolverTest = path.join(repo, "scripts", "plugin-resolver-test.js");
const configIntegrityTest = path.join(repo, "scripts", "config-integrity-test.js");
const solodeskControllerTest = path.join(repo, "scripts", "solodesk-controller-test.js");
const solodeskServiceTest = path.join(repo, "scripts", "solodesk-service-test.js");
const workstreamGovernanceTest = path.join(repo, "scripts", "workstream-governance-test.js");
const acceptanceScopeTest = path.join(repo, "scripts", "acceptance-scope-test.js");
const versionAlignmentTest = path.join(repo, "scripts", "version-alignment-test.js");
const securityPassArgs = [
  "--security-pass", "data_privacy",
  "--security-pass", "credentials",
  "--security-pass", "permissions",
  "--security-pass", "destructive_actions",
  "--security-pass", "external_calls",
  "--security-pass", "dependencies",
  "--security-pass", "logs_artifacts",
  "--security-pass", "global_knowledge"
];
assert.equal(securityReady([{ id: "anything", status: "pass" }]), false, "partial or unknown security domains cannot satisfy the baseline");

function verificationTask(overrides = {}) {
  return {
    id: "verify-item",
    claim: "Verify the acceptance claim",
    reason: "The claim needs explicit evidence before final acceptance.",
    owner: "codex",
    preconditions: [],
    steps: ["Run the representative flow."],
    expectedResult: "The observed result matches the requirement.",
    evidenceRequired: ["Recorded result"],
    failureAction: "Record the actual result and reopen the item.",
    blocking: false,
    ...overrides
  };
}

function acceptanceItem(overrides = {}) {
  return {
    id: "smoke-item",
    name: "Smoke acceptance",
    required: true,
    expected: "Evidence is connected",
    implementation: "Artifacts are linked through explicit references",
    effect: "The checker can verify the same acceptance object",
    fulfillmentStatus: "met",
    verificationStatus: "verified",
    verificationOwner: "codex",
    verificationReason: "The representative smoke flow passed.",
    verificationTasks: [],
    sourceRefs: ["smoke:representative-flow"],
    risk: "",
    boundary: "The smoke flow does not replace real E2E.",
    blockingReason: "",
    blockerImpact: "",
    temporaryFallback: "",
    recoveryEntry: "",
    ...overrides
  };
}

run(coreInit);
assert.ok(exists("knowledge/.ravo/manifest.json"), "core creates manifest");
assert.ok(exists("knowledge/.ravo/analysis"), "core creates analysis dir");
assert.ok(exists("knowledge/.ravo/acceptance"), "core creates acceptance dir");
assert.ok(exists("knowledge/.ravo/quick-validation"), "core creates quick-validation dir");
assert.ok(exists("knowledge/.ravo/review"), "core creates review dir");

fs.mkdirSync(path.join(workspace, "knowledge/.ravo"), { recursive: true });
fs.writeFileSync(path.join(workspace, "knowledge/.ravo/config.json"), JSON.stringify({ technicalDetailLevel: 9 }, null, 2), "utf8");
const statusReport = run(ravoStatus, ["--workspace", workspace, "--repo", repo], repo);
assert.equal(Object.hasOwn(statusReport.config, "technicalDetailLevel"), false, "invalid legacy technicalDetailLevel is ignored");
assert.equal(statusReport.warnings.some((warning) => /technicalDetailLevel/.test(warning)), false, "ignored technicalDetailLevel produces no warning");
assert.ok(statusReport.plugins.some((plugin) => plugin.name === "ravo" && plugin.present), "ravo-status reports the unified plugin");
fs.writeFileSync(path.join(workspace, "knowledge/.ravo/config.json"), JSON.stringify({ technicalDetailLevel: 1, globalKnowledge: { enabled: false } }, null, 2), "utf8");
const levelOneStatus = run(ravoStatus, ["--workspace", workspace, "--repo", repo], repo);
assert.equal(Object.hasOwn(levelOneStatus.config, "technicalDetailLevel"), false, "legacy technicalDetailLevel does not affect effective config");
assert.equal(levelOneStatus.config.goalPrompt.missingSpecPolicy, "auto_spec", "goal prompt config default is visible");

const analysisDir = path.join(workspace, "knowledge/.ravo/analysis");
const analysisFilesBeforeCliInfo = fs.readdirSync(analysisDir).length;
const manifestBeforeCliInfo = fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8");
for (const flag of ["--help", "--version"]) {
  const info = runStatus(writeAnalysis, [flag]);
  assert.equal(info.status, 0, `${flag} exits cleanly`);
}
assert.equal(fs.readdirSync(analysisDir).length, analysisFilesBeforeCliInfo, "analysis help/version create no artifacts");
assert.equal(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"), manifestBeforeCliInfo, "analysis help/version do not update manifest");
for (const args of [["--unknown-option", "value"], ["--title"]]) {
  const invalidCli = runStatus(writeAnalysis, args);
  assert.notEqual(invalidCli.status, 0, `analysis rejects invalid CLI args: ${args.join(" ")}`);
}
assert.equal(fs.readdirSync(analysisDir).length, analysisFilesBeforeCliInfo, "analysis CLI errors create no artifacts");
assert.equal(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"), manifestBeforeCliInfo, "analysis CLI errors do not update manifest");

const invalidRequirement = runStatus(writeAnalysis, [
  "--type", "requirement",
  "--status", "complete",
  "--title", "Invalid requirement",
  "--impact-level", "medium",
  "--review-required", "false",
  "--review-evidence", "not_required",
  "--conclusion", "missing hard constraints"
]);
assert.notEqual(invalidRequirement.status, 0, "incomplete complete requirement artifact should fail");
assert.match(String(invalidRequirement.stderr || ""), /goal is required|consumer is required|facts requires/);
assert.equal(fs.readdirSync(analysisDir).length, analysisFilesBeforeCliInfo, "invalid complete analysis creates no artifact");
assert.equal(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"), manifestBeforeCliInfo, "invalid complete analysis does not update manifest");

const analysis = run(writeAnalysis, [
  "--type", "root-cause",
  "--status", "complete",
  "--title", "Smoke root cause",
  "--subject-ref", "ravo-smoke-release",
  "--impact-level", "medium",
  "--review-required", "false",
  "--review-evidence", "not_required",
  "--symptom", "readiness claim without evidence",
  "--proximate-cause", "missing artifact check",
  "--mechanism-root-cause", "status and evidence were not connected",
  "--alternative-hypothesis", "checker output was stale",
  "--why", "the shared gate never required a root-level evidence link",
  "--boundary", "The smoke test stops at the shared acceptance model.",
  "--smallest-fix", "Use one model in both writer and checker.",
  "--verification", "A contradictory top-level accepted status is rejected.",
  "--conclusion", "acceptance must discover artifacts before release claims"
]);
assert.ok(fs.existsSync(analysis.artifactPath), "analysis artifact exists");
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"));
assert.equal(
  fs.realpathSync(path.join(workspace, manifest.modules.analysis.latestCompleteArtifact)),
  fs.realpathSync(analysis.artifactPath),
  "manifest tracks latest complete analysis artifact"
);

const requirementAnalysis = run(writeAnalysis, [
  "--type", "requirement",
  "--status", "complete",
  "--title", "Complete requirement contract",
  "--impact-level", "medium",
  "--review-required", "false",
  "--review-evidence", "not_required",
  "--goal", "Give PMs an evidence-backed acceptance decision.",
  "--consumer", "Product manager",
  "--constraint", "Do not infer evidence from prose alone.",
  "--fact", "Legacy acceptance used a single judgment field.",
  "--option", "Use one shared item model in writer and checker.",
  "--assumption", "Each required item can name a verification owner.",
  "--blind-spot", JSON.stringify({
    title: "Legacy evidence can refer to a different release object.",
    basis: "fact",
    impact: "high",
    suggestedAction: "update_spec",
    specUpdateRequired: false
  }),
  "--challenge", "A schema alone would not stop the checker from trusting the top-level status.",
  "--validation", "A contradictory accepted artifact is rejected.",
  "--risk", "Legacy artifacts remain readable but cannot pass automatically.",
  "--next-action", "Regenerate the PM package with explicit tasks.",
  "--conclusion", "The shared model is required for mechanically consistent acceptance."
]);
assert.ok(fs.existsSync(requirementAnalysis.artifactPath), "complete requirement artifact includes all decision fields");
const requirementArtifact = JSON.parse(fs.readFileSync(requirementAnalysis.artifactPath, "utf8"));
assert.equal(requirementArtifact.consumer, "Product manager");
assert.equal(requirementArtifact.blindSpotFindings[0].suggestedAction, "update_spec");

const highImpactWithoutReview = runStatus(writeAnalysis, [
  "--type", "root-cause",
  "--status", "complete",
  "--title", "High impact without review",
  "--impact-level", "high",
  "--review-required", "true",
  "--review-evidence", "not_required",
  "--symptom", "release claim could be wrong",
  "--proximate-cause", "evidence was incomplete",
  "--mechanism-root-cause", "release judgment was self-confirming",
  "--alternative-hypothesis", "the evidence reader was stale",
  "--why", "no independent review challenged the conclusion",
  "--boundary", "External review is the independent boundary.",
  "--smallest-fix", "Require review evidence for high-impact conclusions.",
  "--verification", "The writer rejects high impact without review evidence.",
  "--conclusion", "High-impact release analysis needs Review."
]);
assert.notEqual(highImpactWithoutReview.status, 0, "high-impact complete analysis without Review should fail");
assert.match(String(highImpactWithoutReview.stderr || ""), /matching Review evidence|structured external blocker/);

const missingHighImpactReview = runStatus(writeAnalysis, [
  "--type", "root-cause", "--status", "complete", "--title", "Missing high-impact Review artifact",
  "--impact-level", "high", "--review-required", "true", "--review-evidence", "full",
  "--subject-ref", "high-impact-subject", "--review-artifact", "knowledge/.ravo/review/does-not-exist.json",
  "--symptom", "release claim could be wrong", "--proximate-cause", "evidence was incomplete",
  "--mechanism-root-cause", "release judgment was self-confirming", "--alternative-hypothesis", "the evidence reader was stale",
  "--why", "no independent review challenged the conclusion", "--boundary", "Review is the independent boundary.",
  "--smallest-fix", "Require a real matching Review artifact.", "--verification", "A missing Review ref is rejected.",
  "--conclusion", "A string path cannot self-certify Review evidence."
]);
assert.notEqual(missingHighImpactReview.status, 0, "nonexistent Review artifact cannot satisfy high-impact Analysis");
assert.match(String(missingHighImpactReview.stderr || ""), /existing workspace Review artifact/);

const validReviewFixturePath = path.join(workspace, "knowledge/.ravo/review/high-impact-fixture.json");
fs.writeFileSync(validReviewFixturePath, JSON.stringify({
  schemaVersion: "0.5.0",
  id: "high-impact-fixture",
  reviewRunId: "review-run-high-impact",
  subjectRef: "high-impact-subject",
  workflowCoverage: "full",
  coverage: "full",
  validResults: true,
  parserStatus: "pass",
  modelsUsable: ["provider/model"],
  ledgerFindingCount: 1,
  dataBoundary: { externalCallAllowed: true },
  createdAt: new Date().toISOString()
}, null, 2), "utf8");
const highImpactWithReview = run(writeAnalysis, [
  "--type", "root-cause", "--status", "complete", "--title", "High impact with matching Review",
  "--impact-level", "high", "--review-required", "true", "--review-evidence", "full",
  "--subject-ref", "high-impact-subject", "--review-artifact", path.relative(workspace, validReviewFixturePath),
  "--review-run-id", "review-run-high-impact",
  "--symptom", "release claim could be wrong", "--proximate-cause", "evidence was incomplete",
  "--mechanism-root-cause", "release judgment was self-confirming", "--alternative-hypothesis", "the evidence reader was stale",
  "--why", "independent Review challenged the conclusion", "--boundary", "The matching Review artifact closes the independent boundary.",
  "--smallest-fix", "Bind the analysis to the verified Review run.", "--verification", "The Review subject and coverage match.",
  "--conclusion", "Matching usable Review evidence supports the high-impact conclusion."
]);
assert.ok(fs.existsSync(highImpactWithReview.artifactPath), "matching usable Review evidence supports complete high-impact Analysis");

const highImpactBlocked = run(writeAnalysis, [
  "--type", "root-cause",
  "--status", "complete",
  "--title", "High impact with external blocker",
  "--impact-level", "high",
  "--review-required", "true",
  "--review-evidence", "blocked",
  "--review-blocking-reason", "No external Provider credential in the isolated smoke workspace.",
  "--review-blocker-impact", "Independent multi-model confirmation is unavailable.",
  "--review-temporary-fallback", "Keep the release status not_ready and run inline adversarial analysis only.",
  "--review-recovery-entry", "Configure a test Provider and rerun the matching Review subject.",
  "--symptom", "release claim could be wrong",
  "--proximate-cause", "evidence was incomplete",
  "--mechanism-root-cause", "release judgment was self-confirming",
  "--alternative-hypothesis", "the evidence reader was stale",
  "--why", "no independent review challenged the conclusion",
  "--boundary", "External authorization is outside this isolated smoke run.",
  "--smallest-fix", "Record the blocker and preserve the Review gate.",
  "--verification", "The artifact remains explicit about unavailable external evidence.",
  "--conclusion", "The blocker is structured instead of being treated as Review success."
]);
assert.ok(fs.existsSync(highImpactBlocked.artifactPath), "structured external Review blocker supports a complete high-impact artifact");

const pendingCodexItem = acceptanceItem({
  id: "pending-codex",
  name: "Real response capture",
  verificationStatus: "pending_codex",
  verificationOwner: "codex",
  verificationReason: "Codex can still create a real Session and capture the response.",
  verificationTasks: [verificationTask({ owner: "codex" })],
  sourceRefs: []
});
const prematurePmAcceptance = runStatus(writeAcceptance, [
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Premature PM acceptance",
  "--source-ref", "spec:smoke",
  "--acceptance-item", JSON.stringify(pendingCodexItem)
]);
assert.notEqual(prematurePmAcceptance.status, 0, "pending_codex cannot be promoted to pending_acceptance");
assert.match(String(prematurePmAcceptance.stderr || ""), /exceeds item evidence ceiling code_complete/);

const acceptance = run(writeAcceptance, [
  "--status", "code_complete",
  "--evidence-level", "script",
  "--summary", "Smoke code is complete but real response evidence remains",
  "--analysis-artifact", path.relative(workspace, analysis.artifactPath),
  "--acceptance-item", JSON.stringify(pendingCodexItem)
]);
assert.ok(fs.existsSync(acceptance.artifactPath), "code_complete acceptance artifact exists");
const codexPmDocument = fs.readFileSync(acceptance.pmChecklistPath, "utf8");
assert.doesNotMatch(codexPmDocument, /Run the representative flow\./, "Codex verification steps stay out of the PM document");
assert.match(codexPmDocument, /目前不需要你操作/, "code-complete PM document states the relevant action naturally");
const codeCompleteCheck = runStatus(checkAcceptance);
assert.equal(codeCompleteCheck.status, 2, "code_complete remains below acceptance-ready status");
assert.ok(JSON.parse(codeCompleteCheck.stdout).checks.some((check) => check.id === "pmAcceptancePackage" && check.status === "pass"), "concise PM document is valid while Codex work remains structured evidence");

const acceptedWithoutSecurity = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Accepted without security baseline",
  "--source-ref", "spec:smoke",
  "--acceptance-item", JSON.stringify(acceptanceItem())
]);
assert.notEqual(acceptedWithoutSecurity.status, 0, "accepted without security baseline should fail");
assert.match(String(acceptedWithoutSecurity.stderr || ""), /security baseline/);

const arbitrarySourceBinding = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Arbitrary source string",
  "--subject-ref", "arbitrary-release",
  "--source-ref", "anything",
  "--acceptance-item", JSON.stringify(acceptanceItem()),
  ...securityPassArgs
]);
assert.notEqual(arbitrarySourceBinding.status, 0, "arbitrary sourceRefs cannot support acceptance-facing status");
assert.match(String(arbitrarySourceBinding.stderr || ""), /explicit source binding/);

const crossObjectBinding = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Cross-object analysis binding",
  "--subject-ref", "another-release",
  "--analysis-artifact", path.relative(workspace, analysis.artifactPath),
  "--acceptance-item", JSON.stringify(acceptanceItem()),
  ...securityPassArgs
]);
assert.notEqual(crossObjectBinding.status, 0, "analysis evidence from another subject cannot support accepted");
assert.match(String(crossObjectBinding.stderr || ""), /does not match subjectRef/);

const legacyBasicAcceptance = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Legacy basic satisfaction",
  "--source-ref", "spec:legacy",
  "--acceptance-item", JSON.stringify({
    name: "Legacy item",
    expected: "Old expected behavior",
    implementation: "Old implementation note",
    effect: "Old effect note",
    judgment: "基本满足"
  }),
  ...securityPassArgs
]);
assert.notEqual(legacyBasicAcceptance.status, 0, "legacy basic satisfaction cannot support accepted");
assert.match(String(legacyBasicAcceptance.stderr || ""), /item evidence ceiling not_ready/);

const halfMigratedLegacy = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Half-migrated legacy item",
  "--release-ref", "half-migrated-release",
  "--subject-ref", "half-migrated-release",
  "--acceptance-item", JSON.stringify({ ...acceptanceItem(), judgment: "基本满足" }),
  ...securityPassArgs
]);
assert.notEqual(halfMigratedLegacy.status, 0, "an item mixing v0.5 fields with legacy judgment is still downgraded");
assert.match(String(halfMigratedLegacy.stderr || ""), /item evidence ceiling not_ready/);

const legacyWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-legacy-acceptance-")));
run(coreInit, [], legacyWorkspace);
const legacyAcceptanceDir = path.join(legacyWorkspace, "knowledge/.ravo/acceptance");
const legacyArtifactPath = path.join(legacyAcceptanceDir, "legacy-v0.4.json");
const legacyPmPath = path.join(legacyAcceptanceDir, "legacy-v0.4-pm-acceptance.md");
fs.writeFileSync(legacyPmPath, "# Legacy PM acceptance\n\n基本满足\n", "utf8");
fs.writeFileSync(legacyArtifactPath, JSON.stringify({
  schemaVersion: "0.3.1",
  id: "legacy-v0.4",
  status: "pending_acceptance",
  evidenceLevel: "smoke",
  summary: "Legacy v0.4 acceptance",
  createdAt: new Date().toISOString(),
  pmChecklistRef: path.relative(legacyWorkspace, legacyPmPath),
  acceptanceItems: [JSON.stringify({ name: "Legacy item", judgment: "基本满足" })],
  securityChecklist: []
}, null, 2), "utf8");
const legacyManifestPath = path.join(legacyWorkspace, "knowledge/.ravo/manifest.json");
const legacyManifest = JSON.parse(fs.readFileSync(legacyManifestPath, "utf8"));
legacyManifest.modules.acceptance = {
  enabled: true,
  artifacts: ["knowledge/.ravo/acceptance"],
  latestArtifact: path.relative(legacyWorkspace, legacyArtifactPath),
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(legacyManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`, "utf8");
const legacyCheck = runStatus(checkAcceptance, [], legacyWorkspace);
assert.equal(legacyCheck.status, 2, "legacy acceptance checker blocks the old artifact");
const legacyCheckResult = JSON.parse(legacyCheck.stdout);
assert.equal(legacyCheckResult.gate.decision, "block");
assert.ok(legacyCheckResult.checks.some((check) => check.id === "acceptanceItems" && check.status === "fail"), "legacy acceptance is marked pending classification instead of passing");

const missingTask = runStatus(writeAcceptance, [
  "--status", "code_complete",
  "--evidence-level", "script",
  "--summary", "Missing verification task",
  "--acceptance-item", JSON.stringify(acceptanceItem({
    id: "missing-task",
    verificationStatus: "pending_codex",
    verificationOwner: "codex",
    verificationTasks: [],
    sourceRefs: []
  }))
]);
assert.notEqual(missingTask.status, 0, "required non-verified item without a task should fail");
assert.match(String(missingTask.stderr || ""), /requires at least one verification task/);

const wrongPmOwner = runStatus(writeAcceptance, [
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "PM task owned by Codex",
  "--source-ref", "spec:wrong-owner",
  "--acceptance-item", JSON.stringify(acceptanceItem({
    id: "wrong-pm-owner",
    verificationStatus: "pending_pm",
    verificationOwner: "pm",
    verificationTasks: [verificationTask({ owner: "codex" })],
    sourceRefs: ["spec:wrong-owner"]
  }))
]);
assert.notEqual(wrongPmOwner.status, 0, "pending_pm task cannot be owned only by Codex");
assert.match(String(wrongPmOwner.stderr || ""), /pending_pm tasks must be owned by pm or shared/);

const pendingPmTask = verificationTask({
  id: "pending-pm-task",
  claim: "PM verifies the representative product flow",
  reason: "Only product judgment remains.",
  owner: "pm",
  preconditions: ["Open the representative product flow"],
  steps: ["Run the flow and compare it with the requirement"],
  expectedResult: "The PM accepts the observed product behavior.",
  evidenceRequired: ["PM result note"],
  failureAction: "Record the actual result and reopen the item."
});
const pendingPmPackage = run(writeAcceptance, [
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Executable PM checklist",
  "--subject-ref", "pending-pm-release",
  "--release-ref", "pending-pm-release",
  "--real-response-ref", "response:pending-pm",
  "--not-applicable-evidence", "No UI is needed for this CLI fixture.",
  "--acceptance-item", JSON.stringify(acceptanceItem({
    id: "pending-pm-item",
    name: "Representative product flow",
    verificationStatus: "pending_pm",
    verificationOwner: "pm",
    verificationReason: "Only PM product judgment remains.",
    verificationTasks: [pendingPmTask]
  }))
]);
assert.equal(run(checkAcceptance).gate.decision, "pass", "complete pending_pm package passes before PM execution");
const pmDocument = fs.readFileSync(pendingPmPackage.pmChecklistPath, "utf8");
fs.writeFileSync(pendingPmPackage.pmChecklistPath, "", "utf8");
const tamperedPmPackage = runStatus(checkAcceptance);
assert.equal(tamperedPmPackage.status, 2, "tampered PM task package is blocked");
assert.ok(JSON.parse(tamperedPmPackage.stdout).checks.some((check) => check.id === "pmAcceptancePackage" && check.status === "fail"), "checker rejects a missing PM explanation without enforcing its layout");
fs.writeFileSync(pendingPmPackage.pmChecklistPath, pmDocument, "utf8");

const duplicateAcceptanceIds = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Duplicate item ids",
  "--source-ref", "spec:duplicate",
  "--acceptance-item", JSON.stringify(acceptanceItem({ id: "duplicate-item" })),
  "--acceptance-item", JSON.stringify(acceptanceItem({ id: "duplicate-item", name: "Duplicate second item" })),
  ...securityPassArgs
]);
assert.notEqual(duplicateAcceptanceIds.status, 0, "duplicate acceptance item ids should fail");
assert.match(String(duplicateAcceptanceIds.stderr || ""), /duplicate ids/);

const blockedWithoutRecovery = runStatus(writeAcceptance, [
  "--status", "not_ready",
  "--evidence-level", "notes",
  "--summary", "Blocked without recovery details",
  "--acceptance-item", JSON.stringify(acceptanceItem({
    id: "blocked-missing-fields",
    verificationStatus: "blocked",
    verificationOwner: "external",
    verificationTasks: [verificationTask({ owner: "external", blocking: true })],
    sourceRefs: []
  }))
]);
assert.notEqual(blockedWithoutRecovery.status, 0, "blocked item without explicit recovery fields should fail");
assert.match(String(blockedWithoutRecovery.stderr || ""), /blockingReason is required|recoveryEntry is required/);

const blockedTask = verificationTask({
  id: "blocked-recovery-task",
  claim: "Verify the flow after the external account is restored",
  reason: "The blocked claim must be rechecked after recovery.",
  owner: "external",
  preconditions: ["Restore the external test account"],
  steps: ["Run the blocked flow after access is restored"],
  expectedResult: "The flow completes and produces the required evidence.",
  evidenceRequired: ["Post-recovery response", "Pass/fail result"],
  failureAction: "Record the actual response and keep the item blocked or not_met.",
  blocking: true
});
const validBlockedAcceptance = run(writeAcceptance, [
  "--status", "not_ready",
  "--evidence-level", "notes",
  "--summary", "Blocked item with executable recovery verification",
  "--acceptance-item", JSON.stringify(acceptanceItem({
    id: "blocked-with-recovery",
    name: "External account flow",
    verificationStatus: "blocked",
    verificationOwner: "external",
    verificationReason: "The required external account is unavailable.",
    verificationTasks: [blockedTask],
    sourceRefs: [],
    blockingReason: "The external test account is unavailable.",
    blockerImpact: "The representative flow cannot be executed.",
    temporaryFallback: "Keep the feature not_ready and use only script evidence.",
    recoveryEntry: "Restore the account, then run blocked-recovery-task."
  }))
]);
const blockedPmDoc = fs.readFileSync(validBlockedAcceptance.pmChecklistPath, "utf8");
assert.doesNotMatch(blockedPmDoc, /Verify the flow after the external account is restored|Run the blocked flow after access is restored|Post-recovery response/, "blocked recovery mechanics stay in structured evidence");
assert.match(blockedPmDoc, /仍有外部条件未满足/);
const blockedCheck = runStatus(checkAcceptance);
assert.equal(blockedCheck.status, 2, "blocked package remains not_ready");
assert.ok(JSON.parse(blockedCheck.stdout).checks.some((check) => check.id === "pmTaskPlacement" && check.status === "pass"), "checker keeps blocked recovery mechanics out of PM experience steps");

const workstream = run(writeWorkstream, [
  "--status", "active",
  "--goal", "RAVO smoke workstream",
  "--subject-ref", "ravo-smoke-release",
  "--spec-ref", "docs/ravo-v0.2-decision-complete-spec.md",
  "--current-milestone", "smoke",
  "--next-step", "run acceptance",
  "--roadmap-audit", "done=smoke remains=acceptance blockers=none specDelta=none",
  "--worker-evidence", "{\"did\":\"ran smoke\",\"changed\":\"artifacts\",\"learned\":\"evidence is connected\",\"evidence\":\"analysis artifact\",\"blockers\":\"none\",\"next\":\"acceptance\"}",
  "--evidence-ref", path.relative(workspace, analysis.artifactPath)
]);
assert.ok(fs.existsSync(workstream.artifactPath), "workstream artifact exists");
const workstreamArtifact = JSON.parse(fs.readFileSync(workstream.artifactPath, "utf8"));
assert.equal(workstreamArtifact.roadmapAudit.length, 1, "workstream records Roadmap Audit");
assert.equal(workstreamArtifact.workerEvidence[0].did, "ran smoke", "workstream records worker evidence contract");

const invalidBlockedWorkstream = runStatus(writeWorkstream, [
  "--status", "blocked",
  "--goal", "Blocked without recovery",
  "--blocker", "external approval missing"
]);
assert.notEqual(invalidBlockedWorkstream.status, 0, "blocked workstream without recovery should fail");
assert.match(String(invalidBlockedWorkstream.stderr || ""), /requires --recovery/);

const smoke = run(writeSmoke, [
  "--scope", "RAVO smoke",
  "--subject-ref", "ravo-smoke-release",
  "--status", "pass",
  "--check", "script smoke passed",
  "--evidence-ref", path.relative(workspace, workstream.artifactPath)
]);
assert.ok(fs.existsSync(smoke.artifactPath), "smoke artifact exists");
assert.equal(run(checkSmoke).gate.decision, "pass", "smoke gate passes with pass evidence");

const knowledge = run(writeKnowledge, [
  "--kind", "lesson",
  "--status", "active",
  "--content", "Do not claim release readiness without evidence",
  "--source", "smoke-test",
  "--confirmed-by", "smoke-test",
  "--applicability", "release readiness"
]);
assert.ok(fs.existsSync(knowledge.artifactPath), "knowledge artifact exists");
assert.ok(fs.existsSync(knowledge.markdownPath), "knowledge markdown exists");
assert.ok(fs.existsSync(knowledge.indexPath), "knowledge index exists");
const retrieved = run(retrieveKnowledge, ["--query", "release readiness evidence"]);
assert.ok(retrieved.matches.length >= 1, "knowledge retrieval returns a match");
assert.ok(retrieved.matches[0].summary !== undefined, "knowledge retrieval returns summary field");
assert.equal(Object.hasOwn(retrieved, "technicalDetailLevel"), false, "knowledge retrieval does not expose presentation level");

const fullKnowledge = run(writeKnowledge, [
  "--kind", "lesson",
  "--status", "active",
  "--summary", "Short summary",
  "--content", "Full artifact keeps exact retrieval phrase FRESH_FULL_ARTIFACT_TOKEN",
  "--source", "smoke-test",
  "--confirmed-by", "smoke-test",
  "--applicability", "retrieval"
]);
const knowledgeIndexPath = path.join(workspace, "knowledge/.ravo/knowledge/index.json");
const staleIndex = JSON.parse(fs.readFileSync(knowledgeIndexPath, "utf8"));
staleIndex.entries = staleIndex.entries.map((entry) => entry.id === JSON.parse(fs.readFileSync(fullKnowledge.artifactPath, "utf8")).id
  ? { ...entry, summary: "stale index", content: "stale index" }
  : entry);
fs.writeFileSync(knowledgeIndexPath, `${JSON.stringify(staleIndex, null, 2)}\n`);
const fullRetrieved = run(retrieveKnowledge, ["--query", "FRESH_FULL_ARTIFACT_TOKEN"]);
assert.ok(fullRetrieved.matches.some((match) => match.content.includes("FRESH_FULL_ARTIFACT_TOKEN")), "knowledge retrieval prefers full JSON artifact over stale index");

const generatedSpecWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-generated-spec-"));
const generatedSpec = run(writeDecisionSpec, [
  "--workspace", generatedSpecWorkspace,
  "--title", "Generated RAVO Smoke",
  "--goal", "prove decision-complete spec generation",
  "--consumer", "RAVO contributor",
  "--in-scope", "generate structured spec",
  "--out-of-scope", "generate implementation code",
  "--contract", "script writes docs/*decision-complete-spec.md",
  "--validation", "goal prompt script can discover the generated spec",
  "--fallback", "missing fields fail before writing",
  "--assumption", "the user will review the generated spec"
]);
assert.ok(fs.existsSync(generatedSpec.specPath), "decision-complete spec is generated");
const draftGoal = run(goalPrompt, ["--workspace", generatedSpecWorkspace]);
assert.equal(draftGoal.status, "spec_draft", "default auto_spec writes a draft and does not generate runnable Goal prompts");
assert.ok(fs.existsSync(draftGoal.draftSpecPath), "auto_spec draft spec exists");
assert.ok(fs.existsSync(draftGoal.alignmentDraftPath), "auto_spec alignment draft exists");
assert.ok(!Object.hasOwn(draftGoal, "goalPrompt"), "draft specs cannot generate runnable Goal prompts");
const reviewedSpec = run(writeDecisionSpec, [
  "--workspace", generatedSpecWorkspace,
  "--status", "decision-complete",
  "--title", "Generated RAVO Smoke",
  "--goal", "prove decision-complete spec generation",
  "--consumer", "RAVO contributor",
  "--in-scope", "generate structured spec",
  "--out-of-scope", "generate implementation code",
  "--contract", "script writes docs/*decision-complete-spec.md",
  "--validation", "goal prompt script can discover the generated spec",
  "--fallback", "missing fields fail before writing",
  "--assumption", "the user will review the generated spec"
]);
assert.equal(reviewedSpec.specPath, generatedSpec.specPath, "decision-complete spec overwrites same generated path");
const generatedGoal = run(goalPrompt, ["--workspace", generatedSpecWorkspace]);
assert.equal(generatedGoal.status, "ok", "goal prompt can use generated decision-complete spec");

const userKnowledgeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-user-knowledge-"));
const leak = runStatus(writeKnowledge, [
  "--workspace", workspace,
  "--scope", "user",
  "--opt-in", "true",
  "--kind", "lesson",
  "--content", "Never leak CANARY_CUSTOMER_42 into reusable lessons",
  "--source", "smoke-test",
  "--applicability", "transferable lesson",
  "--canary", "CANARY_CUSTOMER_42"
], workspace);
assert.notEqual(leak.status, 0, "transferable lesson fails when canary leaks");

const userLesson = spawnSync(process.execPath, [
  writeKnowledge,
  "--workspace", workspace,
  "--scope", "user",
  "--opt-in", "true",
  "--status", "active",
  "--kind", "lesson",
  "--content", "Preserve original user requirements and propose changes separately",
  "--summary", "Preserve user requirements while proposing changes separately",
  "--source", "smoke-test",
  "--confirmed-by", "user",
  "--applicability", "requirement refinement",
  "--sensitivity", "redacted",
  "--canary", "CANARY_CUSTOMER_42"
], {
  cwd: workspace,
  encoding: "utf8",
  env: { ...process.env, RAVO_USER_KNOWLEDGE_DIR: userKnowledgeDir },
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(userLesson.status, 0, userLesson.stderr);
assert.match(JSON.parse(userLesson.stdout).globalWriteNotice, /User-level RAVO knowledge written/);

const missingUserMetadata = runStatus(writeKnowledge, [
  "--workspace", workspace,
  "--scope", "user",
  "--opt-in", "true",
  "--kind", "lesson",
  "--content", "Keep transferable lessons redacted",
  "--sensitivity", "redacted"
], workspace);
assert.notEqual(missingUserMetadata.status, 0, "user-level knowledge requires source and applicability metadata");

const captured = run(captureKnowledge, [
  "--workspace", workspace,
  "--summary", "Do not claim readiness without evidence",
  "--content", "Before release claims, connect status to validation, review, and acceptance artifacts.",
  "--source", "agent-closeout",
  "--source-ref", "task:knowledge-capture",
  "--applicability", "release readiness"
]);
assert.ok(fs.existsSync(captured.markdownPath), "capture writes markdown knowledge");
assert.match(captured.captureNotice, /Workspace-local RAVO knowledge written/);
assert.doesNotMatch(captured.captureNotice, /user-level global knowledge not written/);
assert.ok(JSON.parse(fs.readFileSync(captured.artifactPath, "utf8")).sourceRefs.includes("task:knowledge-capture"), "capture persists source refs");

const secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-second-"));
const crossWorkspace = spawnSync(process.execPath, [
  retrieveKnowledge,
  "--workspace", secondWorkspace,
  "--query", "requirements changes",
  "--include-user", "true"
], {
  cwd: secondWorkspace,
  encoding: "utf8",
  env: { ...process.env, RAVO_USER_KNOWLEDGE_DIR: userKnowledgeDir },
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(crossWorkspace.status, 0, crossWorkspace.stderr);
const crossWorkspaceResult = JSON.parse(crossWorkspace.stdout);
assert.equal(crossWorkspaceResult.matches.length, 1, "new workspace retrieves transferable lesson");
assert.doesNotMatch(crossWorkspaceResult.matches[0].content, /CANARY_CUSTOMER_42/, "transferable lesson does not leak canary");

const review = run(writeReview, [
  "--domain", "testing",
  "--coverage", "none",
  "--subject-ref", "legacy-manual-smoke",
  "--model-requested", "smoke/model-a",
  "--model-completed", "smoke/model-a",
  "--summary", "Smoke adversarial review",
  "--risk", "E2E prompts can become exam-like",
  "--recommendation", "Use realistic prompts without naming RAVO"
]);
assert.ok(fs.existsSync(review.artifactPath), "review artifact exists");

const reviewHelp = runStatus(runReview, ["--help"], workspace);
assert.equal(reviewHelp.status, 0, "review runner help exits cleanly");
assert.match(String(reviewHelp.stdout || ""), /Usage: run-review\.js/);

const reviewConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-config-"));
const fullConfigPath = path.join(reviewConfigDir, "full.json");
const fixtureCredential = ["SECRET", "SHOULD", "NOT", "PRINT"].join("_");
fs.writeFileSync(fullConfigPath, JSON.stringify({
  apiMode: "fake",
  apiBase: "fake://review",
  apiKey: fixtureCredential,
  models: "fake-a,fake-b"
}, null, 2), "utf8");
const fullReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", fullConfigPath,
  "--domain", "architecture",
  "--subject", "Upgrade RAVO Review to call configured providers"
]);
assert.equal(fullReview.coverage, "full", "fake provider success gives full review coverage");
assert.equal(fullReview.validResults, true, "usable reviewer records set validResults");
assert.equal(fullReview.modelsCompleted.length, 2, "all fake models complete");
assert.equal(fullReview.roundsRequested, 2, "review runner defaults to two rounds");
assert.equal(fullReview.roundsExecuted, 2, "default review executes two rounds");
assert.equal(fullReview.roundCoverage.length, 2, "default review records two round coverages");
assert.equal(fullReview.roundCoverage[0].purpose, "independent_review", "round 1 has independent purpose");
assert.equal(fullReview.roundCoverage[1].purpose, "challenge_response", "round 2 has challenge purpose");
assert.match(fullReview.roundCoverage[1].inputHash, /^sha256:/, "round coverage records input hash");
const fullReviewArtifact = JSON.parse(fs.readFileSync(fullReview.artifactPath, "utf8"));
assert.equal(Object.hasOwn(fullReviewArtifact, "technicalDetailLevel"), false, "review artifact does not record presentation level");
assert.equal(fullReviewArtifact.config.maxTokensMode, "auto", "review defaults to auto output budget");
assert.equal(fullReviewArtifact.attempts[0].requestedMaxTokens, null, "auto output budget omits the initial token limit");
assert.ok(fullReviewArtifact.providerBehavior.some((behavior) => Number(behavior.usage.output_tokens) > 0), "review records numeric Provider usage");
assert.ok(fullReviewArtifact.briefs.challengeBriefRef, "review records challenge brief");
assert.ok(fullReviewArtifact.issueLedgerRef, "review records issue ledger");
assert.ok(fullReviewArtifact.issueStatusCounts.challenged >= 1, "review issue ledger moves through challenge state");
const round2Prompt = fs.readFileSync(path.join(workspace, fullReviewArtifact.roundCoverage[1].inputRef), "utf8");
assert.match(round2Prompt, /Challenge brief:/, "round 2 prompt contains challenge brief");
assert.match(round2Prompt, /Your Round 1 result:/, "round 2 prompt contains own round 1 result");
assert.equal(fullReview.second_round_coverage, "full", "default second round succeeds");
assert.equal(fullReview.challengeStatus, "complete", "default challenge round records completion");
assert.equal(JSON.stringify(fullReview).includes(fixtureCredential), false, "review runner does not print api keys");

const oneRoundConfigPath = path.join(reviewConfigDir, "one-round.json");
fs.writeFileSync(oneRoundConfigPath, JSON.stringify({
  apiMode: "fake",
  apiBase: "fake://review",
  apiKey: fixtureCredential,
  models: "fake-a",
  rounds: 1
}, null, 2), "utf8");
const oneRoundReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", oneRoundConfigPath,
  "--domain", "architecture",
  "--subject", "Review one configured round"
]);
assert.equal(oneRoundReview.roundsRequested, 1, "config can set one review round");
assert.equal(oneRoundReview.roundCoverage.length, 1, "one-round config records one round");

const threeRoundReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", oneRoundConfigPath,
  "--domain", "architecture",
  "--subject", "Review CLI override rounds",
  "--rounds", "3"
]);
assert.equal(threeRoundReview.roundsRequested, 3, "CLI can override to three review rounds");
assert.equal(threeRoundReview.roundCoverage.length, 3, "three-round override records three rounds");
const threeRoundArtifact = JSON.parse(fs.readFileSync(threeRoundReview.artifactPath, "utf8"));
assert.equal(threeRoundArtifact.roundCoverage[2].purpose, "convergence_adjudication", "round 3 has convergence purpose");
assert.ok(threeRoundArtifact.briefs.convergenceBriefRef, "review records convergence brief");
assert.notEqual(threeRoundArtifact.convergenceStatus, "not_requested", "three-round review records convergence status");

const discussionFile = path.join(reviewConfigDir, "discussion.md");
fs.writeFileSync(discussionFile, "Manual challenge: focus on acceptance evidence.", "utf8");
const invalidDiscussion = runStatus(runReview, [
  "--workspace", workspace,
  "--config", oneRoundConfigPath,
  "--domain", "architecture",
  "--subject", "Invalid discussion with one round",
  "--rounds", "1",
  "--discussion-file", discussionFile
]);
assert.notEqual(invalidDiscussion.status, 0, "discussion file requires rounds >= 2");
assert.match(String(invalidDiscussion.stderr || ""), /discussion-file requires --rounds 2 or 3/);

const partialConfigPath = path.join(reviewConfigDir, "partial.json");
fs.writeFileSync(partialConfigPath, JSON.stringify({
  providers: [
    {
      id: "fake-provider",
      enabled: true,
      apiMode: "fake",
      apiBase: "fake://review",
      apiKey: fixtureCredential,
      models: [
        { "id": "fake-ok", "enabled": true },
        { "id": "fake-fail", "enabled": true }
      ]
    }
  ]
}, null, 2), "utf8");
const partialReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", partialConfigPath,
  "--domain", "testing",
  "--subject", "Review partial provider behavior"
]);
assert.equal(partialReview.coverage, "partial", "one fake model failure gives partial review coverage");
assert.match(partialReview.failedModelReasons.join("\n"), /provider-error/);

const unavailableReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", path.join(reviewConfigDir, "missing.json"),
  "--domain", "testing",
  "--subject", "Review without provider config"
]);
assert.equal(unavailableReview.coverage, "none", "missing provider config gives none coverage");
assert.equal(unavailableReview.validResults, false, "missing provider config has no valid results");

const timeoutConfigPath = path.join(reviewConfigDir, "timeout.json");
fs.writeFileSync(timeoutConfigPath, JSON.stringify({
  apiMode: "fake",
  apiBase: "fake://review",
  models: ["fake-timeout", "fake-trunc"]
}, null, 2), "utf8");
const timeoutReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", timeoutConfigPath,
  "--domain", "testing",
  "--subject", "Review timeout and truncation behavior"
]);
assert.equal(timeoutReview.coverage, "none", "timeout plus truncation produces no usable Review coverage");
assert.match(timeoutReview.failedModelReasons.join("\n"), /timeout/);
assert.match(timeoutReview.truncationWarnings.join("\n"), /truncat|timeout/);
assert.ok(timeoutReview.attempts.some((attempt) => attempt.result === "retrying"), "review records retry attempts");

fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
fs.copyFileSync(path.join(repo, "docs", "ravo-v0.2-decision-complete-spec.md"), path.join(workspace, "docs", "ravo-v0.2-decision-complete-spec.md"));
const suggestedGoal = run(goalPrompt, ["--workspace", workspace]);
assert.equal(suggestedGoal.status, "ok", "goal prompt script finds decision-complete spec");
assert.match(suggestedGoal.goalPrompt, /严格按照/);
assert.equal(Object.hasOwn(suggestedGoal, "technicalDetailLevel"), false, "goal prompt output does not record presentation level");

const acceptedWithSecurity = run(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Accepted smoke evidence with security baseline",
  "--subject-ref", "ravo-smoke-release",
  "--spec-ref", "docs/ravo-v0.2-decision-complete-spec.md",
  "--source-ref", "spec:ravo-smoke",
  "--analysis-artifact", path.relative(workspace, analysis.artifactPath),
  "--workstream-artifact", path.relative(workspace, workstream.artifactPath),
  "--quick-validation-artifact", path.relative(workspace, smoke.artifactPath),
  "--real-response-ref", "CLI response: ok",
  "--not-applicable-evidence", "No UI screenshot required for CLI smoke.",
  "--data-evidence-ref", path.relative(workspace, analysis.artifactPath),
  "--acceptance-item", JSON.stringify(acceptanceItem({
    sourceRefs: [
      path.relative(workspace, analysis.artifactPath),
      path.relative(workspace, smoke.artifactPath),
      "CLI response: ok"
    ]
  })),
  ...securityPassArgs
]);
assert.ok(fs.existsSync(acceptedWithSecurity.artifactPath), "accepted artifact with security exists");
assert.ok(fs.existsSync(acceptedWithSecurity.pmChecklistPath), "accepted artifact creates PM acceptance document");
const acceptedArtifact = JSON.parse(fs.readFileSync(acceptedWithSecurity.artifactPath, "utf8"));
assert.equal(Object.hasOwn(acceptedArtifact, "technicalDetailLevel"), false, "acceptance artifact does not record presentation level");
assert.equal(acceptedArtifact.statusCeiling, "accepted", "accepted artifact records item-derived status ceiling");
assert.equal(acceptedArtifact.acceptanceItems[0].fulfillmentStatus, "met", "acceptance artifact stores fulfillment status");
assert.equal(acceptedArtifact.acceptanceItems[0].verificationStatus, "verified", "acceptance artifact stores verification status");
const acceptedPmDoc = fs.readFileSync(acceptedWithSecurity.pmChecklistPath, "utf8");
assert.doesNotMatch(acceptedPmDoc, /基本满足/, "PM document does not emit the legacy basic-satisfaction label");
assert.match(acceptedPmDoc, /^# 当前验收结论/m);
assert.match(acceptedPmDoc, /实现和自动验证已完成/);
assert.match(acceptedPmDoc, /你已接受当前体验/);
assert.match(acceptedPmDoc, /尚未具备发布条件，也没有发布/);
assert.doesNotMatch(acceptedPmDoc, /技术证据附录|Git 验收基线|\| 验收项 \|/);

const acceptedArtifactText = fs.readFileSync(acceptedWithSecurity.artifactPath, "utf8");
fs.writeFileSync(acceptedWithSecurity.artifactPath, `${JSON.stringify({
  ...acceptedArtifact,
  securityChecklist: [{ id: "anything", status: "pass" }]
}, null, 2)}\n`, "utf8");
const incompleteSecurityCheck = runStatus(checkAcceptance);
assert.equal(incompleteSecurityCheck.status, 2, "single arbitrary security pass cannot satisfy the baseline");
assert.ok(JSON.parse(incompleteSecurityCheck.stdout).checks.some((check) => check.id === "securityBaseline" && check.status === "fail"), "checker rejects incomplete security domains");
fs.writeFileSync(acceptedWithSecurity.artifactPath, acceptedArtifactText, "utf8");

const result = run(checkAcceptance);
assert.equal(result.gate.decision, "pass", "acceptance gate passes with smoke evidence");
const explicitAcceptanceResult = run(checkAcceptance, ["--acceptance-artifact", path.relative(workspace, result.latestAcceptance)]);
assert.equal(explicitAcceptanceResult.gate.decision, "pass", "acceptance gate supports an explicit artifact instead of relying on manifest latest");
assert.equal(fs.realpathSync(explicitAcceptanceResult.latestAcceptance), fs.realpathSync(result.latestAcceptance));
assert.ok(result.latestAnalysis, "acceptance discovers analysis artifact");
assert.ok(result.latestAcceptance, "acceptance discovers acceptance artifact");
assert.ok(result.latestWorkstream, "acceptance discovers workstream artifact");
assert.ok(result.latestSmoke, "acceptance discovers smoke artifact");
assert.equal(fs.realpathSync(result.latestAnalysis), fs.realpathSync(analysis.artifactPath), "acceptance checker uses the explicitly bound analysis artifact");
const finalManifest = JSON.parse(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"));
assert.notEqual(
  fs.realpathSync(path.join(workspace, finalManifest.modules.analysis.latestArtifact)),
  fs.realpathSync(result.latestAnalysis),
  "acceptance checker does not silently replace the bound object with a newer unrelated analysis artifact"
);
assert.ok(result.checks.some((check) => check.id === "securityBaseline" && check.status === "pass"), "acceptance checks security baseline");
assert.ok(result.checks.some((check) => check.id === "pmAcceptancePackage" && check.status === "pass"), "acceptance checks PM acceptance package");
assert.ok(result.checks.some((check) => check.id === "acceptanceItems" && check.status === "pass"), "acceptance validates item schema");
assert.ok(result.checks.some((check) => check.id === "overallStatus" && check.status === "pass"), "acceptance derives the overall status ceiling");
assert.ok(result.checks.some((check) => check.id === "realResponseEvidence" && check.status === "pass"), "acceptance requires real response evidence");
assert.ok(result.checks.some((check) => check.id === "visualEvidence" && check.status === "pass"), "acceptance requires visual or explicit alternative evidence");
assert.ok(result.checks.some((check) => check.id === "reviewEvidence" && check.status === "skip"), "acceptance does not borrow an unrelated latest Review artifact");
assert.ok(result.checks.some((check) => check.id === "knowledgeEvidence" && check.status === "skip"), "acceptance does not borrow unrelated latest Knowledge evidence");

const dashboardUi = runEnv(dashboardUiTest, [], {
  RAVO_UI_TEST_REQUIRED: process.env.RAVO_UI_TEST_REQUIRED || "0"
}, repo);
assert.ok(["pass", "skipped"].includes(dashboardUi.status), "SoloDesk browser UI matrix passes or reports an explicit unavailable environment");
const reviewRuntime = run(reviewRuntimeTest, [], repo);
assert.equal(reviewRuntime.status, "pass", "dedicated Review runtime matrix passes");
const reviewMigration = run(reviewMigrationTest, [], repo);
assert.equal(reviewMigration.status, "pass", "legacy Review migration matrix passes");
const runtimeStatus = run(ravoStatusTest, [], repo);
assert.equal(runtimeStatus.status, "pass", "RAVO Runtime status matrix passes");
const runtimeProbe = run(runtimeProbeTest, [], repo);
assert.equal(runtimeProbe.status, "pass", "RAVO Runtime probe writer matrix passes");
const dashboardFreshness = run(dashboardFreshnessTest, [], repo);
assert.equal(dashboardFreshness.status, "pass", "RAVO freshness matrix passes");
const dashboardLineage = run(dashboardLineageTest, [], repo);
assert.equal(dashboardLineage.status, "pass", "RAVO authoritative lineage matrix passes");
const dashboardConfig = run(dashboardConfigTest, [], repo);
assert.equal(dashboardConfig.status, "pass", "SoloDesk config matrix passes");
const dashboardUpgrade = run(dashboardUpgradeTest, [], repo);
assert.equal(dashboardUpgrade.status, "pass", "SoloDesk upgrade matrix passes");
const dashboardData = run(dashboardDataTest, [], repo);
assert.equal(dashboardData.status, "pass", "SoloDesk data matrix passes");
const dashboardApi = run(dashboardApiTest, [], repo);
assert.equal(dashboardApi.status, "pass", "SoloDesk API security and integration matrix passes");
const dashboardShortcuts = run(dashboardShortcutTest, [], repo);
assert.equal(dashboardShortcuts.status, "pass", "SoloDesk Continuation, Knowledge, and shortcut matrix passes");
const pluginResolver = run(pluginResolverTest, [], repo);
assert.equal(pluginResolver.status, "pass", "version-independent plugin resolver matrix passes");
const configIntegrity = run(configIntegrityTest, [], repo);
assert.equal(configIntegrity.status, "pass", "Codex config-integrity snapshot, repair, rollback, and recovery matrix passes");
const solodeskController = run(solodeskControllerTest, [], repo);
assert.equal(solodeskController.status, "pass", "SoloDesk controller lifecycle matrix passes");
const solodeskService = run(solodeskServiceTest, [], repo);
assert.equal(solodeskService.status, "pass", "SoloDesk managed service state and restart matrix passes");
const workstreamGovernance = run(workstreamGovernanceTest, [], repo);
assert.equal(workstreamGovernance.status, "pass", "RAVO execution governance matrix passes");
const acceptanceScope = run(acceptanceScopeTest, [], repo);
assert.equal(acceptanceScope.status, "pass", "RAVO milestone acceptance scope matrix passes");
const versionAlignment = run(versionAlignmentTest, [], repo);
assert.equal(versionAlignment.status, "pass", "RAVO product and compatibility versions remain mechanically separated");

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: result.checks.map((check) => `${check.id}:${check.status}`)
}, null, 2));
