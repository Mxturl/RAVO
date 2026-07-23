#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePluginScript } = require("./ravo-plugin-resolver");

const MAX_PROMPT_CHARS = 1200;
const KNOWLEDGE_ACTIONS = new Set([
  "continue",
  "requirement-analysis",
  "root-cause",
  "find-blockers",
  "acceptance-gaps",
  "review",
  "goal-prompt"
]);
const CATALOG = Object.freeze({
  continue: {
    label: "继续这个工作区",
    icon: "play",
    lane: "Act",
    objective: "基于当前 Spec、里程碑、阻塞和证据缺口继续最小的有界行动。",
    expected: "执行或提出下一个有界行动，并列出剩余 required 项与证据缺口。",
    terms: ["继续", "里程碑", "workstream", "next step", "推进"]
  },
  "requirement-analysis": {
    label: "分析新需求",
    icon: "circle-question-mark",
    lane: "Reason",
    objective: "与用户共同补齐背景、现状、场景、消费者、痛点、参考对象、盲区判断和建议。",
    expected: "形成可推导的需求结论，并明确继续澄清或直接进入方案阶段。",
    terms: ["需求", "分析", "产品", "消费者", "场景", "blind spot"]
  },
  "root-cause": {
    label: "分析问题根因",
    icon: "search",
    lane: "Reason",
    objective: "对当前问题或挑战执行完整机制级根因分析，必要时引入多模型评审。",
    expected: "给出症状、近因、机制根因、替代假设、反证、修复与验证。",
    terms: ["根因", "问题", "故障", "机制", "root cause"]
  },
  "find-blockers": {
    label: "找堵点",
    icon: "triangle-alert",
    lane: "Act",
    objective: "检查当前里程碑、Roadmap Audit、阻塞和证据链，定位最先需要解除的堵点。",
    expected: "按影响和依赖排序堵点，给出恢复入口和下一步。",
    terms: ["阻塞", "堵点", "roadmap", "依赖", "blocker"]
  },
  "acceptance-gaps": {
    label: "检查验收缺口",
    icon: "circle-check",
    lane: "Verify",
    objective: "区分需求满足程度、Codex 补证和 PM 验收，核对当前 Acceptance 与 workstream 的绑定。",
    expected: "生成具体待验证项、责任人、步骤、预期结果和证据要求。",
    terms: ["验收", "证据", "acceptance", "verification", "release readiness"]
  },
  review: {
    label: "独立检查高风险结论",
    icon: "shield-check",
    lane: "Verify",
    objective: "在三态数据边界与调用预览后，对当前高影响对象发起可审计的多模型评审。",
    expected: "返回真实响应、usable 结果、Issue Ledger、coverage、失败与重试证据。",
    terms: ["review", "评审", "对抗", "provider"]
  },
  "recent-progress": {
    label: "查看最近进展",
    icon: "clock-3",
    lane: "Act",
    objective: "依据最近 artifact、Session 和 Roadmap Audit 总结已完成、变化和剩余工作。",
    expected: "形成可供下一任务使用的简短进展摘要，不夸大完成状态。",
    terms: ["进展", "最近", "总结", "session", "milestone"]
  },
  "capture-knowledge": {
    label: "沉淀可复用经验",
    icon: "file-text",
    lane: "Organize",
    objective: "判断本次工作是否产生可复用经验，只生成 workspace-local capture 草稿。",
    expected: "有价值时给出脱敏草稿、适用条件和来源；无价值时保持静默。",
    terms: ["经验", "知识", "复用", "lesson", "knowledge"]
  },
  "goal-prompt": {
    label: "启动已确认工作",
    icon: "circle-check",
    lane: "Act",
    objective: "仅在 decision-complete 且当前的 Spec 上生成可运行 Goal Prompt。",
    expected: "Spec 当前时返回 Goal Prompt；缺失或过期时只给维护动作，不绕过 guard。",
    terms: ["goal", "spec", "里程碑", "长期", "交付"]
  },
  "runtime-status": {
    label: "检查本机环境",
    icon: "server",
    lane: "Runtime",
    objective: "检查 marketplace、插件、版本、Hook trust、probe、manifest 和配置状态。",
    expected: "给出证据支持的本机环境状态、对使用的影响和恢复入口。",
    terms: ["runtime", "状态", "hook", "plugin", "marketplace"]
  },
  "initialize-ravo": {
    label: "为工作区启用 RAVO",
    icon: "plus",
    lane: "Runtime",
    objective: "为没有 RAVO 数据的工作区生成可审阅的初始化 Prompt 和命令。",
    expected: "只提供初始化计划，不自动安装插件或修改项目。",
    terms: ["初始化", "ravo", "manifest", "安装"]
  }
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function merge(base, override) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
      ? merge(out[key], value)
      : value;
  }
  return out;
}

