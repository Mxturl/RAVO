#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}

function readConfig(workspace) {
  const defaults = {
    goalPrompt: { missingSpecPolicy: "auto_spec" },
    spec: { alignmentDraftPolicy: "required" }
  };
  return deepMerge(
    deepMerge(defaults, readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json")) || {}),
    readJson(path.join(workspace, "knowledge", ".ravo", "config.json")) || {}
  );
}

function walk(dir, pattern, out = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, pattern, out);
      else if (pattern.test(file)) out.push(file);
    }
  } catch (_err) {
    // ponytail: absent docs/knowledge directories just mean no spec candidate.
  }
  return out;
}

function isDecisionComplete(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (/^Status:\s*(draft|candidate|wip|todo)\b/im.test(text)) return false;
    const required = [
      /Product Definition|产品定义/i,
      /Module Contracts|模块契约/i,
      /Validation Matrix|验证矩阵/i,
      /Trigger Rules|触发规则/i,
      /Assumptions|假设|Non-Goals|非目标/i
    ];
    return required.every((pattern) => pattern.test(text)) || /accepted|reviewed|已确认|已评审/i.test(text);
  } catch (_err) {
    return false;
  }
}

function isStaleInput(file) {
  return /alignment|candidate|spec-delta|todo/i.test(path.basename(file));
}

