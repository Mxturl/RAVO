#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildContinuationBrief,
  buildShortcut,
  selectShortcutActions
} = require("./ravo-shortcuts");

function loadPmBriefModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-pm-brief.js"),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-pm-brief.js") : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-pm-brief.js") : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO PM Brief module is unavailable.");
  return require(file);
}

const { buildPmBrief, validatePmBrief } = loadPmBriefModule();

const ARTIFACT_MODULES = ["analysis", "workstream", "quick-validation", "acceptance", "knowledge", "review"];
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const LIFECYCLE_RANK = { active: 0, paused: 1, archived: 2 };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const FRESHNESS_RANK = { stale: 0, unknown: 1, current: 2 };
const DEFAULT_ARTIFACT_LIMIT = 500;

function readPoolSummary(workspace) {
  const root = path.join(workspace, "knowledge", ".ravo", "pool");
  const readIndex = (file) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
      const entries = Array.isArray(value.entries) ? value.entries : [];
      return {
        count: entries.length,
        needsTriage: entries.filter((entry) => entry.confirmationStatus === "needs_triage" || entry.decisionStatus === "needs_triage").length,
        generatedAt: value.generatedAt || ""
      };
    } catch (_error) {
      return { count: 0, needsTriage: 0, generatedAt: "" };
    }
  };
  const requirements = readIndex("index.json");
  const knowledgeRoot = path.join(workspace, "knowledge", ".ravo", "knowledge");
  let knowledge = { count: 0, generatedAt: "" };
  try {
    const value = JSON.parse(fs.readFileSync(path.join(knowledgeRoot, "index.json"), "utf8"));
    knowledge = { count: Array.isArray(value.entries) ? value.entries.length : 0, generatedAt: value.generatedAt || "" };
  } catch (_error) {}
  return { requirements, knowledge, source: "knowledge/.ravo/pool/index.json + knowledge/.ravo/knowledge/index.json" };
}

function compareText(left, right) {
  return String(left || "") < String(right || "") ? -1 : String(left || "") > String(right || "") ? 1 : 0;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function parseTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : parseTime(value);
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : "";
}

function nowMs(options = {}) {
  if (options.now instanceof Date) return options.now.getTime();
  if (typeof options.now === "number") return options.now;
  const parsed = parseTime(options.now);
  return parsed || Date.now();
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realpathDirectory(candidate) {
  try {
    const canonical = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(canonical).isDirectory() ? canonical : "";
  } catch (_error) {
    return "";
  }
}

function workspaceId(canonicalPath) {
  return `ws_${crypto.createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24)}`;
}

function warning(code, message, extra = {}) {
  return { code, message, ...extra };
}

function normalizeOverrideEntries(input, warnings) {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input || {});
  const normalized = new Map();
  for (const [configuredPath, rawValue] of entries) {
    if (!path.isAbsolute(configuredPath || "")) {
      warnings.push(warning("workspace_override_not_absolute", "Workspace override path must be absolute.", { path: configuredPath || "" }));
      continue;
    }
    const canonical = realpathDirectory(configuredPath);
    if (!canonical) {
      warnings.push(warning("workspace_override_missing", "Workspace override path does not resolve to a directory.", { path: configuredPath }));
      continue;
    }
    if (path.normalize(configuredPath) !== canonical) {
      warnings.push(warning("workspace_override_not_canonical", "Workspace override path must already be canonical.", { path: configuredPath, canonicalPath: canonical }));
      continue;
    }
    const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
    const priority = ["high", "normal", "low"].includes(value.priority) ? value.priority : "normal";
    const lifecycle = ["active", "paused", "archived"].includes(value.lifecycle) ? value.lifecycle : "active";
    if (value.priority !== undefined && value.priority !== priority) {
      warnings.push(warning("workspace_override_invalid_priority", "Invalid workspace priority; using normal.", { path: canonical }));
    }
    if (value.lifecycle !== undefined && value.lifecycle !== lifecycle) {
      warnings.push(warning("workspace_override_invalid_lifecycle", "Invalid workspace lifecycle; using active.", { path: canonical }));
    }
    normalized.set(canonical, {
      displayName: typeof value.displayName === "string" && value.displayName.trim() ? value.displayName.trim() : path.basename(canonical),
      priority,
      lifecycle
    });
  }
  return normalized;
}

function hasWorkspaceMarker(canonicalPath) {
  return fs.existsSync(path.join(canonicalPath, ".git")) || fs.existsSync(path.join(canonicalPath, "knowledge", ".ravo", "manifest.json"));
}

function workspaceRecord(canonicalPath, sources, override) {
  const manifestPath = path.join(canonicalPath, "knowledge", ".ravo", "manifest.json");
  return {
    workspaceId: workspaceId(canonicalPath),
    name: override?.displayName || path.basename(canonicalPath),
    displayName: override?.displayName || path.basename(canonicalPath),
    canonicalPath,
    discoverySource: unique(sources).join("+"),
    discoverySources: unique(sources),
    ravoPresent: fs.existsSync(manifestPath),
    priority: override?.priority || "normal",
    lifecycle: override?.lifecycle || "active",
    lastIndexedAt: "",
    dataStatus: fs.existsSync(manifestPath) ? "complete" : "no_ravo_data",
    warnings: []
  };
}

function sortWorkspaces(workspaces) {
  return workspaces.sort((left, right) =>
    (LIFECYCLE_RANK[left.lifecycle] ?? 9) - (LIFECYCLE_RANK[right.lifecycle] ?? 9)
    || (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9)
    || compareText(left.displayName, right.displayName)
    || compareText(left.canonicalPath, right.canonicalPath));
}

function discoverWorkspaces(options = {}) {
  const warnings = [];
  const overrides = normalizeOverrideEntries(options.workspaceOverrides, warnings);
  const configuredRoots = Array.isArray(options.workspaceRoots) ? options.workspaceRoots : Array.isArray(options.roots) ? options.roots : [];
  const records = new Map();
  const usedOverrides = new Set();

  function addCandidate(canonicalPath, sources) {
    const override = overrides.get(canonicalPath);
    if (override) usedOverrides.add(canonicalPath);
    const current = records.get(canonicalPath);
    if (current) {
      current.discoverySources = unique([...current.discoverySources, ...sources, ...(override ? ["override"] : [])]);
      current.discoverySource = current.discoverySources.join("+");
      return;
    }
    records.set(canonicalPath, workspaceRecord(canonicalPath, [...sources, ...(override ? ["override"] : [])], override));
  }

  if (!configuredRoots.length) {
    const cwd = realpathDirectory(options.cwd || process.cwd());
    if (!cwd) warnings.push(warning("startup_cwd_missing", "Startup cwd does not resolve to a directory.", { path: options.cwd || process.cwd() }));
    else addCandidate(cwd, ["startup_cwd"]);
  } else {
    for (const configuredRoot of configuredRoots) {
      const root = realpathDirectory(configuredRoot);
      if (!root) {
        warnings.push(warning("workspace_root_missing", "Workspace root does not resolve to a directory.", { path: configuredRoot || "" }));
        continue;
      }
      const candidates = [{ lexicalPath: path.resolve(configuredRoot), canonicalPath: root, source: "root" }];
      let dir;
      try {
        dir = fs.opendirSync(root);
        let entry;
        while ((entry = dir.readSync())) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const lexicalPath = path.join(root, entry.name);
          const canonicalPath = realpathDirectory(lexicalPath);
          if (!canonicalPath) continue;
          if (!isWithin(root, canonicalPath)) {
            warnings.push(warning("workspace_symlink_escape", "Skipped a direct child whose real path escapes its allowlisted root.", {
              path: lexicalPath,
              canonicalPath,
              root
            }));
            continue;
          }
          candidates.push({ lexicalPath, canonicalPath, source: "direct_child" });
        }
      } catch (error) {
        warnings.push(warning("workspace_root_unreadable", "Workspace root could not be listed.", { path: root, reason: error.code || error.message }));
      } finally {
        try { dir?.closeSync(); } catch (_error) { /* Best effort. */ }
      }
      for (const candidate of candidates) {
        const override = overrides.has(candidate.canonicalPath);
        if (!hasWorkspaceMarker(candidate.canonicalPath) && !override) continue;
        const sources = [candidate.source];
        if (fs.existsSync(path.join(candidate.canonicalPath, ".git"))) sources.push("git");
        if (fs.existsSync(path.join(candidate.canonicalPath, "knowledge", ".ravo", "manifest.json"))) sources.push("manifest");
        addCandidate(candidate.canonicalPath, sources);
      }
    }
  }

  for (const canonicalPath of overrides.keys()) {
    if (!usedOverrides.has(canonicalPath)) {
      warnings.push(warning("workspace_override_outside_allowlist", "Workspace override is not the startup cwd, an allowlisted root, or one of its direct children.", { path: canonicalPath }));
    }
  }
  return { workspaces: sortWorkspaces([...records.values()]), warnings };
}

function safeArtifactPath(workspace, candidate) {
  try {
    const canonicalPath = fs.realpathSync(candidate);
    const ravoRoot = fs.realpathSync(path.join(workspace, "knowledge", ".ravo"));
    if (!isWithin(workspace, canonicalPath) || !isWithin(ravoRoot, canonicalPath) || !fs.statSync(canonicalPath).isFile()) return "";
    return canonicalPath;
  } catch (_error) {
    return "";
  }
}

function relativeRef(workspace, file) {
  return path.relative(workspace, file).split(path.sep).join("/");
}

