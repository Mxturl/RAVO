#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSoloDesk } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");
const { REQUIRED_PLUGINS } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade");

const FIXTURE_CREDENTIAL = ["fixture", "credential", "must", "not", "reach", "browser"].join("-");
const FIXED_TIME = "2026-07-10T18:00:00.000Z";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function loadPlaywright() {
  const candidates = [
    process.env.RAVO_PLAYWRIGHT_NODE_PATH,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules")
  ].filter(Boolean);
  try { return require("playwright"); } catch (_error) { /* Try bundled paths. */ }
  for (const candidate of candidates) {
    try { return require(path.join(candidate, "playwright")); } catch (_error) { /* Try the next path. */ }
  }
  return null;
}

function chromeExecutable(playwright) {
  if (process.env.RAVO_CHROME_PATH) {
    return fs.existsSync(process.env.RAVO_CHROME_PATH) ? process.env.RAVO_CHROME_PATH : "";
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter(Boolean);
  const system = candidates.find((candidate) => fs.existsSync(candidate));
  if (system) return system;
  const bundled = playwright?.chromium?.executablePath?.();
  return bundled && fs.existsSync(bundled) ? bundled : "";
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function runtimeStatus(workspace) {
  return {
    status: "ok",
    workspace,
    marketplaceStatus: "present",
    pluginStatus: "healthy",
    versionStatus: "aligned",
    hookTrustEvidence: "recorded",
    runtimeProbeStatus: "partial",
    coreRuntimeStatus: "verified",
    terminalTelemetryStatus: "unknown",
    terminalTelemetry: { event: "Stop", status: "unknown", summary: "Stop telemetry was not observed.", evidenceRef: "" },
    manifestStatus: "healthy",
    configStatus: "healthy",
    runtimeHealth: "core_verified",
    fingerprint: "sha256:ui-runtime",
    pluginFingerprint: "sha256:ui-plugin",
    configFingerprint: "sha256:ui-config",
    expectedHookEvents: ["SessionStart"],
    plugins: [],
    warnings: [],
    recoverySteps: []
  };
}

function fixtureWorkspace(workspace) {
  const attention = {
    id: "attention_fixture_01",
    category: "pending_codex",
    workspaceId: "workspace_fixture_01",
    lane: "Verify",
    severity: "high",
    title: "Codex evidence is still required",
    reason: "The latest acceptance item still needs a real browser verification.",
    suggestedAction: "Run the browser flow and attach the screenshots.",
    expectedOutcome: "The PM can inspect the real SoloDesk response.",
    blocking: false,
    sourceRefs: ["knowledge/.ravo/acceptance/ui-fixture.json"],
    sourceUpdatedAt: FIXED_TIME,
    freshness: "current",
    confidence: "high"
  };
  return {
    workspaceId: "workspace_fixture_01",
    name: "SoloDesk 验收工作区",
    displayName: "SoloDesk 验收工作区",
    canonicalPath: workspace,
    discoverySource: "root",
    ravoPresent: true,
    priority: "high",
    lifecycle: "active",
    lastIndexedAt: FIXED_TIME,
    dataStatus: "complete",
    activityStatus: "active",
    deliveryStatus: "in_progress",
    reviewStatus: "partial",
    freshness: "current",
    confidence: "high",
    sourceRefs: ["knowledge/.ravo/manifest.json", "docs/ravo-v0.5.1-decision-complete-spec-zh.md"],
    derivedAt: FIXED_TIME,
    sourceUpdatedAt: FIXED_TIME,
    pmBrief: {
      schemaVersion: "1.0",
      headline: "Codex 正在完成真实浏览器验证",
      stage: "verify",
      productState: "in_progress",
      userImpact: "界面实现已经完成，但真实浏览器证据还没有补齐；你暂时不用行动。",
      actionRequired: "none",
      nextStep: "Codex 将完成桌面和移动端验证，并更新实际体验结论。",
      decisionCard: null,
      evidenceBoundary: {
        proves: ["界面实现和自动检查已经完成"],
        doesNotProve: ["尚未证明桌面和移动端的真实体验均可用"]
      },
      sourceRefs: ["knowledge/.ravo/acceptance/ui-fixture.json"]
    },
    summary: {
      lastActivityAt: FIXED_TIME,
      nextStep: "完成浏览器验收并提交 PM 截图。"
    },
    states: {
      spec: { status: "current", specPath: "docs/ravo-v0.5.1-decision-complete-spec-zh.md" },
      review: { status: "partial" },
      acceptance: { status: "pending_acceptance" },
      runtime: { status: "core_verified" }
    },
    primaryAttention: attention,
    attentionItems: [attention],
    suggestions: [{
      action: "完成浏览器验收并提交截图。",
      reason: "UI 只有经过真实浏览器检查后才能交给 PM。",
      expectedOutcome: "桌面和移动端均可巡视并完成关键操作。",
      sourceRefs: ["docs/ravo-v0.5.1-decision-complete-spec-zh.md"],
      blocking: false
    }],
    shortcutActions: [
      { kind: "continue", label: "继续这个工作区", icon: "play", lane: "Act", reason: "继续当前有界里程碑。" },
      { kind: "acceptance-gaps", label: "检查验收缺口", icon: "circle-check", lane: "Verify", reason: "仍有 Codex 与 PM 待验证项。" },
      { kind: "review", label: "发起 RAVO Review", icon: "shield-check", lane: "Verify", reason: "当前 Review coverage 仍为 partial。" },
      { kind: "runtime-status", label: "检查 RAVO 状态", icon: "server", lane: "Runtime", reason: "核对 fresh-session Runtime 证据。" }
    ],
    shortcutMenuActions: [
      { kind: "requirement-analysis", label: "分析新需求", icon: "circle-question-mark", lane: "Reason", reason: "按需进入需求共创。" },
      { kind: "root-cause", label: "分析问题根因", icon: "search", lane: "Reason", reason: "按需执行完整根因分析。" },
      { kind: "find-blockers", label: "找堵点", icon: "triangle-alert", lane: "Act", reason: "按依赖梳理阻塞。" },
      { kind: "recent-progress", label: "总结最近进展", icon: "clock-3", lane: "Act", reason: "恢复最近上下文。" },
      { kind: "capture-knowledge", label: "提取经验", icon: "file-text", lane: "Organize", reason: "只生成 workspace-local 草稿。" },
      { kind: "goal-prompt", label: "生成 Goal Prompt", icon: "circle-check", lane: "Act", reason: "先通过 Spec guard。" }
    ],
    currentGoal: "完成 RAVO v0.5.1 SoloDesk 验收。",
    specPath: "docs/ravo-v0.5.1-decision-complete-spec-zh.md",
    activeMilestone: "M5 SoloDesk UI 与响应式验收",
    roadmapAudit: ["M4 数据和 API 已完成。"],
    openDecisions: [],
    blockers: [{ id: "B-ui", title: "等待隔离浏览器复核", owner: "codex", executionStatus: "parked", attemptBudget: { used: 2, hardCeiling: 4 }, recoveryEntry: "重新运行浏览器矩阵。" }],
    executionLanes: {
      development: { milestoneRef: "M3", status: "active" },
      acceptance: { milestoneRef: "M2", baselineRef: "git-tree:ui", status: "in_progress" },
      recovery: { blockerId: "B-ui", status: "parked", workers: [] }
    },
    executionDecisions: [],
    authorizationEnvelopes: [],
    effectiveDeliveryProfile: {
      profile: "rapid",
      profileSource: "workspace",
      deadlineAt: "2026-07-10T22:00:00.000Z",
      budgets: { reviewRunBudget: 0, evidencePassBudget: 1, subagentSpawnBudget: 2, blockerAttemptBudget: 2 }
    },
    executionTiming: { calendarMinutes: 26 },
    capabilityRoutes: [{ taskClass: "routine_test", tier: "economy", enforcement: "advisory_only" }],
    pendingCodexVerification: [{
      id: "ui-browser-evidence",
      name: "真实浏览器证据",
      verificationStatus: "pending_codex",
      verificationReason: "需要桌面和移动端截图。",
      verificationTasks: [{
        id: "desktop-mobile",
        claim: "SoloDesk 在桌面和移动端均可用",
        preconditions: ["启动隔离 SoloDesk fixture"],
        steps: ["打开总览", "进入工作区详情", "打开配置、Review 和更新页面"],
        expectedResult: "无控制台错误、横向溢出或不可达操作。",
        evidenceRequired: ["桌面截图", "移动截图"],
        failureAction: "修复 UI 后重新运行。"
      }]
    }],
    pendingPmVerification: [{
      id: "pm-scanability",
      name: "30 秒定位重点",
      verificationStatus: "pending_pm",
      verificationReason: "需要 PM 判断信息密度与可扫描性。",
      verificationTasks: []
    }],
    authoritativeWorkstream: {
      id: "workstream-ui-fixture",
      module: "workstream",
      status: "active",
      relativePath: "knowledge/.ravo/workstream/ui-fixture.json",
      artifactPath: "knowledge/.ravo/workstream/ui-fixture.json",
      selectionReason: "target_lineage_latest",
      relationStatus: "matched"
    },
    selectedAcceptance: {
      id: "ui-fixture-artifact",
      module: "acceptance",
      status: "pending_acceptance",
      relativePath: "knowledge/.ravo/acceptance/ui-fixture.json",
      artifactPath: "knowledge/.ravo/acceptance/ui-fixture.json",
      selectionReason: "workstream_artifact_exact",
      relationStatus: "matched"
    },
    releaseReview: {
      artifactPath: "knowledge/.ravo/review/ui-release.json",
      status: "partial",
      selectionReason: "acceptance_explicit_review_ref",
      relationStatus: "matched"
    },
    openAnalysisReviews: [{
      analysisArtifact: "knowledge/.ravo/analysis/ui-analysis.json",
      reviewArtifact: "",
      status: "needed",
      selectionReason: "no_analysis_review",
      relationStatus: "unmatched"
    }],
    relevantKnowledge: [{ title: "UI 验收经验", applicability: "high" }],
    dataGaps: [],
    runtime: runtimeStatus(workspace),
    freshnessState: { status: "current" },
    details: {},
    lanes: {
      Reason: { status: "clear", summary: "Spec is current.", items: [{ summary: "Spec is current.", status: "clear" }], sourceRefs: [], freshness: "current", confidence: "high" },
      Act: { status: "clear", summary: "Workstream status: active.; Recent Codex Session metadata is available.", items: [], sourceRefs: [], freshness: "current", confidence: "high" },
      Verify: { status: "attention", summary: "Quick validation status: pass.; Acceptance status: pending_acceptance; pending Codex 1; pending PM 1.", items: [], sourceRefs: [], freshness: "current", confidence: "high" },
      Organize: { status: "clear", summary: "Relevant workspace knowledge is available.", items: [], sourceRefs: [], freshness: "current", confidence: "high" },
      Runtime: { status: "clear", summary: "本机核心能力已验证。任务结束状态未单独记录，不影响当前版本收口。", items: [], sourceRefs: [], freshness: "current", confidence: "medium" }
    },
    timeline: [{
      kind: "artifact",
      id: "ui-fixture-artifact",
      title: "SoloDesk UI 验收记录",
      module: "acceptance",
      status: "complete",
      relativePath: "knowledge/.ravo/acceptance/ui-fixture.json",
      updatedAt: FIXED_TIME
    }],
    artifacts: [{
      id: "ui-fixture-artifact",
      module: "acceptance",
      format: "json",
      kind: "release",
      title: "SoloDesk UI 验收记录",
      summary: "无敏感内容的 UI fixture。",
      status: "complete",
      schemaVersion: "0.5.1",
      subjectRef: "ravo-v0.5.1",
      relatedArtifact: "",
      releaseRef: "v0.5.1",
      sourceRefs: [],
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      relativePath: "knowledge/.ravo/acceptance/ui-fixture.json",
      size: 512
    }],
    sessions: [{ id: "session-ui-fixture", title: "SoloDesk UI fixture", cwd: workspace, createdAt: FIXED_TIME, updatedAt: FIXED_TIME }],
    warnings: []
  };
}

function fixtureData(workspace) {
  return {
    discoverWorkspaces: () => [{
      workspaceId: "workspace_fixture_01",
      name: "SoloDesk 验收工作区",
      displayName: "SoloDesk 验收工作区",
      canonicalPath: workspace,
      discoverySource: "root",
      ravoPresent: true,
      priority: "high",
      lifecycle: "active",
      lastIndexedAt: FIXED_TIME,
      dataStatus: "complete"
    }],
    buildDashboardIndex: () => {
      const item = fixtureWorkspace(workspace);
      return {
        workspaces: [item],
        workspaceById: new Map([[item.workspaceId, item]]),
        attention: item.attentionItems,
        metrics: {
          activeWorkspaces: 1,
          pendingCodexVerification: 1,
          pendingPmVerification: 1,
          blockers: 0,
          pausedWorkspaces: 0,
          runtimeIssues: 0
        },
        sessions: item.sessions,
        sessionDataStatus: "complete",
        warnings: [],
        generatedAt: FIXED_TIME
      };
    }
  };
}

function fixtureReview(_file, args, input, context = {}) {
  const modelKeys = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === "--model") modelKeys.push(args[index + 1]);
  const boundaryIndex = args.indexOf("--data-boundary");
  const dataBoundary = boundaryIndex >= 0 ? args[boundaryIndex + 1] : "safe_sanitized";
  if (args.includes("--preview")) {
    return {
      status: "ok",
      config: { valid: true, redactedConfigFingerprint: "sha256:ui-review" },
      callPlan: {
        configFingerprint: "sha256:ui-review",
        subjectHash: `sha256:${Buffer.from(input).toString("hex").slice(0, 64)}`,
        dataBoundary: {
          decision: dataBoundary,
          authorizationSource: "explicit_user_action",
          externalCallAllowed: dataBoundary !== "prohibited",
          redactionSummary: []
        },
        requestedPairs: modelKeys.length ? modelKeys : ["fixture/model-a"],
        fallbackPairs: [],
        modelCount: modelKeys.length || 1,
        rounds: 2,
        maxAttempts: 2,
        maximumRequests: 4,
        outputBudgets: [{ providerModelKey: modelKeys[0] || "fixture/model-a", maxTokensMode: "auto", requestedMaxTokens: null }],
        endpointStatus: (modelKeys.length ? modelKeys : ["fixture/model-a"]).map((providerModelKey) => ({ providerModelKey, credentialStatus: "configured" }))
      }
    };
  }
  const reviewRunId = args[args.indexOf("--review-run-id") + 1] || "ui-review-run";
  context.onProgress?.({
    type: "attempt",
    reviewRunId,
    providerModelKey: modelKeys[0] || "fixture/model-a",
    round: 1,
    attempt: 1,
    attemptType: "initial",
    result: "usable",
    parserStatus: "pass",
    emittedAt: FIXED_TIME
  });
  return { status: "ok", reviewRunId, workflowCoverage: "full", parserStatus: "pass", validResults: true, modelsUsable: modelKeys, artifactPath: "knowledge/.ravo/review/ui-fixture.json" };
}

function fixtureUpdates() {
  return {
    status: "update_or_repair_available",
    marketplaceStatus: "present",
    sourceType: "local",
    sourceFingerprint: "sha256:ui-source",
    runtimeFingerprint: "sha256:ui-runtime",
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
    checkedAt: FIXED_TIME,
    recoverySteps: []
  };
}

function fixtureIntegrity() {
  const snapshot = { snapshotId: "snapshot-ui", createdAt: FIXED_TIME, sourceHash: "sha256:ui-snapshot", ravoVersion: "0.5.1", pluginFingerprint: "sha256:ui-plugin", runtimeVerified: true, trustLevel: "runtime_verified", reason: "fixture" };
  return {
    getIntegrityStatus: () => ({
      configIntegrityStatus: "drift",
      status: "drift",
      currentHash: "sha256:ui-current",
      selectedSnapshotId: snapshot.snapshotId,
      selectedSnapshotTrust: snapshot.trustLevel,
      driftSections: ["marketplaces.ravo"],
      repairRequired: true,
      approvalRequired: [],
      unresolvedRequired: [],
      externalCandidates: ["marketplaces.ponytail"],
      protectedSectionCount: 12,
      snapshots: [snapshot],
      recoveryEntry: "Generate a repair preview."
    }),
    listRepairJournals: () => [{ repairId: "repair-ui", status: "partial", createdAt: FIXED_TIME, updatedAt: FIXED_TIME, managedChangeCount: 1, approvalRequiredCount: 1, runtimeProbeRequired: true }],
    createSnapshot: () => ({ status: "created", recommended: true, snapshot }),
    previewRepair: (options) => ({
      schemaVersion: "0.5.1",
      planId: "plan-ui",
      planFingerprint: "sha256:plan-ui",
      status: "changes_ready",
      currentHash: "sha256:ui-current",
      snapshotId: options.snapshotId || snapshot.snapshotId,
      snapshotTrust: "runtime_verified",
      snapshotHash: snapshot.sourceHash,
      pluginFingerprint: snapshot.pluginFingerprint,
      candidateHash: "sha256:ui-candidate",
      managedChanges: [{ section: "marketplaces.ravo", action: "add", reason: "missing_ravo_marketplace" }],
      externalPreservedChanges: (options.selectedExternalSections || []).map((section) => ({ section, action: "restore", reason: "user_selected_missing_external_registration" })),
      externalCandidates: ["marketplaces.ponytail"],
      selectedExternalSections: options.selectedExternalSections || [],
      reenablePlugins: [],
      conflicts: [],
      approvalRequired: [],
      unresolvedRequired: [],
      protectedSections: [{ section: "model_providers.custom", beforeHash: "sha256:protected", afterHash: "sha256:protected", preserved: true }],
      protectedSectionCount: 12,
      runtimeProbeRequired: true,
      expiresOn: ["current_hash_change"],
      risks: []
    }),
    applyRepair: (plan) => ({ status: "succeeded", repairId: "repair-ui", currentHashBefore: plan.currentHash, currentHashAfter: plan.candidateHash, managedChanges: plan.managedChanges, externalPreservedChanges: plan.externalPreservedChanges, conflicts: [], approvalRequired: [], unresolvedRequired: [], pluginCheck: { status: "pass", missing: [] }, runtimeStatus: { runtimeHealth: "configured_unverified" }, runtimeProbeRequired: true, journalPath: "journals/repair-ui.json", recoveryEntry: "recover repair-ui" }),
    recoverRepair: (repairId) => ({ status: "recovered", repairId, runtimeProbeRequired: true })
  };
}

async function listen(server, state) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  state.port = server.address().port;
  return `http://127.0.0.1:${state.port}/`;
}

