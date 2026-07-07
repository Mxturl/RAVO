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
  const files = [
    ...listJson(path.join(workspace, "knowledge", ".ravo", "knowledge")),
    ...(includeUser ? listJson(userKnowledgeRoot()) : [])
  ];
  const now = new Date().toISOString();
  const matches = files
    .map((file) => ({ file, artifact: readJson(file) }))
    .filter((entry) => entry.artifact)
    .map((entry) => ({ ...entry, score: score(entry.artifact, query) }))
    .filter((entry) => entry.score > 0 || !query)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const match of matches) {
    match.artifact.lastUsedAt = now;
    writeJson(match.file, match.artifact);
  }

  console.log(JSON.stringify({
    status: "ok",
    query,
    matches: matches.map((match) => ({
      path: match.file,
      score: match.score,
      kind: match.artifact.kind,
      scope: match.artifact.scope,
      content: match.artifact.content,
      applicability: match.artifact.applicability,
      lastUsedAt: match.artifact.lastUsedAt
    })),
    applicationInstruction: matches.length
      ? "State which retrieved knowledge was applied and which was not applicable."
      : "No relevant RAVO knowledge found."
  }, null, 2));
}

if (require.main === module) main();
