#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const WORK_ITEM_TYPES = new Set([
  "feature", "improvement", "bug", "hotfix", "experiment", "technical_debt", "governance", "release_ops", "environment"
]);
const KNOWLEDGE_KINDS = new Set([
  "fact", "decision", "lesson", "principle", "boundary", "terminology", "procedure", "warning"
]);
const LEGACY_KNOWLEDGE_KIND_MAP = Object.freeze({
  material: "fact",
  experience: "lesson",
  judgment: "decision",
  requirement: "fact",
  solution: "procedure",
  review: "lesson",
  acceptance: "lesson",
  retrospective: "lesson",
  evidence: "fact"
});
const KNOWLEDGE_STATUSES = new Set([
  "candidate", "needs_review", "active", "stale", "superseded", "archived", "rejected"
]);
const DECISION_STATUSES = new Set([
  "candidate", "needs_triage", "clarifying", "approved", "deferred", "rejected", "duplicate", "closed"
]);
const DELIVERY_STATUSES = new Set([
  "not_started", "in_progress", "blocked", "code_complete", "candidate_ready", "stopped"
]);
const PM_ACCEPTANCE_STATUSES = new Set(["not_requested", "pending_pm", "accepted", "rejected"]);
const RELEASE_STATUSES = new Set(["not_planned", "planned", "release_ready", "released", "rolled_back"]);
const SCOPE_CLASSES = new Set(["must_ship", "deferable", "out_of_scope", "candidate"]);
const DECISION_HISTORY_FIELDS = [
  "confirmationStatus", "decisionStatus", "decisionReason", "decisionOwner", "decisionAt", "sourceRefs",
  "candidateVersions", "committedVersion", "releaseSlice", "scopeClass", "deferredToVersion", "deferReason",
  "nextAction", "nextActionOwner"
];
const SAFE_CONCURRENT_MERGE_FIELDS = new Set([
  "sourceRefs", "tags", "references", "relatedItemIds", "followUpIds", "sessionRefs", "dependencyIds"
]);

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, file);
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decisionState(item) {
  return Object.fromEntries(DECISION_HISTORY_FIELDS.map((field) => [field, item?.[field]]));
}

