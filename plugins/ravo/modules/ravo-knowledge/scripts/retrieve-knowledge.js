#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveCoreScript(name) {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts", name),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts", name) : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts", name) : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`RAVO core script is unavailable: ${name}`);
  return file;
}

const { rebuildKnowledgeIndex } = require(resolveCoreScript("ravo-record-store.js"));

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function readConfig(workspace) {
  const user = readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json")) || {};
  const local = readJson(path.join(workspace, "knowledge", ".ravo", "config.json")) || {};
  return {
    ...user,
    ...local,
    globalKnowledge: { ...(user.globalKnowledge || {}), ...(local.globalKnowledge || {}) }
  };
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
  return (index?.entries || []).map((entry) => {
    const source = entry.artifactPath || entry.markdownPath || "";
    const file = source && !path.isAbsolute(source) ? path.resolve(dir, source) : source;
    return { sourceType: "index", file, contentProjected: !Object.prototype.hasOwnProperty.call(entry, "content"), artifact: {
      id: entry.id || "",
      kind: entry.ravo_type || entry.kind,
      title: entry.title || "",
      scope: entry.scope,
      status: entry.status || "active",
      content: entry.content || entry.summary || "",
      summary: entry.summary || "",
      source: entry.source || "",
      applicability: entry.applicability || [],
      nonApplicability: entry.nonApplicability || [],
      tags: entry.tags || [],
      sensitivity: entry.sensitivity || "",
      evidenceLevel: entry.evidenceLevel || "",
      confidence: entry.confidence,
      lastVerifiedAt: entry.lastVerifiedAt || "",
      reviewAfter: entry.reviewAfter || "",
      relatedArtifacts: entry.related_artifacts || entry.relatedArtifacts || [],
      lastUsedAt: entry.lastUsedAt || "",
      useCount: entry.useCount || 0,
      reuseOutcome: entry.reuseOutcome || "unknown"
    }};
  });
}

function userKnowledgeRoot() {
  return process.env.RAVO_USER_KNOWLEDGE_DIR || path.join(os.homedir(), ".codex", "ravo", "knowledge");
}

