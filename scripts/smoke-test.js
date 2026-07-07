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
const writeDecisionSpec = path.join(repo, "plugins", "ravo-analysis", "scripts", "write-decision-spec.js");

run(coreInit);
assert.ok(exists("knowledge/.ravo/manifest.json"), "core creates manifest");
assert.ok(exists("knowledge/.ravo/analysis"), "core creates analysis dir");
assert.ok(exists("knowledge/.ravo/acceptance"), "core creates acceptance dir");
assert.ok(exists("knowledge/.ravo/quick-validation"), "core creates quick-validation dir");

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
const retrieved = run(retrieveKnowledge, ["--query", "release readiness evidence"]);
assert.ok(retrieved.matches.length >= 1, "knowledge retrieval returns a match");

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
const generatedGoal = run(goalPrompt, ["--workspace", generatedSpecWorkspace]);
assert.equal(generatedGoal.status, "ok", "goal prompt can use generated decision-complete spec");

const userKnowledgeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-user-knowledge-"));
const leak = runStatus(writeKnowledge, [
  "--workspace", workspace,
  "--scope", "user",
  "--opt-in", "true",
  "--kind", "lesson",
  "--content", "Never leak CANARY_CUSTOMER_42 into reusable lessons",
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
  "--applicability", "requirement refinement",
  "--canary", "CANARY_CUSTOMER_42"
], {
  cwd: workspace,
  encoding: "utf8",
  env: { ...process.env, RAVO_USER_KNOWLEDGE_DIR: userKnowledgeDir },
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(userLesson.status, 0, userLesson.stderr);

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

fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
fs.copyFileSync(path.join(repo, "docs", "ravo-v0.2-decision-complete-spec.md"), path.join(workspace, "docs", "ravo-v0.2-decision-complete-spec.md"));
const suggestedGoal = run(goalPrompt, ["--workspace", workspace]);
assert.equal(suggestedGoal.status, "ok", "goal prompt script finds decision-complete spec");
assert.match(suggestedGoal.goalPrompt, /严格按照/);

const result = run(checkAcceptance);
assert.equal(result.gate.decision, "pass", "acceptance gate passes with smoke evidence");
assert.ok(result.latestAnalysis, "acceptance discovers analysis artifact");
assert.ok(result.latestAcceptance, "acceptance discovers acceptance artifact");
assert.ok(result.latestWorkstream, "acceptance discovers workstream artifact");
assert.ok(result.latestSmoke, "acceptance discovers smoke artifact");

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: result.checks.map((check) => `${check.id}:${check.status}`)
}, null, 2));
