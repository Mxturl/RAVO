#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readJsonStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      callback(JSON.parse(input.replace(/^\uFEFF/, "")));
    } catch (_error) {
      callback({});
    }
  });
}

function affirmativeMatch(text, expression) {
  const pattern = new RegExp(expression.source, expression.flags.includes("g") ? expression.flags : `${expression.flags}g`);
  for (const match of text.matchAll(pattern)) {
    const sentenceStart = Math.max(
      text.lastIndexOf("。", match.index),
      text.lastIndexOf("！", match.index),
      text.lastIndexOf("？", match.index),
      text.lastIndexOf("\n", match.index),
      text.lastIndexOf(";", match.index),
      text.lastIndexOf("；", match.index)
    );
    const before = text.slice(sentenceStart + 1, match.index);
    const clauseBoundary = /(?:[,，]\s*|\b(?:but|however|yet)\b|但(?:是)?|不过|然而)/gi;
    let clauseStart = 0;
    for (const boundary of before.matchAll(clauseBoundary)) clauseStart = boundary.index + boundary[0].length;
    const clause = `${before.slice(clauseStart)}${match[0]}`;
    if (/(?:不|未|无|没有|并未|尚未|不能|不得|不可|并非|不要|禁止|(?:被)?误判(?:为)?|误认为|错误地?(?:判断|认为|声称)|\b(?:not|never|without|cannot|can't|isn't|aren't|wasn't|weren't|won't|wouldn't|shouldn't|couldn't|don't|doesn't|didn't|hasn't|haven't|hadn't|mustn't|shan't|ain't|may\s+not|might\s+not|must\s+not|do\s+not)\b)/i.test(clause)) continue;
    return true;
  }
  return false;
}

function hasAcceptanceHandoffLanguage(message) {
  const text = String(message || "");
  return /pending[_ -]?acceptance|candidate[_ -]?ready|等待(?:PM|产品经理|用户)?(?:确认|验收|签署)|待(?:PM|产品经理|用户)?(?:确认|验收|签署)|验收(?:包|文档).{0,12}(?:已|已经)?(?:提交|发出|交付)|(?:只|仅|剩下).{0,12}(?:PM|产品经理|人工|外部)/i.test(text);
}

function shouldIgnoreReadinessClaim(message) {
  const text = String(message || "");
  if (hasAcceptanceHandoffLanguage(text)) return true;
  if (/(?:not[_ -]?ready|不得|不应|不能|不可|不要|禁止|尚未|未完成|未验收|未发布|没有完成|证据不足)/i.test(text)
    && /(?:完成|验收|accepted|release[_ -]?ready|可发版|可发布|上线|发布)/i.test(text)) return true;
  if (/(?:候选|分析|审计|根因|说明|定义|需求池|规格书)/i.test(text)
    && !/(?:交付结论|当前状态|收口状态|验收包|等待|下一步)/i.test(text)) return true;
  return false;
}

function readinessClaimLevel(message) {
  const text = String(message || "");
  if (shouldIgnoreReadinessClaim(text)) return "none";
  if (affirmativeMatch(text, /(可发版|可上线|已上线|已发布|release[_ -]?ready|ready to release|ready to ship|(?:ready|cleared|approved|safe) to go live|(?:release|version|deployment|product|app|site).{0,12}(?:is|went|now) live)/i)) return "release";
  if (affirmativeMatch(text, /(验收通过|\baccepted\b)/i)) return "accepted";
  if (affirmativeMatch(text, /(?:版本|项目|交付|目标|v\d+\.\d+(?:\.\d+)?).{0,16}(已完成|完成了|做完了)|(?:project|version|delivery|release|goal|v\d+\.\d+(?:\.\d+)?).{0,16}(done|completed|complete)/i)) return "release_completion";
  if (affirmativeMatch(text, /(?:代码|功能|任务).{0,16}(已完成|完成了|做完了)|(?:code|feature|task).{0,16}(done|completed|complete)/i)) return "completion";
  return "none";
}

