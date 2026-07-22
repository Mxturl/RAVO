#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { hasPmActionRequest, parseEvents, pmStatusViolations } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-fresh-session-e2e");
const { classifyRuntimePaths, preflight, sourceBaseline } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-runtime-delivery");

const repo = path.resolve(__dirname, "..");

(async () => {
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-runtime-delivery-")));
const env = { ...process.env, GIT_AUTHOR_NAME: "RAVO Test", GIT_AUTHOR_EMAIL: "ravo@example.invalid", GIT_COMMITTER_NAME: "RAVO Test", GIT_COMMITTER_EMAIL: "ravo@example.invalid" };
execFileSync("git", ["init", "-q"], { cwd: workspace, env });
fs.mkdirSync(path.join(workspace, "plugins/ravo/.codex-plugin"), { recursive: true });
fs.writeFileSync(path.join(workspace, "plugins/ravo/.codex-plugin/plugin.json"), JSON.stringify({ name: "ravo", version: "0.6.2" }));
fs.mkdirSync(path.join(workspace, "plugins/ravo/modules/ravo-dashboard/scripts"), { recursive: true });
fs.writeFileSync(path.join(workspace, "plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"), "runtime\n");
execFileSync("git", ["add", "."], { cwd: workspace, env });
execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspace, env });

assert.equal(classifyRuntimePaths(["docs/readme.md"]).decision, "not_required");
assert.equal(classifyRuntimePaths(["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"]).decision, "required");
assert.equal(classifyRuntimePaths(["unknown/file.txt"]).decision, "unknown");
assert.equal(hasPmActionRequest("当前无需 PM 行动，Codex 会继续。"), false);
assert.equal(hasPmActionRequest("需你操作：批准当前权限。"), true);
assert.equal(hasPmActionRequest("产品经理现在只需确认该决策进入待落实范围。"), true);
assert.equal(hasPmActionRequest("产品经理现在应确认该决定进入当前版本范围。"), true);
assert.deepEqual(pmStatusViolations("结论：本机可体验。当前可用：是。影响：回复更易判断。PM 行动：无需。下一步：Codex 继续验证。"), []);
assert.deepEqual(pmStatusViolations("日常使用会更安静，下一步由 Codex 继续处理。"), []);
assert.ok(pmStatusViolations("我会核对 Runtime 缓存和 Hook 状态。").includes("internal_evidence_in_pm_status"));
const continued = parseEvents([
  JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "续写前回答" } }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "最终回答" } })
].join("\n"));
assert.equal(continued.responseSummary, "最终回答");

