#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROFILE_ORDER = Object.freeze({ rapid: 1, balanced: 2, strict: 3 });
const PROFILE_DEFAULTS = Object.freeze({
  rapid: Object.freeze({
    wallClockBudgetMinutes: 240,
    governanceBudgetMinutes: 20,
    reviewRunBudget: 0,
    evidencePassBudget: 1,
    subagentSpawnBudget: 2,
    blockerAttemptBudget: 2,
    modelEscalationBudget: 1,
    pmWaitBudgetMinutes: 0,
    reviewPolicy: "risk_only",
    evidencePolicy: "spec_minimum",
    subagentPolicy: "time_saving_only"
  }),
  balanced: Object.freeze({
    wallClockBudgetMinutes: 480,
    governanceBudgetMinutes: 45,
    reviewRunBudget: 1,
    evidencePassBudget: 2,
    subagentSpawnBudget: 2,
    blockerAttemptBudget: 2,
    modelEscalationBudget: 1,
    pmWaitBudgetMinutes: 0,
    reviewPolicy: "risk_or_spec",
    evidencePolicy: "targeted",
    subagentPolicy: "time_saving_only"
  }),
  strict: Object.freeze({
    wallClockBudgetMinutes: 1440,
    governanceBudgetMinutes: 120,
    reviewRunBudget: 1,
    evidencePassBudget: 2,
    subagentSpawnBudget: 2,
    blockerAttemptBudget: 3,
    modelEscalationBudget: 1,
    pmWaitBudgetMinutes: 0,
    reviewPolicy: "spec_required",
    evidencePolicy: "spec_required",
    subagentPolicy: "time_saving_only"
  })
});

const DEFAULT_TIERS = Object.freeze([
  Object.freeze({ id: "economy", model: "gpt-5.6-luna", reasoningEffort: "medium" }),
  Object.freeze({ id: "standard", model: "gpt-5.6-terra", reasoningEffort: "medium" }),
  Object.freeze({ id: "advanced", model: "gpt-5.6-sol", reasoningEffort: "high" })
]);

const DEFAULT_TASK_ROUTES = Object.freeze([
  Object.freeze({ taskClass: "retrieval", tier: "economy" }),
  Object.freeze({ taskClass: "summarization", tier: "economy" }),
  Object.freeze({ taskClass: "routine_test", tier: "economy" }),
  Object.freeze({ taskClass: "mechanical_edit", tier: "economy" }),
  Object.freeze({ taskClass: "cross_module_implementation", tier: "standard" })
]);

const TASK_CLASSES = new Set([
  "retrieval",
  "summarization",
  "routine_test",
  "mechanical_edit",
  "cross_module_implementation",
  "architecture",
  "security",
  "release_decision",
  "acceptance_judgment",
  "general"
]);

const PROTECTED_TASK_CLASSES = new Set(["architecture", "security", "release_decision", "acceptance_judgment"]);
const BUDGET_FIELDS = Object.freeze([
  "wallClockBudgetMinutes",
  "governanceBudgetMinutes",
  "reviewRunBudget",
  "evidencePassBudget",
  "subagentSpawnBudget",
  "blockerAttemptBudget",
  "modelEscalationBudget"
]);
const RUNTIME_CAPABILITIES = new Set(["explicit_model_and_reasoning", "reasoning_only", "none"]);
const TIER_ID = /^[a-z][a-z0-9_-]{0,63}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return {}; }
}

function merge(base, override) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isObject(value) && isObject(out[key]) ? merge(out[key], value) : clone(value);
  }
  return out;
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validProfile(value) {
  return typeof value === "string" && Object.hasOwn(PROFILE_DEFAULTS, value);
}

function validIntegerOrNull(value, minimum = 0, maximum = 10080) {
  return value === null || (Number.isInteger(value) && value >= minimum && value <= maximum);
}

function normalizedTiers(config) {
  const tiers = Array.isArray(config?.capabilityRouting?.tiers) ? config.capabilityRouting.tiers : DEFAULT_TIERS;
  return tiers.map((tier) => ({
    id: String(tier?.id || "").trim(),
    model: String(tier?.model || "").trim(),
    reasoningEffort: String(tier?.reasoningEffort || "").trim()
  }));
}

