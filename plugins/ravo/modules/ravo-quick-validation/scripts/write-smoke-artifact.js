#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function loadPmBriefModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-pm-brief.js"),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-pm-brief.js") : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-pm-brief.js") : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO PM Brief module is unavailable.");
  return require(file);
}

const { buildPmBrief } = loadPmBriefModule();

const SCHEMA_VERSION = "0.5.0";
const PRODUCT_VERSION = "0.6.2";
const STATUSES = new Set(["pass", "partial", "warn", "fail", "not_run"]);
const KINDS = new Set(["smoke", "runtime_probe"]);
const CORE_RUNTIME_EVENTS = [];
const OBSERVED_EVIDENCE_STATUSES = new Set(["pass", "missing", "fail"]);
const TERMINAL_TELEMETRY_STATUSES = new Set(["observed", "unknown", "unsupported", "failed"]);
const SUBAGENT_EVIDENCE_STATUSES = new Set(["observed", "missing", "failed", "not_requested"]);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name) values.push(process.argv[i + 1] || "");
  return values.map((value) => value.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || "smoke").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "smoke";
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseObservedEvidence(values) {
  return values.map((value, index) => {
    let entry;
    try { entry = JSON.parse(value); } catch (_error) { fail(`--observed-evidence[${index}] must be valid JSON.`); }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`--observed-evidence[${index}] must be an object.`);
    for (const field of ["event", "status", "sessionId", "promptRef", "expectedAdvisory", "responseSummary", "evidenceRef"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) fail(`--observed-evidence[${index}].${field} is required.`);
    }
    if (!OBSERVED_EVIDENCE_STATUSES.has(entry.status)) fail(`--observed-evidence[${index}].status must be pass, missing, or fail.`);
    return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, typeof child === "string" ? child.trim() : child]));
  });
}

function eventCoverage(expectedEvents, passedEvents) {
  if (!expectedEvents.length) return "not_applicable";
  if (!passedEvents.size) return "none";
  return expectedEvents.every((event) => passedEvents.has(event)) ? "full" : "partial";
}

function coreRuntimeStatus(coreExpectedEvents, observedEvidence) {
  const coreEvidence = observedEvidence.filter((entry) => coreExpectedEvents.includes(entry.event));
  const failed = coreEvidence.some((entry) => entry.status === "fail");
  const passed = new Set(coreEvidence.filter((entry) => entry.status === "pass").map((entry) => entry.event));
  if (failed) return "failed";
  if (!passed.size) return "missing";
  return coreExpectedEvents.every((event) => passed.has(event)) ? "verified" : "partial";
}

function terminalTelemetry(observedEvidence) {
  const explicitStatus = argValue("--terminal-telemetry-status", "");
  if (explicitStatus && !TERMINAL_TELEMETRY_STATUSES.has(explicitStatus)) {
    fail("--terminal-telemetry-status must be observed, unknown, unsupported, or failed.");
  }
  const stopEvidence = observedEvidence.filter((entry) => entry.event === "Stop");
  const passed = stopEvidence.find((entry) => entry.status === "pass");
  const failed = stopEvidence.find((entry) => entry.status === "fail");
  const status = explicitStatus || (passed ? "observed" : failed ? "failed" : "unknown");
  if (status === "observed" && !passed) fail("terminal telemetry observed requires passing Stop evidence.");
  if (status === "failed" && !failed) fail("terminal telemetry failed requires failed Stop evidence.");
  if (["unknown", "unsupported"].includes(status) && (passed || failed)) {
    fail(`terminal telemetry ${status} conflicts with observed Stop evidence.`);
  }
  const summary = argValue("--terminal-telemetry-summary", {
    observed: "Stop runtime evidence was observed for this task.",
    unknown: "Stop runtime evidence was not observed during this task.",
    unsupported: "The current host does not expose Stop runtime evidence.",
    failed: "The Stop hook reported a failure."
  }[status]);
  const evidenceRef = argValue("--terminal-telemetry-evidence-ref", passed?.evidenceRef || failed?.evidenceRef || "");
  if (["observed", "failed"].includes(status) && !evidenceRef) {
    fail(`terminal telemetry ${status} requires an evidence reference.`);
  }
  return { event: "Stop", status, summary, evidenceRef };
}