function decisionChanges(before, after) {
  return Object.fromEntries(DECISION_HISTORY_FIELDS
    .filter((field) => !sameValue(before?.[field], after?.[field]))
    .map((field) => [field, { from: before?.[field], to: after?.[field] }]));
}

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function boundedText(value, max = 12000) {
  const text = stringValue(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function hashId(value, prefix = "WI") {
  return `${prefix}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

function pathsFor(workspace) {
  const root = path.join(path.resolve(workspace), "knowledge", ".ravo");
  return {
    root,
    pool: path.join(root, "pool"),
    items: path.join(root, "pool", "items"),
    events: path.join(root, "pool", "events"),
    index: path.join(root, "pool", "index.json"),
    export: path.join(root, "pool", "requirement-pool.md"),
    knowledge: path.join(root, "knowledge"),
    knowledgeIndex: path.join(root, "knowledge", "index.json")
  };
}

function ensurePoolDirectories(workspace) {
  const paths = pathsFor(workspace);
  for (const directory of [paths.pool, paths.items, paths.events]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return paths;
}

function ensureManifestModule(workspace, moduleId, artifacts, latestArtifact) {
  const paths = pathsFor(workspace);
  const manifestPath = path.join(paths.root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: "0.5.3", workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || "0.5.3";
  manifest.modules = manifest.modules || {};
  manifest.modules[moduleId] = {
    ...(manifest.modules[moduleId] || {}),
    enabled: true,
    artifacts,
    latestArtifact,
    updatedAt: nowIso()
  };
  writeJsonAtomic(manifestPath, manifest);
  return manifestPath;
}

function ensurePoolManifest(workspace) {
  return ensureManifestModule(workspace, "pool", ["knowledge/.ravo/pool"], "knowledge/.ravo/pool/index.json");
}

function safeRelative(workspace, file) {
  return path.relative(path.resolve(workspace), file).split(path.sep).join("/");
}

function safeItemFile(workspace, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(String(id || ""))) return "";
  const file = path.join(pathsFor(workspace).items, `${id}.json`);
  const root = path.resolve(pathsFor(workspace).items);
  const resolved = path.resolve(file);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : "";
}

function appendEvent(workspace, id, event) {
  const paths = ensurePoolDirectories(workspace);
  const file = path.join(paths.events, `${id}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ at: nowIso(), ...event })}\n`, { mode: 0o600 });
}

function isWorkItem(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" && typeof value.title === "string";
}

function validateWorkItem(value, stage = "capture") {
  const errors = [];
  if (!isWorkItem(value)) return ["work item must be an object with id and title"];
  if (!value.id.trim()) errors.push("id is required");
  if (!value.title.trim()) errors.push("title is required");
  if (!WORK_ITEM_TYPES.has(value.itemType)) errors.push(`itemType is invalid: ${value.itemType}`);
  if (!DECISION_STATUSES.has(value.decisionStatus)) errors.push(`decisionStatus is invalid: ${value.decisionStatus}`);
  if (!DELIVERY_STATUSES.has(value.deliveryStatus)) errors.push(`deliveryStatus is invalid: ${value.deliveryStatus}`);
  if (!PM_ACCEPTANCE_STATUSES.has(value.pmAcceptanceStatus)) errors.push(`pmAcceptanceStatus is invalid: ${value.pmAcceptanceStatus}`);
  if (!RELEASE_STATUSES.has(value.releaseStatus)) errors.push(`releaseStatus is invalid: ${value.releaseStatus}`);
  if (!Array.isArray(value.sourceRefs)) errors.push("sourceRefs must be an array");
  if (!Array.isArray(value.legacyIds)) errors.push("legacyIds must be an array");
  if (!Number.isInteger(value.revision) || value.revision < 1) errors.push("revision must be a positive integer");
  if (stage !== "capture" && !stringValue(value.targetUser)) errors.push("targetUser is required after capture");
  if (stage === "slice" && !stringValue(value.committedVersion) && !stringValue(value.releaseSlice)) errors.push("committedVersion or releaseSlice is required before Slice commitment");
  return errors;
}

function normalizeWorkItem(input, options = {}) {
  const now = options.now || nowIso();
  const legacyIds = unique([...(input.legacyIds || []), input.legacyId]);
  const itemType = WORK_ITEM_TYPES.has(input.itemType) ? input.itemType : "feature";
  const title = boundedText(input.title, 240);
  return {
    schemaVersion: "0.5.3",
    id: stringValue(input.id) || hashId(`${now}:${input.title || crypto.randomUUID()}`),
    legacyIds,
    itemType,
    subType: stringValue(input.subType),
    title,
    summary: boundedText(input.summary || title, 2000),
    description: boundedText(input.description, 12000),
    product: stringValue(input.product),
    module: stringValue(input.module),
    parentId: stringValue(input.parentId),
    tags: unique(input.tags),
    sourceType: stringValue(input.sourceType, "session_inferred"),
    sourceRefs: unique(input.sourceRefs),
    sourceExcerpt: boundedText(input.sourceExcerpt, 4000),
    requester: stringValue(input.requester),
    capturedAt: stringValue(input.capturedAt, now),
    captureMode: stringValue(input.captureMode, "inferred"),
    sourceConfidence: Number.isFinite(input.sourceConfidence) ? Math.max(0, Math.min(1, input.sourceConfidence)) : 0.5,
    confirmationStatus: stringValue(input.confirmationStatus, "needs_triage"),
    targetUser: stringValue(input.targetUser),
    background: boundedText(input.background, 4000),
    currentState: boundedText(input.currentState, 4000),
    scenario: boundedText(input.scenario, 4000),
    painPoint: boundedText(input.painPoint, 4000),
    currentWorkaround: boundedText(input.currentWorkaround, 4000),
    expectedOutcome: boundedText(input.expectedOutcome, 4000),
    hypothesis: boundedText(input.hypothesis, 4000),
    successMetrics: unique(input.successMetrics),
    references: unique(input.references),
    nonGoals: unique(input.nonGoals),
    decisionStatus: DECISION_STATUSES.has(input.decisionStatus)
      ? input.decisionStatus
      : input.confirmationStatus === "needs_triage" ? "needs_triage" : "candidate",
    decisionOwner: stringValue(input.decisionOwner),
    decisionReason: boundedText(input.decisionReason, 4000),
    decisionAt: stringValue(input.decisionAt),
    openQuestions: unique(input.openQuestions),
    assumptions: unique(input.assumptions),
    scopeBoundary: boundedText(input.scopeBoundary, 4000),
    priority: ["P0", "P1", "P2", "P3"].includes(input.priority) ? input.priority : "P2",
    urgency: stringValue(input.urgency, "normal"),
    userValue: stringValue(input.userValue),
    marketValidationValue: stringValue(input.marketValidationValue),
    riskReduction: stringValue(input.riskReduction),
    costOfDelay: boundedText(input.costOfDelay, 2000),
    priorityReason: boundedText(input.priorityReason, 2000),
    candidateVersions: unique(input.candidateVersions),
    committedVersion: stringValue(input.committedVersion),
    releaseSlice: stringValue(input.releaseSlice),
    changeLevel: stringValue(input.changeLevel),
    baseVersion: stringValue(input.baseVersion),
    versionDecisionReason: boundedText(input.versionDecisionReason, 2000),
    versionOverrideReason: boundedText(input.versionOverrideReason, 2000),
    versionDecisionOwner: stringValue(input.versionDecisionOwner),
    versionDecisionAt: stringValue(input.versionDecisionAt),
    lockedChangeLevel: stringValue(input.lockedChangeLevel),
    milestone: stringValue(input.milestone),
    scopeClass: SCOPE_CLASSES.has(input.scopeClass) ? input.scopeClass : "candidate",
    deferredToVersion: stringValue(input.deferredToVersion),
    deferReason: boundedText(input.deferReason, 2000),
    targetReleaseAt: stringValue(input.targetReleaseAt),
    actualReleaseVersion: stringValue(input.actualReleaseVersion),
    actualReleaseAt: stringValue(input.actualReleaseAt),
    estimatedAgentActiveMinutes: input.estimatedAgentActiveMinutes || { min: null, max: null },
    estimatedCalendarMinutes: input.estimatedCalendarMinutes || { min: null, max: null },
    estimatedValidationMinutes: input.estimatedValidationMinutes || { min: null, max: null },
    estimatedPmMinutes: input.estimatedPmMinutes || { min: null, max: null },
    estimatedTokens: input.estimatedTokens || { min: null, max: null },
    estimateMethod: stringValue(input.estimateMethod),
    estimateConfidence: stringValue(input.estimateConfidence, "unknown"),
    estimateAssumptions: unique(input.estimateAssumptions),
    actualAgentActiveMinutes: input.actualAgentActiveMinutes ?? null,
    actualCalendarMinutes: input.actualCalendarMinutes ?? null,
    actualValidationMinutes: input.actualValidationMinutes ?? null,
    actualReviewMinutes: input.actualReviewMinutes ?? null,
    actualEvidenceMinutes: input.actualEvidenceMinutes ?? null,
    actualBlockedMinutes: input.actualBlockedMinutes ?? null,
    actualPmMinutes: input.actualPmMinutes ?? null,
    actualTokens: input.actualTokens ?? null,
    tokenDataSource: stringValue(input.tokenDataSource, "unknown"),
    allocationMethod: stringValue(input.allocationMethod, "direct"),
    costVarianceReason: boundedText(input.costVarianceReason, 2000),
    deliveryStatus: DELIVERY_STATUSES.has(input.deliveryStatus) ? input.deliveryStatus : "not_started",
    currentStage: stringValue(input.currentStage, "capture"),
    startedAt: stringValue(input.startedAt),
    candidateReadyAt: stringValue(input.candidateReadyAt),
    completedAt: stringValue(input.completedAt),
    owner: stringValue(input.owner),
    executor: stringValue(input.executor),
    sessionRefs: unique(input.sessionRefs),
    goalRef: stringValue(input.goalRef),
    specRef: stringValue(input.specRef),
    gitBaseline: stringValue(input.gitBaseline),
    predecessorVersion: stringValue(input.predecessorVersion),
    predecessorBaselineRef: stringValue(input.predecessorBaselineRef),
    branch: stringValue(input.branch),
    dependencyIds: unique(input.dependencyIds),
    relatedItemIds: unique(input.relatedItemIds),
    nextAction: boundedText(input.nextAction, 2000),
    nextActionOwner: stringValue(input.nextActionOwner),
    nextActionAt: stringValue(input.nextActionAt),
    blockerStatus: stringValue(input.blockerStatus, "none"),
    blockerFingerprint: stringValue(input.blockerFingerprint),
    blockerType: stringValue(input.blockerType),
    blockerReason: boundedText(input.blockerReason, 4000),
    blockerOwner: stringValue(input.blockerOwner),
    blockerImpact: boundedText(input.blockerImpact, 2000),
    blockerAttemptBudget: input.blockerAttemptBudget || { max: 2, used: 0 },
    blockerFallback: boundedText(input.blockerFallback, 2000),
    recoveryCondition: boundedText(input.recoveryCondition, 2000),
    recoveryEntry: boundedText(input.recoveryEntry, 2000),
    acceptanceCriteria: unique(input.acceptanceCriteria),
    evidenceRequirements: unique(input.evidenceRequirements),
    ev0Status: stringValue(input.ev0Status, "unknown"),
    ev0Refs: unique(input.ev0Refs),
    pmAcceptanceStatus: PM_ACCEPTANCE_STATUSES.has(input.pmAcceptanceStatus) ? input.pmAcceptanceStatus : "not_requested",
    pmFeedback: boundedText(input.pmFeedback, 4000),
    pmAcceptedAt: stringValue(input.pmAcceptedAt),
    gapList: unique(input.gapList),
    verificationAdvice: unique(input.verificationAdvice),
    acceptanceArtifactRef: stringValue(input.acceptanceArtifactRef),
    releaseStatus: RELEASE_STATUSES.has(input.releaseStatus) ? input.releaseStatus : "not_planned",
    releaseChannel: stringValue(input.releaseChannel),
    releaseCommit: stringValue(input.releaseCommit),
    releaseTag: stringValue(input.releaseTag),
    releaseUrl: stringValue(input.releaseUrl),
    releaseNotes: boundedText(input.releaseNotes, 4000),
    rollbackPlan: boundedText(input.rollbackPlan, 2000),
    rollbackStatus: stringValue(input.rollbackStatus),
    ev1Feedback: boundedText(input.ev1Feedback, 4000),
    ev2EvidenceRefs: unique(input.ev2EvidenceRefs),
    validationConclusion: stringValue(input.validationConclusion),
    followUpIds: unique(input.followUpIds),
    createdAt: stringValue(input.createdAt, now),
    updatedAt: now,
    createdBy: stringValue(input.createdBy, options.actor || "ravo"),
    updatedBy: stringValue(input.updatedBy, options.actor || "ravo"),
    revision: Number.isInteger(input.revision) && input.revision > 0 ? input.revision : 1
  };
}

function summaryForWorkItem(item, workspace) {
  return {
    id: item.id,
    legacyIds: item.legacyIds,
    itemType: item.itemType,
    title: item.title,
    summary: item.summary,
    product: item.product,
    module: item.module,
    tags: item.tags,
    sourceType: item.sourceType,
    sourceRefs: item.sourceRefs,
    captureMode: item.captureMode,
    sourceConfidence: item.sourceConfidence,
    confirmationStatus: item.confirmationStatus,
    decisionStatus: item.decisionStatus,
    deliveryStatus: item.deliveryStatus,
    pmAcceptanceStatus: item.pmAcceptanceStatus,
    releaseStatus: item.releaseStatus,
    priority: item.priority,
    candidateVersions: item.candidateVersions,
    committedVersion: item.committedVersion,
    releaseSlice: item.releaseSlice,
    changeLevel: item.changeLevel,
    baseVersion: item.baseVersion,
    versionDecisionReason: item.versionDecisionReason,
    versionOverrideReason: item.versionOverrideReason,
    versionDecisionOwner: item.versionDecisionOwner,
    versionDecisionAt: item.versionDecisionAt,
    lockedChangeLevel: item.lockedChangeLevel,
    scopeClass: item.scopeClass,
    actualReleaseVersion: item.actualReleaseVersion,
    actualReleaseAt: item.actualReleaseAt,
    releaseChannel: item.releaseChannel,
    gitBaseline: item.gitBaseline,
    predecessorVersion: item.predecessorVersion,
    predecessorBaselineRef: item.predecessorBaselineRef,
    dependencyIds: item.dependencyIds,
    owner: item.owner,
    blockerStatus: item.blockerStatus,
    estimatedTokens: item.estimatedTokens,
    actualTokens: item.actualTokens,
    actualAgentActiveMinutes: item.actualAgentActiveMinutes,
    actualCalendarMinutes: item.actualCalendarMinutes,
    nextAction: item.nextAction,
    nextActionOwner: item.nextActionOwner,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revision: item.revision,
    detailRef: safeRelative(workspace, safeItemFile(workspace, item.id))
  };
}

function pmWorkItemProjection(item) {
  const version = item.committedVersion || item.releaseSlice || item.deferredToVersion || item.candidateVersions?.[0] || "未排期";
  return {
    id: item.id,
    revision: item.revision,
    title: item.title,
    userImpact: item.userValue || item.expectedOutcome || item.painPoint || item.summary || "待补充用户价值。",
    priority: item.priority || "P2",
    version,
    nextStep: item.nextAction || "Codex 将先补齐下一步。",
    background: item.background || item.summary || "待补充背景。",
    scenario: item.scenario || "待补充使用场景。",
    painPoint: item.painPoint || "待补充用户痛点。",
    expectedOutcome: item.expectedOutcome || item.userValue || "待补充期望结果。",
    scope: item.scopeBoundary || "待补充本轮范围。"
  };
}

function listJsonFiles(directory) {
  try {
    return fs.readdirSync(directory).filter((name) => name.endsWith(".json") && name !== "index.json").sort().map((name) => path.join(directory, name));
  } catch (_error) {
    return [];
  }
}

function readWorkItems(workspace) {
  const paths = ensurePoolDirectories(workspace);
  return listJsonFiles(paths.items).map((file) => readJson(file)).filter(isWorkItem);
}

function rebuildWorkItemIndex(workspace) {
  const paths = ensurePoolDirectories(workspace);
  const items = readWorkItems(workspace);
  const entries = items.map((item) => summaryForWorkItem(item, workspace)).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || left.title.localeCompare(right.title));
  writeJsonAtomic(paths.index, { schemaVersion: "0.5.3", generatedAt: nowIso(), entries });
  writeMarkdownExport(paths.export, items);
  ensurePoolManifest(workspace);
  return { path: paths.index, entries };
}

function writeMarkdownExport(file, items) {
  const entries = items.map(pmWorkItemProjection);
  const rows = [
    "# RAVO 需求与问题池",
    "",
    "此文件由结构化 Pool 自动生成，默认供产品判断使用，不应直接编辑。",
    "",
    "| 问题/标题 | 用户价值或影响 | 优先级 | 版本归属 | 下一步 |",
    "|---|---|---|---|---|",
    ...entries.map((item) => `| ${escapeCell(item.title)} | ${escapeCell(item.userImpact)} | ${escapeCell(item.priority)} | ${escapeCell(item.version)} | ${escapeCell(item.nextStep)} |`)
  ];
  writeTextAtomic(file, `${rows.join("\n")}\n`);
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function getWorkItem(workspace, id) {
  const file = safeItemFile(workspace, id);
  return file ? readJson(file) : null;
}

function createWorkItem(workspace, input, options = {}) {
  const paths = ensurePoolDirectories(workspace);
  const now = options.now || nowIso();
  const item = normalizeWorkItem({ ...input, id: input.id || hashId(`${now}:${crypto.randomUUID()}`) }, { ...options, now });
  const errors = validateWorkItem(item, options.stage || "capture");
  if (errors.length) throw new Error(`invalid_work_item: ${errors.join("; ")}`);
  const file = safeItemFile(workspace, item.id);
  if (!file || fs.existsSync(file)) throw new Error("work_item_exists");
  writeJsonAtomic(file, item);
  appendEvent(workspace, item.id, { type: "created", actor: options.actor || "ravo", sourceRefs: item.sourceRefs, decisionState: decisionState(item) });
  rebuildWorkItemIndex(workspace);
  return { item, path: file, indexPath: paths.index };
}

function updateWorkItem(workspace, id, patch, options = {}) {
  const file = safeItemFile(workspace, id);
  const current = file ? readJson(file) : null;
  if (!current) throw new Error("work_item_not_found");
  if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== current.revision) throw new Error("work_item_revision_conflict");
  const actor = options.actor || "ravo";
  const next = normalizeWorkItem({ ...current, ...patch, id: current.id, legacyIds: current.legacyIds, revision: current.revision + 1, updatedBy: actor }, { ...options, now: options.now || nowIso(), actor });
  const errors = validateWorkItem(next, options.stage || "capture");
  if (errors.length) throw new Error(`invalid_work_item: ${errors.join("; ")}`);
  writeJsonAtomic(file, next);
  const changes = decisionChanges(current, next);
  appendEvent(workspace, id, {
    type: "updated",
    actor: options.actor || "ravo",
    changedFields: Object.keys(patch || {}),
    fromRevision: current.revision,
    toRevision: next.revision,
    ...(Object.keys(changes).length ? { decisionChanges: changes } : {})
  });
  rebuildWorkItemIndex(workspace);
  return { item: next, path: file, indexPath: pathsFor(workspace).index };
}

function updateWorkItemWithSingleMerge(workspace, id, patch, options = {}) {
  try {
    return updateWorkItem(workspace, id, patch, options);
  } catch (error) {
    if (String(error?.message || "") !== "work_item_revision_conflict") throw error;
  }

  const fields = Object.keys(patch || {});
  if (fields.some((field) => !SAFE_CONCURRENT_MERGE_FIELDS.has(field))) throw new Error("work_item_revision_conflict");
  const current = getWorkItem(workspace, id);
  if (!current) throw new Error("work_item_not_found");
  const merged = Object.fromEntries(fields.map((field) => [field, unique([...(current[field] || []), ...(patch[field] || [])])]));
  return updateWorkItem(workspace, id, merged, { ...options, expectedRevision: current.revision });
}

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parsePoolTables(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const records = [];
  let header = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("|")) {
      header = null;
      continue;
    }
    const cells = tableCells(line);
    if (!header) {
      const next = lines[index + 1] && lines[index + 1].trim().startsWith("|") ? tableCells(lines[index + 1]) : [];
      if (isTableSeparator(next)) {
        header = cells;
        index += 1;
      }
      continue;
    }
    if (isTableSeparator(cells) || cells.length !== header.length) continue;
    const values = Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] || ""]));
    const id = stringValue(values.ID || values.Id || values.id);
    if (!/^[A-Za-z][A-Za-z0-9]*-[0-9]{3,}$/.test(id)) continue;
    records.push({ id, values, raw: cells.join(" | ") });
  }
  return records;
}

function candidateVersion(value) {
  const text = String(value || "");
  return [...text.matchAll(/(?:v|Hotfix-)[0-9]+(?:\.[0-9]+){1,2}/gi)].map((match) => match[0]).filter(Boolean);
}

const COPIED_SOURCE_EXCERPT_ACTORS = new Set(["migration", "pool-capture", "pm-priority-replan"]);

function hasKnownCopiedSourceExcerpt(item) {
  const sourceExcerpt = stringValue(item?.sourceExcerpt);
  const description = stringValue(item?.description);
  return Boolean(sourceExcerpt && description && sourceExcerpt === description && COPIED_SOURCE_EXCERPT_ACTORS.has(item?.createdBy));
}

function isUntouchedMigratedPoolItem(item, sourceRef, legacyId) {
  const expectedRef = `${sourceRef}#${legacyId}`;
  return item?.captureMode === "migrated"
    && item?.createdBy === "migration"
    && item?.updatedBy === "migration"
    && Array.isArray(item.sourceRefs)
    && item.sourceRefs.length === 1
    && item.sourceRefs[0] === expectedRef;
}

