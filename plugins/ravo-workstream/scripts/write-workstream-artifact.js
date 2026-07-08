#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.1";
const STATUSES = new Set(["planned", "active", "blocked", "ready_for_acceptance", "closed"]);

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
  return String(value || "workstream").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workstream";
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
  manifest.modules.workstream = {
    ...(manifest.modules.workstream || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/workstream"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "active");
  if (!STATUSES.has(status)) fail(`Unsupported workstream status: ${status}`);
  const goal = argValue("--goal", "Long-running RAVO work").trim();
  const nextStep = argValue("--next-step", "").trim();
  const blockers = argValues("--blocker");
  const recovery = argValue("--recovery", "").trim();
  if (status === "active" && !nextStep) fail("Active workstream requires --next-step.");
  if (status === "blocked" && blockers.length === 0) fail("Blocked workstream requires at least one --blocker.");
  if (status === "blocked" && !recovery) fail("Blocked workstream requires --recovery.");

  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(goal)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status,
    goal,
    specRef: argValue("--spec-ref", ""),
    milestones: argValues("--milestone"),
    currentMilestone: argValue("--current-milestone", ""),
    nextStep,
    blockers,
    recovery,
    decisions: argValues("--decision"),
    evidenceRefs: argValues("--evidence-ref"),
    createdAt: now,
    updatedAt: now
  };
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "workstream", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
