#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { selectArtifactLineage } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-lineage");
const { buildFreshness, reviewFreshness } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-freshness");
const { buildDashboardIndex } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-data");
const { formalReviewTelemetry } = require("./fixtures/review-v0.5.1-telemetry");

const repo = path.resolve(__dirname, "..");
const historical = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ravo-v0.5.0-lineage-history.json"), "utf8"));

const selectedHistory = selectArtifactLineage(historical);
assert.equal(
  selectedHistory.authoritativeWorkstream.artifactPath,
  "knowledge/.ravo/workstream/2026-07-10T23-13-04-852Z-ravo-v0-5-0-final-implementation.json"
);
assert.equal(selectedHistory.authoritativeWorkstream.selectionReason, "acceptance_explicit_workstream_ref");
assert.ok(selectedHistory.authoritativeWorkstream.supersededArtifacts.includes(
  "knowledge/.ravo/workstream/2026-07-10T22-26-51-213Z-ravo-v0-5-0.json"
));
assert.equal(
  selectedHistory.selectedAcceptance.artifactPath,
  "knowledge/.ravo/acceptance/2026-07-10T23-16-05-042Z-ravo-v0-5-0-required-18-codex-task-subagent-prov.json"
);
assert.equal(selectedHistory.selectedAcceptance.selectionReason, "workstream_artifact_exact");
assert.equal(selectedHistory.releaseReview.artifactPath, "knowledge/.ravo/review/2026-07-10T22-40-10-099Z-release.json");
assert.equal(selectedHistory.releaseReview.selectionReason, "acceptance_explicit_review_ref");
assert.equal(selectedHistory.openAnalysisReviews.length, 1);
assert.equal(selectedHistory.openAnalysisReviews[0].status, "needed");

const live = selectArtifactLineage({
  targetSpecRef: "docs/ravo-v0.5.1-decision-complete-spec-zh.md",
  workstreams: [
    ...historical.workstreams,
    {
      file: "knowledge/.ravo/workstream/v0.5.1-active.json",
      updatedAt: 400,
      artifact: {
        id: "v0.5.1-active",
        status: "active",
        subjectRef: "ravo-v0.5.1-implementation",
        releaseRef: "v0.5.1",
        specRef: "docs/ravo-v0.5.1-decision-complete-spec-zh.md",
        createdAt: "2026-07-12T06:16:47.366Z"
      }
    }
  ],
  acceptances: historical.acceptances,
  reviews: historical.reviews,
  analyses: []
});
assert.equal(live.authoritativeWorkstream.artifactPath, "knowledge/.ravo/workstream/v0.5.1-active.json");
assert.equal(live.authoritativeWorkstream.selectionReason, "target_lineage_latest");
assert.equal(live.selectedAcceptance.artifactPath, "");
assert.equal(live.selectedAcceptance.relationStatus, "matched_no_artifact");

const terminalSupersedesActive = selectArtifactLineage({
  targetReleaseRef: "release-2",
  workstreams: [
    { file: "old.json", updatedAt: 10, artifact: { id: "old", status: "active", releaseRef: "release-2", createdAt: "2026-01-01T00:00:00Z" } },
    { file: "new.json", updatedAt: 20, artifact: { id: "new", status: "ready_for_acceptance", releaseRef: "release-2", createdAt: "2026-01-02T00:00:00Z" } }
  ],
  acceptances: [], reviews: [], analyses: []
});
assert.equal(terminalSupersedesActive.authoritativeWorkstream.artifactPath, "new.json");
assert.deepEqual(terminalSupersedesActive.authoritativeWorkstream.supersededArtifacts, ["old.json"]);

