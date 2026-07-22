#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkSpecHealth, goalPrompt } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt");

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function alignment(status = "PM 已确认") {
  return `# Alignment\n\n状态：${status}\n\n候选 Release Slice：\`ravo-v0.5.4-rapid-delivery\`\n\n需求集合：\`R055-001\` 至 \`R055-002\`\n`;
}

function spec() {
  return `# RAVO v0.5.4 Goal Guard Fixture\n\n状态：decision-complete\n\nAlignmentRef：\`docs/alignment.md\`\n\nRelease Slice：\`ravo-v0.5.4-rapid-delivery\`\n\n需求集合：\`R055-001\` 至 \`R055-002\`\n\n## 产品定义\n\n- fixture\n\n## 模块契约\n\n- fixture\n\n## 验证矩阵\n\n- fixture\n\n## 触发规则\n\n- fixture\n\n## 假设\n\n- fixture\n`;
}

function poolEntry(id, legacyId) {
  return {
    id,
    legacyIds: [legacyId],
    confirmationStatus: "confirmed",
    decisionStatus: "approved",
    committedVersion: "v0.5.4",
    releaseSlice: "ravo-v0.5.4-rapid-delivery",
    candidateVersions: ["v0.5.4"],
    scopeClass: "must_ship",
    detailRef: `knowledge/.ravo/pool/items/${id}.json`
  };
}

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-goal-semantic-")));
const specPath = path.join(workspace, "docs", "spec.md");
const alignmentPath = path.join(workspace, "docs", "alignment.md");
const poolPath = path.join(workspace, "knowledge", ".ravo", "pool", "index.json");
write(specPath, spec());
write(alignmentPath, alignment());
write(poolPath, JSON.stringify({ entries: [poolEntry("WI-001", "R055-001"), poolEntry("WI-002", "R055-002")] }, null, 2));

let health = checkSpecHealth(workspace, "docs/spec.md");
assert.equal(health.status, "current");
assert.equal(health.pairing.releaseSlice, "ravo-v0.5.4-rapid-delivery");
assert.deepEqual(health.pairing.requirementIds, ["R055-001", "R055-002"]);
const prompt = goalPrompt(workspace, specPath, { releaseSlice: health.pairing.releaseSlice, deliveryProfile: "rapid" });
assert.ok([...prompt].length <= 1600);
assert.match(prompt, /交付档位：rapid/);
assert.match(prompt, /本地连续交付与 PM 沟通/);
assert.match(prompt, /这些步骤属于同一次交付，不拆成多次 PM 授权/);
assert.match(prompt, /本机是否已经可用/);
assert.doesNotMatch(prompt, /R055-001/);

write(alignmentPath, alignment("待确认"));
health = checkSpecHealth(workspace, "docs/spec.md");
assert.equal(health.status, "stale");
assert.match(health.error, /PM 已确认/);

write(alignmentPath, alignment());
const currentPool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
write(path.join(workspace, "docs", "ravo-v0.5.3-requirements-alignment-zh.md"), "# 历史对齐文档\n\n状态：PM 已确认\n");
health = checkSpecHealth(workspace, "docs/spec.md");
assert.equal(health.status, "current", "a newer edit to another release's historical alignment must not stale the current Goal");
currentPool.entries.push({
  id: "WI-unassigned",
  legacyIds: [],
  confirmationStatus: "confirmed",
  decisionStatus: "candidate",
  candidateVersions: ["v0.5.4"],
  scopeClass: "candidate",
  captureMode: "explicit",
  updatedAt: "2099-01-01T00:00:00.000Z",
  detailRef: "knowledge/.ravo/pool/items/WI-unassigned.json"
});
write(poolPath, JSON.stringify(currentPool, null, 2));
health = checkSpecHealth(workspace, "docs/spec.md");
assert.equal(health.status, "stale");
assert.equal(health.unresolvedItems[0].id, "WI-unassigned");

currentPool.entries.pop();
currentPool.entries.push({
  id: "WI-v055",
  legacyIds: ["R056-001"],
  confirmationStatus: "confirmed",
  decisionStatus: "approved",
  committedVersion: "v0.5.5",
  releaseSlice: "ravo-v0.5.5-git-hygiene",
  candidateVersions: ["v0.5.5"],
  scopeClass: "must_ship",
  updatedAt: "2099-01-01T00:00:00.000Z"
});
write(poolPath, JSON.stringify(currentPool, null, 2));
health = checkSpecHealth(workspace, "docs/spec.md");
assert.equal(health.status, "current", "other Release Slice updates do not stale the current Goal");

