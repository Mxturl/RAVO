#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PATH_RANK = Object.freeze({ quick_answer: 1, focused_diagnosis: 2, governed_change: 3 });
const BUDGET_FIELDS = Object.freeze(["wallClockMinutes", "evidenceAcquisitions", "directEvidence", "officialSources", "modelSteps", "contextCharacters"]);
const DEFAULT_BUDGETS = Object.freeze({
  quick_answer: Object.freeze({ wallClockMinutes: 10, evidenceAcquisitions: 5, directEvidence: 3, officialSources: 1, modelSteps: 4, contextCharacters: 40000 }),
  focused_diagnosis: Object.freeze({ wallClockMinutes: 30, evidenceAcquisitions: 12, directEvidence: 8, officialSources: 2, modelSteps: 10, contextCharacters: 120000 })
});
const MAX_BUDGETS = Object.freeze({
  quick_answer: Object.freeze({ wallClockMinutes: 15, evidenceAcquisitions: 8, directEvidence: 5, officialSources: 2, modelSteps: 6, contextCharacters: 80000 }),
  focused_diagnosis: Object.freeze({ wallClockMinutes: 60, evidenceAcquisitions: 24, directEvidence: 12, officialSources: 4, modelSteps: 16, contextCharacters: 250000 })
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    output[key] = isObject(value) && isObject(output[key]) ? deepMerge(output[key], value) : value;
  }
  return output;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return {}; }
}

function readRoutingConfig(workspace = process.cwd(), options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const user = readJson(options.configPath || path.join(home, ".codex", "skill-config", "ravo.json"));
  const local = options.configPath ? {} : readJson(path.join(path.resolve(workspace), "knowledge", ".ravo", "config.json"));
  return deepMerge(user, local);
}

function validateRequestRouting(config = {}) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, code: "invalid_request_routing", message });
  if (!isObject(config)) return { valid: false, errors: [{ path: "config", code: "invalid_request_routing", message: "must be an object" }] };
  if (config.requestRouting === undefined) return { valid: true, errors: [] };
  const routing = config.requestRouting;
  if (!isObject(routing)) return { valid: false, errors: [{ path: "requestRouting", code: "invalid_request_routing", message: "must be an object" }] };
  if (routing.enabled !== undefined && typeof routing.enabled !== "boolean") add("requestRouting.enabled", "must be a boolean");
  if (routing.budgets !== undefined && !isObject(routing.budgets)) add("requestRouting.budgets", "must be an object");
  for (const route of ["quick_answer", "focused_diagnosis"]) {
    const budget = routing.budgets?.[route];
    if (budget === undefined) continue;
    if (!isObject(budget)) {
      add(`requestRouting.budgets.${route}`, "must be an object");
      continue;
    }
    for (const field of BUDGET_FIELDS) {
      if (budget[field] === undefined) continue;
      if (!Number.isInteger(budget[field]) || budget[field] < 0 || budget[field] > MAX_BUDGETS[route][field]) {
        add(`requestRouting.budgets.${route}.${field}`, `must be an integer from 0 to ${MAX_BUDGETS[route][field]}`);
      }
    }
    for (const field of ["formalReviewRuns", "subagentStarts", "persistentAnalysisArtifacts"]) {
      if (budget[field] !== undefined) add(`requestRouting.budgets.${route}.${field}`, "cannot override path escalation limits");
    }
  }
  return { valid: errors.length === 0, errors };
}

function resolveRouteBudget(route, config = {}) {
  if (!Object.hasOwn(DEFAULT_BUDGETS, route)) return {};
  const validation = validateRequestRouting(config);
  const override = validation.valid && isObject(config.requestRouting?.budgets?.[route]) ? config.requestRouting.budgets[route] : {};
  const budget = { ...DEFAULT_BUDGETS[route] };
  for (const field of BUDGET_FIELDS) if (Number.isInteger(override[field])) budget[field] = override[field];
  return {
    ...budget,
    formalReviewRuns: 0,
    subagentStarts: route === "quick_answer" ? 0 : 1,
    persistentAnalysisArtifacts: route === "quick_answer" ? 0 : 1,
    validation: validation.valid ? "valid" : "invalid_fallback",
    enforcement: "audited"
  };
}