function normalizedTaskRoutes(config) {
  const routes = Array.isArray(config?.capabilityRouting?.taskRoutes) ? config.capabilityRouting.taskRoutes : DEFAULT_TASK_ROUTES;
  return routes.map((route) => ({
    taskClass: String(route?.taskClass || "").trim(),
    tier: String(route?.tier || "").trim()
  }));
}

function validateDeliveryConfig(config = {}) {
  const errors = [];
  const add = (path, message) => errors.push({ path, code: "invalid_delivery_profile", message });
  if (!isObject(config)) return { valid: false, errors: [{ path: "config", code: "invalid_delivery_profile", message: "must be an object" }] };
  if (config.deliveryProfile !== undefined && !validProfile(config.deliveryProfile)) add("deliveryProfile", "must be rapid, balanced, or strict");
  if (config.execution !== undefined && !isObject(config.execution)) add("execution", "must be an object");
  for (const field of BUDGET_FIELDS) {
    const value = config.execution?.[field];
    if (value !== undefined && !validIntegerOrNull(value)) add(`execution.${field}`, "must be null or an integer from 0 to 10080");
  }
  if (config.capabilityRouting !== undefined && !isObject(config.capabilityRouting)) add("capabilityRouting", "must be an object");
  if (config.capabilityRouting?.enabled !== undefined && typeof config.capabilityRouting.enabled !== "boolean") add("capabilityRouting.enabled", "must be a boolean");

  const tiers = normalizedTiers(config);
  const tierIds = new Set();
  if (!tiers.length || tiers.length > 12) add("capabilityRouting.tiers", "must contain 1 to 12 tiers");
  for (const [index, tier] of tiers.entries()) {
    if (!TIER_ID.test(tier.id)) add(`capabilityRouting.tiers[${index}].id`, "must use a lowercase stable identifier");
    if (tierIds.has(tier.id)) add(`capabilityRouting.tiers[${index}].id`, "must be unique");
    tierIds.add(tier.id);
    if (tier.model.length > 160) add(`capabilityRouting.tiers[${index}].model`, "must be at most 160 characters");
    if (tier.reasoningEffort.length > 40) add(`capabilityRouting.tiers[${index}].reasoningEffort`, "must be at most 40 characters");
  }

  const routes = normalizedTaskRoutes(config);
  if (routes.length > 24) add("capabilityRouting.taskRoutes", "must contain at most 24 routes");
  const routedClasses = new Set();
  for (const [index, route] of routes.entries()) {
    if (!TASK_CLASSES.has(route.taskClass)) add(`capabilityRouting.taskRoutes[${index}].taskClass`, "must use a supported task class");
    if (routedClasses.has(route.taskClass)) add(`capabilityRouting.taskRoutes[${index}].taskClass`, "must be unique");
    routedClasses.add(route.taskClass);
    if (!tierIds.has(route.tier)) add(`capabilityRouting.taskRoutes[${index}].tier`, "must reference a declared tier");
  }
  return { valid: errors.length === 0, errors };
}

function normalizeProfile(profile) {
  return validProfile(profile) ? profile : "rapid";
}

function profileRank(profile) {
  return PROFILE_ORDER[normalizeProfile(profile)];
}

function effectiveProfileName(config = {}, options = {}) {
  const requested = normalizeProfile(options.profile || config.deliveryProfile);
  const minimum = normalizeProfile(options.minimumProfile || "rapid");
  const profile = profileRank(minimum) > profileRank(requested) ? minimum : requested;
  const reasons = [];
  if (profile !== requested) reasons.push(`minimum_profile_${minimum}`);
  if (options.reason) reasons.push(String(options.reason));
  return {
    profile,
    profileSource: options.profile ? (options.profileSource || "spec") : options.profileSource || (config.deliveryProfile ? "config" : "default"),
    reasons
  };
}

function effectiveBudgets(config, profile) {
  const defaults = PROFILE_DEFAULTS[profile];
  const budgets = {};
  for (const field of BUDGET_FIELDS) {
    const override = config?.execution?.[field];
    budgets[field] = Number.isInteger(override) ? override : defaults[field];
  }
  budgets.pmWaitBudgetMinutes = defaults.pmWaitBudgetMinutes;
  return budgets;
}

