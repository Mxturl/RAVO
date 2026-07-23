#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  classifyRequest,
  resolveRouteBudget,
  validateRequestRouting
} = require("../plugins/ravo/modules/ravo-analysis/scripts/ravo-governance-route");

function route(prompt, config = {}) {
  return classifyRequest(prompt, { config });
}

assert.equal(route("查询当前 Provider 状态").overallPath, "quick_answer");
assert.equal(route("解释 DCloud Simulator 的架构限制").overallPath, "quick_answer");
assert.equal(route("判断 IPA 图标能否修复").overallPath, "quick_answer");
assert.equal(route("解释通用凭据轮换概念，不访问真实 secret").overallPath, "quick_answer");
assert.equal(route("请实际修复本地 IPA 图标重打包脚本").overallPath, "focused_diagnosis");
assert.equal(route("立即发布 IPA 到 TestFlight").overallPath, "governed_change");
assert.equal(route("轮换生产 Provider key").overallPath, "governed_change");
assert.equal(route("执行用户数据迁移").overallPath, "governed_change");
assert.equal(route("解释一个高影响架构概念").overallPath, "quick_answer");

const mixed = route("查询当前 Provider 状态？立即发布 IPA 到 TestFlight？");
assert.equal(mixed.overallPath, "governed_change");
assert.deepEqual(mixed.questions.map((question) => question.path), ["quick_answer", "governed_change"]);

const grouped = route("查看生产表结构；删除生产表。");
assert.deepEqual(grouped.questions.map((question) => question.path), ["governed_change", "governed_change"]);
assert.equal(route(`${"只读背景 ".repeat(5000)}查询当前 Provider 状态`).overallPath, "quick_answer");

const lowerBudget = resolveRouteBudget("quick_answer", {
  requestRouting: { budgets: { quick_answer: { wallClockMinutes: 4, modelSteps: 2 } } }
});
assert.equal(lowerBudget.wallClockMinutes, 4);
assert.equal(lowerBudget.modelSteps, 2);
assert.equal(lowerBudget.formalReviewRuns, 0);
assert.equal(validateRequestRouting({ requestRouting: { budgets: { quick_answer: { wallClockMinutes: 16 } } } }).valid, false);
assert.equal(validateRequestRouting({ requestRouting: { budgets: { quick_answer: { formalReviewRuns: 1 } } } }).valid, false);

const lowRiskKeywordPrompt = "我只想解释一个概念：需求、方案、风险在产品讨论中分别是什么意思，以及它们应该如何区分，不要规划项目或改动任何内容，请简短回答。";
assert.equal(route(lowRiskKeywordPrompt).overallPath, "quick_answer");
const hookManifest = require(path.join(__dirname, "../plugins/ravo/hooks/hooks.json"));
assert.equal(hookManifest.hooks.UserPromptSubmit, undefined, "the optional classifier must not be a prompt-time router");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "keyword-only prompts stay quick",
    "local repair uses focused diagnosis",
    "high-risk mutations use governed change",
    "quick-answer requirement keywords remain directly classifiable",
    "mixed questions preserve independent paths",
    "shared high-risk dependency group aggregates",
    "request budget validation and fallback",
    "classifier is not registered as a Prompt Hook"
  ]
}, null, 2));
