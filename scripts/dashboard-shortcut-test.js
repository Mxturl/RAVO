#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CATALOG,
  MAX_PROMPT_CHARS,
  buildContinuationBrief,
  buildShortcut,
  retrieveForAction,
  selectShortcutActions
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-shortcuts");

const goalModule = require("../plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt");
const knowledgeModule = require("../plugins/ravo/modules/ravo-knowledge/scripts/retrieve-knowledge");
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-shortcuts-")));
const home = path.join(temp, "home");
const workspace = path.join(temp, "workspace");
const workspaceKnowledge = path.join(workspace, "knowledge", ".ravo", "knowledge");
const userKnowledge = path.join(home, ".codex", "ravo", "knowledge");
const NOW = "2026-07-10T20:00:00.000Z";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function mtimes(root) {
  const result = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else result[path.relative(root, file)] = fs.statSync(file).mtimeMs;
    }
  };
  walk(root);
  return result;
}

function baseWorkspace(overrides = {}) {
  return {
    workspaceId: "workspace_shortcut_01",
    canonicalPath: workspace,
    displayName: "Shortcut Fixture",
    lifecycle: "active",
    dataStatus: "complete",
    deliveryStatus: "in_progress",
    reviewStatus: "partial",
    currentGoal: "完成 RAVO v0.5.1 真实验收与证据闭环。",
    specPath: "docs/ravo-v0.5.1-decision-complete-spec-zh.md",
    activeMilestone: "M6 Continuation Knowledge 快捷指令",
    roadmapAudit: ["M5 UI 已通过真实浏览器验证。"],
    openDecisions: [{ id: "decision-1", name: "是否进入真实 E2E" }],
    blockers: [{ id: "blocker-1", name: "缺少 fresh-session probe" }],
    pendingCodexVerification: [{ id: "codex-1", name: "创建真实 Codex Session" }],
    pendingPmVerification: [{ id: "pm-1", name: "确认 30 秒可扫描性" }],
    timeline: [{ id: "artifact-1", title: "M5 证据", updatedAt: "2026-07-10T19:00:00.000Z", relativePath: "knowledge/m5.md" }],
    sessions: [{ id: "session-1", title: "M5 UI", updatedAt: "2026-07-10T19:30:00.000Z" }],
    sourceRefs: [
      "docs/ravo-v0.5.1-decision-complete-spec-zh.md",
      "knowledge/.ravo/workstream/current.json",
      "knowledge/.ravo/acceptance/current.json"
    ],
    dataGaps: ["runtime:configured_unverified"],
    freshness: "current",
    confidence: "medium",
    summary: { nextStep: "完成 Knowledge 无写入和真实 Session 验证。", headline: "缺少 fresh-session probe" },
    suggestions: [{ action: "完成 Knowledge 无写入和真实 Session 验证。", reason: "M6 required 尚未闭环。" }],
    primaryAttention: { category: "pending_codex", title: "Codex 仍需补证", reason: "缺少真实 Session 和 fresh-session probe。" },
    attentionItems: [{ category: "analysis" }],
    states: {
      spec: { status: "current" },
      review: { status: "partial" },
      acceptance: { status: "pending_acceptance", freshness: "current" },
      runtime: { status: "healthy" }
    },
    runtime: { runtimeHealth: "healthy" },
    ...overrides
  };
}

