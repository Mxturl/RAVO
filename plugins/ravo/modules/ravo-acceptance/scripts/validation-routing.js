"use strict";

const crypto = require("node:crypto");

const CAPABILITY_RULES = {
  logic: { channels: ["script"], evidence: "deterministic script or unit/contract check" },
  service_contract: { channels: ["script"], evidence: "isolated service contract check" },
  ui_navigation: { channels: ["simulator"], evidence: "interactive Simulator click, navigation, text wait, and assertion" },
  native_capability: { channels: ["device"], evidence: "real-device validation" },
  ipa_runtime: { channels: ["device"], evidence: "real IPA installation and runtime validation" },
  real_photo_ai: { channels: ["script", "device"], evidence: "isolated real-AI service check and real-device select-submit-result validation" },
  manual_judgment: { channels: ["pm_manual"], evidence: "PM action or product judgment" }
};
const CHANNEL_ORDER = ["script", "simulator", "device", "pm_manual"];
const WINDOW_DEFAULTS = {
  short_special: { deviceMinutes: { min: 5, max: 10 }, pmMinutes: { min: 2, max: 5 } },
  standard_batch: { deviceMinutes: { min: 20, max: 25 }, pmMinutes: { min: 2, max: 5 } },
  full_candidate: { deviceMinutes: { min: 35, max: 45 }, pmMinutes: { min: 2, max: 5 } }
};
const REQUEST_STATUSES = new Set(["requested", "pending_external", "resolved", "cancelled"]);
const SENSITIVE_KEY = /(?:api[_-]?key|password|token|authorization|credential|secret|udid|photo|image|log|command)/i;
const SENSITIVE_TEXT = /(?:api[_ -]?key|password|bearer|authorization|secret|token|\budid\b|\/users\/|\/home\/)/i;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REFERENCE = /^\+?\d(?:[\s().-]*\d){6,}$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function stringArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${label} must be a ${allowEmpty ? "string" : "non-empty string"} array.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function isoTime(value, label) {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp.`);
  return text;
}

function duration(value, fallback, label) {
  const source = value === undefined ? fallback : value;
  if (!isObject(source) || !Number.isFinite(source.min) || !Number.isFinite(source.max) || source.min < 0 || source.max < source.min) {
    throw new TypeError(`${label} must contain non-negative min and max values.`);
  }
  return { min: source.min, max: source.max };
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

function assertNoSensitiveKeys(value, label = "request") {
  if (!isObject(value) && !Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new TypeError(`${label}.${key} is not allowed.`);
    assertNoSensitiveKeys(child, `${label}.${key}`);
  }
}

function safeText(value, label) {
  const text = requiredString(value, label);
  if (SENSITIVE_TEXT.test(text)) throw new TypeError(`${label} contains sensitive or local-path content.`);
  return text;
}

function safeStringArray(value, label, allowEmpty = false) {
  return stringArray(value, label, allowEmpty).map((item) => safeText(item, label));
}

function subjectReference(value) {
  const text = requiredString(value, "subjectRef");
  if (text.startsWith("/") || text.includes("..") || text.includes("\\")) throw new TypeError("subjectRef must be a stable non-path reference.");
  return text;
}

function opaqueRecipientReference(value) {
  const text = safeText(value, "recipientRef");
  if (EMAIL_ADDRESS.test(text) || PHONE_REFERENCE.test(text)) throw new TypeError("recipientRef must be an opaque non-contact reference.");
  return text;
}

function normalizeCapabilities(value) {
  const capabilities = stringArray(value, "capabilities");
  for (const capability of capabilities) if (!CAPABILITY_RULES[capability]) throw new RangeError(`Unsupported capability: ${capability}`);
  return capabilities;
}

function createValidationPlan(input = {}) {
  if (!isObject(input)) throw new TypeError("validation plan input must be an object.");
  const capabilities = normalizeCapabilities(input.capabilities);
  if (input.simulatorInteractionVerified !== undefined && typeof input.simulatorInteractionVerified !== "boolean") {
    throw new TypeError("simulatorInteractionVerified must be boolean.");
  }
  const verifiedDeviceCapabilities = input.verifiedDeviceCapabilities === undefined
    ? []
    : normalizeCapabilities(input.verifiedDeviceCapabilities);
  for (const capability of verifiedDeviceCapabilities) {
    if (!capabilities.includes(capability) || !CAPABILITY_RULES[capability].channels.includes("device")) {
      throw new TypeError("verifiedDeviceCapabilities must contain requested device capabilities.");
    }
  }
  const simulatorInteractionVerified = input.simulatorInteractionVerified === true;
  const channels = new Set();
  const reasons = {};
  const evidenceRequirements = new Set();
  const uncoveredCapabilities = [];
  const remainingDeviceGate = [];

  for (const capability of capabilities) {
    const rule = CAPABILITY_RULES[capability];
    for (const channel of rule.channels) {
      channels.add(channel);
      reasons[channel] = reasons[channel] || [];
      reasons[channel].push(capability);
    }
    evidenceRequirements.add(rule.evidence);
    if (capability === "ui_navigation" && !simulatorInteractionVerified) uncoveredCapabilities.push(capability);
    if (rule.channels.includes("device") && !verifiedDeviceCapabilities.includes(capability)) {
      remainingDeviceGate.push(capability);
      uncoveredCapabilities.push(capability);
    }
  }

  return {
    capabilities,
    channels: CHANNEL_ORDER.filter((channel) => channels.has(channel)),
    reasons,
    uncoveredCapabilities: [...new Set(uncoveredCapabilities)],
    remainingDeviceGate,
    evidenceRequirements: [...evidenceRequirements]
  };
}

function createDeviceWindow(input = {}) {
  if (!isObject(input)) throw new TypeError("device window input must be an object.");
  const className = requiredString(input.class, "class");
  const defaults = WINDOW_DEFAULTS[className];
  if (!defaults) throw new RangeError(`Unsupported device window class: ${className}`);
  return {
    class: className,
    subjectRef: subjectReference(input.subjectRef),
    scope: safeStringArray(input.scope, "scope").sort(),
    expectedDeviceMinutes: duration(input.expectedDeviceMinutes, defaults.deviceMinutes, "expectedDeviceMinutes"),
    expectedPmMinutes: duration(input.expectedPmMinutes, defaults.pmMinutes, "expectedPmMinutes"),
    userActions: safeStringArray(input.userActions, "userActions"),
    notCovered: safeStringArray(input.notCovered || [], "notCovered", true),
    stopCondition: safeText(input.stopCondition, "stopCondition")
  };
}

function normalizeBlocker(value) {
  if (!isObject(value)) throw new TypeError("blocker must be an object.");
  return {
    blockingReason: safeText(value.blockingReason, "blocker.blockingReason"),
    blockerImpact: safeText(value.blockerImpact, "blocker.blockerImpact"),
    temporaryFallback: safeText(value.temporaryFallback, "blocker.temporaryFallback"),
    recoveryEntry: safeText(value.recoveryEntry, "blocker.recoveryEntry")
  };
}

function createHumanInterventionRequest(input = {}) {
  if (!isObject(input)) throw new TypeError("human intervention request must be an object.");
  assertNoSensitiveKeys(input);
  const kind = requiredString(input.kind || "device_window", "kind");
  if (kind !== "device_window") throw new RangeError("Only device_window is supported.");
  const status = requiredString(input.status || "requested", "status");
  if (!REQUEST_STATUSES.has(status)) throw new RangeError(`Unsupported request status: ${status}`);
  const window = createDeviceWindow(input.window);
  const subjectRef = subjectReference(input.subjectRef || window.subjectRef);
  if (subjectRef !== window.subjectRef) throw new TypeError("subjectRef must match window.subjectRef.");
  const recipientRef = opaqueRecipientReference(input.recipientRef);
  const safeSummary = safeText(input.safeSummary, "safeSummary");
  const unresolvedState = ["requested", "pending_external"].includes(status) ? "unresolved" : status;
  const dedupeKey = `hir-${digest({ kind, subjectRef, recipientRef, class: window.class, scope: window.scope, state: unresolvedState })}`;
  if (input.id !== undefined && safeText(input.id, "id") !== dedupeKey) {
    throw new TypeError("id must equal the stable dedupeKey for this request.");
  }
  const now = isoTime(input.now || new Date().toISOString(), "now");
  const request = {
    id: dedupeKey,
    kind,
    subjectRef,
    recipientRef,
    status,
    safeSummary,
    window,
    notCovered: window.notCovered,
    stopCondition: window.stopCondition,
    dedupeKey,
    createdAt: input.createdAt ? isoTime(input.createdAt, "createdAt") : now,
    updatedAt: now
  };
  if (status === "pending_external") request.blocker = normalizeBlocker(input.blocker);
  else if (input.blocker !== undefined) throw new TypeError("blocker is only valid for pending_external.");
  return request;
}

function evaluateParallelDevelopment(input = {}) {
  if (!isObject(input)) throw new TypeError("parallel development input must be an object.");
  const checks = [
    ["candidateBaselineFrozen", "candidate_baseline_not_frozen"],
    ["automatedChecksPassed", "acceptance_baseline_incomplete"],
    ["nextMilestoneIndependent", "development_not_independent"],
    ["contractsStable", "serial_required_contract_unknown"],
    ["environmentIsolated", "serial_required_shared_environment"]
  ];
  for (const [field, reason] of checks) if (input[field] !== true) return { allowed: false, reason };
  if (input.blockingFindingAffectsNext === true) return { allowed: false, reason: "blocking_finding_dependency" };
  if (input.blockingFindingAffectsNext !== false) throw new TypeError("blockingFindingAffectsNext must be boolean.");
  return { allowed: true, reason: "parallel_development_allowed" };
}

module.exports = {
  CAPABILITY_RULES,
  WINDOW_DEFAULTS,
  createDeviceWindow,
  createHumanInterventionRequest,
  createValidationPlan,
  evaluateParallelDevelopment
};
