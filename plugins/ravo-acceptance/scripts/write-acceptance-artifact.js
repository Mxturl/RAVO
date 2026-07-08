#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.0";
const STATUSES = new Set(["in_progress", "code_complete", "pending_acceptance", "accepted", "release_ready", "not_ready"]);
const EVIDENCE_LEVELS = new Set(["none", "notes", "script", "api", "smoke", "real_e2e", "full_external_review", "partial_external_review"]);
const SECURITY_ITEMS = [
  "data_privacy",
  "credentials",
  "permissions",
  "destructive_actions",
  "external_calls",
  "dependencies",
  "logs_artifacts",
  "global_knowledge"
];

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function slug(value) {
  return String(value || "acceptance")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "acceptance";
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

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function buildSecurityChecklist(passed) {
  const passedSet = new Set(passed);
  return SECURITY_ITEMS.map((id) => ({
    id,
    status: passedSet.has(id) ? "pass" : "unknown"
  }));
}

function validateState(status, evidenceLevel, securityChecklist) {
  if (!STATUSES.has(status)) fail(`Unsupported acceptance status: ${status}`);
  if (!EVIDENCE_LEVELS.has(evidenceLevel)) fail(`Unsupported evidence level: ${evidenceLevel}`);
  const allSecurityPass = securityChecklist.every((item) => item.status === "pass");
  if (["accepted", "release_ready"].includes(status) && !allSecurityPass) {
    fail("accepted/release_ready requires all security baseline items via --security-pass.");
  }
  if (status === "release_ready" && evidenceLevel !== "real_e2e" && evidenceLevel !== "full_external_review") {
    fail("release_ready requires --evidence-level real_e2e or full_external_review.");
  }
  if (status === "accepted" && !["smoke", "real_e2e", "full_external_review"].includes(evidenceLevel)) {
    fail("accepted requires smoke, real_e2e, or full_external_review evidence.");
  }
}

function ensureManifest(workspace, latestArtifact) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: SCHEMA_VERSION,
    workspace: ".",
    modules: {}
  };
  manifest.modules = manifest.modules || {};
  manifest.modules.acceptance = {
    ...(manifest.modules.acceptance || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/acceptance"],
    latestArtifact: path.relative(workspace, latestArtifact),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "not_ready");
  const evidenceLevel = argValue("--evidence-level", "notes");
  const summary = argValue("--summary", "Acceptance artifact created.");
  const securityChecklist = buildSecurityChecklist(argValues("--security-pass"));
  validateState(status, evidenceLevel, securityChecklist);
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(summary)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status,
    evidenceLevel,
    summary,
    createdAt: now,
    analysisArtifact: argValue("--analysis-artifact", ""),
    evidence: argValues("--evidence"),
    knownGaps: argValues("--known-gap"),
    securityChecklist
  };

  const artifactPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