function boundedValue(value, depth = 0) {
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 3997)}...` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => boundedValue(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, boundedValue(item, depth + 1)]).filter(([, item]) => item !== undefined));
}

const DETAIL_FIELDS = [
  "goal", "consumer", "scope", "constraints", "facts", "options", "challenge", "validation", "statusCeiling", "evidenceLevel",
  "subjectRef", "relatedArtifact", "releaseRef", "specRef", "workstreamArtifact", "reviewArtifact", "acceptanceScope", "milestoneRef", "baselineRef",
  "currentMilestone", "nextStep", "reviewEvidence", "reviewArtifact", "reviewRequired", "impactLevel", "derivedConclusion",
  "workflowCoverage", "coverage", "parserStatus", "validResults", "modelsRequested", "modelsResponded", "modelsUsable",
  "modelsFailed", "failedModelReasons", "challengeStatus", "convergenceStatus", "issueStatusCounts", "runtimeHealth", "runtimeProbeStatus", "coreRuntimeStatus", "terminalTelemetryStatus", "terminalTelemetry", "marketplaceStatus", "pluginStatus",
  "manifestStatus", "configStatus", "blockingReason", "blockerImpact", "temporaryFallback", "recoveryEntry",
  "openQuestions", "blindSpotFindings", "assumptions", "nextActions", "milestones", "blockers", "recovery", "blockerLedger", "executionLanes", "executionDecisions", "authorizationEnvelopes", "effectiveDeliveryProfile", "timing", "capabilityRoutes", "decisions", "roadmapAudit", "specDeltas", "workerEvidence",
  "checks", "risks", "knownGaps", "unmetItems", "acceptanceItems", "codexVerificationItemIds", "pmChecklistItemIds", "pmDecision",
  "gitBaselineArtifact", "gitBaselineStatus", "gitBaselineSummary", "baseline", "trigger", "drift", "deliveryAttemptFingerprint", "freshSessionE2e", "formalReviewStarted",
  "installedRoot", "actualEntrypoint", "resolutionSource", "controllerVersion", "taskOwned", "preExisting", "mixedOrUnknown", "securityFindings", "remoteMutation", "baselineRef", "authorizationRequired", "authorizationRequestedAt", "recoveryEntry", "runtime", "checks", "updateCheck",
  "pmChecklistRef", "realResponseRefs", "screenshotRefs", "dataEvidenceRefs", "applicability", "relatedArtifacts"
];

function artifactSourceRefs(value) {
  const direct = [
    value.specRef, value.analysisArtifact, value.workstreamArtifact, value.quickValidationArtifact, value.reviewArtifact,
    value.knowledgeArtifact, value.issueLedgerRef, value.relatedArtifact, value.subjectRef, value.releaseRef,
    ...(Array.isArray(value.sourceRefs) ? value.sourceRefs : []),
    ...(Array.isArray(value.evidenceRefs) ? value.evidenceRefs : []),
    ...(Array.isArray(value.realResponseRefs) ? value.realResponseRefs : []),
    ...(Array.isArray(value.screenshotRefs) ? value.screenshotRefs : []),
    ...(Array.isArray(value.dataEvidenceRefs) ? value.dataEvidenceRefs : []),
    ...(Array.isArray(value.acceptanceItems) ? value.acceptanceItems.flatMap((item) => Array.isArray(item?.sourceRefs) ? item.sourceRefs : []) : [])
  ];
  return unique(direct);
}

function jsonArtifactMetadata(workspace, moduleId, file, value, stat) {
  const details = {};
  for (const field of DETAIL_FIELDS) {
    if (value[field] !== undefined) details[field] = boundedValue(value[field]);
  }
  const createdAt = iso(value.createdAt) || iso(stat.birthtimeMs) || iso(stat.mtimeMs);
  const updatedAt = iso(value.updatedAt) || createdAt || iso(stat.mtimeMs);
  return {
    id: typeof value.id === "string" && value.id ? value.id : path.basename(file, ".json"),
    module: moduleId,
    format: "json",
    kind: value.kind || value.type || value.artifactKind || moduleId,
    title: value.title || value.scope || value.goal || value.summary || path.basename(file, ".json"),
    summary: typeof value.summary === "string" ? boundedValue(value.summary) : "",
    status: typeof value.status === "string" ? value.status : "unknown",
    schemaVersion: typeof value.schemaVersion === "string" ? value.schemaVersion : "",
    subjectRef: typeof value.subjectRef === "string" ? value.subjectRef : "",
    relatedArtifact: typeof value.relatedArtifact === "string" ? value.relatedArtifact : "",
    releaseRef: typeof value.releaseRef === "string" ? value.releaseRef : "",
    sourceRefs: artifactSourceRefs(value),
    createdAt,
    updatedAt,
    fileUpdatedAt: iso(stat.mtimeMs),
    relativePath: relativeRef(workspace, file),
    canonicalPath: file,
    size: stat.size,
    details
  };
}

function markdownArtifactMetadata(workspace, moduleId, file, stat, maxBytes) {
  const fd = fs.openSync(file, "r");
  try {
    const bytes = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, 0);
    const prefix = buffer.toString("utf8");
    const title = prefix.split(/\r?\n/).find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() || path.basename(file, ".md");
    const createdAt = iso(stat.birthtimeMs) || iso(stat.mtimeMs);
    return {
      id: path.basename(file, ".md"),
      module: moduleId,
      format: "markdown",
      kind: moduleId,
      title,
      summary: "",
      status: "unknown",
      schemaVersion: "",
      subjectRef: "",
      relatedArtifact: "",
      releaseRef: "",
      sourceRefs: [],
      createdAt,
      updatedAt: iso(stat.mtimeMs),
      fileUpdatedAt: iso(stat.mtimeMs),
      relativePath: relativeRef(workspace, file),
      canonicalPath: file,
      size: stat.size,
      details: {}
    };
  } finally {
    fs.closeSync(fd);
  }
}

function artifactTime(artifact) {
  return parseTime(artifact.updatedAt) || parseTime(artifact.createdAt) || parseTime(artifact.fileUpdatedAt);
}

function readArtifactMetadata(workspace, moduleId, file, options, warnings) {
  const maxArtifactBytes = Number.isFinite(options.maxArtifactBytes) ? Math.max(1024, options.maxArtifactBytes) : 2 * 1024 * 1024;
  const maxMarkdownBytes = Number.isFinite(options.maxMarkdownBytes) ? Math.max(1024, options.maxMarkdownBytes) : 64 * 1024;
  let stat;
  try { stat = fs.statSync(file); } catch (error) {
    warnings.push(warning("artifact_unreadable", "Artifact metadata could not be read.", { path: relativeRef(workspace, file), reason: error.code || error.message }));
    return null;
  }
  if (file.endsWith(".json") && stat.size > maxArtifactBytes) {
    warnings.push(warning("artifact_metadata_too_large", "JSON artifact exceeds the bounded metadata read limit and was skipped.", { path: relativeRef(workspace, file), size: stat.size }));
    return null;
  }
  try {
    if (file.endsWith(".json")) {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("artifact_shape_invalid");
      return jsonArtifactMetadata(workspace, moduleId, file, value, stat);
    }
    return markdownArtifactMetadata(workspace, moduleId, file, stat, maxMarkdownBytes);
  } catch (error) {
    warnings.push(warning("artifact_invalid", "Artifact metadata is invalid; other artifacts remain available.", { path: relativeRef(workspace, file), reason: error.code || error.message }));
    return null;
  }
}

function moduleForFile(workspace, file) {
  for (const moduleId of ARTIFACT_MODULES) {
    const dir = path.join(workspace, "knowledge", ".ravo", moduleId);
    if (isWithin(dir, file)) return moduleId;
  }
  return "";
}

function collectArtifactFiles(workspace, limit, options, warnings) {
  const files = [];
  const maxCandidates = Number.isFinite(options.maxArtifactCandidates)
    ? Math.max(limit, options.maxArtifactCandidates)
    : Math.max(1000, limit * 10);
  let visited = 0;
  for (const moduleId of ARTIFACT_MODULES) {
    const dirPath = path.join(workspace, "knowledge", ".ravo", moduleId);
    let canonicalDir;
    try {
      canonicalDir = fs.realpathSync(dirPath);
      if (!isWithin(workspace, canonicalDir) || !fs.statSync(canonicalDir).isDirectory()) throw new Error("directory_escape");
    } catch (_error) {
      continue;
    }
    let dir;
    try {
      dir = fs.opendirSync(canonicalDir);
      let entry;
      while ((entry = dir.readSync())) {
        if (visited >= maxCandidates) {
          warnings.push(warning("artifact_candidate_limit", "Artifact directory scan reached its bounded candidate limit.", { limit: maxCandidates }));
          return files;
        }
        visited += 1;
        if (!/\.(?:json|md)$/i.test(entry.name) || entry.name === "index.json") continue;
        const canonicalFile = safeArtifactPath(workspace, path.join(canonicalDir, entry.name));
        if (!canonicalFile || !isWithin(canonicalDir, canonicalFile)) {
          warnings.push(warning("artifact_path_escape", "Skipped an artifact whose canonical path escapes its module directory.", { path: path.join(canonicalDir, entry.name) }));
          continue;
        }
        try { files.push({ file: canonicalFile, moduleId, mtimeMs: fs.statSync(canonicalFile).mtimeMs }); } catch (_error) { /* Reported when read. */ }
      }
    } catch (error) {
      warnings.push(warning("artifact_directory_unreadable", "Artifact directory could not be listed.", { path: relativeRef(workspace, canonicalDir), reason: error.code || error.message }));
    } finally {
      try { dir?.closeSync(); } catch (_error) { /* Best effort. */ }
    }
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs || compareText(right.file, left.file));
}

function manifestLatestRefs(manifest) {
  const refs = [];
  for (const moduleId of ARTIFACT_MODULES) {
    const module = manifest.modules?.[moduleId];
    if (!module || typeof module !== "object") continue;
    for (const [key, value] of Object.entries(module)) {
      if (/^latest.*Artifact$/i.test(key) && typeof value === "string") refs.push(value);
    }
  }
  return unique(refs);
}

function manifestLatestByModule(manifest) {
  return Object.fromEntries(ARTIFACT_MODULES.map((moduleId) => {
    const module = manifest?.modules?.[moduleId];
    const ref = typeof module?.latestArtifact === "string" ? module.latestArtifact
      : typeof module?.latestCompleteArtifact === "string" ? module.latestCompleteArtifact : "";
    return [moduleId, ref];
  }).filter(([, ref]) => ref));
}

function indexArtifacts(workspaceInput, options = {}) {
  const workspace = typeof workspaceInput === "string" ? realpathDirectory(workspaceInput) : workspaceInput?.canonicalPath;
  if (!workspace) throw new Error("indexArtifacts requires a discovered workspace or canonical workspace path");
  const warnings = [];
  const limit = Number.isFinite(options.artifactLimitPerWorkspace)
    ? Math.min(5000, Math.max(1, Math.trunc(options.artifactLimitPerWorkspace)))
    : DEFAULT_ARTIFACT_LIMIT;
  const manifestPath = path.join(workspace, "knowledge", ".ravo", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      dataStatus: "no_ravo_data",
      manifest: { status: "missing", path: relativeRef(workspace, manifestPath), schemaVersion: "", latestRefs: [] },
      artifacts: [],
      latestArtifacts: {},
      timeline: [],
      warnings
    };
  }

  let manifest;
  let manifestStatus = "healthy";
  let canonicalManifest = "";
  try {
    canonicalManifest = fs.realpathSync(manifestPath);
    if (!isWithin(workspace, canonicalManifest) || fs.statSync(canonicalManifest).size > 1024 * 1024) throw new Error("manifest_path_or_size_invalid");
    manifest = JSON.parse(fs.readFileSync(canonicalManifest, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !manifest.modules || typeof manifest.modules !== "object" || Array.isArray(manifest.modules)) throw new Error("manifest_shape_invalid");
  } catch (error) {
    manifestStatus = error.message === "manifest_path_or_size_invalid" ? "error" : "corrupt";
    warnings.push(warning("manifest_invalid", "Manifest is invalid; using a bounded scan of known artifact directories.", { path: relativeRef(workspace, manifestPath), reason: error.code || error.message }));
  }

  const referenced = manifest ? manifestLatestRefs(manifest) : [];
  const preferredLatest = manifestLatestByModule(manifest);
  const candidates = [];
  for (const ref of referenced) {
    const candidate = path.resolve(workspace, ref);
    const file = safeArtifactPath(workspace, candidate);
    const moduleId = file ? moduleForFile(workspace, file) : "";
    if (!file || !moduleId) {
      warnings.push(warning("manifest_artifact_invalid", "Manifest latest artifact reference is missing or outside a known artifact directory.", { path: ref }));
      continue;
    }
    candidates.push({ file, moduleId, manifestFirst: true, mtimeMs: fs.statSync(file).mtimeMs });
  }
  candidates.push(...collectArtifactFiles(workspace, limit, options, warnings));

  const artifacts = [];
  const seenPaths = new Set();
  const seenIds = new Set();
  for (const candidate of candidates) {
    if (artifacts.length >= limit || seenPaths.has(candidate.file)) continue;
    seenPaths.add(candidate.file);
    const metadata = readArtifactMetadata(workspace, candidate.moduleId, candidate.file, options, warnings);
    if (!metadata || seenIds.has(metadata.id)) continue;
    seenIds.add(metadata.id);
    artifacts.push(metadata);
  }
  artifacts.sort((left, right) => artifactTime(right) - artifactTime(left) || compareText(right.relativePath, left.relativePath));
  const latestArtifacts = {};
  for (const [moduleId, ref] of Object.entries(preferredLatest)) {
    const match = artifacts.find((artifact) => artifact.module === moduleId && artifact.relativePath === ref.split(path.sep).join("/"));
    if (match) latestArtifacts[moduleId] = match;
  }
  for (const artifact of artifacts) if (!latestArtifacts[artifact.module]) latestArtifacts[artifact.module] = artifact;
  const timeline = artifacts.map((artifact) => ({
    id: artifact.id,
    module: artifact.module,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    status: artifact.status,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    relativePath: artifact.relativePath,
    sourceRefs: artifact.sourceRefs
  }));
  const dataStatus = manifestStatus === "error" && !artifacts.length ? "error"
    : manifestStatus !== "healthy" || warnings.some((item) => /artifact|manifest/.test(item.code)) ? "partial" : "complete";
  return {
    dataStatus,
    manifest: {
      status: manifestStatus,
      path: relativeRef(workspace, canonicalManifest || manifestPath),
      schemaVersion: typeof manifest?.schemaVersion === "string" ? manifest.schemaVersion : "",
      latestRefs: referenced
    },
    artifacts,
    latestArtifacts,
    timeline,
    warnings
  };
}

function readJsonlTail(file, maxBytes, maxLines) {
  const stat = fs.statSync(file);
  const bytes = Math.min(stat.size, maxBytes);
  const start = stat.size - bytes;
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, start);
    let lines = buffer.toString("utf8").split(/\r?\n/);
    if (start > 0) lines = lines.slice(1);
    return { lines: lines.filter(Boolean).slice(-maxLines), truncated: start > 0 || lines.length > maxLines };
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeSessionRecord(value, options = {}) {
  if (!value || typeof value !== "object") return null;
  const payload = value.type === "session_meta" && value.payload && typeof value.payload === "object" ? value.payload : value;
  const id = payload.id || payload.session_id || payload.thread_id;
  if (typeof id !== "string" || !id) return null;
  return {
    id,
    cwd: typeof payload.cwd === "string" ? payload.cwd : typeof payload.workspace_path === "string" ? payload.workspace_path : "",
    createdAt: iso(payload.createdAt || payload.created_at || payload.timestamp || value.timestamp),
    updatedAt: iso(payload.updatedAt || payload.updated_at || value.updatedAt || value.updated_at),
    title: typeof payload.title === "string" ? payload.title : typeof payload.thread_name === "string" ? payload.thread_name : "",
    summary: typeof payload.summary === "string" ? payload.summary
      : options.showPromptSnippets === true && typeof payload.preview === "string" ? payload.preview : ""
  };
}

function listRolloutFiles(root, options, warnings) {
  if (!fs.existsSync(root)) return [];
  const maxEntries = Number.isFinite(options.sessionFallbackEntryLimit) ? Math.max(1, options.sessionFallbackEntryLimit) : 10000;
  const maxFiles = Number.isFinite(options.sessionFallbackFileLimit) ? Math.max(1, options.sessionFallbackFileLimit) : 1000;
  const stack = [root];
  const files = [];
  let visited = 0;
  while (stack.length && visited < maxEntries) {
    const dirPath = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((left, right) => compareText(right.name, left.name)); } catch (error) {
      warnings.push(warning("session_directory_unreadable", "Session metadata directory could not be listed.", { path: dirPath, reason: error.code || error.message }));
      continue;
    }
    for (const entry of entries) {
      if (visited++ >= maxEntries) break;
      const candidate = path.join(dirPath, entry.name);
      if (entry.isDirectory()) stack.push(candidate);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        try { files.push({ file: candidate, mtimeMs: fs.statSync(candidate).mtimeMs }); } catch (_error) { /* Skip vanished file. */ }
      }
    }
  }
  if (visited >= maxEntries) warnings.push(warning("session_fallback_entry_limit", "Session fallback reached its bounded directory entry limit.", { limit: maxEntries }));
  files.sort((left, right) => right.mtimeMs - left.mtimeMs || compareText(right.file, left.file));
  if (files.length > maxFiles) warnings.push(warning("session_fallback_file_limit", "Session fallback reached its bounded rollout file limit.", { limit: maxFiles }));
  return files.slice(0, maxFiles);
}

function readRolloutMetadata(file, options) {
  const maxBytes = Number.isFinite(options.sessionMetadataBytes) ? Math.max(1024, options.sessionMetadataBytes) : 4 * 1024;
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  try {
    const prefix = Buffer.alloc(Math.min(stat.size, maxBytes));
    const byte = Buffer.alloc(1);
    let length = 0;
    let position = 0;
    while (position < prefix.length && fs.readSync(fd, byte, 0, 1, position) === 1) {
      position += 1;
      if (byte[0] === 0x0a) return rolloutRecordFromPrefix(prefix.subarray(0, length).toString("utf8"), stat);
      if (byte[0] === 0x0d) continue;
      prefix[length++] = byte[0];
      if (length % 32 !== 0) continue;
      const record = rolloutRecordFromPrefix(prefix.subarray(0, length).toString("utf8"), stat);
      if (record) return record;
    }
    return rolloutRecordFromPrefix(prefix.subarray(0, length).toString("utf8"), stat);
  } finally {
    fs.closeSync(fd);
  }
}

function rolloutRecordFromPrefix(text, stat) {
  if (jsonStringField(text, "type") !== "session_meta") return null;
  const id = jsonStringField(text, "id") || jsonStringField(text, "session_id");
  const cwd = jsonStringField(text, "cwd");
  if (!id || !cwd) return null;
  return { id, cwd, createdAt: iso(jsonStringField(text, "timestamp")), updatedAt: iso(stat.mtimeMs), title: "", summary: "" };
}

function jsonStringField(text, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`).exec(text);
  if (!match) return "";
  try { return JSON.parse(match[1]); } catch (_error) { return ""; }
}

