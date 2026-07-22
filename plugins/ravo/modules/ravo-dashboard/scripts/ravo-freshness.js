#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePluginScript } = require("./ravo-plugin-resolver");
const { classifyReview, selectArtifactLineage } = require("./ravo-lineage");
const PRODUCT_VERSION = "0.6.2";

function coreFunction(scriptName, exportName, options = {}) {
  const script = resolvePluginScript("ravo-core", `scripts/${scriptName}`, {
    fromDir: __dirname,
    home: options.home || os.homedir(),
    explicitRoot: options.corePluginRoot,
    envRoot: process.env.RAVO_CORE_PLUGIN_ROOT,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new Error(`RAVO Core ${scriptName} could not be resolved.`);
  const value = require(script)[exportName];
  if (typeof value !== "function") throw new Error(`RAVO Core ${scriptName} does not export ${exportName}.`);
  return value;
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function shaFile(file) {
  try { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; } catch (_error) { return ""; }
}

function fileTime(file) {
  try { return fs.statSync(file).mtimeMs; } catch (_error) { return 0; }
}

function iso(ms) {
  return ms > 0 ? new Date(ms).toISOString() : "";
}

function normalizeTargetRef(workspace, ref) {
  if (typeof ref !== "string" || !ref.trim()) return "";
  const value = ref.trim();
  if (!path.isAbsolute(value)) return value.split(path.sep).join("/");
  const relative = path.relative(workspace, value);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return value;
  return relative.split(path.sep).join("/");
}

function listArtifacts(dir, limit = 500) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => path.join(dir, file))
      .map((file) => ({ file, updatedAt: fileTime(file) }))
      .sort((left, right) => right.updatedAt - left.updatedAt || right.file.localeCompare(left.file))
      .slice(0, limit);
  } catch (_error) { return []; }
  return files.map((entry) => ({ file: entry.file, artifact: readJson(entry.file), updatedAt: entry.updatedAt }))
    .filter((entry) => entry.artifact)
    .sort((left, right) => {
      const leftTime = Date.parse(left.artifact.createdAt || "") || left.updatedAt;
      const rightTime = Date.parse(right.artifact.createdAt || "") || right.updatedAt;
      return rightTime - leftTime || right.file.localeCompare(left.file);
    });
}

function pathLike(ref) {
  return /^(?:docs|knowledge)[/\\]/.test(ref) || /\.(?:json|md|txt)$/i.test(ref) || path.isAbsolute(ref);
}

function resolveWorkspaceRef(workspace, ref) {
  if (typeof ref !== "string" || !ref.trim() || !pathLike(ref.trim())) return "";
  const candidate = path.resolve(workspace, ref.trim());
  if (candidate !== workspace && !candidate.startsWith(`${workspace}${path.sep}`)) return "";
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : "";
}

function artifactRefs(artifact) {
  if (!artifact || typeof artifact !== "object") return [];
  const direct = [
    artifact.specRef,
    artifact.analysisArtifact,
    artifact.workstreamArtifact,
    artifact.quickValidationArtifact,
    artifact.reviewArtifact,
    artifact.knowledgeArtifact,
    artifact.issueLedgerRef,
    ...(Array.isArray(artifact.sourceRefs) ? artifact.sourceRefs : []),
    ...(Array.isArray(artifact.evidenceRefs) ? artifact.evidenceRefs : []),
    ...(Array.isArray(artifact.acceptanceItems) ? artifact.acceptanceItems.flatMap((item) => Array.isArray(item?.sourceRefs) ? item.sourceRefs : []) : [])
  ];
  return [...new Set(direct.filter((ref) => typeof ref === "string" && ref.trim()).map((ref) => ref.trim()))];
}

function expandSourceGraph(workspace, refs, maxDepth = 2) {
  const queue = refs.map((ref) => ({ ref, depth: 0 }));
  const files = new Set();
  const missing = new Set();
  while (queue.length) {
    const { ref, depth } = queue.shift();
    const file = resolveWorkspaceRef(workspace, ref);
    if (!file) {
      if (pathLike(ref)) missing.add(ref);
      continue;
    }
    if (files.has(file)) continue;
    files.add(file);
    if (depth >= maxDepth || !file.endsWith(".json")) continue;
    for (const nested of artifactRefs(readJson(file))) queue.push({ ref: nested, depth: depth + 1 });
  }
  return { files: [...files], missing: [...missing] };
}

function semanticSourceRefs(workspace, subjectRef, releaseRef) {
  const keys = new Set([subjectRef, releaseRef].filter(Boolean));
  if (!keys.size) return [];
  const modules = ["analysis", "workstream", "review"];
  const matches = [];
  for (const module of modules) {
    for (const entry of listArtifacts(path.join(workspace, "knowledge", ".ravo", module))) {
      const artifactKeys = [entry.artifact.subjectRef, entry.artifact.releaseRef, entry.artifact.relatedArtifact].filter(Boolean);
      if (artifactKeys.some((key) => keys.has(key))) matches.push(entry.file);
    }
  }
  return matches;
}

