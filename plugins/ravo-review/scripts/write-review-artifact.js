#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.0";
const COVERAGE = new Set(["none", "partial", "full"]);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "review";
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

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: SCHEMA_VERSION, workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
  manifest.modules = manifest.modules || {};
  manifest.modules.review = {
    ...(manifest.modules.review || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/review"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const coverage = argValue("--coverage", "partial");
  if (!COVERAGE.has(coverage)) fail(`Unsupported review coverage: ${coverage}`);
  const summary = argValue("--summary", "RAVO review artifact");
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(summary)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    domain: argValue("--domain", "general"),
    coverage,
    modelsRequested: argValues("--model-requested"),
    modelsCompleted: argValues("--model-completed"),
    modelsFailed: argValues("--model-failed"),
    failedModelReasons: argValues("--failure-reason"),
    timing: {
      firstEventMs: Number(argValue("--first-event-ms", "0")),
      firstContentMs: Number(argValue("--first-content-ms", "0")),
      totalMs: Number(argValue("--total-ms", "0"))
    },
    truncationWarnings: argValues("--truncation-warning"),
    summary,
    risks: argValues("--risk"),
    recommendations: argValues("--recommendation"),
    rawResultRef: argValue("--raw-result-ref", ""),
    createdAt: now
  };
  if (coverage === "full" && artifact.modelsCompleted.length === 0) {
    fail("Full review coverage requires at least one --model-completed.");
  }
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "review", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
