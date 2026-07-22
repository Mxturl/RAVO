#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const migrator = path.join(repo, "plugins/ravo/modules/ravo-review/scripts/migrate-review-artifact.js");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-migration-")));
const reviewDir = path.join(workspace, "knowledge/.ravo/review");
fs.mkdirSync(reviewDir, { recursive: true });

function reviewer(model) {
  return {
    status: "completed",
    output_text: JSON.stringify({
      summary: `${model} summary`,
      findings: [{
        title: `${model} finding`,
        severity: "high",
        evidence: "Legacy raw response contains a concrete finding.",
        mechanismRisk: "Old coverage may have been computed before schema validation.",
        recommendation: "Re-parse raw responses under the v0.5 contract."
      }]
    })
  };
}

const rawRef = "knowledge/.ravo/review/raw/legacy.json";
fs.mkdirSync(path.dirname(path.join(workspace, rawRef)), { recursive: true });
fs.writeFileSync(path.join(workspace, rawRef), JSON.stringify([
  { round: 1, model: "provider-a/model-a", result: reviewer("model-a") },
  { round: 1, model: "provider-b/model-b", result: reviewer("model-b") }
], null, 2), "utf8");
const sourceRef = "knowledge/.ravo/review/legacy-with-raw.json";
fs.writeFileSync(path.join(workspace, sourceRef), JSON.stringify({
  schemaVersion: "0.3.1",
  id: "legacy-with-raw",
  domain: "testing",
  coverage: "full",
  roundsRequested: 1,
  modelsRequested: ["provider-a/model-a", "provider-b/model-b"],
  modelsCompleted: ["provider-a/model-a", "provider-b/model-b"],
  rawResultRef: rawRef,
  createdAt: new Date().toISOString()
}, null, 2), "utf8");
const sourceBefore = fs.readFileSync(path.join(workspace, sourceRef), "utf8");
const migrated = JSON.parse(execFileSync(process.execPath, [
  migrator,
  "--workspace", workspace,
  "--source", sourceRef,
  "--subject-ref", "migration-subject",
  "--data-boundary", "safe_sanitized",
  "--authorization-source", "explicit_user_action"
], { cwd: workspace, encoding: "utf8" }));
assert.equal(migrated.workflowCoverage, "full");
assert.equal(migrated.parserStatus, "pass");
const derived = JSON.parse(fs.readFileSync(migrated.artifactPath, "utf8"));
assert.equal(derived.artifactKind, "derived_migration");
assert.equal(derived.sourceArtifactRef, sourceRef);
assert.equal(derived.provenance.sourceReviewRunId, "legacy-with-raw");
assert.equal(
  derived.provenance.sourceArtifactHash,
  `sha256:${crypto.createHash("sha256").update(sourceBefore).digest("hex")}`,
  "migration provenance binds the exact legacy source bytes"
);
assert.equal(derived.modelsUsable.length, 2);
assert.equal(derived.validResults, true);
assert.equal(fs.readFileSync(path.join(workspace, sourceRef), "utf8"), sourceBefore, "migration never rewrites the legacy source");

const noRawRef = "knowledge/.ravo/review/legacy-no-raw.json";
fs.writeFileSync(path.join(workspace, noRawRef), JSON.stringify({
  schemaVersion: "0.3.1",
  id: "legacy-no-raw",
  domain: "testing",
  coverage: "full",
  modelsCompleted: ["provider-a/model-a"],
  createdAt: new Date().toISOString()
}, null, 2), "utf8");
const noRawBefore = fs.readFileSync(path.join(workspace, noRawRef), "utf8");
const noRaw = JSON.parse(execFileSync(process.execPath, [
  migrator,
  "--workspace", workspace,
  "--source", noRawRef,
  "--subject-ref", "migration-no-raw"
], { cwd: workspace, encoding: "utf8" }));
assert.equal(noRaw.workflowCoverage, "none");
assert.equal(noRaw.parserStatus, "legacy_unclassified");
assert.equal(JSON.parse(fs.readFileSync(noRaw.artifactPath, "utf8")).validResults, false);
assert.equal(fs.readFileSync(path.join(workspace, noRawRef), "utf8"), noRawBefore);