function metadata(freshness, runtimeHealth, sourceFiles, options = {}) {
  const sourceUpdatedMs = sourceFiles.reduce((latest, file) => Math.max(latest, fileTime(file)), 0);
  const confidence = freshness !== "current" || options.degraded ? "low"
    : runtimeHealth === "healthy" ? "high"
      : runtimeHealth === "configured_unverified" ? "medium" : "low";
  return {
    derivedAt: new Date().toISOString(),
    sourceUpdatedAt: iso(sourceUpdatedMs),
    freshness,
    confidence,
    sourceRefs: sourceFiles.map((file) => path.relative(options.workspace, file))
  };
}

function workspaceLineage(workspace, options = {}) {
  const entries = options.entries || {
    workstreams: listArtifacts(path.join(workspace, "knowledge", ".ravo", "workstream")),
    acceptances: listArtifacts(path.join(workspace, "knowledge", ".ravo", "acceptance")),
    reviews: listArtifacts(path.join(workspace, "knowledge", ".ravo", "review")),
    analyses: listArtifacts(path.join(workspace, "knowledge", ".ravo", "analysis"))
  };
  return {
    entries,
    selection: selectArtifactLineage({
      workspace,
      ...entries,
      targetSpecRef: normalizeTargetRef(workspace, options.targetSpecRef || ""),
      targetReleaseRef: options.targetReleaseRef || "",
      targetSubjectRef: options.targetSubjectRef || ""
    })
  };
}

function entryByRelativePath(workspace, entries, ref) {
  return entries.find((entry) => path.relative(workspace, entry.file).split(path.sep).join("/") === ref) || null;
}

function acceptanceFreshness(workspace, runtime, options = {}) {
  const lineage = options.lineage || workspaceLineage(workspace, options);
  const candidates = lineage.entries.acceptances;
  const workstream = entryByRelativePath(workspace, lineage.entries.workstreams, lineage.selection.authoritativeWorkstream.artifactPath);
  const latest = entryByRelativePath(workspace, candidates, lineage.selection.selectedAcceptance.artifactPath);
  if (!latest) return {
    status: candidates.length ? "unknown" : "no_data",
    artifactPath: "",
    selectionReason: lineage.selection.selectedAcceptance.selectionReason,
    relationStatus: lineage.selection.selectedAcceptance.relationStatus,
    activeWorkstream: workstream ? path.relative(workspace, workstream.file) : "",
    authoritativeWorkstream: lineage.selection.authoritativeWorkstream,
    selectedAcceptance: lineage.selection.selectedAcceptance,
    staleSources: [],
    missingSources: [],
    ...metadata("unknown", runtime.runtimeHealth, workstream ? [workstream.file] : [], { workspace, degraded: true })
  };
  const artifact = latest.artifact;
  const refs = artifactRefs(artifact);
  const semantic = semanticSourceRefs(workspace, artifact.subjectRef, artifact.releaseRef);
  const graph = expandSourceGraph(workspace, [...refs, ...semantic]);
  const sourceFiles = graph.files.filter((file) => file !== latest.file);
  const acceptanceUpdated = latest.updatedAt;
  const staleSources = sourceFiles.filter((file) => fileTime(file) > acceptanceUpdated + 1);
  const freshness = !sourceFiles.length || graph.missing.length ? "unknown" : staleSources.length ? "stale" : "current";
  return {
    status: freshness,
    artifactPath: path.relative(workspace, latest.file),
    selectionReason: lineage.selection.selectedAcceptance.selectionReason,
    relationStatus: lineage.selection.selectedAcceptance.relationStatus,
    activeWorkstream: workstream ? path.relative(workspace, workstream.file) : "",
    authoritativeWorkstream: lineage.selection.authoritativeWorkstream,
    selectedAcceptance: lineage.selection.selectedAcceptance,
    acceptanceStatus: artifact.status || "",
    staleSources: staleSources.map((file) => path.relative(workspace, file)),
    missingSources: graph.missing,
    ...metadata(freshness, runtime.runtimeHealth, sourceFiles, { workspace, degraded: freshness !== "current" })
  };
}

function matchingReview(workspace, analysisEntry) {
  const analysis = analysisEntry.artifact;
  if (analysis.reviewArtifact) {
    const file = resolveWorkspaceRef(workspace, analysis.reviewArtifact);
    if (file) return { file, artifact: readJson(file), explicit: true };
  }
  const reviews = listArtifacts(path.join(workspace, "knowledge", ".ravo", "review"));
  const match = reviews.find((entry) => analysis.reviewRunId && entry.artifact.reviewRunId === analysis.reviewRunId)
    || reviews.find((entry) => analysis.subjectRef && [entry.artifact.subjectRef, ...(entry.artifact.sourceRefs || [])].includes(analysis.subjectRef))
    || reviews.find((entry) => (entry.artifact.sourceRefs || []).includes(path.relative(workspace, analysisEntry.file)));
  return match ? { ...match, explicit: false } : null;
}

