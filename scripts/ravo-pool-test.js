#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../plugins/ravo/modules/ravo-core/scripts/ravo-record-store");
const pool = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-test-")));
fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
fs.mkdirSync(path.join(workspace, "knowledge", ".ravo", "knowledge"), { recursive: true });

const captureScript = path.join(__dirname, "../plugins/ravo/modules/ravo-core/scripts/capture-pool-item.js");
const captured = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "捕获需求", "--description", "来自用户的明确需求", "--source-ref", "task:explicit"], { encoding: "utf8" });
assert.equal(captured.status, 0, captured.stderr);
const capturedItem = JSON.parse(captured.stdout).item;
const capturedOutput = JSON.parse(captured.stdout);
assert.equal(capturedItem.confirmationStatus, "confirmed");
assert.equal(capturedItem.decisionStatus, "candidate");
assert.equal(capturedItem.summary, "捕获需求");
assert.equal(capturedItem.description, "来自用户的明确需求");
assert.equal(capturedItem.sourceExcerpt, "");
assert.equal(capturedOutput.pmBrief.actionRequired, "none");
assert.equal(capturedOutput.pmBrief.decisionCard, null);
assert.equal(capturedOutput.pmBrief.headline, "已记录候选需求：捕获需求");

const issueCapture = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "issue", "--title", "捕获问题", "--description", "有后续价值的问题", "--source-ref", "task:issue"], { encoding: "utf8" });
assert.equal(issueCapture.status, 0, issueCapture.stderr);
const issueOutput = JSON.parse(issueCapture.stdout);
assert.match(issueOutput.pmBrief.headline, /问题/);
assert.doesNotMatch(issueOutput.pmBrief.headline, /需求/);
assert.equal(issueOutput.pmBrief.headline, "已记录候选问题：捕获问题");
assert.match(issueOutput.pmBrief.userImpact, /^问题已显性保留/);

const inferredCapture = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "推断需求", "--description", "来自 Codex 的推断", "--source-ref", "task:inferred", "--inferred", "true"], { encoding: "utf8" });
assert.equal(inferredCapture.status, 0, inferredCapture.stderr);
const inferredItem = JSON.parse(inferredCapture.stdout).item;
assert.equal(inferredItem.confirmationStatus, "needs_triage");
assert.equal(inferredItem.decisionStatus, "needs_triage");
assert.equal(inferredItem.committedVersion, "");

const versionCandidateCapture = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "下版本考虑", "--description", "明确提出下版本考虑", "--source-ref", "task:next-version", "--candidate-version", "v0.7.0"], { encoding: "utf8" });
assert.equal(versionCandidateCapture.status, 0, versionCandidateCapture.stderr);
const versionCandidate = JSON.parse(versionCandidateCapture.stdout).item;
assert.deepEqual(versionCandidate.candidateVersions, ["v0.7.0"]);
assert.equal(versionCandidate.committedVersion, "");
assert.equal(versionCandidate.releaseSlice, "");
const deduplicated = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "捕获需求", "--description", "同一需求的第二来源", "--source-ref", "task:second"], { encoding: "utf8" });
assert.equal(deduplicated.status, 0, deduplicated.stderr);
assert.equal(JSON.parse(deduplicated.stdout).status, "deduplicated");
const normalizedDuplicate = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "捕获 需求！", "--description", "规范化标题的同一需求", "--source-ref", "task:normalized-title"], { encoding: "utf8" });
assert.equal(normalizedDuplicate.status, 0, normalizedDuplicate.stderr);
assert.equal(JSON.parse(normalizedDuplicate.stdout).status, "deduplicated");
assert.ok(JSON.parse(normalizedDuplicate.stdout).item.sourceRefs.includes("task:normalized-title"));

