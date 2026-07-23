#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const runtimeTest = path.join(__dirname, "review-runtime-test.js");
const evidenceRoot = path.join(repo, "knowledge", ".ravo", "evidence", "v0.5.1", "m6-review-resilience-e2e");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function repoRef(file) {
  return path.relative(repo, file);
}

function rewriteRefs(value, runRoot) {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item, runRoot));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if ((key === "artifactRef" || key === "partialResponseRef") && child) {
      return [key, repoRef(path.join(runRoot, "runtime-workspace", child))];
    }
    return [key, rewriteRefs(child, runRoot)];
  }));
}

function main() {
  const stdout = execFileSync(process.execPath, [runtimeTest], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const runtime = JSON.parse(stdout);
  assert.equal(runtime.status, "pass");
  assert.ok(runtime.workspace && fs.existsSync(runtime.workspace));

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(evidenceRoot, runId);
  const copiedWorkspace = path.join(runRoot, "runtime-workspace");
  fs.mkdirSync(runRoot, { recursive: true });
  fs.cpSync(runtime.workspace, copiedWorkspace, { recursive: true, force: false, errorOnExist: true });

  const evidence = {
    schemaVersion: "0.5.1",
    evidenceType: "review_resilience_production_runner_e2e",
    status: "pass",
    createdAt: new Date().toISOString(),
    runId,
    implementationPath: "plugins/ravo/modules/ravo-review/scripts/run-review.js",
    transportPath: "real_loopback_http_network_with_controlled_failure_fixture",
    externalProviderNaturalFailureClaimed: false,
    testCommand: "node scripts/review-runtime-test.js",
    checks: runtime.checks,
    evidence: rewriteRefs(runtime.resilienceEvidence, runRoot),
    retainedWorkspaceRef: repoRef(copiedWorkspace),
    notes: [
      "The production Review runner performed real HTTP requests against a loopback fault-injection server.",
      "The fixture is not claimed as a second external Provider or as a naturally occurring external Provider failure.",
      "Formal preflight rejection is proven by unchanged route request counters."
    ]
  };
  const runEvidence = path.join(runRoot, "review-resilience-e2e.json");
  const latestEvidence = path.join(evidenceRoot, "latest.json");
  writeJson(runEvidence, evidence);
  writeJson(latestEvidence, { ...evidence, runEvidenceRef: repoRef(runEvidence) });
  fs.rmSync(runtime.workspace, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ...evidence, runEvidenceRef: repoRef(runEvidence), latestEvidenceRef: repoRef(latestEvidence) }, null, 2)}\n`);
}

main();
