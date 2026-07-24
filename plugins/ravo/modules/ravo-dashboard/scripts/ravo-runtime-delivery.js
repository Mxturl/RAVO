#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  REQUIRED_PLUGINS,
  applyUpgrade,
  checkUpdates,
  createUpgradePlan,
  treeFingerprint
} = require("./ravo-upgrade");
const { restart: restartSoloDesk, status: statusSoloDesk } = require("./ravo-solodesk");

const PRODUCT_VERSION = "0.6.3";
const RUNTIME_PATH_PREFIXES = ["plugins/", ".agents/plugins/marketplace.json"];
const RUNTIME_PATH_MARKERS = ["hook", "manifest", "install", "upgrade", "runtime", "cli"];

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

const { buildPmBrief } = loadPmBriefModule();

function sha(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function fingerprint(value) {
  return sha(JSON.stringify(stable(value)));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function canonical(file) {
  try { return fs.realpathSync(file); } catch (_error) { return path.resolve(file); }
}

function runtimePath(file) {
  const value = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (RUNTIME_PATH_PREFIXES.some((prefix) => value === prefix || value.startsWith(prefix))) return true;
  return value.startsWith("plugins/") && RUNTIME_PATH_MARKERS.some((marker) => value.toLowerCase().includes(marker));
}

function classifyRuntimePaths(paths = []) {
  const normalized = paths.map((file) => String(file).replace(/\\/g, "/").replace(/^\.\//, ""));
  const unknown = normalized.filter((file) => !runtimePath(file) && !file.startsWith("docs/") && !file.startsWith("knowledge/") && !file.startsWith("scripts/"));
  const runtimeOwnedPaths = normalized.filter(runtimePath);
  return {
    decision: unknown.length ? "unknown" : runtimeOwnedPaths.length ? "required" : "not_required",
    runtimeOwnedPaths,
    unknownPaths: unknown,
    reason: unknown.length ? "Some changed paths do not have a known Runtime ownership classification." : runtimeOwnedPaths.length ? "The Slice changes RAVO plugin, Hook, manifest, installer, upgrader, CLI, or Runtime behavior." : "The Slice does not change RAVO Runtime behavior."
  };
}

function manifestSnapshot(sourceRoot) {
  const plugins = [];
  for (const name of REQUIRED_PLUGINS) {
    const file = path.join(sourceRoot, "plugins", name, ".codex-plugin", "plugin.json");
    const manifest = readJson(file);
    if (manifest) plugins.push({ name, version: manifest.version || "", manifest });
  }
  return plugins;
}

function sourceBaseline(workspace, options = {}) {
  const sourceRoot = canonical(options.sourceRoot || workspace);
  const plugins = manifestSnapshot(sourceRoot).map((entry) => ({
    name: entry.name,
    version: entry.version,
    contentFingerprint: treeFingerprint(path.join(sourceRoot, "plugins", entry.name)),
    manifestFingerprint: fingerprint(entry.manifest)
  }));
  const versions = [...new Set(plugins.map((entry) => entry.version).filter(Boolean))];
  const productVersion = versions.length === 1 ? versions[0] : options.productVersion || PRODUCT_VERSION;
  const sourceFingerprint = fingerprint({ productVersion, plugins: plugins.map(({ name, version, contentFingerprint }) => ({ name, version, contentFingerprint })) });
  const manifestFingerprint = fingerprint({ productVersion, plugins: plugins.map(({ name, version, manifestFingerprint: value }) => ({ name, version, manifestFingerprint: value })) });
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const gitTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const baselineId = `ravo-v${productVersion}-${sourceFingerprint.slice(7, 19)}`;
  return {
    baselineId,
    releaseSlice: options.releaseSlice || "ravo-v0.6.3-reliable-closeout",
    productVersion,
    gitCommit: gitCommit || null,
    gitTree: gitTree || null,
    sourceFingerprint,
    manifestFingerprint,
    plugins,
    runtimeOwnedPaths: options.runtimeOwnedPaths || [],
    createdAt: new Date().toISOString()
  };
}

function runtimeEntryEvidence(updateCheck, deskStatus) {
  const plugins = (updateCheck?.plugins || []).map((plugin) => ({
    pluginId: plugin.pluginId,
    sourceVersion: plugin.sourceVersion,
    installedVersion: plugin.installedVersion,
    cacheVersion: plugin.cacheVersion,
    sourceContentFingerprint: plugin.sourceContentFingerprint,
    cacheContentFingerprint: plugin.cacheContentFingerprint,
    aligned: plugin.aligned === true
  }));
  const current = deskStatus?.currentPlugin || {};
  const runtimeFingerprint = deskStatus?.runtime?.pluginFingerprint || deskStatus?.health?.pluginFingerprint || current.fingerprint || "";
  const runtimeVersion = deskStatus?.runtime?.pluginVersion || deskStatus?.health?.pluginVersion || current.version || "";
  const runtimeAligned = Boolean(
    deskStatus
    && ["healthy", "foreground"].includes(deskStatus.status)
    && current.resolutionSource !== "development_override"
    && ["installed_cache", "last_known_verified_cache"].includes(current.resolutionSource)
    && current.installedRoot
    && current.actualEntrypoint
    && runtimeFingerprint
    && runtimeVersion
    && deskStatus.status !== "restart_required"
  );
  return {
    sourceFingerprint: updateCheck?.sourceFingerprint || "",
    cacheFingerprint: fingerprint(plugins.map((plugin) => ({ pluginId: plugin.pluginId, cacheVersion: plugin.cacheVersion, cacheContentFingerprint: plugin.cacheContentFingerprint }))),
    runtimeFingerprint,
    runtimeVersion,
    runtimeAligned,
    plugins,
    installedRoot: current.installedRoot || deskStatus?.runtime?.installedRoot || null,
    actualEntrypoint: current.actualEntrypoint || deskStatus?.runtime?.actualEntrypoint || null,
    resolutionSource: current.resolutionSource || deskStatus?.runtime?.resolutionSource || null,
    controllerVersion: current.controllerVersion || deskStatus?.runtime?.controllerVersion || null
  };
}

function driftDetails(updateCheck, deskStatus, baseline) {
  const details = [];
  if (!updateCheck || updateCheck.status === "error" || updateCheck.status === "missing") details.push({ kind: "upgrade_check", observed: updateCheck?.status || "missing", expected: "current" });
  for (const plugin of updateCheck?.plugins || []) if (!plugin.aligned) details.push({ kind: "plugin", pluginId: plugin.pluginId, reason: plugin.driftReason || "not_aligned", sourceVersion: plugin.sourceVersion, cacheVersion: plugin.cacheVersion });
  for (const plugin of updateCheck?.plugins || []) {
    const frozen = (baseline?.plugins || []).find((entry) => entry.name === String(plugin.pluginId || "").replace(/@ravo$/, ""));
    if (frozen?.contentFingerprint && plugin.sourceContentFingerprint && frozen.contentFingerprint !== plugin.sourceContentFingerprint) {
      details.push({ kind: "source_changed_after_freeze", pluginId: plugin.pluginId, frozen: frozen.contentFingerprint, observed: plugin.sourceContentFingerprint });
    }
  }
  const runtime = runtimeEntryEvidence(updateCheck, deskStatus);
  if (runtime.runtimeAligned !== true) details.push({ kind: "runtime", observedStatus: deskStatus?.status || "missing", installedRoot: runtime.installedRoot, actualEntrypoint: runtime.actualEntrypoint, resolutionSource: runtime.resolutionSource, runtimeFingerprint: runtime.runtimeFingerprint, expectedSourceFingerprint: baseline.sourceFingerprint });
  return { details, runtime };
}

function durationMinutes(start, end) {
  if (!start || !end) return null;
  const milliseconds = Date.parse(end) - Date.parse(start);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.round((milliseconds / 60000) * 100) / 100 : null;
}

function timing(preflightStartedAt, preflightCompletedAt, authorizationRequestedAt, authorizationGrantedAt, upgradeStartedAt, upgradeCompletedAt, e2eStartedAt, e2eCompletedAt) {
  const preflightMinutes = durationMinutes(preflightStartedAt, preflightCompletedAt);
  const authorizationWaitMinutes = durationMinutes(authorizationRequestedAt, authorizationGrantedAt);
  const upgradeRestartMinutes = durationMinutes(upgradeStartedAt, upgradeCompletedAt);
  const freshSessionE2eMinutes = durationMinutes(e2eStartedAt, e2eCompletedAt);
  return {
    preflightStartedAt: preflightStartedAt || null,
    preflightCompletedAt: preflightCompletedAt || null,
    preflightMinutes,
    authorizationRequestedAt: authorizationRequestedAt || null,
    authorizationGrantedAt: authorizationGrantedAt || null,
    authorizationWaitMinutes,
    upgradeRestartMinutes,
    freshSessionE2eMinutes,
    agentControlledDeliveryMinutes: [preflightMinutes, upgradeRestartMinutes, freshSessionE2eMinutes].every((value) => value !== null)
      ? Math.round((preflightMinutes + upgradeRestartMinutes + freshSessionE2eMinutes) * 100) / 100
      : null,
    measurementSource: [preflightMinutes, upgradeRestartMinutes, freshSessionE2eMinutes].every((value) => value !== null) ? "derived" : "unknown"
  };
}

function artifactPath(workspace, baselineId) {
  return path.join(workspace, "knowledge", ".ravo", "acceptance", `runtime-delivery-${baselineId}.json`);
}

function readAttempt(workspace, baselineId) {
  return readJson(artifactPath(workspace, baselineId));
}

function writeAttempt(workspace, baselineId, value) {
  const file = artifactPath(workspace, baselineId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function deliveryPmBrief(value, baselineId) {
  const needsException = value.status === "pending_runtime_upgrade";
  const passed = value.status === "passed";
  const notRequired = value.status === "not_required";
  const failed = ["failed_source_defect", "blocked_external"].includes(value.status);
  const decisionCard = needsException ? {
    question: "是否允许这次超出默认范围的本机环境更新？",
    whyNow: "当前调用明确要求单独确认，Codex 不能使用默认本地交付授权继续。",
    recommendation: "确认影响仅限本机且恢复路径明确后再允许。",
    options: [
      { id: "allow", label: "允许本次更新", outcome: "Codex 完成本机更新并验证实际体验。" },
      { id: "keep", label: "保持当前环境", outcome: "保留现状，本次能力暂不进入实际使用环境。" }
    ],
    waitingImpact: "暂不决定不会影响现有使用，但新能力不会进入本机实际环境。"
  } : null;
  return buildPmBrief({
    headline: passed ? "本机已经可以使用这项能力"
      : notRequired ? "本次变更不需要更新实际使用环境"
        : needsException ? "本机环境更新需要一次例外确认"
          : failed ? "本机环境更新尚未完成" : "本机环境状态正在核对",
    stage: passed ? "experience" : "integrate",
    productState: passed ? "locally_available" : notRequired ? "validated" : needsException ? "awaiting_pm" : failed ? "blocked" : "in_progress",
    userImpact: passed
      ? "你可以立即在本机体验；远端、生产和其他用户的环境没有变化。"
      : notRequired ? "现有本机环境保持不变，Codex 可以继续后续体验或验收。"
        : needsException ? "现有本机环境保持稳定，只有你允许后才会更新。"
          : "现有本机环境保持原状，Codex 会先处理更新或验证问题。",
    actionRequired: needsException ? "authorize_exception" : "none",
    nextStep: needsException ? "请查看决策卡并决定是否允许这次例外更新。"
      : passed ? "Codex 将整理实际体验证据并进入产品验收或下一轮优化。"
        : failed ? "Codex 将核对正式本地来源、更新结果和恢复路径后继续。" : "Codex 将继续完成本地交付。",
    decisionCard,
    evidenceBoundary: {
      proves: [passed ? "本机实际使用环境已对齐并通过真实任务验证" : notRequired ? "本次变更不需要更新本机实际使用环境" : "已记录本机环境更新的当前结果和恢复入口"],
      doesNotProve: [passed ? "尚不代表已经发布给其他用户" : "尚不代表本机已经可以使用新能力"]
    },
    sourceRefs: [`runtime-delivery:${baselineId}`]
  });
}

function finish(workspace, baselineId, value, options = {}) {
  const decorated = {
    ...value,
    localDeliveryPolicy: value.trigger?.decision === "not_required" ? "not_required" : options.requireAuthorization === true ? "explicit_exception" : "default_local_delivery",
    pmBrief: deliveryPmBrief(value, baselineId)
  };
  return {
    ...decorated,
    artifactPath: options.writeArtifact === false ? "" : writeAttempt(workspace, baselineId, decorated)
  };
}

function runCheck(command, args, cwd) {
  try {
    const stdout = execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    return { status: "pass", stdout: stdout.trim() };
  } catch (error) {
    return { status: "fail", stdout: String(error.stdout || "").trim(), stderr: String(error.stderr || error.message || "").trim() };
  }
}

function realFreshSessionE2E(input = {}) {
  if (!input.promptFile) return { result: "blocked", reason: "real_fresh_codex_session_runner_required" };
  const script = path.join(__dirname, "ravo-fresh-session-e2e.js");
  const output = input.output || path.join(input.workspace, "knowledge", ".ravo", "acceptance", `fresh-session-${input.baseline.baselineId}.json`);
  const args = [script, "--workspace", input.workspace, "--prompt-file", input.promptFile, "--output", output,
    "--baseline-id", input.baseline.baselineId, "--plugin-version", input.baseline.productVersion,
    "--controller-version", input.runtime.controllerVersion || input.baseline.productVersion,
    "--installed-root", input.runtime.installedRoot || "", "--actual-entrypoint", input.runtime.actualEntrypoint || "",
    "--resolution-source", input.runtime.resolutionSource || "", "--source-fingerprint", input.baseline.sourceFingerprint,
    "--cache-fingerprint", input.runtime.cacheFingerprint || "", "--runtime-fingerprint", input.runtime.runtimeFingerprint || "",
    "--artifact-side-effect", input.artifactSideEffect || "unknown", "--skill-read", input.skillRead || "unknown",
    "--subagent-side-effect", input.subagentSideEffect || "unknown", "--formal-review-side-effect", "no"];
  if (input.pmStatus === true) args.push("--pm-status");
  else if (input.pmNoAction === true) args.push("--pm-no-action");
  const child = spawnSync(process.execPath, args, { cwd: input.workspace, encoding: "utf8", timeout: input.timeoutMs || 900000, maxBuffer: 16 * 1024 * 1024 });
  const artifact = readJson(output);
  return artifact || { result: child.status === 0 ? "fail" : "blocked", reason: child.stderr || "Fresh Session runner did not produce an artifact." };
}

async function preflight(options = {}) {
  const workspace = canonical(options.workspace || process.cwd());
  const preflightStartedAt = new Date().toISOString();
  const trigger = classifyRuntimePaths(options.changedPaths || []);
  if (trigger.decision === "not_required") {
    const result = { schemaVersion: "0.5.5", status: "not_required", trigger, timing: timing(preflightStartedAt, new Date().toISOString()), formalReviewStarted: false, createdAt: new Date().toISOString() };
    return finish(workspace, "not-required", result, options);
  }
  if (trigger.decision === "unknown") {
    const result = { schemaVersion: "0.5.5", status: "blocked_external", trigger, reason: "runtime_ownership_unknown", recoveryEntry: "Classify the unknown paths before creating a Fresh Session evidence claim.", timing: timing(preflightStartedAt, new Date().toISOString()), formalReviewStarted: false, createdAt: new Date().toISOString() };
    return finish(workspace, `unknown-${Date.now()}`, result, options);
  }

  const baseline = sourceBaseline(workspace, { ...options, runtimeOwnedPaths: trigger.runtimeOwnedPaths });
  const checkResult = options.runChecks ? await options.runChecks({ workspace, baseline, trigger }) : {
    versionAlignment: runCheck(process.execPath, [path.join(workspace, "scripts/version-alignment-test.js")], workspace),
    hookRegression: runCheck(process.execPath, [path.join(workspace, "scripts/runtime-delivery-hook-test.js")], workspace)
  };
  const checkFailed = Object.values(checkResult).some((value) => value?.status === "fail");
  if (checkFailed) {
    const result = { schemaVersion: "0.5.5", status: "failed_source_defect", trigger, baseline, checks: checkResult, reason: "version_or_hook_regression_failed", recoveryEntry: "Return to development, fix the source defect, and create a new frozen source baseline.", timing: timing(preflightStartedAt, new Date().toISOString()), formalReviewStarted: false, createdAt: new Date().toISOString() };
    return finish(workspace, baseline.baselineId, result, options);
  }

  const updateCheck = options.updateCheck || checkUpdates({ home: options.home || os.homedir(), execute: options.execute, env: options.env });
  const deskStatus = options.solodeskStatus || await statusSoloDesk({ home: options.home || os.homedir(), executeCodex: options.executeCodex, executeCodex: options.executeCodex, pluginRoot: options.pluginRoot, probeHealth: options.probeHealth });
  let { details, runtime } = driftDetails(updateCheck, deskStatus, baseline);
  const observedRuntimeFingerprint = fingerprint({ update: updateCheck?.runtimeFingerprint || "", runtime: runtime.runtimeFingerprint, status: deskStatus?.status || "" });
  let plan = null;
  let upgradePlanFingerprint = "";
  if (details.length && updateCheck?.marketplaceStatus === "present" && updateCheck.status !== "error" && updateCheck.status !== "missing") {
    try { plan = options.createPlan ? options.createPlan(updateCheck) : createUpgradePlan(updateCheck); upgradePlanFingerprint = fingerprint(plan); } catch (error) { details.push({ kind: "upgrade_plan", reason: error.code || error.message }); }
  }
  const deliveryAttemptFingerprint = fingerprint({ baselineId: baseline.baselineId, sourceFingerprint: baseline.sourceFingerprint, observedRuntimeFingerprint, upgradePlanFingerprint });
  const existing = readAttempt(workspace, baseline.baselineId);
  if (existing?.deliveryAttemptFingerprint === deliveryAttemptFingerprint && ["passed", "failed_source_defect", "blocked_external"].includes(existing.status) && options.forceNewAttempt !== true) {
    return { ...existing, pmBrief: existing.pmBrief || deliveryPmBrief(existing, baseline.baselineId), idempotent: true, artifactPath: artifactPath(workspace, baseline.baselineId) };
  }
  const authorizationRequestedAt = details.length && options.requireAuthorization === true ? new Date().toISOString() : null;
  if (details.length && options.requireAuthorization === true && options.authorized !== true) {
    const result = {
      schemaVersion: "0.5.5",
      status: "pending_runtime_upgrade",
      trigger,
      baseline,
      checks: checkResult,
      updateCheck,
      runtime,
      drift: details,
      deliveryAttemptFingerprint,
      authorizationRequestedAt,
      authorizationRequired: true,
      recoveryEntry: "Review the listed source/cache/runtime differences and explicitly authorize one controlled upgrade, then run this attempt again.",
      timing: timing(preflightStartedAt, new Date().toISOString(), authorizationRequestedAt, null, null, null, null, null),
      formalReviewStarted: false,
      createdAt: new Date().toISOString()
    };
    return finish(workspace, baseline.baselineId, result, options);
  }

  let authorizationGrantedAt = details.length && options.requireAuthorization === true ? new Date().toISOString() : null;
  let upgradeStartedAt = null;
  let upgradeCompletedAt = null;
  let upgradeResult = null;
  if (details.length) {
    upgradeStartedAt = new Date().toISOString();
    try {
      upgradeResult = options.applyUpgrade ? await options.applyUpgrade(plan, { home: options.home || os.homedir(), execute: options.execute, workspaces: options.workspaces || [] }) : await applyUpgrade(plan, { home: options.home || os.homedir(), execute: options.execute, workspaces: options.workspaces || [] });
    } catch (error) {
      upgradeResult = { status: "failed", errorCode: error.code || "upgrade_failed", message: error.message };
    }
    upgradeCompletedAt = new Date().toISOString();
    if (!upgradeResult || !["succeeded", "success"].includes(upgradeResult.status)) {
      const result = { schemaVersion: "0.5.5", status: "blocked_external", trigger, baseline, checks: checkResult, updateCheck, runtime, drift: details, deliveryAttemptFingerprint, authorizationRequestedAt, authorizationGrantedAt, upgradeResult, recoveryEntry: "本机更新未完成；保留失败记录。Codex 将核对正式本地来源、恢复路径和环境变化后重试；只有超出默认本地边界时才请求 PM 决策。", timing: timing(preflightStartedAt, new Date().toISOString(), authorizationRequestedAt, authorizationGrantedAt, upgradeStartedAt, upgradeCompletedAt, null, null), formalReviewStarted: false, createdAt: new Date().toISOString() };
      return finish(workspace, baseline.baselineId, result, options);
    }
    const refreshed = options.updateCheckAfterUpgrade || checkUpdates({ home: options.home || os.homedir(), execute: options.execute, env: options.env });
    const refreshedStatus = options.solodeskStatusAfterUpgrade || await statusSoloDesk({ home: options.home || os.homedir(), executeCodex: options.executeCodex, executeCodex: options.executeCodex, pluginRoot: options.pluginRoot, probeHealth: options.probeHealth });
    ({ details, runtime } = driftDetails(refreshed, refreshedStatus, baseline));
    if (details.length && refreshedStatus?.status === "restart_required" && options.restart !== false) {
      await (options.restartSoloDesk ? options.restartSoloDesk({ home: options.home || os.homedir() }) : restartSoloDesk({ home: options.home || os.homedir(), executeCodex: options.executeCodex, executeCodex: options.executeCodex }));
      const afterRestart = options.solodeskStatusAfterRestart || await statusSoloDesk({ home: options.home || os.homedir(), executeCodex: options.executeCodex, executeCodex: options.executeCodex, pluginRoot: options.pluginRoot, probeHealth: options.probeHealth });
      ({ details, runtime } = driftDetails(refreshed, afterRestart, baseline));
    }
    if (details.length) {
      const result = { schemaVersion: "0.5.5", status: "blocked_external", trigger, baseline, checks: checkResult, updateCheck: refreshed, runtime, drift: details, deliveryAttemptFingerprint, authorizationRequestedAt, authorizationGrantedAt, upgradeResult, recoveryEntry: "更新后本地来源、已安装内容或实际运行环境仍未对齐；Codex 将检查真实变化后重新尝试，只有超出默认本地边界时才请求 PM 决策。", timing: timing(preflightStartedAt, new Date().toISOString(), authorizationRequestedAt, authorizationGrantedAt, upgradeStartedAt, upgradeCompletedAt, null, null), formalReviewStarted: false, createdAt: new Date().toISOString() };
      return finish(workspace, baseline.baselineId, result, options);
    }
  }

  const e2eStartedAt = new Date().toISOString();
  const e2e = options.freshSessionE2E
    ? await options.freshSessionE2E({ baseline, runtime, deliveryAttemptFingerprint, pmNoAction: options.pmNoAction === true, pmStatus: options.pmStatus === true })
    : realFreshSessionE2E({ workspace, baseline, runtime, promptFile: options.promptFile, output: options.freshSessionOutput, timeoutMs: options.freshSessionTimeoutMs, artifactSideEffect: options.artifactSideEffect, skillRead: options.skillRead, subagentSideEffect: options.subagentSideEffect, pmNoAction: options.pmNoAction === true, pmStatus: options.pmStatus === true });
  const e2eCompletedAt = new Date().toISOString();
  const result = {
    schemaVersion: "0.5.5",
    status: e2e.result === "pass" ? "passed" : e2e.sourceDefect ? "failed_source_defect" : "blocked_external",
    trigger,
    baseline,
    checks: checkResult,
    updateCheck,
    runtime,
    drift: [],
    deliveryAttemptFingerprint,
    authorizationRequestedAt,
    authorizationGrantedAt,
    upgradeResult,
    freshSessionE2e: e2e,
    timing: timing(preflightStartedAt, new Date().toISOString(), authorizationRequestedAt, authorizationGrantedAt, upgradeStartedAt, upgradeCompletedAt, e2eStartedAt, e2eCompletedAt),
    formalReviewStarted: false,
    recoveryEntry: e2e.result === "pass" ? "Fresh Session evidence is ready for the separate PM acceptance package." : "Run only after a real new Codex Session is available; do not replace this evidence with a fake provider or script result.",
    createdAt: new Date().toISOString()
  };
  return finish(workspace, baseline.baselineId, result, options);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-runtime-delivery.js --workspace <path> --changed-path <path>... [--pm-status] [--pm-no-action] [--require-authorization] [--authorized]");
    return;
  }
  if (process.argv.includes("--version")) { console.log(PRODUCT_VERSION); return; }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const result = await preflight({ workspace, changedPaths: argValues("--changed-path"), pmNoAction: process.argv.includes("--pm-no-action"), pmStatus: process.argv.includes("--pm-status"), requireAuthorization: process.argv.includes("--require-authorization"), authorized: process.argv.includes("--authorized"), promptFile: argValue("--prompt-file", ""), freshSessionOutput: argValue("--fresh-session-output", "") });
  console.log(JSON.stringify(result, null, 2));
  if (["pending_runtime_upgrade", "blocked_external", "failed_source_defect"].includes(result.status)) process.exitCode = 2;
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${JSON.stringify({ status: "error", message: error.message })}\n`); process.exitCode = 1; });

module.exports = {
  PRODUCT_VERSION,
  classifyRuntimePaths,
  driftDetails,
  fingerprint,
  preflight,
  sourceBaseline,
  timing
};