function repairCopiedWorkItemSourceExcerpts(workspace, options = {}) {
  const repaired = [];
  for (const item of readWorkItems(workspace)) {
    if (!hasKnownCopiedSourceExcerpt(item)) continue;
    const updated = updateWorkItem(workspace, item.id, { sourceExcerpt: "" }, {
      ...options,
      actor: "migration",
      expectedRevision: item.revision
    });
    repaired.push(updated.item);
  }
  return { repaired: repaired.length, items: repaired };
}

function migrateRequirementPool(workspace, options = {}) {
  const sourceRef = options.sourceRef || "docs/ravo-requirement-pool-zh.md";
  const file = path.resolve(workspace, sourceRef);
  const markdown = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const parsed = parsePoolTables(markdown);
  const migrated = [];
  const refreshed = [];
  for (const record of parsed) {
    const existingId = hashId(record.id, "WI");
    const combined = Object.values(record.values).join(" | ");
    const isIssue = /^ISSUE-/i.test(record.id);
    const isHotfix = /^(HFR|HFC)-/i.test(record.id);
    const isEnvironment = /^ENV-|^R053-/.test(record.id);
    const title = stringValue(record.values.需求 || record.values.问题 || record.values.行为 || record.values.描述 || record.values["当前问题"] || record.values["原 ID"] || combined);
    const summary = stringValue(record.values.影响 || record.values.最低验收结果 || record.values.版本目标 || record.values.需求 || record.values.问题 || combined);
    const versions = unique([...candidateVersion(combined), ...candidateVersion(record.values.候选版本 || record.values["候选处理版本"])]);
    const existing = getWorkItem(workspace, existingId);
    if (existing) {
      const patch = {};

      // Legacy imports copied synthesized table data into a field reserved for verbatim source text.
      if (hasKnownCopiedSourceExcerpt(existing)) patch.sourceExcerpt = "";

      // Imports with expanded source provenance are treated as enriched and are not overwritten.
      if (isUntouchedMigratedPoolItem(existing, sourceRef, record.id)) {
        if (existing.title !== title) patch.title = title;
        if (existing.summary !== summary) patch.summary = summary;
        if (existing.description !== combined) patch.description = combined;
      }

      if (Object.keys(patch).length) {
        const updated = updateWorkItem(workspace, existing.id, patch, {
          ...options,
          actor: "migration",
          expectedRevision: existing.revision
        });
        refreshed.push(updated.item);
      }
      continue;
    }
    const item = createWorkItem(workspace, {
      id: existingId,
      legacyIds: [record.id],
      itemType: isIssue ? "bug" : isHotfix ? "hotfix" : isEnvironment ? "environment" : "feature",
      title,
      summary,
      description: combined,
      sourceType: isIssue ? "issue_record" : "requirement_pool",
      sourceRefs: [`${sourceRef}#${record.id}`],
      captureMode: "migrated",
      sourceConfidence: 1,
      confirmationStatus: "needs_triage",
      decisionStatus: "candidate",
      candidateVersions: versions,
      scopeClass: "candidate",
      nextAction: "PM 梳理需求背景、场景、价值和版本归属。",
      nextActionOwner: "pm"
    }, { ...options, actor: "migration" });
    migrated.push(item.item);
  }
  const index = rebuildWorkItemIndex(workspace);
  return { source: sourceRef, parsed: parsed.length, migrated: migrated.length, refreshed: refreshed.length, indexPath: index.path, items: migrated };
}

