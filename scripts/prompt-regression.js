#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");

function runHook(script, prompt, cwd = repo) {
  const child = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ prompt, cwd }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim() ? JSON.parse(child.stdout) : {};
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const analysisHook = path.join(repo, "plugins/ravo-analysis/hooks/ravo-analysis-gate.js");
const acceptanceHook = path.join(repo, "plugins/ravo-acceptance/hooks/ravo-acceptance-gate.js");
const acceptanceSessionHook = path.join(repo, "plugins/ravo-acceptance/hooks/ravo-acceptance-session.js");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-prompt-"));

const session = spawnSync(process.execPath, [acceptanceSessionHook, "SessionStart"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(session.status, 0, session.stderr);
const sessionOutput = JSON.parse(session.stdout);
assert.equal(sessionOutput.systemMessage, "RAVO_ACCEPTANCE_ACTIVE");
assert.match(sessionOutput.hookSpecificOutput.additionalContext, /proactively run ravo-release-acceptance/);
assert.match(sessionOutput.hookSpecificOutput.additionalContext, /completed, done, or 已完成/);
assert.match(sessionOutput.hookSpecificOutput.additionalContext, /write-acceptance-artifact\.js/);

const requirement = runHook(analysisHook, "我们正在做一个 AI 穿搭小程序，用户上传衣服照片后，系统自动生成衣橱标签。现在我想新增旅行场景穿搭推荐：用户输入目的地、天数、天气和行李箱大小，系统推荐每天穿什么。这个需求先别开发，帮我判断真正的用户是谁、目标是什么、有哪些边界和风险，然后给出推荐方案。", workspace);
assert.equal(requirement.systemMessage, "RAVO_ANALYSIS_GATE:ADVISORY");
assert.match(requirement.hookSpecificOutput.additionalContext, /requirement/);
assert.match(requirement.hookSpecificOutput.additionalContext, /ravo-requirement-analysis/);
assert.match(requirement.hookSpecificOutput.additionalContext, /Required headings: Goal, Consumer, Constraints, Facts, Options, Challenge, Derived Conclusion, Validation/);

const complexArchitecture = runHook(analysisHook, "我们要设计一个面向多团队的 Codex 插件治理方案，涉及安装、权限、hooks、验收证据和长期维护。先不要实现，先分析目标、约束、风险和推荐架构。", workspace);
assert.equal(complexArchitecture.systemMessage, "RAVO_ANALYSIS_GATE:ADVISORY");
assert.match(complexArchitecture.hookSpecificOutput.additionalContext, /ravo-requirement-analysis/);

const rootCause = runHook(analysisHook, "我们的验收插件现在能拦截可以验收了吗，但对这个版本是不是能发没有触发。我觉得这可能只是关键词覆盖问题，也可能是设计模式问题。请继续追问为什么，直到找到可验证、可防复发的机制根因。", workspace);
assert.equal(rootCause.systemMessage, "RAVO_ANALYSIS_GATE:ADVISORY");
assert.match(rootCause.hookSpecificOutput.additionalContext, /root-cause/);
assert.match(rootCause.hookSpecificOutput.additionalContext, /ravo-root-cause-analysis/);
assert.match(rootCause.hookSpecificOutput.additionalContext, /Required headings: Symptom, Proximate Cause, Alternative Hypotheses, Mechanism Root Cause, Why Chain, Boundary, Smallest Fix, Verification/);
assert.ok(fs.existsSync(path.join(workspace, "knowledge/.ravo/manifest.json")), "analysis hook writes manifest");
assert.ok(fs.readdirSync(path.join(workspace, "knowledge/.ravo/analysis")).length >= 2, "analysis hook writes artifacts");
const analysisManifest = readJson(path.join(workspace, "knowledge/.ravo/manifest.json"));
const latestAnalysisPath = path.join(workspace, analysisManifest.modules.analysis.latestArtifact);
assert.equal(readJson(latestAnalysisPath).status, "draft", "analysis hook writes draft artifacts");
assert.equal(analysisManifest.modules.analysis.latestCompleteArtifact || "", "", "analysis hook should not mark placeholder artifact as complete");

const rootCauseAcceptanceBypass = runHook(acceptanceHook, "我们的验收插件现在能拦截可以验收了吗，但对这个版本是不是能发没有触发。请继续追问为什么，直到找到机制根因。", workspace);
assert.deepEqual(rootCauseAcceptanceBypass, {}, "acceptance fallback must not interfere with root-cause analysis prompts");

const trivial = runHook(analysisHook, "把按钮颜色改成红色。");
assert.deepEqual(trivial, {});

const conceptExplanation = runHook(analysisHook, "什么是 worktree？");
assert.deepEqual(conceptExplanation, {}, "simple concept explanations should not trigger RAVO analysis");

const acceptance = runHook(acceptanceHook, "我刚完成了积分扣减功能，代码已经写完但还没做真实小程序端到端验证。这个功能可以验收了吗?", workspace);
assert.equal(acceptance.systemMessage, "RAVO_ACCEPTANCE_GATE:ADVISORY");
assert.match(acceptance.hookSpecificOutput.additionalContext, /Do not block the user message/);

for (const prompt of ["这个版本是不是能发", "这个版本是不是能发版", "这个版本能上线吗"]) {
  const releaseReadiness = runHook(acceptanceHook, prompt, workspace);
  assert.equal(releaseReadiness.systemMessage, "RAVO_ACCEPTANCE_GATE:ADVISORY", prompt);
}

const deliveryConclusion = runHook(acceptanceHook, "我已经把积分扣减功能做完了，代码已经写完，单元测试也过了。请给我一个交付结论和下一步安排。", workspace);
assert.equal(deliveryConclusion.systemMessage, "RAVO_ACCEPTANCE_GATE:ADVISORY");
assert.ok(fs.readdirSync(path.join(workspace, "knowledge/.ravo/acceptance")).length >= 2, "acceptance hook writes artifacts");

const agentsScript = path.join(repo, "plugins/ravo-core/scripts/ravo-agents.js");
const agentsPreview = spawnSync(process.execPath, [agentsScript, "--file", path.join(workspace, "AGENTS.md")], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(agentsPreview.status, 0, agentsPreview.stderr);
assert.match(agentsPreview.stdout, /AGENTS\.md decides when to delegate/);
assert.match(agentsPreview.stdout, /Do not force first-principles structure for simple concept explanations/);

const existingAgentsPath = path.join(workspace, "existing-AGENTS.md");
fs.writeFileSync(existingAgentsPath, "# Existing Rules\n\n- Keep this user-specific rule.\n", "utf8");
const agentsApply = spawnSync(process.execPath, [agentsScript, "--file", existingAgentsPath, "--apply"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(agentsApply.status, 0, agentsApply.stderr);
const updatedAgents = fs.readFileSync(existingAgentsPath, "utf8");
assert.match(updatedAgents, /Keep this user-specific rule/);
assert.match(updatedAgents, /<!-- RAVO:BEGIN -->/);
assert.ok(fs.readdirSync(workspace).some((name) => name.startsWith("existing-AGENTS.md.ravo-bak-")), "AGENTS apply creates a backup");

const agentsIdempotent = spawnSync(process.execPath, [agentsScript, "--file", existingAgentsPath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(agentsIdempotent.status, 0, agentsIdempotent.stderr);
assert.match(agentsIdempotent.stdout, /No changes/);

const readyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-ready-"));
const writerScript = path.join(repo, "plugins/ravo-acceptance/scripts/write-acceptance-artifact.js");
const readyArtifact = spawnSync(process.execPath, [
  writerScript,
  "--workspace", readyWorkspace,
  "--status", "pending_acceptance",
  "--evidence-level", "smoke",
  "--summary", "ready workspace acceptance evidence"
], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(readyArtifact.status, 0, readyArtifact.stderr);

const readyPrompt = runHook(acceptanceHook, "这个版本是不是能发版", readyWorkspace);
assert.deepEqual(readyPrompt, {}, "acceptance fallback should not poison a ready workspace");

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "requirement prompt -> ravo-requirement-analysis advisory",
    "complex architecture prompt -> ravo-requirement-analysis advisory",
    "root-cause prompt -> ravo-root-cause-analysis advisory",
    "root-cause prompt with release wording -> acceptance fallback bypass",
    "trivial prompt -> no advisory",
    "simple concept explanation -> no analysis advisory",
    "session start -> proactive acceptance context",
    "acceptance prompt without evidence -> advisory",
    "release-readiness variants without evidence -> advisory",
    "delivery conclusion prompt without evidence -> advisory",
    "AGENTS preview -> delegated when/how boundary",
    "AGENTS apply -> preserves existing rules and is idempotent",
    "ready workspace prompt -> no fallback interference"
  ]
}, null, 2));