const legacyCapture = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "Legacy 原标题", "--description", "带 legacy id 的需求", "--source-ref", "task:legacy-a", "--legacy-id", "R601-LEGACY"], { encoding: "utf8" });
assert.equal(legacyCapture.status, 0, legacyCapture.stderr);
const legacyDuplicate = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "Legacy 新标题", "--description", "同一 legacy id 的新增来源", "--source-ref", "task:legacy-b", "--legacy-id", "R601-LEGACY"], { encoding: "utf8" });
assert.equal(legacyDuplicate.status, 0, legacyDuplicate.stderr);
assert.equal(JSON.parse(legacyDuplicate.stdout).status, "deduplicated");

const decisionTarget = store.createWorkItem(workspace, {
  title: "决策留痕需求",
  itemType: "feature",
  summary: "等待 PM 决策",
  sourceRefs: ["task:decision"],
  captureMode: "explicit",
  confirmationStatus: "confirmed",
  decisionStatus: "candidate"
});
const rejected = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--id", decisionTarget.item.id, "--decision", "rejected", "--reason", "当前价值不足", "--owner", "pm", "--source-ref", "task:decision-rejected", "--expected-revision", String(decisionTarget.item.revision)], { encoding: "utf8" });
assert.equal(rejected.status, 0, rejected.stderr);
const rejectedItem = JSON.parse(rejected.stdout).item;
assert.equal(rejectedItem.decisionStatus, "rejected");
assert.equal(rejectedItem.decisionReason, "当前价值不足");
assert.equal(rejectedItem.decisionOwner, "pm");
assert.ok(Date.parse(rejectedItem.decisionAt));
assert.ok(rejectedItem.sourceRefs.includes("task:decision-rejected"));
const decisionEvent = pool.history(workspace, rejectedItem.id).at(-1);
assert.equal(decisionEvent.decisionChanges.decisionStatus.to, "rejected");
assert.equal(decisionEvent.decisionChanges.decisionReason.to, "当前价值不足");

const reasonlessTarget = store.createWorkItem(workspace, {
  title: "未提供拒绝理由",
  itemType: "feature",
  sourceRefs: ["task:reasonless"],
  captureMode: "explicit",
  confirmationStatus: "confirmed",
  decisionStatus: "candidate"
});
const reasonless = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--id", reasonlessTarget.item.id, "--decision", "rejected", "--owner", "pm", "--source-ref", "task:reasonless-rejected", "--expected-revision", String(reasonlessTarget.item.revision)], { encoding: "utf8" });
assert.equal(reasonless.status, 0, reasonless.stderr);
assert.equal(JSON.parse(reasonless.stdout).item.decisionReason, "PM 当前不采纳，未提供进一步原因");

const capturedWithDistinctFields = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "字段独立需求", "--summary", "简短摘要", "--description", "完整需求说明", "--source-excerpt", "用户原始发言摘录", "--source-ref", "task:distinct"], { encoding: "utf8" });
assert.equal(capturedWithDistinctFields.status, 0, capturedWithDistinctFields.stderr);
const distinctItem = JSON.parse(capturedWithDistinctFields.stdout).item;
assert.equal(distinctItem.summary, "简短摘要");
assert.equal(distinctItem.description, "完整需求说明");
assert.equal(distinctItem.sourceExcerpt, "用户原始发言摘录");
const deduplicatedWithoutExcerpt = spawnSync(process.execPath, [captureScript, "--workspace", workspace, "--kind", "requirement", "--title", "字段独立需求", "--description", "新增来源说明", "--source-ref", "task:distinct-second"], { encoding: "utf8" });
assert.equal(deduplicatedWithoutExcerpt.status, 0, deduplicatedWithoutExcerpt.stderr);
assert.equal(JSON.parse(deduplicatedWithoutExcerpt.stdout).item.sourceExcerpt, "用户原始发言摘录");

