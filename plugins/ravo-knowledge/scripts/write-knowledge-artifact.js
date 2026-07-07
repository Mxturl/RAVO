#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCHEMA_VERSION = "0.2.0";
const KINDS = new Set(["fact", "decision", "lesson", "principle", "evidence"]);

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
  return String(value || "knowledge").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "knowledge";
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

function userKnowledgeRoot() {
  return process.env.RAVO_USER_KNOWLEDGE_DIR || path.join(os.homedir(), ".codex", "ravo", "knowledge");
}

function checkTransferable({ scope, optIn, content, canaries }) {
  if (scope !== "user") return "not_required";
  if (optIn !== "true") fail("User-level transferable knowledge requires --opt-in true.");
  for (const canary of canaries) {
    if (canary && content.includes(canary)) fail("Transferable lesson failed canary leakage check.");
  }
  if (/\/Users\/|C:\\\\|customer|客户|secret|api[_-]?key/i.test(content)) fail("Transferable lesson appears to contain raw project or sensitive detail.");
  return "redacted";
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: SCHEMA_VERSION, workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
  manifest.modules = manifest.modules || {};
  manifest.modules.knowledge = {
    ...(manifest.modules.knowledge || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/knowledge"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const kind = argValue("--kind", "lesson");
  if (!KINDS.has(kind)) fail(`Unsupported knowledge kind: ${kind}`);
  const scope = argValue("--scope", "workspace");
  if (!["workspace", "user"].includes(scope)) fail(`Unsupported knowledge scope: ${scope}`);
  const content = argValue("--content", "").trim();
  if (!content) fail("Knowledge artifact requires --content.");
  const redactionStatus = checkTransferable({
    scope,
    optIn: argValue("--opt-in", "false"),
    content,
    canaries: argValues("--canary")
  });

  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(content)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind,
    scope,
    source: argValue("--source", ""),
    content,
    applicability: argValues("--applicability"),
    confidence: Number(argValue("--confidence", "0.8")),
    redactionStatus,
    lastUsedAt: "",
    createdAt: now
  };
  const dir = scope === "user" ? userKnowledgeRoot() : path.join(workspace, "knowledge", ".ravo", "knowledge");
  const artifactPath = path.join(dir, `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = scope === "workspace" ? ensureManifest(workspace, artifactPath) : "";
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
