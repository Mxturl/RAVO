#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");
const {
  ConfigError,
  getConfig,
  listModules,
  restoreConfig,
  saveConfig,
  validateConfig
} = require("./ravo-config");
const { buildFreshness } = require("./ravo-freshness");
const { resolvePluginScript } = require("./ravo-plugin-resolver");
const {
  createUpgradePlan,
  listJournals,
  recoverConfig
} = require("./ravo-upgrade");

const SERVICE_VERSION = "0.6.2";

const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 4317,
  staleAfterDays: 7,
  refreshSeconds: 60,
  artifactLimitPerWorkspace: 500,
  showPromptSnippets: false,
  includeGitStatus: false,
  configIntegrityEnabled: true,
  preserveExternalRegistrations: false,
  maxConfigSnapshots: 5,
  tokenTtlMs: 10 * 60 * 1000,
  requestBodyLimit: 1024 * 1024,
  maxPortAttempts: 30
});
const STARTUP_MODES = new Set(["on_demand", "login", "foreground"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REVIEW_MODES = new Set(["run", "test"]);
const REVIEW_BOUNDARIES = new Set(["safe_sanitized", "sensitive_requires_consent", "prohibited"]);
const REVIEW_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const REVIEW_PROCESS_MARGIN_MIN_MS = 30 * 1000;
const REVIEW_PROCESS_MARGIN_MAX_MS = 2 * 60 * 1000;
const NODE_TIMER_MAX_MS = 2_147_000_000;
const MAX_EXTERNAL_SECTIONS_PER_REPAIR = 100;
const MAX_REENABLE_PLUGINS_PER_REPAIR = 8;
const MAX_REPAIR_INPUT_STRING_LENGTH = 500;
const SHORTCUT_BOUNDARIES = new Set(["local_prompt_only", "safe_sanitized", "sensitive_requires_consent", "prohibited"]);
const SHORTCUT_KINDS = new Set([
  "continue",
  "requirement-analysis",
  "root-cause",
  "find-blockers",
  "acceptance-gaps",
  "review",
  "recent-progress",
  "capture-knowledge",
  "goal-prompt",
  "runtime-status",
  "initialize-ravo"
]);

class ApiError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function stableString(value) {
  return JSON.stringify(stableValue(value));
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function safeMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function fileSha256(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function trustedControllerPath(value, home = os.homedir()) {
  if (!value) return "";
  try {
    const file = fs.realpathSync(path.resolve(value));
    const scriptDir = fs.realpathSync(__dirname);
    const sibling = fs.realpathSync(path.join(scriptDir, "ravo-solodesk.js"));
    if (!fs.statSync(file).isFile() || path.basename(file) !== "ravo-solodesk.js") return "";
    if (file === sibling) return file;
    const installed = path.join(path.resolve(home), ".codex", "ravo", "bin", "ravo-solodesk.js");
    if (!fs.existsSync(installed) || fs.realpathSync(installed) !== file) return "";
    const stat = fs.statSync(file);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "";
    return fileSha256(file) === fileSha256(sibling) ? file : "";
  } catch (_error) {
    return "";
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function writeServiceState(state, updates = {}) {
  const file = state.options.runtimeState;
  if (!file) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const previous = readJson(file) || {};
  const value = {
    ...previous,
    schemaVersion: SERVICE_VERSION,
    instanceId: state.instanceId,
    pid: process.pid,
    host: state.host,
    port: state.port || 0,
    url: state.port ? `http://${state.host}:${state.port}/` : "",
    status: state.lifecycleStatus,
    startupMode: state.startupMode,
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    serviceVersion: state.serviceVersion,
    pluginVersion: state.pluginVersion,
    pluginFingerprint: state.pluginFingerprint,
    installedRoot: state.installedRoot,
    actualEntrypoint: state.actualEntrypoint,
    resolutionSource: state.resolutionSource,
    controllerVersion: state.controllerVersion,
    installedPluginVersion: state.pluginVersion,
    installedPluginFingerprint: state.pluginFingerprint,
    restartRequired: state.restartRequired,
    restartReason: state.restartReason || "",
    restartScheduledAt: state.restartScheduledAt || "",
    lastErrorCode: state.lastErrorCode || "",
    restartCount: state.restartCount,
    userRequestedStop: false,
    ...updates
  };
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return value;
}

function mutationView(state) {
  const reviews = [...state.reviewRuns.values()].filter((run) => run.status === "running").map((run) => run.reviewRunId);
  const active = [...state.activeMutations];
  return {
    busy: state.acceptingMutations === false || active.length > 0 || reviews.length > 0,
    acceptingMutations: state.acceptingMutations !== false,
    active,
    reviewRunIds: reviews
  };
}

function publicServiceStatus(state) {
  return {
    status: state.lifecycleStatus,
    instanceId: state.instanceId,
    pid: process.pid,
    url: state.port ? `http://${state.host}:${state.port}/` : "",
    startupMode: state.startupMode,
    serviceVersion: state.serviceVersion,
    pluginVersion: state.pluginVersion,
    pluginFingerprint: state.pluginFingerprint,
    installedRoot: state.installedRoot,
    actualEntrypoint: state.actualEntrypoint,
    resolutionSource: state.resolutionSource,
    controllerVersion: state.controllerVersion,
    restartRequired: state.restartRequired,
    restartReason: state.restartReason || "",
    restartScheduledAt: state.restartScheduledAt || "",
    lastErrorCode: state.lastErrorCode || "",
    mutation: mutationView(state)
  };
}

function restartBlockers(state) {
  const mutation = mutationView(state);
  return {
    mutations: mutation.active.filter((entry) => !entry.startsWith("POST /api/service/restart#")),
    reviewRunIds: mutation.reviewRunIds,
    draining: state.acceptingMutations === false
  };
}

function markRestartRequired(state, reason) {
  state.restartRequired = true;
  state.lifecycleStatus = "restart_required";
  state.restartReason = reason || state.restartReason || "restart_required";
  writeServiceState(state);
}

function scheduleControllerRestart(state, reason) {
  if (state.startupMode === "foreground") return false;
  const controllerPath = trustedControllerPath(state.options.controllerPath, state.settings.home);
  if (!controllerPath) return false;
  if (state.restartScheduledAt) return true;
  state.restartScheduledAt = new Date().toISOString();
  state.restartReason = reason || state.restartReason || "restart_required";
  writeServiceState(state);
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (state.acceptingMutations === false || ["draining", "restarting", "stopped"].includes(state.lifecycleStatus)) {
      state.restartScheduledAt = "";
      writeServiceState(state);
      return;
    }
    const child = spawn(process.execPath, [controllerPath, "restart", "--reason", state.restartReason, "--no-browser"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, HOME: state.settings.home }
    });
    child.once("error", (error) => {
      state.lastErrorCode = error.code || "restart_spawn_failed";
      state.restartScheduledAt = "";
      writeServiceState(state);
    });
    child.unref();
  }, 300).unref();
  return true;
}

function parseInteger(value, fallback, min, max, warningKey, warnings) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= min && numeric <= max) return numeric;
  warnings.push(`${warningKey}_invalid_using_default`);
  return fallback;
}

function fieldValue(view, fieldPath, fallback) {
  const field = (view?.fields || []).find((entry) => entry.path === fieldPath);
  return field ? clone(field.effectiveValue) : fallback;
}

function normalizeWorkspaceRoots(values, cwd, warnings) {
  const roots = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value.trim()) {
      warnings.push("workspace_root_invalid");
      continue;
    }
    roots.push(path.resolve(value));
  }
  return [...new Set(roots)];
}

function readDashboardSettings(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const cwd = path.resolve(options.cwd || process.cwd());
  const warnings = [];
  let view;
  try {
    view = getConfig("dashboard", { home });
  } catch (error) {
    warnings.push(`dashboard_config_${error.code || "error"}`);
    view = { fields: [] };
  }
  const cliRoots = Array.isArray(options.workspaceRoots) ? options.workspaceRoots : [];
  const configuredRoots = fieldValue(view, "dashboard.workspaceRoots", []);
  const roots = normalizeWorkspaceRoots(cliRoots.length ? cliRoots : configuredRoots, cwd, warnings);
  const configuredOverrides = fieldValue(view, "dashboard.workspaceOverrides", {});
  const workspaceOverrides = configuredOverrides && typeof configuredOverrides === "object" && !Array.isArray(configuredOverrides)
    ? configuredOverrides
    : {};
  if (configuredOverrides !== workspaceOverrides) warnings.push("workspace_overrides_invalid");
  const port = parseInteger(options.port, fieldValue(view, "dashboard.port", DEFAULTS.port), 1024, 65535, "port", warnings);
  const refreshSeconds = parseInteger(options.refreshSeconds, fieldValue(view, "dashboard.refreshSeconds", DEFAULTS.refreshSeconds), 5, 3600, "refresh_seconds", warnings);
  const staleAfterDays = parseInteger(options.staleAfterDays, fieldValue(view, "dashboard.staleAfterDays", DEFAULTS.staleAfterDays), 1, 365, "stale_after_days", warnings);
  const artifactLimitPerWorkspace = parseInteger(
    options.artifactLimitPerWorkspace,
    fieldValue(view, "dashboard.artifactLimitPerWorkspace", DEFAULTS.artifactLimitPerWorkspace),
    10,
    5000,
    "artifact_limit",
    warnings
  );
  const configuredStartupMode = fieldValue(view, "dashboard.startupMode", "on_demand");
  const startupMode = STARTUP_MODES.has(options.startupMode) ? options.startupMode : STARTUP_MODES.has(configuredStartupMode) ? configuredStartupMode : "on_demand";
  if (!STARTUP_MODES.has(configuredStartupMode)) warnings.push("startup_mode_invalid_using_default");
  const maxConfigSnapshots = parseInteger(
    options.maxConfigSnapshots,
    fieldValue(view, "dashboard.configIntegrity.maxSnapshots", DEFAULTS.maxConfigSnapshots),
    1,
    20,
    "config_integrity_max_snapshots",
    warnings
  );
  return {
    enabled: fieldValue(view, "dashboard.enabled", true) !== false,
    home,
    cwd,
    roots,
    rootsConfigured: cliRoots.length > 0 || (Array.isArray(configuredRoots) && configuredRoots.length > 0),
    workspaceOverrides,
    port,
    refreshSeconds,
    staleAfterDays,
    artifactLimitPerWorkspace,
    startupMode,
    showPromptSnippets: options.showPromptSnippets ?? fieldValue(view, "dashboard.showPromptSnippets", DEFAULTS.showPromptSnippets),
    includeGitStatus: options.includeGitStatus ?? fieldValue(view, "dashboard.includeGitStatus", DEFAULTS.includeGitStatus),
    configIntegrityEnabled: options.configIntegrityEnabled ?? fieldValue(view, "dashboard.configIntegrity.enabled", DEFAULTS.configIntegrityEnabled),
    preserveExternalRegistrations: options.preserveExternalRegistrations ?? fieldValue(view, "dashboard.configIntegrity.preserveExternalRegistrations", DEFAULTS.preserveExternalRegistrations),
    maxConfigSnapshots,
    warnings
  };
}

