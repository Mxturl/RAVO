#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { REQUIRED_PLUGINS } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade");
const {
  createSoloDesk,
  readDashboardSettings,
  reviewProcessTimeoutMs,
  trustedControllerPath
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");

const repo = path.resolve(__dirname, "..");

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function request(port, method, pathname, options = {}) {
  const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
  const headers = {
    Host: options.host || `127.0.0.1:${port}`,
    ...(options.origin ? { Origin: options.origin } : {}),
    ...(options.csrf ? { "X-RAVO-CSRF-Token": options.csrf } : {}),
    ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {})
  };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let value = null;
        try { value = JSON.parse(text); } catch (_error) { value = text; }
        resolve({ status: res.statusCode, headers: res.headers, value });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-dashboard-api-home-")));
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-dashboard-api-workspace-")));
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "knowledge", ".ravo"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "knowledge", ".ravo", "manifest.json"), `${JSON.stringify({ schemaVersion: "0.5.0", modules: {} })}\n`);
  const reviewConfigPath = path.join(home, ".codex", "skill-config", "ravo-review.json");
  fs.mkdirSync(path.dirname(reviewConfigPath), { recursive: true });
  const migrationSecret = ["migration", "secret"].join("-");
  const legacyReviewConfig = { apiMode: "fake", apiBase: "fake://review", apiKey: migrationSecret, models: "model-a,model-b", rounds: 2 };
  fs.writeFileSync(reviewConfigPath, `${JSON.stringify(legacyReviewConfig, null, 2)}\n`, { mode: 0o600 });
  const defaultSettings = readDashboardSettings({ home, cwd: workspace });
  assert.deepEqual(defaultSettings.roots, [], "unconfigured roots remain empty so discovery indexes only startup cwd");
  assert.equal(defaultSettings.rootsConfigured, false);
  assert.equal(defaultSettings.startupMode, "on_demand");
  const trustedController = path.join(repo, "plugins", "ravo", "modules", "ravo-dashboard", "scripts", "ravo-solodesk.js");
  assert.equal(trustedControllerPath(trustedController), fs.realpathSync(trustedController));
  const installedController = path.join(home, ".codex", "ravo", "bin", "ravo-solodesk.js");
  fs.mkdirSync(path.dirname(installedController), { recursive: true });
  fs.copyFileSync(trustedController, installedController);
  fs.chmodSync(installedController, 0o700);
  assert.equal(trustedControllerPath(installedController, home), fs.realpathSync(installedController));
  assert.equal(trustedControllerPath(path.join(home, "untrusted-controller.js")), "");
  assert.throws(() => createSoloDesk({ home, cwd: workspace, controllerPath: path.join(home, "untrusted-controller.js") }), (error) => error.code === "untrusted_controller_path");
  assert.equal(reviewProcessTimeoutMs({ callPlan: { maximumRunMs: 2_147_000_000 } }), 2_147_000_000, "oversized Review plans retain a bounded Node timer");
  for (const maximumRunMs of [0, -1, 1.5, "invalid", Number.NaN]) {
    assert.throws(() => reviewProcessTimeoutMs({ callPlan: { maximumRunMs } }), (error) => error.code === "review_plan_runtime_invalid");
  }
  assert.equal(reviewProcessTimeoutMs({ callPlan: {} }, 12345), 12345, "missing preview runtime uses the explicit compatibility fallback");

  const workspaceId = "workspace_fixture_01";
  const reviewCalls = [];
  let reviewFingerprint = "sha256:review-config-a";
  let reviewMaximumRunMs = 20 * 60 * 1000;
  const executeReview = (_file, args, input, context = {}) => {
    reviewCalls.push({ args: args.slice(), inputLength: input.length, timeoutMs: context.timeoutMs });
    const pairIndex = args.indexOf("--provider-test");
    if (pairIndex >= 0) return {
      status: "pass",
      providerModelKey: args[pairIndex + 1],
      usable: true,
      attempts: [{ result: "usable" }],
      artifactPath: path.join(workspace, "knowledge", ".ravo", "review", "provider-tests", "test.json")
    };
    if (args.includes("--preview")) {
      const modelKeys = [];
      for (let index = 0; index < args.length; index += 1) if (args[index] === "--model") modelKeys.push(args[index + 1]);
      const boundary = args[args.indexOf("--data-boundary") + 1];
      return {
        status: "ok",
        configPath: "/private/config/path-that-must-not-be-returned.json",
        config: { valid: true, redactedConfigFingerprint: reviewFingerprint },
        callPlan: {
          configFingerprint: reviewFingerprint,
          subjectRef: args[args.indexOf("--subject-ref") + 1],
          subjectHash: sha(input),
          dataBoundary: {
            decision: boundary,
            authorizationSource: "explicit_user_action",
            externalCallAllowed: boundary !== "prohibited",
            redactionSummary: []
          },
          requestedPairs: modelKeys.length ? modelKeys : ["provider-a/model-a"],
          fallbackPairs: [],
          rounds: 2,
          runClass: "formal",
          formalEvidenceEligible: true,
          maxAttempts: 2,
          outputBudgets: [{ providerModelKey: modelKeys[0] || "provider-a/model-a", maxTokensMode: "auto", requestedMaxTokens: null, autoFallbackMaxTokens: 48000 }],
          maximumRequests: 4,
          maximumRunMs: reviewMaximumRunMs,
          artifactTypes: ["aggregate_review", "raw_response", "round_input", "issue_ledger"]
        }
      };
    }
    context.onProgress?.({
      type: "attempt",
      reviewRunId: args[args.indexOf("--review-run-id") + 1],
      providerModelKey: "provider-a/model-a",
      round: 1,
      attempt: 1,
      attemptType: "initial",
      result: "usable",
      reason: "usable_response",
      parserStatus: "pass",
      emittedAt: new Date().toISOString()
    });
    return {
      status: "ok",
      reviewRunId: args[args.indexOf("--review-run-id") + 1],
      workflowCoverage: "full",
      parserStatus: "pass",
      validResults: true,
      modelsUsable: ["provider-a/model-a"],
      artifactPath: path.join(workspace, "knowledge", ".ravo", "review", "review.json")
    };
  };

  const updateCalls = [];
  let updateFingerprint = "sha256:update-source-a";
  const updateCheck = ({ refresh }) => {
    updateCalls.push({ type: "check", refresh });
    return {
      status: "update_or_repair_available",
      marketplaceStatus: "present",
      sourceType: "local",
      sourceFingerprint: updateFingerprint,
      runtimeFingerprint: "sha256:runtime-a",
      currentVersion: "0.4.0",
      availableVersion: "0.5.1",
      requiredPlugins: REQUIRED_PLUGINS.slice(),
      plugins: REQUIRED_PLUGINS.map((pluginId) => ({
        pluginId,
        sourcePresent: true,
        sourceVersion: "0.5.1",
        installed: true,
        enabled: true,
        installedVersion: "0.4.0",
        cacheVersion: "0.4.0",
        aligned: false,
        status: "drift"
      })),
      drift: true,
      freshSessionRequired: true,
      checkedAt: new Date().toISOString(),
      recoverySteps: []
    };
  };
  const applyUpdate = (plan, options) => {
    updateCalls.push({ type: "apply", planId: plan.planId, workspaces: options.workspaces.slice() });
    return { status: "succeeded", journalId: plan.planId, freshSessionRequired: true, pluginResults: [{ pluginId: "ravo-dashboard", status: "succeeded" }] };
  };
  const recoverUpdate = (journalId, options) => {
    updateCalls.push({ type: "recover", journalId, workspaces: options.workspaces.slice() });
    return { status: "recovered", journalId };
  };
  const integrityCalls = [];
  const integrityPlan = {
    schemaVersion: "0.5.1",
    planId: "plan-integrity-a",
    planFingerprint: "sha256:integrity-plan-a",
    status: "changes_ready",
    currentHash: "sha256:config-current",
    snapshotId: "snapshot-a",
    snapshotTrust: "runtime_verified",
    snapshotHash: "sha256:config-snapshot",
    pluginFingerprint: "sha256:plugin",
    candidateHash: "sha256:config-candidate",
    managedChanges: [{ section: "marketplaces.ravo", action: "add", reason: "missing_ravo_marketplace" }],
    externalPreservedChanges: [],
    externalCandidates: ["marketplaces.ponytail"],
    selectedExternalSections: [],
    reenablePlugins: [],
    conflicts: [],
    approvalRequired: [],
    unresolvedRequired: [],
    protectedSections: [{ section: "model_providers.custom", beforeHash: "sha256:protected", afterHash: "sha256:protected", preserved: true }],
    protectedSectionCount: 1,
    runtimeProbeRequired: true,
    expiresOn: ["current_hash_change"],
    risks: []
  };
  const configIntegrity = {
    getIntegrityStatus: () => ({ configIntegrityStatus: "drift", status: "drift", currentHash: "sha256:config-current", selectedSnapshotId: "snapshot-a", selectedSnapshotTrust: "runtime_verified", driftSections: ["marketplaces.ravo"], repairRequired: true, approvalRequired: [], unresolvedRequired: [], externalCandidates: ["marketplaces.ponytail"], protectedSectionCount: 1, snapshots: [] }),
    listRepairJournals: () => [],
    createSnapshot: (options) => {
      integrityCalls.push({ type: "snapshot", reason: options.reason });
      return { status: "created", recommended: options.reason === "manual_known_good", snapshot: { snapshotId: `snapshot-${integrityCalls.length}`, createdAt: new Date().toISOString(), sourceHash: "sha256:snapshot", ravoVersion: "0.5.1", pluginFingerprint: "sha256:plugin", runtimeVerified: options.reason === "manual_known_good", reason: options.reason } };
    },
    previewRepair: (options) => {
      integrityCalls.push({ type: "preview", snapshotId: options.snapshotId, selectedExternalSections: options.selectedExternalSections });
      return { ...integrityPlan, snapshotId: options.snapshotId || integrityPlan.snapshotId, selectedExternalSections: options.selectedExternalSections };
    },
    applyRepair: (plan) => {
      integrityCalls.push({ type: "apply", planId: plan.planId });
      return { status: "succeeded", repairId: "repair-a", currentHashBefore: plan.currentHash, currentHashAfter: plan.candidateHash, managedChanges: plan.managedChanges, externalPreservedChanges: [], conflicts: [], approvalRequired: [], unresolvedRequired: [], pluginCheck: { status: "pass", missing: [] }, runtimeStatus: { runtimeHealth: "configured_unverified" }, runtimeProbeRequired: true, journalPath: "journals/repair-a.json", recoveryEntry: "recover repair-a" };
    },
    recoverRepair: (repairId) => {
      integrityCalls.push({ type: "repair-recover", repairId });
      return { status: "recovered", repairId, runtimeProbeRequired: true };
    }
  };

  const data = {
    discoverWorkspaces: () => [{
      workspaceId,
      name: "API Fixture",
      canonicalPath: workspace,
      discoverySource: "root",
      ravoPresent: true,
      priority: "normal",
      lifecycle: "active",
      lastIndexedAt: new Date().toISOString(),
      dataStatus: "complete"
    }],
    buildDashboardIndex: ({ runtimeStatusByWorkspace, freshnessByWorkspace }) => {
      const item = {
        workspaceId,
        name: "API Fixture",
        canonicalPath: workspace,
        discoverySource: "root",
        ravoPresent: true,
        priority: "normal",
        lifecycle: "active",
        dataStatus: "complete",
        deliveryStatus: "in_progress",
        freshness: "current",
        confidence: "medium",
        sourceRefs: ["knowledge/.ravo/manifest.json"],
        artifacts: [{
          id: "artifact-1",
          module: "analysis",
          format: "json",
          kind: "requirement",
          title: "Artifact metadata",
          summary: "Safe summary",
          status: "complete",
          schemaVersion: "0.5.0",
          subjectRef: "subject-1",
          relatedArtifact: "",
          releaseRef: "",
          sourceRefs: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          relativePath: "knowledge/.ravo/analysis/artifact-1.json",
          canonicalPath: path.join(workspace, "knowledge", ".ravo", "analysis", "artifact-1.json"),
          size: 123,
          details: { raw: "SECRET_ARTIFACT_BODY" }
        }],
        timeline: [{ kind: "artifact", id: "manifest", sourceRef: "knowledge/.ravo/manifest.json" }],
        lanes: {
          Reason: { status: "clear", summary: "Spec current", items: [], sourceRefs: [], freshness: "current", confidence: "medium" },
          Act: { status: "attention", summary: "Work active", items: [], sourceRefs: [], freshness: "current", confidence: "medium" },
          Verify: { status: "attention", summary: "Evidence pending", items: [], sourceRefs: [], freshness: "current", confidence: "medium" },
          Organize: { status: "clear", summary: "Knowledge available", items: [], sourceRefs: [], freshness: "current", confidence: "medium" },
          Runtime: { status: "clear", summary: "Runtime healthy", items: [], sourceRefs: [], freshness: "current", confidence: "medium" }
        },
        suggestions: [{ action: "Continue the active milestone", reason: "Workstream active", sourceRefs: [], expectedOutcome: "Milestone evidence", blocking: false }],
        authoritativeWorkstream: {
          id: "workstream-1",
          module: "workstream",
          status: "active",
          relativePath: "knowledge/.ravo/workstream/workstream-1.json",
          selectionReason: "target_lineage_latest",
          relationStatus: "matched",
          lineageKey: "release:v0.5.1",
          supersededArtifacts: []
        },
        selectedAcceptance: null,
        releaseReview: { artifactPath: "", status: "not_applicable", selectionReason: "no_release_review", relationStatus: "unmatched", sourceRefs: [] },
        openAnalysisReviews: [{ analysisArtifact: "knowledge/.ravo/analysis/open.json", reviewArtifact: "", status: "needed", relationStatus: "unmatched", selectionReason: "no_analysis_review" }],
        executionLanes: { development: { milestoneRef: "M3", status: "active" }, acceptance: { milestoneRef: "M2", baselineRef: "git-tree:api", status: "in_progress" }, recovery: { status: "inactive", workers: [] } },
        executionDecisions: [],
        authorizationEnvelopes: [],
        runtime: runtimeStatusByWorkspace.get(workspace),
        freshnessState: freshnessByWorkspace.get(workspace)
      };
      return {
        workspaces: [item],
        workspaceById: new Map([[workspaceId, item]]),
        attention: [{ id: "attention-1", workspaceId, lane: "Act", severity: "medium", title: "Work active", reason: "Current milestone remains active", sourceRefs: [], sourceUpdatedAt: new Date().toISOString(), freshness: "current", confidence: "medium", suggestedAction: "Continue", expectedOutcome: "Progress", blocking: false }],
        metrics: { activeWorkspaces: 1, pendingCodexVerification: 1 },
        sessions: [],
        sessionDataStatus: "complete",
        warnings: [],
        generatedAt: new Date().toISOString()
      };
    },
    buildContinuationBrief: (item, options) => ({
      workspace: item.canonicalPath,
      currentGoal: "Continue API fixture",
      dataBoundary: options.dataBoundary,
      sourceRefs: item.sourceRefs
    }),
    buildShortcut: (item, kind, options) => ({
      kind,
      workspaceId: item.workspaceId,
      prompt: `Workspace: ${item.canonicalPath}\nAction: ${kind}\nData boundary: ${options.dataBoundary}`,
      dataBoundary: options.dataBoundary,
      sourceRefs: item.sourceRefs,
      dataGaps: []
    })
  };

  const coreStatus = {
    buildStatus: (target) => ({
      status: "ok",
      workspace: target,
      marketplaceStatus: "present",
      pluginStatus: "healthy",
      versionStatus: "aligned",
      hookTrustEvidence: "recorded",
      runtimeProbeStatus: "pass",
      manifestStatus: "healthy",
      configStatus: "healthy",
      runtimeHealth: "healthy",
      fingerprint: "sha256:runtime",
      pluginFingerprint: "sha256:plugin",
      configFingerprint: "sha256:config",
      expectedHookEvents: ["SessionStart"],
      plugins: [],
      warnings: [],
      recoverySteps: []
    })
  };

  const { state, server } = createSoloDesk({
    home,
    cwd: workspace,
    workspaceRoots: [workspace],
    data,
    coreStatus,
    executeReview,
    checkUpdates: updateCheck,
    applyUpgrade: applyUpdate,
    recoverConfig: recoverUpdate,
    configIntegrity,
    tokenTtlMs: 60_000
  });
  await state.refresh("test_startup");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  state.port = server.address().port;
  const port = state.port;
  const csrf = state.csrfToken;

  try {
    const health = await request(port, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.value.csrfToken, csrf);
    assert.ok(health.value.instanceId);
    assert.equal(health.value.pid, process.pid);
    assert.equal(health.value.serviceVersion, "0.6.2");
    assert.equal(health.value.startupMode, "on_demand");
    assert.equal(health.value.mutation.busy, false);
    assert.equal(health.headers["access-control-allow-origin"], undefined);
    assert.equal(health.headers["x-content-type-options"], "nosniff");

    const externalHost = await request(port, "GET", "/api/health", { host: `example.com:${port}` });
    assert.equal(externalHost.status, 403);
    assert.equal(externalHost.value.error.code, "invalid_host");

    const externalOrigin = await request(port, "GET", "/api/health", { origin: "https://example.com" });
    assert.equal(externalOrigin.status, 403);
    assert.equal(externalOrigin.value.error.code, "external_origin_rejected");

    const crossLoopbackOrigin = await request(port, "GET", "/api/health", { origin: `http://localhost:${port}` });
    assert.equal(crossLoopbackOrigin.status, 403);

    const sameOrigin = await request(port, "GET", "/api/health", { origin: `http://127.0.0.1:${port}` });
    assert.equal(sameOrigin.status, 200);

    const serviceStatus = await request(port, "GET", "/api/service/status");
    assert.equal(serviceStatus.status, 200);
    assert.equal(serviceStatus.value.instanceId, state.instanceId);
    assert.equal(serviceStatus.value.serviceVersion, "0.6.2");
    assert.equal(serviceStatus.value.pluginFingerprint, state.pluginFingerprint);
    assert.equal(serviceStatus.value.mutation.busy, false);
    assert.equal(serviceStatus.value.csrfToken, undefined);

    const noCsrfRestart = await request(port, "POST", "/api/service/restart");
    assert.equal(noCsrfRestart.status, 403);
    state.reviewRuns.set("busy-review", { reviewRunId: "busy-review", status: "running" });
    const busyRestart = await request(port, "POST", "/api/service/restart", { csrf, body: {} });
    assert.equal(busyRestart.status, 409);
    assert.equal(busyRestart.value.error.code, "service_busy");
    assert.deepEqual(busyRestart.value.error.details.reviewRunIds, ["busy-review"]);
    state.reviewRuns.delete("busy-review");
    const serviceRestart = await request(port, "POST", "/api/service/restart", { csrf, body: {} });
    assert.equal(serviceRestart.status, 202);
    assert.deepEqual(serviceRestart.value.restartHandoff, { required: true, reason: "api_restart_requested", scheduled: false });
    assert.equal(serviceRestart.value.service.restartRequired, true);
    assert.equal(serviceRestart.value.service.restartReason, "api_restart_requested");
    assert.equal(serviceRestart.value.service.lastErrorCode, "");
    const repeatedRestart = await request(port, "POST", "/api/service/restart", { csrf, body: {} });
    assert.equal(repeatedRestart.status, 202);
    assert.equal(repeatedRestart.value.service.restartReason, "api_restart_requested");
    state.restartRequired = false;
    state.lifecycleStatus = "healthy";
    state.restartReason = "";
    state.restartScheduledAt = "";
    state.lastErrorCode = "";

    const integrityStatus = await request(port, "GET", "/api/config-integrity/status");
    assert.equal(integrityStatus.status, 200);
    assert.equal(integrityStatus.value.configIntegrityStatus, "drift");
    assert.equal(integrityStatus.value.currentHash, "sha256:config-current");
    assert.equal(JSON.stringify(integrityStatus.value).includes("credential"), false);
    const integritySnapshot = await request(port, "POST", "/api/config-integrity/snapshot", { csrf, body: {} });
    assert.equal(integritySnapshot.status, 200);
    assert.equal(integritySnapshot.value.snapshot.runtimeVerified, true);
    const integrityPreview = await request(port, "POST", "/api/config-integrity/preview", {
      csrf,
      body: { snapshotId: "snapshot-a", selectedExternalSections: ["marketplaces.ponytail"], reenablePlugins: [] }
    });
    assert.equal(integrityPreview.status, 200);
    assert.ok(integrityPreview.value.confirmationToken);
    assert.equal(integrityPreview.value.plan.protectedSections[0].preserved, true);
    const integrityApplied = await request(port, "POST", "/api/config-integrity/apply", {
      csrf,
      body: { planId: integrityPreview.value.plan.planId, confirmationToken: integrityPreview.value.confirmationToken }
    });
    assert.equal(integrityApplied.status, 200);
    assert.equal(integrityApplied.value.status, "succeeded");
    assert.equal(integrityApplied.value.runtimeProbeRequired, true);
    assert.ok(integrityApplied.value.snapshot.snapshotId);
    const integrityReplay = await request(port, "POST", "/api/config-integrity/apply", {
      csrf,
      body: { planId: integrityPreview.value.plan.planId, confirmationToken: integrityPreview.value.confirmationToken }
    });
    assert.equal(integrityReplay.status, 409);
    assert.equal(integrityReplay.value.error.code, "confirmation_consumed");
    const integrityRecovered = await request(port, "POST", "/api/config-integrity/recover", { csrf, body: { repairId: "repair-a" } });
    assert.equal(integrityRecovered.status, 200);
    assert.equal(integrityRecovered.value.status, "recovered");

    const noCsrf = await request(port, "POST", "/api/refresh");
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.value.error.code, "csrf_invalid");

    const workspaces = await request(port, "GET", "/api/workspaces");
    assert.equal(workspaces.status, 200);
    assert.equal(workspaces.value.workspaces.length, 1);
    assert.equal(workspaces.value.metrics.activeWorkspaces, 1);
    assert.equal(JSON.stringify(workspaces.value).includes("SECRET_ARTIFACT_BODY"), false);
    assert.equal(workspaces.value.workspaces[0].artifacts, undefined, "overview returns a bounded workspace projection");
    assert.equal(workspaces.value.workspaces[0].authoritativeWorkstream.selectionReason, "target_lineage_latest");
    assert.equal(workspaces.value.workspaces[0].releaseReview.selectionReason, "no_release_review");

    const detail = await request(port, "GET", `/api/workspaces/${workspaceId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.value.workspace.canonicalPath, workspace);
    assert.equal(detail.value.workspace.artifacts.length, 1);
    assert.equal(detail.value.workspace.artifacts[0].canonicalPath, undefined);
    assert.equal(detail.value.workspace.openAnalysisReviews[0].status, "needed");
    assert.equal(detail.value.workspace.executionLanes.acceptance.baselineRef, "git-tree:api");
    assert.equal(JSON.stringify(detail.value).includes("SECRET_ARTIFACT_BODY"), false, "detail returns metadata, not internal artifact details");

    const unknownWorkspace = await request(port, "GET", "/api/workspaces/not_allowed_workspace");
    assert.equal(unknownWorkspace.status, 404);

    const timeline = await request(port, "GET", `/api/workspaces/${workspaceId}/timeline?limit=10`);
    assert.equal(timeline.status, 200);
    assert.equal(timeline.value.timeline.length, 1);

    const continuation = await request(port, "GET", `/api/workspaces/${workspaceId}/continuation`);
    assert.equal(continuation.status, 200);
    assert.equal(continuation.value.continuation.workspace, workspace);
    assert.equal(continuation.value.continuation.dataBoundary, "local_prompt_only");

    const shortcut = await request(port, "GET", `/api/workspaces/${workspaceId}/shortcuts/continue`);
    assert.equal(shortcut.status, 200);
    assert.match(shortcut.value.prompt, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(shortcut.value.dataBoundary, "local_prompt_only");
    const sanitizedShortcut = await request(port, "GET", `/api/workspaces/${workspaceId}/shortcuts/review?dataBoundary=safe_sanitized`);
    assert.equal(sanitizedShortcut.status, 200);
    assert.equal(sanitizedShortcut.value.dataBoundary, "safe_sanitized");
    const invalidShortcutBoundary = await request(port, "GET", `/api/workspaces/${workspaceId}/shortcuts/review?dataBoundary=arbitrary`);
    assert.equal(invalidShortcutBoundary.status, 400);
    assert.equal(invalidShortcutBoundary.value.error.code, "invalid_shortcut_data_boundary");

    const invalidShortcut = await request(port, "GET", `/api/workspaces/${workspaceId}/shortcuts/arbitrary-shell`);
    assert.equal(invalidShortcut.status, 404);

    const modules = await request(port, "GET", "/api/config");
    assert.equal(modules.status, 200);
    assert.ok(modules.value.modules.some((module) => module.moduleId === "dashboard"));

    const invalidConfig = await request(port, "POST", "/api/config/core/validate", {
      csrf,
      body: { values: { arbitraryPath: "/tmp/escape" } }
    });
    assert.equal(invalidConfig.status, 422);
    assert.equal(invalidConfig.value.error.code, "config_validation_failed");

    const save = await request(port, "PUT", "/api/config/core", {
      csrf,
      body: { values: { technicalDetailLevel: 1 } }
    });
    assert.equal(save.status, 200);
    assert.equal(save.value.status, "deprecated_ignored");
    assert.deepEqual(save.value.deprecatedIgnored, ["technicalDetailLevel"]);
    const configView = await request(port, "GET", "/api/config/core");
    assert.equal(configView.status, 200);
    assert.equal(configView.value.targetPath, path.join(home, ".codex", "skill-config", "ravo.json"));
    assert.deepEqual(configView.value.sourcePrecedence, ["user", "default"]);
    assert.equal(configView.value.fields.some((field) => ["technicalDetailLevel", "audience"].includes(field.path)), false);

    const migrationValues = {
      providers: [{
        id: "default",
        label: "Primary",
        enabled: true,
        apiMode: "fake",
        apiKey: { action: "keep" },
        models: [{ id: "model-a", enabled: true }, { id: "model-b", enabled: true }]
      }]
    };
    const migrationWithoutPreview = await request(port, "PUT", "/api/config/review", { csrf, body: { values: migrationValues, scope: "user" } });
    assert.equal(migrationWithoutPreview.status, 409);
    assert.equal(migrationWithoutPreview.value.error.code, "migration_preview_required");
    const migrationPreview = await request(port, "POST", "/api/config/review/validate", { csrf, body: { values: migrationValues, scope: "user" } });
    assert.equal(migrationPreview.status, 200);
    assert.equal(migrationPreview.value.migrationPreview.required, true);
    assert.equal(migrationPreview.value.migrationPreview.semanticChecks.nonTimeoutSemanticsPreserved, true);
    assert.ok(migrationPreview.value.confirmationToken);
    assert.equal(JSON.stringify(migrationPreview.value).includes("migration-secret"), false);
    const staleMigration = await request(port, "PUT", "/api/config/review", {
      csrf,
      body: { values: { ...migrationValues, rounds: 3 }, scope: "user", confirmationToken: migrationPreview.value.confirmationToken }
    });
    assert.equal(staleMigration.status, 409);
    assert.equal(staleMigration.value.error.code, "migration_preview_stale");
    const migrationApplied = await request(port, "PUT", "/api/config/review", {
      csrf,
      body: { values: migrationValues, scope: "user", confirmationToken: migrationPreview.value.confirmationToken }
    });
    assert.equal(migrationApplied.status, 200);
    const migratedReviewConfig = JSON.parse(fs.readFileSync(reviewConfigPath, "utf8"));
    assert.ok(Array.isArray(migratedReviewConfig.providers));
    assert.equal(migratedReviewConfig.providers[0].apiKey, migrationSecret);
    assert.equal(migratedReviewConfig.timeoutMs, 900000);
    assert.equal(fs.statSync(reviewConfigPath).mode & 0o777, 0o600);
    const migrationReplay = await request(port, "PUT", "/api/config/review", {
      csrf,
      body: { values: migrationValues, scope: "user", confirmationToken: migrationPreview.value.confirmationToken }
    });
    assert.equal(migrationReplay.status, 200, "already-canonical idempotent saves no longer require a migration token");
    fs.writeFileSync(reviewConfigPath, `${JSON.stringify(legacyReviewConfig, null, 2)}\n`, { mode: 0o600 });
    const consumedMigrationToken = await request(port, "PUT", "/api/config/review", {
      csrf,
      body: { values: migrationValues, scope: "user", confirmationToken: migrationPreview.value.confirmationToken }
    });
    assert.equal(consumedMigrationToken.status, 409);
    assert.equal(consumedMigrationToken.value.error.code, "confirmation_consumed");
    fs.writeFileSync(reviewConfigPath, `${JSON.stringify(migratedReviewConfig, null, 2)}\n`, { mode: 0o600 });

    const startupModeSave = await request(port, "PUT", "/api/config/dashboard", {
      csrf,
      body: { values: { dashboard: { startupMode: "login" } } }
    });
    assert.equal(startupModeSave.status, 200);
    assert.deepEqual(startupModeSave.value.restartHandoff, { required: true, reason: "startup_mode_changed", scheduled: false });
    assert.equal(state.restartRequired, true);

    const prohibitedPreview = await request(port, "POST", "/api/review/preview", {
      csrf,
      body: {
        workspaceId,
        mode: "run",
        subject: "credential=secret",
        dataBoundary: "prohibited",
        providerModelKeys: ["provider-a/model-a"]
      }
    });
    assert.equal(prohibitedPreview.status, 200);
    assert.equal(prohibitedPreview.value.confirmationToken, "");

    const testPreview = await request(port, "POST", "/api/review/preview", {
      csrf,
      body: { workspaceId, mode: "test", providerModelKey: "provider-a/model-a" }
    });
    assert.equal(testPreview.status, 200);
    assert.ok(testPreview.value.confirmationToken);
    const providerTest = await request(port, "POST", "/api/review/test", {
      csrf,
      body: { confirmationToken: testPreview.value.confirmationToken }
    });
    assert.equal(providerTest.status, 200);
    assert.equal(providerTest.value.status, "pass");
    const providerTestCall = reviewCalls.find((call) => call.args.includes("--provider-test"));
    assert.ok(providerTestCall.timeoutMs > reviewMaximumRunMs);
    assert.ok(providerTestCall.timeoutMs <= reviewMaximumRunMs + 2 * 60 * 1000);
    const replayedTest = await request(port, "POST", "/api/review/test", {
      csrf,
      body: { confirmationToken: testPreview.value.confirmationToken }
    });
    assert.equal(replayedTest.status, 409);
    assert.equal(replayedTest.value.error.code, "confirmation_consumed");

    const stalePreview = await request(port, "POST", "/api/review/preview", {
      csrf,
      body: {
        workspaceId,
        mode: "run",
        subject: "Review a bounded implementation plan.",
        dataBoundary: "safe_sanitized",
        providerModelKeys: ["provider-a/model-a"]
      }
    });
    reviewFingerprint = "sha256:review-config-b";
    const staleRun = await request(port, "POST", "/api/review/run", {
      csrf,
      body: { confirmationToken: stalePreview.value.confirmationToken }
    });
    assert.equal(staleRun.status, 409);
    assert.equal(staleRun.value.error.code, "review_preview_stale");
    reviewFingerprint = "sha256:review-config-a";

    const runtimePlanPreview = await request(port, "POST", "/api/review/preview", {
      csrf,
      body: {
        workspaceId,
        mode: "run",
        subject: "Review a bounded implementation plan.",
        dataBoundary: "safe_sanitized",
        providerModelKeys: ["provider-a/model-a"]
      }
    });
    reviewMaximumRunMs += 60 * 1000;
    const staleRuntimePlan = await request(port, "POST", "/api/review/run", {
      csrf,
      body: { confirmationToken: runtimePlanPreview.value.confirmationToken }
    });
    assert.equal(staleRuntimePlan.status, 409);
    assert.equal(staleRuntimePlan.value.error.code, "review_preview_stale");
    reviewMaximumRunMs -= 60 * 1000;

    const runPreview = await request(port, "POST", "/api/review/preview", {
      csrf,
      body: {
        workspaceId,
        mode: "run",
        subject: "Review a bounded implementation plan.",
        dataBoundary: "safe_sanitized",
        providerModelKeys: ["provider-a/model-a"]
      }
    });
    assert.equal(runPreview.status, 200);
    assert.equal(runPreview.value.preview.configPath, undefined);
    assert.equal(JSON.stringify(runPreview.value).includes("Review a bounded implementation plan."), false);
    const started = await request(port, "POST", "/api/review/run", {
      csrf,
      body: { confirmationToken: runPreview.value.confirmationToken }
    });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const runStatus = await request(port, "GET", `/api/review/runs/${started.value.reviewRunId}`);
    assert.equal(runStatus.status, 200);
    assert.equal(runStatus.value.status, "completed");
    assert.equal(runStatus.value.result.validResults, true);
    assert.equal(runStatus.value.progress.pairs["provider-a/model-a"].result, "usable");
    assert.equal(JSON.stringify(runStatus.value).includes("Review a bounded implementation plan."), false);
    const reviewRunCall = reviewCalls.find((call) => call.args.includes("--review-run-id") && !call.args.includes("--provider-test"));
    assert.ok(reviewRunCall.timeoutMs > reviewMaximumRunMs);
    assert.ok(reviewRunCall.timeoutMs <= reviewMaximumRunMs + 2 * 60 * 1000);
    assert.ok(reviewCalls.filter((call) => call.args.includes("--preview")).every((call) => call.timeoutMs <= 15 * 60 * 1000));

    const checked = await request(port, "POST", "/api/updates/check", { csrf });
    assert.equal(checked.status, 200);
    assert.ok(checked.value.confirmationToken);
    updateFingerprint = "sha256:update-source-b";
    const staleApply = await request(port, "POST", "/api/updates/apply", {
      csrf,
      body: { planId: checked.value.plan.planId, confirmationToken: checked.value.confirmationToken }
    });
    assert.equal(staleApply.status, 409);
    assert.equal(staleApply.value.error.code, "upgrade_plan_stale");
    updateFingerprint = "sha256:update-source-a";

    const checkedAgain = await request(port, "POST", "/api/updates/check", { csrf });
    const applied = await request(port, "POST", "/api/updates/apply", {
      csrf,
      body: { planId: checkedAgain.value.plan.planId, confirmationToken: checkedAgain.value.confirmationToken }
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.value.status, "succeeded");
    assert.deepEqual(applied.value.restartHandoff, { required: true, reason: "plugin_upgrade_applied", scheduled: false });
    const replayedApply = await request(port, "POST", "/api/updates/apply", {
      csrf,
      body: { planId: checkedAgain.value.plan.planId, confirmationToken: checkedAgain.value.confirmationToken }
    });
    assert.equal(replayedApply.status, 409);

    const recovered = await request(port, "POST", "/api/updates/recover-config", {
      csrf,
      body: { journalId: checkedAgain.value.plan.planId }
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.value.status, "recovered");

    const refreshed = await request(port, "POST", "/api/refresh", { csrf });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.value.status, "refreshed");

    assert.ok(reviewCalls.some((call) => call.args.includes("--preview")));
    assert.ok(reviewCalls.some((call) => call.args.includes("--provider-test")));
    assert.ok(updateCalls.some((call) => call.type === "apply"));
    assert.ok(updateCalls.some((call) => call.type === "recover"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(JSON.stringify({
    status: "pass",
    checks: [
      "loopback-host-origin",
      "csrf-all-mutations",
      "service-status-restart-handoff",
      "config-integrity-status-snapshot-preview-apply-recover",
      "config-target-path-source-precedence",
      "startup-mode-restart-handoff",
      "workspace-id-only",
      "config-allowlist",
      "review-preview-boundary",
      "review-single-use-confirmation",
      "review-config-drift",
      "review-runtime-plan-drift",
      "review-plan-derived-process-timeout",
      "review-progress-redaction",
      "provider-test-isolated",
      "upgrade-plan-drift",
      "upgrade-single-use-confirmation",
      "fixed-update-recovery",
      "upgrade-restart-handoff",
      "refresh-in-memory"
    ]
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