function knowledgeFiles(workspace) {
  return listJsonFiles(pathsFor(workspace).knowledge);
}

function normalizeKnowledgeRecord(input, options = {}) {
  const now = options.now || nowIso();
  const status = KNOWLEDGE_STATUSES.has(input.status) ? input.status : (options.capture ? "candidate" : "active");
  const originalKind = stringValue(input.kind);
  const kind = KNOWLEDGE_KINDS.has(originalKind) ? originalKind : (LEGACY_KNOWLEDGE_KIND_MAP[originalKind] || "lesson");
  return {
    ...input,
    schemaVersion: "0.5.3",
    id: stringValue(input.id) || hashId(`${now}:${input.title || input.content || crypto.randomUUID()}`, "KN"),
    legacyIds: unique(input.legacyIds),
    legacyKind: KNOWLEDGE_KINDS.has(originalKind) ? stringValue(input.legacyKind) : originalKind,
    kind,
    title: boundedText(input.title || input.summary || input.content, 240),
    summary: boundedText(input.summary || input.content, 2000),
    content: boundedText(input.content, 24000),
    status,
    source: stringValue(input.source),
    sourceRefs: unique([...(input.sourceRefs || []), ...(input.relatedArtifacts || [])]),
    confirmationStatus: stringValue(input.confirmationStatus, input.confirmedBy ? "confirmed" : "needs_review"),
    applicability: unique(input.applicability),
    nonApplicability: unique(input.nonApplicability),
    tags: unique(input.tags),
    scope: input.scope === "user" ? "user" : "workspace",
    sensitivity: stringValue(input.sensitivity, "internal"),
    redactionStatus: stringValue(input.redactionStatus, "not_required"),
    evidenceLevel: stringValue(input.evidenceLevel, "notes"),
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0.5,
    confirmedBy: stringValue(input.confirmedBy),
    confirmedAt: stringValue(input.confirmedAt),
    lastVerifiedAt: stringValue(input.lastVerifiedAt),
    reviewAfter: stringValue(input.reviewAfter),
    lastUsedAt: stringValue(input.lastUsedAt),
    useCount: Number.isInteger(input.useCount) && input.useCount >= 0 ? input.useCount : 0,
    reuseOutcome: stringValue(input.reuseOutcome, "unknown"),
    stalenessReason: boundedText(input.stalenessReason, 2000),
    relatedRequirements: unique(input.relatedRequirements),
    relatedIssues: unique(input.relatedIssues),
    relatedSpecs: unique(input.relatedSpecs),
    relatedKnowledge: unique(input.relatedKnowledge),
    duplicateOf: stringValue(input.duplicateOf),
    supersededBy: stringValue(input.supersededBy),
    revision: Number.isInteger(input.revision) && input.revision > 0 ? input.revision : 1,
    createdAt: stringValue(input.createdAt, now),
    updatedAt: now
  };
}