function sessionWorkspace(workspaces, cwd) {
  if (!cwd) return null;
  let canonicalCwd;
  try { canonicalCwd = fs.realpathSync(path.resolve(cwd)); } catch (_error) { return null; }
  return [...workspaces]
    .filter((workspace) => isWithin(workspace.canonicalPath, canonicalCwd))
    .sort((left, right) => right.canonicalPath.length - left.canonicalPath.length || compareText(left.canonicalPath, right.canonicalPath))[0] || null;
}

function indexSessions(workspaces, options = {}) {
  const warnings = [];
  const home = path.resolve(options.home || os.homedir());
  const sessionIndexPath = path.resolve(options.sessionIndexPath || path.join(home, ".codex", "session_index.jsonl"));
  const sessionsRoot = path.resolve(options.sessionsRoot || path.join(home, ".codex", "sessions"));
  const maxIndexBytes = Number.isFinite(options.sessionIndexBytes) ? Math.max(1024, options.sessionIndexBytes) : 8 * 1024 * 1024;
  const maxIndexLines = Number.isFinite(options.sessionIndexLineLimit) ? Math.max(1, options.sessionIndexLineLimit) : 10000;
  const byId = new Map();
  let partial = false;
  let primaryError = false;

  if (fs.existsSync(sessionIndexPath)) {
    try {
      const input = readJsonlTail(sessionIndexPath, maxIndexBytes, maxIndexLines);
      partial ||= input.truncated;
      if (input.truncated) warnings.push(warning("session_index_bounded", "Session index was read with bounded tail limits.", { path: sessionIndexPath }));
      for (const line of input.lines) {
        let value;
        try { value = JSON.parse(line); } catch (_error) {
          partial = true;
          warnings.push(warning("session_index_invalid_line", "Skipped an invalid session index line.", { path: sessionIndexPath }));
          continue;
        }
        const record = normalizeSessionRecord(value, { showPromptSnippets: options.showPromptSnippets === true });
        if (!record) {
          partial = true;
          warnings.push(warning("session_index_unknown_record", "Skipped an incompatible session index record.", { path: sessionIndexPath }));
          continue;
        }
        const previous = byId.get(record.id) || {};
        byId.set(record.id, { ...previous, ...Object.fromEntries(Object.entries(record).filter(([, item]) => item !== "")) });
      }
    } catch (error) {
      primaryError = true;
      partial = true;
      warnings.push(warning("session_index_unreadable", "Session index could not be read.", { path: sessionIndexPath, reason: error.code || error.message }));
    }
  } else {
    partial = true;
    warnings.push(warning("session_index_missing", "Primary session index is missing; bounded rollout metadata fallback will be used.", { path: sessionIndexPath }));
  }

  const needsFallback = primaryError || !byId.size || [...byId.values()].some((record) => !record.cwd);
  let fallbackReadable = false;
  if (needsFallback) {
    for (const entry of listRolloutFiles(sessionsRoot, options, warnings)) {
      let record;
      try { record = readRolloutMetadata(entry.file, options); } catch (error) {
        partial = true;
        warnings.push(warning("session_rollout_unreadable", "Skipped unreadable rollout metadata.", { reason: error.code || error.message }));
        continue;
      }
      if (!record) {
        partial = true;
        continue;
      }
      fallbackReadable = true;
      const previous = byId.get(record.id) || {};
      byId.set(record.id, {
        ...record,
        ...Object.fromEntries(Object.entries(previous).filter(([, item]) => item !== "")),
        cwd: previous.cwd || record.cwd,
        createdAt: previous.createdAt || record.createdAt,
        updatedAt: previous.updatedAt || record.updatedAt
      });
    }
  }
  if (needsFallback && !fallbackReadable && [...byId.values()].some((record) => !record.cwd)) {
    partial = true;
    warnings.push(warning("session_metadata_fallback_unavailable", "Session records without cwd could not be completed from bounded rollout metadata.", { path: sessionsRoot }));
  }
  if (warnings.some((item) => ["session_fallback_entry_limit", "session_fallback_file_limit", "session_directory_unreadable"].includes(item.code))) partial = true;

  const sessions = [];
  for (const record of byId.values()) {
    const workspace = sessionWorkspace(workspaces, record.cwd);
    if (!workspace) continue;
    sessions.push({
      id: record.id,
      cwd: realpathDirectory(record.cwd) || path.resolve(record.cwd),
      createdAt: record.createdAt || "",
      updatedAt: record.updatedAt || record.createdAt || "",
      title: record.title || "",
      summary: record.summary || ""
    });
  }
  sessions.sort((left, right) => parseTime(right.updatedAt) - parseTime(left.updatedAt) || compareText(left.id, right.id));
  const sessionDataStatus = primaryError && !fallbackReadable && !sessions.length ? "error" : partial ? "partial" : "complete";
  return { sessions, sessionDataStatus, warnings };
}

function getInjected(source, workspace) {
  if (!source) return undefined;
  if (source instanceof Map) return source.get(workspace.workspaceId) ?? source.get(workspace.canonicalPath);
  if (typeof source === "object") return source[workspace.workspaceId] ?? source[workspace.canonicalPath];
  return undefined;
}

function metadata(sourceRefs, freshness, confidence, derivedAt, sourceUpdatedAt) {
  return {
    sourceRefs: unique(sourceRefs),
    freshness: ["current", "stale", "unknown"].includes(freshness) ? freshness : "unknown",
    confidence: ["high", "medium", "low"].includes(confidence) ? confidence : "low",
    derivedAt,
    sourceUpdatedAt: iso(sourceUpdatedAt)
  };
}

function confidenceFor(workspace, freshness, runtimeHealth) {
  if (["partial", "error", "no_ravo_data"].includes(workspace.dataStatus) || freshness !== "current") return "low";
  if (runtimeHealth === "healthy") return "high";
  if (["configured_unverified", "core_verified"].includes(runtimeHealth)) return "medium";
  return "low";
}

function latestTimeFromRefs(workspace, refs, fallback = "") {
  const lookup = new Map((workspace.artifacts || []).map((artifact) => [artifact.relativePath, artifact]));
  return unique(refs).reduce((latest, ref) => Math.max(latest, artifactTime(lookup.get(ref) || {})), parseTime(fallback));
}

function laneItem(workspace, runtimeHealth, derivedAt, input) {
  const freshness = input.freshness || "current";
  const sourceUpdatedAt = input.sourceUpdatedAt || latestTimeFromRefs(workspace, input.sourceRefs, input.updatedAt);
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    details: input.details || {},
    ...metadata(input.sourceRefs, freshness, input.confidence || confidenceFor(workspace, freshness, runtimeHealth), derivedAt, sourceUpdatedAt)
  };
}

function lane(name, items, emptyStatus, emptySummary, derivedAt) {
  const status = items.some((item) => item.status === "blocked") ? "blocked"
    : items.some((item) => item.status === "attention") ? "attention"
      : items.some((item) => item.status === "unknown") ? "unknown"
        : items.length && items.every((item) => item.status === "not_applicable") ? "not_applicable"
          : items.length ? "clear" : emptyStatus;
  const freshness = items.some((item) => item.freshness === "stale") ? "stale"
    : items.some((item) => item.freshness === "unknown") || !items.length ? "unknown" : "current";
  const confidence = items.some((item) => item.confidence === "low") || !items.length ? "low"
    : items.some((item) => item.confidence === "medium") ? "medium" : "high";
  const sourceUpdatedAt = items.reduce((latest, item) => Math.max(latest, parseTime(item.sourceUpdatedAt)), 0);
  return {
    name,
    status,
    summary: items.length ? items.map((item) => item.summary).filter(Boolean).join("; ") : emptySummary,
    items,
    ...metadata(items.flatMap((item) => item.sourceRefs), freshness, confidence, derivedAt, sourceUpdatedAt)
  };
}