function reviewFreshness(workspace, runtime) {
  const analysisEntry = listArtifacts(path.join(workspace, "knowledge", ".ravo", "analysis"))
    .find((entry) => entry.artifact.status === "complete" && (entry.artifact.impactLevel === "high" || entry.artifact.reviewRequired === true));
  if (!analysisEntry) return {
    status: "not_applicable",
    objectRef: "",
    reviewArtifact: "",
    ...metadata("current", runtime.runtimeHealth, [], { workspace })
  };
  const analysis = analysisEntry.artifact;
  if (analysis.reviewEvidence === "blocked") return {
    status: "unavailable",
    objectRef: path.relative(workspace, analysisEntry.file),
    reviewArtifact: "",
    blocker: analysis.reviewBlocker || {},
    ...metadata("current", runtime.runtimeHealth, [analysisEntry.file], { workspace, degraded: true })
  };
  const reviewEntry = matchingReview(workspace, analysisEntry);
  if (!reviewEntry?.artifact) return {
    status: "needed",
    objectRef: path.relative(workspace, analysisEntry.file),
    reviewArtifact: "",
    ...metadata("current", runtime.runtimeHealth, [analysisEntry.file], { workspace, degraded: true })
  };
  const review = reviewEntry.artifact;
  const sourceChanged = fileTime(analysisEntry.file) > fileTime(reviewEntry.file) + 1;
  const explicitlyMatches = reviewEntry.explicit
    || (analysis.reviewRunId && analysis.reviewRunId === review.reviewRunId)
    || (analysis.subjectRef && analysis.subjectRef === review.subjectRef)
    || (review.sourceRefs || []).includes(path.relative(workspace, analysisEntry.file));
  let status;
  if (sourceChanged || !explicitlyMatches) status = "needed";
  else status = classifyReview(review);
  const freshness = sourceChanged ? "stale" : explicitlyMatches ? "current" : "unknown";
  return {
    status,
    objectRef: path.relative(workspace, analysisEntry.file),
    reviewArtifact: path.relative(workspace, reviewEntry.file),
    sourceChanged,
    ...metadata(freshness, runtime.runtimeHealth, [analysisEntry.file, reviewEntry.file], { workspace, degraded: status !== "current" })
  };
}

function buildFreshness(workspace, options = {}) {
  const root = path.resolve(workspace);
  const buildStatus = options.buildStatus || coreFunction("ravo-status.js", "buildStatus", options);
  const checkSpecHealth = options.checkSpecHealth || coreFunction("ravo-goal-prompt.js", "checkSpecHealth", options);
  const runtime = options.runtimeStatus || buildStatus(root, options.repo || "", options.runtimeOptions || {});
  const spec = checkSpecHealth(root, options.spec || "");
  const lineage = workspaceLineage(root, {
    targetSpecRef: options.targetSpecRef || spec.specPath || "",
    targetReleaseRef: options.targetReleaseRef || "",
    targetSubjectRef: options.targetSubjectRef || ""
  });
  const acceptance = acceptanceFreshness(root, runtime, { lineage });
  const review = reviewFreshness(root, runtime);
  const releaseReviewEntry = entryByRelativePath(root, lineage.entries.reviews, lineage.selection.releaseReview.artifactPath);
  const releaseReview = {
    ...lineage.selection.releaseReview,
    ...(releaseReviewEntry ? metadata(
      lineage.selection.releaseReview.status === "current" ? "current" : "unknown",
      runtime.runtimeHealth,
      [releaseReviewEntry.file],
      { workspace: root, degraded: lineage.selection.releaseReview.status !== "current" }
    ) : metadata("unknown", runtime.runtimeHealth, [], { workspace: root, degraded: true }))
  };
  return {
    status: ["error", "missing"].includes(runtime.runtimeHealth) || spec.status === "error" ? "error" : "ok",
    checkedAt: new Date().toISOString(),
    specHealth: spec,
    authoritativeWorkstream: lineage.selection.authoritativeWorkstream,
    selectedAcceptance: lineage.selection.selectedAcceptance,
    acceptanceFreshness: acceptance,
    reviewFreshness: review,
    releaseReview,
    openAnalysisReviews: lineage.selection.openAnalysisReviews,
    runtime: {
      runtimeHealth: runtime.runtimeHealth,
      fingerprint: runtime.fingerprint,
      runtimeProbeStatus: runtime.runtimeProbeStatus
    }
  };
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-freshness.js [--workspace <path>] [--repo <marketplace-root>] [--spec <path>]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  console.log(JSON.stringify(buildFreshness(workspace, {
    repo: argValue("--repo", ""),
    spec: argValue("--spec", "")
  }), null, 2));
}

if (require.main === module) main();

module.exports = {
  acceptanceFreshness,
  buildFreshness,
  reviewFreshness
};
