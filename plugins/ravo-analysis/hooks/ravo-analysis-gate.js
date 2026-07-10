#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function readJsonStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      callback(JSON.parse(input.replace(/^\uFEFF/, "")));
    } catch (_err) {
      callback({});
    }
  });
}

function shortTitle(prompt, kind) {
  return String(prompt || kind)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || kind;
}

function writeArtifact(cwd, kind, prompt) {
  const script = path.join(__dirname, "..", "scripts", "write-analysis-artifact.js");
  const args = [
    script,
    "--workspace", cwd,
    "--type", kind,
    "--status", "draft",
    "--title", shortTitle(prompt, kind),
    "--conclusion", "Pending RAVO analysis artifact created from natural prompt trigger."
  ];
  if (kind === "root-cause") {
    args.push("--symptom", shortTitle(prompt, kind));
  }
  const child = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  try {
    return JSON.parse(String(child.stdout || "{}")).artifactPath || "";
  } catch (_err) {
    return "";
  }
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function mergeConfig(base, override) {
  return { ...base, ...(override || {}) };
}

function technicalDetailContext(cwd) {
  const config = mergeConfig(
    readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json")),
    readJson(path.join(cwd, "knowledge", ".ravo", "config.json"))
  );
  let level = config.technicalDetailLevel;
  if (!Number.isInteger(level) || level < 1 || level > 5) level = 3;
  const label = level <= 2 ? "plain-language" : level >= 4 ? "engineering-detail" : "balanced";
  return `technicalDetailLevel=${level} (${label}); this changes explanation depth only, not rigor, safety, evidence, or data-boundary requirements.`;
}

function isGoalPromptRequest(text) {
  return matchesAny(text, [
    /goal\s*-?\s*mode|goal\s*prompt|goal\s*模式.*prompt|codex\s*goal/i,
    /目标模式|目标\s*prompt|goal\s*提示词/i,
    /自动开发.*prompt|长时间自动执行.*prompt/i
  ]);
}

function classify(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  const noCodeYet = /(先别开发|先不要开发|先不要实现|先不要改代码|不要急着写代码|before implementation|do not implement yet)/i.test(text);

  const rootCause = matchesAny(text, [
    /根因|机制根因|五个\s*why|5\s*why|为什么.*为什么|防复发|复发风险/,
    /为什么会出现这种问题|为什么会出现.*问题|问题.*反复出现/,
    /(问题|挑战|失败|异常|卡住|阻塞).*(为什么|原因|分析|根因|复盘|防止|避免)/,
    /symptom|proximate cause|mechanism root cause|root cause|why chain/i
  ]);
  if (rootCause) return "root-cause";

  if (isGoalPromptRequest(text)) return "goal-prompt";

  const requirement = matchesAny(text, [
    /需求|方案|架构|产品|用户是谁|消费者|目标是什么|边界|风险|权衡|推荐方案|采用成本|维护风险/,
    /我想(加|新增|做).*(功能|能力|推荐|工具)|该不该做|第一版|先别动代码.*捋/,
    /requirement|solution|architecture|consumer|tradeoff|constraints?|risk|proposal/i
  ]);
  if (requirement && noCodeYet) return "requirement";
  if (requirement && text.length >= 60) return "requirement";
  return "";
}

readJsonStdin((data) => {
  const kind = classify(data.prompt);
  if (!kind) {
    process.stdout.write("{}");
    return;
  }

  const skill = kind === "root-cause"
    ? "ravo-root-cause-analysis"
    : kind === "goal-prompt"
      ? "ravo-core, then ravo-requirement-analysis if no decision-complete spec exists"
      : "ravo-requirement-analysis";
  const cwd = data.cwd || process.cwd();
  const artifactPath = kind === "goal-prompt" ? "" : writeArtifact(cwd, kind, data.prompt);
  const chinese = /[\u4e00-\u9fff]/.test(String(data.prompt || ""));
  const contract = kind === "root-cause"
    ? chinese
      ? "必需标题：现象、近因、备选假设、机制根因、追问链、边界、最小修复、验证。每个字段单独成段或条目；不要把多个标签挤进同一段。定稿根因前至少检验一个合理备选假设。"
      : "Required headings: Symptom, Proximate Cause, Alternative Hypotheses, Mechanism Root Cause, Why Chain, Boundary, Smallest Fix, Verification. Put each field on its own line or bullet; do not inline multiple labels into one dense paragraph. Test at least one plausible alternative before locking the root cause."
    : kind === "goal-prompt"
      ? "Goal Prompt Contract: before writing any Goal Prompt, check for a decision-complete spec with ravo-core/ravo-goal-prompt. If missing_spec or stale_spec, do not output any runnable Goal Prompt, including short, temporary, or draft versions. If stale_spec, first update the Spec, write a spec delta, or explicitly exclude newer candidate inputs. If the user only asked for a Goal Prompt, stop after explaining the missing/stale Spec condition."
    : chinese
      ? "必需标题：需求共创、目标、真实消费者、约束、事实、方案选项、可能盲区、挑战、推导结论、验证。每个字段单独成段或条目；不要把多个标签挤进同一段。中高复杂需求先补齐背景/现状/场景/消费者/痛点/参考对象，并提供“继续澄清 / 直接进入方案”。可能盲区必须包含判断和建议动作，不只是提示风险。至少给出两个带权衡的方案，区分事实和假设，分析结论前不要开始实现。"
      : "Required headings: Requirement Co-Creation, Goal, Consumer, Constraints, Facts, Options, Blind Spots, Challenge, Derived Conclusion, Validation. Put each field on its own line or bullet; do not inline multiple labels into one dense paragraph. For medium/high-complexity requirements, cover background/current state/scenarios/consumer/pain/reference and offer Continue Clarifying / Direct To Solution. Blind spots must include judgment and suggested action, not only risk hints. Include at least two options with tradeoffs, separate facts from assumptions, and do not start implementation before the analysis conclusion.";

  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_ANALYSIS_GATE:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        `RAVO analysis trigger matched: ${kind}.`,
        `Prefer skill: ${skill}.`,
        artifactPath
          ? `RAVO analysis artifact created: ${artifactPath}`
          : kind === "goal-prompt"
            ? "No analysis artifact is written for Goal Prompt preflight until a decision-complete spec exists or the user approves spec creation."
            : "RAVO analysis artifact should be created under knowledge/.ravo/analysis.",
        technicalDetailContext(cwd),
        contract,
        "If the task is trivial or clearly implementation-only, ignore this advisory."
      ].join("\n")
    }
  }));
});
