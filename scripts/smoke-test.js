#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-smoke-"));

function run(script, args = [], cwd = workspace) {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8"
  });
  return JSON.parse(output);
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

const analysis = run(writeAnalysis, [
  "--type", "root-cause",
  "--title", "Smoke root cause",
  "--symptom", "readiness claim without evidence",
  "--proximate-cause", "missing artifact check",
  "--mechanism-root-cause", "status and evidence were not connected",
  "--conclusion", "acceptance must discover artifacts before release claims"
]);
assert.ok(fs.existsSync(analysis.artifactPath), "analysis artifact exists");

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
