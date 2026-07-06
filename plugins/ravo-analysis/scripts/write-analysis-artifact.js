#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.1.0";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
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

function ensureManifest(workspace, latestArtifact) {
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
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const type = argValue("--type", "requirement");
  const title = argValue("--title", "Untitled analysis");
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(title)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    type,
    title,
    createdAt: now,
    goal: argValue("--goal", ""),
    constraints: [],
    facts: [],
    rootCause: {
      symptom: argValue("--symptom", ""),
      proximateCause: argValue("--proximate-cause", ""),
      mechanismRootCause: argValue("--mechanism-root-cause", "")
    },
    derivedConclusion: argValue("--conclusion", "Draft analysis artifact created; fill details in Codex output or edit this file."),
    risks: [],
    nextActions: []
  };

  const artifactPath = path.join(workspace, "knowledge", ".ravo", "analysis", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