function dataModule() {
  return require("./ravo-data");
}

function poolModule() {
  return require("./ravo-pool");
}

function coreStatusModule(options = {}) {
  const script = resolvePluginScript("ravo-core", "scripts/ravo-status.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.corePluginRoot,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new ApiError("runtime_status_missing", "RAVO Core status entry could not be resolved.", 500);
  return require(script);
}

function coreIntegrityModule(options = {}) {
  if (options.configIntegrity) return options.configIntegrity;
  const script = resolvePluginScript("ravo-core", "scripts/ravo-config-integrity.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.corePluginRoot,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new ApiError("config_integrity_missing", "RAVO Core config-integrity entry could not be resolved.", 500);
  return require(script);
}

function cachedCodexExecutor(options = {}) {
  const cache = new Map();
  return (args, commandOptions = {}) => {
    const key = stableString(args);
    if (cache.has(key)) return clone(cache.get(key));
    const execute = options.executeCodex || ((argv, details) => JSON.parse(execFileSync(options.codexPath || "codex", argv, {
      cwd: details?.cwd || commandOptions.cwd,
      encoding: "utf8",
      timeout: options.commandTimeoutMs || 15000,
      maxBuffer: 8 * 1024 * 1024
    })));
    const value = execute(args.slice(), commandOptions);
    cache.set(key, clone(value));
    return clone(value);
  };
}

function workspaceMap(index) {
  if (index?.workspaceById instanceof Map) return index.workspaceById;
  const workspaces = Array.isArray(index?.workspaces) ? index.workspaces : [];
  return new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
}

function publicRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return { runtimeHealth: "unknown" };
  return {
    status: runtime.status,
    workspace: runtime.workspace,
    marketplaceStatus: runtime.marketplaceStatus,
    pluginStatus: runtime.pluginStatus,
    versionStatus: runtime.versionStatus,
    hookTrustEvidence: runtime.hookTrustEvidence,
    runtimeProbeStatus: runtime.runtimeProbeStatus,
    coreRuntimeStatus: runtime.coreRuntimeStatus || runtime.runtimeProbe?.coreRuntimeStatus || "unknown",
    terminalTelemetryStatus: runtime.terminalTelemetryStatus || runtime.runtimeProbe?.terminalTelemetry?.status || "unknown",
    terminalTelemetry: runtime.terminalTelemetry || runtime.runtimeProbe?.terminalTelemetry || null,
    manifestStatus: runtime.manifestStatus,
    configStatus: runtime.configStatus,
    runtimeHealth: runtime.runtimeHealth,
    fingerprint: runtime.fingerprint,
    pluginFingerprint: runtime.pluginFingerprint,
    configFingerprint: runtime.configFingerprint,
    configIntegrityStatus: runtime.configIntegrityStatus || "unknown",
    selectedSnapshotId: runtime.selectedSnapshotId || "",
    driftSections: runtime.driftSections || [],
    repairRequired: runtime.repairRequired === true,
    configIntegrityApprovalRequired: runtime.configIntegrityApprovalRequired || [],
    expectedHookEvents: runtime.expectedHookEvents || [],
    plugins: (runtime.plugins || []).map((plugin) => ({
      name: plugin.name,
      pluginId: plugin.pluginId,
      installed: plugin.installed,
      enabled: plugin.enabled,
      sourceVersion: plugin.sourceVersion,
      runtimeVersion: plugin.runtimeVersion,
      cacheVersion: plugin.cacheVersion,
      drift: plugin.drift,
      hasHooks: plugin.hasHooks
    })),
    warnings: runtime.warnings || [],
    driftWarnings: runtime.driftWarnings || [],
    recoverySteps: runtime.recoverySteps || [],
    reminders: runtime.reminders || []
  };
}

async function buildIndex(settings, options = {}) {
  const data = options.data || dataModule();
  const common = {
    roots: settings.roots,
    cwd: settings.cwd,
    home: settings.home,
    workspaceOverrides: settings.workspaceOverrides,
    artifactLimitPerWorkspace: settings.artifactLimitPerWorkspace,
    showPromptSnippets: settings.showPromptSnippets,
    includeGitStatus: settings.includeGitStatus,
    staleAfterDays: settings.staleAfterDays,
    now: options.now
  };
  let discovered = [];
  if (typeof data.discoverWorkspaces === "function") {
    const result = await data.discoverWorkspaces(common);
    discovered = Array.isArray(result) ? result : result?.workspaces || [];
  }
  if (!discovered.length && typeof data.buildDashboardIndex === "function") {
    const firstPass = await data.buildDashboardIndex({ ...common, runtimeStatusByWorkspace: new Map(), freshnessByWorkspace: new Map() });
    discovered = Array.isArray(firstPass?.workspaces) ? firstPass.workspaces : [];
  }
  const execute = cachedCodexExecutor(options);
  const { buildStatus } = options.coreStatus || coreStatusModule({ ...options, home: settings.home });
  const runtimeStatusByWorkspace = new Map();
  const freshnessByWorkspace = new Map();
  for (const workspace of discovered) {
    const canonicalPath = workspace.canonicalPath || workspace.path;
    if (!canonicalPath) continue;
    let runtime;
    try {
      runtime = buildStatus(canonicalPath, options.repo || "", { ...options.runtimeOptions, home: settings.home, execute });
    } catch (error) {
      runtime = { runtimeHealth: "error", status: "error", warnings: [safeMessage(error)], recoverySteps: ["Repair the RAVO Core status entry and refresh SoloDesk."] };
    }
    runtimeStatusByWorkspace.set(canonicalPath, runtime);
    try {
      freshnessByWorkspace.set(canonicalPath, buildFreshness(canonicalPath, { runtimeStatus: runtime }));
    } catch (error) {
      freshnessByWorkspace.set(canonicalPath, { status: "error", error: safeMessage(error) });
    }
  }
  if (typeof data.buildDashboardIndex !== "function") throw new ApiError("dashboard_data_missing", "SoloDesk data index entry is unavailable.", 500);
  const index = await data.buildDashboardIndex({
    ...common,
    discoveredWorkspaces: discovered,
    runtimeStatusByWorkspace,
    freshnessByWorkspace
  });
  index.runtimeStatusByWorkspace = runtimeStatusByWorkspace;
  index.freshnessByWorkspace = freshnessByWorkspace;
  index.workspaceById = workspaceMap(index);
  return index;
}

function cleanExpiredTokens(map, now = Date.now()) {
  for (const [token, record] of map.entries()) if (record.expiresAt <= now) map.delete(token);
}

function tokenRecord(map, token, kind) {
  cleanExpiredTokens(map);
  const record = map.get(String(token || ""));
  if (!record || record.kind !== kind) throw new ApiError("confirmation_invalid", "Confirmation token is missing, expired, or does not match this operation.", 403);
  if (record.consumed) throw new ApiError("confirmation_consumed", "Confirmation token was already used.", 409);
  return record;
}

function issueToken(map, value, ttlMs) {
  const token = randomToken();
  const record = { ...value, token, consumed: false, issuedAt: Date.now(), expiresAt: Date.now() + ttlMs };
  map.set(token, record);
  return record;
}

function parseHostHeader(value) {
  try {
    const parsed = new URL(`http://${value}`);
    return { hostname: parsed.hostname.replace(/^\[|\]$/g, ""), port: parsed.port };
  } catch (_error) {
    return { hostname: "", port: "" };
  }
}

function isLoopbackRemote(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(address || ""));
}

function assertLocalRequest(req, state) {
  if (!isLoopbackRemote(req.socket?.remoteAddress)) throw new ApiError("non_loopback_client", "SoloDesk accepts loopback clients only.", 403);
  const host = parseHostHeader(req.headers.host || "");
  if (!LOOPBACK_HOSTS.has(host.hostname)) throw new ApiError("invalid_host", "Request Host must be loopback.", 403);
  if (host.port && state.port && Number(host.port) !== Number(state.port)) throw new ApiError("invalid_host_port", "Request Host port does not match SoloDesk.", 403);
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch (_error) { throw new ApiError("invalid_origin", "Request Origin is invalid.", 403); }
  const originHost = parsed.hostname.replace(/^\[|\]$/g, "");
  const originPort = parsed.port || (parsed.protocol === "http:" ? "80" : "");
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(originHost) || originHost !== host.hostname || Number(originPort) !== Number(state.port)) {
    throw new ApiError("external_origin_rejected", "External Origin is not allowed.", 403);
  }
}

function assertCsrf(req, state) {
  const token = req.headers["x-ravo-csrf-token"];
  if (typeof token !== "string" || token.length !== state.csrfToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(state.csrfToken))) {
    throw new ApiError("csrf_invalid", "A valid SoloDesk CSRF token is required.", 403);
  }
}

function sendJson(res, status, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  res.end(bytes);
}

function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || (error instanceof SyntaxError ? "invalid_json" : "internal_error");
  sendJson(res, status, {
    error: {
      code,
      message: status >= 500 && code === "internal_error" ? "SoloDesk could not complete the request." : safeMessage(error),
      ...(error?.details === undefined ? {} : { details: error.details }),
      ...(Array.isArray(error?.fieldErrors) && error.fieldErrors.length ? { fieldErrors: error.fieldErrors } : {})
    }
  });
}

