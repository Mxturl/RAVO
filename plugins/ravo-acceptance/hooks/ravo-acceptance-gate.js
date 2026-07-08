#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
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
  if (/(根因|原因|为什么|追问为什么|机制根因|先分析|分析一下|root.?cause|why chain)/i.test(text)) {
    return false;
  }

  return [
    /(验收通过|可发版|可上线|已上线|已发布|待验收)/,
    /(可以|可|是否|准备|能否|是不是).{0,6}(验收|发版|发布|上线)/,
    /版本.{0,8}(可以|可|能|能否|是否|是不是).{0,4}(发|发版|发布|上线|验收)/,
    /(交付结论|交付状态|发布结论|上线结论|下一步安排)/,
    /(代码|功能|版本).{0,12}(写完|做完|完成|已完成).{0,20}(测试|单元测试|验证|交付)/,
    /(ready for acceptance|acceptance ready|release ready|ready to release|ready to ship|delivery status|status conclusion|go live|ship it)/
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function consumePendingContinuation(cwd, data) {
  const dir = path.join(cwd, "knowledge", ".ravo", "continuation");
  let latest = "";
  try {
    latest = fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .sort()
      .at(-1) || "";
  } catch (_err) {
    return null;
  }
  const artifact = latest ? readJson(latest) : null;
  if (!artifact || artifact.status !== "pending") return null;
  const currentThread = data.session_id || data.sessionId || "";
  const sameWorkspace = !artifact.targetWorkspace || path.resolve(artifact.targetWorkspace) === path.resolve(cwd);
  const sameThread = !artifact.threadId || !currentThread || artifact.threadId === currentThread;
  if (!sameWorkspace || !sameThread) {
    artifact.status = "out_of_scope";
    artifact.outOfScopeAt = new Date().toISOString();
    artifact.outOfScopeReason = !sameWorkspace ? "workspace_mismatch" : "thread_mismatch";
    writeJson(latest, artifact);
    return null;
  }
  artifact.status = "consumed";
  artifact.consumedAt = new Date().toISOString();
  writeJson(latest, artifact);
  return { path: latest, artifact };
}

function writeNotReadyArtifact(cwd, prompt, reason) {
  const script = path.join(__dirname, "..", "scripts", "write-acceptance-artifact.js");
  spawnSync(process.execPath, [
    script,
    "--workspace", cwd,
    "--status", "not_ready",
    "--evidence-level", "none",
    "--summary", [
      String(prompt || "Delivery status prompt").replace(/\s+/g, " ").trim().slice(0, 80) || "Delivery status prompt",
      reason ? `| ${String(reason).slice(0, 120)}` : ""
    ].join(" ").trim()
  ], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"]
  });
}

readJsonStdin((data) => {
  const cwd = data.cwd || process.cwd();
  const continuation = consumePendingContinuation(cwd, data);

  if (!wantsAcceptance(data.prompt)) {
    if (continuation) {
      process.stdout.write(JSON.stringify({
        systemMessage: "RAVO_STOP_TELEMETRY:ADVISORY",
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: [
            "RAVO stop telemetry found a pending continuation from the previous assistant response.",
            continuation.artifact.instruction,
            `Artifact: ${continuation.path}`
          ].join("\n")
        }
      }));
      return;
    }
    process.stdout.write("{}");
    return;
  }

  const result = runChecker(cwd);
  if (result.gate?.decision === "pass") {
    process.stdout.write("{}");
    return;
  }

  writeNotReadyArtifact(cwd, data.prompt, result.gate?.reason);

  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_ACCEPTANCE_GATE:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        "RAVO acceptance advisory matched a readiness or delivery-status prompt.",
        continuation ? `Pending stop telemetry was consumed: ${continuation.path}` : "",
        "Do not block the user message. Answer the question normally.",
        result.gate?.reason || "Evidence is incomplete.",
        "If evidence is incomplete, answer with not_ready, code_complete, or in_progress and list the missing evidence.",
        "Run ravo-release-acceptance or add an acceptance artifact with enough evidence before claiming accepted, release_ready, or live."
      ].join("\n")
    }
  }));
});