async function navigate(page, view, heading) {
  await page.locator(`[data-action="navigate"][data-view="${view}"]`).first().evaluate((element) => element.click());
  await page.waitForFunction((text) => document.querySelector("h1")?.textContent?.includes(text), heading);
  await page.waitForTimeout(120);
}

async function capture(page, outputDir, viewportName, name) {
  const file = path.join(outputDir, `${viewportName}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled", caret: "hide", timeout: 60_000 });
  assert.ok(fs.statSync(file).size > 5_000, `${name} screenshot should contain rendered UI`);
  const result = await page.evaluate(() => {
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const missingButtonNames = [...document.querySelectorAll("button")].filter((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return false;
      return !(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent.trim());
    }).length;
    const untranslatedKickers = [...document.querySelectorAll(".section-kicker")]
      .map((element) => element.textContent.trim())
      .filter((value) => ["Attention", "Workspaces", "Provider"].includes(value));
    return {
      documentWidth,
      viewportWidth: innerWidth,
      missingButtonNames,
      untranslatedKickers,
      heading: document.querySelector("h1")?.textContent?.trim() || ""
    };
  });
  assert.ok(result.documentWidth <= result.viewportWidth + 1, `${viewportName}/${name} has horizontal page overflow`);
  assert.equal(result.missingButtonNames, 0, `${viewportName}/${name} has unnamed visible buttons`);
  assert.deepEqual(result.untranslatedKickers, [], `${viewportName}/${name} exposes untranslated section headings`);
  return { file, ...result };
}

async function runViewport(browser, url, outputDir, viewportName, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const apiBodies = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console:${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/")) apiBodies.push(response.text().catch(() => ""));
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".attention-row");
  const overviewText = await page.locator("body").textContent();
  assert.match(overviewText, /本机核心能力已验证/);
  assert.doesNotMatch(overviewText, /任务结束状态未单独记录/, "non-blocking environment diagnostics stay out of the PM overview");
  assert.doesNotMatch(overviewText, /需要重启/);
  const screenshots = [];
  screenshots.push(await capture(page, outputDir, viewportName, "overview"));

  const attentionWidths = await page.locator(".attention-row").evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().width)));
  assert.equal(new Set(attentionWidths).size, 1, `${viewportName} attention rows should have a stable width`);

  if (viewportName === "mobile") {
    await page.locator(".mobile-menu-button").click();
    await page.waitForFunction(() => document.querySelector(".sidebar")?.classList.contains("is-open"));
    await page.locator(".sidebar-scrim").click({ position: { x: 380, y: 20 } }).catch(async () => {
      await page.locator(".sidebar-scrim").evaluate((element) => element.click());
    });
  }

  await navigate(page, "workspaces", "工作区");
  await page.locator('[data-action="open-workspace"]').first().click();
  await page.waitForSelector(".workspace-detail-header h1");
  screenshots.push(await capture(page, outputDir, viewportName, "workspace-detail"));
  const summaryText = await page.locator("body").textContent();
  assert.match(summaryText, /Codex 正在完成真实浏览器验证/);
  assert.match(summaryText, /你暂时不用行动/);
  assert.doesNotMatch(summaryText, /当前并行状态|尝试 2\/4|当前执行方式/);
  await page.locator('[data-action="detail-tab"][data-tab="evidence"]').click();
  await page.waitForTimeout(100);
  const evidenceText = await page.locator("body").textContent();
  assert.match(evidenceText, /当前并行状态/);
  assert.match(evidenceText, /尝试 2\/4/);
  assert.match(evidenceText, /当前执行方式/);
  assert.match(evidenceText, /快速形成可验收候选/);
  assert.match(evidenceText, /当前环境仅提供能力档位建议/);
  assert.match(evidenceText, /目标 lineage 最新事实/);
  assert.match(evidenceText, /分析 Review/);
  screenshots.push(await capture(page, outputDir, viewportName, "workspace-evidence"));
  for (const tab of ["timeline", "actions"]) {
    await page.locator(`[data-action="detail-tab"][data-tab="${tab}"]`).click();
    await page.waitForTimeout(100);
  }
  assert.equal(await page.locator(".action-command").count(), 4, "workspace detail shows at most four primary shortcuts");
  assert.equal(await page.locator(".shortcut-more").count(), 1, "remaining shortcuts are available in a menu");
  screenshots.push(await capture(page, outputDir, viewportName, "workspace-actions"));
  await page.locator(".shortcut-more > summary").click();
  assert.ok(await page.locator(".shortcut-menu-item").count() > 0, "shortcut menu exposes secondary actions");
  screenshots.push(await capture(page, outputDir, viewportName, "shortcut-menu"));
  await page.locator(".shortcut-more > summary").click();
  await page.locator('[data-action="shortcut"]').first().click();
  await page.waitForSelector("#solodesk-dialog[open] .prompt-preview");
  assert.match(await page.locator(".prompt-preview").textContent(), /Workspace:/);
  assert.equal((await page.locator("#solodesk-dialog").textContent()).includes(FIXTURE_CREDENTIAL), false);
  await page.locator('#solodesk-dialog [data-action="dialog-close"]').first().click();

  await navigate(page, "config", "RAVO 配置");
  await page.waitForSelector('[data-role="config-form"]');
  assert.equal(await page.getByText("技术细节程度", { exact: true }).count(), 0);
  assert.equal(await page.getByText("默认沟通对象", { exact: true }).count(), 0);
  assert.match(await page.locator("body").textContent(), /配置完整性/);
  assert.match(await page.locator("body").textContent(), /RAVO 注册差异/);
  assert.match(await page.locator("body").textContent(), /当前执行方式/);
  await page.locator('[data-role="integrity-external"]').check();
  await page.locator('[data-action="integrity-preview"]').click();
  await page.waitForSelector("#solodesk-dialog[open]");
  assert.match(await page.locator("#solodesk-dialog").textContent(), /受保护 Section/);
  assert.match(await page.locator("#solodesk-dialog").textContent(), /RAVO Marketplace 缺失/);
  assert.equal((await page.locator("#solodesk-dialog").textContent()).includes(FIXTURE_CREDENTIAL), false);
  screenshots.push(await capture(page, outputDir, viewportName, "config-integrity-preview"));
  await page.locator('#solodesk-dialog [data-action="dialog-close"]').first().click();
  assert.match(await page.locator(".config-target").textContent(), /目标文件：.*ravo\.json/);
  assert.match(await page.locator(".config-target").textContent(), /来源优先级：用户级 > 内置默认/);
  if (viewportName === "mobile") {
    const navReachable = await page.locator(".settings-nav").evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      const last = element.lastElementChild?.getBoundingClientRect();
      const own = element.getBoundingClientRect();
      return Boolean(last && last.right <= own.right + 1 && last.left < own.right);
    });
    assert.equal(navReachable, true, "mobile config module navigation must remain reachable");
  }
  screenshots.push(await capture(page, outputDir, viewportName, "config"));
  await page.locator('[data-action="config-module"][data-module="review"]').first().evaluate((element) => element.click());
  await page.waitForSelector(".provider-editor");
  assert.equal(await page.locator('[data-provider-field="secretValue"]').first().inputValue(), "");
  assert.equal((await page.locator("body").textContent()).includes(FIXTURE_CREDENTIAL), false);
  await page.locator('[data-action="provider-migrate"]').click();
  const migrationValidation = page.waitForResponse((response) =>
    response.url().includes("/api/config/review/validate") && response.request().method() === "POST"
  );
  await page.locator('[data-action="config-validate"]').click();
  const migrationResponse = await migrationValidation;
  const migrationBody = await migrationResponse.json();
  assert.equal(migrationResponse.status(), 200, JSON.stringify(migrationBody));
  assert.equal(migrationBody.migrationPreview?.confirmationRequired, true, JSON.stringify(migrationBody));
  assert.equal(JSON.stringify(migrationBody).includes(FIXTURE_CREDENTIAL), false);
  await page.waitForSelector('#solodesk-dialog[open] [data-action="config-migration-confirm"]');
  assert.match(await page.locator("#solodesk-dialog").textContent(), /legacy_flat.*providers/s);
  assert.match(await page.locator("#solodesk-dialog").textContent(), /timeoutProfile/);
  assert.match(await page.locator("#solodesk-dialog").textContent(), /凭证.*保留/s);
  assert.equal((await page.locator("#solodesk-dialog").textContent()).includes(FIXTURE_CREDENTIAL), false);
  screenshots.push(await capture(page, outputDir, viewportName, "config-migration-preview"));
  await page.locator('#solodesk-dialog [data-action="dialog-close"]').first().click();

  await navigate(page, "review", "对抗式评审");
  await page.locator('textarea[name="subject"]').fill("评审一个已脱敏的 SoloDesk UI 验收方案。");
  await page.locator('[data-action="review-preview"]').click();
  await page.waitForSelector("#solodesk-dialog[open]");
  assert.match(await page.locator("#solodesk-dialog").textContent(), /最大请求数/);
  assert.equal((await page.locator("#solodesk-dialog").textContent()).includes(FIXTURE_CREDENTIAL), false);
  screenshots.push(await capture(page, outputDir, viewportName, "review-preview"));
  await page.locator('#solodesk-dialog [data-action="dialog-close"]').first().click();

  await navigate(page, "updates", "RAVO 更新");
  await page.waitForSelector(".update-table .data-table-row");
  if (viewportName === "mobile") {
    const labels = await page.locator(".update-table [data-label]").evaluateAll((elements) => elements.map((element) => getComputedStyle(element, "::before").content));
    assert.ok(labels.every((label) => label && label !== "none"), "mobile update values must expose field labels");
  }
  screenshots.push(await capture(page, outputDir, viewportName, "updates"));
  await page.locator('[data-action="update-check"]').click();
  await page.waitForSelector("#solodesk-dialog[open]");
  assert.match(await page.locator("#solodesk-dialog").textContent(), /备份并升级/);
  screenshots.push(await capture(page, outputDir, viewportName, "upgrade-preview"));
  await page.locator('#solodesk-dialog [data-action="dialog-close"]').first().click();

  await page.waitForTimeout(100);
  const bodies = await Promise.all(apiBodies);
  assert.equal(bodies.some((body) => body.includes(FIXTURE_CREDENTIAL)), false, "browser API responses must not expose Review credentials");
  assert.deepEqual(errors, [], `${viewportName} browser console/page errors`);
  await page.close();
  return { viewportName, viewport, errors, screenshots };
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

async function runServiceUnavailableRecovery(browser, url, outputDir, server) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let offline = false;
  await page.route("**/api/**", (route) => offline ? route.abort("connectionrefused") : route.continue());
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".attention-row");
  await closeServer(server);
  offline = true;
  await page.locator('[data-action="navigate"][data-view="config"]').first().evaluate((element) => element.click());
  await page.waitForSelector(".error-state");
  const message = await page.locator(".error-state").textContent();
  assert.match(message, /SoloDesk 服务已停止或地址已变化/);
  assert.match(message, /ravo-solodesk open/);
  const screenshot = await capture(page, outputDir, "desktop", "service-unavailable-recovery");
  await page.close();
  return { status: "pass", message: message.trim(), screenshot };
}

async function main() {
  const playwright = loadPlaywright();
  const executablePath = chromeExecutable(playwright);
  if (!playwright || !executablePath) {
    const result = { status: "skipped", reason: !playwright ? "playwright_unavailable" : "browser_unavailable" };
    if (process.env.RAVO_UI_TEST_REQUIRED === "1") throw new Error(result.reason);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-dashboard-ui-")));
  const home = path.join(tempRoot, "home");
  const workspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "knowledge", ".ravo"), { recursive: true });
  writeJson(path.join(workspace, "knowledge", ".ravo", "manifest.json"), { schemaVersion: "0.5.0", modules: {} });
  writeJson(path.join(home, ".codex", "skill-config", "ravo.json"), { schemaVersion: "0.5.0", technicalDetailLevel: 1, audience: "engineering" });
  const fixtureReviewConfig = {
    rounds: 2,
    maxAttempts: 2,
    apiMode: "fake",
    apiBase: "fake://fixture",
    models: "model-a,model-b"
  };
  fixtureReviewConfig["api" + "Key"] = FIXTURE_CREDENTIAL;
  writeJson(path.join(home, ".codex", "skill-config", "ravo-review.json"), fixtureReviewConfig);

  const outputDir = path.resolve(argument("--output-dir", path.join(tempRoot, "screenshots")));
  fs.mkdirSync(outputDir, { recursive: true });
  const { state, server } = createSoloDesk({
    home,
    cwd: workspace,
    workspaceRoots: [workspace],
    data: fixtureData(workspace),
    coreStatus: { buildStatus: runtimeStatus },
    executeReview: fixtureReview,
    checkUpdates: fixtureUpdates,
    configIntegrity: fixtureIntegrity(),
    tokenTtlMs: 60_000
  });
  await state.refresh("ui_test_startup");
  const url = await listen(server, state);
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  try {
    const viewports = [];
    viewports.push(await runViewport(browser, url, outputDir, "desktop", { width: 1440, height: 900 }));
    viewports.push(await runViewport(browser, url, outputDir, "mobile", { width: 390, height: 844 }));
    const serviceUnavailableRecovery = await runServiceUnavailableRecovery(browser, url, outputDir, server);
    console.log(JSON.stringify({
      status: "pass",
      browser: executablePath,
      outputDir,
      viewports,
      serviceUnavailableRecovery,
      checks: [
        "real-http-static-ui",
        "desktop-mobile-responsive",
        "core-runtime-and-terminal-telemetry-language",
        "stable-attention-width",
        "workspace-detail-tabs",
        "lineage-selection-reasons",
        "shortcut-preview",
        "config-module-reachability",
        "config-integrity-preview",
        "config-migration-preview",
        "review-preview",
        "upgrade-preview",
        "service-stop-address-change-recovery",
        "secret-not-in-browser",
        "no-console-errors",
        "no-horizontal-page-overflow",
        "visible-button-accessible-names",
        "localized-section-headings"
      ]
    }, null, 2));
  } finally {
    await browser.close();
    await closeServer(server);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