function validateKnowledgeRecord(value, options = {}) {
  const errors = [];
  if (!value || typeof value !== "object") return ["knowledge must be an object"];
  if (!value.id || !value.title || !value.content) errors.push("id, title and content are required");
  if (!KNOWLEDGE_KINDS.has(value.kind)) errors.push(`kind is invalid: ${value.kind}`);
  if (!KNOWLEDGE_STATUSES.has(value.status)) errors.push(`status is invalid: ${value.status}`);
  if (!Array.isArray(value.applicability)) errors.push("applicability must be an array");
  if (!Array.isArray(value.sourceRefs)) errors.push("sourceRefs must be an array");
  if (value.status === "active") {
    if (!value.summary) errors.push("active knowledge requires summary");
    if (!value.source && value.sourceRefs.length === 0) errors.push("active knowledge requires source");
    if (value.applicability.length === 0) errors.push("active knowledge requires applicability");
    if (value.confirmationStatus === "needs_review" || options.requireConfirmation && !value.confirmedBy) errors.push("active knowledge requires confirmation");
  }
  if (value.scope === "user" && options.allowUserScope !== true) errors.push("user scope requires explicit opt-in");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence must be between 0 and 1");
  return errors;
}

function knowledgeSummary(workspace, item) {
  const artifactPath = path.join(pathsFor(workspace).knowledge, `${item.id}.json`);
  const markdownPath = path.join(pathsFor(workspace).knowledge, `${item.id}.md`);
  return {
    id: item.id,
    legacyIds: item.legacyIds || [],
    legacyKind: item.legacyKind || "",
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    status: item.status,
    scope: item.scope,
    tags: item.tags,
    source: item.source,
    sourceRefs: item.sourceRefs,
    confirmationStatus: item.confirmationStatus || "needs_review",
    applicability: item.applicability,
    nonApplicability: item.nonApplicability,
    evidenceLevel: item.evidenceLevel,
    confidence: item.confidence,
    sensitivity: item.sensitivity,
    redactionStatus: item.redactionStatus,
    lastVerifiedAt: item.lastVerifiedAt,
    reviewAfter: item.reviewAfter,
    lastUsedAt: item.lastUsedAt,
    useCount: item.useCount,
    reuseOutcome: item.reuseOutcome,
    stalenessReason: item.stalenessReason,
    duplicateOf: item.duplicateOf,
    supersededBy: item.supersededBy,
    relatedRequirements: item.relatedRequirements,
    relatedIssues: item.relatedIssues,
    updatedAt: item.updatedAt,
    artifactPath,
    markdownPath,
    detailRef: safeRelative(workspace, artifactPath)
  };
}

