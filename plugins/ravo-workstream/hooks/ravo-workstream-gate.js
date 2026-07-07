#!/usr/bin/env node

function readStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try { callback(JSON.parse(input.replace(/^\uFEFF/, ""))); }
    catch (_err) { callback({}); }
  });
}

function wantsWorkstream(prompt) {
  const text = String(prompt || "");
  if (/(验收|发版|上线|release|acceptance|ready)/i.test(text)) return false;
  return /(目标模式|长时间|长任务|多阶段|里程碑|workstream|milestone|subagent|子\s*Agent|并行)/i.test(text);
}

readStdin((data) => {
  if (!wantsWorkstream(data.prompt)) {
    process.stdout.write("{}");
    return;
  }
  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_WORKSTREAM:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        "RAVO workstream may apply to this long-running task.",
        "Keep or create a workstream artifact with status, currentMilestone, nextStep, blockers, decisions, and evidenceRefs.",
        "Do not treat workstream as release readiness; hand evidence to ravo-acceptance."
      ].join("\n")
    }
  }));
});
