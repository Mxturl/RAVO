#!/usr/bin/env node

const path = require("node:path");
const {
  createWorkItem,
  getWorkItem,
  readWorkItems,
  updateWorkItem
} = require("./ravo-record-store");
const { buildPmBrief } = require("./ravo-pm-brief");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values.map((value) => value.trim()).filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function normalizedTitle(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function capturePmBrief(item, inferred, deduplicated = false) {
  const subject = ["bug", "hotfix", "environment"].includes(item.itemType) ? "问题" : "需求";
  if (!inferred) return buildPmBrief({
    headline: deduplicated ? `已合并相同${subject}来源：${item.title}` : `已记录候选${subject}：${item.title}`,
    stage: "capture",
    productState: "planned",
    userImpact: `${subject}已显性保留为候选，不会自动扩大当前任务或进入 Release Slice。`,
    actionRequired: "none",
    nextStep: item.nextAction || "Codex 在后续版本规划时继续对齐范围和验收方式。",
    decisionCard: null,
    evidenceBoundary: {
      proves: [deduplicated ? `已合并${subject}来源` : `已记录${subject}内容、最小分析和来源`],
      doesNotProve: ["候选不代表已批准、已承诺版本或已实现"]
    },
    sourceRefs: item.sourceRefs
  });
  return buildPmBrief({
    headline: `发现待确认${subject}：${item.title}`,
    stage: "capture",
    productState: "awaiting_pm",
    userImpact: "这项内容来自 Codex 的推断，确认前不会进入产品实现。",
    actionRequired: "clarify_scope",
    nextStep: "请决定保留并继续对齐，或拒绝这项推断。",
    decisionCard: {
      question: `是否保留这项推断${subject}并进入对齐？`,
      whyNow: `这项${subject}不是你的直接指令，需要先确认是否真实存在。`,
      recommendation: "只有符合真实产品问题时才保留。",
      options: [
        { id: "keep", label: "保留并对齐", outcome: "补充场景、价值、范围和验收方式。" },
        { id: "reject", label: "不保留", outcome: "记录拒绝原因，不进入实现。" }
      ],
      waitingImpact: "暂不决定不会影响当前产品，这项需求会留在待确认状态。"
    },
    evidenceBoundary: {
      proves: [`已记录${subject}内容和来源`],
      doesNotProve: ["尚不代表需求已批准、已排期或已实现"]
    },
    sourceRefs: item.sourceRefs
  });
}

function normalizeDecision(value) {
  return ({ accept: "approved", accepted: "approved", approve: "approved", approved: "approved", reject: "rejected", rejected: "rejected", defer: "deferred", deferred: "deferred", duplicate: "duplicate", close: "closed", closed: "closed" })[String(value || "").toLowerCase()] || "";
}

function defaultDecisionReason(status) {
  return ({
    approved: "PM 已接受当前方向，尚未自动承诺版本或 Release Slice",
    rejected: "PM 当前不采纳，未提供进一步原因",
    deferred: "PM 决定延期，未提供进一步原因",
    duplicate: "该记录与现有候选重复",
    closed: "该记录已关闭，无需继续跟踪"
  })[status] || "";
}

function decisionNext(status, deferredToVersion = "") {
  if (status === "approved") return { action: "Codex 在进入版本前完成需求对齐和范围冻结。", owner: "codex" };
  if (status === "rejected") return { action: "仅在出现新事实时重新评估。", owner: "codex" };
  if (status === "deferred") return { action: deferredToVersion ? `在 ${deferredToVersion} 规划时重新评估。` : "后续版本规划时重新评估。", owner: "codex" };
  if (status === "duplicate") return { action: "继续跟踪合并后的目标记录。", owner: "codex" };
  return { action: "无需继续跟踪。", owner: "codex" };
}

function decide(workspace) {
  const id = argValue("--id", "").trim();
  const status = normalizeDecision(argValue("--decision", ""));
  const sourceRefs = argValues("--source-ref");
  if (!id || !status || !sourceRefs.length) fail("Pool decision requires --id, a supported --decision, and at least one --source-ref.");
  const current = getWorkItem(workspace, id);
  if (!current) fail("Pool decision target was not found.");
  const expected = Number(argValue("--expected-revision", String(current.revision)));
  if (!Number.isInteger(expected) || expected < 1) fail("--expected-revision must be a positive integer.");
  const deferredToVersion = argValue("--deferred-to-version", "").trim();
  const duplicateOf = argValue("--duplicate-of", "").trim();
  if (status === "duplicate" && !duplicateOf) fail("A duplicate decision requires --duplicate-of.");
  const next = decisionNext(status, deferredToVersion);
  const candidateVersions = [...new Set([...(current.candidateVersions || []), ...argValues("--candidate-version")])];
  const result = updateWorkItem(workspace, id, {
    confirmationStatus: "confirmed",
    decisionStatus: status,
    decisionReason: argValue("--reason", "").trim() || (duplicateOf ? `已合并到 ${duplicateOf}` : defaultDecisionReason(status)),
    decisionOwner: argValue("--owner", "pm").trim() || "pm",
    decisionAt: argValue("--at", "").trim() || new Date().toISOString(),
    sourceRefs: [...new Set([...(current.sourceRefs || []), ...sourceRefs])],
    candidateVersions,
    ...(deferredToVersion ? { deferredToVersion } : {}),
    ...(duplicateOf ? {
      relatedItemIds: [...new Set([...(current.relatedItemIds || []), duplicateOf])],
      followUpIds: [...new Set([...(current.followUpIds || []), duplicateOf])]
    } : {}),
    nextAction: argValue("--next-action", "").trim() || next.action,
    nextActionOwner: argValue("--next-action-owner", "").trim() || next.owner
  }, { actor: "pool-decision", expectedRevision: expected });
  console.log(JSON.stringify({
    status: "decided",
    item: result.item,
    pmBrief: buildPmBrief({
      headline: `候选已${({ approved: "接受", rejected: "拒绝", deferred: "延期", duplicate: "合并", closed: "关闭" })[status]}`,
      stage: "align",
      productState: status === "approved" || status === "deferred" || status === "duplicate" ? "planned" : "unknown",
      userImpact: "决定、理由、责任人、时间和来源已保留；版本候选仍不等于 Release Slice。",
      actionRequired: "none",
      nextStep: result.item.nextAction,
      decisionCard: null,
      evidenceBoundary: { proves: ["当前候选决定已留痕"], doesNotProve: ["未自动承诺版本、实现或发布"] },
      sourceRefs: result.item.sourceRefs
    })
  }, null, 2));
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  if (argValue("--decision", "")) {
    decide(workspace);
    return;
  }
  const kind = argValue("--kind", "requirement");
  if (!["requirement", "issue"].includes(kind)) fail("--kind must be requirement or issue.");
  const title = argValue("--title", "").trim();
  const description = argValue("--description", argValue("--content", "")).trim();
  const summary = argValue("--summary", title).trim() || title;
  const sourceExcerpt = argValue("--source-excerpt", "").trim();
  const sourceRefs = argValues("--source-ref");
  if (!title || !description || !sourceRefs.length) fail("Pool capture requires --title, --description and at least one --source-ref.");
  const inferred = argValue("--inferred", "false") === "true";
  const itemType = kind === "issue" ? "bug" : argValue("--item-type", "feature");
  const stableId = argValue("--record-id", "").trim();
  const legacyIds = argValues("--legacy-id");
  const existing = readWorkItems(workspace).find((item) => item.decisionStatus !== "closed" && (
    (stableId && item.id === stableId)
    || legacyIds.some((id) => (item.legacyIds || []).includes(id))
    || (item.itemType === itemType && normalizedTitle(item.title) === normalizedTitle(title))
  ));
  if (existing) {
    const mergedRefs = [...new Set([...(existing.sourceRefs || []), ...sourceRefs])];
    const patch = {
      sourceRefs: mergedRefs,
      confirmationStatus: inferred ? existing.confirmationStatus : "confirmed",
      decisionStatus: !inferred && existing.decisionStatus === "needs_triage" ? "candidate" : existing.decisionStatus,
      nextAction: existing.nextAction || "PM 梳理需求背景、场景、价值和版本归属。"
    };
    if (sourceExcerpt) patch.sourceExcerpt = sourceExcerpt;
    let result;
    try {
      result = updateWorkItem(workspace, existing.id, patch, { actor: "pool-capture", expectedRevision: existing.revision });
    } catch (error) {
      if (String(error?.message || "") !== "work_item_revision_conflict") throw error;
      const latest = getWorkItem(workspace, existing.id);
      const retryPatch = {
        sourceRefs: [...new Set([...(latest.sourceRefs || []), ...sourceRefs])],
        ...(!inferred && latest.confirmationStatus === "needs_triage" && latest.decisionStatus === "needs_triage" ? { confirmationStatus: "confirmed", decisionStatus: "candidate" } : {})
      };
      result = updateWorkItem(workspace, existing.id, retryPatch, { actor: "pool-capture", expectedRevision: latest.revision });
    }
    console.log(JSON.stringify({ status: "deduplicated", item: result.item, mergedSourceRefs: result.item.sourceRefs, pmBrief: capturePmBrief(result.item, inferred, true) }, null, 2));
    return;
  }
  const result = createWorkItem(workspace, {
    ...(stableId ? { id: stableId } : {}),
    legacyIds,
    itemType,
    title,
    summary,
    description,
    sourceType: argValue("--source-type", inferred ? "session_inferred" : "user_request"),
    sourceRefs,
    sourceExcerpt,
    captureMode: inferred ? "inferred" : "explicit",
    sourceConfidence: inferred ? 0.5 : 1,
    confirmationStatus: inferred ? "needs_triage" : "confirmed",
    targetUser: argValue("--target-user", "").trim(),
    scenario: argValue("--scenario", "").trim(),
    painPoint: argValue("--pain-point", "").trim(),
    expectedOutcome: argValue("--expected-outcome", "").trim(),
    scopeBoundary: argValue("--scope-boundary", "").trim(),
    userValue: argValue("--user-value", "").trim(),
    decisionStatus: inferred ? "needs_triage" : "candidate",
    candidateVersions: argValues("--candidate-version"),
    nextAction: inferred ? "PM 梳理并确认该 Agent 推断。" : "Codex 在后续版本规划时继续对齐范围和验收方式。",
    nextActionOwner: inferred ? "pm" : "codex"
  }, { actor: "pool-capture" });
  console.log(JSON.stringify({ status: "captured", item: result.item, path: result.path, pmBrief: capturePmBrief(result.item, inferred) }, null, 2));
}

if (require.main === module) main();
