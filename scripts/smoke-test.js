#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-smoke-"));

function run(script, args = [], cwd = workspace) {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8"
  });
  return JSON.parse(output);
}

function runEnv(script, args = [], env = {}, cwd = workspace) {
  const output = execFileSync(process.execPath, [script, ...args], {
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

const coreInit = path.join(repo, "plugins", "ravo-core", "scripts", "ravo-init.js");
const writeAnalysis = path.join(repo, "plugins", "ravo-analysis", "scripts", "write-analysis-artifact.js");
const writeAcceptance = path.join(repo, "plugins", "ravo-acceptance", "scripts", "write-acceptance-artifact.js");
const checkAcceptance = path.join(repo, "plugins", "ravo-acceptance", "scripts", "check-ravo-acceptance.js");
const writeWorkstream = path.join(repo, "plugins", "ravo-workstream", "scripts", "write-workstream-artifact.js");
const writeSmoke = path.join(repo, "plugins", "ravo-quick-validation", "scripts", "write-smoke-artifact.js");
const checkSmoke = path.join(repo, "plugins", "ravo-quick-validation", "scripts", "check-smoke-artifact.js");
const writeKnowledge = path.join(repo, "plugins", "ravo-knowledge", "scripts", "write-knowledge-artifact.js");
const retrieveKnowledge = path.join(repo, "plugins", "ravo-knowledge", "scripts", "retrieve-knowledge.js");
const goalPrompt = path.join(repo, "plugins", "ravo-core", "scripts", "ravo-goal-prompt.js");
const ravoStatus = path.join(repo, "plugins", "ravo-core", "scripts", "ravo-status.js");
const writeDecisionSpec = path.join(repo, "plugins", "ravo-analysis", "scripts", "write-decision-spec.js");
const writeReview = path.join(repo, "plugins", "ravo-review", "scripts", "write-review-artifact.js");
const runReview = path.join(repo, "plugins", "ravo-review", "scripts", "run-review.js");
const captureKnowledge = path.join(repo, "plugins", "ravo-knowledge", "scripts", "capture-knowledge.js");
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

run(coreInit);
assert.ok(exists("knowledge/.ravo/manifest.json"), "core creates manifest");
assert.ok(exists("knowledge/.ravo/analysis"), "core creates analysis dir");
assert.ok(exists("knowledge/.ravo/acceptance"), "core creates acceptance dir");
assert.ok(exists("knowledge/.ravo/quick-validation"), "core creates quick-validation dir");
assert.ok(exists("knowledge/.ravo/review"), "core creates review dir");

fs.mkdirSync(path.join(workspace, "knowledge/.ravo"), { recursive: true });
fs.writeFileSync(path.join(workspace, "knowledge/.ravo/config.json"), JSON.stringify({ technicalDetailLevel: 9 }, null, 2), "utf8");
const statusReport = run(ravoStatus, ["--workspace", workspace, "--repo", repo], repo);
assert.equal(statusReport.config.technicalDetailLevel, 3, "invalid technicalDetailLevel falls back to 3");
assert.ok(statusReport.warnings.some((warning) => /technicalDetailLevel/.test(warning)), "invalid technicalDetailLevel is visible");
assert.ok(statusReport.plugins.some((plugin) => plugin.name === "ravo-review" && plugin.present), "ravo-status reports ravo-review");

const invalidRequirement = runStatus(writeAnalysis, [
  "--type", "requirement",
  "--status", "complete",
  "--title", "Invalid requirement",
  "--conclusion", "missing hard constraints"
]);
assert.notEqual(invalidRequirement.status, 0, "incomplete complete requirement artifact should fail");
assert.match(String(invalidRequirement.stderr || ""), /requires at least one --fact|requires --challenge/);

const analysis = run(writeAnalysis, [
  "--type", "root-cause",
  "--status", "complete",
  "--title", "Smoke root cause",
  "--symptom", "readiness claim without evidence",
  "--proximate-cause", "missing artifact check",
  "--mechanism-root-cause", "status and evidence were not connected",
  "--alternative-hypothesis", "checker output was stale",
  "--why", "the shared gate never required a root-level evidence link",
  "--conclusion", "acceptance must discover artifacts before release claims"
]);
assert.ok(fs.existsSync(analysis.artifactPath), "analysis artifact exists");
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "knowledge/.ravo/manifest.json"), "utf8"));
assert.equal(
  fs.realpathSync(path.join(workspace, manifest.modules.analysis.latestCompleteArtifact)),
  fs.realpathSync(analysis.artifactPath),
  "manifest tracks latest complete analysis artifact"
);

const acceptance = run(writeAcceptance, [
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "Smoke evidence passed",
  "--analysis-artifact", path.relative(workspace, analysis.artifactPath)
]);
assert.ok(fs.existsSync(acceptance.artifactPath), "acceptance artifact exists");

const acceptedWithoutSecurity = runStatus(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Accepted without security baseline"
]);
assert.notEqual(acceptedWithoutSecurity.status, 0, "accepted without security baseline should fail");
assert.match(String(acceptedWithoutSecurity.stderr || ""), /security baseline/);

const workstream = run(writeWorkstream, [
  "--status", "active",
  "--goal", "RAVO smoke workstream",
  "--spec-ref", "docs/ravo-v0.2-decision-complete-spec.md",
  "--current-milestone", "smoke",
  "--next-step", "run acceptance",
  "--evidence-ref", path.relative(workspace, analysis.artifactPath)
]);
assert.ok(fs.existsSync(workstream.artifactPath), "workstream artifact exists");