function score(item, query) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""} ${(item.applicability || []).join(" ")} ${(item.nonApplicability || []).join(" ")} ${(item.tags || []).join(" ")}`.toLowerCase();
  return terms.filter((term) => text.includes(term)).length;
}

function isStale(item, now) {
  if (item.status === "stale") return true;
  if (!item.reviewAfter) return false;
  const due = Date.parse(item.reviewAfter);
  return Number.isFinite(due) && due <= Date.parse(now);
}

function canonicalPath(file) {
  if (!file) return "";
  try { return fs.realpathSync.native(file); } catch (_error) { return path.resolve(file); }
}

function entryScope(entry, workspaceDir, userDir) {
  if (entry.artifact.scope) return entry.artifact.scope;
  const file = canonicalPath(entry.file);
  return file && file.startsWith(`${canonicalPath(userDir)}${path.sep}`) && !file.startsWith(`${canonicalPath(workspaceDir)}${path.sep}`) ? "user" : "workspace";
}

function contentIdentity(artifact) {
  return crypto.createHash("sha256").update(JSON.stringify({
    kind: artifact.kind || "",
    title: artifact.title || "",
    summary: artifact.summary || "",
    content: artifact.content || ""
  })).digest("hex");
}

function identityKey(entry, workspaceDir, userDir) {
  const scope = entryScope(entry, workspaceDir, userDir);
  if (entry.artifact.id) return `id:${scope}:${entry.artifact.id}`;
  const file = canonicalPath(entry.file);
  return file ? `path:${scope}:${file}` : `content:${scope}:${contentIdentity(entry.artifact)}`;
}

function conflictingIdentity(left, right) {
  const a = left.artifact || {};
  const b = right.artifact || {};
  return Boolean(
    (left.contentProjected !== true && right.contentProjected !== true && a.content && b.content && a.content !== b.content)
    || (a.title && b.title && a.title !== b.title)
    || (a.kind && b.kind && a.kind !== b.kind)
  );
}

function retrieveKnowledge(options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const query = options.query || "";
  const config = options.config || readConfig(workspace);
  const includeUser = boolValue(options.includeUser, Boolean(config.globalKnowledge?.enabled));
  const recordUse = boolValue(options.recordUse, true);
  const workspaceDir = path.join(workspace, "knowledge", ".ravo", "knowledge");
  const userDir = options.userKnowledgeDir || userKnowledgeRoot();
  const files = [
    ...listJson(workspaceDir),
    ...(includeUser ? listJson(userDir) : [])
  ];
  const indexed = [
    ...readIndex(workspaceDir),
    ...(includeUser ? readIndex(userDir) : [])
  ];
  const now = options.now || new Date().toISOString();
  const jsonEntries = files
    .map((file) => ({ sourceType: "json", file, artifact: readJson(file) }))
    .filter((entry) => entry.artifact && path.basename(entry.file) !== "index.json");
  const seen = new Map();
  const diagnostics = [];
  let workspaceIndexChanged = false;
  const matches = [...jsonEntries, ...indexed]
    .filter((entry) => {
      const key = identityKey(entry, workspaceDir, userDir);
      const existing = seen.get(key);
      if (existing) {
        if (conflictingIdentity(existing, entry)) diagnostics.push({
          code: "knowledge_identity_conflict",
          id: entry.artifact.id || existing.artifact.id || "",
          scope: entryScope(entry, workspaceDir, userDir),
          keptSource: existing.sourceType,
          ignoredSource: entry.sourceType
        });
        return false;
      }
      seen.set(key, entry);
      return true;
    })
    .filter((entry) => options.includeInactive === true || (entry.artifact.status || "active") === "active")
    .filter((entry) => options.includeStale === true || !isStale(entry.artifact, now))
    .map((entry) => ({ ...entry, score: score(entry.artifact, query) }))
    .filter((entry) => entry.score > 0 || !query)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const match of matches) {
    if (recordUse) {
      match.artifact.lastUsedAt = now;
      match.artifact.useCount = Number.isInteger(match.artifact.useCount) ? match.artifact.useCount + 1 : 1;
    }
    if (match.sourceType === "json" && match.file.endsWith(".json") && fs.existsSync(match.file) && path.basename(match.file) !== "index.json") {
      if (recordUse) writeJson(match.file, match.artifact);
      if (recordUse && path.resolve(match.file).startsWith(`${path.resolve(workspaceDir)}${path.sep}`)) workspaceIndexChanged = true;
    }
  }
  if (workspaceIndexChanged) rebuildKnowledgeIndex(workspace);

  return {
    status: "ok",
    query,
    recordUse,
    includeUser,
    diagnostics,
    matches: matches.map((match) => ({
      path: match.file,
      score: match.score,
      kind: match.artifact.kind,
      scope: match.artifact.scope,
      summary: match.artifact.summary || "",
      source: match.artifact.source || "",
      content: match.artifact.content,
      applicability: match.artifact.applicability,
      nonApplicability: match.artifact.nonApplicability || [],
      sensitivity: match.artifact.sensitivity || "",
      title: match.artifact.title || "",
      status: match.artifact.status || "active",
      evidenceLevel: match.artifact.evidenceLevel || "",
      confidence: match.artifact.confidence,
      relatedArtifacts: match.artifact.relatedArtifacts || [],
      lastUsedAt: match.artifact.lastUsedAt,
      useCount: match.artifact.useCount || 0,
      reuseOutcome: match.artifact.reuseOutcome || "unknown",
      updatedAt: match.artifact.updatedAt || "",
      staleness: isStale(match.artifact, now) ? "stale" : match.artifact.updatedAt ? "current" : "unknown"
    })),
    applicationInstruction: matches.length
      ? "State which retrieved knowledge was applied and which was not applicable."
      : "No relevant RAVO knowledge found."
  };
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const query = argValue("--query", "");
  const config = readConfig(workspace);
  const result = retrieveKnowledge({
    workspace,
    query,
    config,
    includeUser: argValue("--include-user", config.globalKnowledge?.enabled ? "true" : "false"),
    recordUse: argValue("--record-use", "true")
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { readConfig, retrieveKnowledge };
