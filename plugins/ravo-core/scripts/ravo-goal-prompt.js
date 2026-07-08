#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
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

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const spec = findSpec(workspace, argValue("--spec", ""));
  if (!spec) {
    console.log(JSON.stringify({
      status: "missing_spec",
      canGenerateGoalPrompt: false,
      forbiddenOutputs: ["short_goal_prompt", "temporary_goal_prompt", "draft_goal_prompt"],
      message: "当前还没有 decision-complete 的需求规格文档。这个目标会长时间自动执行，不能先输出临时或短版 Goal Prompt；建议先生成规格文档，规格确认后再返回文档链接和配套 Goal Prompt。"
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    status: "ok",
    specPath: spec,
    goalPrompt: goalPrompt(workspace, spec)
  }, null, 2));
}

if (require.main === module) main();