const explicitWorkstreamSupersedes = selectArtifactLineage({
  targetReleaseRef: "release-explicit-supersedes",
  workstreams: [
    { file: "old-explicit.json", updatedAt: 10, artifact: { id: "old-explicit", status: "ready_for_acceptance", releaseRef: "release-explicit-supersedes" } },
    { file: "new-explicit.json", updatedAt: 20, artifact: { id: "new-explicit", status: "blocked", releaseRef: "release-explicit-supersedes", supersedes: ["old-explicit.json"] } }
  ],
  acceptances: [
    { file: "old-acceptance.json", updatedAt: 15, artifact: { id: "old-acceptance", status: "pending_acceptance", acceptanceScope: "release", releaseRef: "release-explicit-supersedes", workstreamArtifact: "old-explicit.json" } },
    { file: "new-acceptance.json", updatedAt: 25, artifact: { id: "new-acceptance", status: "code_complete", acceptanceScope: "release", releaseRef: "release-explicit-supersedes", workstreamArtifact: "new-explicit.json" } }
  ],
  reviews: [],
  analyses: []
});
assert.equal(explicitWorkstreamSupersedes.authoritativeWorkstream.artifactPath, "new-explicit.json");
assert.equal(explicitWorkstreamSupersedes.authoritativeWorkstream.selectionReason, "acceptance_explicit_workstream_ref");
assert.equal(explicitWorkstreamSupersedes.selectedAcceptance.artifactPath, "new-acceptance.json");

const brokenExplicitRef = selectArtifactLineage({
  targetSpecRef: "docs/spec.md",
  workstreams: [
    { file: "unrelated.json", updatedAt: 10, artifact: { id: "unrelated", status: "active", specRef: "docs/other.md" } }
  ],
  acceptances: [
    { file: "acceptance.json", updatedAt: 20, artifact: { id: "acceptance", status: "pending_acceptance", specRef: "docs/spec.md", workstreamArtifact: "missing.json" } }
  ],
  reviews: [], analyses: []
});
assert.equal(brokenExplicitRef.authoritativeWorkstream.artifactPath, "");
assert.equal(brokenExplicitRef.authoritativeWorkstream.relationStatus, "unmatched");
assert.equal(brokenExplicitRef.selectedAcceptance.artifactPath, "");

const ambiguous = selectArtifactLineage({
  targetSpecRef: "docs/spec.md",
  workstreams: [
    { file: "one.json", updatedAt: 10, artifact: { id: "one", status: "active", specRef: "docs/spec.md", releaseRef: "release-one" } },
    { file: "two.json", updatedAt: 11, artifact: { id: "two", status: "active", specRef: "docs/spec.md", releaseRef: "release-two" } }
  ],
  acceptances: [
    { file: "a.json", updatedAt: 20, artifact: { id: "a", status: "pending_acceptance", specRef: "docs/spec.md", workstreamArtifact: "one.json" } },
    { file: "b.json", updatedAt: 21, artifact: { id: "b", status: "pending_acceptance", specRef: "docs/spec.md", workstreamArtifact: "two.json" } }
  ],
  reviews: [], analyses: []
});
assert.equal(ambiguous.authoritativeWorkstream.artifactPath, "");
assert.equal(ambiguous.authoritativeWorkstream.relationStatus, "ambiguous");
assert.equal(ambiguous.selectedAcceptance.relationStatus, "ambiguous");

const milestoneIgnored = selectArtifactLineage({
  targetReleaseRef: "release-3",
  workstreams: [
    { file: "release.json", updatedAt: 10, artifact: { id: "release", status: "ready_for_acceptance", releaseRef: "release-3" } }
  ],
  acceptances: [
    { file: "milestone.json", updatedAt: 30, artifact: { id: "milestone", status: "pending_acceptance", acceptanceScope: "milestone", milestoneRef: "M1", releaseRef: "release-3", workstreamArtifact: "release.json" } },
    { file: "release-acceptance.json", updatedAt: 20, artifact: { id: "release-acceptance", status: "pending_acceptance", acceptanceScope: "release", releaseRef: "release-3", workstreamArtifact: "release.json" } }
  ],
  reviews: [], analyses: []
});
assert.equal(milestoneIgnored.selectedAcceptance.artifactPath, "release-acceptance.json");

