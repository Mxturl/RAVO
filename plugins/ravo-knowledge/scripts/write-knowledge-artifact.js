#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.0";
const KINDS = new Set([
  "material",
  "experience",
  "judgment",
  "terminology",
  "boundary",
  "requirement",
  "solution",
  "review",
  "acceptance",
  "retrospective",
  "fact",
  "decision",
  "lesson",
  "principle",
  "evidence"
]);

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

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function userKnowledgeRoot() {
  return process.env.RAVO_USER_KNOWLEDGE_DIR || path.join(os.homedir(), ".codex", "ravo", "knowledge");
}

function yamlList(values) {
  return `[${(values || []).map((value) => JSON.stringify(value)).join(", ")}]`;
}

function markdownFor(artifact) {
  const title = artifact.title || artifact.summary || artifact.id;
  return `---
ravo_type: ${artifact.kind}
title: ${JSON.stringify(title)}
summary: ${JSON.stringify(artifact.summary)}
source: ${JSON.stringify(artifact.source)}
scope: ${artifact.scope}
status: active
tags: ${yamlList(artifact.tags)}
applicability: ${yamlList(artifact.applicability)}
sensitivity: ${artifact.sensitivity}
related_artifacts: ${yamlList(artifact.relatedArtifacts)}
created_at: ${artifact.createdAt}
updated_at: ${artifact.updatedAt}
---

# ${title}

${artifact.content}

## Applicability

${artifact.applicability.length ? artifact.applicability.map((item) => `- ${item}`).join("\n") : "- Not specified."}

## Source

${artifact.source || "Not specified."}
`;
}

function refreshIndex(dir, artifact, markdownPath, jsonPath) {
  const indexPath = path.join(dir, "index.json");
  const index = readJson(indexPath) || { schemaVersion: SCHEMA_VERSION, entries: [] };
  index.schemaVersion = SCHEMA_VERSION;
  index.entries = (index.entries || []).filter((entry) => entry.id !== artifact.id);
  index.entries.push({
    id: artifact.id,
    ravo_type: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    scope: artifact.scope,
    status: "active",
    tags: artifact.tags,
    applicability: artifact.applicability,
    sensitivity: artifact.sensitivity,
    related_artifacts: artifact.relatedArtifacts,
    content: artifact.content,
    markdownPath,
    artifactPath: jsonPath,
    updatedAt: artifact.updatedAt
  });
  index.entries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  writeJson(indexPath, index);
  return indexPath;
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
  const summary = argValue("--summary", content.replace(/\s+/g, " ").slice(0, 160)).trim();
  const sensitivity = argValue("--sensitivity", scope === "user" ? "redacted" : "internal").trim();
  if (scope === "user" && sensitivity !== "public" && sensitivity !== "redacted") {
    fail("User-level knowledge requires --sensitivity public or redacted.");
  }
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
    title: argValue("--title", summary).trim(),
    summary,
    scope,
    source: argValue("--source", ""),
    content,
    applicability: argValues("--applicability"),
    tags: argValues("--tag"),
    sensitivity,
    relatedArtifacts: argValues("--related-artifact"),
    confidence: Number(argValue("--confidence", "0.8")),
    redactionStatus,
    lastUsedAt: "",
    createdAt: now,
    updatedAt: now
  };
  const dir = scope === "user" ? userKnowledgeRoot() : path.join(workspace, "knowledge", ".ravo", "knowledge");
  const artifactPath = path.join(dir, `${id}.json`);
  const markdownPath = path.join(dir, `${id}.md`);
  writeJson(artifactPath, artifact);
  writeText(markdownPath, markdownFor(artifact));
  const indexPath = refreshIndex(dir, artifact, markdownPath, artifactPath);
  const manifestPath = scope === "workspace" ? ensureManifest(workspace, artifactPath) : "";
  console.log(JSON.stringify({
    status: "ok",
    artifactPath,
    markdownPath,
    indexPath,
    manifestPath,
    globalWriteNotice: scope === "user"
      ? `User-level RAVO knowledge written to ${dir}; source=${artifact.source || "not specified"}; sensitivity=${artifact.sensitivity}; applicability=${artifact.applicability.join(", ") || "not specified"}; opt-in=true.`
      : ""
  }, null, 2));
}

if (require.main === module) main();
