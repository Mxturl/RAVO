#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  createKnowledge,
  createWorkItem,
  getKnowledge,
  getWorkItem,
  pmWorkItemProjection,
  pathsFor,
  readWorkItems,
  rebuildKnowledgeIndex,
  rebuildWorkItemIndex,
  updateKnowledge,
  updateWorkItem
} = require("../../ravo-core/scripts/ravo-record-store");
const { buildPmBrief } = require("../../ravo-core/scripts/ravo-pm-brief");

const LIMIT_MAX = 1000;
const SORT_FIELDS = new Set(["updatedAt", "createdAt", "priority", "title"]);
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const INACTIVE_DECISIONS = new Set(["deferred", "rejected", "duplicate", "closed"]);
const DEFAULT_KNOWLEDGE_STATUSES = new Set(["active", "candidate", "needs_review"]);
const SCENARIO_ID = "next_version_candidates";
const SCENARIO_STATUS_RANK = { locked: 0, approved: 1, candidate: 2, needs_triage: 3 };

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeLimit(value, fallback = 100) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(LIMIT_MAX, number)) : fallback;
}

function safeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(0, Math.min(1000000, number)) : 0;
}

function matches(item, query) {
  const needle = text(query).toLocaleLowerCase();
  if (!needle) return true;
  return [item.id, item.title, item.summary, item.description, item.sourceType, ...(item.tags || []), ...(item.sourceRefs || [])]
    .join(" ").toLocaleLowerCase().includes(needle);
}

function compare(left, right, field, direction) {
  if (field === "priority") {
    const delta = (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9);
    return direction === "asc" ? delta : -delta;
  }
  const a = field === "title" ? String(left.title || "") : String(left[field] || "");
  const b = field === "title" ? String(right.title || "") : String(right[field] || "");
  const delta = a.localeCompare(b, "zh-CN");
  return direction === "asc" ? delta : -delta;
}

function workItemSummary(item) {
  return {
    id: item.id,
    legacyIds: item.legacyIds || [],
    itemType: item.itemType,
    title: item.title,
    summary: item.summary,
    product: item.product,
    module: item.module,
    tags: item.tags || [],
    sourceType: item.sourceType,
    sourceRefs: item.sourceRefs || [],
    confirmationStatus: item.confirmationStatus,
    decisionStatus: item.decisionStatus,
    deliveryStatus: item.deliveryStatus,
    pmAcceptanceStatus: item.pmAcceptanceStatus,
    releaseStatus: item.releaseStatus,
    priority: item.priority,
    candidateVersions: item.candidateVersions || [],
    committedVersion: item.committedVersion,
    releaseSlice: item.releaseSlice,
    deferredToVersion: item.deferredToVersion,
    scopeClass: item.scopeClass,
    owner: item.owner,
    blockerStatus: item.blockerStatus,
    estimatedTokens: item.estimatedTokens,
    actualTokens: item.actualTokens,
    actualAgentActiveMinutes: item.actualAgentActiveMinutes,
    actualCalendarMinutes: item.actualCalendarMinutes,
    nextAction: item.nextAction,
    nextActionOwner: item.nextActionOwner,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revision: item.revision
  };
}

function normalizeFilters(filters = {}) {
  return {
    q: text(filters.q),
    status: text(filters.status),
    itemType: text(filters.itemType),
    priority: text(filters.priority),
    version: text(filters.version),
    sort: SORT_FIELDS.has(filters.sort) ? filters.sort : "updatedAt",
    direction: filters.direction === "asc" ? "asc" : "desc",
    view: filters.view === "agent" ? "agent" : "pm",
    limit: safeLimit(filters.limit),
    offset: safeOffset(filters.offset)
  };
}

function listWorkItems(workspace, filters = {}) {
  const normalized = normalizeFilters(filters);
  const entries = readWorkItems(workspace)
    .filter((item) => matches(item, normalized.q))
    .filter((item) => normalized.view === "agent" || normalized.status || (!INACTIVE_DECISIONS.has(item.decisionStatus) && item.scopeClass !== "out_of_scope"))
    .filter((item) => !normalized.status || [item.decisionStatus, item.deliveryStatus, item.pmAcceptanceStatus, item.releaseStatus, item.scopeClass].includes(normalized.status))
    .filter((item) => !normalized.itemType || item.itemType === normalized.itemType)
    .filter((item) => !normalized.priority || item.priority === normalized.priority)
    .filter((item) => !normalized.version || [item.committedVersion, item.releaseSlice, item.deferredToVersion, ...(item.candidateVersions || [])].includes(normalized.version))
    .sort((a, b) => compare(a, b, normalized.sort, normalized.direction) || String(b.id).localeCompare(String(a.id)));
  const total = entries.length;
  return {
    kind: "requirements",
    filters: normalized,
    total,
    offset: normalized.offset,
    limit: normalized.limit,
    entries: entries.slice(normalized.offset, normalized.offset + normalized.limit)
      .map(normalized.view === "agent" ? workItemSummary : pmWorkItemProjection)
  };
}