try {
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  const specPath = path.join(workspace, "docs", "ravo-v0.5.1-decision-complete-spec-zh.md");
  write(specPath, `# Fixture Spec

Status: decision-complete

## Product Definition

完成快捷指令。

## Module Contracts

Continuation and Knowledge.

## Trigger Rules

按用户动作生成。

## Validation Matrix

真实验证。

## Assumptions

本地数据可用。
`);
  const oldTime = new Date("2026-07-09T00:00:00.000Z");
  fs.utimesSync(specPath, oldTime, oldTime);

  writeJson(path.join(home, ".codex", "skill-config", "ravo.json"), {
    technicalDetailLevel: 1,
    globalKnowledge: { enabled: true, path: "~/.codex/ravo/knowledge", requireRedaction: true }
  });
  writeJson(path.join(workspaceKnowledge, "continue.json"), {
    id: "knowledge-continue",
    kind: "lesson",
    scope: "workspace",
    summary: "里程碑交接必须保留证据缺口。",
    content: "继续工作时先读取 Roadmap Audit、blocker 和验收缺口。",
    applicability: ["继续 里程碑 workstream next step"],
    updatedAt: "2026-07-10T18:00:00.000Z",
    lastUsedAt: ""
  });
  writeJson(path.join(workspaceKnowledge, "acceptance.json"), {
    id: "knowledge-acceptance",
    kind: "lesson",
    scope: "workspace",
    summary: "验收必须区分实现和验证。",
    content: "PM 验收需要具体步骤和真实响应。",
    applicability: ["验收 acceptance verification release readiness"],
    updatedAt: "2026-07-10T18:10:00.000Z",
    lastUsedAt: ""
  });
  writeJson(path.join(workspaceKnowledge, "unrelated.json"), {
    id: "knowledge-unrelated",
    kind: "lesson",
    scope: "workspace",
    summary: "数据库分片经验。",
    content: "数据库分片只适合高吞吐写入。",
    applicability: ["database sharding"],
    updatedAt: "2026-07-10T18:20:00.000Z",
    lastUsedAt: ""
  });
  writeJson(path.join(userKnowledge, "requirement.json"), {
    id: "knowledge-user-requirement",
    kind: "lesson",
    scope: "user",
    summary: "需求分析先确认真实消费者。",
    content: "产品需求需要背景、场景、消费者和盲区判断。",
    applicability: ["需求 分析 产品 消费者 场景 blind spot"],
    sensitivity: "redacted",
    updatedAt: "2026-07-10T18:30:00.000Z",
    lastUsedAt: ""
  });

  const beforeWorkspace = mtimes(workspaceKnowledge);
  const beforeUser = mtimes(userKnowledge);
  const options = { home, goalModule, knowledgeModule, now: NOW };
  const workspaceState = baseWorkspace();

  const directRead = knowledgeModule.retrieveKnowledge({
    workspace,
    query: "继续 里程碑",
    config: { technicalDetailLevel: 1, globalKnowledge: { enabled: true } },
    includeUser: true,
    recordUse: false,
    userKnowledgeDir: userKnowledge,
    now: NOW
  });
  assert.equal(directRead.recordUse, false);
  assert.equal(Object.hasOwn(directRead, "technicalDetailLevel"), false);
  assert.equal(Object.hasOwn(directRead, "outputMode"), false);
  assert.deepEqual(mtimes(workspaceKnowledge), beforeWorkspace, "record-use false keeps workspace knowledge mtimes unchanged");
  assert.deepEqual(mtimes(userKnowledge), beforeUser, "record-use false keeps user knowledge mtimes unchanged");

  const brief = buildContinuationBrief(workspaceState, options);
  assert.equal(brief.specHealth, "current");
  assert.equal(Object.hasOwn(brief, "technicalDetailLevel"), false);
  assert.equal(Object.hasOwn(brief, "outputMode"), false);
  assert.equal(brief.knowledgeRecordUse, false);
  assert.ok(brief.relevantKnowledge.some((item) => item.path.endsWith("continue.json")));
  assert.equal(brief.relevantKnowledge.some((item) => item.path.endsWith("unrelated.json")), false);
  assert.ok(brief.blockers.length > 0);
  assert.ok(brief.pendingCodexVerification.length > 0);
  assert.ok(brief.sourceRefs.length > 0);

  const kinds = Object.keys(CATALOG);
  assert.equal(kinds.length, 11, "v0.5 exposes all 11 required shortcuts");
  for (const kind of kinds) {
    const result = buildShortcut(workspaceState, kind, options);
    assert.ok(result.prompt.length > 0, `${kind} returns a prompt`);
    assert.ok(result.promptLength <= MAX_PROMPT_CHARS, `${kind} stays within the prompt bound`);
    assert.match(result.prompt, /工作区[:：]/, `${kind} includes workspace`);
    assert.match(result.prompt, /Source refs:/, `${kind} includes source refs`);
    assert.match(result.prompt, /验收边界:/, `${kind} includes evidence boundary`);
    assert.equal(result.knowledge.recordUse, false, `${kind} knowledge retrieval is read-only`);
  }

  const currentGoal = buildShortcut(workspaceState, "goal-prompt", options);
  assert.equal(currentGoal.blocked, false);
  assert.equal(currentGoal.guard.status, "current");
  assert.match(currentGoal.prompt, /严格按照/);

  const requirement = buildShortcut(workspaceState, "requirement-analysis", options);
  assert.equal(requirement.knowledge.includeUser, true);
  assert.ok(requirement.knowledge.refs.some((file) => file.endsWith("requirement.json")), "enabled user knowledge is applied when applicability matches");
  const reviewLocal = buildShortcut(workspaceState, "review", options);
  assert.equal(reviewLocal.knowledge.includeUser, false, "Review shortcut does not include user knowledge without safe_sanitized boundary");
  assert.equal(reviewLocal.knowledge.appliedCount, 0, "Review does not reuse knowledge whose applicability only matches Goal or acceptance work");
  assert.equal(new Set(reviewLocal.knowledge.refs).size, reviewLocal.knowledge.refs.length, "knowledge refs are deduplicated");
  const reviewSafe = buildShortcut(workspaceState, "review", { ...options, dataBoundary: "safe_sanitized" });
  assert.equal(reviewSafe.knowledge.includeUser, true, "safe_sanitized Review may retrieve enabled user knowledge");

  const disabledUser = retrieveForAction(workspaceState, "requirement-analysis", {
    ...options,
    config: { technicalDetailLevel: 1, globalKnowledge: { enabled: false } }
  });
  assert.equal(disabledUser.includeUser, false);
  assert.equal(disabledUser.applied.some((item) => item.scope === "user"), false);

  const actions = selectShortcutActions(workspaceState);
  assert.ok(actions.primary.length <= 4);
  assert.ok(actions.primary.some((item) => item.kind === "acceptance-gaps"));
  assert.ok(actions.primary.some((item) => item.kind === "review"));
  assert.equal(actions.primary.some((item) => item.kind === "initialize-ravo"), false);
  assert.ok(actions.secondary.length > 0);

  const noRavo = baseWorkspace({ dataStatus: "no_ravo_data", sourceRefs: [], states: { ...workspaceState.states, spec: { status: "missing" } } });
  const noRavoActions = selectShortcutActions(noRavo);
  assert.equal(noRavoActions.primary[0].kind, "initialize-ravo");
  assert.equal(buildShortcut(noRavo, "initialize-ravo", options).blocked, false);
  assert.equal(buildShortcut(workspaceState, "initialize-ravo", options).blocked, true);

  const pausedBrief = buildContinuationBrief(baseWorkspace({ lifecycle: "paused" }), options);
  assert.match(pausedBrief.requestedAction, /评估是否恢复/);
  const degradedBrief = buildContinuationBrief(baseWorkspace({ states: { ...workspaceState.states, runtime: { status: "degraded" } }, runtime: { runtimeHealth: "degraded" }, blockers: [], pendingCodexVerification: [] }), options);
  assert.match(degradedBrief.requestedAction, /本机实际使用环境/);

  const delta = path.join(workspace, "docs", "new-spec-delta.md");
  write(delta, "# New Spec Delta\n\nStatus: candidate\n");
  const newer = new Date("2026-07-10T19:59:00.000Z");
  fs.utimesSync(delta, newer, newer);
  const staleBrief = buildContinuationBrief(workspaceState, options);
  assert.equal(staleBrief.specHealth, "stale");
  assert.match(staleBrief.requestedAction, /补齐本轮目标、范围和验收方式/);
  const staleGoal = buildShortcut(workspaceState, "goal-prompt", options);
  assert.equal(staleGoal.blocked, true);
  assert.equal(staleGoal.guard.status, "stale");
  assert.match(staleGoal.prompt, /先补齐并确认本轮目标、范围和验收方式/);
  assert.doesNotMatch(staleGoal.prompt, /完成全部开发、验证、文档和验收工作/);

  assert.deepEqual(mtimes(workspaceKnowledge), beforeWorkspace, "Dashboard shortcut generation never updates workspace knowledge mtimes");
  assert.deepEqual(mtimes(userKnowledge), beforeUser, "Dashboard shortcut generation never updates user knowledge mtimes");

  console.log(JSON.stringify({
    status: "pass",
    shortcutCount: kinds.length,
    promptLimit: MAX_PROMPT_CHARS,
    checks: [
      "record-use-false-mtime",
      "continuation-required-fields",
      "technical-detail-level-1",
      "11-shortcut-catalog",
      "1200-character-bound",
      "goal-current-and-stale-guard",
      "workspace-user-applicability",
      "review-data-boundary",
      "dynamic-primary-actions",
      "initialize-only-no-ravo-data",
      "paused-runtime-spec-priority"
    ]
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