function readBody(req, limit = DEFAULTS.requestBodyLimit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError("request_too_large", "Request body exceeds the SoloDesk limit.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("invalid_json_body", "JSON body must be an object.", 400);
        resolve(value);
      } catch (error) {
        reject(error instanceof ApiError ? error : new ApiError("invalid_json", "Request body is not valid JSON.", 400));
      }
    });
    req.on("error", reject);
  });
}

function workspaceFor(state, id) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(id || ""))) throw new ApiError("workspace_not_found", "Workspace id was not found.", 404);
  const workspace = state.index?.workspaceById?.get(id);
  if (!workspace) throw new ApiError("workspace_not_found", "Workspace id was not found in the current allowlist index.", 404);
  return workspace;
}

const POOL_WORK_ITEM_FIELDS = new Set([
  "itemType", "subType", "title", "summary", "description", "product", "module", "parentId", "tags",
  "sourceType", "sourceRefs", "sourceExcerpt", "requester", "captureMode", "sourceConfidence", "confirmationStatus",
  "targetUser", "background", "currentState", "scenario", "painPoint", "currentWorkaround", "expectedOutcome",
  "hypothesis", "successMetrics", "references", "nonGoals", "decisionStatus", "decisionOwner", "decisionReason",
  "openQuestions", "assumptions", "scopeBoundary", "priority", "urgency", "userValue", "marketValidationValue",
  "riskReduction", "costOfDelay", "priorityReason", "candidateVersions", "committedVersion", "releaseSlice", "milestone",
  "scopeClass", "deferredToVersion", "deferReason", "targetReleaseAt", "actualReleaseVersion", "actualReleaseAt",
  "estimatedAgentActiveMinutes", "estimatedCalendarMinutes", "estimatedValidationMinutes", "estimatedPmMinutes", "estimatedTokens",
  "estimateMethod", "estimateConfidence", "estimateAssumptions", "actualAgentActiveMinutes", "actualCalendarMinutes",
  "actualValidationMinutes", "actualReviewMinutes", "actualEvidenceMinutes", "actualBlockedMinutes", "actualPmMinutes",
  "actualTokens", "tokenDataSource", "allocationMethod", "costVarianceReason", "deliveryStatus", "currentStage", "startedAt",
  "candidateReadyAt", "completedAt", "owner", "executor", "sessionRefs", "goalRef", "specRef", "gitBaseline", "branch",
  "dependencyIds", "relatedItemIds", "nextAction", "nextActionOwner", "nextActionAt", "blockerStatus", "blockerFingerprint",
  "blockerType", "blockerReason", "blockerOwner", "blockerImpact", "blockerAttemptBudget", "blockerFallback", "recoveryCondition",
  "recoveryEntry", "acceptanceCriteria", "evidenceRequirements", "ev0Status", "ev0Refs", "pmAcceptanceStatus", "pmFeedback",
  "pmAcceptedAt", "gapList", "verificationAdvice", "acceptanceArtifactRef", "releaseStatus", "releaseChannel", "releaseCommit",
  "releaseTag", "releaseUrl", "releaseNotes", "rollbackPlan", "rollbackStatus", "ev1Feedback", "ev2EvidenceRefs",
  "validationConclusion", "followUpIds"
]);
const POOL_KNOWLEDGE_FIELDS = new Set([
  "kind", "title", "summary", "content", "status", "scope", "tags", "source", "sourceRefs", "applicability",
  "nonApplicability", "sensitivity", "redactionStatus", "evidenceLevel", "confidence", "confirmedBy", "confirmedAt",
  "confirmationStatus", "lastVerifiedAt", "reviewAfter", "lastUsedAt", "useCount", "reuseOutcome", "stalenessReason",
  "relatedRequirements", "relatedIssues", "relatedSpecs", "relatedKnowledge", "duplicateOf", "supersededBy"
]);

function boundedPoolValue(value) {
  if (typeof value === "string") return value.slice(0, 24000);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => typeof entry === "string" ? entry.slice(0, 2000) : entry);
  return value;
}

function poolPayload(body, kind) {
  const fields = kind === "requirements" ? POOL_WORK_ITEM_FIELDS : POOL_KNOWLEDGE_FIELDS;
  return Object.fromEntries(Object.entries(body || {}).filter(([key]) => fields.has(key)).map(([key, value]) => [key, boundedPoolValue(value)]));
}

function poolKind(value) {
  if (value === "requirements" || value === "knowledge") return value;
  throw new ApiError("pool_kind_invalid", "Pool kind must be requirements or knowledge.", 400);
}

function poolAction(action) {
  try {
    return action();
  } catch (error) {
    const raw = String(error?.message || "pool_error");
    const code = raw.split(":", 1)[0] || "pool_error";
    const status = /revision_conflict/.test(code) ? 409 : /not_found/.test(code) ? 404 : /invalid|exists|same_item/.test(code) ? 422 : 500;
    throw new ApiError(code, safeMessage(error), status, status === 409 ? { recovery: "重新加载当前记录后再提交。" } : undefined);
  }
}

function publicArtifact(artifact) {
  return {
    id: artifact.id,
    module: artifact.module,
    format: artifact.format,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    status: artifact.status,
    schemaVersion: artifact.schemaVersion,
    subjectRef: artifact.subjectRef,
    relatedArtifact: artifact.relatedArtifact,
    releaseRef: artifact.releaseRef,
    sourceRefs: artifact.sourceRefs || [],
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    relativePath: artifact.relativePath,
    size: artifact.size
  };
}

function publicLineageArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return null;
  const artifactPath = artifact.relativePath || artifact.artifactPath || "";
  return {
    ...publicArtifact({ ...artifact, relativePath: artifactPath }),
    artifactPath,
    selectionReason: artifact.selectionReason || "",
    relationStatus: artifact.relationStatus || (artifactPath ? "matched" : "unknown"),
    lineageKey: artifact.lineageKey || "",
    supersededArtifacts: artifact.supersededArtifacts || [],
    status: artifact.status || artifact.reviewStatus || "unknown",
    reviewStatus: artifact.reviewStatus || "",
    sourceRefs: artifact.sourceRefs || []
  };
}

function publicWorkspaceSummary(workspace) {
  return {
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    displayName: workspace.displayName,
    canonicalPath: workspace.canonicalPath,
    discoverySource: workspace.discoverySource,
    ravoPresent: workspace.ravoPresent,
    priority: workspace.priority,
    lifecycle: workspace.lifecycle,
    lastIndexedAt: workspace.lastIndexedAt,
    dataStatus: workspace.dataStatus,
    activityStatus: workspace.activityStatus,
    deliveryStatus: workspace.deliveryStatus,
    reviewStatus: workspace.reviewStatus,
    freshness: workspace.freshness,
    confidence: workspace.confidence,
    sourceRefs: workspace.sourceRefs || [],
    derivedAt: workspace.derivedAt,
    sourceUpdatedAt: workspace.sourceUpdatedAt,
    summary: workspace.summary || {},
    pmBrief: workspace.pmBrief || null,
    pool: workspace.pool || { requirements: { count: 0 }, knowledge: { count: 0 } },
    states: workspace.states || {},
    primaryAttention: workspace.primaryAttention || null,
    suggestions: workspace.suggestions || [],
    shortcutActions: workspace.shortcutActions || [],
    shortcutMenuActions: workspace.shortcutMenuActions || [],
    authoritativeWorkstream: publicLineageArtifact(workspace.authoritativeWorkstream),
    selectedAcceptance: publicLineageArtifact(workspace.selectedAcceptance),
    releaseReview: publicLineageArtifact(workspace.releaseReview),
    openAnalysisReviews: workspace.openAnalysisReviews || [],
    laneStatus: Object.fromEntries(Object.entries(workspace.lanes || {}).map(([name, lane]) => [name, {
      status: lane.status,
      summary: lane.summary,
      freshness: lane.freshness,
      confidence: lane.confidence,
      sourceRefs: lane.sourceRefs || []
    }])),
    warningCount: Array.isArray(workspace.warnings) ? workspace.warnings.length : 0
  };
}

function publicWorkspaceDetail(workspace) {
  return {
    ...publicWorkspaceSummary(workspace),
    currentGoal: workspace.currentGoal || "",
    specPath: workspace.specPath || "",
    activeMilestone: workspace.activeMilestone || "",
    roadmapAudit: workspace.roadmapAudit || [],
    openDecisions: workspace.openDecisions || [],
    blockers: workspace.blockers || [],
    executionLanes: workspace.executionLanes || {},
    executionDecisions: workspace.executionDecisions || [],
    authorizationEnvelopes: workspace.authorizationEnvelopes || [],
    effectiveDeliveryProfile: workspace.effectiveDeliveryProfile || {},
    executionTiming: workspace.executionTiming || {},
    capabilityRoutes: workspace.capabilityRoutes || [],
    pendingCodexVerification: workspace.pendingCodexVerification || [],
    pendingPmVerification: workspace.pendingPmVerification || [],
    relevantKnowledge: workspace.relevantKnowledge || [],
    dataGaps: workspace.dataGaps || [],
    runtime: workspace.runtime || {},
    freshnessState: workspace.freshnessState || {},
    details: workspace.details || {},
    pool: workspace.pool || { requirements: { count: 0 }, knowledge: { count: 0 } },
    lanes: workspace.lanes || {},
    attentionItems: workspace.attentionItems || [],
    timeline: workspace.timeline || [],
    artifacts: (workspace.artifacts || []).map(publicArtifact),
    sessions: workspace.sessions || [],
    warnings: workspace.warnings || []
  };
}

