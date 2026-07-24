#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { buildPmBrief, plainLanguageFindings, validatePmBrief, validatePmMarkdown } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief");

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

assert.doesNotThrow(() => buildPmBrief({ ...noAction, headline: "Runtime update complete" }));
assert.deepEqual(plainLanguageFindings("Runtime update complete"), ["Runtime"], "term findings remain advisory rather than a delivery gate");
assert.throws(() => buildPmBrief({ ...noAction, productState: "awaiting_pm" }), /requires PM action/);
assert.throws(() => buildPmBrief({ ...decision, decisionCard: null }), /decisionCard is required/);
assert.ok(validatePmBrief({ ...noAction, evidenceBoundary: { proves: [], doesNotProve: [] } }).length >= 2);
assert.ok(validatePmBrief({ ...noAction, nextStep: "请确认是否继续。" }).some((error) => /cannot request PM confirmation/.test(error)));
assert.ok(validatePmBrief({ ...decision, decisionCard: { ...decision.decisionCard, question: "是否接受？是否继续优化？" } }).some((error) => /only one product question/.test(error)));
assert.deepEqual(validatePmMarkdown("# 当前结果\n\n本机已经可以体验。\n\n接下来请判断核心流程是否符合预期。\n", { kind: "acceptance", actionRequired: "experience_acceptance" }), []);
assert.deepEqual(validatePmMarkdown("# 自由组织\n\n1. 一\n2. 二\n3. 三\n4. 四\n", { kind: "acceptance", actionRequired: "experience_acceptance" }), [], "layout and step count are not hard gates");
assert.deepEqual(validatePmMarkdown("# PM 体验验收\n## 空章节\n## 下一节\n内容\n"), [], "layout quality remains a model judgment");
assert.ok(validatePmMarkdown("").some((error) => /empty/.test(error)));
assert.deepEqual(validatePmMarkdown("# 结果\n路径：knowledge/.ravo/example.json\n"), [], "supporting detail is a model judgment, not a lexical gate");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "no-action-brief",
    "decision-card-brief",
    "advisory-term-finding",
    "action-state-consistency",
    "evidence-boundary-required",
    "no-action-confirmation-rejected",
    "single-decision-question",
    "model-led-pm-markdown"
  ]
}, null, 2));