const first = store.createWorkItem(workspace, {
  title: "首条需求",
  itemType: "feature",
  summary: "保留来源和下一步",
  description: "完整内部描述只保留在 Agent 原始记录。",
  background: "产品经理需要先理解背景。",
  scenario: "查看需求池。",
  painPoint: "内部字段遮挡产品判断。",
  expectedOutcome: "先看到用户价值和下一步。",
  scopeBoundary: "只调整 PM 投影。",
  sourceRefs: ["session:first"],
  captureMode: "explicit",
  confirmationStatus: "confirmed"
});
const second = store.createWorkItem(workspace, {
  title: "重复需求",
  itemType: "improvement",
  summary: "可合并",
  sourceRefs: ["session:second"],
  captureMode: "explicit",
  confirmationStatus: "confirmed"
});
assert.equal(pool.listPool(workspace, "requirements", { q: "首条" }).total, 1);
const pmDetail = pool.getPoolRecord(workspace, "requirements", first.item.id);
assert.equal(pmDetail.background, "产品经理需要先理解背景。");
assert.equal(Object.hasOwn(pmDetail, "description"), false);
assert.equal(store.getWorkItem(workspace, first.item.id).description, "完整内部描述只保留在 Agent 原始记录。");
const agentDetail = pool.getPoolRecord(workspace, "requirements", first.item.id, { view: "agent" });
assert.equal(agentDetail.description, "完整内部描述只保留在 Agent 原始记录。");
assert.throws(() => store.updateWorkItem(workspace, first.item.id, { title: "冲突" }, { expectedRevision: 99 }), /revision_conflict/);

const merged = pool.mergeWorkItems(workspace, second.item.id, first.item.id);
assert.equal(merged.source.decisionStatus, "duplicate");
assert.match(merged.source.decisionReason, /合并/);
assert.ok(Date.parse(merged.source.decisionAt));
assert.ok(merged.target.sourceRefs.includes("session:second"));
assert.ok(pool.history(workspace, second.item.id).some((event) => event.type === "updated"));

const conflictTarget = store.createWorkItem(workspace, {
  title: "并发合并",
  itemType: "feature",
  sourceRefs: ["task:conflict-a"],
  captureMode: "explicit",
  confirmationStatus: "confirmed",
  decisionStatus: "candidate"
});
store.updateWorkItem(workspace, conflictTarget.item.id, { priority: "P1" }, { actor: "pm", expectedRevision: conflictTarget.item.revision });
const mergedAfterConflict = store.updateWorkItemWithSingleMerge(workspace, conflictTarget.item.id, { sourceRefs: ["task:conflict-b"] }, { actor: "pool-capture", expectedRevision: conflictTarget.item.revision });
assert.deepEqual(mergedAfterConflict.item.sourceRefs.sort(), ["task:conflict-a", "task:conflict-b"]);
assert.throws(() => store.updateWorkItemWithSingleMerge(workspace, conflictTarget.item.id, { decisionStatus: "rejected" }, { actor: "pm", expectedRevision: conflictTarget.item.revision }), /revision_conflict/);
assert.throws(() => store.updateWorkItemWithSingleMerge(workspace, conflictTarget.item.id, { sourceExcerpt: "stale excerpt" }, { actor: "pool-capture", expectedRevision: conflictTarget.item.revision }), /revision_conflict/);

for (const [title, decisionStatus, scopeClass] of [
  ["筛选可见", "candidate", "candidate"],
  ["筛选拒绝", "rejected", "candidate"],
  ["筛选范围外", "candidate", "out_of_scope"]
]) store.createWorkItem(workspace, {
  title,
  itemType: title === "筛选可见" ? "bug" : "feature",
  sourceRefs: [`task:${title}`],
  captureMode: "explicit",
  confirmationStatus: "confirmed",
  decisionStatus,
  scopeClass
});
assert.equal(pool.listPool(workspace, "requirements", { q: "筛选" }).total, 1);
assert.equal(pool.listPool(workspace, "requirements", { q: "筛选", status: "rejected" }).total, 1);
assert.equal(pool.listPool(workspace, "requirements", { q: "筛选", status: "out_of_scope" }).total, 1);
assert.equal(pool.listPool(workspace, "requirements", { q: "筛选", view: "agent" }).total, 3);
assert.equal(pool.listPool(workspace, "requirements", { q: "筛选", itemType: "bug" }).total, 1);

