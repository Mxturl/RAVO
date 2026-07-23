#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildDashboardIndex,
  discoverWorkspaces,
  indexArtifacts,
  indexSessions,
  deriveWorkspaceState,
  buildAttentionQueue,
  buildMetrics,
  readPoolSummary,
  blocksIndependentDelivery,
  isAllowedExternalAcceptanceBlocker
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-data");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-dashboard-data-"));
const NOW = "2026-07-11T08:00:00.000Z";
const HEALTHY_RUNTIME = {
  runtimeHealth: "healthy",
  marketplaceStatus: "present",
  pluginStatus: "healthy",
  versionStatus: "current",
  hookTrustEvidence: "verified",
  runtimeProbeStatus: "pass",
  manifestStatus: "healthy",
  configStatus: "healthy",
  fingerprint: "sha256:test-runtime",
  checkedAt: NOW
};

assert.equal(blocksIndependentDelivery({ required: true, executionStatus: "blocked_external", continuationAllowed: true }), false);
assert.equal(blocksIndependentDelivery({ required: true, executionStatus: "blocked_terminal", continuationAllowed: false }), true);
assert.equal(isAllowedExternalAcceptanceBlocker({
  verificationStatus: "blocked",
  blockerExecutionStatus: "blocked_external",
  verificationOwner: "external",
  externalBlockerDecision: "pending_pm",
  externalBlockerSpecRef: "docs/spec.md",
  externalBlockerSpecAnchor: "If unavailable:",
  blockerImpact: "Compatibility is unverified.",
  temporaryFallback: "Use the verified local path.",
  recoveryEntry: "Configure the external dependency and rerun."
}), true);

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, value) {
  mkdir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeWorkspace(parent, name, options = {}) {
  const workspace = mkdir(path.join(parent, name));
  if (options.git !== false) mkdir(path.join(workspace, ".git"));
  if (options.manifest !== false) {
    writeJson(path.join(workspace, "knowledge", ".ravo", "manifest.json"), {
      schemaVersion: "0.5.0",
      workspace: ".",
      modules: options.modules || {}
    });
  }
  return fs.realpathSync(workspace);
}

function writeArtifact(workspace, moduleId, id, value = {}, extension = "json") {
  const file = path.join(workspace, "knowledge", ".ravo", moduleId, `${id}.${extension}`);
  mkdir(path.dirname(file));
  if (extension === "json") writeJson(file, {
    schemaVersion: "0.5.0",
    id,
    status: "complete",
    createdAt: NOW,
    ...value
  });
  else fs.writeFileSync(file, `# ${value.title || id}\n\nbody that must not be indexed as metadata\n`);
  return file;
}

function rewriteManifest(workspace, modules) {
  writeJson(path.join(workspace, "knowledge", ".ravo", "manifest.json"), {
    schemaVersion: "0.5.0",
    workspace: ".",
    modules
  });
}

try {
  const emptyRoot = mkdir(path.join(temp, "empty-roots"));
  const cwdWorkspace = makeWorkspace(emptyRoot, "cwd");
  makeWorkspace(cwdWorkspace, "must-not-be-scanned");
  const emptyDiscovery = discoverWorkspaces({ workspaceRoots: [], cwd: cwdWorkspace });
  assert.deepEqual(emptyDiscovery.workspaces.map((item) => item.canonicalPath), [cwdWorkspace], "empty roots index only startup cwd");

  const root = mkdir(path.join(temp, "roots", "root"));
  mkdir(path.join(root, ".git"));
  const directA = makeWorkspace(root, "a");
  const directB = makeWorkspace(root, "b", { manifest: false });
  makeWorkspace(directA, "nested");
  const explicit = mkdir(path.join(root, "explicit"));
  const outside = makeWorkspace(path.join(temp, "outside"), "escape-target");
  fs.symlinkSync(outside, path.join(root, "escape"), "dir");
  const directDiscovery = discoverWorkspaces({
    workspaceRoots: [root, fs.realpathSync(root)],
    workspaceOverrides: {
      [fs.realpathSync(explicit)]: { displayName: "Explicit", priority: "high", lifecycle: "paused" }
    }
  });
  assert.deepEqual(directDiscovery.workspaces.map((item) => item.canonicalPath).sort(), [fs.realpathSync(root), directA, directB, fs.realpathSync(explicit)].sort());
  assert.ok(!directDiscovery.workspaces.some((item) => item.canonicalPath.endsWith("nested")), "discovery is not recursive");
  assert.ok(!directDiscovery.workspaces.some((item) => item.canonicalPath === outside), "symlink escape is rejected");
  assert.ok(directDiscovery.warnings.some((item) => item.code === "workspace_symlink_escape"));
  const explicitRecord = directDiscovery.workspaces.find((item) => item.canonicalPath === fs.realpathSync(explicit));
  assert.equal(explicitRecord.displayName, "Explicit");
  assert.equal(explicitRecord.priority, "high");
  assert.equal(explicitRecord.lifecycle, "paused");
  assert.equal(discoverWorkspaces({ workspaceRoots: [root] }).workspaces.find((item) => item.canonicalPath === directA).workspaceId,
    discoverWorkspaces({ workspaceRoots: [root] }).workspaces.find((item) => item.canonicalPath === directA).workspaceId, "workspace id is stable");

  const poolWorkspace = makeWorkspace(path.join(temp, "pool"), "workspace");
  writeJson(path.join(poolWorkspace, "knowledge", ".ravo", "pool", "index.json"), {
    generatedAt: NOW,
    entries: [
      { id: "WI-triage", confirmationStatus: "needs_triage", decisionStatus: "needs_triage" },
      { id: "WI-candidate", confirmationStatus: "confirmed", decisionStatus: "candidate" }
    ]
  });
  rewriteManifest(poolWorkspace, { pool: { enabled: true, latestArtifact: "knowledge/.ravo/pool/index.json" } });
  assert.deepEqual(readPoolSummary(poolWorkspace).requirements, { count: 2, needsTriage: 1, generatedAt: NOW });
  const poolDashboard = buildDashboardIndex({ workspaceRoots: [poolWorkspace], cwd: poolWorkspace, runtimeStatus: HEALTHY_RUNTIME, now: NOW });
  const poolDashboardWorkspace = poolDashboard.workspaces.find((item) => item.canonicalPath === poolWorkspace);
  assert.ok(poolDashboardWorkspace.attentionItems.some((item) => item.category === "pool_triage" && item.blocking === false));

  const noManifest = makeWorkspace(path.join(temp, "artifacts"), "no-manifest", { manifest: false });
  writeArtifact(noManifest, "analysis", "ignored-without-manifest", { type: "requirement" });
  const noManifestIndex = indexArtifacts(noManifest);
  assert.equal(noManifestIndex.dataStatus, "no_ravo_data");
  assert.equal(noManifestIndex.artifacts.length, 0, "manifest missing does not guess from ordinary files");

  const corruptManifest = makeWorkspace(path.join(temp, "artifacts"), "corrupt-manifest");
  fs.writeFileSync(path.join(corruptManifest, "knowledge", ".ravo", "manifest.json"), "{broken");
  writeArtifact(corruptManifest, "analysis", "valid-analysis", { type: "requirement", status: "draft" });
  fs.writeFileSync(path.join(corruptManifest, "knowledge", ".ravo", "analysis", "broken.json"), "not-json");
  const corruptIndex = indexArtifacts(corruptManifest);
  assert.equal(corruptIndex.dataStatus, "partial");
  assert.equal(corruptIndex.artifacts.length, 1, "one bad artifact does not hide valid artifacts");
  assert.ok(corruptIndex.warnings.some((item) => item.code === "artifact_invalid"));

  const markdownWorkspace = makeWorkspace(path.join(temp, "artifacts"), "markdown");
  writeArtifact(markdownWorkspace, "acceptance", "accepted", { status: "accepted", summary: "Manifest-selected acceptance" });
  writeArtifact(markdownWorkspace, "acceptance", "pm-checklist", { title: "PM Checklist" }, "md");
  rewriteManifest(markdownWorkspace, { acceptance: { latestArtifact: "knowledge/.ravo/acceptance/accepted.json" } });
  const markdownIndex = indexArtifacts(markdownWorkspace);
  const markdownArtifact = markdownIndex.artifacts.find((item) => item.format === "markdown");
  assert.equal(markdownArtifact.title, "PM Checklist");
  assert.equal(markdownIndex.latestArtifacts.acceptance.id, "accepted", "manifest latest wins over a newer sibling document");
  assert.ok(!JSON.stringify(markdownIndex).includes("body that must not be indexed"));

  const capped = makeWorkspace(path.join(temp, "artifacts"), "capped");
  for (let index = 0; index < 505; index += 1) {
    writeArtifact(capped, "analysis", `a-${String(index).padStart(3, "0")}`, {
      type: "requirement",
      createdAt: new Date(Date.parse(NOW) - index * 1000).toISOString()
    });
  }
  rewriteManifest(capped, { analysis: { latestArtifact: "knowledge/.ravo/analysis/a-000.json" } });
  const cappedIndex = indexArtifacts(capped, { artifactLimitPerWorkspace: 500 });
  assert.equal(cappedIndex.artifacts.length, 500);
  assert.equal(cappedIndex.artifacts[0].id, "a-000");

  const sessionWorkspacePath = makeWorkspace(path.join(temp, "sessions"), "workspace");
  const fakeHome = mkdir(path.join(temp, "home"));
  const codexDir = mkdir(path.join(fakeHome, ".codex"));
  const sessionId = "019f-test-session";
  fs.writeFileSync(path.join(codexDir, "session_index.jsonl"), [
    "{bad-json",
    JSON.stringify({ id: sessionId, thread_name: "Metadata title", updated_at: NOW, preview: "SECRET preview must stay hidden" })
  ].join("\n"));
  const rollout = path.join(codexDir, "sessions", "2026", "07", "11", `rollout-${sessionId}.jsonl`);
  mkdir(path.dirname(rollout));
  fs.writeFileSync(rollout, [
    JSON.stringify({ type: "session_meta", timestamp: NOW, payload: { id: sessionId, cwd: sessionWorkspacePath, timestamp: NOW } }),
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "SECRET PROMPT MUST NOT APPEAR" } })
  ].join("\n"));
  const sessionResult = indexSessions([{ workspaceId: "ws-test", canonicalPath: sessionWorkspacePath }], { home: fakeHome, showPromptSnippets: false });
  assert.equal(sessionResult.sessionDataStatus, "partial");
  assert.equal(sessionResult.sessions.length, 1);
  assert.deepEqual(Object.keys(sessionResult.sessions[0]).sort(), ["createdAt", "cwd", "id", "summary", "title", "updatedAt"].sort());
  assert.equal(sessionResult.sessions[0].title, "Metadata title");
  assert.ok(!JSON.stringify(sessionResult.sessions).includes("SECRET PROMPT"));
  assert.ok(!JSON.stringify(sessionResult.sessions).includes("SECRET preview"));
  const sessionWithPreview = indexSessions([{ workspaceId: "ws-test", canonicalPath: sessionWorkspacePath }], { home: fakeHome, showPromptSnippets: true });
  assert.equal(sessionWithPreview.sessions[0].summary, "SECRET preview must stay hidden");

  const lifecycleRoot = mkdir(path.join(temp, "lifecycle"));
  const activePath = makeWorkspace(lifecycleRoot, "active");
  const pausedPath = makeWorkspace(lifecycleRoot, "paused");
  const archivedPath = makeWorkspace(lifecycleRoot, "archived");
  const old = "2026-06-01T00:00:00.000Z";
  for (const workspace of [activePath, pausedPath, archivedPath]) {
    writeArtifact(workspace, "workstream", "work", { status: "active", currentMilestone: "M4", nextStep: "Continue", updatedAt: old, createdAt: old });
    rewriteManifest(workspace, { workstream: { latestArtifact: "knowledge/.ravo/workstream/work.json" } });
  }
  writeArtifact(activePath, "workstream", "selected-work", {
    status: "active", subjectRef: "current-release", releaseRef: "current-release", specRef: "docs/spec.md", currentMilestone: "M4", nextStep: "Continue selected lineage", updatedAt: old, createdAt: old,
    executionLanes: { development: { milestoneRef: "M4", status: "active" }, acceptance: { milestoneRef: "M3", baselineRef: "git-tree:fixture", status: "in_progress" }, recovery: { status: "inactive", workers: [] } },
    blockerLedger: [], executionDecisions: [], authorizationEnvelopes: [],
    effectiveDeliveryProfile: { profile: "rapid", profileSource: "workspace", deadlineAt: "2026-07-12T04:00:00.000Z", budgets: { reviewRunBudget: 0 } },
    timing: { startedAt: "2026-07-12T00:00:00.000Z", candidateReadyAt: null, calendarMinutes: 18, agentActiveMinutes: null, governanceMinutes: null, reviewMinutes: null, externalWaitMinutes: null, pmTouchMinutes: null, measurementSource: "runtime" },
    capabilityRoutes: [{ taskClass: "routine_test", tier: "economy", enforcement: "advisory_only" }]
  });
  writeArtifact(activePath, "analysis", "analysis-draft", { type: "requirement", status: "draft", openQuestions: ["Who validates this?"] });
  writeArtifact(activePath, "quick-validation", "quick-fail", { status: "fail", checks: ["dashboard data"] });
  writeArtifact(activePath, "acceptance", "unrelated-acceptance", { status: "pending_acceptance", subjectRef: "another-task", acceptanceItems: [] });
  rewriteManifest(activePath, {
    analysis: { latestArtifact: "knowledge/.ravo/analysis/analysis-draft.json" },
    workstream: { latestArtifact: "knowledge/.ravo/workstream/work.json" },
    "quick-validation": { latestArtifact: "knowledge/.ravo/quick-validation/quick-fail.json" },
    acceptance: { latestArtifact: "knowledge/.ravo/acceptance/unrelated-acceptance.json" }
  });
  const lifecycleOverrides = {
    [activePath]: { priority: "low", lifecycle: "active" },
    [pausedPath]: { priority: "high", lifecycle: "paused" },
    [archivedPath]: { priority: "high", lifecycle: "archived" }
  };
  const lifecycleIndex = buildDashboardIndex({
    workspaceRoots: [lifecycleRoot],
    workspaceOverrides: lifecycleOverrides,
    runtimeStatusByWorkspace: new Map([activePath, pausedPath, archivedPath].map((workspace) => [workspace, HEALTHY_RUNTIME])),
    freshnessByWorkspace: {
      [activePath]: {
        specHealth: { status: "current", specPath: "docs/spec.md", checkedAt: NOW },
        authoritativeWorkstream: { artifactPath: "knowledge/.ravo/workstream/selected-work.json", selectionReason: "target_lineage_latest", relationStatus: "matched", lineageKey: "release:current-release", supersededArtifacts: ["knowledge/.ravo/workstream/work.json"] },
        acceptanceFreshness: { status: "unknown", freshness: "unknown", relationStatus: "unmatched", activeWorkstream: "knowledge/.ravo/workstream/selected-work.json" },
        releaseReview: { status: "not_applicable", relationStatus: "unmatched", selectionReason: "no_release_review", artifactPath: "", freshness: "unknown" },
        openAnalysisReviews: [{ analysisArtifact: "knowledge/.ravo/analysis/high-impact.json", reviewArtifact: "", status: "needed", relationStatus: "unmatched" }]
      },
      ...Object.fromEntries([pausedPath, archivedPath].map((workspace) => [workspace, {
        specHealth: { status: "current", specPath: "docs/spec.md", checkedAt: NOW },
        acceptanceFreshness: { status: "no_data", freshness: "unknown" },
        reviewFreshness: { status: "not_applicable", freshness: "current" }
      }]))
    },
    home: mkdir(path.join(temp, "empty-session-home")),
    now: NOW
  });
  const activeWorkspace = lifecycleIndex.workspaces.find((item) => item.canonicalPath === activePath);
  const pausedWorkspace = lifecycleIndex.workspaces.find((item) => item.canonicalPath === pausedPath);
  const archivedWorkspace = lifecycleIndex.workspaces.find((item) => item.canonicalPath === archivedPath);
  assert.ok(activeWorkspace.attentionItems.some((item) => item.category === "stale_workstream"));
  assert.ok(activeWorkspace.attentionItems.some((item) => item.category === "analysis"));
  assert.ok(activeWorkspace.attentionItems.some((item) => item.category === "quick_validation"));
  assert.equal(activeWorkspace.summary.headline, "自动验证发现需要修复的问题");
  assert.equal(activeWorkspace.pmBrief.productState, "blocked");
  assert.equal(activeWorkspace.pmBrief.actionRequired, "none", "Codex-owned verification failures are not delegated to the PM");
  assert.equal(activeWorkspace.activityStatus, "active");
  assert.equal(activeWorkspace.deliveryStatus, "in_progress");
  assert.equal(activeWorkspace.authoritativeWorkstream.id, "selected-work", "derived state consumes the shared authoritative workstream instead of manifest latest");
  assert.equal(activeWorkspace.authoritativeWorkstream.selectionReason, "target_lineage_latest");
  assert.equal(activeWorkspace.executionLanes.acceptance.milestoneRef, "M3", "execution lanes survive Dashboard derivation");
  assert.equal(activeWorkspace.effectiveDeliveryProfile.profile, "rapid", "effective delivery profile survives Dashboard derivation");
  assert.equal(activeWorkspace.executionTiming.calendarMinutes, 18, "timing survives Dashboard derivation");
  assert.equal(activeWorkspace.capabilityRoutes[0].enforcement, "advisory_only", "route enforcement survives Dashboard derivation");
  assert.ok(activeWorkspace.openAnalysisReviews.some((item) => item.status === "needed"), "open analysis Review remains separate from release Review");
  assert.ok(activeWorkspace.attentionItems.some((item) => item.category === "acceptance_unmatched"), "unrelated acceptance cannot be borrowed by the active workstream");
  assert.equal(archivedWorkspace.activityStatus, "dormant");
  assert.ok(["current", "stale", "unknown"].includes(activeWorkspace.freshness));
  assert.ok(["high", "medium", "low"].includes(activeWorkspace.confidence));
  assert.ok(Array.isArray(activeWorkspace.sourceRefs));
  assert.ok(!pausedWorkspace.attentionItems.some((item) => item.category === "stale_workstream"));
  assert.equal(archivedWorkspace.attentionItems.length, 0);
  assert.equal(lifecycleIndex.metrics.activeWorkspaces.value, 1, "paused and archived do not enter active metrics");
  assert.equal(lifecycleIndex.workspaces[0].canonicalPath, activePath, "stable workspace sorting puts active before paused/archived");
  assert.ok(activeWorkspace.lanes.Reason.sourceRefs.length > 0);
  assert.ok(activeWorkspace.lanes.Reason.derivedAt);
  assert.ok(activeWorkspace.suggestions.every((item) => item.sourceRefs && item.freshness && item.confidence && item.derivedAt));
  assert.ok(!/healthScore|overallScore|efficiencyScore/.test(JSON.stringify(lifecycleIndex)), "no aggregate health score is generated");

  const unknownRuntime = deriveWorkspaceState({ ...activeWorkspace, attentionItems: [] }, { now: NOW });
  assert.equal(unknownRuntime.lanes.Runtime.status, "unknown");
  assert.equal(unknownRuntime.lanes.Runtime.confidence, "low");
  const coreVerifiedRuntime = deriveWorkspaceState({ ...activeWorkspace, attentionItems: [] }, {
    runtimeStatus: {
      ...HEALTHY_RUNTIME,
      runtimeHealth: "core_verified",
      runtimeProbeStatus: "partial",
      coreRuntimeStatus: "verified",
      terminalTelemetryStatus: "unknown",
      terminalTelemetry: { event: "Stop", status: "unknown", summary: "Stop was not observed.", evidenceRef: "" }
    },
    now: NOW
  });
  assert.equal(coreVerifiedRuntime.lanes.Runtime.status, "clear");
  assert.equal(coreVerifiedRuntime.lanes.Runtime.confidence, "medium");
  assert.match(coreVerifiedRuntime.lanes.Runtime.summary, /本机核心能力已验证/);
  assert.ok(!coreVerifiedRuntime.attentionItems.some((item) => item.category === "runtime"), "unknown terminal telemetry does not create a Runtime repair task");
  const terminalFailedRuntime = deriveWorkspaceState({ ...activeWorkspace, attentionItems: [] }, {
    runtimeStatus: {
      ...HEALTHY_RUNTIME,
      runtimeHealth: "core_verified",
      runtimeProbeStatus: "partial",
      coreRuntimeStatus: "verified",
      terminalTelemetryStatus: "failed",
      terminalTelemetry: { event: "Stop", status: "failed", summary: "Stop failed.", evidenceRef: "knowledge/.ravo/telemetry/stop.json" }
    },
    now: NOW
  });
  const terminalAttention = terminalFailedRuntime.attentionItems.find((item) => item.category === "runtime_terminal");
  assert.ok(terminalAttention, "failed terminal telemetry remains visible as a diagnostic");
  assert.equal(terminalAttention.blocking, false);
  const staleActive = deriveWorkspaceState({ ...archivedWorkspace, lifecycle: "active", attentionItems: [] }, {
    runtimeStatus: HEALTHY_RUNTIME,
    freshness: { specHealth: { status: "current", specPath: "docs/spec.md", checkedAt: NOW } },
    now: NOW
  });
  assert.equal(staleActive.activityStatus, "stale");

  const activeLowDegraded = deriveWorkspaceState({ ...activeWorkspace, priority: "low", attentionItems: [] }, { runtimeStatus: { ...HEALTHY_RUNTIME, runtimeHealth: "degraded" }, now: NOW });
  const pausedDegraded = deriveWorkspaceState({ ...pausedWorkspace, priority: "high", lifecycle: "active", attentionItems: [] }, { runtimeStatus: { ...HEALTHY_RUNTIME, runtimeHealth: "degraded" }, now: NOW });
  assert.ok(pausedDegraded.attentionItems.some((item) => item.category === "runtime"));
  const sortedAttention = buildAttentionQueue([activeLowDegraded, pausedDegraded]);
  assert.equal(sortedAttention[0].workspaceId, pausedDegraded.workspaceId, "attention sorting uses severity then priority deterministically");
  const lifecycleMetrics = buildMetrics([
    activeWorkspace,
    pausedWorkspace
  ], [
    { id: "active-session", cwd: activePath, createdAt: NOW, updatedAt: NOW, title: "", summary: "" },
    { id: "paused-session", cwd: pausedPath, createdAt: NOW, updatedAt: NOW, title: "", summary: "" }
  ], activeWorkspace.attentionItems, { now: NOW });
  assert.ok(lifecycleMetrics.laneAttention.Act);
  assert.equal(lifecycleMetrics.sessionsLast7Days.value, 1, "paused workspace Sessions are excluded from active metrics");

  const externalPendingPath = makeWorkspace(path.join(temp, "external-pending"), "workspace");
  writeArtifact(externalPendingPath, "workstream", "release-workstream", {
    status: "ready_for_acceptance",
    subjectRef: "release-external-pending",
    releaseRef: "release-external-pending",
    specRef: "docs/spec.md",
    blockerLedger: [{
      id: "provider-blocker",
      title: "Second Provider",
      required: true,
      executionStatus: "blocked_external",
      continuationAllowed: true,
      recoveryEntry: "Configure the Provider."
    }]
  });
  writeArtifact(externalPendingPath, "acceptance", "release-acceptance", {
    status: "pending_acceptance",
    subjectRef: "release-external-pending",
    releaseRef: "release-external-pending",
    specRef: "docs/spec.md",
    workstreamArtifact: "knowledge/.ravo/workstream/release-workstream.json",
    acceptanceItems: [{
      id: "cross-provider",
      required: true,
      fulfillmentStatus: "met",
      verificationStatus: "blocked",
      verificationOwner: "external",
      blockerExecutionStatus: "blocked_external",
      externalBlockerDecision: "pending_pm",
      externalBlockerSpecRef: "docs/spec.md",
      externalBlockerSpecAnchor: "If unavailable:",
      blockerImpact: "Compatibility remains unverified.",
      temporaryFallback: "Use the verified Provider.",
      recoveryEntry: "Configure the second Provider."
    }]
  });
  rewriteManifest(externalPendingPath, {
    workstream: { latestArtifact: "knowledge/.ravo/workstream/release-workstream.json" },
    acceptance: { latestArtifact: "knowledge/.ravo/acceptance/release-acceptance.json" }
  });
  const externalPending = buildDashboardIndex({ workspaceRoots: [externalPendingPath], runtimeStatus: HEALTHY_RUNTIME, home: mkdir(path.join(temp, "external-pending-home")), now: NOW }).workspaces[0];
  assert.equal(externalPending.deliveryStatus, "pending_acceptance", "Spec-allowed external evidence blockers retain pending_acceptance");
  assert.equal(externalPending.lanes.Verify.status, "attention");
  assert.ok(!externalPending.attentionItems.some((item) => item.category === "acceptance_blocked"));
  assert.ok(externalPending.attentionItems.some((item) => item.category === "pending_pm"));

  const overlapRoot = makeWorkspace(path.join(temp, "overlap"), "parent");
  const overlapChild = makeWorkspace(overlapRoot, "child");
  const overlapHome = mkdir(path.join(temp, "overlap-home"));
  const overlapCodex = mkdir(path.join(overlapHome, ".codex"));
  const overlapSessionId = "overlap-session";
  fs.writeFileSync(path.join(overlapCodex, "session_index.jsonl"), `${JSON.stringify({ id: overlapSessionId, cwd: overlapChild, updated_at: NOW })}\n`);
  const overlapIndex = buildDashboardIndex({ workspaceRoots: [overlapRoot], home: overlapHome, runtimeStatus: HEALTHY_RUNTIME, now: NOW });
  assert.equal(overlapIndex.workspaceById[overlapIndex.workspaces.find((item) => item.canonicalPath === overlapRoot).workspaceId].sessions.length, 0);
  assert.equal(overlapIndex.workspaces.find((item) => item.canonicalPath === overlapChild).sessions.length, 1, "Session belongs only to the longest matching workspace");

  const performanceRoot = mkdir(path.join(temp, "performance"));
  for (let index = 0; index < 50; index += 1) makeWorkspace(performanceRoot, `workspace-${String(index).padStart(2, "0")}`);
  const started = process.hrtime.bigint();
  const performanceIndex = buildDashboardIndex({
    workspaceRoots: [performanceRoot],
    runtimeStatus: HEALTHY_RUNTIME,
    home: mkdir(path.join(temp, "performance-home")),
    now: NOW
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(performanceIndex.workspaces.length, 50);
  assert.ok(elapsedMs < 3000, `50 workspace baseline must stay under 3s, got ${elapsedMs.toFixed(1)}ms`);
  assert.equal(Object.keys(performanceIndex.workspaceById).length, 50);
  assert.ok(Array.isArray(performanceIndex.attention));
  assert.ok(performanceIndex.metrics);
  assert.ok(Array.isArray(performanceIndex.sessions));
  assert.ok(["complete", "partial", "error"].includes(performanceIndex.sessionDataStatus));
  assert.ok(Array.isArray(performanceIndex.warnings));
  assert.ok(performanceIndex.generatedAt);

  console.log(JSON.stringify({
    status: "pass",
    tests: [
      "empty roots and direct-child-only discovery",
      "canonical dedupe, override metadata, and symlink escape rejection",
      "manifest missing/corrupt and damaged artifact degradation",
      "500 artifact metadata limit",
      "bounded session metadata fallback and partial format handling",
      "R/A/V/O/Runtime lanes, lifecycle attention, deterministic sorting and metrics",
      "Spec-allowed blocked_external remains pending_acceptance",
      "50 workspace performance baseline"
    ],
    performance: { workspaceCount: 50, elapsedMs: Number(elapsedMs.toFixed(1)), targetMs: 3000 }
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