function normalizedBlockers(workstream) {
  const values = workstream?.details?.blockerLedger || workstream?.details?.blockers || [];
  return values.filter((blocker) => typeof blocker === "string" || blocker?.executionStatus !== "resolved").map((blocker, index) => typeof blocker === "string"
    ? { id: `blocker-${index + 1}`, title: blocker, required: true, recoveryEntry: workstream.details.recovery || "" }
    : {
      id: blocker.id || `blocker-${index + 1}`,
      title: blocker.title || blocker.blockingReason || blocker.reason || "Blocked workstream",
      required: blocker.required !== false,
      type: blocker.type || "technical",
      owner: blocker.owner || "main_agent",
      executionStatus: blocker.executionStatus || "detected",
      affectedMilestones: blocker.affectedMilestones || [],
      attemptBudget: blocker.attemptBudget || {},
      continuationAllowed: blocker.continuationAllowed !== false,
      temporaryFallback: blocker.temporaryFallback || "",
      recoveryEntry: blocker.recoveryEntry || blocker.recovery || workstream.details.recovery || "",
      resumeConditions: blocker.resumeConditions || [],
      nextStep: blocker.nextStep || ""
    });
}

function acceptanceFacts(acceptance) {
  const items = Array.isArray(acceptance?.details?.acceptanceItems) ? acceptance.details.acceptanceItems : [];
  return {
    items,
    pendingCodex: items.filter((item) => item.verificationStatus === "pending_codex"),
    pendingPm: items.filter((item) => item.verificationStatus === "pending_pm"),
    blocked: items.filter((item) => item.verificationStatus === "blocked"),
    notMet: items.filter((item) => item.fulfillmentStatus === "not_met"),
    partial: items.filter((item) => item.fulfillmentStatus === "partial")
  };
}

function blocksIndependentDelivery(blocker) {
  if (!blocker || blocker.required === false) return false;
  return !(blocker.executionStatus === "blocked_external" && blocker.continuationAllowed === true);
}

function isAllowedExternalAcceptanceBlocker(item) {
  return Boolean(item?.verificationStatus === "blocked"
    && item?.blockerExecutionStatus === "blocked_external"
    && item?.verificationOwner === "external"
    && ["pending_pm", "accepted"].includes(item?.externalBlockerDecision)
    && typeof item?.externalBlockerSpecRef === "string" && item.externalBlockerSpecRef.trim()
    && typeof item?.externalBlockerSpecAnchor === "string" && item.externalBlockerSpecAnchor.trim()
    && typeof item?.blockerImpact === "string" && item.blockerImpact.trim()
    && typeof item?.temporaryFallback === "string" && item.temporaryFallback.trim()
    && typeof item?.recoveryEntry === "string" && item.recoveryEntry.trim());
}

function staleByAge(artifact, staleAfterDays, now) {
  if (!artifact || !artifactTime(artifact)) return false;
  return now - artifactTime(artifact) > staleAfterDays * 86400000;
}

function stateRecord(workspace, runtimeHealth, derivedAt, status, summary, refs, freshness = "current", updatedAt = "") {
  return { status, summary, ...metadata(refs, freshness, confidenceFor(workspace, freshness, runtimeHealth), derivedAt, latestTimeFromRefs(workspace, refs, updatedAt)) };
}

function attentionItem(workspace, runtimeHealth, derivedAt, input) {
  const freshness = input.freshness || "current";
  const confidence = input.confidence || confidenceFor(workspace, freshness, runtimeHealth);
  const suggestedAction = confidence === "low" && !["runtime", "data"].includes(input.category)
    ? "先刷新 Runtime 与数据来源，再处理该业务判断。"
    : input.suggestedAction;
  const seed = `${workspace.workspaceId}|${input.lane}|${input.category}|${input.title}|${unique(input.sourceRefs).join("|")}`;
  return {
    id: `attn_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20)}`,
    workspaceId: workspace.workspaceId,
    lane: input.lane,
    severity: input.severity,
    title: input.title,
    reason: input.reason,
    suggestedAction,
    expectedOutcome: input.expectedOutcome,
    blocking: Boolean(input.blocking),
    category: input.category,
    sortGroup: input.sortGroup,
    ...metadata(input.sourceRefs, freshness, confidence, derivedAt, input.sourceUpdatedAt || latestTimeFromRefs(workspace, input.sourceRefs))
  };
}

function suggestion(workspace, runtimeHealth, derivedAt, input) {
  const freshness = input.freshness || "current";
  return {
    action: input.action,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome,
    blocking: Boolean(input.blocking),
    ...metadata(input.sourceRefs, freshness, input.confidence || confidenceFor(workspace, freshness, runtimeHealth), derivedAt, input.sourceUpdatedAt || latestTimeFromRefs(workspace, input.sourceRefs))
  };
}

function runtimeRefs(runtime) {
  return unique([
    runtime?.runtimeProbe?.artifactPath,
    runtime?.terminalTelemetry?.evidenceRef,
    runtime?.runtimeProbe?.terminalTelemetry?.evidenceRef,
    runtime?.fingerprint ? `runtime:${runtime.fingerprint}` : ""
  ]);
}

function runtimeSummary(runtime) {
  if (!runtime) return "本次刷新未取得本机环境状态。";
  const core = runtime.coreRuntimeStatus || runtime.runtimeProbe?.coreRuntimeStatus || "unknown";
  const terminal = runtime.terminalTelemetryStatus || runtime.terminalTelemetry?.status || runtime.runtimeProbe?.terminalTelemetry?.status || "unknown";
  if (core === "verified") {
    const terminalSummary = {
      observed: "任务结束状态已经记录。",
      unknown: "任务结束状态未单独记录，不影响当前版本收口。",
      unsupported: "当前环境无法单独记录任务结束状态，不影响当前版本收口。",
      failed: "任务结束时记录到异常，需要查看诊断。"
    }[terminal] || "任务结束状态尚不明确。";
    return `本机核心能力已验证。${terminalSummary}`;
  }
  return "本机核心能力尚未验证，需要通过新的真实任务确认。";
}

function artifactPmBrief(artifact) {
  const brief = artifact?.details?.pmBrief;
  return brief && validatePmBrief(brief).length === 0 ? brief : null;
}

function fallbackPmBrief({ workspace, acceptanceInfo, blockers, runtimeHealth, runtimeDeliveryArtifact, workstream, analysis, quickValidation }) {
  const pendingPm = acceptanceInfo.pendingPm.length > 0;
  const deliveryPassed = runtimeDeliveryArtifact?.status === "passed";
  const runtimeAvailable = ["healthy", "core_verified"].includes(runtimeHealth);
  const activeWork = workstream?.status === "active";
  const validated = ["ready_for_acceptance", "closed"].includes(workstream?.status) || runtimeDeliveryArtifact?.status === "not_required";
  const verificationFailed = quickValidation?.status === "fail";
  const blocked = verificationFailed || blockers.length > 0 || ["blocked", "failed_source_defect", "blocked_external"].includes(runtimeDeliveryArtifact?.status);
  const sourceRefs = unique([
    acceptanceInfo.pendingPm[0]?.sourceRefs?.[0],
    runtimeDeliveryArtifact?.relativePath,
    workstream?.relativePath,
    analysis?.relativePath,
    `dashboard:${workspace.workspaceId}`
  ]);
  return buildPmBrief({
    headline: pendingPm ? "当前成果正在等待你的体验判断"
      : verificationFailed ? "自动验证发现需要修复的问题"
        : blocked ? "当前工作暂时停下"
        : deliveryPassed ? "本机 RAVO 已经可以使用"
          : activeWork ? "本轮工作正在推进"
            : validated ? "实现和当前自动检查已经完成"
              : analysis ? "产品方向已经形成"
                : runtimeAvailable ? "本机 RAVO 运行正常" : "当前产品状态正在核对",
    stage: pendingPm ? "experience" : runtimeDeliveryArtifact ? "integrate" : workstream ? "build" : analysis ? "align" : "operate",
    productState: pendingPm ? "awaiting_pm" : blocked ? "blocked" : deliveryPassed ? "locally_available" : activeWork ? "in_progress" : validated ? "validated" : analysis ? "planned" : runtimeAvailable ? "locally_available" : "unknown",
    userImpact: pendingPm ? "本机成果已经准备好，你的体验结论将决定下一轮方向。"
      : verificationFailed ? "现有产品和使用环境保持不变，Codex 会先修复问题并重新验证。"
        : blocked ? "现有产品和使用环境保持不变，Codex 会先处理阻塞。"
        : deliveryPassed ? "你可以继续在本机使用；这不代表已经发布给其他用户。"
          : activeWork || validated || analysis ? "现有产品和使用环境保持不变，Codex 会继续已确认范围内的工作。"
            : runtimeAvailable ? "你可以继续在本机使用；当前没有证据表明远端或其他用户环境发生变化。" : "现有产品和使用环境保持不变，Codex 会继续核对当前状态。",
    actionRequired: pendingPm ? "experience_acceptance" : "none",
    nextStep: pendingPm ? "请按验收清单体验核心路径，然后选择接受或继续优化。" : verificationFailed ? "Codex 将修复验证问题并重新检查。" : blocked ? "Codex 将按恢复路径处理问题并重新验证。" : "Codex 将继续完成已确认范围内的下一步。",
    decisionCard: pendingPm ? {
      question: "是否接受当前产品体验并进入下一步？",
      whyNow: "可自动验证的事项已经完成，剩余内容需要你的产品体验判断。",
      recommendation: "先体验核心路径，再选择接受或继续优化。",
      options: [
        { id: "accept", label: "接受", outcome: "记录本轮通过并进入下一步。" },
        { id: "revise", label: "继续优化", outcome: "保留当前成果并记录体验问题。" }
      ],
      waitingImpact: "暂不决定不会改变现有环境，但下一轮不会开始。"
    } : null,
    evidenceBoundary: {
      proves: [pendingPm ? "已识别需要产品体验判断的验收项" : deliveryPassed ? "本机当前成果已有实际使用证据" : runtimeAvailable && !workstream && !analysis ? "本机核心运行状态已有当前证据" : "已汇总当前可用的产品和执行证据"],
      doesNotProve: [deliveryPassed || runtimeAvailable && !workstream && !analysis ? "尚不代表已经发布给其他用户" : "尚不代表本机已经可以使用本轮新能力"]
    },
    sourceRefs
  });
}