function filteredWorkspaceSummaries(index, url) {
  let workspaces = Array.isArray(index?.workspaces) ? index.workspaces : [];
  const lifecycle = url.searchParams.get("lifecycle") || "default";
  if (lifecycle === "default") workspaces = workspaces.filter((workspace) => workspace.lifecycle !== "archived");
  else if (lifecycle !== "all") {
    if (!new Set(["active", "paused", "archived"]).has(lifecycle)) throw new ApiError("invalid_lifecycle_filter", "Lifecycle filter is invalid.", 400);
    workspaces = workspaces.filter((workspace) => workspace.lifecycle === lifecycle);
  }
  const priority = url.searchParams.get("priority") || "all";
  if (priority !== "all") {
    if (!new Set(["high", "normal", "low"]).has(priority)) throw new ApiError("invalid_priority_filter", "Priority filter is invalid.", 400);
    workspaces = workspaces.filter((workspace) => workspace.priority === priority);
  }
  const lane = url.searchParams.get("lane") || "";
  if (lane) {
    if (!new Set(["Reason", "Act", "Verify", "Organize", "Runtime"]).has(lane)) throw new ApiError("invalid_lane_filter", "Lane filter is invalid.", 400);
    workspaces = workspaces.filter((workspace) => ["attention", "blocked"].includes(workspace.lanes?.[lane]?.status));
  }
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 120);
  if (query) workspaces = workspaces.filter((workspace) => `${workspace.displayName || workspace.name} ${workspace.canonicalPath}`.toLowerCase().includes(query));
  return workspaces.map(publicWorkspaceSummary);
}

function configOptions(state, body = {}, query = null) {
  const scope = body.scope || query?.get("scope") || "user";
  if (!new Set(["user", "workspace"]).has(scope)) throw new ApiError("invalid_scope", "Config scope must be user or workspace.", 400);
  if (scope === "user") return { home: state.settings.home, scope };
  const workspaceId = body.workspaceId || query?.get("workspaceId") || "";
  const workspace = workspaceFor(state, workspaceId);
  return { home: state.settings.home, scope, workspace: workspace.canonicalPath };
}