function staleSpecInputs(workspace, spec) {
  const specTime = fs.statSync(spec).mtimeMs;
  return [
    ...walk(path.join(workspace, "docs"), /\.(md|txt)$/i),
    ...walk(path.join(workspace, "knowledge", ".ravo"), /\.(md|json|txt)$/i)
  ]
    .filter((file) => file !== spec && isStaleInput(file))
    .filter((file) => {
      try { return fs.statSync(file).mtimeMs > specTime; } catch (_err) { return false; }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((file) => path.relative(workspace, file));
}

function findSpec(workspace, explicit) {
  if (explicit) {
    const file = path.resolve(workspace, explicit);
    return isDecisionComplete(file) ? file : "";
  }
  const candidates = [
    ...walk(path.join(workspace, "docs"), /decision-complete-spec.*\.md$/i),
    ...walk(path.join(workspace, "docs"), /spec.*\.md$/i),
    ...walk(path.join(workspace, "knowledge"), /spec.*\.md$/i)
  ]
    .filter(isDecisionComplete)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function goalPrompt(workspace, spec) {
  return `目标：
在仓库 ${workspace} 中，严格按照 ${spec} 完成全部开发、验证、文档和验收工作。

完成标准：
1. 规格书中标记为 required 的能力全部实现。
2. 规格书中的验证矩阵全部通过，或明确记录阻塞原因和恢复入口。
3. 完成真实 Codex session/subagent E2E 验证，不得仅用脚本测试替代。
4. 最终运行 RAVO acceptance evidence check，状态和证据一致。
5. 提交并推送到 GitHub，最终报告包含 commit、验证证据、剩余风险。

执行要求：
- 以规格书为唯一需求来源；不要把本 Prompt 当作需求补充。
- 如果规格书与本 Prompt 冲突，以规格书为准。
- 如果上下文变长，重新读取规格书和 RAVO artifacts 后继续。
- 证据不足时不得声称验收通过、可发版、已完成或已发布。`;
}

function detailMode(config) {
  const level = config.technicalDetailLevel;
  const technicalDetailLevel = Number.isInteger(level) && level >= 1 && level <= 5 ? level : 3;
  return {
    technicalDetailLevel,
    outputMode: technicalDetailLevel <= 2 ? "product" : technicalDetailLevel >= 4 ? "engineering" : "balanced"
  };
}

function inlinePrompt(workspace) {
  return `目标：
在仓库 ${workspace} 中，根据当前对话上下文完成用户指定任务。

specMode=inline_prompt

执行要求：
- 当前没有可用 decision-complete spec；本模式只适合低风险、短周期任务。
- 如任务涉及安全、权限、数据边界、发版、验收或长程执行，先创建 spec。
- 证据不足时不得声称验收通过、可发版、已完成或已发布。`;
}

function writeDraftSpec(workspace) {
  const specPath = path.join(workspace, "docs", "ravo-auto-generated-draft-spec.md");
  const text = `# Auto-Generated Draft Spec

Status: draft

## Product Definition

Goal: 待补充。

Consumer: 待补充。

Core problem:

- 待补充。

Success result:

- 待补充。

## Current Baseline

Implemented:

- 待补充。

Known gaps:

- 待补充。

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Module Contracts

- 待补充。

## Inputs And Outputs

Inputs:

- 待补充。

Outputs:

- 待补充。

## Trigger Rules

- 待补充。

## Validation Matrix

- 待补充。

## Failure And Fallback Behavior

- 待补充。

## Assumptions

- 待补充。

## Data Boundary And Security

- 待补充。

## Implementation Plan

- 待补充。分期只代表执行顺序，交付必须满足全部 required 功能。

## Release Wording

Allowed:

- 待补充。

Forbidden:

- 证据不足时不得声称验收通过、可发版、已完成或已发布。

## PM Acceptance Requirements

- 待补充。

## Next Step Advice Rule

- 完成阶段性交付后给出基于证据缺口的简短下一步建议。
`;
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, text);
  return specPath;
}

function writeAlignmentDraft(workspace) {
  const draftPath = path.join(workspace, "docs", "ravo-auto-generated-requirements-alignment.md");
  const text = `# Auto-Generated Requirements Alignment

Status: alignment draft

This document is not a decision-complete Spec and cannot be used as the sole source for a Goal Prompt.

## Current Goal And Consumer

- 待补充。

## Confirmed Requirements

- 待补充。

## Open Questions

- 待补充。

## Explicit Non-Goals

- 待补充。

## Risks And Possible Blind Spots

- 待补充。

## Review / Acceptance / Knowledge / Goal-Spec Requirements

- 待补充。

## Priority Recommendation

- 待补充。

## Recommendation To Enter Formal Spec

- 待确认。
`;
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, text);
  return draftPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const config = readConfig(workspace);
  const explicitPolicy = argValue("--missing-spec-policy", "");
  const missingSpecPolicy = explicitPolicy || config.goalPrompt?.missingSpecPolicy || "auto_spec";
  const detail = detailMode(config);
  const spec = findSpec(workspace, argValue("--spec", ""));
  if (!spec) {
    if (missingSpecPolicy === "inline_goal_prompt") {
      console.log(JSON.stringify({
      status: "ok",
      ...detail,
      specMode: "inline_prompt",
        warning: "inline_goal_prompt is a shortcut mode and is not suitable for high-risk, long-running, release-sensitive, or acceptance-sensitive work.",
        goalPrompt: inlinePrompt(workspace)
      }, null, 2));
      return;
    }
    if (missingSpecPolicy === "auto_spec") {
      const alignmentDraftPath = config.spec?.alignmentDraftPolicy === "required" ? writeAlignmentDraft(workspace) : "";
      const draftSpecPath = writeDraftSpec(workspace);
      console.log(JSON.stringify({
        status: "spec_draft",
        ...detail,
        canGenerateGoalPrompt: false,
        missingSpecPolicy,
        alignmentDraftPolicy: config.spec?.alignmentDraftPolicy || "required",
        alignmentDraftPath,
        draftSpecPath,
        missingFields: ["goal", "consumer", "scope", "module contracts", "validation matrix", "data boundary", "PM acceptance requirements"],
        forbiddenOutputs: ["short_goal_prompt", "temporary_goal_prompt", "draft_goal_prompt"],
        nextStep: "补齐 draft spec 并将 Status 改为 decision-complete 后，重新运行 ravo-goal-prompt。",
        message: "已按 auto_spec 策略生成草稿 Spec，但上下文不足以形成 decision-complete Spec，因此不输出可运行 Goal Prompt。"
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      status: "missing_spec",
      ...detail,
      canGenerateGoalPrompt: false,
      missingSpecPolicy,
      forbiddenOutputs: ["short_goal_prompt", "temporary_goal_prompt", "draft_goal_prompt"],
      message: missingSpecPolicy === "ask_to_generate_spec"
        ? "当前还没有 decision-complete 的需求规格文档。请先确认是否生成 Spec；确认前不能输出可运行 Goal Prompt。"
        : "当前还没有 decision-complete 的需求规格文档。默认策略是先根据上下文生成 Spec；如果上下文不足，只返回缺失字段和下一步建议，不能先输出临时或短版 Goal Prompt。"
    }, null, 2));
    return;
  }
  const staleInputs = staleSpecInputs(workspace, spec);
  if (staleInputs.length) {
    console.log(JSON.stringify({
      status: "stale_spec",
      ...detail,
      canGenerateGoalPrompt: false,
      specPath: spec,
      staleInputs,
      message: "发现比正式 Spec 更新的 alignment draft、candidate requirements、spec delta 或 TODO。请先更新 Spec、生成 spec delta，或明确排除这些输入后再生成 Goal Prompt。"
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    status: "ok",
    ...detail,
    specPath: spec,
    goalPrompt: goalPrompt(workspace, spec)
  }, null, 2));
}

if (require.main === module) main();