function deriveWorkspaceState(workspace, options = {}) {
  const now = nowMs(options);
  const derivedAt = iso(options.derivedAt) || iso(now);
  const staleAfterDays = Number.isFinite(options.staleAfterDays) ? Math.max(1, options.staleAfterDays) : 7;
  const freshness = options.freshness || {};
  const runtime = options.runtimeStatus || freshness.runtime || null;
  const runtimeHealth = runtime?.runtimeHealth || "unknown";
  const latest = workspace.latestArtifacts || {};
  const analysis = latest.analysis;
  const quickValidation = latest["quick-validation"];
  const gitBaselineArtifact = (workspace.artifacts || []).find((artifact) => artifact.module === "acceptance" && /git-baseline-.*\.json$/.test(artifact.relativePath));
  const runtimeDeliveryArtifact = (workspace.artifacts || []).find((artifact) => artifact.module === "acceptance" && /runtime-delivery-.*\.json$/.test(artifact.relativePath));
  const acceptanceFreshness = freshness.acceptanceFreshness || {};
  const authoritativeSelection = freshness.authoritativeWorkstream || acceptanceFreshness.authoritativeWorkstream || {};
  const hasAuthoritativeSelection = Object.prototype.hasOwnProperty.call(authoritativeSelection, "artifactPath");
  const workstream = authoritativeSelection.artifactPath
    ? (workspace.artifacts || []).find((artifact) => artifact.module === "workstream" && artifact.relativePath === authoritativeSelection.artifactPath) || null
    : hasAuthoritativeSelection ? null : latest.workstream;
  const hasAcceptanceSelection = Object.prototype.hasOwnProperty.call(acceptanceFreshness, "artifactPath")
    || Object.prototype.hasOwnProperty.call(acceptanceFreshness, "relationStatus")
    || Object.prototype.hasOwnProperty.call(freshness.selectedAcceptance || {}, "artifactPath");
  const acceptance = acceptanceFreshness.artifactPath
    ? (workspace.artifacts || []).find((artifact) => artifact.module === "acceptance" && artifact.relativePath === acceptanceFreshness.artifactPath) || null
    : hasAcceptanceSelection ? null : latest.acceptance;
  const knowledge = latest.knowledge;
  const hasReleaseReview = Boolean(freshness.releaseReview);
  const releaseReviewState = freshness.releaseReview || freshness.reviewFreshness || {};
  const review = releaseReviewState.artifactPath
    ? (workspace.artifacts || []).find((artifact) => artifact.module === "review" && artifact.relativePath === releaseReviewState.artifactPath) || null
    : hasReleaseReview ? null : latest.review;
  const openAnalysisReviews = Array.isArray(freshness.openAnalysisReviews) ? freshness.openAnalysisReviews : [];
  const blockers = normalizedBlockers(workstream);
  const acceptanceInfo = acceptanceFacts(acceptance);
  const deliveryBlockingAcceptance = acceptanceInfo.blocked.filter((item) => !isAllowedExternalAcceptanceBlocker(item));
  const pmBrief = [
    artifactPmBrief(acceptance),
    artifactPmBrief(runtimeDeliveryArtifact),
    artifactPmBrief(workstream),
    artifactPmBrief(analysis),
    runtime?.pmBrief && validatePmBrief(runtime.pmBrief).length === 0 ? runtime.pmBrief : null
  ].find(Boolean) || fallbackPmBrief({ workspace, acceptanceInfo, blockers, runtimeHealth, runtimeDeliveryArtifact, workstream, analysis, quickValidation });

  const specHealth = freshness.specHealth || {};
  const specStatus = specHealth.status || "unknown";
  const specRefs = unique([specHealth.specPath, ...(specHealth.staleInputs || []), workstream?.details?.specRef, acceptance?.details?.specRef]);
  const reasonItems = [];
  let analysisNeedsAttention = false;
  if (specStatus !== "unknown" || specRefs.length) {
    reasonItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: "reason-spec",
      kind: "spec",
      status: ["missing", "error"].includes(specStatus) ? "blocked" : ["stale", "draft"].includes(specStatus) ? "attention" : specStatus === "current" ? "clear" : "unknown",
      summary: specStatus === "current" ? "Spec is current." : `Spec status: ${specStatus}.`,
      sourceRefs: specRefs,
      freshness: specStatus === "stale" ? "stale" : specStatus === "current" ? "current" : "unknown",
      updatedAt: specHealth.checkedAt,
      details: boundedValue(specHealth)
    }));
  }
  if (analysis) {
    const openQuestions = analysis.details.openQuestions || [];
    const blindSpots = analysis.details.blindSpotFindings || [];
    analysisNeedsAttention = analysis.status !== "complete" || openQuestions.length > 0 || blindSpots.some((item) => item?.status !== "resolved");
    reasonItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `reason-analysis-${analysis.id}`,
      kind: "analysis",
      status: analysisNeedsAttention ? "attention" : "clear",
      summary: analysisNeedsAttention ? "Analysis has draft, open-question, or blind-spot work." : "Latest analysis is complete with no visible open question.",
      sourceRefs: [analysis.relativePath, ...analysis.sourceRefs],
      freshness: "current",
      updatedAt: analysis.updatedAt,
      details: { status: analysis.status, openQuestionCount: openQuestions.length, blindSpotCount: blindSpots.length }
    }));
  }

  const actItems = [];
  const workstreamStale = workspace.lifecycle === "active" && workstream?.status === "active" && staleByAge(workstream, staleAfterDays, now);
  if (workstream) {
    actItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `act-workstream-${workstream.id}`,
      kind: "workstream",
      status: blockers.length ? "blocked" : workstreamStale ? "attention" : "clear",
      summary: blockers.length ? `${blockers.length} workstream blocker(s).` : workstreamStale ? "Active workstream is stale." : `Workstream status: ${workstream.status}.`,
      sourceRefs: [workstream.relativePath, ...workstream.sourceRefs],
      freshness: workstreamStale ? "stale" : "current",
      updatedAt: workstream.updatedAt,
      details: {
        currentMilestone: workstream.details.currentMilestone || "",
        nextStep: workstream.details.nextStep || "",
        blockers,
        executionLanes: workstream.details.executionLanes || {}
      }
    }));
  }
  if (workspace.sessions?.length) {
    const session = workspace.sessions[0];
    actItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `act-session-${session.id}`,
      kind: "session",
      status: "clear",
      summary: "Recent Codex Session metadata is available.",
      sourceRefs: [`session:${session.id}`],
      freshness: "current",
      updatedAt: session.updatedAt || session.createdAt,
      details: { id: session.id, title: session.title, updatedAt: session.updatedAt }
    }));
  }

  const reviewFreshness = releaseReviewState;
  const verifyItems = [];
  if (quickValidation) {
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `verify-quick-${quickValidation.id}`,
      kind: "quick-validation",
      status: quickValidation.status === "pass" ? "clear" : quickValidation.status === "fail" ? "blocked" : "attention",
      summary: `Quick validation status: ${quickValidation.status}.`,
      sourceRefs: [quickValidation.relativePath, ...quickValidation.sourceRefs],
      freshness: "current",
      updatedAt: quickValidation.updatedAt,
      details: { status: quickValidation.status, checks: quickValidation.details.checks || [] }
    }));
  }
  if (review) {
    const reviewStatus = reviewFreshness.status || (review.details.workflowCoverage === "full" ? "unknown" : review.details.workflowCoverage || review.status);
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `verify-review-${review.id}`,
      kind: "review",
      status: reviewStatus === "current" ? "clear" : ["needed", "partial", "unavailable"].includes(reviewStatus) ? "attention" : "unknown",
      summary: `Review status: ${reviewStatus}.`,
      sourceRefs: unique([review.relativePath, reviewFreshness.objectRef, reviewFreshness.reviewArtifact, ...review.sourceRefs]),
      freshness: reviewFreshness.freshness || (reviewStatus === "current" ? "current" : "unknown"),
      updatedAt: reviewFreshness.sourceUpdatedAt || review.updatedAt,
      details: { status: reviewStatus, workflowCoverage: review.details.workflowCoverage || review.details.coverage || "" }
    }));
  } else if (["needed", "partial", "unavailable"].includes(reviewFreshness.status)) {
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: "verify-review-missing",
      kind: "review",
      status: "attention",
      summary: `Review status: ${reviewFreshness.status}.`,
      sourceRefs: unique([reviewFreshness.objectRef, reviewFreshness.reviewArtifact, ...(reviewFreshness.sourceRefs || [])]),
      freshness: reviewFreshness.freshness || "unknown",
      updatedAt: reviewFreshness.sourceUpdatedAt,
      details: { status: reviewFreshness.status }
    }));
  }
  for (const openReview of openAnalysisReviews.filter((item) => ["needed", "partial", "unavailable"].includes(item.status))) {
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `verify-analysis-review-${openReview.analysisArtifact || openReview.subjectRef || "unknown"}`,
      kind: "analysis-review",
      status: "attention",
      summary: `Analysis Review status: ${openReview.status}.`,
      sourceRefs: unique([openReview.analysisArtifact, openReview.reviewArtifact]),
      freshness: openReview.status === "needed" && openReview.sourceChanged ? "stale" : "unknown",
      details: boundedValue(openReview)
    }));
  }
  if (acceptance) {
    const overall = acceptance.status;
    const acceptanceStatus = deliveryBlockingAcceptance.length || acceptanceInfo.notMet.length || overall === "not_ready" ? "blocked"
      : acceptanceInfo.pendingCodex.length || acceptanceInfo.pendingPm.length || ["in_progress", "code_complete", "pending_acceptance"].includes(overall) ? "attention"
        : acceptanceFreshness.status === "current" && ["accepted", "release_ready"].includes(overall) ? "clear" : "unknown";
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: `verify-acceptance-${acceptance.id}`,
      kind: "acceptance",
      status: acceptanceStatus,
      summary: `Acceptance status: ${overall}; pending Codex ${acceptanceInfo.pendingCodex.length}; pending PM ${acceptanceInfo.pendingPm.length}.`,
      sourceRefs: unique([acceptance.relativePath, acceptanceFreshness.artifactPath, ...(acceptanceFreshness.sourceRefs || []), ...acceptance.sourceRefs]),
      freshness: acceptanceFreshness.freshness || (acceptanceFreshness.status === "stale" ? "stale" : "unknown"),
      updatedAt: acceptanceFreshness.sourceUpdatedAt || acceptance.updatedAt,
      details: {
        status: overall,
        pendingCodex: acceptanceInfo.pendingCodex.length,
        pendingPm: acceptanceInfo.pendingPm.length,
        blocked: acceptanceInfo.blocked.length,
        notMet: acceptanceInfo.notMet.length,
        partial: acceptanceInfo.partial.length
      }
    }));
  } else if (acceptanceFreshness.relationStatus === "unmatched") {
    verifyItems.push(laneItem(workspace, runtimeHealth, derivedAt, {
      id: "verify-acceptance-unmatched",
      kind: "acceptance",
      status: "unknown",
      summary: "No acceptance artifact matches the active workstream or release.",
      sourceRefs: unique([acceptanceFreshness.activeWorkstream, ...(acceptanceFreshness.sourceRefs || [])]),
      freshness: "unknown",
      updatedAt: acceptanceFreshness.sourceUpdatedAt,
      details: { status: "unknown", relationStatus: "unmatched" }
    }));
  }

  const organizeItems = knowledge ? [laneItem(workspace, runtimeHealth, derivedAt, {
    id: `organize-knowledge-${knowledge.id}`,
    kind: "knowledge",
    status: "clear",
    summary: "Relevant workspace knowledge is available.",
    sourceRefs: [knowledge.relativePath, ...knowledge.sourceRefs],
    freshness: "current",
    updatedAt: knowledge.updatedAt,
    details: { kind: knowledge.kind, applicability: knowledge.details.applicability || [] }
  })] : [];

  const runtimeSourceRefs = runtimeRefs(runtime);
  const terminalTelemetryStatus = runtime?.terminalTelemetryStatus || runtime?.terminalTelemetry?.status || runtime?.runtimeProbe?.terminalTelemetry?.status || "unknown";
  const runtimeLaneStatus = ["missing", "error"].includes(runtimeHealth) ? "blocked"
    : ["degraded", "configured_unverified"].includes(runtimeHealth) ? "attention"
      : runtimeHealth === "core_verified" ? (terminalTelemetryStatus === "failed" ? "attention" : "clear")
        : runtimeHealth === "healthy" ? "clear" : "unknown";
  const runtimeItems = [laneItem(workspace, runtimeHealth, derivedAt, {
    id: "runtime-status",
    kind: "runtime",
    status: runtimeLaneStatus,
    summary: runtimeSummary(runtime),
    sourceRefs: runtimeSourceRefs,
    freshness: runtime ? "current" : "unknown",
    confidence: runtimeHealth === "healthy" ? "high" : ["configured_unverified", "core_verified"].includes(runtimeHealth) ? "medium" : "low",
    updatedAt: runtime?.checkedAt || runtime?.generatedAt,
    details: runtime ? {
      runtimeHealth,
      marketplaceStatus: runtime.marketplaceStatus || "unknown",
      pluginStatus: runtime.pluginStatus || "unknown",
      versionStatus: runtime.versionStatus || "unknown",
      hookTrustEvidence: runtime.hookTrustEvidence || "unknown",
      runtimeProbeStatus: runtime.runtimeProbeStatus || "unknown",
      coreRuntimeStatus: runtime.coreRuntimeStatus || runtime.runtimeProbe?.coreRuntimeStatus || "unknown",
      terminalTelemetryStatus,
      terminalTelemetry: runtime.terminalTelemetry || runtime.runtimeProbe?.terminalTelemetry || null,
      manifestStatus: runtime.manifestStatus || "unknown",
      configStatus: runtime.configStatus || "unknown"
    } : {}
  })];

  const lanes = {
    Reason: lane("Reason", reasonItems, "unknown", "No reliable Reason evidence is available.", derivedAt),
    Act: lane("Act", actItems, workspace.lifecycle === "archived" ? "not_applicable" : "unknown", "No active workstream or Session metadata is available.", derivedAt),
    Verify: lane("Verify", verifyItems, "unknown", "No verification evidence is available.", derivedAt),
    Organize: lane("Organize", organizeItems, "not_applicable", "", derivedAt),
    Runtime: lane("Runtime", runtimeItems, "unknown", "Runtime status is unknown.", derivedAt)
  };

  const latestSessionAt = workspace.sessions?.reduce((latestTime, session) => Math.max(latestTime, parseTime(session.updatedAt || session.createdAt)), 0) || 0;
  const latestArtifactAt = (workspace.artifacts || []).reduce((latestTime, artifact) => Math.max(latestTime, artifactTime(artifact)), 0);
  const lastActivityAt = iso(Math.max(latestSessionAt, latestArtifactAt));
  const activityExpired = Boolean(lastActivityAt) && now - parseTime(lastActivityAt) > staleAfterDays * 86400000;
  const unfinished = workstream?.status === "active" || blockers.length > 0 || acceptanceInfo.blocked.length > 0
    || ["in_progress", "code_complete", "pending_acceptance", "not_ready"].includes(acceptance?.status)
    || acceptanceInfo.pendingCodex.length > 0 || acceptanceInfo.pendingPm.length > 0;
  const activityStatus = !lastActivityAt ? "unknown"
    : activityExpired && workspace.lifecycle === "active" && unfinished ? "stale"
      : activityExpired ? "dormant" : "active";
  const deliveryBlockingBlockers = blockers.filter(blocksIndependentDelivery);
  let deliveryStatus = workspace.dataStatus === "no_ravo_data" ? "no_data"
    : deliveryBlockingBlockers.length || deliveryBlockingAcceptance.length ? "blocked"
      : acceptance?.status === "release_ready" ? "accepted"
        : ["in_progress", "code_complete", "pending_acceptance", "accepted", "not_ready"].includes(acceptance?.status) ? acceptance.status
          : workstream?.status === "active" ? "in_progress"
            : ["ready_for_acceptance", "closed", "complete"].includes(workstream?.status) ? "code_complete" : "no_data";
  if (deliveryStatus === "accepted" && acceptanceFreshness.status === "stale") deliveryStatus = "pending_acceptance";
  const states = {
    data: stateRecord(workspace, runtimeHealth, derivedAt, workspace.dataStatus, `Data status: ${workspace.dataStatus}.`, workspace.manifest?.path ? [workspace.manifest.path] : [], workspace.dataStatus === "complete" ? "current" : "unknown"),
    lifecycle: stateRecord(workspace, runtimeHealth, derivedAt, workspace.lifecycle, `Lifecycle: ${workspace.lifecycle}.`, [`workspace:${workspace.workspaceId}`], "current"),
    activity: stateRecord(workspace, runtimeHealth, derivedAt, activityStatus, lastActivityAt ? `Last activity: ${lastActivityAt}.` : "No reliable activity timestamp.", unique([...(workspace.timeline?.slice(0, 1).map((item) => item.relativePath) || []), ...(workspace.sessions?.slice(0, 1).map((item) => `session:${item.id}`) || [])]), activityStatus === "stale" ? "stale" : lastActivityAt ? "current" : "unknown", lastActivityAt),
    delivery: stateRecord(workspace, runtimeHealth, derivedAt, deliveryStatus, `Delivery status: ${deliveryStatus}.`, unique([workstream?.relativePath, acceptance?.relativePath]), acceptanceFreshness.status === "stale" ? "stale" : "current", acceptanceFreshness.sourceUpdatedAt || acceptance?.updatedAt || workstream?.updatedAt),
    workstream: stateRecord(
      workspace,
      runtimeHealth,
      derivedAt,
      deliveryBlockingBlockers.length ? "blocked" : workstream?.status || "unknown",
      deliveryBlockingBlockers.length
        ? `${deliveryBlockingBlockers.length} delivery-blocking blocker(s).`
        : blockers.length ? `${blockers.length} parked/external blocker(s); independent work may continue.`
          : workstream ? `Workstream ${workstream.status}.` : "No workstream artifact.",
      workstream ? [workstream.relativePath] : [],
      workstreamStale ? "stale" : workstream ? "current" : "unknown",
      workstream?.updatedAt
    ),
    spec: stateRecord(workspace, runtimeHealth, derivedAt, specStatus, `Spec ${specStatus}.`, specRefs, specStatus === "stale" ? "stale" : specStatus === "current" ? "current" : "unknown", specHealth.checkedAt),
    acceptance: stateRecord(workspace, runtimeHealth, derivedAt, acceptance?.status || "unknown", acceptance ? `Acceptance ${acceptance.status}.` : "No acceptance artifact.", acceptance ? [acceptance.relativePath, ...acceptance.sourceRefs] : [], acceptanceFreshness.freshness || "unknown", acceptanceFreshness.sourceUpdatedAt || acceptance?.updatedAt),
    review: stateRecord(workspace, runtimeHealth, derivedAt, reviewFreshness.status || (review ? "unknown" : "not_applicable"), review ? `Review coverage ${review.details.workflowCoverage || review.details.coverage || "unknown"}.` : "No applicable Review evidence identified.", review ? [review.relativePath, ...review.sourceRefs] : [], reviewFreshness.freshness || "unknown", reviewFreshness.sourceUpdatedAt || review?.updatedAt),
    runtime: {
      status: runtimeHealth,
      summary: runtimeSummary(runtime),
      ...metadata(runtimeSourceRefs, runtime ? "current" : "unknown", runtimeHealth === "healthy" ? "high" : ["configured_unverified", "core_verified"].includes(runtimeHealth) ? "medium" : "low", derivedAt, runtime?.checkedAt || runtime?.generatedAt),
      deliveryPreflight: runtimeDeliveryArtifact ? { status: runtimeDeliveryArtifact.status, relativePath: runtimeDeliveryArtifact.relativePath, details: runtimeDeliveryArtifact.details } : null
    }
  };

  const attentionItems = [];
  if ((workspace.pool?.requirements?.needsTriage || 0) > 0) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Reason", category: "pool_triage", sortGroup: 4, severity: "medium",
      title: "需求池存在待确认项",
      reason: `${workspace.pool.requirements.needsTriage} 项由 Codex 推断或尚未确认，不会自动进入版本承诺。`,
      sourceRefs: ["knowledge/.ravo/pool/index.json"], freshness: "current", blocking: false,
      suggestedAction: "打开需求与问题并筛选待梳理状态，只确认会影响后续产品方向的候选。",
      expectedOutcome: "待确认项获得明确处置，同时不阻塞当前已锁定范围。"
    }));
  }
  if (workspace.dataStatus === "error" || workspace.dataStatus === "partial") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Runtime", category: "data", sortGroup: 1, severity: workspace.dataStatus === "error" ? "critical" : "high",
      title: "RAVO data integrity needs repair", reason: `Workspace data status is ${workspace.dataStatus}.`,
      sourceRefs: workspace.manifest?.path ? [workspace.manifest.path] : [], freshness: "unknown", blocking: workspace.dataStatus === "error",
      suggestedAction: "Repair the manifest or damaged artifact source, then refresh the index.", expectedOutcome: "The workspace returns to complete, traceable data."
    }));
  }
  if (!["healthy", "core_verified"].includes(runtimeHealth)) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Runtime", category: "runtime", sortGroup: 1,
      severity: ["missing", "error"].includes(runtimeHealth) ? "critical" : ["degraded", "unknown"].includes(runtimeHealth) ? "high" : "medium",
      title: "RAVO Runtime is not verified healthy", reason: runtime ? `Runtime health is ${runtimeHealth}.` : "Runtime status was not injected for this refresh.",
      sourceRefs: runtimeSourceRefs, freshness: runtime ? "current" : "unknown", blocking: ["missing", "error"].includes(runtimeHealth),
      suggestedAction: "Refresh cached Codex Runtime evidence and run the required fresh-session probe.", expectedOutcome: "Subsequent governance conclusions use current Runtime evidence."
    }));
  }
  if (runtimeHealth === "core_verified" && terminalTelemetryStatus === "failed") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Runtime", category: "runtime_terminal", sortGroup: 2, severity: "medium",
      title: "Terminal telemetry needs diagnosis", reason: runtimeSummary(runtime),
      sourceRefs: runtimeSourceRefs, freshness: runtime ? "current" : "unknown", blocking: false,
      suggestedAction: "查看任务结束时的诊断记录；无需通过重复任务或重启来收集相同证据。",
      expectedOutcome: "保留终态异常的真实诊断，同时不阻塞当前产品版本收口。"
    }));
  }
  if (["missing", "error", "stale", "draft"].includes(specStatus)) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Reason", category: "spec", sortGroup: 1, severity: specStatus === "error" ? "critical" : "high",
      title: "Spec requires maintenance", reason: `Spec status is ${specStatus}.`, sourceRefs: specRefs,
      freshness: specStatus === "stale" ? "stale" : "unknown", blocking: ["missing", "error"].includes(specStatus),
      suggestedAction: "Update the decision-complete Spec before continuing implementation.", expectedOutcome: "Scope and completion evidence become current and executable."
    }));
  }
  if (analysis && analysisNeedsAttention) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Reason", category: "analysis", sortGroup: 3, severity: "medium", title: "Analysis still has unresolved work",
      reason: "The latest analysis is draft or contains open questions or blind spots.", sourceRefs: [analysis.relativePath, ...analysis.sourceRefs],
      freshness: "current", blocking: false, suggestedAction: "Resolve the open analysis items before treating the requirement as decision-complete.",
      expectedOutcome: "Reason evidence becomes explicit enough to support implementation and verification."
    }));
  }
  for (const blocker of blockers) {
    const deliveryBlocking = blocksIndependentDelivery(blocker);
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Act", category: "blocker", sortGroup: 0, severity: deliveryBlocking ? "critical" : "high",
      title: blocker.title,
      reason: deliveryBlocking
        ? "The active workstream records a delivery-blocking item."
        : "An external blocker is parked; it remains required while independent work continues.",
      sourceRefs: workstream ? [workstream.relativePath] : [],
      freshness: workstreamStale ? "stale" : "current", blocking: deliveryBlocking,
      suggestedAction: blocker.nextStep || blocker.recoveryEntry || "Use the recorded recovery entry before continuing development.",
      expectedOutcome: deliveryBlocking ? "The workstream can resume with an explicit recovery path." : "The external decision remains visible without stopping independent work."
    }));
  }
  if (acceptanceFreshness.status === "stale") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "acceptance_stale", sortGroup: 1, severity: "high", title: "Acceptance evidence is stale",
      reason: "A linked source changed after the latest acceptance artifact.", sourceRefs: unique([acceptance?.relativePath, ...(acceptanceFreshness.sourceRefs || [])]),
      freshness: "stale", blocking: true, suggestedAction: "Regenerate or supplement acceptance evidence against the current sources.", expectedOutcome: "Acceptance status no longer relies on outdated evidence."
    }));
  }
  if (acceptanceFreshness.relationStatus === "unmatched") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "acceptance_unmatched", sortGroup: 4, severity: "medium", title: "No acceptance evidence matches the active workstream",
      reason: "Newer acceptance files exist, but none is explicitly bound to the active workstream, Spec, or release.",
      sourceRefs: unique([acceptanceFreshness.activeWorkstream, ...(acceptanceFreshness.sourceRefs || [])]),
      freshness: "unknown", blocking: false,
      suggestedAction: "Keep delivery status on the active workstream and create a bound acceptance package when implementation evidence is ready.",
      expectedOutcome: "Acceptance status can no longer be borrowed from an unrelated task."
    }));
  }
  if (quickValidation?.status === "fail") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "quick_validation", sortGroup: 2, severity: "high", title: "Quick validation failed",
      reason: "The latest quick-validation artifact reports failure.", sourceRefs: [quickValidation.relativePath, ...quickValidation.sourceRefs],
      freshness: "current", blocking: true, suggestedAction: "Fix the failed checks and write new evidence before continuing acceptance.",
      expectedOutcome: "The representative validation path returns to pass."
    }));
  }
  if (deliveryBlockingAcceptance.length) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "acceptance_blocked", sortGroup: 0, severity: "critical", title: "Acceptance verification is blocked",
      reason: `${deliveryBlockingAcceptance.length} acceptance item(s) record a delivery-blocking verification gap.`, sourceRefs: acceptance ? [acceptance.relativePath] : [],
      freshness: acceptanceFreshness.freshness || "unknown", blocking: true,
      suggestedAction: deliveryBlockingAcceptance[0]?.recoveryEntry || "Use the recorded recovery entry, then rerun the blocked verification task.",
      expectedOutcome: "Blocked acceptance items regain an executable verification path."
    }));
  }
  if (acceptance?.status === "not_ready" || acceptanceInfo.notMet.length) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "not_ready", sortGroup: 2, severity: "high", title: "Acceptance has unmet required outcomes",
      reason: `Acceptance status is ${acceptance.status}; not met items: ${acceptanceInfo.notMet.length}.`, sourceRefs: [acceptance.relativePath],
      freshness: acceptanceFreshness.freshness || "unknown", blocking: true, suggestedAction: "Resolve the unmet implementation or evidence items before requesting acceptance.", expectedOutcome: "Required outcomes and evidence are both satisfiable."
    }));
  }
  if (acceptanceInfo.pendingCodex.length) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "pending_codex", sortGroup: 2, severity: "high", title: "Codex evidence is still required",
      reason: `${acceptanceInfo.pendingCodex.length} acceptance item(s) require Codex verification.`, sourceRefs: [acceptance.relativePath],
      freshness: acceptanceFreshness.freshness || "unknown", blocking: true, suggestedAction: "Run the listed real E2E or evidence tasks and attach their artifacts.", expectedOutcome: "Codex-owned verification items become verified."
    }));
  }
  if (acceptanceInfo.pendingPm.length || (acceptance?.status === "pending_acceptance" && acceptanceInfo.pendingCodex.length === 0)) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "pending_pm", sortGroup: 3, severity: "medium", title: "PM acceptance is pending",
      reason: `${acceptanceInfo.pendingPm.length || 1} acceptance item(s) require product judgment.`, sourceRefs: [acceptance.relativePath, acceptance.details.pmChecklistRef].filter(Boolean),
      freshness: acceptanceFreshness.freshness || "unknown", blocking: false, suggestedAction: "Open the PM acceptance checklist and record the product judgment.", expectedOutcome: "PM-owned acceptance items receive explicit evidence-backed decisions."
    }));
  }
  if (["needed", "partial", "unavailable"].includes(reviewFreshness.status)) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "review", sortGroup: 3, severity: "medium", title: "RAVO Review coverage is incomplete",
      reason: `Review status is ${reviewFreshness.status}.`, sourceRefs: unique([reviewFreshness.objectRef, reviewFreshness.reviewArtifact, ...(reviewFreshness.sourceRefs || [])]),
      freshness: reviewFreshness.freshness || "unknown", blocking: false, suggestedAction: "Run or recover RAVO Review for the referenced high-impact object.", expectedOutcome: "The high-impact decision has current usable adversarial coverage."
    }));
  }
  for (const openReview of openAnalysisReviews.filter((item) => ["needed", "partial", "unavailable"].includes(item.status))) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Verify", category: "analysis_review", sortGroup: 3, severity: "medium", title: "A high-impact analysis needs Review attention",
      reason: `Analysis Review status is ${openReview.status}.`, sourceRefs: unique([openReview.analysisArtifact, openReview.reviewArtifact]),
      freshness: openReview.status === "needed" && openReview.sourceChanged ? "stale" : "unknown", blocking: false,
      suggestedAction: "Open the referenced analysis and run or recover its independent RAVO Review.", expectedOutcome: "The analysis has current usable adversarial coverage without changing release Review status."
    }));
  }
  if (workstreamStale) {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Act", category: "stale_workstream", sortGroup: 3, severity: "low", title: "Active workstream is stale",
      reason: `No workstream update within ${staleAfterDays} days.`, sourceRefs: [workstream.relativePath], freshness: "stale", blocking: false,
      suggestedAction: "Generate a continuation brief from the current milestone, blockers, evidence gaps, and next step.", expectedOutcome: "The workspace resumes from an explicit current handoff."
    }));
  }
  if (workspace.dataStatus === "no_ravo_data") {
    attentionItems.push(attentionItem(workspace, runtimeHealth, derivedAt, {
      lane: "Reason", category: "data", sortGroup: 5, severity: "low", title: "Workspace has no RAVO manifest",
      reason: "No manifest-backed RAVO data is available.", sourceRefs: [], freshness: "unknown", blocking: false,
      suggestedAction: "Review an initialization Prompt before creating RAVO workspace artifacts.", expectedOutcome: "The workspace gains an explicit, reviewable RAVO starting point."
    }));
  }

  const filteredAttention = (workspace.lifecycle === "archived" ? [] : workspace.lifecycle === "paused"
    ? attentionItems.filter((item) => item.severity === "critical" || ["runtime", "data"].includes(item.category))
    : attentionItems).sort((left, right) =>
    (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
    || (left.sortGroup ?? 9) - (right.sortGroup ?? 9)
    || (FRESHNESS_RANK[left.freshness] ?? 9) - (FRESHNESS_RANK[right.freshness] ?? 9)
    || compareText(left.id, right.id));
  let suggestions = [];
  const runtimeAttention = filteredAttention.find((item) => item.category === "runtime");
  const dataAttention = filteredAttention.find((item) => item.category === "data");
  if (runtimeAttention || dataAttention) {
    const repairAttention = [runtimeAttention, dataAttention].filter(Boolean).sort((left, right) =>
      (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9) || compareText(left.id, right.id))[0];
    suggestions = [repairAttention].map((item) => suggestion(workspace, runtimeHealth, derivedAt, {
      action: item.suggestedAction, reason: item.reason, expectedOutcome: item.expectedOutcome, blocking: item.blocking,
      sourceRefs: item.sourceRefs, freshness: item.freshness, confidence: item.confidence, sourceUpdatedAt: item.sourceUpdatedAt
    }));
  } else if (workspace.lifecycle === "active" && filteredAttention.length) {
    const item = filteredAttention[0];
    suggestions = [suggestion(workspace, runtimeHealth, derivedAt, {
      action: item.suggestedAction, reason: item.reason, expectedOutcome: item.expectedOutcome, blocking: item.blocking,
      sourceRefs: item.sourceRefs, freshness: item.freshness, confidence: item.confidence, sourceUpdatedAt: item.sourceUpdatedAt
    })];
  } else if (workspace.lifecycle === "active" && workstream?.details?.nextStep) {
    suggestions = [suggestion(workspace, runtimeHealth, derivedAt, {
      action: workstream.details.nextStep, reason: "The active workstream records an explicit next step.",
      expectedOutcome: "Work continues from the latest Roadmap Audit context.", blocking: false,
      sourceRefs: [workstream.relativePath], freshness: workstreamStale ? "stale" : "current"
    })];
  }

  const summaryRefs = unique([analysis?.relativePath, workstream?.relativePath, acceptance?.relativePath, runtimeSourceRefs[0], workspace.sessions?.[0] ? `session:${workspace.sessions[0].id}` : ""]);
  const summary = {
    headline: pmBrief.headline,
    currentMilestone: workstream?.details?.currentMilestone || "",
    nextStep: pmBrief.nextStep,
    lastActivityAt,
    artifactCount: workspace.artifacts?.length || 0,
    sessionCount: workspace.sessions?.length || 0,
    dataStatus: workspace.dataStatus,
    runtimeHealth,
    specHealth: specStatus,
    acceptanceStatus: acceptance?.status || "unknown",
    ...metadata(summaryRefs, states.activity.freshness, confidenceFor(workspace, states.activity.freshness, runtimeHealth), derivedAt, lastActivityAt)
  };
  const details = {
    manifest: workspace.manifest || {},
    latestArtifacts: Object.fromEntries(Object.entries(latest).map(([key, artifact]) => [key, artifact ? {
      id: artifact.id, status: artifact.status, relativePath: artifact.relativePath, updatedAt: artifact.updatedAt
    } : null])),
    blockers,
    executionLanes: workstream?.details?.executionLanes || {},
    executionDecisions: workstream?.details?.executionDecisions || [],
    authorizationEnvelopes: workstream?.details?.authorizationEnvelopes || [],
    effectiveDeliveryProfile: workstream?.details?.effectiveDeliveryProfile || {},
    executionTiming: workstream?.details?.timing || {},
    capabilityRoutes: workstream?.details?.capabilityRoutes || [],
    verification: {
      pendingCodex: acceptanceInfo.pendingCodex.length,
      pendingPm: acceptanceInfo.pendingPm.length,
      blocked: acceptanceInfo.blocked.length,
      notMet: acceptanceInfo.notMet.length,
      partial: acceptanceInfo.partial.length
    },
    warnings: workspace.warnings || [],
    ...metadata(summaryRefs, workspace.dataStatus === "complete" ? "current" : "unknown", confidenceFor(workspace, workspace.dataStatus === "complete" ? "current" : "unknown", runtimeHealth), derivedAt, lastActivityAt)
  };
  const applicableLanes = Object.values(lanes).filter((item) => item.status !== "not_applicable");
  const workspaceFreshness = applicableLanes.some((item) => item.freshness === "stale") ? "stale"
    : applicableLanes.some((item) => item.freshness === "unknown") ? "unknown" : "current";
  const workspaceConfidence = applicableLanes.some((item) => item.confidence === "low") ? "low"
    : applicableLanes.some((item) => item.confidence === "medium") ? "medium" : "high";
  const sourceRefs = unique(applicableLanes.flatMap((item) => item.sourceRefs));
  const sourceUpdatedAt = applicableLanes.reduce((latestTime, item) => Math.max(latestTime, parseTime(item.sourceUpdatedAt)), 0);
  const dataGaps = [
    workspace.dataStatus !== "complete" ? `data:${workspace.dataStatus}` : "",
    !["healthy", "core_verified"].includes(runtimeHealth) ? `runtime:${runtimeHealth}` : "",
    specStatus !== "current" ? `spec:${specStatus}` : "",
    acceptanceFreshness.status === "stale" ? "acceptance:stale" : "",
    acceptanceFreshness.relationStatus === "unmatched" ? "acceptance:unmatched" : ""
  ].filter(Boolean);
  return {
    ...workspace,
    activityStatus,
    deliveryStatus,
    reviewStatus: states.review.status,
    freshness: workspaceFreshness,
    confidence: workspaceConfidence,
    sourceRefs,
    derivedAt,
    sourceUpdatedAt: iso(sourceUpdatedAt),
    pmBrief,
    currentGoal: workstream?.details?.goal || analysis?.details?.goal || "",
    specPath: specHealth.specPath || workstream?.details?.specRef || acceptance?.details?.specRef || "",
    activeMilestone: workstream?.details?.currentMilestone || "",
    roadmapAudit: workstream?.details?.roadmapAudit || [],
    openDecisions: analysis?.details?.openQuestions || [],
    blockers,
    executionLanes: workstream?.details?.executionLanes || {},
    executionDecisions: workstream?.details?.executionDecisions || [],
    authorizationEnvelopes: workstream?.details?.authorizationEnvelopes || [],
    effectiveDeliveryProfile: workstream?.details?.effectiveDeliveryProfile || {},
    executionTiming: workstream?.details?.timing || {},
    capabilityRoutes: workstream?.details?.capabilityRoutes || [],
    pendingCodexVerification: acceptanceInfo.pendingCodex,
    pendingPmVerification: acceptanceInfo.pendingPm,
    authoritativeWorkstream: workstream ? { ...workstream, selectionReason: authoritativeSelection.selectionReason || "", relationStatus: authoritativeSelection.relationStatus || "matched", lineageKey: authoritativeSelection.lineageKey || "", supersededArtifacts: authoritativeSelection.supersededArtifacts || [] } : authoritativeSelection,
    selectedAcceptance: acceptance ? { ...acceptance, selectionReason: acceptanceFreshness.selectionReason || freshness.selectedAcceptance?.selectionReason || "", relationStatus: acceptanceFreshness.relationStatus || freshness.selectedAcceptance?.relationStatus || "matched" } : null,
    releaseReview: review ? { ...review, selectionReason: releaseReviewState.selectionReason || "", relationStatus: releaseReviewState.relationStatus || "matched", reviewStatus: releaseReviewState.status || "unknown" } : releaseReviewState,
    openAnalysisReviews,
    relevantKnowledge: knowledge ? [{ id: knowledge.id, title: knowledge.title, summary: knowledge.summary, sourceRef: knowledge.relativePath }] : [],
    dataGaps,
    runtime: runtime ? { ...runtimeItems[0].details, fingerprint: runtime.fingerprint || "", checkedAt: runtime.checkedAt || runtime.generatedAt || "" } : { runtimeHealth: "unknown" },
    gitBaseline: gitBaselineArtifact ? { status: gitBaselineArtifact.status, relativePath: gitBaselineArtifact.relativePath, details: gitBaselineArtifact.details } : null,
    runtimeDelivery: runtimeDeliveryArtifact ? { status: runtimeDeliveryArtifact.status, relativePath: runtimeDeliveryArtifact.relativePath, details: runtimeDeliveryArtifact.details } : null,
    freshnessState: boundedValue(freshness),
    summary,
    details,
    lanes,
    states,
    attentionItems: filteredAttention,
    primaryAttention: null,
    suggestions
  };
}