function v056Alignment({ complete = true, hotfix = false, multipleGoals = false } = {}) {
  const costFields = complete ? "优先级、用户价值、关键依赖、Agent 活跃时长、日历时长、PM 投入、Token 区间、不确定性和处置" : "优先级、关键依赖";
  const hotfixRule = hotfix ? "本次是单一明确 hotfix，跳过理由：只处理一个局部可逆缺陷。" : "多个候选必须完成成本矩阵。";
  const multiple = multipleGoals ? "本次任务包含多个独立产品目标。" : "";
  return `# Alignment\n\n状态：PM 已确认\n\n候选 Release Slice：\`ravo-v0.5.6-bounded-governance-routing\`\n\n需求集合：\`R056-001\`、\`R056-007\`、\`R056-008\`、\`R056-009\`、\`R056-010\`、\`R056-011\`\n\n## 版本选择方法\n\n${hotfixRule}\n${multiple}\n\n## 候选需求聚类与成本判断\n\n${costFields}\n\n## 单一产品方向\n\n选择当前最小可验收方向。\n\n## 候选条目逐项去向\n\n每项标注纳入、延期、拒绝或待澄清。\n\n## PM 确认项\n\nPM 已确认当前 Release Slice。\n`;
}

function v056Spec() {
  return `# RAVO v0.5.6 Scope Fixture\n\n状态：decision-complete\n\nAlignmentRef：\`docs/alignment-v056.md\`\n\nRelease Slice：\`ravo-v0.5.6-bounded-governance-routing\`\n\n需求集合：\`R056-001\`、\`R056-007\`、\`R056-008\`、\`R056-009\`、\`R056-010\`、\`R056-011\`\n\n## 产品定义\n\n- fixture\n\n## 模块契约\n\n- fixture\n\n## 验证矩阵\n\n- fixture\n\n## 触发规则\n\n- fixture\n\n## 假设\n\n- fixture\n`;
}

const scopeWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-v056-scope-")));
const scopeSpec = path.join(scopeWorkspace, "docs/spec-v056.md");
const scopeAlignment = path.join(scopeWorkspace, "docs/alignment-v056.md");
write(scopeSpec, v056Spec());
write(scopeAlignment, v056Alignment());
write(path.join(scopeWorkspace, "knowledge/.ravo/pool/index.json"), JSON.stringify({ entries: ["001", "007", "008", "009", "010", "011"].map((suffix) => ({
  ...poolEntry(`WI-v056-${suffix}`, `R056-${suffix}`),
  committedVersion: "v0.5.6",
  releaseSlice: "ravo-v0.5.6-bounded-governance-routing",
  candidateVersions: ["v0.5.6"]
})) }, null, 2));
health = checkSpecHealth(scopeWorkspace, "docs/spec-v056.md");
assert.equal(health.status, "current", "R056-011 requires a complete scope selection contract");
write(scopeAlignment, v056Alignment({ complete: false }));
health = checkSpecHealth(scopeWorkspace, "docs/spec-v056.md");
assert.equal(health.status, "stale");
assert.match(health.error, /用户价值/);
write(scopeAlignment, v056Alignment({ hotfix: true, complete: false }));
health = checkSpecHealth(scopeWorkspace, "docs/spec-v056.md");
assert.equal(health.status, "current", "a single explicit hotfix may record a skip reason instead of a full matrix");
write(scopeAlignment, v056Alignment({ hotfix: true, multipleGoals: true }));
health = checkSpecHealth(scopeWorkspace, "docs/spec-v056.md");
assert.equal(health.status, "stale");
assert.match(health.error, /多个独立产品目标/);

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "alignment-spec-pool semantic pairing",
    "PM confirmation gate",
    "historical alignment from another Release Slice ignored",
    "new unassigned current-slice input",
    "other release slice ignored",
    "R056-011 scope selection semantic gate",
    "short Goal Prompt"
  ]
}, null, 2));
