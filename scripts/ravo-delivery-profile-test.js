#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  escalateCapabilityRoute,
  optionalReviewDecision,
  resolveCapabilityRoute,
  resolveDeliveryProfile,
  shouldStartSubagent,
  timeboxState,
  validateDeliveryConfig
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-delivery-profile");

const rapid = resolveDeliveryProfile({}, { startedAt: "2026-07-14T00:00:00.000Z" });
assert.equal(rapid.profile, "rapid");
assert.equal(Object.hasOwn(rapid, "audience"), false);
assert.equal(Object.hasOwn(rapid, "technicalDetailLevel"), false);
assert.equal(rapid.budgets.wallClockBudgetMinutes, 240);
assert.equal(rapid.deadlineAt, "2026-07-14T04:00:00.000Z");

const elevated = resolveDeliveryProfile({ deliveryProfile: "rapid" }, { minimumProfile: "strict", reason: "security_boundary" });
assert.equal(elevated.profile, "strict");
assert.ok(elevated.reasons.includes("minimum_profile_strict"));

const config = {
  capabilityRouting: {
    enabled: true,
    tiers: [
      { id: "economy", model: "luna", reasoningEffort: "medium" },
      { id: "standard", model: "terra", reasoningEffort: "medium" },
      { id: "advanced", model: "sol", reasoningEffort: "high" }
    ],
    taskRoutes: [{ taskClass: "routine_test", tier: "economy" }]
  }
};
const applied = resolveCapabilityRoute(config, "routine_test", { runtimeCapability: "explicit_model_and_reasoning" });
assert.equal(applied.tier, "economy");
assert.equal(applied.enforcement, "applied");
assert.equal(applied.model, "luna");
const advisory = resolveCapabilityRoute(config, "routine_test", { runtimeCapability: "none" });
assert.equal(advisory.enforcement, "advisory_only");
assert.equal(resolveCapabilityRoute(config, "security", { runtimeCapability: "explicit_model_and_reasoning" }).requiresMainAgent, true);

assert.deepEqual(shouldStartSubagent(rapid, applied, { scopeClear: true, isolatedState: true, expectedTimeSaving: true, spawned: 0, now: "2026-07-14T00:01:00.000Z" }), { allowed: true, reason: "bounded_time_saving_task" });
assert.equal(shouldStartSubagent(rapid, applied, { scopeClear: false, isolatedState: true, expectedTimeSaving: true, now: "2026-07-14T00:01:00.000Z" }).reason, "scope_not_clear");
assert.equal(shouldStartSubagent(rapid, advisory, { scopeClear: true, isolatedState: true, expectedTimeSaving: true, now: "2026-07-14T00:01:00.000Z" }).reason, "route_advisory_only");
assert.equal(shouldStartSubagent(rapid, applied, { scopeClear: true, isolatedState: true, expectedTimeSaving: true, now: "2026-07-14T04:00:00.000Z" }).reason, "wall_clock_budget_reached");
assert.equal(timeboxState(rapid, "2026-07-14T04:00:00.000Z").reached, true);
assert.equal(optionalReviewDecision(rapid, { used: 0, now: "2026-07-14T00:01:00.000Z" }).reason, "optional_review_budget_exhausted");
assert.equal(optionalReviewDecision(rapid, { required: true, now: "2026-07-14T00:01:00.000Z" }).reason, "required_by_spec_or_risk");
assert.equal(escalateCapabilityRoute(config, applied, {}).reason, "failure_or_risk_evidence_required");
const escalated = escalateCapabilityRoute(config, applied, { evidence: "routine test failed" });
assert.equal(escalated.allowed, true);
assert.equal(escalated.route.tier, "standard");
assert.equal(escalated.route.escalationUsed, 1);

const invalid = validateDeliveryConfig({ capabilityRouting: { tiers: [{ id: "economy" }, { id: "economy" }], taskRoutes: [{ taskClass: "unknown", tier: "missing" }] } });
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length >= 3);

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-delivery-profile-home-")));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-delivery-profile-workspace-")));
const configPath = path.join(home, ".codex", "skill-config", "ravo.json");
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ deliveryProfile: "balanced" }, null, 2), "utf8");
const cli = spawnSync(process.execPath, [path.join(__dirname, "../plugins/ravo/modules/ravo-core/scripts/ravo-delivery-profile.js"),
  "--workspace", workspace,
  "--home", home,
  "--task-class", "routine_test",
  "--started-at", "2026-07-14T00:00:00.000Z",
  "--now", "2026-07-14T00:01:00.000Z"
], { encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
const cliResult = JSON.parse(cli.stdout);
assert.equal(cliResult.effectiveProfile.profile, "balanced");
assert.equal(cliResult.effectiveProfile.profileSource, "user");
assert.equal(cliResult.route.enforcement, "advisory_only");
assert.equal(cliResult.timebox.remainingMinutes, 479);

console.log(JSON.stringify({ status: "pass", checks: ["profile defaults", "safety elevation", "routing enforcement", "subagent guard", "timebox", "validation", "workspace resolver CLI"] }, null, 2));
