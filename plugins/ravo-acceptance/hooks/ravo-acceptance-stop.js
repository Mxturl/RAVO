#!/usr/bin/env node

const fs = require("node:fs");
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function hasReadinessClaim(message) {
  return /(验收通过|可发版|可上线|已上线|已发布|accepted|release[_ -]?ready|ready to release|ready to ship|\bgo live\b|\blive\b|(?:代码|功能|版本|任务|交付).{0,12}(已完成|完成了|做完了)|(?:code|feature|version|task|delivery).{0,16}(done|completed|complete))/i
    .test(String(message || ""));
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
  } catch (_err) {
    return { gate: { decision: "block", reason: "Unable to parse RAVO acceptance checker output." } };
  }
}

function writePendingContinuation(cwd, message, reason) {
  const now = new Date().toISOString();
  const root = path.join(cwd, "knowledge", ".ravo");
  const dir = path.join(root, "continuation");
  const id = `${now.replace(/[:.]/g, "-")}-acceptance-stop-telemetry`;
  const artifactPath = path.join(dir, `${id}.json`);
  const artifact = {
    schemaVersion: "0.1.2",
    id,
    type: "acceptance-stop-telemetry",
    status: "pending",
    createdAt: now,
    reason,
    lastAssistantMessage: String(message || "").slice(0, 2000),
    instruction: "Before continuing, reconcile the previous readiness claim with RAVO acceptance evidence. If evidence is incomplete, correct the status and list missing evidence."
  };

  writeJson(artifactPath, artifact);

  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: "0.1.2", workspace: ".", modules: {} };
  manifest.modules = manifest.modules || {};
  manifest.modules.continuation = {
    ...(manifest.modules.continuation || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/continuation"],
    latestArtifact: path.relative(cwd, artifactPath),
    updatedAt: now
  };
  writeJson(manifestPath, manifest);
  return artifactPath;
}

readJsonStdin((data) => {
  const cwd = data.cwd || data.workspace || process.cwd();
  const message = data.last_assistant_message || data.lastAssistantMessage || "";
  if (!hasReadinessClaim(message)) {
    process.stdout.write("{}");
    return;
  }

  const result = runChecker(cwd);
  if (result.gate?.decision === "pass") {
    process.stdout.write("{}");
    return;
  }

  const artifactPath = writePendingContinuation(cwd, message, result.gate?.reason || "RAVO acceptance evidence is incomplete.");
  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_STOP_TELEMETRY_RECORDED",
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `RAVO stop telemetry recorded a pending continuation: ${artifactPath}`
    }
  }));
});