function readConfig(workspace, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const defaults = {
    globalKnowledge: { enabled: false, path: "~/.codex/ravo/knowledge", requireRedaction: true }
  };
  const config = merge(
    merge(defaults, readJson(path.join(home, ".codex", "skill-config", "ravo.json")) || {}),
    readJson(path.join(workspace, "knowledge", ".ravo", "config.json")) || {}
  );
  delete config.technicalDetailLevel;
  delete config.audience;
  return config;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function normalizeRef(workspace, value) {
  if (typeof value !== "string" || !value.trim()) return "";
  if (!path.isAbsolute(value)) return value.trim();
  const relative = path.relative(workspace, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.split(path.sep).join("/") : value.trim();
}

function normalizeRefs(workspace, values) {
  return unique((values || []).map((value) => normalizeRef(workspace, value)));
}

function bounded(values, limit = 5) {
  return Array.isArray(values) ? values.slice(0, limit) : [];
}

function normalizedStatus(workspace, key, fallback = "unknown") {
  return workspace?.states?.[key]?.status || fallback;
}

function runtimeHealth(workspace) {
  return normalizedStatus(workspace, "runtime", workspace?.runtime?.runtimeHealth || "unknown");
}

function loadGoalModule(options = {}) {
  if (options.goalModule) return options.goalModule;
  const script = resolvePluginScript("ravo-core", "scripts/ravo-goal-prompt.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.corePluginRoot,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  return script ? require(script) : null;
}

function loadKnowledgeModule(options = {}) {
  if (options.knowledgeModule) return options.knowledgeModule;
  const script = resolvePluginScript("ravo-knowledge", "scripts/retrieve-knowledge.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.knowledgePluginRoot,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  return script ? require(script) : null;
}

function specHealth(workspace, options = {}) {
  const module = loadGoalModule(options);
  if (!module?.checkSpecHealth) {
    return {
      status: normalizedStatus(workspace, "spec"),
      specPath: workspace.specPath || "",
      staleInputs: [],
      checkedAt: "",
      error: "Spec guard entry is unavailable."
    };
  }
  return module.checkSpecHealth(workspace.canonicalPath, workspace.specPath || "");
}

function tokenize(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((term) => term.length > 1);
}

function knowledgeQuery(workspace, kind) {
  const definition = CATALOG[kind] || {};
  return unique([
    definition.label,
    ...(definition.terms || []),
    workspace.currentGoal,
    workspace.activeMilestone,
    workspace.primaryAttention?.title,
    workspace.primaryAttention?.reason,
    workspace.summary?.nextStep
  ]).join(" ");
}

function isApplicable(match, kind) {
  const applicability = Array.isArray(match.applicability) ? match.applicability : [];
  if (!applicability.length) return false;
  const haystack = `${applicability.join(" ")} ${match.summary || ""}`.toLowerCase();
  const terms = unique([...(CATALOG[kind]?.terms || []), ...tokenize(CATALOG[kind]?.label)]).map((term) => term.toLowerCase());
  return terms.some((term) => haystack.includes(term));
}

function knowledgeStaleness(match, now = Date.now()) {
  const updated = Date.parse(match.updatedAt || "");
  if (!Number.isFinite(updated)) return "unknown";
  return now - updated > 90 * 86400000 ? "possibly_stale" : "current";
}

function userKnowledgeDir(config, home) {
  const configured = config.globalKnowledge?.path;
  if (typeof configured === "string" && configured.startsWith("~/")) return path.join(home, configured.slice(2));
  return path.join(home, ".codex", "ravo", "knowledge");
}

function retrieveForAction(workspace, kind, options = {}) {
  if (!KNOWLEDGE_ACTIONS.has(kind)) return { retrievedCount: 0, applied: [], includeUser: false, recordUse: false };
  const config = options.config || readConfig(workspace.canonicalPath, options);
  const boundary = options.dataBoundary || "local_prompt_only";
  const includeUser = config.globalKnowledge?.enabled === true
    && boundary !== "prohibited"
    && (kind !== "review" || boundary === "safe_sanitized");
  const module = loadKnowledgeModule(options);
  if (!module?.retrieveKnowledge) return { retrievedCount: 0, applied: [], includeUser, recordUse: false, unavailable: true };
  const query = knowledgeQuery(workspace, kind);
  const result = module.retrieveKnowledge({
    workspace: workspace.canonicalPath,
    query,
    config,
    includeUser,
    recordUse: false,
    userKnowledgeDir: userKnowledgeDir(config, path.resolve(options.home || os.homedir())),
    now: options.now ? new Date(options.now).toISOString() : undefined
  });
  const currentTime = options.now ? new Date(options.now).getTime() : Date.now();
  const seen = new Set();
  const applied = (result.matches || [])
    .filter((match) => isApplicable(match, kind))
    .filter((match) => {
      const key = match.path || `${match.scope}:${match.summary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((match) => ({
      path: match.path,
      scope: match.scope || "workspace",
      summary: match.summary || match.content || "",
      applicability: match.applicability || [],
      staleness: knowledgeStaleness(match, currentTime)
    }));
  return {
    retrievedCount: (result.matches || []).length,
    applied,
    includeUser,
    recordUse: false
  };
}

function requestedAction(workspace, health) {
  if (["paused", "archived"].includes(workspace.lifecycle)) return "先评估是否恢复该工作区；不要直接继续实现。";
  if (health.status !== "current") return "先补齐本轮目标、范围和验收方式；确认前不要开始实现。";
  const runtime = runtimeHealth(workspace);
  if (!["healthy", "core_verified"].includes(runtime)) return "Codex 先恢复本机实际使用环境并通过真实任务验证。";
  if ((workspace.blockers || []).length) return "Codex 先按恢复路径处理当前阻塞，再继续本轮工作。";
  if ((workspace.pendingCodexVerification || []).length) return "Codex 先完成仍可自动执行的验证并补齐真实证据。";
  return workspace.pmBrief?.nextStep || workspace.suggestions?.[0]?.action || workspace.summary?.nextStep || "Codex 将检查当前证据并继续下一步。";
}

function attentionText(workspace) {
  const item = workspace.primaryAttention || {};
  const labels = {
    runtime: "本机实际使用环境尚未验证。",
    review: "独立复核覆盖不完整。",
    analysis_review: "高影响分析存在独立复核缺口。",
    analysis: "需求分析仍有未决项。",
    acceptance_unmatched: "当前工作没有匹配的验收证据。",
    acceptance_stale: "验收证据已过期。",
    pending_codex: "Codex 仍需补证。",
    pending_pm: "等待你的产品体验判断。",
    blocker: "当前工作存在阻塞。",
    spec: "本轮目标、范围或验收方式需要维护。",
    data: "RAVO 产品记录不完整。",
    quick_validation: "快速验证未通过。",
    stale_workstream: "当前工作已经停滞。",
    not_ready: "验收仍未就绪。"
  };
  return labels[item.category] || item.reason || item.title || workspace.summary?.headline || "当前没有高优先级关注项";
}

function buildContinuationBrief(workspace, options = {}) {
  const config = options.config || readConfig(workspace.canonicalPath, options);
  const health = specHealth(workspace, options);
  const knowledge = retrieveForAction(workspace, "continue", { ...options, config });
  const recentActivity = [
    ...(workspace.timeline || []).map((item) => ({ type: "artifact", id: item.id, title: item.title || item.id, updatedAt: item.updatedAt || item.createdAt || "", sourceRef: item.relativePath || "" })),
    ...(workspace.sessions || []).map((item) => ({ type: "session", id: item.id, title: item.title || item.id, updatedAt: item.updatedAt || item.createdAt || "", sourceRef: `session:${item.id}` }))
  ].sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)).slice(0, 8);
  return {
    workspace: workspace.canonicalPath,
    pmBrief: workspace.pmBrief || null,
    currentGoal: workspace.currentGoal || "",
    decisionCompleteSpec: health.specPath || workspace.specPath || "",
    specHealth: health.status,
    staleInputs: health.staleInputs || [],
    activeMilestone: workspace.activeMilestone || "",
    roadmapAudit: bounded(workspace.roadmapAudit, 5),
    openDecisions: bounded(workspace.openDecisions, 5),
    blockers: bounded(workspace.blockers, 5),
    executionLanes: workspace.executionLanes || {},
    executionDecisions: bounded(workspace.executionDecisions, 5),
    authorizationEnvelopes: bounded(workspace.authorizationEnvelopes, 3),
    pendingCodexVerification: bounded(workspace.pendingCodexVerification, 5),
    pendingPmVerification: bounded(workspace.pendingPmVerification, 5),
    recentActivity,
    relevantKnowledge: knowledge.applied,
    knowledgeRetrievedCount: knowledge.retrievedCount,
    knowledgeAppliedCount: knowledge.applied.length,
    knowledgeRecordUse: false,
    runtimeHealth: runtimeHealth(workspace),
    sourceRefs: normalizeRefs(workspace.canonicalPath, workspace.sourceRefs).slice(0, 20),
    dataGaps: unique(workspace.dataGaps).slice(0, 10),
    requestedAction: requestedAction(workspace, health),
    evidenceBoundary: workspace.pmBrief?.evidenceBoundary || {
      proves: ["已汇总当前本地证据"],
      doesNotProve: ["尚未覆盖的实际体验、外部复核和发布状态仍需各自证据"]
    },
    lifecycle: workspace.lifecycle || "active",
    freshness: workspace.freshness || "unknown",
    confidence: workspace.confidence || "low",
    dataBoundary: options.dataBoundary || "local_prompt_only"
  };
}

function summarizeItems(items, label) {
  if (!Array.isArray(items) || !items.length) return "";
  return `${label}: ${items.slice(0, 3).map((item) => item.name || item.title || item.id || String(item)).join("；")}`;
}

function promptLines(workspace, kind, brief, knowledge, options = {}) {
  const definition = CATALOG[kind];
  const attention = attentionText(workspace);
  const pm = brief.pmBrief || {};
  const sourceRefs = unique(brief.sourceRefs).slice(0, 6);
  const essential = [
    `工作区: ${brief.workspace}`,
    `产品目标: ${brief.currentGoal || definition.objective}`,
    `当前结论: ${pm.headline || workspace.summary?.headline || attention}`,
    `对用户的影响: ${pm.userImpact || "现有产品和使用环境保持不变。"}`,
    `是否需要产品经理: ${pm.actionRequired && pm.actionRequired !== "none" ? "需要，请按决策卡处理" : "不需要，Codex 继续"}`,
    `下一步: ${pm.nextStep || brief.requestedAction}`,
    `本轮范围: ${brief.specHealth === "current" ? "已经确认" : "仍需补齐"}${brief.decisionCompleteSpec ? `（依据：${brief.decisionCompleteSpec}）` : ""}`,
    `本机环境: ${["healthy", "core_verified"].includes(brief.runtimeHealth) ? "可以使用" : "仍待恢复或验证"}`,
    sourceRefs.length ? `Source refs: ${sourceRefs.join("；")}` : "Source refs: 不完整，请先补齐来源再做高风险结论。",
    options.extraInstruction ? `给 Codex 的执行要求: ${options.extraInstruction}` : "",
    "沟通要求: 面向产品经理先说明产品结果、实际可用程度、影响、是否需要参与和下一步；内部实现细节按需展开。",
    `期望输出: ${definition.expected}`,
    `验收边界: 已证明=${(brief.evidenceBoundary?.proves || []).join("；")}；尚未证明=${(brief.evidenceBoundary?.doesNotProve || []).join("；")}`
  ].filter(Boolean);
  const optional = [
    brief.requestedAction ? `Codex 建议动作: ${brief.requestedAction}` : "",
    summarizeItems(brief.blockers, "当前阻塞"),
    summarizeItems(brief.pendingCodexVerification, "Codex 待补证"),
    summarizeItems(brief.pendingPmVerification, "PM 待验收"),
    brief.roadmapAudit.length ? `最近 Roadmap Audit: ${brief.roadmapAudit.join("；")}` : "",
    knowledge.applied.length ? `已应用知识: ${knowledge.applied.map((item) => `${item.summary} [${item.staleness}] (${item.path})`).join("；")}` : "",
    knowledge.applied.length && knowledge.retrievedCount > knowledge.applied.length
      ? `知识筛选: 已应用 ${knowledge.applied.length} 条；其余 ${knowledge.retrievedCount - knowledge.applied.length} 条与当前动作不适用。`
      : ""
  ].filter(Boolean);
  return { essential, optional };
}

function boundedPrompt(essential, optional) {
  const mandatoryTail = essential.slice(-3);
  const head = essential.slice(0, -3);
  let selected = optional.slice();
  let prompt = [...head, ...selected, ...mandatoryTail].join("\n");
  while (prompt.length > MAX_PROMPT_CHARS && selected.length) {
    selected.pop();
    prompt = [...head, ...selected, ...mandatoryTail].join("\n");
  }
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const compact = [...head, ...mandatoryTail].map((line) => line.length > 150 ? `${line.slice(0, 147)}...` : line).join("\n");
  if (compact.length <= MAX_PROMPT_CHARS) return compact;
  const tail = mandatoryTail.map((line) => line.length > 150 ? `${line.slice(0, 147)}...` : line).join("\n");
  const suffix = "其余内容请按 Source refs 核对。";
  const available = Math.max(0, MAX_PROMPT_CHARS - tail.length - suffix.length - 2);
  const compactHead = head.map((line) => line.length > 150 ? `${line.slice(0, 147)}...` : line).join("\n");
  return `${compactHead.slice(0, available)}\n${tail}\n${suffix}`;
}

function goalPromptResult(workspace, brief, options = {}) {
  const module = loadGoalModule(options);
  if (brief.specHealth !== "current" || !brief.decisionCompleteSpec || !module?.goalPrompt) {
    return {
      blocked: true,
      guard: {
        status: brief.specHealth,
        specPath: brief.decisionCompleteSpec,
        staleInputs: brief.staleInputs
      },
      instruction: "先补齐并确认本轮目标、范围和验收方式；当前不得启动执行。"
    };
  }
  return {
    blocked: false,
    guard: { status: "current", specPath: brief.decisionCompleteSpec, staleInputs: [] },
    goalPrompt: module.goalPrompt(
      workspace.canonicalPath,
      path.isAbsolute(brief.decisionCompleteSpec)
        ? path.relative(workspace.canonicalPath, brief.decisionCompleteSpec) || brief.decisionCompleteSpec
        : brief.decisionCompleteSpec
    )
  };
}

function buildShortcut(workspace, kind, options = {}) {
  if (!CATALOG[kind]) throw new Error(`Unsupported shortcut kind: ${kind}`);
  const config = options.config || readConfig(workspace.canonicalPath, options);
  const brief = buildContinuationBrief(workspace, { ...options, config });
  const knowledge = kind === "continue"
    ? { retrievedCount: brief.knowledgeRetrievedCount, applied: brief.relevantKnowledge, includeUser: brief.relevantKnowledge.some((item) => item.scope === "user"), recordUse: false }
    : retrieveForAction(workspace, kind, { ...options, config });
  let blocked = false;
  let guard = null;
  let extraInstruction = "";

  if (kind === "continue") extraInstruction = `按当前产品结论继续：${brief.requestedAction}`;
  if (kind === "requirement-analysis") extraInstruction = "先进行需求共创并给出盲区判断与建议；允许用户选择继续澄清或直接进入方案。";
  if (kind === "root-cause") extraInstruction = "任何问题或挑战都完成整套根因分析；复杂结论优先引入 RAVO Review。";
  if (kind === "find-blockers") extraInstruction = "调用 RAVO Execution Gate；按 attempt fingerprint 阻断无变化重试，记录 required、executionStatus、owner、预算、依赖影响、恢复入口和 continuationAllowed。";
  if (kind === "acceptance-gaps") extraInstruction = "输出 Codex 补证清单和 PM 验收清单，不使用“基本满足”替代待验证说明。";
  if (kind === "review") extraInstruction = "先完成 safe_sanitized / sensitive_requires_consent / prohibited 判断和调用预览；配置存在不等于授权外发。";
  if (kind === "recent-progress") extraInstruction = "只依据 artifact 与 Session 元数据总结，不把里程碑完成表述为版本完成。";
  if (kind === "capture-knowledge") extraInstruction = "只生成 workspace-local capture 草稿；不自动写用户级全局知识。没有实际价值时不提示空知识。";
  if (kind === "runtime-status") extraInstruction = "复用 ravo-status，状态语言必须区分 healthy、configured_unverified、degraded、missing 和 error。";
  if (kind === "initialize-ravo") {
    blocked = workspace.dataStatus !== "no_ravo_data";
    extraInstruction = blocked
      ? "当前工作区已有 RAVO 数据，不执行初始化；先检查现有 manifest 和 Runtime。"
      : "只生成可审阅的 ravo-init/插件安装步骤，不自动执行。";
  }

  let generatedGoal = null;
  if (kind === "goal-prompt") {
    generatedGoal = goalPromptResult(workspace, brief, options);
    blocked = generatedGoal.blocked;
    guard = generatedGoal.guard;
    extraInstruction = generatedGoal.blocked ? generatedGoal.instruction : generatedGoal.goalPrompt;
  }

  let prompt;
  if (kind === "goal-prompt" && generatedGoal && !generatedGoal.blocked) {
    const goalRefs = unique([
      ...brief.sourceRefs,
      ...knowledge.applied.map((item) => item.path)
    ]).map((value) => {
      if (!path.isAbsolute(value)) return value;
      const relative = path.relative(brief.workspace, value);
      return relative && !relative.startsWith("..") ? relative : value;
    }).slice(0, 6);
    const goalContext = [
      `当前结论: ${brief.pmBrief?.headline || attentionText(workspace)}；对用户的影响=${brief.pmBrief?.userImpact || "现有产品保持不变"}；本机环境=${["healthy", "core_verified"].includes(brief.runtimeHealth) ? "可以使用" : "仍待验证"}`,
      knowledge.applied.length ? `知识: 已应用 ${knowledge.applied.length} 条（${unique(knowledge.applied.map((item) => item.staleness)).join("/")}）；其余 ${Math.max(0, knowledge.retrievedCount - knowledge.applied.length)} 条不适用。` : "",
      `Source refs: ${goalRefs.join("；") || brief.decisionCompleteSpec}`,
      ...generatedGoal.goalPrompt.split("\n"),
      "验收边界: 自动检查通过不等于实际体验通过、独立复核完成、产品验收通过或已经发布。"
    ].filter(Boolean);
    prompt = boundedPrompt(goalContext, []);
  } else {
    const lines = promptLines(workspace, kind, brief, knowledge, { extraInstruction });
    prompt = boundedPrompt(lines.essential, lines.optional);
  }
  return {
    kind,
    label: CATALOG[kind].label,
    lane: CATALOG[kind].lane,
    workspaceId: workspace.workspaceId,
    prompt,
    blocked,
    guard,
    continuation: kind === "continue" ? brief : undefined,
    pmBrief: brief.pmBrief,
    sourceRefs: brief.sourceRefs,
    dataGaps: brief.dataGaps,
    dataBoundary: brief.dataBoundary,
    knowledge: {
      retrievedCount: knowledge.retrievedCount,
      appliedCount: knowledge.applied.length,
      includeUser: knowledge.includeUser,
      recordUse: false,
      refs: knowledge.applied.map((item) => item.path)
    },
    promptLength: prompt.length
  };
}

function action(kind, reason) {
  const definition = CATALOG[kind];
  return { kind, label: definition.label, icon: definition.icon, lane: definition.lane, reason };
}

function selectShortcutActions(workspace) {
  const primary = [];
  const add = (kind, reason) => {
    if (!CATALOG[kind] || primary.some((item) => item.kind === kind)) return;
    primary.push(action(kind, reason));
  };
  const runtime = runtimeHealth(workspace);
  const spec = normalizedStatus(workspace, "spec");
  const review = normalizedStatus(workspace, "review", workspace.reviewStatus || "unknown");
  if (workspace.dataStatus === "no_ravo_data") add("initialize-ravo", "当前工作区尚未初始化 RAVO 数据。" );
  if (!["healthy", "core_verified"].includes(runtime)) add("runtime-status", "本机实际使用环境仍待恢复或验证。");
  if (spec !== "current") {
    add("requirement-analysis", "本轮目标、范围或验收方式需要先补齐。" );
    add("goal-prompt", "确认本轮产品范围后才能启动执行。" );
  }
  if ((workspace.blockers || []).length) add("find-blockers", "当前工作存在明确阻塞。" );
  if ((workspace.pendingCodexVerification || []).length || (workspace.pendingPmVerification || []).length || ["stale", "unknown"].includes(workspace.states?.acceptance?.freshness)) {
    add("acceptance-gaps", "当前仍有自动验证、产品体验或证据时效缺口。" );
  }
  if (["needed", "partial", "unavailable", "stale"].includes(review)) add("review", "当前高影响结论缺少完整独立复核。" );
  if (workspace.lifecycle === "active" && spec === "current" && ["healthy", "core_verified"].includes(runtime)) add("continue", workspace.pmBrief?.nextStep || workspace.summary?.nextStep || "继续当前已确认工作。" );
  if (workspace.attentionItems?.some((item) => item.category === "analysis")) add("requirement-analysis", "需求分析仍有未决项。" );
  if (workspace.lifecycle !== "archived") add("recent-progress", "根据最近产品记录和任务进展恢复上下文。" );
  for (const fallback of ["continue", "acceptance-gaps", "requirement-analysis", "runtime-status"]) {
    if (primary.length >= 4) break;
    add(fallback, "基于当前证据生成。" );
  }
  const visiblePrimary = primary.slice(0, 4);
  const hiddenKinds = new Set(visiblePrimary.map((item) => item.kind));
  const secondary = Object.keys(CATALOG)
    .filter((kind) => kind !== "initialize-ravo" || workspace.dataStatus === "no_ravo_data")
    .filter((kind) => !hiddenKinds.has(kind))
    .map((kind) => action(kind, "可从更多指令中按需生成。"));
  return { primary: visiblePrimary, secondary };
}

module.exports = {
  CATALOG,
  MAX_PROMPT_CHARS,
  buildContinuationBrief,
  buildShortcut,
  readConfig,
  retrieveForAction,
  selectShortcutActions,
  specHealth
};