function splitUserQuestions(prompt) {
  const text = String(prompt || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const parts = text.split(/(?:\n+|[。！？!?；;]+)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 12) : [text];
}

function has(text, pattern) {
  return pattern.test(text);
}

function isBoundedReadOnlyPrompt(text) {
  return has(text, /(?:只读|read[ -]?only).{0,180}(?:运行|执行|查看|检查|确认)/i)
    && has(text, /(?:不要|不).{0,48}(?:创建|修改|写入).{0,48}(?:文件|artifact|产物)/i);
}

function summary(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > 80 ? `${value.slice(0, 79)}...` : value;
}

function classifyQuestion(text, index) {
  const value = String(text || "").trim();
  const boundedReadOnly = isBoundedReadOnlyPrompt(value);
  const explanation = has(value, /^(?:请|帮我)?(?:解释|说明|介绍|为什么|什么是|如何理解|能否|可否|是否|看看能不能|查询|查看|确认|判断)|(?:能否|可否|是否|怎么理解|为什么)/i);
  const formalReview = has(value, /(?:正式\s*)?(?:RAVO\s*)?(?:多模型\s*)?(?:评审|review)/i) && has(value, /(?:正式|多模型|RAVO)/i);
  const release = has(value, /(?:发布|上线|部署|TestFlight|App\s*Store|远端推送|production\s*release)/i);
  const security = has(value, /(?:凭据|密钥|secret|api\s*key|provider\s*key|权限|认证|角色)/i);
  const data = has(value, /(?:用户数据|生产数据|数据库|生产表|schema|迁移)/i);
  const architecture = has(value, /(?:架构|认证|数据完整性|可用性|外部合同|多模块)/i);
  const provider = has(value, /(?:Provider|模型服务|AI\s*服务|接口状态)/i);
  const ipa = has(value, /(?:IPA|图标|重打包)/i);
  const mutation = has(value, /(?:发布|上线|部署|推送|提交|删除|迁移|轮换|修改|写入|修复|重打包|安装|升级|重构|执行)/i);
  const explicitAction = has(value, /^(?:请|帮我|立即|现在|直接|实际|明确)?(?:实际)?(?:发布|上线|部署|推送|提交|删除|迁移|轮换|修改|写入|修复|重打包|安装|升级|重构|执行)/i)
    || has(value, /(?:请|帮我|立即|现在|直接|实际).{0,18}(?:发布|上线|部署|推送|提交|删除|迁移|轮换|修改|写入|修复|重打包|安装|升级|重构|执行)/i);
  const feasibility = has(value, /(?:能否|可否|是否|看看能不能|判断).{0,24}(?:修复|实现|处理|发布|重打包)/i);
  const rootCause = has(value, /(?:根因|为什么.*(?:问题|失败|异常)|机制原因|复盘)/i);
  const highArchitecture = architecture && has(value, /(?:决定|落地|实施|重构|改造)/i) && explicitAction;
  const actualMutation = !boundedReadOnly && mutation && (explicitAction || (!explanation && !feasibility));
  const riskDomains = [];
  if (release) riskDomains.push("release");
  if (security) riskDomains.push("security_or_permission");
  if (data) riskDomains.push("data_integrity");
  if (highArchitecture) riskDomains.push("high_impact_architecture");

  let pathName = "quick_answer";
  let operationType = "read_only_query";
  const reasons = [];
  if (formalReview) {
    pathName = "governed_change";
    operationType = "high_impact_architecture_decision";
    reasons.push("explicit_formal_review");
  } else if (actualMutation && (release || security || data || highArchitecture)) {
    pathName = "governed_change";
    operationType = release ? "release_action" : security ? "security_or_permission_change" : data ? "data_integrity_change" : "high_impact_architecture_decision";
    reasons.push("explicit_high_risk_operation");
  } else if (actualMutation || rootCause) {
    pathName = "focused_diagnosis";
    operationType = actualMutation ? "local_reversible_change" : "feasibility_assessment";
    reasons.push(actualMutation ? "local_reversible_change" : "single_root_cause");
  } else if (boundedReadOnly || explanation || feasibility) {
    operationType = explanation ? "explanation" : "feasibility_assessment";
    reasons.push(boundedReadOnly ? "explicit_bounded_read_only" : "read_only_or_feasibility_request");
  } else {
    reasons.push("no_mutation_evidence");
  }

  const dependencyGroup = data ? "data-integrity" : security ? "security" : release ? "release" : provider ? "provider-status" : ipa ? "ipa-repackaging" : architecture ? "architecture" : actualMutation ? "local-change" : `question-${index + 1}`;
  return {
    id: `q${index + 1}`,
    summary: summary(value),
    intent: explanation ? "status_or_explanation" : actualMutation ? "change_request" : rootCause ? "root_cause" : "general_query",
    operationType,
    path: pathName,
    dependencyGroup,
    dataSensitivity: security || data ? "sensitive_or_production" : "public_or_local_non_sensitive",
    riskDomains,
    reversibility: pathName === "quick_answer" ? "not_applicable" : pathName === "focused_diagnosis" ? "reversible_candidate" : "requires_governance",
    reasons
  };
}

function classifyRequest(prompt, options = {}) {
  const config = options.config || readRoutingConfig(options.workspace || process.cwd(), options);
  const questions = splitUserQuestions(prompt).map(classifyQuestion);
  if (!questions.length) questions.push(classifyQuestion("", 0));
  if (isBoundedReadOnlyPrompt(String(prompt || ""))) {
    for (const question of questions) {
      question.path = "quick_answer";
      question.operationType = "read_only_query";
      question.reversibility = "not_applicable";
      question.reasons = ["explicit_bounded_read_only"];
    }
  }
  const groupRanks = new Map();
  for (const question of questions) groupRanks.set(question.dependencyGroup, Math.max(groupRanks.get(question.dependencyGroup) || 0, PATH_RANK[question.path]));
  for (const question of questions) {
    const rank = groupRanks.get(question.dependencyGroup) || PATH_RANK.quick_answer;
    const inherited = Object.entries(PATH_RANK).find(([, value]) => value === rank)?.[0] || "quick_answer";
    if (inherited !== question.path) {
      question.path = inherited;
      question.reasons.push("dependency_group_highest_risk");
    }
  }
  const overallPath = questions.reduce((current, question) => PATH_RANK[question.path] > PATH_RANK[current] ? question.path : current, "quick_answer");
  const enabled = config.requestRouting?.enabled !== false;
  return {
    schemaVersion: "0.5.6",
    overallPath,
    aggregateRisk: overallPath === "governed_change" ? "high" : overallPath === "focused_diagnosis" ? "medium" : "low",
    questions,
    budget: overallPath === "governed_change" ? {} : resolveRouteBudget(overallPath, config),
    enforcement: {
      classification: enabled ? "advisory" : "disabled",
      reviewExternalCallGate: "enforced",
      toolCalls: "audited",
      modelSteps: "audited",
      tokenUsage: "audited",
      contextCharacters: "audited"
    }
  };
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-governance-route.js --prompt <text> [--workspace <path>] [--config <json>]");
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const configPath = argValue("--config", "");
  const prompt = argValue("--prompt", "").trim() || (() => {
    try { return process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8").trim(); } catch (_error) { return ""; }
  })();
  if (!prompt) throw new Error("--prompt or stdin is required");
  console.log(JSON.stringify(classifyRequest(prompt, { workspace, configPath }), null, 2));
}

if (require.main === module) main();

module.exports = { DEFAULT_BUDGETS, MAX_BUDGETS, classifyRequest, readRoutingConfig, resolveRouteBudget, splitUserQuestions, validateRequestRouting };
