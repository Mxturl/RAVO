"use strict";

const crypto = require("node:crypto");

const SOURCE_RANK = { runtime: 1, project: 2, spec: 3, boundary: 4 };
const BINDING_RANK = { overridable_default: 1, contract_required: 2, confirm_required: 3, prohibited: 4 };
const EXTERNAL_TYPES = new Set(["credential", "permission", "device", "human"]);
const MATERIAL_CHANGE_TYPES = new Set([
  "parameter_change",
  "tool_or_transport_change",
  "scope_narrowing",
  "new_external_state",
  "new_evidence",
  "retryable_transport_after_backoff"
]);
const VOLATILE_KEYS = new Set(["timestamp", "createdAt", "updatedAt", "issuedAt", "derivedAt", "requestId", "attemptId"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const TIMING_FIELDS = [
  "calendarMinutes",
  "agentActiveMinutes",
  "governanceMinutes",
  "reviewMinutes",
  "externalWaitMinutes",
  "pmTouchMinutes"
];

function normalizeTiming(value = {}) {
  const source = isObject(value) ? value : {};
  const timing = {
    startedAt: typeof source.startedAt === "string" ? source.startedAt : "",
    candidateReadyAt: typeof source.candidateReadyAt === "string" && source.candidateReadyAt ? source.candidateReadyAt : null,
    measurementSource: ["runtime", "derived", "unknown"].includes(source.measurementSource) ? source.measurementSource : "unknown"
  };
  for (const field of TIMING_FIELDS) timing[field] = Number.isFinite(source[field]) && source[field] >= 0 ? source[field] : null;
  return timing;
}

function normalizeWorktreeContext(value = {}) {
  const source = isObject(value) ? value : {};
  if (!Object.keys(source).length) return {};
  return {
    ...source,
    baseCommit: typeof source.baseCommit === "string" ? source.baseCommit : "",
    baseBranch: typeof source.baseBranch === "string" ? source.baseBranch : null,
    releaseSlice: typeof source.releaseSlice === "string" ? source.releaseSlice : "",
    taskId: typeof source.taskId === "string" ? source.taskId : "",
    taskBranch: typeof source.taskBranch === "string" ? source.taskBranch : "",
    taskWorktree: typeof source.taskWorktree === "string" ? source.taskWorktree : "",
    integrationBranch: typeof source.integrationBranch === "string" ? source.integrationBranch : "",
    taskOwner: typeof source.taskOwner === "string" && source.taskOwner ? source.taskOwner : typeof source.taskId === "string" ? source.taskId : "",
    integrationOwner: typeof source.integrationOwner === "string" ? source.integrationOwner : "",
    ownership: isObject(source.ownership) ? source.ownership : {},
    ignoredInputs: Array.isArray(source.ignoredInputs) ? source.ignoredInputs.filter(isObject) : [],
    milestones: Array.isArray(source.milestones) ? source.milestones.filter(isObject) : [],
    mergePreflights: Array.isArray(source.mergePreflights) ? source.mergePreflights.filter(isObject) : [],
    integrationPlans: Array.isArray(source.integrationPlans) ? source.integrationPlans.filter(isObject) : []
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort().map((key) => [key, canonical(value[key])]));
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function planFingerprint(plan = {}) {
  return fingerprint({
    actions: plan.actions || (plan.action ? [plan.action] : []),
    targets: plan.targets || (plan.target ? [plan.target] : []),
    accounts: plan.accounts || (plan.account ? [plan.account] : []),
    scope: plan.scope || "",
    dataBoundary: plan.dataBoundary || "",
    parameters: plan.parameters || plan.params || {}
  });
}

function attemptFingerprint(attempt = {}) {
  return fingerprint({
    hypothesis: attempt.hypothesis || "",
    action: attempt.action || attempt.command || "",
    input: attempt.input || attempt.inputs || {},
    environment: attempt.environment || {},
    scope: attempt.scope || ""
  });
}

function includesOrUnscoped(values, value) {
  return !value || !Array.isArray(values) || values.length === 0 || values.includes(value);
}

function evaluateAuthorization(envelope, request = {}, now = new Date().toISOString()) {
  if (!isObject(envelope)) return { valid: false, drift: [], reason: "missing_authorization" };
  if (envelope.status !== "active") return { valid: false, drift: [], reason: envelope.status || "inactive" };
  if (envelope.expiresAt && envelope.expiresAt !== "session_end" && Date.parse(now) > Date.parse(envelope.expiresAt)) {
    return { valid: false, drift: [], reason: "expired" };
  }
  const drift = [];
  if (!includesOrUnscoped(envelope.actions, request.action)) drift.push("action");
  if (!includesOrUnscoped(envelope.targets, request.target)) drift.push("target");
  if (!includesOrUnscoped(envelope.accounts, request.account)) drift.push("account");
  if (request.scope && envelope.scope !== request.scope) drift.push("scope");
  if (request.dataBoundary && envelope.dataBoundary !== request.dataBoundary) drift.push("dataBoundary");
  if (request.planFingerprint && envelope.planFingerprint !== request.planFingerprint) drift.push("planFingerprint");
  return { valid: drift.length === 0, drift, reason: drift.length ? "authorization_drift" : "authorized", envelopeId: envelope.id || "" };
}

function effectiveRules(rules) {
  const superseded = new Set((rules || []).flatMap((rule) => Array.isArray(rule?.supersedes) ? rule.supersedes : []));
  return (rules || []).filter((rule) => isObject(rule) && !superseded.has(rule.id));
}

function modeForBinding(rule, context) {
  if (rule.binding === "prohibited") return { mode: "prohibited", reason: "prohibited_rule" };
  if (rule.binding === "confirm_required") return { mode: "must_confirm", reason: "confirmation_required" };
  if (rule.binding === "contract_required") {
    const refs = Array.isArray(context.contractEvidenceRefs) ? context.contractEvidenceRefs : [];
    return refs.includes(rule.contractRef) ? { mode: "may_proceed", reason: "contract_evidence_present" } : { mode: "must_confirm", reason: "contract_evidence_missing" };
  }
  return rule.deviation ? { mode: "proceed_and_log", reason: "overridable_default_deviation" } : { mode: "may_proceed", reason: "default_applies" };
}

function evaluateRules(rules = [], context = {}) {
  const active = effectiveRules(rules);
  if (!active.length) return { mode: "may_proceed", reason: "no_applicable_rule", rules: [] };
  const highestSource = Math.max(...active.map((rule) => SOURCE_RANK[rule.sourceLevel] || 0));
  const peers = active.filter((rule) => (SOURCE_RANK[rule.sourceLevel] || 0) === highestSource);
  const values = new Set(peers.map((rule) => JSON.stringify(canonical(rule.value))));
  const bindings = new Set(peers.map((rule) => rule.binding));
  if (peers.length > 1 && values.size > 1 && bindings.size === 1) return { mode: "must_confirm", reason: "same_binding_conflict", rules: peers };
  const rule = [...peers].sort((left, right) => (BINDING_RANK[right.binding] || 0) - (BINDING_RANK[left.binding] || 0))[0];
  return { ...modeForBinding(rule, context), rules: peers, effectiveRule: rule };
}

function evaluateAttempt(blocker = {}, attempt = {}, options = {}) {
  const owner = blocker.owner || "main_agent";
  if (EXTERNAL_TYPES.has(blocker.type) || !["main_agent", "subagent"].includes(owner)) {
    return { allowed: false, reason: "external_owner_required", executionStatus: "blocked_external", subagentAllowed: false };
  }
  const value = attemptFingerprint(attempt);
  const prior = Array.isArray(blocker.attempts) ? blocker.attempts : [];
  if (prior.some((item) => (item.fingerprint || attemptFingerprint(item)) === value)) {
    return { allowed: false, reason: "duplicate_attempt", fingerprint: value, used: blocker.attemptBudget?.used || prior.length };
  }
  const budget = blocker.attemptBudget || {};
  const used = Math.max(Number(budget.used || 0), prior.length);
  const nextAttempt = used + 1;
  const defaultLimit = Number(budget.default || 2);
  const hardCeiling = Number(budget.hardCeiling || 4);
  const material = MATERIAL_CHANGE_TYPES.has(attempt.changeType)
    && typeof attempt.normalizedDiff === "string" && attempt.normalizedDiff.trim() && attempt.normalizedDiff !== "none"
    && typeof attempt.expectedInformationGain === "string" && attempt.expectedInformationGain.trim();

  if (nextAttempt === defaultLimit + 1 && !material) {
    return { allowed: false, reason: "standard_extension_requires_new_condition", fingerprint: value, used };
  }
  if (nextAttempt > hardCeiling) {
    const authorization = evaluateAuthorization(options.authorization, options.authorizationRequest || {}, options.now);
    const authorizedCeiling = Number(options.authorization?.authorizedCeilings?.attemptsPerBlocker || 0);
    if (!authorization.valid || authorizedCeiling < nextAttempt) {
      return { allowed: false, reason: "authorization_required_above_hard_ceiling", fingerprint: value, used, authorization };
    }
  }
  return {
    allowed: true,
    reason: nextAttempt > hardCeiling ? "authorized_ceiling" : nextAttempt === hardCeiling ? "hard_ceiling_attempt" : nextAttempt > defaultLimit ? "standard_extension" : "within_default_budget",
    mode: nextAttempt >= hardCeiling ? "proceed_and_log" : "may_proceed",
    fingerprint: value,
    attemptNumber: nextAttempt,
    usedAfter: nextAttempt,
    executionStatus: "attempting",
    subagentAllowed: true
  };
}

function evaluateRecoveryWorkers(input = {}) {
  if (input.nested) return { allowed: false, reason: "nested_recovery_forbidden" };
  const total = Number(input.runningWorkers || 0) + Number(input.requestedWorkers || 0);
  if (total > 2) return { allowed: false, reason: "recovery_worker_limit" };
  return { allowed: true, reason: total > 1 ? "second_isolated_worker" : "within_default_worker_budget", mode: total > 1 ? "proceed_and_log" : "may_proceed" };
}

function evaluateFastTrack(input = {}) {
  const result = (allowed, reason) => ({ allowed, reason, input });
  const development = input.development || {};
  const acceptance = input.acceptance || {};
  if (development.status !== "active" || !development.milestoneRef || development.independent !== true) return result(false, "development_not_independent");
  if (!["in_progress", "pending_acceptance"].includes(acceptance.status) || !acceptance.milestoneRef || !acceptance.baselineRef || !acceptance.acceptanceArtifact || acceptance.automatedChecksPassed !== true) {
    return result(false, "acceptance_baseline_incomplete");
  }
  if (input.contractsStable !== true) return result(false, "serial_required_contract_unknown");
  if (input.environmentIsolated !== true) return result(false, "serial_required_shared_environment");
  const affected = (input.blockingFindings || []).some((finding) => (finding.affectedMilestones || []).includes(development.milestoneRef));
  if (affected) return result(false, "blocking_finding_dependency");
  return result(true, "fast_track_allowed");
}

function legacyBlocker(value, index, recovery) {
  const source = isObject(value) ? value : { title: String(value || "") };
  return {
    id: source.id || `blocker-${index + 1}`,
    title: source.title || source.reason || "Legacy blocker",
    required: source.required !== false,
    type: source.type || "technical",
    owner: source.owner || "main_agent",
    executionStatus: source.executionStatus || "parked",
    affectedMilestones: source.affectedMilestones || [],
    attemptBudget: source.attemptBudget || { default: 2, standardExtension: 1, hardCeiling: 4, used: 0 },
    attempts: source.attempts || [],
    continuationAllowed: source.continuationAllowed !== false,
    executionDecision: source.executionDecision || {
      sourceLevel: "runtime",
      binding: "overridable_default",
      mode: "may_proceed",
      authorizationEnvelopeRef: "",
      reason: "Legacy blocker normalized for compatibility.",
      evidenceRefs: [],
      stopCondition: "Record a current decision before the next attempt."
    },
    temporaryFallback: source.temporaryFallback || "",
    recoveryEntry: source.recoveryEntry || recovery || "Review the legacy blocker and define a recovery entry.",
    resumeConditions: source.resumeConditions || ["new evidence or external condition"],
    subagent: source.subagent || { status: "not_started", outcome: "unresolved", scope: "", evidenceRefs: [] },
    nextStep: source.nextStep || "Continue independent work when possible."
  };
}

function normalizeWorkstream(value = {}) {
  const status = value.status === "complete" ? "closed" : value.status;
  const blockerLedger = Array.isArray(value.blockerLedger)
    ? value.blockerLedger.map((item, index) => legacyBlocker(item, index, value.recovery))
    : (value.blockers || []).map((item, index) => legacyBlocker(item, index, value.recovery));
  return {
    ...value,
    status,
    blockerLedger,
    blockers: blockerLedger.map((blocker) => blocker.title),
    recovery: blockerLedger.find((blocker) => blocker.recoveryEntry)?.recoveryEntry || value.recovery || "",
    executionLanes: value.executionLanes || {
      development: { milestoneRef: value.currentMilestone || "", status: status === "active" ? "active" : "inactive" },
      acceptance: { status: "inactive" },
      recovery: { status: blockerLedger.length ? "parked" : "inactive" }
    },
    executionDecisions: Array.isArray(value.executionDecisions) ? value.executionDecisions : [],
    authorizationEnvelopes: Array.isArray(value.authorizationEnvelopes) ? value.authorizationEnvelopes : [],
    effectiveDeliveryProfile: isObject(value.effectiveDeliveryProfile) ? value.effectiveDeliveryProfile : {},
    timing: normalizeTiming(value.timing),
    capabilityRoutes: Array.isArray(value.capabilityRoutes) ? value.capabilityRoutes.filter(isObject) : [],
    worktreeContext: normalizeWorktreeContext(value.worktreeContext)
  };
}

function validateWorkstream(value) {
  const errors = [];
  if (!isObject(value)) return ["workstream must be an object"];
  for (const field of ["id", "status", "goal", "createdAt", "updatedAt"]) if (!value[field]) errors.push(`${field} is required.`);
  if (value.status === "active" && !value.nextStep) errors.push("active workstream requires nextStep.");
  if (!Array.isArray(value.blockerLedger)) errors.push("blockerLedger must be an array.");
  else value.blockerLedger.forEach((blocker, index) => {
    for (const field of ["id", "title", "type", "owner", "executionStatus", "attemptBudget", "attempts", "continuationAllowed", "executionDecision", "temporaryFallback", "recoveryEntry", "resumeConditions", "subagent", "nextStep"]) {
      if (blocker[field] === undefined || blocker[field] === "") errors.push(`blockerLedger[${index}].${field} is required.`);
    }
    if (blocker.required !== true && blocker.required !== false) errors.push(`blockerLedger[${index}].required must be boolean.`);
    const fingerprints = (blocker.attempts || []).map((attempt) => attempt.fingerprint || attemptFingerprint(attempt));
    if (new Set(fingerprints).size !== fingerprints.length) errors.push(`blockerLedger[${index}] contains duplicate attempts.`);
    if (Number(blocker.attemptBudget?.used || 0) < fingerprints.length) errors.push(`blockerLedger[${index}].attemptBudget.used is lower than recorded attempts.`);
  });
  if (!isObject(value.executionLanes)) errors.push("executionLanes must be an object.");
  else {
    for (const lane of ["development", "acceptance", "recovery"]) if (!isObject(value.executionLanes[lane])) errors.push(`executionLanes.${lane} is required.`);
    if (Array.isArray(value.executionLanes.recovery?.workers) && value.executionLanes.recovery.workers.length > 2) errors.push("executionLanes.recovery exceeds two workers.");
    if (value.executionLanes.recovery?.nested === true) errors.push("nested recovery workers are forbidden.");
  }
  if (!Array.isArray(value.executionDecisions)) errors.push("executionDecisions must be an array.");
  if (!Array.isArray(value.authorizationEnvelopes)) errors.push("authorizationEnvelopes must be an array.");
  else value.authorizationEnvelopes.forEach((envelope, index) => {
    for (const field of ["id", "confirmedBy", "actions", "targets", "accounts", "scope", "dataBoundary", "planFingerprint", "dependentTaskRefs", "authorizedCeilings", "issuedAt", "expiresAt", "sourceRef", "status"]) {
      if (envelope[field] === undefined || envelope[field] === "") errors.push(`authorizationEnvelopes[${index}].${field} is required.`);
    }
    if (Object.values(envelope.authorizedCeilings || {}).some((limit) => limit === "unlimited" || !Number.isFinite(Number(limit)) || Number(limit) < 0)) {
      errors.push(`authorizationEnvelopes[${index}].authorizedCeilings must be finite non-negative numbers.`);
    }
  });
  if (value.effectiveDeliveryProfile !== undefined && !isObject(value.effectiveDeliveryProfile)) errors.push("effectiveDeliveryProfile must be an object.");
  if (value.timing !== undefined) {
    if (!isObject(value.timing)) errors.push("timing must be an object.");
    else {
      if (value.timing.startedAt !== undefined && typeof value.timing.startedAt !== "string") errors.push("timing.startedAt must be a string.");
      if (value.timing.candidateReadyAt !== undefined && value.timing.candidateReadyAt !== null && typeof value.timing.candidateReadyAt !== "string") errors.push("timing.candidateReadyAt must be a string or null.");
      if (value.timing.measurementSource !== undefined && !["runtime", "derived", "unknown"].includes(value.timing.measurementSource)) errors.push("timing.measurementSource is invalid.");
      for (const field of TIMING_FIELDS) if (value.timing[field] !== undefined && value.timing[field] !== null && (!Number.isFinite(value.timing[field]) || value.timing[field] < 0)) errors.push(`timing.${field} must be a non-negative number or null.`);
    }
  }
  if (value.capabilityRoutes !== undefined && (!Array.isArray(value.capabilityRoutes) || value.capabilityRoutes.some((route) => !isObject(route)))) errors.push("capabilityRoutes must be an array of objects.");
  if (value.worktreeContext !== undefined) {
    if (!isObject(value.worktreeContext)) errors.push("worktreeContext must be an object.");
    else if (Object.keys(value.worktreeContext).length) {
      for (const field of ["baseCommit", "releaseSlice", "taskId", "taskBranch", "taskWorktree", "taskOwner", "integrationBranch", "integrationOwner"]) {
        if (typeof value.worktreeContext[field] !== "string" || !value.worktreeContext[field]) errors.push(`worktreeContext.${field} is required.`);
      }
      if (!isObject(value.worktreeContext.ownership)) errors.push("worktreeContext.ownership must be an object.");
      if (!Array.isArray(value.worktreeContext.milestones)) errors.push("worktreeContext.milestones must be an array.");
    }
  }
  return errors;
}

module.exports = {
  attemptFingerprint,
  evaluateAttempt,
  evaluateAuthorization,
  evaluateFastTrack,
  evaluateRecoveryWorkers,
  evaluateRules,
  normalizeTiming,
  normalizeWorktreeContext,
  normalizeWorkstream,
  planFingerprint,
  validateWorkstream
};
