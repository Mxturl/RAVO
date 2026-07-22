#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { acceptanceFreshness, buildFreshness, reviewFreshness } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-freshness");
const { formalReviewTelemetry } = require("./fixtures/review-v0.5.1-telemetry");

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-freshness-")));
const healthyRuntime = { runtimeHealth: "healthy", fingerprint: "sha256:runtime", runtimeProbeStatus: "pass" };
const configuredRuntime = { runtimeHealth: "configured_unverified", fingerprint: "sha256:runtime", runtimeProbeStatus: "missing" };

function write(file, value) {
  const target = path.join(workspace, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function time(file, seconds) {
  const date = new Date(seconds * 1000);
  fs.utimesSync(file, date, date);
}

const specRef = "docs/product-decision-complete-spec.md";
const spec = write(specRef, [
  "# Product Spec",
  "",
  "Status: accepted",
  "",
  "## Product Definition",
  "## Module Contracts",
  "## Validation Matrix",
  "## Trigger Rules",
  "## Assumptions"
].join("\n"));
const workstreamRef = "knowledge/.ravo/workstream/current.json";
const workstream = write(workstreamRef, {
  schemaVersion: "0.5.0",
  id: "workstream",
  status: "active",
  subjectRef: "release-1",
  releaseRef: "release-1",
  specRef,
  createdAt: "2026-01-01T00:00:00.000Z"
});
const acceptanceRef = "knowledge/.ravo/acceptance/current.json";
const acceptance = write(acceptanceRef, {
  schemaVersion: "0.5.0",
  id: "acceptance",
  status: "accepted",
  subjectRef: "release-1",
  releaseRef: "release-1",
  sourceRefs: [specRef, workstreamRef],
  acceptanceItems: [],
  createdAt: "2026-01-02T00:00:00.000Z"
});
time(spec, 100);
time(workstream, 110);
time(acceptance, 120);

const currentAcceptance = acceptanceFreshness(workspace, healthyRuntime);
assert.equal(currentAcceptance.status, "current");
assert.equal(currentAcceptance.confidence, "high");
assert.ok(currentAcceptance.sourceRefs.includes(specRef));

const mediumAcceptance = acceptanceFreshness(workspace, configuredRuntime);
assert.equal(mediumAcceptance.status, "current");
assert.equal(mediumAcceptance.confidence, "medium");

time(workstream, 130);
const staleAcceptance = acceptanceFreshness(workspace, healthyRuntime);
assert.equal(staleAcceptance.status, "stale");
assert.equal(staleAcceptance.confidence, "low");
assert.ok(staleAcceptance.staleSources.includes(workstreamRef));
time(workstream, 110);

const analysisRef = "knowledge/.ravo/analysis/high-impact.json";
const analysis = write(analysisRef, {
  schemaVersion: "0.5.0",
  id: "analysis",
  type: "requirement",
  status: "complete",
  impactLevel: "high",
  reviewRequired: true,
  reviewEvidence: "full",
  reviewRunId: "review-run-1",
  reviewArtifact: "knowledge/.ravo/review/review-run-1.json",
  subjectRef: "analysis-subject",
  createdAt: "2026-01-03T00:00:00.000Z"
});
const review = write("knowledge/.ravo/review/review-run-1.json", {
  ...formalReviewTelemetry(),
  id: "review-run-1",
  reviewRunId: "review-run-1",
  subjectRef: "analysis-subject",
  workflowCoverage: "full",
  coverage: "full",
  parserStatus: "pass",
  validResults: true,
  modelsUsable: ["provider/model"],
  createdAt: "2026-01-04T00:00:00.000Z"
});
time(analysis, 200);
time(review, 210);
const currentReview = reviewFreshness(workspace, healthyRuntime);
assert.equal(currentReview.status, "current");
assert.equal(currentReview.freshness, "current");
assert.equal(currentReview.confidence, "high");

const partialReviewArtifact = JSON.parse(fs.readFileSync(review, "utf8"));
partialReviewArtifact.workflowCoverage = "partial";
partialReviewArtifact.coverage = "partial";
fs.writeFileSync(review, `${JSON.stringify(partialReviewArtifact, null, 2)}\n`, "utf8");
time(review, 210);
const partialReview = reviewFreshness(workspace, healthyRuntime);
assert.equal(partialReview.status, "partial");
assert.equal(partialReview.confidence, "low");

partialReviewArtifact.workflowCoverage = "full";
partialReviewArtifact.coverage = "full";
fs.writeFileSync(review, `${JSON.stringify(partialReviewArtifact, null, 2)}\n`, "utf8");
time(review, 210);
time(analysis, 220);
const staleReview = reviewFreshness(workspace, healthyRuntime);
assert.equal(staleReview.status, "needed");
assert.equal(staleReview.freshness, "stale");
time(analysis, 200);

const specHealthCurrent = buildFreshness(workspace, { runtimeStatus: healthyRuntime, spec: specRef });
assert.equal(specHealthCurrent.specHealth.status, "current");
const alignment = write("docs/newer-alignment.md", "# Alignment\n\nStatus: alignment draft\n");
time(alignment, 300);
const staleSpec = buildFreshness(workspace, { runtimeStatus: healthyRuntime, spec: specRef });
assert.equal(staleSpec.specHealth.status, "stale");
assert.ok(staleSpec.specHealth.staleInputs.includes("docs/newer-alignment.md"));

write("knowledge/.ravo/acceptance/zz-unknown.json", {
  schemaVersion: "0.5.0",
  id: "unknown",
  status: "accepted",
  subjectRef: "another-release",
  releaseRef: "",
  specRef,
  sourceRefs: [],
  acceptanceItems: [],
  createdAt: "2027-01-01T00:00:00.000Z"
});
const unknownAcceptance = acceptanceFreshness(workspace, healthyRuntime);
assert.equal(unknownAcceptance.status, "current", "an unrelated newer acceptance must not replace the artifact bound to the active workstream");
assert.equal(unknownAcceptance.relationStatus, "matched");
assert.equal(unknownAcceptance.artifactPath, acceptanceRef);

console.log(JSON.stringify({
  status: "pass",
  workspace,
  checks: [
    "acceptance-current",
    "runtime-confidence",
    "acceptance-stale-source",
    "review-current",
    "review-partial",
    "review-source-updated",
    "shared-spec-health",
    "unrelated-acceptance-ignored"
  ]
}, null, 2));
