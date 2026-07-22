"use strict";

const ACCEPTANCE_STATUSES = new Set([
  "in_progress",
  "code_complete",
  "pending_acceptance",
  "accepted",
  "release_ready",
  "not_ready"
]);
const EVIDENCE_LEVELS = new Set([
  "none",
  "notes",
  "script",
  "api",
  "smoke",
  "real_e2e",
  "full_external_review",
  "partial_external_review"
]);
const FULFILLMENT_STATUSES = new Set(["met", "partial", "not_met", "not_applicable", "unknown"]);
const VERIFICATION_STATUSES = new Set(["verified", "pending_codex", "pending_pm", "blocked", "pending_classification"]);
const VERIFICATION_OWNERS = new Set(["codex", "pm", "shared", "external"]);
const BLOCKER_EXECUTION_STATUSES = new Set(["parked", "blocked_external", "blocked_terminal"]);
const EXTERNAL_BLOCKER_DECISIONS = new Set(["pending_pm", "accepted", "rejected"]);
const PM_DECISION_VERDICTS = new Set(["accepted", "rejected"]);
const SECURITY_ITEMS = [
  "data_privacy",
  "credentials",
  "permissions",
  "destructive_actions",
  "external_calls",
  "dependencies",
  "logs_artifacts",
  "global_knowledge"
];
const ITEM_FIELDS = [
  "id",
  "name",
  "required",
  "expected",
  "implementation",
  "effect",
  "fulfillmentStatus",
  "verificationStatus",
  "verificationOwner",
  "verificationReason",
  "verificationTasks",
  "sourceRefs",
  "risk",
  "boundary",
  "blockingReason",
  "blockerImpact",
  "temporaryFallback",
  "recoveryEntry",
  "dependencyImpact"
];
const TASK_FIELDS = [
  "id",
  "claim",
  "reason",
  "owner",
  "preconditions",
  "steps",
  "expectedResult",
  "evidenceRequired",
  "failureAction",
  "blocking"
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requiresPmDecision(artifact, specText = null) {
  if (artifact?.pmDecisionRequired === true) return true;
  return typeof specText === "string" && /R054-023|HFP-001|v0\.5\.5/i.test(specText);
}

function requiresGitBaseline(artifact, specText = null) {
  if (artifact?.gitBaselineRequired === true) return true;
  return typeof specText === "string" && /R054-001|R054-004|R054-010|v0\.5\.5/i.test(specText);
}

function pmDecisionErrors(artifact, options = {}) {
  const specText = options.specText ?? null;
  const required = options.required === true || requiresPmDecision(artifact, specText);
  if (!required || !["accepted", "release_ready"].includes(artifact?.status)) return [];
  const decision = artifact?.pmDecision;
  const errors = [];
  if (!isObject(decision)) return ["accepted/release_ready requires an explicit pmDecision bound to the current acceptance package."];
  if (!PM_DECISION_VERDICTS.has(decision.verdict)) errors.push("pmDecision.verdict must be accepted or rejected.");
  if (decision.verdict !== "accepted") errors.push("accepted/release_ready requires pmDecision.verdict=accepted.");
  if (!nonEmptyString(decision.decisionText)) errors.push("pmDecision.decisionText is required.");
  const text = String(decision.decisionText || "");
  if (nonEmptyString(decision.decisionText) && !/(验收通过|确认(?:当前)?(?:版本)?验收通过|同意(?:当前)?(?:版本)?验收|通过当前(?:版本|验收)|accept(?:ed)?|pass(?:ed)?)/i.test(text)) {
    errors.push("pmDecision.decisionText must state an explicit acceptance action; bare 确认/同意/可以 is insufficient.");
  }
  const scopeInText = nonEmptyString(artifact.subjectRef) && text.includes(artifact.subjectRef)
    || nonEmptyString(artifact.baselineRef) && text.includes(artifact.baselineRef)
    || /(当前版本|本次验收|验收包|当前 Release Slice|release slice|this acceptance package)/i.test(text);
  if (!scopeInText) errors.push("pmDecision.decisionText must identify the current version, acceptance package, Release Slice, subjectRef, or baselineRef.");
  if (!/^conversation:[^#\s]+#[^#\s]+$/.test(String(decision.sourceRef || ""))) errors.push("pmDecision.sourceRef must use conversation:<thread>#<turn> format.");
  if (!nonEmptyString(artifact.subjectRef) || decision.subjectRef !== artifact.subjectRef) errors.push("pmDecision.subjectRef must equal acceptance.subjectRef.");
  if (!nonEmptyString(artifact.baselineRef) || decision.baselineRef !== artifact.baselineRef) errors.push("pmDecision.baselineRef must equal acceptance.baselineRef.");
  if (!nonEmptyString(decision.decidedAt) || !Number.isFinite(Date.parse(decision.decidedAt))) errors.push("pmDecision.decidedAt must be a valid ISO timestamp.");
  if (decision.actor !== "pm") errors.push("pmDecision.actor must be pm.");
  return errors;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJson(value) {
  if (isObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function classificationTask(id, name) {
  return {
    id: `${id}-classify`,
    claim: `Classify fulfillment and verification evidence for ${name}.`,
    reason: "The source uses legacy or free-text acceptance semantics and cannot support a final judgment.",
    owner: "shared",
    preconditions: [],
    steps: [
      "Compare the requirement with the current implementation.",
      "Identify existing evidence and decide whether Codex, PM, or an external party must verify the remainder."
    ],
    expectedResult: "The item has explicit fulfillment and verification statuses backed by source references.",
    evidenceRequired: ["Requirement reference", "Implementation evidence", "Verification result"],
    failureAction: "Keep the item pending_classification and record the missing evidence or blocker.",
    blocking: true
  };
}

function legacyFulfillment(judgment) {
  const text = String(judgment || "").trim();
  if (/基本满足/.test(text)) return "unknown";
  if (/部分满足/.test(text)) return "partial";
  if (/不满足/.test(text)) return "not_met";
  if (/^满足$/.test(text)) return "met";
  return "unknown";
}

function normalizeLegacyItem(value, index, summary) {
  const source = parseJson(value) || (isObject(value) ? value : { name: String(value || "").trim() });
  const id = nonEmptyString(source.id) ? source.id.trim() : `acceptance-${index + 1}`;
  const name = nonEmptyString(source.name) ? source.name.trim() : `验收项 ${index + 1}`;
  const judgment = source.judgment || source.status || "";
  const verificationReason = /基本满足/.test(String(judgment || ""))
    ? "旧验收项使用了“基本满足”，无法区分实现缺口与证据缺口，必须重新分类。"
    : "旧验收项缺少当前双维状态、责任人或可执行验证任务，必须重新分类。";
  return {
    id,
    name,
    required: source.required !== false,
    expected: String(source.expected || summary || "").trim(),
    implementation: String(source.implementation || "待按当前实现重新确认。"),
    effect: String(source.effect || summary || "待重新确认。"),
    fulfillmentStatus: legacyFulfillment(judgment),
    verificationStatus: "pending_classification",
    verificationOwner: "shared",
    verificationReason,
    verificationTasks: [classificationTask(id, name)],
    sourceRefs: Array.isArray(source.sourceRefs) ? source.sourceRefs.filter((item) => typeof item === "string") : [],
    risk: String(source.risk || "旧结论可能高估当前满足程度。"),
    boundary: String(source.boundary || "旧 artifact 仅作为来源引用，不作为当前版本验收结论。"),
    blockingReason: "",
    blockerImpact: "",
    temporaryFallback: "",
    recoveryEntry: "",
    dependencyImpact: ""
  };
}

function isModernItem(value) {
  return isObject(value) && !Object.prototype.hasOwnProperty.call(value, "judgment") && (
    Object.prototype.hasOwnProperty.call(value, "fulfillmentStatus") ||
    Object.prototype.hasOwnProperty.call(value, "verificationStatus") ||
    Object.prototype.hasOwnProperty.call(value, "verificationTasks")
  );
}

function normalizeModernItem(value) {
  const item = { dependencyImpact: "", ...value };
  if (Array.isArray(item.verificationTasks)) {
    item.verificationTasks = item.verificationTasks.map((task) => parseJson(task) || task);
  }
  return item;
}

function parseAcceptanceItems(rawItems, summary = "") {
  const sourceItems = Array.isArray(rawItems) ? rawItems : [];
  const effectiveItems = sourceItems.length ? sourceItems : [{ name: "整体验收", expected: summary, effect: summary }];
  let legacyItems = 0;
  let generatedItems = sourceItems.length ? 0 : 1;
  const items = effectiveItems.map((raw, index) => {
    const parsed = parseJson(raw) || raw;
    if (isModernItem(parsed)) return normalizeModernItem(parsed);
    legacyItems += sourceItems.length ? 1 : 0;
    return normalizeLegacyItem(parsed, index, summary);
  });
  return { items, legacyItems, generatedItems };
}

function validateTask(task, itemId, index) {
  const errors = [];
  const label = `${itemId}.verificationTasks[${index}]`;
  if (!isObject(task)) return [`${label} must be an object.`];
  for (const field of TASK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(task, field)) errors.push(`${label}.${field} is required.`);
  }
  for (const field of ["id", "claim", "reason", "expectedResult", "failureAction"]) {
    if (Object.prototype.hasOwnProperty.call(task, field) && !nonEmptyString(task[field])) errors.push(`${label}.${field} must be a non-empty string.`);
  }
  if (!VERIFICATION_OWNERS.has(task.owner)) errors.push(`${label}.owner is invalid.`);
  if (!stringArray(task.preconditions)) errors.push(`${label}.preconditions must be a string array.`);
  if (!stringArray(task.steps) || task.steps.length === 0 || task.steps.some((step) => !step.trim())) errors.push(`${label}.steps must contain at least one non-empty step.`);
  if (!stringArray(task.evidenceRequired) || task.evidenceRequired.length === 0 || task.evidenceRequired.some((entry) => !entry.trim())) {
    errors.push(`${label}.evidenceRequired must contain at least one non-empty entry.`);
  }
  if (typeof task.blocking !== "boolean") errors.push(`${label}.blocking must be boolean.`);
  return errors;
}

function validateAcceptanceItem(item, index = 0) {
  const errors = [];
  const label = nonEmptyString(item?.id) ? item.id : `acceptanceItems[${index}]`;
  if (!isObject(item)) return [`${label} must be an object.`];
  for (const field of ITEM_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(item, field)) errors.push(`${label}.${field} is required.`);
  }
  for (const field of ["id", "name", "expected", "implementation", "effect"]) {
    if (Object.prototype.hasOwnProperty.call(item, field) && !nonEmptyString(item[field])) errors.push(`${label}.${field} must be a non-empty string.`);
  }
  for (const field of ["verificationReason", "risk", "boundary", "blockingReason", "blockerImpact", "temporaryFallback", "recoveryEntry", "dependencyImpact"]) {
    if (Object.prototype.hasOwnProperty.call(item, field) && typeof item[field] !== "string") errors.push(`${label}.${field} must be a string.`);
  }
  if (Object.prototype.hasOwnProperty.call(item, "blockerExecutionStatus") && !BLOCKER_EXECUTION_STATUSES.has(item.blockerExecutionStatus)) {
    errors.push(`${label}.blockerExecutionStatus is invalid.`);
  }
  if (Object.prototype.hasOwnProperty.call(item, "externalBlockerDecision") && !EXTERNAL_BLOCKER_DECISIONS.has(item.externalBlockerDecision)) {
    errors.push(`${label}.externalBlockerDecision is invalid.`);
  }
  for (const field of ["externalBlockerSpecRef", "externalBlockerSpecAnchor", "externalBlockerDecisionRef"]) {
    if (Object.prototype.hasOwnProperty.call(item, field) && typeof item[field] !== "string") errors.push(`${label}.${field} must be a string.`);
  }
  if (typeof item.required !== "boolean") errors.push(`${label}.required must be boolean.`);
  if (!FULFILLMENT_STATUSES.has(item.fulfillmentStatus)) errors.push(`${label}.fulfillmentStatus is invalid.`);
  if (!VERIFICATION_STATUSES.has(item.verificationStatus)) errors.push(`${label}.verificationStatus is invalid.`);
  if (!VERIFICATION_OWNERS.has(item.verificationOwner)) errors.push(`${label}.verificationOwner is invalid.`);
  if (!Array.isArray(item.verificationTasks)) errors.push(`${label}.verificationTasks must be an array.`);
  else item.verificationTasks.forEach((task, taskIndex) => errors.push(...validateTask(task, label, taskIndex)));
  if (!stringArray(item.sourceRefs)) errors.push(`${label}.sourceRefs must be a string array.`);

  if (item.required && item.verificationStatus !== "verified" && (!Array.isArray(item.verificationTasks) || item.verificationTasks.length === 0)) {
    errors.push(`${label} requires at least one verification task while verificationStatus=${item.verificationStatus}.`);
  }
  if (item.required && item.verificationStatus === "verified" && (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0)) {
    errors.push(`${label} requires sourceRefs when verified.`);
  }
  if (["partial", "not_met"].includes(item.fulfillmentStatus) && !nonEmptyString(item.verificationReason)) {
    errors.push(`${label}.verificationReason must describe the implementation gap for fulfillmentStatus=${item.fulfillmentStatus}.`);
  }
  if (item.fulfillmentStatus === "not_applicable" && (!nonEmptyString(item.verificationReason) || !Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0)) {
    errors.push(`${label} requires a reason and alternative evidence for not_applicable.`);
  }
  if (item.verificationStatus === "pending_codex" && !["codex", "shared"].includes(item.verificationOwner)) {
    errors.push(`${label}.verificationOwner must be codex or shared for pending_codex.`);
  }
  if (item.verificationStatus === "pending_codex" && Array.isArray(item.verificationTasks) && item.verificationTasks.some((task) => !["codex", "shared"].includes(task?.owner))) {
    errors.push(`${label} pending_codex tasks must be owned by codex or shared.`);
  }
  if (item.verificationStatus === "pending_pm" && !["pm", "shared"].includes(item.verificationOwner)) {
    errors.push(`${label}.verificationOwner must be pm or shared for pending_pm.`);
  }
  if (item.verificationStatus === "pending_pm" && Array.isArray(item.verificationTasks) && item.verificationTasks.some((task) => !["pm", "shared"].includes(task?.owner))) {
    errors.push(`${label} pending_pm tasks must be owned by pm or shared.`);
  }
  if (item.verificationStatus === "verified" && item.fulfillmentStatus === "unknown") {
    errors.push(`${label} cannot be verified while fulfillmentStatus=unknown.`);
  }
  if (item.fulfillmentStatus === "not_applicable" && item.verificationStatus !== "verified") {
    errors.push(`${label} not_applicable must be verified with alternative evidence.`);
  }
  if (item.verificationStatus === "blocked") {
    for (const field of ["blockingReason", "blockerImpact", "temporaryFallback", "recoveryEntry"]) {
      if (!nonEmptyString(item[field])) errors.push(`${label}.${field} is required when blocked.`);
    }
  }
  if (item.blockerExecutionStatus === "blocked_external") {
    if (item.verificationStatus !== "blocked") errors.push(`${label}.verificationStatus must be blocked for blocked_external.`);
    if (item.verificationOwner !== "external") errors.push(`${label}.verificationOwner must be external for blocked_external.`);
    if (!nonEmptyString(item.externalBlockerSpecRef)) errors.push(`${label}.externalBlockerSpecRef is required for blocked_external.`);
    if (!nonEmptyString(item.externalBlockerSpecAnchor)) errors.push(`${label}.externalBlockerSpecAnchor is required for blocked_external.`);
    if (!EXTERNAL_BLOCKER_DECISIONS.has(item.externalBlockerDecision)) errors.push(`${label}.externalBlockerDecision is required for blocked_external.`);
    if (item.externalBlockerDecision === "accepted" && !nonEmptyString(item.externalBlockerDecisionRef)) {
      errors.push(`${label}.externalBlockerDecisionRef is required when the external blocker degradation is accepted.`);
    }
  } else if (Object.prototype.hasOwnProperty.call(item, "externalBlockerDecision")) {
    errors.push(`${label}.externalBlockerDecision is only valid for blocked_external.`);
  }
  return errors;
}

function validateAcceptanceItems(items) {
  if (!Array.isArray(items) || items.length === 0) return ["acceptanceItems must contain at least one item."];
  const errors = items.flatMap((item, index) => validateAcceptanceItem(item, index));
  const ids = items.map((item) => item?.id).filter(nonEmptyString);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) errors.push(`acceptanceItems contain duplicate ids: ${duplicateIds.join(", ")}.`);
  const taskIds = items.flatMap((item) => Array.isArray(item?.verificationTasks) ? item.verificationTasks.map((task) => task?.id).filter(nonEmptyString) : []);
  const duplicateTaskIds = [...new Set(taskIds.filter((id, index) => taskIds.indexOf(id) !== index))];
  if (duplicateTaskIds.length) errors.push(`verificationTasks contain duplicate ids: ${duplicateTaskIds.join(", ")}.`);
  return errors;
}

function externalBlockerState(item, specRef = "", specText = null) {
  const external = item?.verificationStatus === "blocked" && item?.blockerExecutionStatus === "blocked_external";
  if (!external) return { external: false, allowed: false, decision: "" };
  const specBound = nonEmptyString(item.externalBlockerSpecRef)
    && (!nonEmptyString(specRef) || item.externalBlockerSpecRef === specRef);
  const anchorDeclared = nonEmptyString(item.externalBlockerSpecAnchor);
  const anchorVerified = typeof specText === "string" ? specText.includes(item.externalBlockerSpecAnchor) : true;
  const decision = EXTERNAL_BLOCKER_DECISIONS.has(item.externalBlockerDecision) ? item.externalBlockerDecision : "";
  return {
    external: true,
    allowed: item.verificationOwner === "external" && specBound && anchorDeclared && anchorVerified && Boolean(decision),
    decision
  };
}

function needsExternalBlockerPmDecision(item, specRef = "", specText = null) {
  const state = externalBlockerState(item, specRef, specText);
  return state.allowed && state.decision === "pending_pm";
}

function deriveStatusCeiling(items, specRef = "", specText = null) {
  const requiredItems = Array.isArray(items) ? items.filter((item) => item?.required === true) : [];
  if (requiredItems.length === 0) return "not_ready";
  if (requiredItems.some((item) => ["not_met", "partial", "unknown"].includes(item.fulfillmentStatus))) return "not_ready";
  if (requiredItems.some((item) => item.verificationStatus === "pending_classification")) return "not_ready";
  const blockedStates = requiredItems
    .filter((item) => item.verificationStatus === "blocked")
    .map((item) => externalBlockerState(item, specRef, specText));
  if (blockedStates.some((state) => !state.allowed || state.decision === "rejected")) return "not_ready";
  if (requiredItems.some((item) => item.verificationStatus === "pending_codex")) return "code_complete";
  if (requiredItems.some((item) => item.verificationStatus === "pending_pm") || blockedStates.some((state) => state.decision === "pending_pm")) return "pending_acceptance";
  if (requiredItems.every((item) => {
    if (!["met", "not_applicable"].includes(item.fulfillmentStatus)) return false;
    if (item.verificationStatus === "verified") return true;
    const state = externalBlockerState(item, specRef, specText);
    return state.allowed && state.decision === "accepted";
  })) return "accepted";
  return "not_ready";
}

function securityReady(checklist) {
  if (!Array.isArray(checklist) || checklist.length !== SECURITY_ITEMS.length) return false;
  const ids = checklist.map((item) => item?.id);
  return new Set(ids).size === SECURITY_ITEMS.length
    && SECURITY_ITEMS.every((id) => ids.includes(id))
    && checklist.every((item) => item?.status === "pass");
}

function hasSourceBinding(artifact) {
  if (!nonEmptyString(artifact?.subjectRef)) return false;
  const typedBindings = ["analysisArtifact", "workstreamArtifact", "quickValidationArtifact", "reviewArtifact", "specRef", "releaseRef"];
  return typedBindings.some((field) => nonEmptyString(artifact?.[field]));
}

function artifactMatchesSubject(artifact, subjectRef) {
  if (!isObject(artifact) || !nonEmptyString(subjectRef)) return false;
  const direct = ["subjectRef", "releaseRef", "relatedArtifact", "scopeRef"]
    .map((field) => artifact[field])
    .filter(nonEmptyString);
  const lists = [artifact.sourceRefs, artifact.evidenceRefs]
    .filter(Array.isArray)
    .flat()
    .filter(nonEmptyString);
  return [...direct, ...lists].includes(subjectRef);
}

function acceptanceScope(artifact) {
  if (["milestone", "release"].includes(artifact?.acceptanceScope)) return artifact.acceptanceScope;
  if (artifact?.schemaVersion === "0.5.1") return "unknown";
  if (["milestoneRef", "releaseRef", "specRef", "subjectRef"].some((field) => nonEmptyString(artifact?.[field]))) return "release";
  return "unknown";
}

function validateOverallStatus(artifact, options = {}) {
  const scopeErrors = [];
  const statusErrors = [];
  const status = artifact?.status;
  const evidenceLevel = artifact?.evidenceLevel;
  const ceiling = deriveStatusCeiling(artifact?.acceptanceItems, artifact?.specRef || "", options.specText ?? null);
  const scope = acceptanceScope(artifact);
  if (!ACCEPTANCE_STATUSES.has(status)) statusErrors.push(`Unsupported acceptance status: ${status}`);
  if (!EVIDENCE_LEVELS.has(evidenceLevel)) statusErrors.push(`Unsupported evidence level: ${evidenceLevel}`);
  if (artifact?.schemaVersion === "0.5.1" && scope === "unknown") scopeErrors.push("v0.5.1 acceptance requires acceptanceScope.");
  if (scope === "milestone") {
    if (!nonEmptyString(artifact?.milestoneRef)) scopeErrors.push("milestone acceptance requires milestoneRef.");
    if (!nonEmptyString(artifact?.baselineRef)) scopeErrors.push("milestone acceptance requires baselineRef.");
    if (["accepted", "release_ready"].includes(status)) scopeErrors.push("milestone acceptance cannot claim accepted or release_ready.");
  }

  const allowedByCeiling = {
    not_ready: new Set(["in_progress", "not_ready"]),
    code_complete: new Set(["in_progress", "code_complete", "not_ready"]),
    pending_acceptance: new Set(["in_progress", "code_complete", "pending_acceptance", "not_ready"]),
    accepted: new Set(["in_progress", "code_complete", "pending_acceptance", "accepted", "release_ready", "not_ready"])
  };
  if (ACCEPTANCE_STATUSES.has(status) && !allowedByCeiling[ceiling].has(status)) {
    statusErrors.push(`Acceptance status ${status} exceeds item evidence ceiling ${ceiling}.`);
  }
  if (["pending_acceptance", "accepted", "release_ready"].includes(status) && !hasSourceBinding(artifact)) {
    statusErrors.push(`${status} requires an explicit source binding.`);
  }
  if (status === "pending_acceptance" && !new Set(["api", "smoke", "real_e2e", "full_external_review", "partial_external_review"]).has(evidenceLevel)) {
    statusErrors.push("pending_acceptance requires api, smoke, real_e2e, or external review evidence.");
  }
  if (status === "accepted" && !new Set(["smoke", "real_e2e", "full_external_review"]).has(evidenceLevel)) {
    statusErrors.push("accepted requires smoke, real_e2e, or full_external_review evidence.");
  }
  if (["accepted", "release_ready"].includes(status) && !securityReady(artifact?.securityChecklist)) {
    statusErrors.push("accepted/release_ready requires a complete security baseline.");
  }
  if (status === "release_ready" && !new Set(["real_e2e", "full_external_review"]).has(evidenceLevel)) {
    statusErrors.push("release_ready requires real_e2e or full_external_review evidence.");
  }
  statusErrors.push(...pmDecisionErrors(artifact, { specText: options.specText }));
  if (["full_external_review", "partial_external_review"].includes(evidenceLevel) && !nonEmptyString(artifact?.reviewArtifact)) {
    statusErrors.push(`${evidenceLevel} requires an explicit reviewArtifact reference.`);
  }
  return { errors: [...scopeErrors, ...statusErrors], scopeErrors, statusErrors, statusCeiling: ceiling, acceptanceScope: scope };
}

module.exports = {
  ACCEPTANCE_STATUSES,
  EVIDENCE_LEVELS,
  FULFILLMENT_STATUSES,
  VERIFICATION_STATUSES,
  VERIFICATION_OWNERS,
  BLOCKER_EXECUTION_STATUSES,
  EXTERNAL_BLOCKER_DECISIONS,
  PM_DECISION_VERDICTS,
  SECURITY_ITEMS,
  ITEM_FIELDS,
  TASK_FIELDS,
  deriveStatusCeiling,
  externalBlockerState,
  needsExternalBlockerPmDecision,
  acceptanceScope,
  artifactMatchesSubject,
  hasSourceBinding,
  requiresPmDecision,
  requiresGitBaseline,
  pmDecisionErrors,
  parseAcceptanceItems,
  securityReady,
  validateAcceptanceItem,
  validateAcceptanceItems,
  validateOverallStatus
};