function rebuildKnowledgeIndex(workspace) {
  const paths = pathsFor(workspace);
  fs.mkdirSync(paths.knowledge, { recursive: true, mode: 0o700 });
  const entries = knowledgeFiles(workspace).map((file) => readJson(file)).filter((item) => item && item.id && item.id !== "index").map((item) => knowledgeSummary(workspace, item));
  entries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || left.title.localeCompare(right.title));
  writeJsonAtomic(paths.knowledgeIndex, { schemaVersion: "0.5.3", generatedAt: nowIso(), entries });
  ensureManifestModule(workspace, "knowledge", ["knowledge/.ravo/knowledge"], "knowledge/.ravo/knowledge/index.json");
  return { path: paths.knowledgeIndex, entries };
}

function knowledgeMarkdownFor(item) {
  const lines = [
    "---",
    `ravo_type: ${item.kind}`,
    `title: ${JSON.stringify(item.title)}`,
    `summary: ${JSON.stringify(item.summary)}`,
    `source: ${JSON.stringify(item.source || "")}`,
    `scope: ${item.scope}`,
    `status: ${item.status}`,
    `tags: [${(item.tags || []).map((value) => JSON.stringify(value)).join(", ")}]`,
    `applicability: [${(item.applicability || []).map((value) => JSON.stringify(value)).join(", ")}]`,
    `sensitivity: ${item.sensitivity}`,
    `created_at: ${item.createdAt}`,
    `updated_at: ${item.updatedAt}`,
    "---",
    "",
    `# ${item.title}`,
    "",
    item.content,
    "",
    "## 适用场景",
    "",
    ...(item.applicability?.length ? item.applicability.map((value) => `- ${value}`) : ["- 未记录"]),
    "",
    "## 不适用场景",
    "",
    ...(item.nonApplicability?.length ? item.nonApplicability.map((value) => `- ${value}`) : ["- 未记录"]),
    "",
    "## 来源",
    "",
    item.source || "未记录",
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function createKnowledge(workspace, input, options = {}) {
  const paths = pathsFor(workspace);
  fs.mkdirSync(paths.knowledge, { recursive: true, mode: 0o700 });
  const now = options.now || nowIso();
  const item = normalizeKnowledgeRecord({ ...input, id: input.id || hashId(`${now}:${input.title || input.content || crypto.randomUUID()}`, "KN") }, { ...options, now, capture: input.status === "candidate" || options.capture === true });
  const errors = validateKnowledgeRecord(item, { ...options, allowUserScope: false });
  if (errors.length) throw new Error(`invalid_knowledge: ${errors.join("; ")}`);
  const jsonPath = path.join(paths.knowledge, `${item.id}.json`);
  if (fs.existsSync(jsonPath)) throw new Error("knowledge_exists");
  writeJsonAtomic(jsonPath, item);
  writeTextAtomic(path.join(paths.knowledge, `${item.id}.md`), knowledgeMarkdownFor(item));
  rebuildKnowledgeIndex(workspace);
  return { item, path: jsonPath, indexPath: paths.knowledgeIndex };
}

function getKnowledge(workspace, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(String(id || ""))) return null;
  return readJson(path.join(pathsFor(workspace).knowledge, `${id}.json`));
}

function updateKnowledge(workspace, id, patch, options = {}) {
  const file = path.join(pathsFor(workspace).knowledge, `${id}.json`);
  const current = readJson(file);
  if (!current) throw new Error("knowledge_not_found");
  if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== current.revision) throw new Error("knowledge_revision_conflict");
  const next = normalizeKnowledgeRecord({ ...current, ...patch, id: current.id, revision: current.revision + 1 }, { ...options, now: options.now || nowIso() });
  const errors = validateKnowledgeRecord(next, options);
  if (errors.length) throw new Error(`invalid_knowledge: ${errors.join("; ")}`);
  writeJsonAtomic(file, next);
  writeTextAtomic(path.join(pathsFor(workspace).knowledge, `${id}.md`), knowledgeMarkdownFor(next));
  rebuildKnowledgeIndex(workspace);
  return { item: next, path: file, indexPath: pathsFor(workspace).knowledgeIndex };
}