const invalidBlockedWorkstream = runStatus(writeWorkstream, [
  "--status", "blocked",
  "--goal", "Blocked without recovery",
  "--blocker", "external approval missing"
]);
assert.notEqual(invalidBlockedWorkstream.status, 0, "blocked workstream without recovery should fail");
assert.match(String(invalidBlockedWorkstream.stderr || ""), /requires --recovery/);

const smoke = run(writeSmoke, [
  "--scope", "RAVO smoke",
  "--status", "pass",
  "--check", "script smoke passed",
  "--evidence-ref", path.relative(workspace, workstream.artifactPath)
]);
assert.ok(fs.existsSync(smoke.artifactPath), "smoke artifact exists");
assert.equal(run(checkSmoke).gate.decision, "pass", "smoke gate passes with pass evidence");

const knowledge = run(writeKnowledge, [
  "--kind", "lesson",
  "--content", "Do not claim release readiness without evidence",
  "--applicability", "release readiness"
]);
assert.ok(fs.existsSync(knowledge.artifactPath), "knowledge artifact exists");
assert.ok(fs.existsSync(knowledge.markdownPath), "knowledge markdown exists");
assert.ok(fs.existsSync(knowledge.indexPath), "knowledge index exists");
const retrieved = run(retrieveKnowledge, ["--query", "release readiness evidence"]);
assert.ok(retrieved.matches.length >= 1, "knowledge retrieval returns a match");
assert.ok(retrieved.matches[0].summary !== undefined, "knowledge retrieval returns summary field");

const fullKnowledge = run(writeKnowledge, [
  "--kind", "lesson",
  "--summary", "Short summary",
  "--content", "Full artifact keeps exact retrieval phrase FRESH_FULL_ARTIFACT_TOKEN"
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
assert.equal(draftGoal.status, "missing_spec", "draft specs cannot generate runnable Goal prompts");
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
  "--kind", "lesson",
  "--content", "Preserve original user requirements and propose changes separately",
  "--summary", "Preserve user requirements while proposing changes separately",
  "--source", "smoke-test",
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
  "--applicability", "release readiness"
]);
assert.ok(fs.existsSync(captured.markdownPath), "capture writes markdown knowledge");
assert.match(captured.captureNotice, /Workspace-local RAVO knowledge written/);

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
  "--coverage", "partial",
  "--model-requested", "model-a",
  "--model-completed", "model-a",
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
fs.writeFileSync(fullConfigPath, JSON.stringify({
  apiMode: "fake",
  apiBase: "fake://review",
  apiKey: "SECRET_SHOULD_NOT_PRINT",
  models: "fake-a,fake-b"
}, null, 2), "utf8");
const fullReview = runEnv(runReview, [
  "--workspace", workspace,
  "--config", fullConfigPath,
  "--domain", "architecture",
  "--subject", "Upgrade RAVO Review to call configured providers"
]);
assert.equal(fullReview.coverage, "full", "fake provider success gives full review coverage");
assert.equal(fullReview.modelsCompleted.length, 2, "all fake models complete");
assert.doesNotMatch(JSON.stringify(fullReview), /SECRET_SHOULD_NOT_PRINT/, "review runner does not print api keys");

const partialConfigPath = path.join(reviewConfigDir, "partial.json");
fs.writeFileSync(partialConfigPath, JSON.stringify({
  providers: [
    {
      id: "fake-provider",
      enabled: true,
      apiMode: "fake",
      apiBase: "fake://review",
      apiKey: "SECRET_SHOULD_NOT_PRINT",
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
assert.equal(timeoutReview.coverage, "partial", "timeout plus truncation gives partial coverage");
assert.match(timeoutReview.failedModelReasons.join("\n"), /timeout/);
assert.match(timeoutReview.truncationWarnings.join("\n"), /truncation|timeout/);

fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
fs.copyFileSync(path.join(repo, "docs", "ravo-v0.2-decision-complete-spec.md"), path.join(workspace, "docs", "ravo-v0.2-decision-complete-spec.md"));
const suggestedGoal = run(goalPrompt, ["--workspace", workspace]);
assert.equal(suggestedGoal.status, "ok", "goal prompt script finds decision-complete spec");
assert.match(suggestedGoal.goalPrompt, /严格按照/);

const acceptedWithSecurity = run(writeAcceptance, [
  "--status", "accepted",
  "--evidence-level", "smoke",
  "--summary", "Accepted smoke evidence with security baseline",
  "--analysis-artifact", path.relative(workspace, analysis.artifactPath),
  ...securityPassArgs
]);
assert.ok(fs.existsSync(acceptedWithSecurity.artifactPath), "accepted artifact with security exists");

const result = run(checkAcceptance);
assert.equal(result.gate.decision, "pass", "acceptance gate passes with smoke evidence");
assert.ok(result.latestAnalysis, "acceptance discovers analysis artifact");
assert.ok(result.latestAcceptance, "acceptance discovers acceptance artifact");
assert.ok(result.latestWorkstream, "acceptance discovers workstream artifact");
assert.ok(result.latestSmoke, "acceptance discovers smoke artifact");
assert.ok(result.latestReview, "acceptance discovers review artifact");
assert.ok(result.latestKnowledge, "acceptance discovers knowledge artifact");
assert.ok(result.checks.some((check) => check.id === "securityBaseline" && check.status === "pass"), "acceptance checks security baseline");
assert.ok(result.checks.some((check) => check.id === "reviewEvidence"), "acceptance checks review evidence");
assert.ok(result.checks.some((check) => check.id === "knowledgeEvidence"), "acceptance checks knowledge evidence");

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: result.checks.map((check) => `${check.id}:${check.status}`)
}, null, 2));