function buildAttentionQueue(workspaces) {
  const workspaceLookup = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  return workspaces.flatMap((workspace) => workspace.attentionItems || []).sort((left, right) => {
    const leftWorkspace = workspaceLookup.get(left.workspaceId) || {};
    const rightWorkspace = workspaceLookup.get(right.workspaceId) || {};
    return (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
      || (left.sortGroup ?? 9) - (right.sortGroup ?? 9)
      || (PRIORITY_RANK[leftWorkspace.priority] ?? 9) - (PRIORITY_RANK[rightWorkspace.priority] ?? 9)
      || (FRESHNESS_RANK[left.freshness] ?? 9) - (FRESHNESS_RANK[right.freshness] ?? 9)
      || compareText(leftWorkspace.displayName, rightWorkspace.displayName)
      || compareText(left.id, right.id);
  });
}

function metric(id, value, refs, options) {
  const allRefs = unique(refs);
  const visibleRefs = allRefs.slice(0, 100);
  return {
    id,
    value,
    ...(options.windowDays ? { windowDays: options.windowDays } : {}),
    ...(options.signals ? { signals: options.signals } : {}),
    ...metadata(visibleRefs, options.freshness || "current", options.confidence || "medium", options.derivedAt, options.sourceUpdatedAt),
    sourceRefCount: allRefs.length,
    sourceRefsTruncated: allRefs.length > visibleRefs.length
  };
}

function stableObjectRef(artifact) {
  return artifact?.relatedArtifact || artifact?.subjectRef || artifact?.releaseRef || artifact?.details?.relatedArtifact || artifact?.details?.subjectRef || artifact?.details?.releaseRef || "";
}

function repeatedAnalysisSignals(workspaces, derivedAt, windowStart) {
  const signals = [];
  for (const workspace of workspaces.filter((item) => item.lifecycle === "active")) {
    const groups = new Map();
    for (const artifact of workspace.artifacts.filter((item) => item.module === "analysis" && artifactTime(item) >= windowStart)) {
      const ref = stableObjectRef(artifact);
      if (!ref) continue;
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(artifact);
    }
    for (const [objectRef, artifacts] of groups) {
      if (artifacts.length < 2) continue;
      signals.push({
        workspaceId: workspace.workspaceId,
        objectRef,
        count: artifacts.length,
        ...metadata(artifacts.map((item) => item.relativePath), "current", "medium", derivedAt, Math.max(...artifacts.map(artifactTime)))
      });
    }
  }
  return signals;
}

function repeatedAcceptanceSignals(workspaces, derivedAt, windowStart) {
  const signals = [];
  for (const workspace of workspaces.filter((item) => item.lifecycle === "active")) {
    const groups = new Map();
    for (const artifact of workspace.artifacts.filter((item) => item.module === "acceptance" && artifactTime(item) >= windowStart)) {
      const ref = stableObjectRef(artifact) || artifact.details.specRef;
      if (!ref) continue;
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(artifact);
    }
    for (const [objectRef, artifacts] of groups) {
      artifacts.sort((left, right) => artifactTime(right) - artifactTime(left));
      const failures = [];
      for (const artifact of artifacts) {
        if (!["not_ready", "pending_acceptance"].includes(artifact.status)) break;
        failures.push(artifact);
      }
      if (failures.length < 2) continue;
      signals.push({
        workspaceId: workspace.workspaceId,
        objectRef,
        count: failures.length,
        ...metadata(failures.map((item) => item.relativePath), "current", "medium", derivedAt, Math.max(...failures.map(artifactTime)))
      });
    }
  }
  return signals;
}

function buildMetrics(workspaces, sessions = [], attention = [], options = {}) {
  const derivedAt = iso(options.derivedAt) || iso(nowMs(options));
  const now = parseTime(derivedAt) || Date.now();
  const active = workspaces.filter((workspace) => workspace.lifecycle === "active");
  const recentSessions = sessions.filter((session) => sessionWorkspace(workspaces, session.cwd)?.lifecycle === "active"
    && now - parseTime(session.updatedAt || session.createdAt) <= 7 * 86400000);
  const recentArtifacts = active.flatMap((workspace) => workspace.artifacts).filter((artifact) => now - artifactTime(artifact) <= 7 * 86400000);
  const recentAnalysis = active.flatMap((workspace) => workspace.artifacts).filter((artifact) => artifact.module === "analysis" && artifactTime(artifact) >= now - 30 * 86400000);
  const acceptanceItems = active.flatMap((workspace) => workspace.selectedAcceptance?.details?.acceptanceItems || []);
  const acceptanceRefs = active.flatMap((workspace) => workspace.selectedAcceptance ? [workspace.selectedAcceptance.relativePath] : []);
  const blockers = active.flatMap((workspace) => normalizedBlockers(workspace.authoritativeWorkstream || workspace.latestArtifacts.workstream));
  const acceptanceBlockers = acceptanceItems.filter((item) => item.verificationStatus === "blocked");
  const windowStart = now - 30 * 86400000;
  const repeatedAnalysis = repeatedAnalysisSignals(active, derivedAt, windowStart);
  const repeatedAcceptance = repeatedAcceptanceSignals(active, derivedAt, windowStart);
  const activeRefs = active.map((workspace) => `workspace:${workspace.workspaceId}`);
  const runtimeStates = active.map((workspace) => workspace.states.runtime.status);
  const confidence = active.some((workspace) => workspace.dataStatus !== "complete" || !["healthy", "core_verified"].includes(workspace.states.runtime.status)) ? "low"
    : runtimeStates.includes("core_verified") ? "medium" : "high";
  const metricOptions = { derivedAt, confidence, freshness: confidence === "low" ? "unknown" : "current" };
  const laneAttention = {};
  for (const laneName of ["Reason", "Act", "Verify", "Organize"]) {
    const items = attention.filter((item) => item.lane === laneName);
    laneAttention[laneName] = metric(`laneAttention.${laneName}`, items.length, items.flatMap((item) => item.sourceRefs), metricOptions);
  }
  const daysSinceLastActivity = {};
  for (const workspace of active) {
    const last = parseTime(workspace.summary.lastActivityAt);
    daysSinceLastActivity[workspace.workspaceId] = metric(
      `daysSinceLastActivity.${workspace.workspaceId}`,
      last ? Math.floor((now - last) / 86400000) : null,
      workspace.summary.sourceRefs,
      { ...metricOptions, freshness: last ? "current" : "unknown", sourceUpdatedAt: last }
    );
  }
  return {
    activeWorkspaces: metric("activeWorkspaces", active.length, activeRefs, metricOptions),
    sessionsLast7Days: metric("sessionsLast7Days", recentSessions.length, recentSessions.map((session) => `session:${session.id}`), { ...metricOptions, windowDays: 7 }),
    artifactsLast7Days: metric("artifactsLast7Days", recentArtifacts.length, recentArtifacts.map((artifact) => artifact.relativePath), { ...metricOptions, windowDays: 7 }),
    analysisArtifactsLast30Days: metric("analysisArtifactsLast30Days", recentAnalysis.length, recentAnalysis.map((artifact) => artifact.relativePath), { ...metricOptions, windowDays: 30 }),
    pendingCodexVerification: metric("pendingCodexVerification", acceptanceItems.filter((item) => item.verificationStatus === "pending_codex").length, acceptanceRefs, metricOptions),
    pendingPmAcceptance: metric("pendingPmAcceptance", acceptanceItems.filter((item) => item.verificationStatus === "pending_pm").length, acceptanceRefs, metricOptions),
    blockers: metric("blockers", blockers.length + acceptanceBlockers.length, unique([
      ...active.flatMap((workspace) => workspace.authoritativeWorkstream?.relativePath ? [workspace.authoritativeWorkstream.relativePath] : []),
      ...acceptanceRefs
    ]), metricOptions),
    staleWorkspaces: metric("staleWorkspaces", active.filter((workspace) => [workspace.states.activity.status, workspace.states.spec.status, workspace.states.acceptance.freshness].includes("stale")).length, activeRefs, metricOptions),
    runtimeDegradedOrMissing: metric("runtimeDegradedOrMissing", active.filter((workspace) => ["degraded", "missing", "error", "unknown"].includes(workspace.states.runtime.status)).length, activeRefs, metricOptions),
    staleSpecs: metric("staleSpecs", active.filter((workspace) => workspace.states.spec.status === "stale").length, activeRefs, metricOptions),
    staleAcceptances: metric("staleAcceptances", active.filter((workspace) => workspace.states.acceptance.freshness === "stale").length, activeRefs, metricOptions),
    laneAttention,
    repeatedAnalysis: metric("repeatedAnalysis", repeatedAnalysis.length, repeatedAnalysis.flatMap((signal) => signal.sourceRefs), { ...metricOptions, windowDays: 30, signals: repeatedAnalysis }),
    repeatedAcceptanceFailure: metric("repeatedAcceptanceFailure", repeatedAcceptance.length, repeatedAcceptance.flatMap((signal) => signal.sourceRefs), { ...metricOptions, windowDays: 30, signals: repeatedAcceptance }),
    daysSinceLastActivity
  };
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => compareText(left.code, right.code) || compareText(left.path, right.path));
}

