#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function latestJson(dir) {
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => path.join(dir, file)).sort().at(-1) || "";
  } catch (_err) {
    return "";
  }
}

function buildResult(cwd = process.cwd()) {
  const root = path.join(cwd, "knowledge", ".ravo");
  const manifest = readJson(path.join(root, "manifest.json"));
  const latest = manifest?.modules?.["quick-validation"]?.latestArtifact
    ? path.join(cwd, manifest.modules["quick-validation"].latestArtifact)
    : latestJson(path.join(root, "quick-validation"));
  const artifact = latest ? readJson(latest) : null;
  const checks = [];
  checks.push({ id: "smokeArtifact", required: true, status: artifact ? "pass" : "fail", summary: artifact ? "Smoke artifact exists." : "Smoke artifact is missing." });
  const layeredCoreReady = artifact?.kind === "runtime_probe"
    && (artifact.coreRuntimeStatus === "verified"
      || (Array.isArray(artifact.coreExpectedEvents) && artifact.coreExpectedEvents.length === 0 && artifact.terminalTelemetry?.status === "observed"))
    && ["observed", "unknown", "unsupported", "failed"].includes(artifact.terminalTelemetry?.status);
  const pass = artifact && (["pass", "warn"].includes(artifact.status) || layeredCoreReady) && !(artifact.risks || []).includes("real-device-pending");
  const summary = layeredCoreReady && artifact.status === "partial"
    ? "The available v0.6 Runtime evidence is usable; optional Hook coverage remains explicit."
    : pass ? "Smoke status is usable." : "Smoke status blocks readiness.";
  checks.push({ id: "smokeStatus", required: true, status: pass ? "pass" : "fail", summary });
  const failed = checks.filter((check) => check.required && check.status === "fail");
  return {
    status: failed.length ? "not_ready" : "ready",
    gate: { decision: failed.length ? "block" : "pass", reason: failed.length ? failed.map((check) => check.summary).join(" ") : "Smoke evidence is ready." },
    latestSmoke: artifact ? latest : "",
    checks
  };
}

function main() {
  const result = buildResult(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ready") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { buildResult };