const legacyPool = path.join(workspace, "docs", "legacy-pool.md");
fs.mkdirSync(path.dirname(legacyPool), { recursive: true });
fs.writeFileSync(legacyPool, [
  "| ID | 需求 | 影响 |",
  "|---|---|---|",
  "| LEG-001 | 旧术语定义 | 需要改为 SoloDesk |"
].join("\n"));
const imported = store.migrateRequirementPool(workspace, { sourceRef: "docs/legacy-pool.md" });
assert.equal(imported.migrated, 1);
const importedId = imported.items[0].id;
const importedItem = store.getWorkItem(workspace, importedId);
assert.equal(importedItem.sourceExcerpt, "");
assert.match(importedItem.description, /旧术语定义/);
fs.writeFileSync(legacyPool, [
  "| ID | 需求 | 影响 |",
  "|---|---|---|",
  "| LEG-001 | SoloDesk 当前定义 | 已同步当前产品名 |"
].join("\n"));
const refreshed = store.migrateRequirementPool(workspace, { sourceRef: "docs/legacy-pool.md" });
assert.equal(refreshed.migrated, 0);
assert.equal(refreshed.refreshed, 1);
assert.equal(store.getWorkItem(workspace, importedId).title, "SoloDesk 当前定义");
const pmEdited = store.updateWorkItem(workspace, importedId, { nextAction: "PM 已补充处理方案" }, { actor: "pm", expectedRevision: store.getWorkItem(workspace, importedId).revision });
assert.equal(pmEdited.item.updatedBy, "pm");
fs.writeFileSync(legacyPool, [
  "| ID | 需求 | 影响 |",
  "|---|---|---|",
  "| LEG-001 | 不应覆盖 PM 编辑 | 当前源已再次变化 |"
].join("\n"));
const skippedAfterPmEdit = store.migrateRequirementPool(workspace, { sourceRef: "docs/legacy-pool.md" });
assert.equal(skippedAfterPmEdit.refreshed, 0);
assert.equal(store.getWorkItem(workspace, importedId).title, "SoloDesk 当前定义");

const copiedExcerpt = store.createWorkItem(workspace, {
  title: "历史字段重复",
  itemType: "feature",
  summary: "同一段历史文本",
  description: "同一段历史文本",
  sourceExcerpt: "同一段历史文本",
  sourceRefs: ["legacy:generated"],
  createdBy: "pool-capture",
  captureMode: "explicit",
  confirmationStatus: "confirmed"
});
const realExcerpt = store.createWorkItem(workspace, {
  title: "保留真实引文",
  itemType: "feature",
  summary: "同一段历史文本",
  description: "同一段历史文本",
  sourceExcerpt: "同一段历史文本",
  sourceRefs: ["user:verbatim"],
  createdBy: "pm",
  captureMode: "explicit",
  confirmationStatus: "confirmed"
});
const repaired = store.repairCopiedWorkItemSourceExcerpts(workspace);
assert.equal(repaired.repaired, 1);
assert.equal(store.getWorkItem(workspace, copiedExcerpt.item.id).sourceExcerpt, "");
assert.equal(store.getWorkItem(workspace, realExcerpt.item.id).sourceExcerpt, "同一段历史文本");

