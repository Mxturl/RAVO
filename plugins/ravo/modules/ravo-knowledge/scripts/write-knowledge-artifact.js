#!/usr/bin/env node

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

const {
  normalizeKnowledgeRecord,
  rebuildKnowledgeIndex,
  validateKnowledgeRecord
} = require(resolveCoreScript("ravo-record-store.js"));
const { buildPmBrief } = require(resolveCoreScript("ravo-pm-brief.js"));

const SCHEMA_VERSION = "0.5.3";
const KINDS = new Set([
  "fact",
  "decision",
  "lesson",
  "principle",
  "boundary",
  "terminology",
  "procedure",
  "warning"
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
tags: ${yamlList(artifact.tags)}
applicability: ${yamlList(artifact.applicability)}
sensitivity: ${artifact.sensitivity}
related_artifacts: ${yamlList(artifact.relatedArtifacts)}
status: ${artifact.status}
created_at: ${artifact.createdAt}
updated_at: ${artifact.updatedAt}
last_verified_at: ${artifact.lastVerifiedAt || ""}
review_after: ${artifact.reviewAfter || ""}
---

# ${title}

${artifact.content}

## Applicability

${artifact.applicability.length ? artifact.applicability.map((item) => `- ${item}`).join("\n") : "- Not specified."}

## Non-applicability

${artifact.nonApplicability?.length ? artifact.nonApplicability.map((item) => `- ${item}`).join("\n") : "- Not specified."}

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
    status: artifact.status,
    tags: artifact.tags,
    applicability: artifact.applicability,
    nonApplicability: artifact.nonApplicability,
    sensitivity: artifact.sensitivity,
    evidenceLevel: artifact.evidenceLevel,
    confidence: artifact.confidence,
    lastVerifiedAt: artifact.lastVerifiedAt,
    reviewAfter: artifact.reviewAfter,
    lastUsedAt: artifact.lastUsedAt,
    useCount: artifact.useCount,
    reuseOutcome: artifact.reuseOutcome,
    stalenessReason: artifact.stalenessReason,
    relatedRequirements: artifact.relatedRequirements,
    relatedIssues: artifact.relatedIssues,
    relatedSpecs: artifact.relatedSpecs,
    relatedKnowledge: artifact.relatedKnowledge,
    duplicateOf: artifact.duplicateOf,
    supersededBy: artifact.supersededBy,
    related_artifacts: artifact.relatedArtifacts,
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
  const source = argValue("--source", "").trim();
  const applicability = argValues("--applicability");
  if (scope === "user" && sensitivity !== "public" && sensitivity !== "redacted") {
    fail("User-level knowledge requires --sensitivity public or redacted.");
  }
  if (scope === "user" && !source) fail("User-level knowledge requires --source.");
  if (scope === "user" && applicability.length === 0) fail("User-level knowledge requires at least one --applicability.");
  const redactionStatus = checkTransferable({
    scope,
    optIn: argValue("--opt-in", "false"),
    content,
    canaries: argValues("--canary")
  });

  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(content)}`;
  const status = argValue("--status", "candidate").trim();
  const confirmedBy = argValue("--confirmed-by", "").trim();
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind,
    title: argValue("--title", summary).trim(),
    summary,
    scope,
    source,
    content,
    status,
    applicability,
    nonApplicability: argValues("--non-applicability"),
    tags: argValues("--tag"),
    sensitivity,
    relatedArtifacts: argValues("--related-artifact"),
    sourceRefs: argValues("--source-ref"),
    evidenceLevel: argValue("--evidence-level", "notes"),
    confidence: Number(argValue("--confidence", "0.8")),
    redactionStatus,
    confirmedBy,
    confirmationStatus: argValue("--confirmation-status", status === "active" && confirmedBy ? "confirmed" : "needs_review"),
    confirmedAt: argValue("--confirmed-at", ""),
    lastVerifiedAt: argValue("--last-verified-at", ""),
    reviewAfter: argValue("--review-after", ""),
    lastUsedAt: "",
    useCount: 0,
    reuseOutcome: argValue("--reuse-outcome", "unknown"),
    stalenessReason: "",
    relatedRequirements: argValues("--related-requirement"),
    relatedIssues: argValues("--related-issue"),
    relatedSpecs: argValues("--related-spec"),
    relatedKnowledge: argValues("--related-knowledge"),
    duplicateOf: argValue("--duplicate-of", ""),
    supersededBy: argValue("--superseded-by", ""),
    createdAt: now,
    updatedAt: now
  };
  const normalized = normalizeKnowledgeRecord(artifact, { capture: artifact.status === "candidate", allowUserScope: scope === "user" });
  const validationErrors = validateKnowledgeRecord(normalized, { allowUserScope: scope === "user" });
  if (validationErrors.length) fail(validationErrors.join("\n"));
  Object.assign(artifact, normalized);
  artifact.pmBrief = buildPmBrief({
    headline: status === "active" ? "已记录一条可复用经验" : "已记录一条待确认的经验",
    stage: "learn",
    productState: status === "active" ? "validated" : "in_progress",
    userImpact: status === "active" ? "后续遇到适用场景时，Codex 可以复用这条经验。" : "这条经验尚未成为稳定结论，不会自动改变当前产品。",
    actionRequired: "none",
    nextStep: status === "active" ? "Codex 将在匹配场景中引用并核对这条经验。" : "Codex 将在获得新证据时确认、修订或归档这条经验。",
    decisionCard: null,
    evidenceBoundary: {
      proves: ["已记录经验内容、来源和适用范围"],
      doesNotProve: [status === "active" ? "复用前仍需确认当前场景适用" : "尚不代表这条经验已经确认"]
    },
    sourceRefs: artifact.sourceRefs.length ? artifact.sourceRefs : [`knowledge:${artifact.id}`]
  });
  const dir = scope === "user" ? userKnowledgeRoot() : path.join(workspace, "knowledge", ".ravo", "knowledge");
  const artifactPath = path.join(dir, `${id}.json`);
  const markdownPath = path.join(dir, `${id}.md`);
  writeJson(artifactPath, artifact);
  writeText(markdownPath, markdownFor(artifact));
  const indexPath = scope === "workspace"
    ? rebuildKnowledgeIndex(workspace).path
    : refreshIndex(dir, artifact, markdownPath, artifactPath);
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