function runChild(file, args, input, options = {}) {
  const configuredTimeout = Number(options.timeoutMs);
  const timeoutMs = configuredTimeout === 0
    ? 0
    : Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.ceil(configuredTimeout) : REVIEW_PROCESS_TIMEOUT_MS;
  if (options.executeReview) return Promise.resolve(options.executeReview(file, args.slice(), input, { onProgress: options.onProgress, timeoutMs }));
  return new Promise((resolve, reject) => {
    let progressBuffer = "";
    const child = execFile(process.execPath, [file, ...args], {
      cwd: options.cwd,
      env: options.env || process.env,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const diagnostic = String(stderr || "").split(/\r?\n/).filter((line) => !line.startsWith("RAVO_PROGRESS ")).join(" ") || error;
        const failure = new ApiError("review_runner_failed", `RAVO Review runner failed: ${safeMessage(diagnostic)}`, 502);
        failure.cause = error;
        reject(failure);
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (_error) {
        reject(new ApiError("review_runner_invalid_output", "RAVO Review runner returned invalid JSON.", 502));
      }
    });
    if (typeof options.onProgress === "function") child.stderr.on("data", (chunk) => {
      progressBuffer += chunk.toString("utf8");
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("RAVO_PROGRESS ")) continue;
        try { options.onProgress(JSON.parse(line.slice("RAVO_PROGRESS ".length))); } catch (_error) { /* Ignore malformed advisory progress. */ }
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}

function reviewProcessTimeoutMs(preview, fallback = REVIEW_PROCESS_TIMEOUT_MS) {
  const rawMaximumRunMs = preview?.callPlan?.maximumRunMs;
  if (rawMaximumRunMs === undefined || rawMaximumRunMs === null) return fallback;
  const maximumRunMs = Number(rawMaximumRunMs);
  if (!Number.isSafeInteger(maximumRunMs) || maximumRunMs <= 0) {
    throw new ApiError("review_plan_runtime_invalid", "Review preview maximumRunMs is invalid.", 409);
  }
  const marginMs = Math.min(REVIEW_PROCESS_MARGIN_MAX_MS, Math.max(REVIEW_PROCESS_MARGIN_MIN_MS, Math.ceil(maximumRunMs * 0.05)));
  const processTimeoutMs = maximumRunMs + marginMs;
  return Math.min(processTimeoutMs, NODE_TIMER_MAX_MS);
}

function reviewScript(state) {
  const file = resolvePluginScript("ravo-review", "scripts/run-review.js", {
    fromDir: __dirname,
    home: state.settings.home,
    explicitRoot: state.options.reviewPluginRoot,
    execute: state.options.executeCodex,
    codexPath: state.options.codexPath
  });
  if (!file) throw new ApiError("review_runner_missing", "RAVO Review runner could not be resolved.", 500);
  return file;
}

function upgradeScript(state) {
  const file = path.join(__dirname, "ravo-upgrade.js");
  if (!fs.existsSync(file)) throw new ApiError("upgrade_runner_missing", "RAVO upgrade program could not be resolved.", 500);
  return file;
}

function runUpgradeCommand(state, args, input = "") {
  if (state.options.executeUpgrade) return Promise.resolve(state.options.executeUpgrade(upgradeScript(state), args.slice(), input));
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [upgradeScript(state), ...args], {
      cwd: state.settings.cwd,
      env: { ...process.env, HOME: state.settings.home },
      encoding: "utf8",
      timeout: state.options.upgradeTimeoutMs || 30 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new ApiError("upgrade_runner_failed", `RAVO upgrade program failed: ${safeMessage(stderr || error)}`, 502));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (_error) {
        reject(new ApiError("upgrade_runner_invalid_output", "RAVO upgrade program returned invalid JSON.", 502));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function reviewArgs(workspace, body, mode, runId = "") {
  const args = [
    "--workspace", workspace.canonicalPath,
    "--domain", String(body.domain || "general").slice(0, 80),
    "--subject-ref", String(body.subjectRef || hash(body.subject || "")).slice(0, 200),
    "--data-boundary", body.dataBoundary,
    "--authorization-source", "explicit_user_action"
  ];
  args.push("--run-class", body.mode === "test" ? "diagnostic" : "formal");
  if (mode === "preview") args.push("--preview");
  if (runId) args.push("--review-run-id", runId);
  if (body.confirmSensitive === true) args.push("--confirm-sensitive");
  if (Number.isInteger(body.rounds) && body.rounds >= 1 && body.rounds <= 3) args.push("--rounds", String(body.rounds));
  if (body.noStream === true) args.push("--no-stream");
  const models = Array.isArray(body.providerModelKeys) ? body.providerModelKeys : [];
  for (const key of models) {
    if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/.test(String(key))) throw new ApiError("invalid_provider_model", "Provider/model key is invalid.", 400);
    args.push("--model", key);
  }
  for (const summary of Array.isArray(body.redactionSummary) ? body.redactionSummary.slice(0, 20) : []) args.push("--redaction-summary", String(summary).slice(0, 200));
  return args;
}

function validateReviewPreviewBody(body) {
  const mode = body.mode || "run";
  if (!REVIEW_MODES.has(mode)) throw new ApiError("invalid_review_mode", "Review mode must be run or test.", 400);
  const dataBoundary = body.dataBoundary || "safe_sanitized";
  if (!REVIEW_BOUNDARIES.has(dataBoundary)) throw new ApiError("invalid_data_boundary", "Review data boundary is invalid.", 400);
  if (mode === "run" && (typeof body.subject !== "string" || !body.subject.trim())) throw new ApiError("review_subject_required", "Review subject is required.", 400);
  const normalized = { ...body, mode, dataBoundary };
  if (mode === "test") {
    if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/.test(String(body.providerModelKey || ""))) {
      throw new ApiError("provider_model_required", "Provider test requires one provider/model key.", 400);
    }
    normalized.subject = "Generic non-sensitive SoloDesk provider connectivity test.";
    normalized.providerModelKeys = [body.providerModelKey];
    normalized.dataBoundary = "safe_sanitized";
    normalized.confirmSensitive = false;
  }
  return normalized;
}

function reviewPlanIdentity(preview) {
  return stableString({
    configFingerprint: preview?.callPlan?.configFingerprint,
    subjectHash: preview?.callPlan?.subjectHash,
    dataBoundary: preview?.callPlan?.dataBoundary,
    requestedPairs: preview?.callPlan?.requestedPairs,
    fallbackPairs: preview?.callPlan?.fallbackPairs,
    rounds: preview?.callPlan?.rounds,
    runClass: preview?.callPlan?.runClass,
    formalEvidenceEligible: preview?.callPlan?.formalEvidenceEligible,
    maxAttempts: preview?.callPlan?.maxAttempts,
    outputBudgets: preview?.callPlan?.outputBudgets,
    maximumRequests: preview?.callPlan?.maximumRequests,
    maximumRunMs: preview?.callPlan?.maximumRunMs
  });
}

function configMigrationIdentity(moduleId, options, validation) {
  return stableString({
    moduleId,
    scope: options.scope,
    workspace: options.workspace || "",
    previewId: validation?.migrationPreview?.previewId || "",
    candidateFingerprint: validation?.redactedConfigFingerprint || ""
  });
}

function publicReviewPreview(preview) {
  const value = clone(preview) || {};
  delete value.configPath;
  return value;
}

async function createReviewPreview(state, rawBody) {
  const body = validateReviewPreviewBody(rawBody);
  const workspace = workspaceFor(state, body.workspaceId);
  const preview = await runChild(reviewScript(state), reviewArgs(workspace, body, "preview"), body.subject, {
    ...state.options,
    cwd: workspace.canonicalPath
  });
  if (preview.status !== "ok") return { preview: publicReviewPreview(preview), confirmationToken: "", expiresAt: "" };
  const allowed = preview.callPlan?.dataBoundary?.externalCallAllowed === true;
  if (!allowed) return { preview: publicReviewPreview(preview), confirmationToken: "", expiresAt: "" };
  const issued = issueToken(state.reviewTokens, {
    kind: `review_${body.mode}`,
    workspaceId: workspace.workspaceId,
    body,
    planIdentity: reviewPlanIdentity(preview)
  }, state.options.tokenTtlMs || DEFAULTS.tokenTtlMs);
  return { preview: publicReviewPreview(preview), confirmationToken: issued.token, expiresAt: new Date(issued.expiresAt).toISOString() };
}

async function verifyReviewToken(state, body, mode) {
  const record = tokenRecord(state.reviewTokens, body.confirmationToken, `review_${mode}`);
  const workspace = workspaceFor(state, record.workspaceId);
  const fresh = await runChild(reviewScript(state), reviewArgs(workspace, record.body, "preview"), record.body.subject, {
    ...state.options,
    cwd: workspace.canonicalPath
  });
  if (fresh.status !== "ok" || reviewPlanIdentity(fresh) !== record.planIdentity) {
    throw new ApiError("review_preview_stale", "Review preview is stale because configuration, selection, or data-boundary evidence changed.", 409);
  }
  record.consumed = true;
  return { record, workspace, fresh };
}

function reviewRunView(run) {
  return {
    reviewRunId: run.reviewRunId,
    mode: run.mode,
    workspaceId: run.workspaceId,
    status: run.status,
    progress: run.progress,
    startedAt: run.startedAt,
    endedAt: run.endedAt || "",
    ...(run.result ? { result: run.result } : {}),
    ...(run.error ? { error: run.error } : {})
  };
}

function recordReviewProgress(run, event) {
  run.progress.lastEvent = event.type || "unknown";
  run.progress.currentRound = event.round || run.progress.currentRound;
  run.progress.updatedAt = event.emittedAt || new Date().toISOString();
  if (event.providerModelKey) run.progress.pairs[event.providerModelKey] = {
    round: event.round,
    attempt: event.attempt,
    attemptType: event.attemptType,
    result: event.result,
    reason: event.reason,
    parserStatus: event.parserStatus,
    providerStatus: event.providerStatus,
    finishReason: event.finishReason,
    incompleteReason: event.incompleteReason,
    timeoutType: event.timeoutType,
    partialBytes: event.partialBytes,
    partialResponseRef: event.partialResponseRef,
    remainingAttemptBudget: event.remainingAttemptBudget,
    plannedDelayMs: event.plannedDelayMs,
    actualDelayMs: event.actualDelayMs
  };
  run.progress.events.push(event);
  if (run.progress.events.length > 100) run.progress.events.splice(0, run.progress.events.length - 100);
}

async function startReviewRun(state, body) {
  const { record, workspace, fresh } = await verifyReviewToken(state, body, "run");
  const reviewRunId = `solodesk-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(5).toString("hex")}`;
  const run = {
    reviewRunId,
    mode: "run",
    workspaceId: workspace.workspaceId,
    status: "running",
    progress: { lastEvent: "queued", currentRound: 0, updatedAt: new Date().toISOString(), pairs: {}, events: [] },
    startedAt: new Date().toISOString(),
    endedAt: "",
    result: null,
    error: null
  };
  state.reviewRuns.set(reviewRunId, run);
  runChild(reviewScript(state), reviewArgs(workspace, record.body, "run", reviewRunId), record.body.subject, {
    ...state.options,
    cwd: workspace.canonicalPath,
    env: { ...process.env, RAVO_REVIEW_PROGRESS: "jsonl" },
    timeoutMs: reviewProcessTimeoutMs(fresh, state.options.timeoutMs || REVIEW_PROCESS_TIMEOUT_MS),
    onProgress: (event) => recordReviewProgress(run, event)
  }).then((result) => {
    run.status = "completed";
    run.endedAt = new Date().toISOString();
    run.result = result;
    state.refresh("review_complete").catch(() => {});
  }).catch((error) => {
    run.status = "failed";
    run.endedAt = new Date().toISOString();
    run.error = { code: error.code || "review_failed", message: safeMessage(error) };
  });
  return reviewRunView(run);
}

async function runProviderTest(state, body) {
  const { record, workspace, fresh } = await verifyReviewToken(state, body, "test");
  const pair = record.body.providerModelKey;
  if (!fresh.callPlan?.requestedPairs?.includes(pair)) throw new ApiError("provider_test_pair_stale", "Provider/model pair is no longer part of the confirmed preview.", 409);
  const args = reviewArgs(workspace, record.body, "run");
  args.push("--provider-test", pair);
  const result = await runChild(reviewScript(state), args, record.body.subject, {
    ...state.options,
    cwd: workspace.canonicalPath,
    timeoutMs: reviewProcessTimeoutMs(fresh, state.options.timeoutMs || REVIEW_PROCESS_TIMEOUT_MS)
  });
  state.refresh("provider_test_complete").catch(() => {});
  return result;
}

function updatePlanIdentity(check, plan) {
  return stableString({
    sourceFingerprint: check.sourceFingerprint,
    runtimeFingerprint: check.runtimeFingerprint,
    targetVersion: plan.targetVersion,
    requiredPlugins: plan.requiredPlugins,
    pluginActions: plan.pluginActions
  });
}

async function checkForUpdates(state) {
  const check = await Promise.resolve(state.options.checkUpdates
    ? state.options.checkUpdates({ home: state.settings.home, refresh: true })
    : runUpgradeCommand(state, ["--check", "--refresh"]));
  state.updateState = check;
  if (check.marketplaceStatus !== "present" || check.status === "error") return { check, plan: null, confirmationToken: "", expiresAt: "" };
  const plan = createUpgradePlan(check);
  const issued = issueToken(state.upgradeTokens, {
    kind: "upgrade_apply",
    check,
    plan,
    planIdentity: updatePlanIdentity(check, plan)
  }, state.options.tokenTtlMs || DEFAULTS.tokenTtlMs);
  return { check, plan, confirmationToken: issued.token, expiresAt: new Date(issued.expiresAt).toISOString() };
}

async function applyConfirmedUpdate(state, body) {
  const record = tokenRecord(state.upgradeTokens, body.confirmationToken, "upgrade_apply");
  if (body.planId !== record.plan.planId) throw new ApiError("upgrade_plan_mismatch", "Upgrade plan id does not match the confirmation token.", 409);
  const current = await Promise.resolve(state.options.checkUpdates
    ? state.options.checkUpdates({ home: state.settings.home, refresh: false })
    : runUpgradeCommand(state, ["--check"]));
  if (current.marketplaceStatus !== "present" || current.status === "error" || updatePlanIdentity(current, record.plan) !== record.planIdentity) {
    throw new ApiError("upgrade_plan_stale", "Upgrade plan is stale; check updates again before applying.", 409);
  }
  record.consumed = true;
  const workspaces = [...state.index.workspaceById.values()].map((workspace) => workspace.canonicalPath);
  const result = await Promise.resolve(state.options.applyUpgrade
    ? state.options.applyUpgrade(record.plan, { home: state.settings.home, workspaces })
    : runUpgradeCommand(state, ["--apply-plan-stdin"], JSON.stringify({ plan: record.plan, workspaces })));
  state.updateState = current;
  await state.refresh("upgrade_complete").catch(() => {});
  return result;
}

function latestRuntime(index) {
  const entries = [...(index?.runtimeStatusByWorkspace?.values?.() || [])];
  if (!entries.length) return { runtimeHealth: "unknown", workspaces: [] };
  const rank = { error: 6, missing: 5, degraded: 4, configured_unverified: 3, core_verified: 2, healthy: 1, unknown: 0 };
  const worst = entries.slice().sort((left, right) => (rank[right.runtimeHealth] || 0) - (rank[left.runtimeHealth] || 0))[0];
  return {
    runtimeHealth: worst.runtimeHealth,
    workspaces: entries.map(publicRuntime)
  };
}

function integrityWorkspace(state) {
  const workspaces = [...(state.index?.workspaceById?.values?.() || [])];
  return workspaces.find((workspace) => workspace.canonicalPath === state.settings.cwd)?.canonicalPath
    || workspaces[0]?.canonicalPath
    || state.settings.cwd;
}

function runtimeForIntegrity(state) {
  const { buildStatus } = state.options.coreStatus || coreStatusModule({ ...state.options, home: state.settings.home });
  return buildStatus(integrityWorkspace(state), state.options.repo || "", {
    home: state.settings.home,
    codexPath: state.options.codexPath,
    commandTimeoutMs: state.options.commandTimeoutMs,
    execute: state.options.executeCodex
  });
}

function integrityOptions(state, runtimeStatus, extra = {}) {
  return {
    home: state.settings.home,
    workspace: integrityWorkspace(state),
    runtimeStatus,
    codexPath: state.options.codexPath,
    commandTimeoutMs: state.options.commandTimeoutMs,
    maxSnapshots: state.settings.maxConfigSnapshots,
    preserveExternalRegistrations: state.settings.preserveExternalRegistrations,
    ravoVersion: state.serviceVersion,
    validateToml: state.options.validateCodexToml,
    pluginCheck: state.options.integrityPluginCheck,
    now: state.options.now,
    ...extra
  };
}

function boundedStringArray(value, field, max = MAX_EXTERNAL_SECTIONS_PER_REPAIR) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > MAX_REPAIR_INPUT_STRING_LENGTH)) {
    throw new ApiError("config_integrity_input_invalid", `${field} must be a bounded string array.`, 422);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function publicSnapshot(result) {
  const snapshot = result?.snapshot || {};
  return {
    status: result?.status || "unknown",
    recommended: result?.recommended === true,
    snapshot: {
      snapshotId: snapshot.snapshotId || "",
      createdAt: snapshot.createdAt || "",
      sourceHash: snapshot.sourceHash || "",
      ravoVersion: snapshot.ravoVersion || "",
      pluginFingerprint: snapshot.pluginFingerprint || "",
      runtimeVerified: snapshot.runtimeVerified === true,
      trustLevel: snapshot.runtimeVerified === true ? "runtime_verified" : "configured_unverified",
      reason: snapshot.reason || ""
    }
  };
}

function fallbackContinuation(workspace) {
  return workspace.continuation || {
    workspace: workspace.canonicalPath,
    currentGoal: workspace.currentGoal || "",
    decisionCompleteSpec: workspace.specPath || workspace.states?.spec?.specPath || "",
    specHealth: workspace.states?.spec?.status || "unknown",
    activeMilestone: workspace.activeMilestone || "",
    roadmapAudit: workspace.roadmapAudit || [],
    openDecisions: workspace.openDecisions || [],
    blockers: workspace.blockers || [],
    pendingCodexVerification: workspace.pendingCodexVerification || [],
    pendingPmVerification: workspace.pendingPmVerification || [],
    recentActivity: (workspace.timeline || []).slice(0, 8),
    relevantKnowledge: workspace.relevantKnowledge || [],
    runtimeHealth: workspace.lanes?.Runtime?.summary || workspace.runtime?.runtimeHealth || "unknown",
    sourceRefs: workspace.sourceRefs || [],
    dataGaps: workspace.dataGaps || [],
    requestedAction: workspace.suggestions?.[0]?.action || "Inspect the current evidence and choose the next bounded action.",
    evidenceBoundary: "Dashboard status is derived from local evidence and does not replace real E2E or PM acceptance."
  };
}

function fallbackShortcut(workspace, kind) {
  const brief = fallbackContinuation(workspace);
  return {
    kind,
    workspaceId: workspace.workspaceId,
    prompt: [
      `Workspace: ${workspace.canonicalPath}`,
      `Action: ${kind}`,
      `Current status: ${workspace.primaryAttention?.title || workspace.deliveryStatus || "unknown"}`,
      `Runtime: ${brief.runtimeHealth}`,
      `Freshness/confidence: ${workspace.freshness || "unknown"}/${workspace.confidence || "low"}`,
      `Source refs: ${(brief.sourceRefs || []).join(", ") || "none"}`,
      "Constraint: preserve evidence boundaries; do not claim completion without required verification.",
      "Expected output: execute or propose the next bounded action and list remaining evidence gaps."
    ].join("\n"),
    sourceRefs: brief.sourceRefs || [],
    dataGaps: brief.dataGaps || []
  };
}

function shortcutOptions(state, url) {
  const dataBoundary = url.searchParams.get("dataBoundary") || "local_prompt_only";
  if (!SHORTCUT_BOUNDARIES.has(dataBoundary)) throw new ApiError("invalid_shortcut_data_boundary", "Shortcut data boundary is invalid.", 400);
  return {
    home: state.settings.home,
    dataBoundary,
    corePluginRoot: state.options.corePluginRoot,
    knowledgePluginRoot: state.options.knowledgePluginRoot,
    executeCodex: state.options.executeCodex,
    codexPath: state.options.codexPath,
    now: state.options.now
  };
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  })[ext] || "application/octet-stream";
}