function readKnowledgeEntries(workspace) {
  let index = null;
  try { index = JSON.parse(fs.readFileSync(pathsFor(workspace).knowledgeIndex, "utf8")); } catch (_error) { index = null; }
  if (!index || !Array.isArray(index.entries)) index = rebuildKnowledgeIndex(workspace);
  return index.entries.map((entry) => ({ ...entry }));
}

function listKnowledge(workspace, filters = {}) {
  const normalized = normalizeFilters(filters);
  const entries = readKnowledgeEntries(workspace)
    .filter((item) => matches(item, normalized.q))
    .filter((item) => normalized.view === "agent" || normalized.status || DEFAULT_KNOWLEDGE_STATUSES.has(item.status || "active"))
    .filter((item) => !normalized.status || item.status === normalized.status)
    .sort((a, b) => compare(a, b, normalized.sort, normalized.direction) || String(b.id).localeCompare(String(a.id)));
  const total = entries.length;
  return {
    kind: "knowledge",
    filters: normalized,
    total,
    offset: normalized.offset,
    limit: normalized.limit,
    entries: entries.slice(normalized.offset, normalized.offset + normalized.limit)
  };
}

function listPool(workspace, kind, filters = {}) {
  if (kind === "requirements") return listWorkItems(workspace, filters);
  if (kind === "knowledge") return listKnowledge(workspace, filters);
  throw new Error("pool_kind_invalid");
}

function getPoolRecord(workspace, kind, id, options = {}) {
  if (kind === "requirements") {
    const item = getWorkItem(workspace, id);
    return options.view === "agent" || !item ? item : pmWorkItemProjection(item);
  }
  if (kind === "knowledge") return getKnowledge(workspace, id);
  throw new Error("pool_kind_invalid");
}

function history(workspace, id) {
  const file = path.join(pathsFor(workspace).events, `${id}.jsonl`);
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (_error) {
    return [];
  }
}

function createPoolRecord(workspace, kind, input, options = {}) {
  if (kind === "requirements") return createWorkItem(workspace, input, { ...options, stage: "capture" });
  if (kind === "knowledge") return createKnowledge(workspace, { ...input, status: input.status || "candidate" }, options);
  throw new Error("pool_kind_invalid");
}

function updatePoolRecord(workspace, kind, id, patch, options = {}) {
  if (kind === "requirements") return updateWorkItem(workspace, id, patch, { ...options, stage: options.stage || "capture" });
  if (kind === "knowledge") return updateKnowledge(workspace, id, patch, options);
  throw new Error("pool_kind_invalid");
}

