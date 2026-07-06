#!/usr/bin/env node

const path = require("node:path");
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

function wantsAcceptance(prompt) {
  const text = String(prompt || "").toLowerCase();
  return [
    /(验收通过|可发版|可上线|已上线|已发布|待验收)/,
    /(可以|可|是否|准备).{0,6}(验收|发版|上线)/,
    /(ready for acceptance|acceptance ready|release ready|ready to release|go live|ship it)/
  ].some((pattern) => pattern.test(text));
}

function runChecker(cwd) {
  const script = path.join(__dirname, "..", "scripts", "check-ravo-acceptance.js");
  const child = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    return JSON.parse(String(child.stdout || ""));
  } catch (_err) {
    return {
      status: "not_ready",
      gate: { decision: "block", reason: "Unable to parse RAVO acceptance checker output." }
    };
  }
}

readJsonStdin((data) => {
  if (!wantsAcceptance(data.prompt)) {
    process.stdout.write("{}");
    return;
  }

  const cwd = data.cwd || process.cwd();
  const result = runChecker(cwd);
  if (result.gate?.decision === "pass") {
    process.stdout.write(JSON.stringify({
      systemMessage: "RAVO_ACCEPTANCE_GATE:PASS",
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `RAVO acceptance gate passed. Latest artifact: ${result.latestAcceptance || "<unknown>"}`
      }
    }));
    return;
  }

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: result.gate?.reason || "RAVO acceptance evidence is not ready.",
    systemMessage: "RAVO_ACCEPTANCE_GATE:BLOCK",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        "RAVO acceptance gate blocked this readiness/release claim.",
        result.gate?.reason || "Evidence is incomplete.",
        "Run ravo-release-acceptance or add an acceptance artifact with enough evidence."
      ].join("\n")
    }
  }));
});