function markKnowledgeUsed(workspace, id, outcome = "unknown", now = nowIso()) {
  const item = getKnowledge(workspace, id);
  if (!item) throw new Error("knowledge_not_found");
  return updateKnowledge(workspace, id, { lastUsedAt: now, useCount: (item.useCount || 0) + 1, reuseOutcome: outcome }, { expectedRevision: item.revision, allowUserScope: item.scope === "user" });
}

function migrateKnowledge(workspace, options = {}) {
  const migrated = [];
  for (const file of knowledgeFiles(workspace)) {
    const current = readJson(file);
    if (!current || current.id === "index") continue;
    const relative = safeRelative(workspace, file);
    const legacyFileId = path.basename(file, ".json");
    const stableId = stringValue(current.id) || hashId(`legacy:${relative}`, "KN");
    const next = normalizeKnowledgeRecord({
      ...current,
      id: stableId,
      legacyIds: unique([...(current.legacyIds || []), current.id || legacyFileId]),
      source: current.source || `legacy:${relative}`,
      sourceRefs: unique([...(current.sourceRefs || []), ...(current.relatedArtifacts || []), relative]),
      status: current.status || "active",
      applicability: current.applicability || [],
      nonApplicability: current.nonApplicability || [],
      useCount: current.useCount || 0
    }, { now: current.updatedAt || current.createdAt || nowIso() });
    const errors = validateKnowledgeRecord(next, { allowUserScope: next.scope === "user" });
    if (errors.length && next.status === "active") {
      next.status = "needs_review";
      next.confirmationStatus = "needs_review";
      next.stalenessReason = `迁移后待补字段：${errors.join("；")}`;
    }
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      writeJsonAtomic(file, next);
      migrated.push(next.id);
    }
  }
  const index = rebuildKnowledgeIndex(workspace);
  return { migrated, indexPath: index.path, entries: index.entries.length };
}

