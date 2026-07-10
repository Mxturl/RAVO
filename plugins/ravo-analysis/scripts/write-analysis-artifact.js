#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.1";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values;
}

function slug(value) {
  return String(value || "analysis")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "analysis";
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

function listArg(name) {
  return argValues(name)
    .flatMap((value) => String(value || "").split(/\s*\|\|\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function ensureManifest(workspace, latestArtifact, artifactStatus) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: SCHEMA_VERSION,
    workspace: ".",
    modules: {}
  };
  manifest.modules = manifest.modules || {};
  manifest.modules.analysis = {
    ...(manifest.modules.analysis || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/analysis"],
    latestArtifact: path.relative(workspace, latestArtifact),
    ...(artifactStatus === "complete"
      ? { latestCompleteArtifact: path.relative(workspace, latestArtifact) }
      : {}),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function validateArtifact(artifact) {
  if (!["draft", "complete"].includes(artifact.status)) {
    fail(`Unsupported analysis artifact status: ${artifact.status}`);
  }

  if (artifact.status !== "complete") return;

  if (["requirement", "solution"].includes(artifact.type)) {
    if (artifact.facts.length === 0) fail("Complete requirement/solution analysis artifact requires at least one --fact.");
    if (!artifact.challenge) fail("Complete requirement/solution analysis artifact requires --challenge.");
    if (!artifact.derivedConclusion.trim()) fail("Complete requirement/solution analysis artifact requires --conclusion.");
    return;
  }

  if (artifact.type === "root-cause") {
    if (!artifact.rootCause.symptom) fail("Complete root-cause analysis artifact requires --symptom.");
    if (!artifact.rootCause.proximateCause) fail("Complete root-cause analysis artifact requires --proximate-cause.");
    if (!artifact.rootCause.mechanismRootCause) fail("Complete root-cause analysis artifact requires --mechanism-root-cause.");
    if (artifact.alternativeHypotheses.length === 0) fail("Complete root-cause analysis artifact requires at least one --alternative-hypothesis.");
    if (artifact.whyChain.length === 0) fail("Complete root-cause analysis artifact requires at least one --why.");
    if (!artifact.derivedConclusion.trim()) fail("Complete root-cause analysis artifact requires --conclusion.");
  }
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const type = argValue("--type", "requirement");
  const status = argValue("--status", "draft").trim() || "draft";
  const title = argValue("--title", "Untitled analysis");
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(title)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    type,
    status,
    title,
    createdAt: now,
    goal: argValue("--goal", "").trim(),
    constraints: listArg("--constraint"),
    facts: listArg("--fact"),
    challenge: argValue("--challenge", "").trim(),
    whyChain: listArg("--why"),
    alternativeHypotheses: listArg("--alternative-hypothesis"),
    rootCause: {
      symptom: argValue("--symptom", "").trim(),
      proximateCause: argValue("--proximate-cause", "").trim(),
      mechanismRootCause: argValue("--mechanism-root-cause", "").trim()
    },
    analysisMode: argValue("--analysis-mode", "").trim(),
    clarificationStatus: argValue("--clarification-status", "").trim(),
    openQuestions: listArg("--open-question"),
    assumptions: listArg("--assumption"),
    coCreationDecision: argValue("--co-creation-decision", "").trim(),
    blindSpotFindings: listArg("--blind-spot").map((item) => {
      try { return JSON.parse(item); } catch (_err) { return { title: item, basis: "inference", impact: "medium", suggestedAction: "clarify", specUpdateRequired: false }; }
    }),
    reviewEvidence: argValue("--review-evidence", "").trim(),
    reviewArtifact: argValue("--review-artifact", "").trim(),
    derivedConclusion: argValue("--conclusion", status === "draft" ? "Draft analysis artifact created; fill details in Codex output or edit this file." : "").trim(),
    risks: listArg("--risk"),
    nextActions: listArg("--next-action")
  };

  validateArtifact(artifact);
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "analysis", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath, status);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