const alignedCheck = {
  status: "current",
  marketplaceStatus: "present",
  sourceFingerprint: "sha256:source",
  runtimeFingerprint: "sha256:runtime",
  plugins: [{ pluginId: "ravo", sourceVersion: "0.6.2", installedVersion: "0.6.2", cacheVersion: "0.6.2", sourceContentFingerprint: sourceBaseline(workspace, { productVersion: "0.6.2" }).plugins.find((entry) => entry.name === "ravo").contentFingerprint, cacheContentFingerprint: "sha256:source-file", aligned: true }]
};
const alignedDesk = {
  status: "healthy",
  runtime: { pluginVersion: "0.6.2", pluginFingerprint: "sha256:runtime", installedRoot: "/tmp/cache/ravo/0.6.2/modules/ravo-dashboard", actualEntrypoint: "/tmp/cache/ravo/0.6.2/modules/ravo-dashboard/scripts/ravo-dashboard.js", resolutionSource: "installed_cache", controllerVersion: "0.6.2" },
  currentPlugin: { version: "0.6.2", fingerprint: "sha256:runtime", installedRoot: "/tmp/cache/ravo/0.6.2/modules/ravo-dashboard", actualEntrypoint: "/tmp/cache/ravo/0.6.2/modules/ravo-dashboard/scripts/ravo-dashboard.js", resolutionSource: "installed_cache", controllerVersion: "0.6.2" }
};
const checkOptions = { runChecks: async () => ({ versionAlignment: { status: "pass" }, hookRegression: { status: "pass" } }), updateCheck: alignedCheck, solodeskStatus: alignedDesk };
let e2eCalls = 0;
let upgradeCalls = 0;
let pmStatusSeen = false;
const noDrift = await preflight({ ...checkOptions, workspace, changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"], pmStatus: true, freshSessionE2E: async ({ baseline, deliveryAttemptFingerprint, pmStatus }) => { e2eCalls += 1; pmStatusSeen = pmStatus; return { result: "pass", sessionId: "session-real", threadId: "thread-real", baselineId: baseline.baselineId, deliveryAttemptFingerprint }; } });
assert.equal(noDrift.status, "passed");
assert.equal(e2eCalls, 1);
assert.equal(pmStatusSeen, true);
assert.equal(noDrift.formalReviewStarted, false);

const driftCheck = { ...alignedCheck, status: "update_or_repair_available", drift: true, plugins: [{ ...alignedCheck.plugins[0], aligned: false, driftReason: "cache_content_mismatch", cacheContentFingerprint: "sha256:old" }] };
const driftDesk = { ...alignedDesk, status: "restart_required", currentPlugin: { ...alignedDesk.currentPlugin, resolutionSource: "development_override" } };
let driftE2e = 0;
const pending = await preflight({ ...checkOptions, workspace, changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"], updateCheck: driftCheck, solodeskStatus: driftDesk, requireAuthorization: true, freshSessionE2E: async () => { driftE2e += 1; return { result: "pass" }; } });
assert.equal(pending.status, "pending_runtime_upgrade");
assert.equal(driftE2e, 0, "Fresh Session must not start before runtime upgrade authorization.");
assert.equal(pending.pmBrief.actionRequired, "authorize_exception");

let defaultUpgradeCalls = 0;
const defaultLocal = await preflight({
  ...checkOptions,
  workspace,
  changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"],
  updateCheck: driftCheck,
  solodeskStatus: driftDesk,
  createPlan: (check) => ({ planId: "default-local", sourceFingerprint: check.sourceFingerprint, targetVersion: "0.6.2", requiredPlugins: ["ravo"], pluginActions: [] }),
  applyUpgrade: async () => { defaultUpgradeCalls += 1; return { status: "succeeded" }; },
  updateCheckAfterUpgrade: alignedCheck,
  solodeskStatusAfterUpgrade: alignedDesk,
  freshSessionE2E: async () => ({ result: "pass", sessionId: "session-default", threadId: "thread-default" })
});
assert.equal(defaultLocal.status, "passed", "safe local delivery proceeds without a second PM authorization");
assert.equal(defaultUpgradeCalls, 1);
assert.equal(defaultLocal.pmBrief.actionRequired, "none");
assert.equal(defaultLocal.pmBrief.productState, "locally_available");
assert.equal(defaultLocal.localDeliveryPolicy, "default_local_delivery");
assert.equal(defaultLocal.authorizationRequestedAt, null);

const failedDefault = await preflight({
  ...checkOptions,
  workspace,
  changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"],
  updateCheck: driftCheck,
  solodeskStatus: driftDesk,
  createPlan: (check) => ({ planId: "failed-default", sourceFingerprint: check.sourceFingerprint, targetVersion: "0.6.2", requiredPlugins: ["ravo"], pluginActions: [] }),
  applyUpgrade: async () => ({ status: "failed" }),
  forceNewAttempt: true,
  freshSessionE2E: async () => ({ result: "pass" })
});
assert.equal(failedDefault.status, "blocked_external");
assert.match(failedDefault.recoveryEntry, /Codex 将核对/);
assert.doesNotMatch(failedDefault.recoveryEntry, /重新授权/);

const upgraded = await preflight({
  ...checkOptions,
  workspace,
  changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"],
  updateCheck: driftCheck,
  solodeskStatus: driftDesk,
  requireAuthorization: true,
  authorized: true,
  createPlan: (check) => ({ planId: "plan-1", sourceFingerprint: check.sourceFingerprint, targetVersion: "0.6.2", requiredPlugins: ["ravo"], pluginActions: [] }),
  applyUpgrade: async () => { upgradeCalls += 1; return { status: "succeeded" }; },
  updateCheckAfterUpgrade: alignedCheck,
  solodeskStatusAfterUpgrade: alignedDesk,
  freshSessionE2E: async () => ({ result: "pass", sessionId: "session-real-2", threadId: "thread-real-2" })
});
assert.equal(upgraded.status, "passed");
assert.equal(upgradeCalls, 1);
assert.equal(upgraded.pmBrief.productState, "locally_available");

const idempotent = await preflight({
  ...checkOptions,
  workspace,
  changedPaths: ["plugins/ravo/modules/ravo-dashboard/scripts/runtime.js"],
  updateCheck: driftCheck,
  solodeskStatus: driftDesk,
  createPlan: (check) => ({ planId: "plan-1", sourceFingerprint: check.sourceFingerprint, targetVersion: "0.6.2", requiredPlugins: ["ravo"], pluginActions: [] }),
  freshSessionE2E: async () => { throw new Error("same attempt must not rerun E2E"); }
});
assert.equal(idempotent.status, "passed");
assert.equal(idempotent.idempotent, true);

const ordinary = await preflight({ workspace, changedPaths: ["docs/readme.md"], writeArtifact: false });
assert.equal(ordinary.status, "not_required");

  console.log(JSON.stringify({ status: "pass", checks: ["runtime-trigger-classification", "no-drift-no-upgrade", "explicit-exception-authorization", "default-local-delivery", "default-local-recovery-without-reauthorization", "authorized-single-upgrade-and-e2e", "same-attempt-idempotency", "rapid-ordinary-task-no-preflight"], e2eCalls, upgradeCalls, defaultUpgradeCalls }, null, 2));
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