function reviewEligibilityLineage(review) {
  return selectArtifactLineage({
    targetReleaseRef: "release-review-eligibility",
    workstreams: [{ file: "workstream.json", updatedAt: 10, artifact: { id: "workstream", status: "ready_for_acceptance", releaseRef: "release-review-eligibility" } }],
    acceptances: [{ file: "acceptance.json", updatedAt: 20, artifact: { id: "acceptance", status: "pending_acceptance", releaseRef: "release-review-eligibility", workstreamArtifact: "workstream.json", reviewArtifact: "review.json" } }],
    reviews: [{ file: "review.json", updatedAt: 30, artifact: review }],
    analyses: []
  }).releaseReview.status;
}

const usableReview = {
  subjectRef: "release-review-eligibility",
  workflowCoverage: "full",
  coverage: "full",
  parserStatus: "pass",
  validResults: true,
  modelsUsable: ["provider/model"]
};
assert.equal(reviewEligibilityLineage({ ...usableReview, ...formalReviewTelemetry() }), "current");
assert.equal(reviewEligibilityLineage({ ...usableReview, ...formalReviewTelemetry(), runClass: "diagnostic", formalEvidenceEligible: true }), "unavailable");
assert.equal(reviewEligibilityLineage({ ...usableReview, ...formalReviewTelemetry(), formalEvidenceEligible: false }), "unavailable");
assert.equal(reviewEligibilityLineage({ ...usableReview, schemaVersion: "0.5.1", runClass: "formal", formalEvidenceEligible: true }), "unavailable");
assert.equal(reviewEligibilityLineage({ ...usableReview, schemaVersion: "0.5.0" }), "unavailable");
assert.equal(reviewEligibilityLineage({ ...usableReview, schemaVersion: "0.5.0", runClass: "diagnostic" }), "unavailable");
assert.equal(reviewEligibilityLineage({ ...usableReview, schemaVersion: "0.5.0", formalEvidenceEligible: false }), "unavailable");

const reviewWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-review-freshness-")));
const analysisDir = path.join(reviewWorkspace, "knowledge", ".ravo", "analysis");
const reviewDir = path.join(reviewWorkspace, "knowledge", ".ravo", "review");
fs.mkdirSync(analysisDir, { recursive: true });
fs.mkdirSync(reviewDir, { recursive: true });
fs.writeFileSync(path.join(analysisDir, "analysis.json"), JSON.stringify({ status: "complete", impactLevel: "high", subjectRef: "analysis-subject" }));
const freshnessReviewPath = path.join(reviewDir, "review.json");
fs.writeFileSync(freshnessReviewPath, JSON.stringify({ ...usableReview, ...formalReviewTelemetry(), subjectRef: "analysis-subject", runClass: "diagnostic", formalEvidenceEligible: true }));
assert.equal(reviewFreshness(reviewWorkspace, { runtimeHealth: "healthy" }).status, "unavailable");
fs.writeFileSync(freshnessReviewPath, JSON.stringify({ ...usableReview, ...formalReviewTelemetry(), subjectRef: "analysis-subject" }));
assert.equal(reviewFreshness(reviewWorkspace, { runtimeHealth: "healthy" }).status, "current");

const liveWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-lineage-live-")));
const liveSpecRef = "docs/ravo-v0.5.1-decision-complete-spec-zh.md";
const liveWorkstreamRef = "knowledge/.ravo/workstream/ravo-v0-5-1-implementation-and-acceptance.json";
const liveAcceptanceRef = "knowledge/.ravo/acceptance/ravo-v0-5-1-acceptance.json";
fs.mkdirSync(path.join(liveWorkspaceRoot, "docs"), { recursive: true });
fs.mkdirSync(path.join(liveWorkspaceRoot, "knowledge", ".ravo", "workstream"), { recursive: true });
fs.mkdirSync(path.join(liveWorkspaceRoot, "knowledge", ".ravo", "acceptance"), { recursive: true });
fs.writeFileSync(path.join(liveWorkspaceRoot, "knowledge", ".ravo", "manifest.json"), JSON.stringify({
  schemaVersion: "0.5.1",
  modules: {}
}));
fs.writeFileSync(path.join(liveWorkspaceRoot, liveSpecRef), "# Fixture Spec\n\n状态：decision-complete\n");
fs.writeFileSync(path.join(liveWorkspaceRoot, liveWorkstreamRef), JSON.stringify({
  id: "ravo-v0-5-1-implementation-and-acceptance",
  status: "ready_for_acceptance",
  subjectRef: "ravo-v0.5.1-implementation",
  releaseRef: "v0.5.1",
  specRef: liveSpecRef,
  createdAt: "2026-07-12T00:00:00.000Z"
}));
fs.writeFileSync(path.join(liveWorkspaceRoot, liveAcceptanceRef), JSON.stringify({
  id: "ravo-v0-5-1-acceptance",
  status: "pending_acceptance",
  acceptanceScope: "release",
  subjectRef: "ravo-v0.5.1-implementation",
  releaseRef: "v0.5.1",
  specRef: liveSpecRef,
  workstreamArtifact: liveWorkstreamRef,
  createdAt: "2026-07-12T00:01:00.000Z"
}));
const liveFreshness = buildFreshness(liveWorkspaceRoot, {
  spec: liveSpecRef,
  runtimeStatus: { runtimeHealth: "healthy", fingerprint: "fixture", runtimeProbeStatus: "not_applicable" },
  checkSpecHealth: () => ({ status: "current", specPath: path.join(liveWorkspaceRoot, liveSpecRef) })
});
const liveIndex = buildDashboardIndex({
  workspaceRoots: [liveWorkspaceRoot],
  cwd: liveWorkspaceRoot,
  freshnessByWorkspace: new Map([[liveWorkspaceRoot, liveFreshness]]),
  runtimeStatusByWorkspace: new Map([[liveWorkspaceRoot, liveFreshness.runtime]])
});
const liveWorkspace = liveIndex.workspaces[0];
assert.match(liveFreshness.authoritativeWorkstream.artifactPath, /ravo-v0-5-1-implementation-and-acceptance(?:-closeo)?\.json$/);
assert.equal(liveFreshness.authoritativeWorkstream.selectionReason, "acceptance_explicit_workstream_ref");
assert.equal(liveFreshness.authoritativeWorkstream.relationStatus, "matched");
assert.equal(liveWorkspace.authoritativeWorkstream.relativePath, liveFreshness.authoritativeWorkstream.artifactPath);
assert.ok(["in_progress", "code_complete", "pending_acceptance", "accepted", "blocked"].includes(liveWorkspace.deliveryStatus));
if (!liveFreshness.selectedAcceptance.artifactPath) assert.equal(liveWorkspace.deliveryStatus, "in_progress");
const parkedExternalAttention = liveWorkspace.attentionItems.find((item) => item.title === "Verify real cross-Provider Review compatibility");
const liveCrossProviderBlocker = liveWorkspace.blockers.find((item) => item.title === "Verify real cross-Provider Review compatibility");
if (parkedExternalAttention && liveCrossProviderBlocker) {
  assert.equal(
    parkedExternalAttention.blocking,
    !liveCrossProviderBlocker.continuationAllowed,
    "external blocker attention must reflect the structured continuation decision"
  );
}

console.log(JSON.stringify({
  status: "pass",
  fixture: path.relative(repo, path.join(__dirname, "fixtures", "ravo-v0.5.0-lineage-history.json")),
  live: {
    deliveryStatus: liveWorkspace.deliveryStatus,
    authoritativeWorkstream: liveFreshness.authoritativeWorkstream,
    selectedAcceptance: liveFreshness.selectedAcceptance,
    releaseReview: liveFreshness.releaseReview,
    openAnalysisReviewCount: liveFreshness.openAnalysisReviews.length
  },
  checks: [
    "historical-explicit-binding",
    "live-target-spec",
    "terminal-supersedes-active",
    "broken-explicit-ref",
    "ambiguous-current-acceptances",
    "milestone-acceptance-isolated",
    "release-review-open-analysis-split",
    "review-formal-evidence-eligibility",
    "diagnostic-review-freshness-downgrade",
    "legacy-review-not-current-formal-evidence"
  ]
}, null, 2));
