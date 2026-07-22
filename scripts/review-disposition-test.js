#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-disposition-")));
const writer = path.join(repo, "plugins/ravo/modules/ravo-review/scripts/record-review-disposition.js");
const checker = path.join(repo, "plugins/ravo/modules/ravo-review/scripts/check-review-disposition.js");
const { checkLedger } = require("../plugins/ravo/modules/ravo-review/scripts/review-disposition");
const ledgerRef = "knowledge/.ravo/review/issues/disposition-fixture.json";
const ledgerPath = path.join(workspace, ledgerRef);

function issue(id, severity, verificationStatus = "ready") {
  return {
    id,
    title: `${id} finding`,
    severity,
    evidence: "Fixture evidence.",
    mechanismRisk: "Fixture mechanism risk.",
    recommendation: "Fixture recommendation.",
    verificationStatus,
    decisionEligibility: verificationStatus === "missing" ? "advisory_only" : "pending_local_verification",
    localDisposition: { status: "pending", verificationMethod: "none", evidenceRefs: [], observed: "", reason: "", environment: "", decidedAt: "" }
  };
}

function writeLedger(issues) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({ schemaVersion: "0.5.6", decisionImpact: "Current release decision depends on this Review.", issues }, null, 2)}\n`, "utf8");
}

function run(script, args) {
  return spawnSync(process.execPath, [script, "--workspace", workspace, "--issue-ledger-ref", ledgerRef, ...args], { encoding: "utf8" });
}

writeLedger([issue("RR-REJECT", "high"), issue("RR-CONFIRM", "critical")]);

const malformed = run(writer, ["--issue-id", "RR-REJECT", "--status", "rejected", "--verification-method", "file_inspection"]);
assert.notEqual(malformed.status, 0, "resolved high finding requires local evidence");

const rejected = run(writer, [
  "--issue-id", "RR-REJECT",
  "--status", "rejected",
  "--verification-method", "file_inspection",
  "--evidence-ref", "evidence/xcode-help.txt",
  "--observed", "Current tool help contradicts the finding.",
  "--environment", "Xcode 26.6"
]);
assert.equal(rejected.status, 0, rejected.stderr);
assert.equal(JSON.parse(rejected.stdout).decisionEligibility, "eligible");
assert.equal(JSON.parse(fs.readFileSync(ledgerPath, "utf8")).issues[0].recommendation, "Fixture recommendation.", "disposition retains the original external finding");

const unresolved = run(checker, []);
assert.equal(unresolved.status, 2);
assert.equal(JSON.parse(unresolved.stdout).status, "not_ready");

const confirmed = run(writer, [
  "--issue-id", "RR-CONFIRM",
  "--status", "confirmed",
  "--verification-method", "script",
  "--evidence-ref", "evidence/reproduction.json",
  "--observed", "The isolated fixture reproduces the finding.",
  "--environment", "fixture-v1"
]);
assert.equal(confirmed.status, 0, confirmed.stderr);
const resolved = run(checker, []);
assert.equal(resolved.status, 0, resolved.stderr);
assert.equal(JSON.parse(resolved.stdout).status, "pass");

writeLedger([issue("RR-MISSING", "high", "missing")]);
const missing = run(checker, []);
assert.equal(missing.status, 2);
assert.match(JSON.parse(missing.stdout).unresolvedHigh[0].reason, /verification_missing/);
const outOfScope = run(writer, [
  "--issue-id", "RR-MISSING",
  "--status", "out_of_scope",
  "--verification-method", "none",
  "--reason", "The finding targets a different product version."
]);
assert.equal(outOfScope.status, 0, outOfScope.stderr);
assert.equal(run(checker, []).status, 0);

const noImpactPending = { issues: [issue("RR-NO-IMPACT", "high")] };
assert.equal(checkLedger(noImpactPending).status, "pass");
assert.equal(checkLedger(noImpactPending, { requireAllHigh: true }).status, "not_ready");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "high finding requires evidence before confirmed or rejected",
    "rejected and confirmed dispositions preserve the external finding",
    "unresolved high finding blocks the disposition checker",
    "missing verification can only be resolved with an explicit scope decision",
    "terminal acceptance can require every high finding to be resolved"
  ]
}, null, 2));