function buildDashboardIndex(options = {}) {
  const generatedAt = iso(nowMs(options));
  const discovery = discoverWorkspaces(options);
  const indexed = discovery.workspaces.map((workspace) => {
    const artifacts = indexArtifacts(workspace, options);
    return {
      ...workspace,
      ...artifacts,
      pool: readPoolSummary(workspace.canonicalPath),
      ravoPresent: artifacts.manifest.status !== "missing",
      lastIndexedAt: generatedAt,
      warnings: artifacts.warnings
    };
  });
  const sessionIndex = indexSessions(indexed, options);
  const withSessions = indexed.map((workspace) => ({
    ...workspace,
    sessions: sessionIndex.sessions.filter((session) => sessionWorkspace(indexed, session.cwd)?.workspaceId === workspace.workspaceId)
  }));
  let workspaces = withSessions.map((workspace) => {
    const freshness = getInjected(options.freshnessByWorkspace, workspace) || {};
    const runtimeStatus = getInjected(options.runtimeStatusByWorkspace, workspace) || options.runtimeStatus || freshness.runtime;
    return deriveWorkspaceState(workspace, { ...options, freshness, runtimeStatus, derivedAt: generatedAt });
  });
  workspaces = sortWorkspaces(workspaces);
  const attention = buildAttentionQueue(workspaces, options);
  const primaryByWorkspace = new Map();
  for (const item of attention) if (!primaryByWorkspace.has(item.workspaceId)) primaryByWorkspace.set(item.workspaceId, item);
  workspaces = workspaces.map((workspace) => ({ ...workspace, primaryAttention: primaryByWorkspace.get(workspace.workspaceId) || null }));
  workspaces = workspaces.map((workspace) => {
    const actions = selectShortcutActions(workspace);
    return { ...workspace, shortcutActions: actions.primary, shortcutMenuActions: actions.secondary };
  });
  const metrics = buildMetrics(workspaces, sessionIndex.sessions, attention, { ...options, derivedAt: generatedAt });
  const workspaceById = Object.fromEntries(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const warnings = dedupeWarnings([
    ...discovery.warnings,
    ...workspaces.flatMap((workspace) => workspace.warnings.map((item) => ({ workspaceId: workspace.workspaceId, ...item }))),
    ...sessionIndex.warnings
  ]);
  return {
    workspaces,
    workspaceById,
    attention,
    metrics,
    sessions: sessionIndex.sessions,
    sessionDataStatus: sessionIndex.sessionDataStatus,
    warnings,
    generatedAt
  };
}

module.exports = {
  buildDashboardIndex,
  buildContinuationBrief,
  buildShortcut,
  discoverWorkspaces,
  indexArtifacts,
  indexSessions,
  deriveWorkspaceState,
  buildAttentionQueue,
  buildMetrics,
  readPoolSummary,
  blocksIndependentDelivery,
  isAllowedExternalAcceptanceBlocker,
  selectShortcutActions
};