function subagentEvidenceStatus(observedEvidence) {
  const explicitStatus = argValue("--subagent-evidence-status", "");
  if (explicitStatus && !SUBAGENT_EVIDENCE_STATUSES.has(explicitStatus)) {
    fail("--subagent-evidence-status must be observed, missing, failed, or not_requested.");
  }
  const subagentEvidence = observedEvidence.filter((entry) => entry.event === "SubagentStart");
  const passed = subagentEvidence.some((entry) => entry.status === "pass");
  const missing = subagentEvidence.some((entry) => entry.status === "missing");
  const failed = subagentEvidence.some((entry) => entry.status === "fail");
  const derivedStatus = passed ? "observed" : failed ? "failed" : missing ? "missing" : "not_requested";
  const status = explicitStatus || derivedStatus;
  if (status !== derivedStatus) {
    fail(`subagent evidence ${status} conflicts with SubagentStart evidence (${derivedStatus}).`);
  }
  return status;
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: SCHEMA_VERSION, workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
  manifest.modules = manifest.modules || {};
  manifest.modules["quick-validation"] = {
    ...(manifest.modules["quick-validation"] || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/quick-validation"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: write-smoke-artifact.js --scope <scope> --status <status> [--kind smoke|runtime_probe]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "pass");
  if (!STATUSES.has(status)) fail(`Unsupported smoke status: ${status}`);
  const kind = argValue("--kind", "smoke");
  if (!KINDS.has(kind)) fail(`Unsupported quick-validation kind: ${kind}`);
  const scope = argValue("--scope", "workspace smoke");
  const checks = argValues("--check");
  if (kind === "smoke" && status === "pass" && checks.length === 0) fail("Passing smoke artifact requires at least one --check.");

  const expectedHookEvents = [...new Set(argValues("--expected-hook-event"))];
  const observedEvidence = parseObservedEvidence(argValues("--observed-evidence"));
  const sessionIds = [...new Set(argValues("--session-id"))];
  const promptRefs = [...new Set(argValues("--prompt-ref"))];
  let coverage = "not_applicable";
  let runtimeFields = {};
  if (kind === "runtime_probe") {
    if (!argValue("--fingerprint", "")) fail("Runtime probe requires --fingerprint.");
    if (!expectedHookEvents.length) fail("Runtime probe requires at least one --expected-hook-event.");
    if (!observedEvidence.length) fail("Runtime probe requires at least one --observed-evidence JSON object.");
    if (!sessionIds.length) fail("Runtime probe requires at least one --session-id.");
    if (!promptRefs.length) fail("Runtime probe requires at least one --prompt-ref.");
    for (const entry of observedEvidence) {
      if (!expectedHookEvents.includes(entry.event)) fail(`Observed event is not expected: ${entry.event}`);
      if (!sessionIds.includes(entry.sessionId)) fail(`Observed evidence references undeclared sessionId: ${entry.sessionId}`);
      if (!promptRefs.includes(entry.promptRef)) fail(`Observed evidence references undeclared promptRef: ${entry.promptRef}`);
    }
    for (const event of CORE_RUNTIME_EVENTS) {
      if (!expectedHookEvents.includes(event)) fail(`Runtime probe requires ${event} as an expected hook event.`);
    }
    const requestedCoreEvents = [...new Set(argValues("--core-hook-event"))];
    const coreExpectedEvents = requestedCoreEvents.length ? requestedCoreEvents : CORE_RUNTIME_EVENTS.slice();
    if (!CORE_RUNTIME_EVENTS.every((event) => coreExpectedEvents.includes(event))) {
      fail("Runtime core evidence contains an unsupported event.");
    }
    for (const event of coreExpectedEvents) {
      if (!expectedHookEvents.includes(event)) fail(`Core event is not expected: ${event}`);
    }
    const passedEvents = new Set(observedEvidence.filter((entry) => entry.status === "pass").map((entry) => entry.event));
    coverage = eventCoverage(expectedHookEvents, passedEvents);
    const expectedStatus = coverage === "full" && observedEvidence.every((entry) => entry.status === "pass") ? "pass"
      : coverage === "partial" ? "partial" : "fail";
    if (status !== expectedStatus) fail(`Runtime probe status must be ${expectedStatus} for ${coverage} event coverage.`);
    runtimeFields = {
      coreExpectedEvents,
      coreCoverage: eventCoverage(coreExpectedEvents, passedEvents),
      coreRuntimeStatus: coreRuntimeStatus(coreExpectedEvents, observedEvidence),
      terminalTelemetry: terminalTelemetry(observedEvidence),
      subagentEvidenceStatus: subagentEvidenceStatus(observedEvidence)
    };
  }

  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(scope)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind,
    scope,
    subjectRef: argValue("--subject-ref", ""),
    releaseRef: argValue("--release-ref", ""),
    status,
    checks,
    evidenceRefs: argValues("--evidence-ref"),
    risks: argValues("--risk"),
    ...(kind === "runtime_probe" ? {
      fingerprint: argValue("--fingerprint", ""),
      pluginFingerprint: argValue("--plugin-fingerprint", ""),
      configFingerprint: argValue("--config-fingerprint", ""),
      expectedHookEvents,
      observedEvidence,
      sessionIds,
      promptRefs,
      coverage,
      ...runtimeFields
    } : {}),
    createdAt: now
  };
  const actualEnvironmentVerified = kind === "runtime_probe" && status === "pass";
  artifact.pmBrief = buildPmBrief({
    headline: argValue("--pm-headline", actualEnvironmentVerified
      ? "本机实际使用路径已经验证"
      : status === "pass" ? "自动验证已经通过" : status === "fail" ? "验证发现需要修复的问题" : status === "not_run" ? "验证尚未开始" : "验证仍需继续"),
    stage: actualEnvironmentVerified ? "experience" : "verify",
    productState: actualEnvironmentVerified ? "locally_available" : status === "pass" ? "validated" : status === "fail" ? "blocked" : status === "not_run" ? "planned" : "in_progress",
    userImpact: argValue("--pm-user-impact", actualEnvironmentVerified
      ? "这项能力已在本机真实任务中出现；尚未发布给其他用户。"
      : status === "pass" ? "当前证据支持继续本地交付，但不代表实际使用环境已经更新。" : "现有产品和使用环境保持不变，Codex 会先完成修复或补证。"),
    actionRequired: "none",
    nextStep: argValue("--pm-next-step", actualEnvironmentVerified
      ? "Codex 将整理体验结果并准备产品验收或下一轮优化。"
      : status === "pass" ? "Codex 将继续完成本地集成和实际体验验证。" : "Codex 将处理验证缺口并重新检查。"),
    decisionCard: null,
    evidenceBoundary: {
      proves: argValues("--pm-evidence-proves").length ? argValues("--pm-evidence-proves") : [actualEnvironmentVerified ? "本机核心交互已在真实任务中观察到" : status === "pass" ? "已声明的自动检查通过" : "已记录当前验证结果和缺口"],
      doesNotProve: argValues("--pm-evidence-does-not-prove").length ? argValues("--pm-evidence-does-not-prove") : [actualEnvironmentVerified ? "尚不代表已经发布给其他用户" : "尚不代表本机实际使用路径已经验证"]
    },
    sourceRefs: artifact.evidenceRefs.length ? artifact.evidenceRefs : [`quick-validation:${artifact.id}`]
  });
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "quick-validation", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
