#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const writer = path.join(repo, "plugins/ravo/modules/ravo-quick-validation/scripts/write-smoke-artifact.js");
const checker = path.join(repo, "plugins/ravo/modules/ravo-quick-validation/scripts/check-smoke-artifact.js");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-runtime-probe-")));
const expected = ["Stop"];

function evidence(event, status = "pass") {
  return JSON.stringify({
    event,
    status,
    sessionId: "session-real-1",
    promptRef: "knowledge/runtime-probe-prompt.md",
    expectedAdvisory: `${event} behavior matches the v0.6 contract`,
    responseSummary: `${event} produced representative fresh-session evidence.`,
    evidenceRef: `knowledge/runtime-evidence/${event}.json`
  });
}

function baseArgs(status) {
  return [
    writer,
    "--workspace", workspace,
    "--kind", "runtime_probe",
    "--scope", "RAVO Runtime",
    "--status", status,
    "--fingerprint", "sha256:runtime",
    "--plugin-fingerprint", "sha256:plugins",
    "--config-fingerprint", "sha256:config",
    "--session-id", "session-real-1",
    "--prompt-ref", "knowledge/runtime-probe-prompt.md",
    ...expected.flatMap((event) => ["--expected-hook-event", event])
  ];
}

const help = execFileSync(process.execPath, [writer, "--help"], { cwd: workspace, encoding: "utf8" });
assert.match(help, /runtime_probe/);
assert.equal(fs.existsSync(path.join(workspace, "knowledge/.ravo/quick-validation")), false);

const falsePass = spawnSync(process.execPath, [...baseArgs("pass"), "--observed-evidence", evidence("Stop", "missing")], { cwd: workspace, encoding: "utf8" });
assert.notEqual(falsePass.status, 0);
assert.match(falsePass.stderr, /status must be fail/);

const missingOutput = JSON.parse(execFileSync(process.execPath, [
  ...baseArgs("fail"),
  "--observed-evidence", evidence("Stop", "missing")
], { cwd: workspace, encoding: "utf8" }));
const missing = JSON.parse(fs.readFileSync(missingOutput.artifactPath, "utf8"));
assert.equal(missing.status, "fail");
assert.equal(missing.coverage, "none");
assert.equal(missing.coreRuntimeStatus, "missing");
assert.equal(missing.coreCoverage, "not_applicable");
assert.deepEqual(missing.coreExpectedEvents, []);
assert.equal(missing.terminalTelemetry.status, "unknown");
assert.equal(missing.subagentEvidenceStatus, "not_requested");
const missingCheckResult = spawnSync(process.execPath, [checker], { cwd: workspace, encoding: "utf8" });
assert.equal(missingCheckResult.status, 2);

const unsupportedOutput = JSON.parse(execFileSync(process.execPath, [
  ...baseArgs("fail"),
  "--terminal-telemetry-status", "unsupported",
  "--terminal-telemetry-summary", "The current host does not expose Stop runtime evidence.",
  "--observed-evidence", evidence("Stop", "missing")
], { cwd: workspace, encoding: "utf8" }));
const unsupported = JSON.parse(fs.readFileSync(unsupportedOutput.artifactPath, "utf8"));
assert.equal(unsupported.coreRuntimeStatus, "missing");
assert.equal(unsupported.terminalTelemetry.status, "unsupported");

const fullOutput = JSON.parse(execFileSync(process.execPath, [
  ...baseArgs("pass"),
  ...expected.flatMap((event) => ["--observed-evidence", evidence(event)])
], { cwd: workspace, encoding: "utf8" }));
const full = JSON.parse(fs.readFileSync(fullOutput.artifactPath, "utf8"));
assert.equal(full.status, "pass");
assert.equal(full.coverage, "full");
assert.deepEqual(full.expectedHookEvents, expected);
assert.deepEqual(full.sessionIds, ["session-real-1"]);

const missingResponse = spawnSync(process.execPath, [
  ...baseArgs("pass"),
  "--observed-evidence", JSON.stringify({
    event: "Stop",
    status: "pass",
    sessionId: "session-real-1",
    promptRef: "knowledge/runtime-probe-prompt.md",
    expectedAdvisory: "visible",
    responseSummary: "",
    evidenceRef: "knowledge/runtime-evidence/stop.json"
  })
], { cwd: workspace, encoding: "utf8" });
assert.notEqual(missingResponse.status, 0);
assert.match(missingResponse.stderr, /responseSummary is required/);

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: [
    "help-read-only",
    "false-pass-rejected",
    "missing-stop-evidence-blocks",
    "stop-unsupported-explicit",
    "full-stop-hook-coverage",
    "real-response-summary-required"
  ]
}, null, 2));