function assertionText(message) {
  return String(message || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/[“\"][^”\"\n]{0,240}[”\"]/g, " ")
    .replace(/[‘'][^’'\n]{0,240}[’']/g, " ");
}

function hasPoolDisposition(message) {
  const text = String(message || "");
  return /(?:已|已经|现已).{0,36}(?:记录|写入|入池|捕获|合并|更新|补充).{0,60}(?:需求|问题|经验|原则|决定|候选|candidate|Pool|Knowledge|需求池|问题池|经验池)/i.test(text)
    || /(?:无需|不需要|不必|不应).{0,20}(?:入池|记录|持久化)/i.test(text)
    || /(?:已|已经|现已)?.{0,20}(?:进入|写入|记录到).{0,20}Spec\s*Delta/i.test(text);
}

function isExplanatoryOrTentative(sentence) {
  const text = String(sentence || "");
  if (/(?:机制说明|规则说明|示例|例如|比如|测试用例|检查逻辑|Hook|正则|关键词|引用)/i.test(text)) return true;
  if (/(?:脑暴|设想|假设|也许|或许|纯讨论|尚未形成|还没有形成)/i.test(text)
    && !/(?:已决定|已确认|决定将|确认将)/i.test(text)) return true;
  return false;
}

function hasUndisposedPoolSignal(message) {
  const text = assertionText(message);
  if (!text.trim() || hasPoolDisposition(text)) return false;
  const sentences = text.split(/(?<=[。！？!?;；\n])/).map((value) => value.trim()).filter(Boolean);
  const patterns = [
    /(?:这|该|它)(?:是|属于|构成|形成了?)(?:一项|一个)?(?:明确的?)?(?:新需求|范围外问题|有后续价值的问题|可复用经验|产品决定)/i,
    /(?:识别|发现)(?:到|了|出)?(?:一项|一个)?(?:明确的?)?(?:新需求|范围外问题|有后续价值的问题|可复用经验)/i,
    /(?:新增|提出|收到)(?:了)?(?:一项|一个)?(?:产品)?需求/i,
    /(?:形成|沉淀)(?:了)?(?:一项|一条|一个)?(?:可复用的?)?(?:经验|原则|方法|风险提醒)/i,
    /(?:PM|产品经理|本轮|我们)(?:已经|已)?(?:决定|确认)(?:将|把|采用|拒绝|延期|合并)/i,
    /(?:将|把).{1,80}(?:列为|作为|纳入).{0,20}(?:下一|下个)版本(?:候选|考虑)/i
  ];
  return sentences.some((sentence) => {
    if (isExplanatoryOrTentative(sentence)) return false;
    return patterns.some((pattern) => affirmativeMatch(sentence, pattern));
  });
}

function claimSupported(level, result) {
  if (result?.gate?.decision !== "pass") return false;
  if (level === "release") {
    return result.acceptanceScope === "release"
      && result.acceptanceStatus === "release_ready"
      && result.releaseEligible === true;
  }
  if (["accepted", "release_completion"].includes(level)) {
    return result.acceptanceScope === "release"
      && ["accepted", "release_ready"].includes(result.acceptanceStatus);
  }
  return level === "completion";
}

function runChecker(cwd) {
  const script = path.join(__dirname, "..", "scripts", "check-ravo-acceptance.js");
  const child = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  try {
    return JSON.parse(String(child.stdout || ""));
  } catch (_error) {
    return { gate: { decision: "block", reason: "Unable to parse RAVO acceptance checker output." } };
  }
}

function handle(data, options = {}) {
  // Codex sets this on the stop event caused by a previous Stop-hook continuation.
  if (data.stop_hook_active === true || data.stopHookActive === true) return {};

  const message = data.last_assistant_message || data.lastAssistantMessage || "";
  const claimLevel = readinessClaimLevel(message);
  const poolDispositionMissing = hasUndisposedPoolSignal(message);
  const mismatches = [];
  if (claimLevel !== "none") {
    const checker = options.runChecker || runChecker;
    const result = checker(data.cwd || data.workspace || process.cwd());
    if (!claimSupported(claimLevel, result)) mismatches.push(result?.gate?.decision === "pass"
      ? `The ${claimLevel} claim exceeds acceptanceScope=${result.acceptanceScope || "unknown"}, acceptanceStatus=${result.acceptanceStatus || "unknown"}, releaseEligible=${result.releaseEligible === true}.`
      : result?.gate?.reason || "Required RAVO acceptance evidence is incomplete.");
  }
  if (poolDispositionMissing) mismatches.push("The response states a new requirement, follow-up issue, reusable lesson, or product decision without saying whether it was recorded, merged, updated, moved to Spec Delta, or intentionally not persisted.");
  if (!mismatches.length) return {};
  return {
    decision: "block",
    reason: `RAVO evidence and Pool check: ${mismatches.join(" ")} Correct the response once: match status claims to evidence and explicitly dispose of any strong Pool signal by recording, merging, updating, using Spec Delta, or stating why no persistence is needed. Do not request another PM confirmation for a decision the user already made.`
  };
}

if (require.main === module) {
  readJsonStdin((data) => {
    process.stdout.write(JSON.stringify(handle(data)));
  });
}

module.exports = {
  affirmativeMatch,
  claimSupported,
  handle,
  hasAcceptanceHandoffLanguage,
  hasPoolDisposition,
  hasUndisposedPoolSignal,
  readinessClaimLevel,
  runChecker,
  shouldIgnoreReadinessClaim
};