function mergeWorkItems(workspace, sourceId, targetId, options = {}) {
  if (sourceId === targetId) throw new Error("merge_same_item");
  const source = getWorkItem(workspace, sourceId);
  const target = getWorkItem(workspace, targetId);
  if (!source || !target) throw new Error("merge_item_not_found");
  const sourceRefs = [...new Set([...(target.sourceRefs || []), ...(source.sourceRefs || [])])];
  const related = [...new Set([...(target.relatedItemIds || []), source.id, ...(source.relatedItemIds || [])])];
  const targetResult = updateWorkItem(workspace, target.id, {
    sourceRefs,
    relatedItemIds: related,
    summary: target.summary || source.summary,
    description: target.description || source.description,
    nextAction: target.nextAction || source.nextAction
  }, { ...options, expectedRevision: options.targetRevision ?? target.revision });
  const sourceResult = updateWorkItem(workspace, source.id, {
    decisionStatus: "duplicate",
    decisionReason: `已合并到 ${target.id}`,
    decisionOwner: options.actor || "ravo",
    decisionAt: new Date().toISOString(),
    deliveryStatus: "stopped",
    relatedItemIds: [...new Set([...(source.relatedItemIds || []), target.id])],
    followUpIds: [...new Set([...(source.followUpIds || []), target.id])],
    nextAction: `改为跟踪 ${target.id}`,
    nextActionOwner: "pm"
  }, { ...options, expectedRevision: options.sourceRevision ?? source.revision });
  return { target: targetResult.item, source: sourceResult.item };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  return match ? `v${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : "";
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).slice(1).split(".").map(Number);
  const b = normalizeVersion(right).slice(1).split(".").map(Number);
  if (a.length !== 3 || b.length !== 3) return null;
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function versionFromText(value) {
  const match = String(value || "").match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/i);
  return match ? normalizeVersion(match[1]) : "";
}

function localProductVersion(options = {}) {
  const explicit = normalizeVersion(options.productVersion);
  if (explicit) return explicit;
  const manifest = readJson(path.resolve(__dirname, "../../..", ".codex-plugin", "plugin.json"));
  return normalizeVersion(manifest?.version) || "v0.0.0";
}

function relevantVersions(item) {
  return [...new Set([
    normalizeVersion(item.committedVersion),
    versionFromText(item.releaseSlice),
    ...(item.candidateVersions || []).map(normalizeVersion)
  ].filter(Boolean))];
}

function scenarioEligible(item) {
  return !INACTIVE_DECISIONS.has(item.decisionStatus)
    && item.scopeClass !== "out_of_scope"
    && item.releaseStatus !== "released";
}

function decisionCompleteSpecVersions(workspace, productVersion, items) {
  const docs = path.join(workspace, "docs");
  let files = [];
  try { files = fs.readdirSync(docs).filter((name) => /decision-complete-spec.*\.md$|decision-complete.*spec.*\.md$/i.test(name)); } catch (_error) { return []; }
  return [...new Set(files.map((name) => {
    const text = fs.readFileSync(path.join(docs, name), "utf8");
    if (!/^\s*(?:Status|状态)\s*[：:]\s*decision-complete\s*$/im.test(text)) return "";
    const version = versionFromText(name) || versionFromText(text.split(/\r?\n/, 4).join(" "));
    if (!version || compareVersions(version, productVersion) <= 0) return "";
    const released = items.some((item) => item.releaseStatus === "released" && [item.actualReleaseVersion, item.committedVersion].map(normalizeVersion).includes(version));
    return released ? "" : version;
  }).filter(Boolean))].sort((a, b) => compareVersions(a, b));
}

function versionChoiceResult(options, reason) {
  const versionOptions = [...new Set(options.map(normalizeVersion).filter(Boolean))].sort((a, b) => compareVersions(a, b));
  const decisionOptions = versionOptions.length >= 2
    ? versionOptions.map((version) => ({ id: version, label: version, outcome: `只查看 ${version} 的结构化候选。` }))
    : [
      { id: "specify", label: "指定版本", outcome: "提供一个三段语义版本后读取候选。" },
      { id: "wait", label: "暂不查看", outcome: "保持当前数据不变，稍后再查询。" }
    ];
  return {
    schemaVersion: "0.6.2",
    scenario: SCENARIO_ID,
    status: "needs_version_choice",
    targetVersion: null,
    versionOptions,
    summary: { total: 0, locked: 0, candidates: 0, needsConfirmation: 0 },
    sections: [],
    chat: { total: 0, shown: 0, remaining: 0, items: [] },
    pmBrief: buildPmBrief({
      headline: "需要先确定目标版本",
      stage: "align",
      productState: "awaiting_pm",
      userImpact: reason,
      actionRequired: "choose_option",
      nextStep: "PM 只需选择一个要查看的语义版本。",
      decisionCard: {
        question: "要查看哪个版本的候选需求？",
        whyNow: "当前数据无法唯一确定目标版本，继续猜测会混淆候选与已锁定范围。",
        recommendation: versionOptions.length ? "选择当前正在规划的最近版本。" : "先指定正在规划的三段语义版本。",
        options: decisionOptions,
        waitingImpact: "暂不决定不会改变任何候选或当前 Release Slice。"
      },
      evidenceBoundary: { proves: ["当前数据无法唯一确定目标版本"], doesNotProve: ["RAVO 未猜测版本或候选内容"] },
      sourceRefs: ["knowledge/.ravo/pool/index.json"]
    }),
    evidenceBoundary: { proves: ["当前数据无法唯一确定目标版本"], doesNotProve: ["RAVO 未猜测版本或候选内容"] }
  };
}

function resolveTargetVersion(workspace, items, options = {}) {
  if (options.version !== undefined && String(options.version).trim()) {
    const explicit = normalizeVersion(options.version);
    return explicit ? { status: "ok", version: explicit, options: [] } : { status: "choice", version: "", options: [], reason: "给出的版本不是合法的三段语义版本。" };
  }
  const productVersion = localProductVersion(options);
  const specVersions = decisionCompleteSpecVersions(workspace, productVersion, items);
  if (specVersions.length === 1) return { status: "ok", version: specVersions[0], options: specVersions };
  const itemVersions = [...new Set(items.filter(scenarioEligible).flatMap(relevantVersions).filter((version) => compareVersions(version, productVersion) > 0))].sort((a, b) => compareVersions(a, b));
  if (itemVersions.length === 1) return { status: "ok", version: itemVersions[0], options: itemVersions };
  const choices = [...new Set([...specVersions, ...itemVersions])].sort((a, b) => compareVersions(a, b));
  return { status: "choice", version: "", options: choices, reason: choices.length ? "当前存在多个可能的下一版本，RAVO 不会自行猜测。" : "当前没有唯一、可验证的下一版本来源。" };
}

function scenarioItem(item, group) {
  const versionStatus = group === "locked" ? "locked" : group === "needsConfirmation" ? "needs_triage" : item.decisionStatus === "approved" ? "approved" : "candidate";
  return {
    typeLabel: ["bug", "hotfix", "environment"].includes(item.itemType) ? "问题" : "需求",
    title: item.title,
    userImpact: item.userValue || item.expectedOutcome || item.painPoint || item.summary || "待补充用户价值或影响。",
    priority: item.priority || "P2",
    versionStatus,
    versionStatusLabel: ({ locked: "已锁定", approved: "已批准候选", candidate: "候选", needs_triage: "待确认" })[versionStatus],
    nextStep: item.nextAction || "Codex 将补齐下一步。",
    owner: item.nextActionOwner || item.owner || "codex"
  };
}

function chatText(version, items, total) {
  const lines = items.map((item, index) => `${index + 1}. [${item.priority}][${item.versionStatusLabel}][${item.typeLabel}] ${item.title} - ${item.userImpact}；下一步：${item.nextStep}（${item.owner}）`);
  if (total > items.length) lines.push(`其余 ${total - items.length} 项可继续查看或在 SoloDesk 中筛选。`);
  lines.push("候选不等于 Release Slice，只有已锁定项属于当前承诺范围。");
  return `${version} 当前 ${total} 项：\n${lines.join("\n")}`;
}

function unavailableScenario(reason) {
  return {
    schemaVersion: "0.6.2",
    scenario: SCENARIO_ID,
    status: "unavailable",
    targetVersion: null,
    summary: { total: 0, locked: 0, candidates: 0, needsConfirmation: 0 },
    sections: [],
    chat: { total: 0, shown: 0, remaining: 0, items: [] },
    pmBrief: buildPmBrief({
      headline: "下一版本候选暂不可读取",
      stage: "operate",
      productState: "blocked",
      userImpact: reason,
      actionRequired: "none",
      nextStep: "Codex 修复本地候选数据后重新读取。",
      decisionCard: null,
      evidenceBoundary: { proves: ["候选数据源当前不可验证"], doesNotProve: ["空结果不代表没有候选"] },
      sourceRefs: ["knowledge/.ravo/manifest.json"]
    }),
    evidenceBoundary: { proves: ["候选数据源当前不可验证"], doesNotProve: ["空结果不代表没有候选"] }
  };
}

function nextVersionCandidates(workspace, options = {}) {
  const root = path.resolve(workspace);
  const manifest = readJson(path.join(root, "knowledge", ".ravo", "manifest.json"));
  const index = readJson(path.join(root, "knowledge", ".ravo", "pool", "index.json"));
  if (!manifest?.modules?.pool?.enabled || !Array.isArray(index?.entries)) return unavailableScenario("workspace 的 Pool 或 manifest 不可读，不能把数据缺口当作空列表。");
  const items = readWorkItems(root);
  const target = resolveTargetVersion(root, items, options);
  if (target.status !== "ok") return versionChoiceResult(target.options, target.reason);
  const classified = items.filter(scenarioEligible).map((item) => {
    const versions = relevantVersions(item);
    if (!versions.includes(target.version)) return null;
    const locked = normalizeVersion(item.committedVersion) === target.version || versionFromText(item.releaseSlice) === target.version;
    const group = locked ? "locked"
      : item.confirmationStatus === "needs_triage" || item.decisionStatus === "needs_triage" ? "needsConfirmation"
        : (item.candidateVersions || []).map(normalizeVersion).includes(target.version) && ["candidate", "approved"].includes(item.decisionStatus) ? "candidates" : "";
    return group ? { item, group, projection: scenarioItem(item, group) } : null;
  }).filter(Boolean).sort((left, right) => {
    const priority = (PRIORITY_RANK[left.item.priority] ?? 9) - (PRIORITY_RANK[right.item.priority] ?? 9);
    if (priority) return priority;
    const status = SCENARIO_STATUS_RANK[left.projection.versionStatus] - SCENARIO_STATUS_RANK[right.projection.versionStatus];
    if (status) return status;
    const updated = String(right.item.updatedAt || "").localeCompare(String(left.item.updatedAt || ""));
    return updated || String(left.item.id).localeCompare(String(right.item.id));
  });
  const groups = {
    locked: classified.filter((entry) => entry.group === "locked").map((entry) => entry.projection),
    candidates: classified.filter((entry) => entry.group === "candidates").map((entry) => entry.projection),
    needsConfirmation: classified.filter((entry) => entry.group === "needsConfirmation").map((entry) => entry.projection)
  };
  const total = classified.length;
  const chatItems = classified.slice(0, 10).map((entry) => entry.projection);
  return {
    schemaVersion: "0.6.2",
    scenario: SCENARIO_ID,
    status: total ? "ok" : "empty",
    targetVersion: target.version,
    summary: { total, locked: groups.locked.length, candidates: groups.candidates.length, needsConfirmation: groups.needsConfirmation.length },
    sections: [
      { key: "locked", label: "已锁定", items: groups.locked },
      { key: "candidates", label: "候选", items: groups.candidates },
      { key: "needsConfirmation", label: "待确认", items: groups.needsConfirmation }
    ],
    chat: { total, shown: chatItems.length, remaining: Math.max(0, total - chatItems.length), items: chatItems, text: chatText(target.version, chatItems, total) },
    pmBrief: buildPmBrief({
      headline: `${target.version} 当前 ${total} 项`,
      stage: "align",
      productState: groups.needsConfirmation.length ? "awaiting_pm" : "planned",
      userImpact: total ? `其中 ${groups.locked.length} 项已锁定、${groups.candidates.length} 项仍是候选、${groups.needsConfirmation.length} 项待确认。` : "当前结构化 Pool 中没有该版本的有效候选。",
      actionRequired: groups.needsConfirmation.length ? "clarify_scope" : "none",
      nextStep: groups.needsConfirmation.length ? "PM 只需判断待确认项是否保留。" : total ? "Codex 继续执行已锁定范围，候选项保持不自动晋级。" : "Codex 继续维护 Pool；无需为制造列表而新增候选。",
      decisionCard: groups.needsConfirmation.length ? {
        question: `是否现在处理 ${groups.needsConfirmation.length} 项待确认候选？`,
        whyNow: "这些内容来自推断，确认前不会进入有效候选或版本承诺。",
        recommendation: "只确认真实存在且值得后续对齐的候选。",
        options: [
          { id: "triage", label: "现在确认", outcome: "逐项决定保留或拒绝，不改变当前 Release Slice。" },
          { id: "later", label: "稍后处理", outcome: "保留待确认状态，当前已锁定工作继续。" }
        ],
        waitingImpact: "暂不决定不会阻塞当前已锁定范围。"
      } : null,
      evidenceBoundary: { proves: ["结果来自当前工作区的结构化候选记录", "候选、锁定和待确认状态已分开"], doesNotProve: ["候选不等于 Release Slice", "列表不证明实现、验收或发布"] },
      sourceRefs: ["knowledge/.ravo/pool/index.json"]
    }),
    evidenceBoundary: { proves: ["结果来自当前 workspace 的结构化 Pool", "候选、锁定和待确认状态已分开"], doesNotProve: ["候选不等于 Release Slice", "列表不证明实现、验收或发布"] }
  };
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  const scenario = argValue("--scenario", "");
  if (scenario !== SCENARIO_ID) {
    console.log(JSON.stringify(unavailableScenario(`Unsupported scenario: ${scenario || "missing"}`), null, 2));
    return;
  }
  const result = nextVersionCandidates(path.resolve(argValue("--workspace", process.cwd())), {
    version: argValue("--version", ""),
    productVersion: argValue("--product-version", "")
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = {
  LIMIT_MAX,
  listPool,
  getPoolRecord,
  history,
  pmWorkItemProjection,
  createPoolRecord,
  updatePoolRecord,
  mergeWorkItems,
  normalizeVersion,
  resolveTargetVersion,
  nextVersionCandidates
};
