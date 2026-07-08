#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => path.join(dir, file));
  } catch (_err) {
    return [];
  }
}

function readIndex(dir) {
  const index = readJson(path.join(dir, "index.json"));
  return (index?.entries || []).map((entry) => ({ sourceType: "index", file: entry.artifactPath || entry.markdownPath || "", artifact: {
    id: entry.id || "",
    kind: entry.ravo_type || entry.kind,
    scope: entry.scope,
    content: entry.content || entry.summary || "",
    summary: entry.summary || "",
    source: entry.source || "",
    applicability: entry.applicability || [],
    tags: entry.tags || [],
    sensitivity: entry.sensitivity || "",
    relatedArtifacts: entry.related_artifacts || entry.relatedArtifacts || [],
    lastUsedAt: entry.lastUsedAt || ""
  }}));
}

function userKnowledgeRoot() {
  return process.env.RAVO_USER_KNOWLEDGE_DIR || path.join(os.homedir(), ".codex", "ravo", "knowledge");
}

function score(item, query) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  const text = `${item.content || ""} ${(item.applicability || []).join(" ")}`.toLowerCase();
  return terms.filter((term) => text.includes(term)).length;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const query = argValue("--query", "");
  const includeUser = argValue("--include-user", "false") === "true";
  const workspaceDir = path.join(workspace, "knowledge", ".ravo", "knowledge");
  const userDir = userKnowledgeRoot();
  const files = [
    ...listJson(workspaceDir),
    ...(includeUser ? listJson(userDir) : [])
  ];
  const indexed = [
    ...readIndex(workspaceDir),
    ...(includeUser ? readIndex(userDir) : [])
  ];
  const now = new Date().toISOString();
  const jsonEntries = files
    .map((file) => ({ sourceType: "json", file, artifact: readJson(file) }))
    .filter((entry) => entry.artifact && path.basename(entry.file) !== "index.json");
  const seen = new Set();
  const matches = [...jsonEntries, ...indexed]
    .filter((entry) => {
      const key = entry.artifact.id || entry.file || `${entry.artifact.kind}:${entry.artifact.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({ ...entry, score: score(entry.artifact, query) }))
    .filter((entry) => entry.score > 0 || !query)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const match of matches) {
    match.artifact.lastUsedAt = now;
    if (match.sourceType === "json" && match.file.endsWith(".json") && fs.existsSync(match.file) && path.basename(match.file) !== "index.json") {
      writeJson(match.file, match.artifact);
    }
  }

  console.log(JSON.stringify({
    status: "ok",
    query,
    matches: matches.map((match) => ({
      path: match.file,
      score: match.score,
      kind: match.artifact.kind,
      scope: match.artifact.scope,
      summary: match.artifact.summary || "",
      source: match.artifact.source || "",
      content: match.artifact.content,
      applicability: match.artifact.applicability,
      sensitivity: match.artifact.sensitivity || "",
      relatedArtifacts: match.artifact.relatedArtifacts || [],
      lastUsedAt: match.artifact.lastUsedAt
    })),
    applicationInstruction: matches.length
      ? "State which retrieved knowledge was applied and which was not applicable."
      : "No relevant RAVO knowledge found."
  }, null, 2));
}

if (require.main === module) main();