function serveStatic(res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end();
    return;
  }
  const appRoot = path.resolve(__dirname, "..", "app");
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(appRoot, relative);
  if (file !== appRoot && !file.startsWith(`${appRoot}${path.sep}`)) throw new ApiError("static_path_rejected", "Static path is invalid.", 404);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError("not_found", "Resource was not found.", 404);
  const bytes = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": contentType(file),
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  res.end(bytes);
}

async function routeApi(req, res, state, url) {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      status: state.index ? "ok" : "starting",
      service: "ravo-solodesk",
      version: state.serviceVersion,
      instanceId: state.instanceId,
      pid: process.pid,
      serviceVersion: state.serviceVersion,
      pluginVersion: state.pluginVersion,
      pluginFingerprint: state.pluginFingerprint,
      installedRoot: state.installedRoot,
      actualEntrypoint: state.actualEntrypoint,
      resolutionSource: state.resolutionSource,
      controllerVersion: state.controllerVersion,
      restartRequired: state.restartRequired,
      restartReason: state.restartReason || "",
      restartScheduledAt: state.restartScheduledAt || "",
      startupMode: state.startupMode,
      mutation: mutationView(state),
      listening: { host: state.host, port: state.port },
      csrfToken: state.csrfToken,
      refresh: state.refreshState,
      rootsConfigured: state.settings.rootsConfigured,
      warnings: state.settings.warnings
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/runtime") {
    sendJson(res, 200, latestRuntime(state.index));
    return;
  }
  if (req.method === "GET" && pathname === "/api/service/status") {
    sendJson(res, 200, publicServiceStatus(state));
    return;
  }
  if (req.method === "GET" && pathname === "/api/config-integrity/status") {
    if (state.settings.configIntegrityEnabled === false) throw new ApiError("config_integrity_disabled", "Config integrity is disabled in RAVO settings.", 409);
    const module = coreIntegrityModule({ ...state.options, home: state.settings.home });
    const runtimeStatus = runtimeForIntegrity(state);
    sendJson(res, 200, {
      ...module.getIntegrityStatus(integrityOptions(state, runtimeStatus)),
      journals: module.listRepairJournals({ home: state.settings.home })
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/config-integrity/snapshot") {
    if (state.settings.configIntegrityEnabled === false) throw new ApiError("config_integrity_disabled", "Config integrity is disabled in RAVO settings.", 409);
    const module = coreIntegrityModule({ ...state.options, home: state.settings.home });
    const runtimeStatus = runtimeForIntegrity(state);
    const result = module.createSnapshot(integrityOptions(state, runtimeStatus, { reason: "manual_known_good" }));
    sendJson(res, 200, publicSnapshot(result));
    return;
  }
  if (req.method === "POST" && pathname === "/api/config-integrity/preview") {
    if (state.settings.configIntegrityEnabled === false) throw new ApiError("config_integrity_disabled", "Config integrity is disabled in RAVO settings.", 409);
    const body = await readBody(req, state.options.requestBodyLimit);
    const selectedExternalSections = boundedStringArray(body.selectedExternalSections, "selectedExternalSections");
    const reenablePlugins = boundedStringArray(body.reenablePlugins, "reenablePlugins", MAX_REENABLE_PLUGINS_PER_REPAIR);
    if (body.snapshotId !== undefined && (typeof body.snapshotId !== "string" || body.snapshotId.length > 200)) throw new ApiError("config_integrity_input_invalid", "snapshotId is invalid.", 422);
    const module = coreIntegrityModule({ ...state.options, home: state.settings.home });
    const runtimeStatus = runtimeForIntegrity(state);
    const plan = module.previewRepair(integrityOptions(state, runtimeStatus, {
      snapshotId: body.snapshotId || "",
      selectedExternalSections,
      reenablePlugins
    }));
    const actionable = plan.managedChanges.length > 0 || plan.externalPreservedChanges.length > 0;
    const issued = actionable ? issueToken(state.integrityTokens, { kind: "config_integrity_apply", plan }, state.options.tokenTtlMs || DEFAULTS.tokenTtlMs) : null;
    sendJson(res, 200, {
      plan,
      confirmationToken: issued?.token || "",
      expiresAt: issued ? new Date(issued.expiresAt).toISOString() : ""
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/config-integrity/apply") {
    if (state.settings.configIntegrityEnabled === false) throw new ApiError("config_integrity_disabled", "Config integrity is disabled in RAVO settings.", 409);
    const body = await readBody(req, state.options.requestBodyLimit);
    const record = tokenRecord(state.integrityTokens, body.confirmationToken, "config_integrity_apply");
    if (body.planId !== record.plan.planId) throw new ApiError("config_integrity_plan_mismatch", "Repair plan id does not match the confirmation token.", 409);
    record.consumed = true;
    const module = coreIntegrityModule({ ...state.options, home: state.settings.home });
    const runtimeStatus = runtimeForIntegrity(state);
    const result = module.applyRepair(record.plan, integrityOptions(state, runtimeStatus, {
      statusCheck: () => runtimeForIntegrity(state)
    }));
    await state.refresh("config_integrity_repaired").catch(() => {});
    let snapshot = null;
    if (result.status === "succeeded" && !result.approvalRequired.length && !result.unresolvedRequired.length) {
      try { snapshot = publicSnapshot(module.createSnapshot(integrityOptions(state, runtimeForIntegrity(state), { reason: "post_repair_readback" }))).snapshot; }
      catch (_error) { snapshot = null; }
    }
    sendJson(res, 200, { ...result, snapshot });
    return;
  }
  if (req.method === "POST" && pathname === "/api/config-integrity/recover") {
    if (state.settings.configIntegrityEnabled === false) throw new ApiError("config_integrity_disabled", "Config integrity is disabled in RAVO settings.", 409);
    const body = await readBody(req, state.options.requestBodyLimit);
    if (typeof body.repairId !== "string" || body.repairId.length > 200) throw new ApiError("config_integrity_input_invalid", "repairId is invalid.", 422);
    const module = coreIntegrityModule({ ...state.options, home: state.settings.home });
    const result = module.recoverRepair(body.repairId, { home: state.settings.home, now: state.options.now });
    await state.refresh("config_integrity_recovered").catch(() => {});
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && pathname === "/api/service/restart") {
    const blockers = restartBlockers(state);
    if (blockers.draining || blockers.mutations.length || blockers.reviewRunIds.length) {
      throw new ApiError("service_busy", "SoloDesk is busy and cannot hand off a restart yet.", 409, blockers);
    }
    markRestartRequired(state, "api_restart_requested");
    const scheduled = scheduleControllerRestart(state, "api_restart_requested");
    sendJson(res, 202, {
      status: scheduled ? "restart_scheduled" : "restart_required",
      service: publicServiceStatus(state),
      restartHandoff: { required: true, reason: "api_restart_requested", scheduled }
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/attention") {
    sendJson(res, 200, { attention: state.index?.attention || [], generatedAt: state.index?.generatedAt || "" });
    return;
  }
  if (req.method === "GET" && pathname === "/api/workspaces") {
    sendJson(res, 200, {
      workspaces: filteredWorkspaceSummaries(state.index, url),
      metrics: state.index?.metrics || {},
      sessionDataStatus: state.index?.sessionDataStatus || "unknown",
      warnings: state.index?.warnings || [],
      generatedAt: state.index?.generatedAt || ""
    });
    return;
  }
  let match = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (req.method === "GET" && match) {
    sendJson(res, 200, { workspace: publicWorkspaceDetail(workspaceFor(state, match[1])) });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/pool\/(requirements|knowledge)$/);
  if (match && req.method === "GET") {
    const workspace = workspaceFor(state, match[1]);
    const kind = poolKind(match[2]);
    const pool = poolModule();
    sendJson(res, 200, { workspaceId: workspace.workspaceId, ...poolAction(() => pool.listPool(workspace.canonicalPath, kind, {
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
      itemType: url.searchParams.get("itemType") || "",
      priority: url.searchParams.get("priority") || "",
      version: url.searchParams.get("version") || "",
      sort: url.searchParams.get("sort") || "updatedAt",
      direction: url.searchParams.get("direction") || "desc",
      view: url.searchParams.get("view") === "agent" ? "agent" : "pm",
      limit: url.searchParams.get("limit") || 100,
      offset: url.searchParams.get("offset") || 0
    })) });
    return;
  }
  if (match && req.method === "POST") {
    const workspace = workspaceFor(state, match[1]);
    const kind = poolKind(match[2]);
    const body = await readBody(req, state.options.requestBodyLimit);
    const result = poolAction(() => poolModule().createPoolRecord(workspace.canonicalPath, kind, poolPayload(body, kind), { actor: "solodesk" }));
    await state.refresh("pool_created").catch(() => {});
    sendJson(res, 201, { workspaceId: workspace.workspaceId, kind, record: kind === "requirements" ? poolModule().pmWorkItemProjection(result.item) : result.item });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/pool\/scenarios\/(next_version_candidates)$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const result = poolAction(() => poolModule().nextVersionCandidates(workspace.canonicalPath, {
      version: url.searchParams.get("version") || ""
    }));
    sendJson(res, 200, { workspaceId: workspace.workspaceId, ...result });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/pool\/(requirements|knowledge)\/([^/]+)\/history$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const kind = poolKind(match[2]);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(match[3])) throw new ApiError("pool_record_invalid", "Pool record id is invalid.", 400);
    sendJson(res, 200, { workspaceId: workspace.workspaceId, kind, id: match[3], history: poolAction(() => poolModule().history(workspace.canonicalPath, match[3])) });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/pool\/(requirements|knowledge)\/([^/]+)$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const kind = poolKind(match[2]);
    const record = poolAction(() => poolModule().getPoolRecord(workspace.canonicalPath, kind, match[3], { view: url.searchParams.get("view") === "agent" ? "agent" : "pm" }));
    if (!record) throw new ApiError("pool_record_not_found", "Pool record was not found.", 404);
    sendJson(res, 200, { workspaceId: workspace.workspaceId, kind, record, history: kind === "requirements" ? poolAction(() => poolModule().history(workspace.canonicalPath, match[3])) : [] });
    return;
  }
  if (req.method === "PUT" && match) {
    const workspace = workspaceFor(state, match[1]);
    const kind = poolKind(match[2]);
    const body = await readBody(req, state.options.requestBodyLimit);
    const result = poolAction(() => poolModule().updatePoolRecord(workspace.canonicalPath, kind, match[3], poolPayload(body, kind), {
      actor: "solodesk",
      expectedRevision: body.expectedRevision
    }));
    await state.refresh("pool_updated").catch(() => {});
    sendJson(res, 200, { workspaceId: workspace.workspaceId, kind, record: kind === "requirements" ? poolModule().pmWorkItemProjection(result.item) : result.item });
    return;
  }
  if (req.method === "POST" && pathname.match(/^\/api\/workspaces\/[^/]+\/pool\/requirements\/merge$/)) {
    const mergeMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/pool\/requirements\/merge$/);
    const workspace = workspaceFor(state, mergeMatch[1]);
    const body = await readBody(req, state.options.requestBodyLimit);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(String(body.sourceId || "")) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(String(body.targetId || ""))) {
      throw new ApiError("merge_record_invalid", "sourceId and targetId are required.", 400);
    }
    const result = poolAction(() => poolModule().mergeWorkItems(workspace.canonicalPath, body.sourceId, body.targetId, {
      actor: "solodesk",
      sourceRevision: body.sourceRevision,
      targetRevision: body.targetRevision
    }));
    await state.refresh("pool_merged").catch(() => {});
    sendJson(res, 200, { workspaceId: workspace.workspaceId, kind: "requirements", ...result });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/timeline$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const limit = parseInteger(url.searchParams.get("limit"), 100, 1, state.settings.artifactLimitPerWorkspace, "timeline_limit", []);
    sendJson(res, 200, { workspaceId: workspace.workspaceId, timeline: (workspace.timeline || []).slice(0, limit) });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/continuation$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const data = state.options.data || dataModule();
    const continuation = typeof data.buildContinuationBrief === "function"
      ? data.buildContinuationBrief(workspace, shortcutOptions(state, url))
      : fallbackContinuation(workspace);
    sendJson(res, 200, { workspaceId: workspace.workspaceId, continuation });
    return;
  }
  match = pathname.match(/^\/api\/workspaces\/([^/]+)\/shortcuts\/([^/]+)$/);
  if (req.method === "GET" && match) {
    const workspace = workspaceFor(state, match[1]);
    const kind = decodeURIComponent(match[2]);
    if (!SHORTCUT_KINDS.has(kind)) throw new ApiError("unknown_shortcut", "Shortcut kind is not supported.", 404);
    const data = state.options.data || dataModule();
    const shortcut = typeof data.buildShortcut === "function"
      ? data.buildShortcut(workspace, kind, shortcutOptions(state, url))
      : fallbackShortcut(workspace, kind);
    sendJson(res, 200, shortcut);
    return;
  }
  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, { modules: listModules({ home: state.settings.home }) });
    return;
  }
  match = pathname.match(/^\/api\/config\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && match) {
    sendJson(res, 200, getConfig(match[1], configOptions(state, {}, url.searchParams)));
    return;
  }
  match = pathname.match(/^\/api\/config\/([A-Za-z0-9_-]+)\/validate$/);
  if (req.method === "POST" && match) {
    const body = await readBody(req, state.options.requestBodyLimit);
    const options = configOptions(state, body);
    const result = validateConfig(match[1], body.values, options);
    const issued = result.migrationPreview?.confirmationRequired
      ? issueToken(state.configTokens, {
          kind: "config_migration",
          identity: configMigrationIdentity(match[1], options, result)
        }, state.options.tokenTtlMs || DEFAULTS.tokenTtlMs)
      : null;
    sendJson(res, 200, {
      ...result,
      confirmationToken: issued?.token || "",
      expiresAt: issued ? new Date(issued.expiresAt).toISOString() : ""
    });
    return;
  }
  match = pathname.match(/^\/api\/config\/([A-Za-z0-9_-]+)$/);
  if (req.method === "PUT" && match) {
    const body = await readBody(req, state.options.requestBodyLimit);
    const options = configOptions(state, body);
    const validation = validateConfig(match[1], body.values, options);
    if (validation.migrationPreview?.confirmationRequired) {
      if (!body.confirmationToken) throw new ApiError("migration_preview_required", "Review config migration requires a fresh preview and confirmation token.", 409);
      const record = tokenRecord(state.configTokens, body.confirmationToken, "config_migration");
      if (record.identity !== configMigrationIdentity(match[1], options, validation)) throw new ApiError("migration_preview_stale", "Review config migration preview is stale; validate the current candidate again.", 409);
      record.consumed = true;
    }
    const previousStartupMode = state.settings.startupMode;
    const result = saveConfig(match[1], body.values, options);
    if (match[1] === "dashboard") {
      state.settings = readDashboardSettings({ ...state.options, home: state.settings.home, cwd: state.settings.cwd });
      if (state.settings.startupMode !== previousStartupMode) markRestartRequired(state, "startup_mode_changed");
    }
    await state.refresh("config_saved").catch(() => {});
    const restartScheduled = state.settings.startupMode !== previousStartupMode && scheduleControllerRestart(state, "startup_mode_changed");
    const restartHandoff = state.settings.startupMode !== previousStartupMode
      ? { required: true, reason: "startup_mode_changed", scheduled: restartScheduled }
      : { required: false };
    sendJson(res, 200, { ...result, restartHandoff });
    return;
  }
  match = pathname.match(/^\/api\/config\/([A-Za-z0-9_-]+)\/restore$/);
  if (req.method === "POST" && match) {
    const body = await readBody(req, state.options.requestBodyLimit);
    const result = restoreConfig(match[1], body.backupId, configOptions(state, body));
    await state.refresh("config_restored").catch(() => {});
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && pathname === "/api/review/preview") {
    const body = await readBody(req, state.options.requestBodyLimit);
    sendJson(res, 200, await createReviewPreview(state, body));
    return;
  }
  if (req.method === "POST" && pathname === "/api/review/test") {
    const body = await readBody(req, state.options.requestBodyLimit);
    sendJson(res, 200, await runProviderTest(state, body));
    return;
  }
  if (req.method === "POST" && pathname === "/api/review/run") {
    const body = await readBody(req, state.options.requestBodyLimit);
    sendJson(res, 202, await startReviewRun(state, body));
    return;
  }
  match = pathname.match(/^\/api\/review\/runs\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && match) {
    const run = state.reviewRuns.get(match[1]);
    if (!run) throw new ApiError("review_run_not_found", "Review run was not found.", 404);
    sendJson(res, 200, reviewRunView(run));
    return;
  }
  if (req.method === "GET" && pathname === "/api/updates") {
    if (!state.updateState) state.updateState = await Promise.resolve(state.options.checkUpdates
      ? state.options.checkUpdates({ home: state.settings.home, refresh: false })
      : runUpgradeCommand(state, ["--check"]));
    sendJson(res, 200, { check: state.updateState, journals: listJournals({ home: state.settings.home }) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/updates/check") {
    sendJson(res, 200, await checkForUpdates(state));
    return;
  }
  if (req.method === "POST" && pathname === "/api/updates/apply") {
    const body = await readBody(req, state.options.requestBodyLimit);
    const result = await applyConfirmedUpdate(state, body);
    const changed = (result.pluginResults || []).some((entry) => entry.status === "succeeded");
    if (changed) markRestartRequired(state, "plugin_upgrade_applied");
    const restartScheduled = changed && scheduleControllerRestart(state, "plugin_upgrade_applied");
    const restartHandoff = changed ? { required: true, reason: "plugin_upgrade_applied", scheduled: restartScheduled } : { required: false };
    sendJson(res, 200, { ...result, restartHandoff });
    return;
  }
  if (req.method === "POST" && pathname === "/api/updates/recover-config") {
    const body = await readBody(req, state.options.requestBodyLimit);
    const workspaces = [...state.index.workspaceById.values()].map((workspace) => workspace.canonicalPath);
    const result = state.options.recoverConfig
      ? await Promise.resolve(state.options.recoverConfig(body.journalId, { home: state.settings.home, workspaces }))
      : recoverConfig(body.journalId, { home: state.settings.home, workspaces });
    await state.refresh("upgrade_config_recovered").catch(() => {});
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && pathname === "/api/refresh") {
    const result = await state.refresh("manual");
    sendJson(res, 200, { status: "refreshed", refresh: state.refreshState, generatedAt: result.generatedAt || "" });
    return;
  }
  throw new ApiError("not_found", "API endpoint was not found.", 404);
}

function createRequestHandler(state) {
  return async (req, res) => {
    let mutationId = "";
    try {
      assertLocalRequest(req, state);
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/") && MUTATION_METHODS.has(req.method)) {
        assertCsrf(req, state);
        if (state.acceptingMutations === false) throw new ApiError("service_draining", "SoloDesk is draining and is not accepting new mutations.", 503);
        mutationId = `${req.method} ${url.pathname}#${++state.mutationSequence}`;
        state.activeMutations.add(mutationId);
      }
      if (url.pathname.startsWith("/api/")) await routeApi(req, res, state, url);
      else serveStatic(res, url.pathname);
    } catch (error) {
      sendError(res, error instanceof ConfigError ? error : error);
    } finally {
      if (mutationId) state.activeMutations.delete(mutationId);
    }
  };
}

function createSoloDesk(options = {}) {
  const settings = readDashboardSettings(options);
  const controllerPath = options.controllerPath ? trustedControllerPath(options.controllerPath, settings.home) : "";
  if (options.controllerPath && !controllerPath) throw new ApiError("untrusted_controller_path", "SoloDesk controller must be the sibling ravo-solodesk.js from the same trusted plugin directory.", 403);
  const now = new Date().toISOString();
  const state = {
    options: {
      ...options,
      controllerPath,
      tokenTtlMs: options.tokenTtlMs || DEFAULTS.tokenTtlMs,
      requestBodyLimit: options.requestBodyLimit || DEFAULTS.requestBodyLimit
    },
    settings,
    host: options.host || DEFAULTS.host,
    port: Number(options.port || settings.port),
    instanceId: options.instanceId || crypto.randomUUID(),
    serviceVersion: options.serviceVersion || SERVICE_VERSION,
    pluginVersion: options.pluginVersion || SERVICE_VERSION,
    pluginFingerprint: options.pluginFingerprint || "",
    installedRoot: options.installedRoot || "",
    actualEntrypoint: options.actualEntrypoint || "",
    resolutionSource: options.resolutionSource || "",
    controllerVersion: options.controllerVersion || SERVICE_VERSION,
    startupMode: options.startupMode || settings.startupMode || "foreground",
    startedAt: now,
    lifecycleStatus: "starting",
    restartRequired: false,
    restartReason: "",
    restartScheduledAt: "",
    restartTimer: null,
    restartCount: Number(options.restartCount || 0),
    lastErrorCode: "",
    acceptingMutations: true,
    activeMutations: new Set(),
    mutationSequence: 0,
    csrfToken: randomToken(),
    index: null,
    refreshState: { status: "idle", reason: "startup", startedAt: "", completedAt: "", error: "" },
    reviewTokens: new Map(),
    upgradeTokens: new Map(),
    integrityTokens: new Map(),
    configTokens: new Map(),
    reviewRuns: new Map(),
    updateState: null,
    refreshPromise: null,
    refresh: null
  };
  writeServiceState(state);
  state.refresh = async (reason = "scheduled") => {
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshState = { status: "running", reason, startedAt: new Date().toISOString(), completedAt: "", error: "" };
    state.refreshPromise = buildIndex(state.settings, state.options).then((index) => {
      state.index = index;
      state.refreshState = { ...state.refreshState, status: "ok", completedAt: new Date().toISOString() };
      return index;
    }).catch((error) => {
      state.refreshState = { ...state.refreshState, status: "error", completedAt: new Date().toISOString(), error: safeMessage(error) };
      if (!state.index) throw error;
      return state.index;
    }).finally(() => { state.refreshPromise = null; });
    return state.refreshPromise;
  };
  const server = http.createServer(createRequestHandler(state));
  return { state, server };
}

function listenOnce(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function listenWithFallback(server, host, startPort, maxAttempts = DEFAULTS.maxPortAttempts) {
  let port = startPort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1, port += 1) {
    try { return await listenOnce(server, host, port); } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new ApiError("no_available_port", `No available loopback port found from ${startPort} to ${port - 1}.`, 500);
}

async function gracefulShutdown(state, server, timer, options = {}) {
  if (state.shutdownPromise) return state.shutdownPromise;
  const shutdown = (async () => {
    state.acceptingMutations = false;
    state.lifecycleStatus = "draining";
    if (state.restartTimer) clearTimeout(state.restartTimer);
    state.restartTimer = null;
    writeServiceState(state);
    const deadline = Date.now() + (options.shutdownTimeoutMs || 30000);
    while ((state.activeMutations.size > 0 || [...state.reviewRuns.values()].some((run) => run.status === "running")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state.activeMutations.size > 0 || [...state.reviewRuns.values()].some((run) => run.status === "running")) {
      state.lastErrorCode = "shutdown_busy_timeout";
      writeServiceState(state, { status: "degraded", lastErrorCode: state.lastErrorCode });
      throw new ApiError("shutdown_busy_timeout", "SoloDesk could not drain active work before the shutdown timeout.", 409);
    }
    clearInterval(timer);
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });
    const request = readJson(state.options.controlRequest) || {};
    const restarting = request.action === "restart";
    state.lifecycleStatus = restarting ? "restarting" : "stopped";
    state.restartRequired = false;
    writeServiceState(state, {
      status: state.lifecycleStatus,
      userRequestedStop: request.userRequestedStop === true,
      lastErrorCode: "",
      restartReason: restarting ? state.restartReason : "",
      restartScheduledAt: restarting ? state.restartScheduledAt : ""
    });
    return { status: state.lifecycleStatus };
  })();
  state.shutdownPromise = shutdown;
  try {
    return await shutdown;
  } catch (error) {
    state.shutdownPromise = null;
    state.acceptingMutations = true;
    state.lifecycleStatus = "degraded";
    state.lastErrorCode = error.code || "shutdown_failed";
    state.restartScheduledAt = "";
    writeServiceState(state, { status: "degraded", lastErrorCode: state.lastErrorCode });
    throw error;
  }
}

function installShutdownHandlers(state, server, timer) {
  const shutdown = () => gracefulShutdown(state, server, timer, state.options).then(() => {
    process.exit(0);
  }).catch((error) => {
    state.lastErrorCode = error.code || "shutdown_failed";
    writeServiceState(state, { status: "degraded", lastErrorCode: state.lastErrorCode });
    process.exit(1);
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return shutdown;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values.filter(Boolean);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function validateCli() {
  const valueOptions = new Set(["--port", "--refresh", "--workspace-root", "--runtime-state", "--control-request", "--controller-path", "--codex-path", "--instance-id", "--startup-mode", "--service-version", "--plugin-version", "--plugin-fingerprint", "--installed-root", "--actual-entrypoint", "--resolution-source", "--controller-version", "--restart-count"]);
  const flags = new Set(["--open", "--managed-service", "--foreground", "--help", "-h", "--version"]);
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flags.has(arg)) continue;
    if (!valueOptions.has(arg)) throw new ApiError("unknown_option", `Unknown SoloDesk option: ${arg}`, 400);
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new ApiError("missing_option_value", `${arg} requires a value.`, 400);
    index += 1;
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-dashboard.js [--foreground|--managed-service] [--open] [--port <1024-65535>] [--refresh <seconds>] [--workspace-root <allowlist-root>]...");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(SERVICE_VERSION);
    return;
  }
  validateCli();
  const { state, server } = createSoloDesk({
    port: argValue("--port", undefined),
    refreshSeconds: argValue("--refresh", undefined),
    workspaceRoots: argValues("--workspace-root"),
    runtimeState: argValue("--runtime-state", ""),
    controlRequest: argValue("--control-request", ""),
    controllerPath: argValue("--controller-path", ""),
    codexPath: argValue("--codex-path", ""),
    instanceId: argValue("--instance-id", ""),
    startupMode: argValue("--startup-mode", process.argv.includes("--foreground") ? "foreground" : "on_demand"),
    serviceVersion: argValue("--service-version", SERVICE_VERSION),
    pluginVersion: argValue("--plugin-version", SERVICE_VERSION),
    pluginFingerprint: argValue("--plugin-fingerprint", ""),
    installedRoot: argValue("--installed-root", ""),
    actualEntrypoint: argValue("--actual-entrypoint", ""),
    resolutionSource: argValue("--resolution-source", ""),
    controllerVersion: argValue("--controller-version", SERVICE_VERSION),
    restartCount: argValue("--restart-count", "0")
  });
  if (!state.settings.enabled) throw new ApiError("dashboard_disabled", "SoloDesk is disabled in RAVO configuration.", 409);
  await state.refresh("startup");
  const address = await listenWithFallback(server, state.host, state.port);
  state.port = address.port;
  const url = `http://${state.host}:${state.port}/`;
  const timer = setInterval(() => state.refresh("scheduled").catch(() => {}), state.settings.refreshSeconds * 1000);
  timer.unref();
  state.lifecycleStatus = state.restartRequired ? "restart_required" : "healthy";
  writeServiceState(state);
  installShutdownHandlers(state, server, timer);
  console.log(JSON.stringify({ status: "listening", url, host: state.host, port: state.port, instanceId: state.instanceId, pid: process.pid, serviceVersion: state.serviceVersion, pluginVersion: state.pluginVersion, pluginFingerprint: state.pluginFingerprint, startupMode: state.startupMode, warnings: state.settings.warnings }, null, 2));
  if (process.argv.includes("--open")) execFile("open", [url], () => {});
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error.code || "dashboard_error", message: safeMessage(error) })}\n`);
    process.exit(1);
  });
}

module.exports = {
  ApiError,
  DEFAULTS,
  SERVICE_VERSION,
  buildIndex,
  createRequestHandler,
  createSoloDesk,
  gracefulShutdown,
  listenWithFallback,
  mutationView,
  readDashboardSettings,
  reviewProcessTimeoutMs,
  trustedControllerPath,
  writeServiceState
};
