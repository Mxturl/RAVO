#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PRODUCT_VERSION = "0.6.2";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function safeText(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 2000);
}

function parseEvents(stdout) {
  const events = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch (_error) { /* Preserve raw output; malformed lines are diagnostic evidence. */ }
  }
  const thread = events.find((event) => event.type === "thread.started" || event.thread_id || event.threadId);
  const turn = events.find((event) => event.type === "turn.started" || event.turn_id || event.turnId);
  const messages = events.filter((event) => event.type === "item.completed" && (event.item?.type === "agent_message" || event.item?.role === "assistant"));
  const finalMessage = messages.at(-1);
  const responseSummary = safeText(finalMessage?.item?.text || finalMessage?.item?.content || finalMessage?.text || "");
  return {
    events,
    sessionId: thread?.thread_id || thread?.threadId || thread?.session_id || thread?.sessionId || null,
    threadId: thread?.thread_id || thread?.threadId || thread?.session_id || thread?.sessionId || null,
    turnId: turn?.turn_id || turn?.turnId || null,
    responseSummary
  };
}

function hasPmActionRequest(response) {
  return /(?:需你(?:操作|决定)|你(?:只)?需[^。]{0,24}(?:批准|权限)|你负责[^。]{0,24}(?:批准|权限)|请[^。]{0,24}(?:批准|权限)|(?:产品经理|PM)(?:现在)?(?:只)?(?:需|需要|应)[^。]{0,24}(?:确认|决定|批准|权限))/.test(String(response || ""));
}

function pmStatusViolations(response) {
  const text = String(response || "").trim();
  const violations = [];
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (!/(?:结论|结果|当前|目前|已|本次|RAVO|使用|体验|影响|建议|无需|需要)/.test(firstLine)) violations.push("must_lead_with_product_result");
  if (hasPmActionRequest(text)) violations.push("unexpected_pm_action");
  if (/(?:\b(?:Hook|Runtime|cache|PM Brief)\b|缓存|探针|验收门禁|状态页|完整性状态|RAVO (?:Release Acceptance|Knowledge))/.test(text)) violations.push("internal_evidence_in_pm_status");
  if (text.length > 800) violations.push("pm_status_too_long");
  return violations;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-fresh-session-e2e.js --workspace <path> --prompt-file <path> --output <path> [--pm-status] [--pm-no-action] [identity options]");
    return;
  }
  if (process.argv.includes("--version")) { console.log(PRODUCT_VERSION); return; }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const promptFile = argValue("--prompt-file", "");
  const prompt = promptFile ? fs.readFileSync(path.resolve(workspace, promptFile), "utf8") : argValue("--prompt", "");
  if (!prompt.trim()) throw new Error("A non-empty --prompt or --prompt-file is required.");
  const output = path.resolve(workspace, argValue("--output", path.join("knowledge", ".ravo", "acceptance", `fresh-session-${Date.now()}.json`)));
  const responseFile = path.resolve(workspace, argValue("--response-output", `${output}.response.txt`));
  const startedAt = new Date().toISOString();
  const child = spawnSync("codex", ["exec", "--json", "--sandbox", "read-only", "--cd", workspace, "--output-last-message", responseFile, prompt], {
    cwd: workspace,
    encoding: "utf8",
    timeout: Number(argValue("--timeout-ms", "900000")),
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const completedAt = new Date().toISOString();
  const parsed = parseEvents(child.stdout);
  const responseFromFile = fs.existsSync(responseFile) ? safeText(fs.readFileSync(responseFile, "utf8")) : "";
  const responseSummary = parsed.responseSummary || responseFromFile;
  const responseContract = process.argv.includes("--pm-status")
    ? { id: "pm_status", status: pmStatusViolations(responseSummary).length ? "fail" : "pass", violations: pmStatusViolations(responseSummary) }
    : process.argv.includes("--pm-no-action")
      ? { id: "pm_no_action", status: hasPmActionRequest(responseSummary) ? "fail" : "pass" }
      : { id: "none", status: "not_requested" };
  const result = child.status === 0 && parsed.sessionId && responseSummary && responseContract.status !== "fail" ? "pass" : child.error?.code === "ETIMEDOUT" ? "blocked" : "fail";
  const artifact = {
    schemaVersion: "0.5.5",
    sessionId: parsed.sessionId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    baselineId: argValue("--baseline-id", ""),
    pluginVersion: argValue("--plugin-version", PRODUCT_VERSION),
    controllerVersion: argValue("--controller-version", PRODUCT_VERSION),
    installedRoot: argValue("--installed-root", ""),
    actualEntrypoint: argValue("--actual-entrypoint", ""),
    resolutionSource: argValue("--resolution-source", ""),
    sourceFingerprint: argValue("--source-fingerprint", ""),
    cacheFingerprint: argValue("--cache-fingerprint", ""),
    runtimeFingerprint: argValue("--runtime-fingerprint", ""),
    promptRef: promptFile || "inline_prompt",
    responseRef: path.relative(workspace, responseFile).split(path.sep).join("/"),
    responseSummary,
    responseContract,
    sideEffects: {
      artifact: argValue("--artifact-side-effect", "unknown"),
      skillRead: argValue("--skill-read", "unknown"),
      subagent: argValue("--subagent-side-effect", "unknown"),
      formalReview: argValue("--formal-review-side-effect", "unknown")
    },
    startedAt,
    completedAt,
    result,
    sourceDefect: responseContract.status === "fail",
    exitCode: child.status,
    stderr: safeText(child.stderr),
    rawEventCount: parsed.events.length,
    evidence: {
      rawEventsRef: path.relative(workspace, `${output}.jsonl`).split(path.sep).join("/"),
      responseFile: path.relative(workspace, responseFile).split(path.sep).join("/")
    }
  };
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${output}.jsonl`, child.stdout || "", { mode: 0o600 });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: result === "pass" ? "ok" : result, artifactPath: output, sessionId: artifact.sessionId, threadId: artifact.threadId, responseRef: artifact.responseRef, result }, null, 2));
  if (result !== "pass") process.exitCode = 2;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "error", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { hasPmActionRequest, parseEvents, pmStatusViolations, safeText };
