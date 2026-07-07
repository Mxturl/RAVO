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

run(coreInit);
assert.ok(exists("knowledge/.ravo/manifest.json"), "core creates manifest");
assert.ok(exists("knowledge/.ravo/analysis"), "core creates analysis dir");
assert.ok(exists("knowledge/.ravo/acceptance"), "core creates acceptance dir");

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

const result = run(checkAcceptance);
assert.equal(result.gate.decision, "pass", "acceptance gate passes with smoke evidence");
assert.ok(result.latestAnalysis, "acceptance discovers analysis artifact");
assert.ok(result.latestAcceptance, "acceptance discovers acceptance artifact");

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: result.checks.map((check) => `${check.id}:${check.status}`)
}, null, 2));
