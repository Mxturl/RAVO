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

function discoverKnowledge(cwd, manifest) {
  const latest = discoverLatest(cwd, manifest, "knowledge", "knowledge");
  if (latest && fs.existsSync(latest)) return latest;
  const indexPath = path.join(cwd, "knowledge", ".ravo", "knowledge", "index.json");
  return fs.existsSync(indexPath) ? indexPath : "";
}

function addCheck(checks, id, status, required, summary) {
  checks.push({ id, status, required, summary });
}

function securityReady(acceptance) {
  const checklist = acceptance?.securityChecklist;
  if (!Array.isArray(checklist) || checklist.length === 0) return false;
  return checklist.every((item) => item.status === "pass");
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
  const readyEvidence = new Set(["api", "smoke", "real_e2e", "full_external_review", "partial_external_review"]);
  const statusReady = acceptance && readyStatuses.has(acceptance.status);
  const evidenceReady = acceptance && readyEvidence.has(acceptance.evidenceLevel);
  addCheck(checks, "statusEvidence", statusReady && evidenceReady ? "pass" : "fail", true, statusReady && evidenceReady ? "Status is supported by evidence level." : "Acceptance status is not supported by enough evidence.");
  const needsSecurity = acceptance && ["accepted", "release_ready"].includes(acceptance.status);
  addCheck(checks, "securityBaseline", !needsSecurity || securityReady(acceptance) ? "pass" : "fail", true, needsSecurity ? "Security baseline supports accepted/release_ready." : "Security baseline not required for this status.");
  addCheck(checks, "releaseEvidence", acceptance?.status !== "release_ready" || ["real_e2e", "full_external_review"].includes(acceptance.evidenceLevel) ? "pass" : "fail", true, "release_ready requires real_e2e or full_external_review evidence.");
  const needsPmPackage = acceptance && ["pending_acceptance", "accepted", "release_ready"].includes(acceptance.status);
  const pmPath = acceptance?.pmChecklistRef ? path.join(cwd, acceptance.pmChecklistRef) : "";
  addCheck(
    checks,
    "pmAcceptancePackage",
    !needsPmPackage || (pmPath && fs.existsSync(pmPath)) ? "pass" : "fail",
    Boolean(needsPmPackage),
    needsPmPackage ? "PM acceptance package is required for acceptance-facing status." : "PM acceptance package not required for this status."
  );

  const latestReview = discoverLatest(cwd, manifest, "review", "review");
  const review = readJson(latestReview);
  if (review) {
    const reviewStatus = review.coverage === "full" ? "pass" : "warn";
    addCheck(checks, "reviewEvidence", reviewStatus, false, `Latest review coverage is ${review.coverage}.`);
    const reviewNeeded = ["full_external_review", "partial_external_review"].includes(acceptance?.evidenceLevel);
    const reviewSupportsEvidence = acceptance?.evidenceLevel === "full_external_review"
      ? review.coverage === "full"
      : ["full", "partial"].includes(review.coverage);
    if (reviewNeeded) addCheck(checks, "reviewEvidenceMatch", reviewSupportsEvidence ? "pass" : "fail", true, `Acceptance evidenceLevel=${acceptance.evidenceLevel} requires matching review coverage.`);
  } else {
    addCheck(checks, "reviewEvidence", "skip", false, "No review artifact found.");
    if (["full_external_review", "partial_external_review"].includes(acceptance?.evidenceLevel)) {
      addCheck(checks, "reviewEvidenceMatch", "fail", true, `Acceptance evidenceLevel=${acceptance.evidenceLevel} requires a review artifact.`);
    }
  }

  const latestKnowledge = discoverKnowledge(cwd, manifest);
  const knowledge = readJson(latestKnowledge);
  if (knowledge) {
    const count = Array.isArray(knowledge.entries) ? knowledge.entries.length : 1;
    addCheck(checks, "knowledgeEvidence", count > 0 ? "pass" : "warn", false, count > 0 ? `Knowledge evidence discovered (${count} item(s)).` : "Knowledge index exists but has no entries.");
  } else {
    addCheck(checks, "knowledgeEvidence", "skip", false, "No knowledge artifact or index found.");
  }

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
    latestReview: review ? latestReview : "",
    latestKnowledge: knowledge ? latestKnowledge : "",
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
