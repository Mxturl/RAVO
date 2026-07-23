#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { buildPmBrief, validatePmBrief, validatePmMarkdown } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief");

const noAction = buildPmBrief({
  headline: "本机已经可以体验这项能力",
  stage: "experience",
  productState: "locally_available",
  userImpact: "你可以直接开始体验；现有数据和远端环境没有变化。",
  actionRequired: "none",
  nextStep: "Codex 将记录体验结果并准备下一轮优化。",
  decisionCard: null,
  evidenceBoundary: {
    proves: ["本机实际使用路径已验证"],
    doesNotProve: ["尚未发布给其他用户"]
  },
  sourceRefs: ["knowledge/.ravo/acceptance/example.json"]
});
assert.equal(noAction.actionRequired, "none");
assert.equal(noAction.decisionCard, null);

const decision = buildPmBrief({
  headline: "需要你决定是否接受当前体验",
  stage: "experience",
  productState: "awaiting_pm",
  userImpact: "当前版本已经可以在本机使用，你的体验结论决定下一轮方向。",
  actionRequired: "experience_acceptance",
  nextStep: "请体验核心路径，然后选择接受或继续优化。",
  decisionCard: {
    question: "是否接受当前体验并进入下一轮？",
    whyNow: "自动检查已经完成，剩余事项是产品体验判断。",
    recommendation: "先体验核心路径，再根据真实感受选择。",
    options: [
      { id: "accept", label: "接受", outcome: "记录本轮通过并进入下一轮。" },
      { id: "revise", label: "继续优化", outcome: "保留当前版本并记录改进点。" }
    ],
    waitingImpact: "不决定不会影响现有环境，但下一轮不会开始。"
  },
  evidenceBoundary: {
    proves: ["核心路径已经通过自动检查"],
    doesNotProve: ["尚未获得你的体验结论"]
  },
  sourceRefs: ["knowledge/.ravo/acceptance/example.json"]
});
assert.equal(decision.decisionCard.options.length, 2);

assert.throws(() => buildPmBrief({ ...noAction, headline: "Runtime update complete" }), /internal term/);
assert.throws(() => buildPmBrief({ ...noAction, productState: "awaiting_pm" }), /requires PM action/);
assert.throws(() => buildPmBrief({ ...decision, decisionCard: null }), /decisionCard is required/);
assert.ok(validatePmBrief({ ...noAction, evidenceBoundary: { proves: [], doesNotProve: [] } }).length >= 2);
assert.ok(validatePmBrief({ ...noAction, nextStep: "请确认是否继续。" }).some((error) => /cannot request PM confirmation/.test(error)));
assert.ok(validatePmBrief({ ...decision, decisionCard: { ...decision.decisionCard, question: "是否接受？是否继续优化？" } }).some((error) => /only one product question/.test(error)));
assert.deepEqual(validatePmMarkdown("# PM 验收结论\n- 结论：GitHub Release 已准备\n- 当前可用：本机可用\n- 影响：可以体验\n- PM 行动：无需行动\n- 状态边界：实现已完成\n- 下一步：Codex 继续\n- 风险：无\n", { kind: "acceptance", actionRequired: "none" }), []);
assert.ok(validatePmMarkdown("# PM 体验验收\n## 空章节\n## 体验步骤\n1. 一\n2. 二\n3. 三\n4. 四\n", { kind: "acceptance", actionRequired: "experience_acceptance" }).length >= 2);

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "no-action-brief",
    "decision-card-brief",
    "internal-term-rejection",
    "action-state-consistency",
    "evidence-boundary-required",
    "no-action-confirmation-rejected",
    "single-decision-question",
    "pm-markdown-projection"
  ]
}, null, 2));
