#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.2.0";

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
  const summary = argValue("--summary", "Acceptance artifact created.");
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(summary)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status,
    evidenceLevel: argValue("--evidence-level", "notes"),
    summary,
    createdAt: now,
    analysisArtifact: argValue("--analysis-artifact", ""),
    evidence: [],
    knownGaps: []
  };

  const artifactPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