function runCli() {
  const workspace = path.resolve(process.argv[2] || process.cwd());
  const command = process.argv[3] || "rebuild";
  if (command === "migrate") {
    console.log(JSON.stringify({ status: "ok", requirementPool: migrateRequirementPool(workspace), knowledge: migrateKnowledge(workspace) }, null, 2));
    return;
  }
  if (command === "repair-pool-fields") {
    console.log(JSON.stringify({ status: "ok", workItems: repairCopiedWorkItemSourceExcerpts(workspace) }, null, 2));
    return;
  }
  if (command === "rebuild") {
    console.log(JSON.stringify({ status: "ok", requirements: rebuildWorkItemIndex(workspace), knowledge: rebuildKnowledgeIndex(workspace) }, null, 2));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (require.main === module) runCli();

module.exports = {
  WORK_ITEM_TYPES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  pathsFor,
  validateWorkItem,
  normalizeWorkItem,
  pmWorkItemProjection,
  readWorkItems,
  rebuildWorkItemIndex,
  ensurePoolManifest,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  updateWorkItemWithSingleMerge,
  migrateRequirementPool,
  repairCopiedWorkItemSourceExcerpts,
  parsePoolTables,
  validateKnowledgeRecord,
  normalizeKnowledgeRecord,
  rebuildKnowledgeIndex,
  getKnowledge,
  createKnowledge,
  updateKnowledge,
  markKnowledgeUsed,
  migrateKnowledge
};