const candidate = store.createKnowledge(workspace, {
  kind: "lesson",
  title: "候选经验",
  summary: "必须先验证适用边界",
  content: "只把有来源、可复用的经验放入候选知识。",
  sourceRefs: ["session:knowledge"],
  applicability: ["知识整理"],
  status: "candidate"
});
assert.equal(candidate.item.status, "candidate");
assert.throws(() => store.updateKnowledge(workspace, candidate.item.id, { status: "active" }, { expectedRevision: candidate.item.revision }), /active knowledge requires confirmation/);
const active = store.updateKnowledge(workspace, candidate.item.id, {
  status: "active",
  confirmationStatus: "confirmed",
  confirmedBy: "pm",
  source: "session:knowledge"
}, { expectedRevision: candidate.item.revision });
assert.equal(active.item.status, "active");
store.createKnowledge(workspace, {
  kind: "lesson",
  title: "已拒绝经验",
  summary: "默认不显示",
  content: "只用于历史查询",
  sourceRefs: ["session:knowledge-rejected"],
  applicability: ["知识筛选"],
  status: "rejected"
});
assert.equal(pool.listPool(workspace, "knowledge", { q: "经验" }).total, 1);
assert.equal(pool.listPool(workspace, "knowledge", { q: "经验", status: "rejected" }).total, 1);
assert.equal(pool.listPool(workspace, "knowledge", { q: "经验", view: "agent" }).total, 2);

const scenarioWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-scenario-")));
fs.mkdirSync(path.join(scenarioWorkspace, ".git"), { recursive: true });
function scenarioItem(input) {
  return store.createWorkItem(scenarioWorkspace, {
    itemType: "feature",
    sourceRefs: [`scenario:${input.title}`],
    captureMode: "explicit",
    confirmationStatus: "confirmed",
    decisionStatus: "candidate",
    priority: "P2",
    nextAction: "Codex 继续对齐",
    nextActionOwner: "codex",
    ...input
  }).item;
}
scenarioItem({ title: "锁定需求", priority: "P1", decisionStatus: "approved", committedVersion: "v0.7.0", releaseSlice: "ravo-v0.7.0-fixture", userValue: "提供稳定范围" });
scenarioItem({ title: "候选需求", priority: "P0", decisionStatus: "approved", candidateVersions: ["v0.7.0"], expectedOutcome: "验证候选价值" });
scenarioItem({ title: "待确认问题", itemType: "bug", priority: "P2", confirmationStatus: "needs_triage", decisionStatus: "needs_triage", candidateVersions: ["v0.7.0"], painPoint: "可能影响用户" });
scenarioItem({ title: "拒绝需求", decisionStatus: "rejected", candidateVersions: ["v0.7.0"] });
scenarioItem({ title: "已发布需求", decisionStatus: "approved", candidateVersions: ["v0.7.0"], releaseStatus: "released" });

const scenario = pool.nextVersionCandidates(scenarioWorkspace, { version: "v0.7.0", productVersion: "v0.6.2" });
assert.equal(scenario.status, "ok");
assert.deepEqual(scenario.summary, { total: 3, locked: 1, candidates: 1, needsConfirmation: 1 });
assert.deepEqual(scenario.sections.map((section) => section.key), ["locked", "candidates", "needsConfirmation"]);
assert.equal(scenario.sections.flatMap((section) => section.items).some((item) => Object.hasOwn(item, "id")), false);
assert.equal(scenario.sections.flatMap((section) => section.items).find((item) => item.title === "待确认问题").typeLabel, "问题");
assert.equal(scenario.chat.items.length, 3);
assert.equal(scenario.chat.remaining, 0);
assert.deepEqual(scenario.chat.items.map((item) => item.title), ["候选需求", "锁定需求", "待确认问题"]);
assert.deepEqual(Object.keys(scenario.chat.items[0]).sort(), ["owner", "nextStep", "priority", "title", "typeLabel", "userImpact", "versionStatus", "versionStatusLabel"].sort());
assert.match(scenario.chat.text, /v0\.7\.0 当前 3 项/);
assert.match(scenario.chat.text, /候选不等于 Release Slice/);

