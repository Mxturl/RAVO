#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  createDeviceWindow,
  createHumanInterventionRequest,
  createValidationPlan,
  evaluateParallelDevelopment
} = require("../plugins/ravo/modules/ravo-acceptance/scripts/validation-routing");

const uiWithoutDriver = createValidationPlan({ capabilities: ["ui_navigation"] });
assert.deepEqual(uiWithoutDriver.channels, ["simulator"]);
assert.deepEqual(uiWithoutDriver.uncoveredCapabilities, ["ui_navigation"]);
assert.deepEqual(createValidationPlan({
  capabilities: ["ui_navigation"],
  simulatorInteractionVerified: true
}).uncoveredCapabilities, []);
assert.deepEqual(createValidationPlan({ capabilities: ["service_contract"] }).channels, ["script"]);
assert.deepEqual(createValidationPlan({ capabilities: ["ipa_runtime"] }).channels, ["device"]);

const combined = createValidationPlan({
  capabilities: ["logic", "native_capability", "real_photo_ai", "manual_judgment"],
  verifiedDeviceCapabilities: ["native_capability"]
});
assert.deepEqual(combined.channels, ["script", "device", "pm_manual"]);
assert.deepEqual(combined.remainingDeviceGate, ["real_photo_ai"]);
assert.deepEqual(combined.uncoveredCapabilities, ["real_photo_ai"]);
assert.throws(() => createValidationPlan({
  capabilities: ["logic"],
  verifiedDeviceCapabilities: ["logic"]
}), /requested device capabilities/);

const shortWindow = createDeviceWindow({
  class: "short_special",
  subjectRef: "ravo-v0.5.9/M1",
  scope: ["camera permission"],
  userActions: ["unlock and connect device"],
  notCovered: ["full candidate regression"],
  stopCondition: "camera hypothesis has a pass or failure result"
});
assert.deepEqual(shortWindow.expectedDeviceMinutes, { min: 5, max: 10 });
assert.deepEqual(shortWindow.expectedPmMinutes, { min: 2, max: 5 });

const standardWindow = createDeviceWindow({
  class: "standard_batch",
  subjectRef: "ravo-v0.5.9/M1",
  scope: ["navigation and permissions"],
  userActions: ["unlock and connect device"],
  notCovered: [],
  stopCondition: "requested paths complete"
});
assert.deepEqual(standardWindow.expectedDeviceMinutes, { min: 20, max: 25 });
assert.deepEqual(standardWindow.expectedPmMinutes, { min: 2, max: 5 });

const fullWindow = createDeviceWindow({
  class: "full_candidate",
  subjectRef: "ravo-v0.5.9/M1",
  scope: ["IPA and real AI"],
  userActions: ["unlock and confirm system prompts"],
  notCovered: [],
  stopCondition: "candidate regression completes"
});
assert.deepEqual(fullWindow.expectedDeviceMinutes, { min: 35, max: 45 });
assert.deepEqual(fullWindow.expectedPmMinutes, { min: 2, max: 5 });
assert.throws(() => createDeviceWindow({
  class: "short_special",
  subjectRef: "ravo-v0.5.9/M1",
  scope: ["camera permission"],
  userActions: ["unlock and connect device"]
}), /stopCondition/);

const requestInput = {
  kind: "device_window",
  subjectRef: "ravo-v0.5.9/M1",
  recipientRef: "pm:primary",
  status: "pending_external",
  safeSummary: "Camera permission check needs one short device window.",
  window: shortWindow,
  blocker: {
    blockingReason: "device is not connected",
    blockerImpact: "camera validation remains unverified",
    temporaryFallback: "run simulator and script checks",
    recoveryEntry: "schedule the next short device window"
  },
  now: "2026-07-15T12:00:00.000Z"
};
const pending = createHumanInterventionRequest(requestInput);
const duplicate = createHumanInterventionRequest(requestInput);
assert.equal(pending.id, duplicate.id);
assert.equal(pending.dedupeKey, duplicate.dedupeKey);
assert.throws(() => createHumanInterventionRequest({
  ...requestInput,
  blocker: { ...requestInput.blocker, recoveryEntry: "" }
}), /recoveryEntry/);
const reorderedScope = createHumanInterventionRequest({
  ...requestInput,
  window: { ...shortWindow, scope: ["camera permission", "camera runtime"] }
});
const reorderedDuplicate = createHumanInterventionRequest({
  ...requestInput,
  window: { ...shortWindow, scope: ["camera runtime", "camera permission"] }
});
assert.equal(reorderedScope.id, reorderedDuplicate.id);
assert.throws(() => createHumanInterventionRequest({ ...requestInput, id: "request-123" }), /stable dedupeKey/);
assert.throws(() => createHumanInterventionRequest({ ...requestInput, kind: "permission" }), /Only device_window/);
assert.throws(() => createHumanInterventionRequest({ ...requestInput, recipientRef: "pm@example.com" }), /opaque non-contact/);
assert.throws(() => createHumanInterventionRequest({ ...requestInput, recipientRef: "+86 138 1234 5678" }), /opaque non-contact/);
assert.throws(() => createHumanInterventionRequest({ ...requestInput, token: "secret" }), /not allowed/);
const privateScope = path.join(path.sep, "Users", "example", "private");
assert.throws(() => createHumanInterventionRequest({
  ...requestInput,
  window: { ...shortWindow, scope: [privateScope] }
}), /sensitive or local-path/);

const parallelInput = {
  candidateBaselineFrozen: true,
  automatedChecksPassed: true,
  nextMilestoneIndependent: true,
  contractsStable: true,
  environmentIsolated: true,
  blockingFindingAffectsNext: false
};
assert.deepEqual(evaluateParallelDevelopment(parallelInput), { allowed: true, reason: "parallel_development_allowed" });
for (const field of ["candidateBaselineFrozen", "automatedChecksPassed", "nextMilestoneIndependent", "contractsStable", "environmentIsolated"]) {
  assert.equal(evaluateParallelDevelopment({ ...parallelInput, [field]: false }).allowed, false);
}
assert.equal(evaluateParallelDevelopment({ ...parallelInput, blockingFindingAffectsNext: true }).allowed, false);
assert.equal(evaluateParallelDevelopment({
  ...parallelInput,
  contractsStable: false,
}).reason, "serial_required_contract_unknown");

console.log(JSON.stringify({ status: "pass", checks: ["V1", "V2", "V3", "V4", "V5", "V6", "V7"] }));