const invalidRawRef = "knowledge/.ravo/review/raw/legacy-invalid.json";
fs.writeFileSync(path.join(workspace, invalidRawRef), JSON.stringify({ response: "legacy prose without structured findings" }), "utf8");
const invalidSourceRef = "knowledge/.ravo/review/legacy-invalid.json";
fs.writeFileSync(path.join(workspace, invalidSourceRef), JSON.stringify({
  schemaVersion: "0.3.1",
  id: "legacy-invalid",
  modelsRequested: ["provider-a/model-a"],
  rawResultRef: invalidRawRef
}, null, 2), "utf8");
const invalidRaw = JSON.parse(execFileSync(process.execPath, [
  migrator,
  "--workspace", workspace,
  "--source", invalidSourceRef,
  "--subject-ref", "migration-invalid",
  "--data-boundary", "safe_sanitized",
  "--authorization-source", "explicit_user_action"
], { cwd: workspace, encoding: "utf8" }));
const invalidDerived = JSON.parse(fs.readFileSync(invalidRaw.artifactPath, "utf8"));
assert.equal(invalidDerived.workflowCoverage, "none");
assert.equal(invalidDerived.validResults, false);
assert.match(invalidDerived.blockingReason, /empty_final_text|invalid_json|usable/i);
assert.ok(invalidDerived.risks.some((risk) => /not usable/.test(risk)));

const incompleteRoundsRef = "knowledge/.ravo/review/legacy-incomplete-rounds.json";
fs.writeFileSync(path.join(workspace, incompleteRoundsRef), JSON.stringify({
  schemaVersion: "0.4.0",
  id: "legacy-incomplete-rounds",
  domain: "testing",
  roundsRequested: 2,
  modelsRequested: ["provider-a/model-a", "provider-b/model-b"],
  rawResultRef: rawRef,
  createdAt: new Date().toISOString()
}, null, 2), "utf8");
const incompleteRounds = JSON.parse(execFileSync(process.execPath, [
  migrator,
  "--workspace", workspace,
  "--source", incompleteRoundsRef,
  "--subject-ref", "migration-incomplete-rounds",
  "--data-boundary", "safe_sanitized",
  "--authorization-source", "explicit_user_action"
], { cwd: workspace, encoding: "utf8" }));
assert.equal(incompleteRounds.workflowCoverage, "partial", "full migration requires every requested pair in every requested round");
assert.equal(JSON.parse(fs.readFileSync(incompleteRounds.artifactPath, "utf8")).validResults, true);

const severityRawRef = "knowledge/.ravo/review/raw/legacy-severity.json";
const severityFindings = ["critical", "high", "medium", "low"].map((severity) => ({
  title: `${severity} finding`,
  severity,
  evidence: `${severity} source evidence`,
  mechanismRisk: `${severity} mechanism risk`,
  recommendation: `${severity} recommendation`
}));
fs.writeFileSync(path.join(workspace, severityRawRef), JSON.stringify([
  {
    round: 1,
    model: "provider-a/model-a",
    result: {
      status: "completed",
      output_text: JSON.stringify({ summary: "severity preservation", findings: severityFindings })
    }
  }
], null, 2), "utf8");
const severitySourceRef = "knowledge/.ravo/review/legacy-severity.json";
fs.writeFileSync(path.join(workspace, severitySourceRef), JSON.stringify({
  schemaVersion: "0.4.0",
  id: "legacy-severity",
  domain: "testing",
  roundsRequested: 1,
  modelsRequested: ["provider-a/model-a"],
  rawResultRef: severityRawRef,
  createdAt: new Date().toISOString()
}, null, 2), "utf8");
const severityMigration = JSON.parse(execFileSync(process.execPath, [
  migrator,
  "--workspace", workspace,
  "--source", severitySourceRef,
  "--subject-ref", "migration-severity",
  "--data-boundary", "safe_sanitized",
  "--authorization-source", "explicit_user_action"
], { cwd: workspace, encoding: "utf8" }));
const severityDerived = JSON.parse(fs.readFileSync(severityMigration.artifactPath, "utf8"));
const severityLedger = JSON.parse(fs.readFileSync(path.join(workspace, severityDerived.issueLedgerRef), "utf8"));
assert.equal(severityDerived.rawFindingCount, severityFindings.length);
assert.equal(severityDerived.ledgerFindingCount, severityFindings.length);
assert.deepEqual(
  severityLedger.issues.map((issue) => [issue.title, issue.severity]).sort(([left], [right]) => left.localeCompare(right)),
  severityFindings.map((finding) => [finding.title, finding.severity]).sort(([left], [right]) => left.localeCompare(right)),
  "migration preserves every structured finding title and severity"
);

console.log(JSON.stringify({ status: "pass", workspace, checks: ["raw-derived", "no-raw-unclassified", "invalid-raw-blocker", "source-immutable", "pair-round-completeness", "finding-count-severity-preservation"] }, null, 2));