function toIso(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function resolveDeliveryProfile(config = {}, options = {}) {
  const normalized = effectiveProfileName(config, options);
  const profile = normalized.profile;
  const startedAt = toIso(options.startedAt) || new Date().toISOString();
  const deadlineAt = new Date(Date.parse(startedAt) + effectiveBudgets(config, profile).wallClockBudgetMinutes * 60000).toISOString();
  return {
    schemaVersion: "0.5.4",
    profile,
    profileSource: normalized.profileSource,
    budgets: effectiveBudgets(config, profile),
    policies: {
      review: PROFILE_DEFAULTS[profile].reviewPolicy,
      evidence: PROFILE_DEFAULTS[profile].evidencePolicy,
      subagent: PROFILE_DEFAULTS[profile].subagentPolicy
    },
    reasons: normalized.reasons,
    startedAt,
    deadlineAt
  };
}

function resolveCapabilityRoute(config = {}, taskClass = "general", options = {}) {
  const normalizedTaskClass = TASK_CLASSES.has(taskClass) ? taskClass : "general";
  const resolvedProfile = options.profile && options.profile.budgets ? options.profile : resolveDeliveryProfile(config, options);
  const capabilityRouting = isObject(config.capabilityRouting) ? config.capabilityRouting : {};
  const enabled = capabilityRouting.enabled !== false;
  const tiers = normalizedTiers(config);
  const routes = normalizedTaskRoutes(config);
  const route = routes.find((item) => item.taskClass === normalizedTaskClass);
  const requestedTier = PROTECTED_TASK_CLASSES.has(normalizedTaskClass) ? "advanced" : route?.tier || "standard";
  const tier = tiers.find((item) => item.id === requestedTier) || tiers.find((item) => item.id === "standard") || tiers[0] || { id: "", model: "", reasoningEffort: "" };
  const runtimeCapability = RUNTIME_CAPABILITIES.has(options.runtimeCapability) ? options.runtimeCapability : "none";
  const escalationUsed = Number.isInteger(options.escalationUsed) && options.escalationUsed >= 0 ? options.escalationUsed : 0;
  const enforcement = !enabled ? "unavailable" : runtimeCapability === "explicit_model_and_reasoning" && tier.model && tier.reasoningEffort
    ? "applied"
    : "advisory_only";
  return {
    taskClass: normalizedTaskClass,
    tier: tier.id,
    model: tier.model,
    reasoningEffort: tier.reasoningEffort,
    enforcement,
    runtimeCapability,
    escalationUsed,
    escalationBudget: resolvedProfile.budgets.modelEscalationBudget,
    canEscalate: escalationUsed < resolvedProfile.budgets.modelEscalationBudget,
    requiresMainAgent: PROTECTED_TASK_CLASSES.has(normalizedTaskClass),
    reason: PROTECTED_TASK_CLASSES.has(normalizedTaskClass)
      ? "protected_task_class"
      : route ? "configured_task_route" : "default_standard_route"
  };
}

function optionalWorkDecision(profile, options = {}) {
  const timebox = timeboxState(profile, options.now);
  if (timebox.reached) return { allowed: false, reason: "wall_clock_budget_reached", timebox };
  return { allowed: true, reason: "within_wall_clock_budget", timebox };
}

function optionalReviewDecision(profile, options = {}) {
  if (options.required === true) return { allowed: true, reason: "required_by_spec_or_risk", optional: false };
  const timebox = optionalWorkDecision(profile, options);
  if (!timebox.allowed) return { ...timebox, optional: true };
  const used = Number.isInteger(options.used) && options.used >= 0 ? options.used : 0;
  if (used >= Number(profile?.budgets?.reviewRunBudget || 0)) return { allowed: false, reason: "optional_review_budget_exhausted", optional: true };
  return { allowed: true, reason: "optional_review_budget_available", optional: true };
}

function escalateCapabilityRoute(config = {}, route = {}, options = {}) {
  if (!route || route.requiresMainAgent) return { allowed: false, reason: "protected_task_class", route };
  if (route.canEscalate !== true) return { allowed: false, reason: "model_escalation_budget_exhausted", route };
  if (typeof options.evidence !== "string" || !options.evidence.trim()) return { allowed: false, reason: "failure_or_risk_evidence_required", route };
  const tiers = normalizedTiers(config);
  const index = tiers.findIndex((tier) => tier.id === route.tier);
  const nextTier = index >= 0 ? tiers[index + 1] : null;
  if (!nextTier) return { allowed: false, reason: "no_higher_capability_tier", route };
  const runtimeCapability = RUNTIME_CAPABILITIES.has(options.runtimeCapability) ? options.runtimeCapability : route.runtimeCapability || "none";
  const enforcement = runtimeCapability === "explicit_model_and_reasoning" && nextTier.model && nextTier.reasoningEffort ? "applied" : "advisory_only";
  const escalationUsed = (Number(route.escalationUsed) || 0) + 1;
  return {
    allowed: true,
    reason: "failure_or_risk_escalation",
    route: {
      ...route,
      tier: nextTier.id,
      model: nextTier.model,
      reasoningEffort: nextTier.reasoningEffort,
      enforcement,
      runtimeCapability,
      escalationUsed,
      canEscalate: escalationUsed < Number(route.escalationBudget || 0),
      reason: "failure_or_risk_escalation"
    }
  };
}

function shouldStartSubagent(profile, route, options = {}) {
  if (!profile || profile.policies?.subagent !== "time_saving_only") return { allowed: false, reason: "profile_disallows_subagent" };
  const optionalWork = optionalWorkDecision(profile, options);
  if (!optionalWork.allowed) return { allowed: false, reason: optionalWork.reason };
  if (route?.requiresMainAgent) return { allowed: false, reason: "protected_task_class" };
  if (route?.enforcement === "unavailable") return { allowed: false, reason: "route_unavailable" };
  if (route?.enforcement === "advisory_only" && options.allowAdvisorySubagent !== true) return { allowed: false, reason: "route_advisory_only" };
  if (options.scopeClear !== true) return { allowed: false, reason: "scope_not_clear" };
  if (options.isolatedState !== true) return { allowed: false, reason: "shared_state_not_isolated" };
  if (options.expectedTimeSaving !== true) return { allowed: false, reason: "time_saving_not_established" };
  if (Number(options.spawned || 0) >= profile.budgets.subagentSpawnBudget) return { allowed: false, reason: "subagent_budget_exhausted" };
  return { allowed: true, reason: "bounded_time_saving_task" };
}

function timeboxState(profile, now = new Date().toISOString()) {
  const deadline = Date.parse(profile?.deadlineAt || "");
  const current = now instanceof Date ? now.getTime() : Date.parse(now || "");
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return { reached: false, remainingMinutes: null };
  return {
    reached: current >= deadline,
    remainingMinutes: Math.max(0, Math.ceil((deadline - current) / 60000))
  };
}

function readDeliveryConfig(workspace, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const root = path.resolve(workspace || process.cwd());
  const userPath = path.join(home, ".codex", "skill-config", "ravo.json");
  const workspacePath = path.join(root, "knowledge", ".ravo", "config.json");
  const user = readJson(userPath);
  const workspaceConfig = readJson(workspacePath);
  const profileSource = Object.hasOwn(workspaceConfig, "deliveryProfile")
    ? "workspace"
    : Object.hasOwn(user, "deliveryProfile") ? "user" : "default";
  return {
    config: merge(merge({}, user), workspaceConfig),
    profileSource,
    paths: { userPath, workspacePath }
  };
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const state = readDeliveryConfig(workspace, { home: argValue("--home", "") || undefined });
  const profile = resolveDeliveryProfile(state.config, {
    profile: argValue("--profile", ""),
    profileSource: argValue("--profile-source", state.profileSource),
    minimumProfile: argValue("--minimum-profile", ""),
    reason: argValue("--reason", ""),
    startedAt: argValue("--started-at", "")
  });
  const taskClass = argValue("--task-class", "");
  const route = taskClass ? resolveCapabilityRoute(state.config, taskClass, {
    profile,
    runtimeCapability: argValue("--runtime-capability", "none"),
    escalationUsed: Number(argValue("--escalation-used", "0"))
  }) : null;
  console.log(JSON.stringify({
    status: "ok",
    workspace,
    configPaths: state.paths,
    effectiveProfile: profile,
    route,
    timebox: timeboxState(profile, argValue("--now", "") || new Date().toISOString())
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  BUDGET_FIELDS,
  DEFAULT_TASK_ROUTES,
  DEFAULT_TIERS,
  PROFILE_DEFAULTS,
  TASK_CLASSES,
  effectiveProfileName,
  escalateCapabilityRoute,
  optionalReviewDecision,
  optionalWorkDecision,
  resolveCapabilityRoute,
  resolveDeliveryProfile,
  readDeliveryConfig,
  shouldStartSubagent,
  timeboxState,
  validateDeliveryConfig
};
