#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function latestJson(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .sort()
      .at(-1) || "";
  } catch (_err) {
    return "";
  }
}

function discoverLatest(cwd, manifest, moduleName, dirName) {
  return manifest?.modules?.[moduleName]?.latestArtifact
    ? path.join(cwd, manifest.modules[moduleName].latestArtifact)
    : latestJson(path.join(cwd, "knowledge", ".ravo", dirName));
}

function addCheck(checks, id, status, required, summary) {
  checks.push({ id, status, required, summary });
}

function buildResult(cwd = process.cwd()) {
  const ravoRoot = path.join(cwd, "knowledge", ".ravo");
  const manifestPath = path.join(ravoRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const checks = [];

  addCheck(checks, "manifest", manifest ? "pass" : "fail", true, manifest ? "RAVO manifest exists." : "knowledge/.ravo/manifest.json is missing.");

  const analysisDir = path.join(ravoRoot, "analysis");
  const latestAnalysis = manifest?.modules?.analysis?.latestCompleteArtifact
    ? path.join(cwd, manifest.modules.analysis.latestCompleteArtifact)
    : manifest?.modules?.analysis?.latestArtifact
      ? path.join(cwd, manifest.modules.analysis.latestArtifact)
    : latestJson(analysisDir);
  const analysisExists = Boolean(latestAnalysis && fs.existsSync(latestAnalysis));
  addCheck(checks, "analysisDiscovery", analysisExists ? "pass" : "skip", false, analysisExists ? "Latest analysis artifact discovered." : "No upstream analysis artifact found; standalone acceptance mode.");

  const latestWorkstream = discoverLatest(cwd, manifest, "workstream", "workstream");
  const workstream = readJson(latestWorkstream);
  if (workstream) {
    const workstreamReady = !["blocked"].includes(workstream.status) && (workstream.status !== "active" || Boolean(workstream.nextStep));
    addCheck(checks, "workstreamEvidence", workstreamReady ? "pass" : "fail", true, workstreamReady ? "Workstream evidence is usable." : "Workstream is blocked or missing nextStep.");
  } else {
    addCheck(checks, "workstreamEvidence", "skip", false, "No workstream artifact found; standalone acceptance mode.");
  }

  const latestSmoke = discoverLatest(cwd, manifest, "quick-validation", "quick-validation");
  const smoke = readJson(latestSmoke);
  if (smoke) {
    const smokeReady = ["pass", "warn"].includes(smoke.status) && !(smoke.risks || []).includes("real-device-pending");
    addCheck(checks, "quickValidationEvidence", smokeReady ? "pass" : "fail", true, smokeReady ? "Quick validation evidence is usable." : "Quick validation evidence blocks readiness.");
  } else {
    addCheck(checks, "quickValidationEvidence", "skip", false, "No quick-validation artifact found; standalone acceptance mode.");
  }

  const acceptanceDir = path.join(ravoRoot, "acceptance");
  const latestAcceptance = manifest?.modules?.acceptance?.latestArtifact
    ? path.join(cwd, manifest.modules.acceptance.latestArtifact)
    : latestJson(acceptanceDir);
  const acceptance = readJson(latestAcceptance);
  addCheck(checks, "acceptanceArtifact", acceptance ? "pass" : "fail", true, acceptance ? "Acceptance artifact exists." : "Acceptance artifact is missing.");

  const readyStatuses = new Set(["pending_acceptance", "accepted", "release_ready"]);
  const readyEvidence = new Set(["api", "smoke", "real_e2e"]);
  const statusReady = acceptance && readyStatuses.has(acceptance.status);
  const evidenceReady = acceptance && readyEvidence.has(acceptance.evidenceLevel);
  addCheck(checks, "statusEvidence", statusReady && evidenceReady ? "pass" : "fail", true, statusReady && evidenceReady ? "Status is supported by evidence level." : "Acceptance status is not supported by enough evidence.");

  const blocking = checks.filter((check) => check.required && check.status === "fail");
  return {
    status: blocking.length ? "not_ready" : "ready",
    gate: {
      decision: blocking.length ? "block" : "pass",
      reason: blocking.length ? blocking.map((check) => check.summary).join(" ") : "RAVO acceptance evidence is ready."
    },
    manifestPath,
    latestAnalysis: analysisExists ? latestAnalysis : "",
    latestWorkstream: workstream ? latestWorkstream : "",
    latestSmoke: smoke ? latestSmoke : "",
    latestAcceptance: acceptance ? latestAcceptance : "",
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