const autoScenario = pool.nextVersionCandidates(scenarioWorkspace, { productVersion: "v0.6.2" });
assert.equal(autoScenario.targetVersion, "v0.7.0");
const emptyScenario = pool.nextVersionCandidates(scenarioWorkspace, { version: "v0.9.0", productVersion: "v0.6.2" });
assert.equal(emptyScenario.status, "empty");
const invalidScenario = pool.nextVersionCandidates(scenarioWorkspace, { version: "next-release", productVersion: "v0.6.2" });
assert.equal(invalidScenario.status, "needs_version_choice");
assert.equal(invalidScenario.targetVersion, null);
scenarioItem({ title: "另一版本候选", candidateVersions: ["v0.8.0"] });
const ambiguousScenario = pool.nextVersionCandidates(scenarioWorkspace, { productVersion: "v0.6.2" });
assert.equal(ambiguousScenario.status, "needs_version_choice");
assert.deepEqual(ambiguousScenario.versionOptions, ["v0.7.0", "v0.8.0"]);
for (let index = 0; index < 12; index += 1) scenarioItem({ title: `大列表候选 ${index}`, candidateVersions: ["v0.10.0"], priority: `P${index % 4}` });
const largeScenario = pool.nextVersionCandidates(scenarioWorkspace, { version: "v0.10.0", productVersion: "v0.6.2" });
assert.equal(largeScenario.summary.total, 12);
assert.equal(largeScenario.sections.flatMap((section) => section.items).length, 12);
assert.equal(largeScenario.chat.items.length, 10);
assert.equal(largeScenario.chat.remaining, 2);
assert.match(largeScenario.chat.text, /其余 2 项/);
const unavailableScenario = pool.nextVersionCandidates(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-unavailable-")), { version: "v0.7.0" });
assert.equal(unavailableScenario.status, "unavailable");

const specScenarioWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-spec-scenario-")));
store.createWorkItem(specScenarioWorkspace, { title: "无版本候选", itemType: "feature", sourceRefs: ["scenario:spec"], captureMode: "explicit", confirmationStatus: "confirmed", decisionStatus: "candidate" });
fs.mkdirSync(path.join(specScenarioWorkspace, "docs"), { recursive: true });
fs.writeFileSync(path.join(specScenarioWorkspace, "docs", "ravo-v0.11.0-decision-complete-spec-zh.md"), "# RAVO v0.11.0\n\nStatus: decision-complete\n");
const specResolved = pool.nextVersionCandidates(specScenarioWorkspace, { productVersion: "v0.6.2" });
assert.equal(specResolved.targetVersion, "v0.11.0");
assert.equal(specResolved.status, "empty");
fs.rmSync(specScenarioWorkspace, { recursive: true, force: true });

const scenarioCli = spawnSync(process.execPath, [path.join(__dirname, "../plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool.js"), "--scenario", "next_version_candidates", "--workspace", scenarioWorkspace, "--version", "v0.7.0"], { encoding: "utf8" });
assert.equal(scenarioCli.status, 0, scenarioCli.stderr);
assert.deepEqual(JSON.parse(scenarioCli.stdout).summary, scenario.summary);
const scenarioIndex = path.join(scenarioWorkspace, "knowledge", ".ravo", "pool", "index.json");
const scenarioBefore = { content: fs.readFileSync(scenarioIndex, "utf8"), mtimeMs: fs.statSync(scenarioIndex).mtimeMs };
pool.nextVersionCandidates(scenarioWorkspace, { version: "v0.7.0" });
assert.deepEqual({ content: fs.readFileSync(scenarioIndex, "utf8"), mtimeMs: fs.statSync(scenarioIndex).mtimeMs }, scenarioBefore);
fs.rmSync(scenarioWorkspace, { recursive: true, force: true });

const legacyFile = path.join(workspace, "knowledge", ".ravo", "knowledge", "legacy-experience.json");
writeJson(legacyFile, {
  kind: "experience",
  summary: "旧格式经验",
  content: "旧格式内容应该仍然可见。",
  source: "legacy-session"
});
const migration = store.migrateKnowledge(workspace);
assert.equal(migration.entries, 3);
assert.ok(store.rebuildKnowledgeIndex(workspace).entries.some((entry) => entry.title === "旧格式经验"));

const paths = store.pathsFor(workspace);
for (let index = 0; index < 1000; index += 1) {
  writeJson(path.join(paths.items, `WI-synthetic-${String(index).padStart(4, "0")}.json`), store.normalizeWorkItem({
    id: `WI-synthetic-${String(index).padStart(4, "0")}`,
    title: `合成需求 ${index}`,
    itemType: "feature",
    summary: "合成数据",
    sourceRefs: [`synthetic:${index}`],
    captureMode: "synthetic",
    confirmationStatus: "needs_triage"
  }, { now: new Date(1700000000000 + index).toISOString() }));
  writeJson(path.join(paths.knowledge, `KN-synthetic-${String(index).padStart(4, "0")}.json`), store.normalizeKnowledgeRecord({
    id: `KN-synthetic-${String(index).padStart(4, "0")}`,
    kind: "lesson",
    title: `合成知识 ${index}`,
    summary: "合成数据",
    content: "合成内容",
    sourceRefs: [`synthetic:${index}`],
    applicability: ["合成测试"],
    status: "candidate"
  }, { now: new Date(1700000000000 + index).toISOString(), capture: true }));
}
store.rebuildWorkItemIndex(workspace);
store.rebuildKnowledgeIndex(workspace);
const requirementPage = pool.listPool(workspace, "requirements", { limit: 1000 });
const agentRequirementPage = pool.listPool(workspace, "requirements", { limit: 1, view: "agent" });
const knowledgePage = pool.listPool(workspace, "knowledge", { limit: 1000 });
assert.ok(requirementPage.total >= 1000);
assert.ok(knowledgePage.total >= 1000);
assert.equal(requirementPage.entries.length, 1000);
assert.equal(knowledgePage.entries.length, 1000);
assert.equal(Object.prototype.hasOwnProperty.call(requirementPage.entries[0], "description"), false);
assert.equal(Object.prototype.hasOwnProperty.call(requirementPage.entries[0], "sourceRefs"), false);
assert.equal(Object.prototype.hasOwnProperty.call(requirementPage.entries[0], "decisionStatus"), false);
assert.equal(Object.prototype.hasOwnProperty.call(agentRequirementPage.entries[0], "sourceRefs"), true);
assert.equal(Object.prototype.hasOwnProperty.call(knowledgePage.entries[0], "content"), false);
const exportText = fs.readFileSync(paths.export, "utf8");
assert.match(exportText, /\| 问题\/标题 \| 用户价值或影响 \| 优先级 \| 版本归属 \| 下一步 \|/);
assert.doesNotMatch(exportText, /\| ID \||来源|更新时间/);

const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "knowledge", ".ravo", "manifest.json"), "utf8"));
assert.ok(manifest.modules.pool);
assert.ok(manifest.modules.knowledge);
console.log(JSON.stringify({
  status: "pass",
  checks: [
    "pool capture keeps summary, description, and source excerpt distinct",
    "legacy pool migration keeps source excerpts empty and refreshes untouched source-only records",
    "source refresh preserves PM-edited records and records the actual updater",
    "field repair clears only known generated source-excerpt copies",
    "explicit and inferred pool capture deduplicates source refs",
    "explicit capture does not repeat confirmation and inferred capture stays needs_triage",
    "decision state, reason, owner, time, source, and event history",
    "candidate version does not imply committed version or Release Slice",
    "requirement writer and summary list",
    "revision conflict",
    "single conflict merge preserves newer decisions",
    "merge keeps source history",
    "PM default filters hide inactive history while explicit and Agent filters recover it",
    "knowledge candidate to active quality gate",
    "Knowledge PM default hides inactive records",
    "next version scenario explicit, automatic, empty, ambiguous, unavailable, and CLI projections",
    "legacy knowledge migration",
    "1000+1000 bounded tables",
    "manifest pool and knowledge registration"
  ],
  counts: { requirements: requirementPage.total, knowledge: knowledgePage.total }
}, null, 2));
