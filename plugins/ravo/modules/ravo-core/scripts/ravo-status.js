#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildPmBrief } = require("./ravo-pm-brief");
const { resolveDeliveryProfile } = require("./ravo-delivery-profile");

const PRODUCT_VERSION = "0.6.2";
const REQUIRED_PLUGINS = Object.freeze(["ravo"]);
const HOOK_TRUST_RECOVERY = "In ChatGPT Desktop, open Settings > Hooks and trust the pending RAVO Stop hook; in Codex CLI, run /hooks.";

const HOOK_EVENT_KEYS = Object.freeze({
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop"
});

const DEFAULT_CONFIG = {
  deliveryProfile: "rapid",
  requestRouting: {
    enabled: true,
    budgets: {
      quick_answer: { wallClockMinutes: 10, evidenceAcquisitions: 5, directEvidence: 3, officialSources: 1, modelSteps: 4, contextCharacters: 40000 },
      focused_diagnosis: { wallClockMinutes: 30, evidenceAcquisitions: 12, directEvidence: 8, officialSources: 2, modelSteps: 10, contextCharacters: 120000 }
    }
  },
  execution: {},
  capabilityRouting: { enabled: true },
  globalKnowledge: {
    enabled: false,
    path: "~/.codex/ravo/knowledge",
    requireRedaction: true
  },
  goalPrompt: {
    missingSpecPolicy: "auto_spec"
  },
  spec: {
    alignmentDraftPolicy: "required"
  },
  acceptance: {
    securityBaseline: { enabled: true },
    requireRealE2EForRelease: true
  },
  hooks: {
    showTrustReminder: true
  }
};

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function sha(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(stableValue(value)));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function readJsonState(file) {
  if (!fs.existsSync(file)) return { status: "missing", value: null, file };
  try {
    return { status: "healthy", value: JSON.parse(fs.readFileSync(file, "utf8")), file };
  } catch (_error) {
    return { status: "error", value: null, file };
  }
}

function readJson(file) {
  return readJsonState(file).value;
}

function expandHome(value, home = os.homedir()) {
  return String(value || "").replace(/^~(?=$|\/|\\)/, home);
}

function latestJson(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .sort()
      .at(-1) || "";
  } catch (_error) {
    return "";
  }
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readConfig(workspace, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const userConfigPath = path.join(home, ".codex", "skill-config", "ravo.json");
  const workspaceConfigPath = path.join(workspace, "knowledge", ".ravo", "config.json");
  const userState = readJsonState(userConfigPath);
  const workspaceState = readJsonState(workspaceConfigPath);
  const warnings = [];
  if (userState.status === "error") warnings.push("User RAVO config is invalid JSON.");
  if (workspaceState.status === "error") warnings.push("Workspace RAVO config is invalid JSON.");
  const config = deepMerge(
    deepMerge(DEFAULT_CONFIG, userState.value || {}),
    workspaceState.value || {}
  );
  delete config.technicalDetailLevel;
  delete config.audience;
  return {
    config,
    warnings,
    states: { user: userState.status, workspace: workspaceState.status },
    paths: { userConfigPath, workspaceConfigPath }
  };
}

function commandResult(args, workspace, options = {}) {
  const execute = options.execute || ((argv) => JSON.parse(execFileSync(options.codexPath || "codex", argv, {
    cwd: workspace,
    encoding: "utf8",
    timeout: options.commandTimeoutMs || 15000,
    maxBuffer: 8 * 1024 * 1024
  })));
  try {
    const raw = execute(args, { cwd: workspace });
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") throw new Error("Codex JSON command returned a non-object value.");
    return { status: "ok", value, error: "" };
  } catch (_error) {
    return { status: "error", value: null, error: "codex_json_command_failed" };
  }
}

function compareVersions(left, right) {
  const leftParts = String(left).split(/[.-]/).map((part) => Number.isInteger(Number(part)) ? Number(part) : part);
  const rightParts = String(right).split(/[.-]/).map((part) => Number.isInteger(Number(part)) ? Number(part) : part);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
    const compared = String(a).localeCompare(String(b));
    if (compared) return compared;
  }
  return 0;
}

function cacheEvidence(home, name, preferredVersion = "") {
  const root = path.join(home, ".codex", "plugins", "cache", "ravo", name);
  let entries = [];
  try {
    entries = fs.readdirSync(root).map((version) => {
      const manifestPath = path.join(root, version, ".codex-plugin", "plugin.json");
      return { version, manifestPath, manifest: readJson(manifestPath) };
    }).filter((entry) => entry.manifest);
  } catch (_error) {
    entries = [];
  }
  entries.sort((a, b) => compareVersions(b.manifest.version || b.version, a.manifest.version || a.version));
  const selected = entries.find((entry) => (entry.manifest.version || entry.version) === preferredVersion) || entries[0] || null;
  return {
    version: selected?.manifest?.version || selected?.version || "",
    manifestPath: selected?.manifestPath || "",
    availableVersions: entries.map((entry) => entry.manifest.version || entry.version)
  };
}

function resolveSourceRoot(explicitRepo, marketplace, installed) {
  const installedCandidates = (installed || []).map((entry) => {
    const source = entry?.source?.path;
    if (!source) return "";
    const pluginRoot = path.resolve(source);
    return path.basename(path.dirname(pluginRoot)) === "plugins" ? path.resolve(pluginRoot, "..", "..") : "";
  });
  const localScriptCandidate = path.resolve(__dirname, "..", "..", "..", "..", "..");
  const candidates = [
    explicitRepo,
    ...installedCandidates,
    localScriptCandidate,
    marketplace?.root,
    marketplace?.marketplaceSource?.source
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  const unique = [...new Set(candidates)];
  const valid = (candidate) => fs.existsSync(path.join(candidate, "plugins", "ravo", ".codex-plugin", "plugin.json"));
  return unique.find(valid) || "";
}

function pluginEvidence(sourceRoot, home, installedEntries) {
  const installedByName = new Map((installedEntries || []).map((entry) => [entry.name || String(entry.pluginId || "").split("@")[0], entry]));
  return REQUIRED_PLUGINS.map((name) => {
    const sourceManifestPath = sourceRoot ? path.join(sourceRoot, "plugins", name, ".codex-plugin", "plugin.json") : "";
    const sourceManifest = sourceManifestPath ? readJson(sourceManifestPath) : null;
    const runtime = installedByName.get(name) || null;
    const runtimeVersion = runtime?.version || "";
    const cache = cacheEvidence(home, name, runtimeVersion);
    const sourceVersion = sourceManifest?.version || "";
    const versions = [sourceVersion, runtimeVersion, cache.version].filter(Boolean);
    const drift = versions.length > 1 && new Set(versions).size > 1;
    return {
      name,
      pluginId: `${name}@ravo`,
      present: Boolean(sourceManifest),
      installed: runtime?.installed === true,
      enabled: runtime?.enabled === true,
      version: sourceVersion,
      sourceVersion,
      runtimeVersion,
      installedVersion: runtimeVersion,
      cacheVersion: cache.version,
      cacheVersions: cache.availableVersions,
      drift,
      displayName: sourceManifest?.interface?.displayName || "",
      hasHooks: Boolean(sourceManifest?.hooks),
      manifestPath: sourceManifestPath,
      installedManifestPath: cache.manifestPath
    };
  });
}

function hookDefinitions(sourceRoot, plugins) {
  const expected = [];
  const manifests = [];
  const errors = [];
  for (const plugin of plugins) {
    if (!plugin.hasHooks || !sourceRoot) continue;
    const pluginManifest = readJson(plugin.manifestPath);
    const hooksRef = String(pluginManifest?.hooks || "").replace(/^\.\//, "");
    const hooksPath = path.join(sourceRoot, "plugins", plugin.name, hooksRef);
    const state = readJsonState(hooksPath);
    if (state.status !== "healthy") {
      errors.push(`${plugin.name}:${state.status}`);
      continue;
    }
    const bytes = fs.readFileSync(hooksPath);
    manifests.push({ pluginId: plugin.pluginId, hooksRef, hash: sha(bytes) });
    const hooks = state.value?.hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
      errors.push(`${plugin.name}:invalid_hooks_object`);
      continue;
    }
    for (const [event, groups] of Object.entries(hooks)) {
      const eventKey = HOOK_EVENT_KEYS[event];
      if (!eventKey || !Array.isArray(groups)) {
        errors.push(`${plugin.name}:unknown_hook_event:${event}`);
        continue;
      }
      groups.forEach((group, groupIndex) => {
        const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
        handlers.forEach((_handler, handlerIndex) => expected.push({
          pluginId: plugin.pluginId,
          event,
          key: `${plugin.pluginId}:${hooksRef}:${eventKey}:${groupIndex}:${handlerIndex}`
        }));
      });
    }
  }
  return { expected, manifests, errors };
}

function scanHookTrust(configPath, expected, hookErrors = []) {
  if (hookErrors.length) return { status: "unknown", expected: expected.map((entry) => ({ ...entry, recorded: false })), errors: hookErrors };
  if (!expected.length) return { status: "not_applicable", expected: [], errors: [] };
  if (!fs.existsSync(configPath)) return { status: "missing", expected: expected.map((entry) => ({ ...entry, recorded: false })), errors: ["config_missing"] };
  let lines;
  try { lines = fs.readFileSync(configPath, "utf8").replace(/\r\n?/g, "\n").split("\n"); } catch (_error) {
    return { status: "unknown", expected: expected.map((entry) => ({ ...entry, recorded: false })), errors: ["config_unreadable"] };
  }
  const recorded = new Map();
  const errors = [];
  let current = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[hooks.state.\"ravo") && !/^\[hooks\.state\."[^"\\]+"\]\s*(?:#.*)?$/.test(trimmed)) {
      errors.push("unknown_ravo_hook_table_syntax");
      current = "";
      continue;
    }
    const table = trimmed.match(/^\[hooks\.state\."([^"\\]+)"\]\s*(?:#.*)?$/);
    if (table) {
      current = /^(?:ravo@ravo|ravo-[^:]+@ravo):/.test(table[1]) ? table[1] : "";
      continue;
    }
    if (trimmed.startsWith("[")) {
      current = "";
      continue;
    }
    if (!current) continue;
    const trusted = trimmed.match(/^trusted_hash\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
    if (trusted) recorded.set(current, sha(trusted[1]));
    else if (/^trusted_hash\s*=/.test(trimmed)) errors.push(`invalid_trusted_hash_syntax:${current}`);
  }
  const evidence = expected.map((entry) => ({ ...entry, recorded: recorded.has(entry.key), trustDigest: recorded.get(entry.key) || "" }));
  if (errors.length) return { status: "unknown", expected: evidence, errors };
  return { status: evidence.every((entry) => entry.recorded) ? "recorded" : "missing", expected: evidence, errors: [] };
}

function sanitizeConfig(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeConfig(item, key));
  if (!value || typeof value !== "object") {
    if (/(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|credential)/i.test(key)) return value ? "configured" : "missing";
    if (/apiBase/i.test(key) && typeof value === "string") {
      try {
        const url = new URL(value);
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch (_error) { return "invalid"; }
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([childKey]) => !["technicalDetailLevel", "audience"].includes(childKey))
    .map(([childKey, child]) => [childKey, sanitizeConfig(child, childKey)]));
}

function configEvidence(workspace, sourceRoot, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const config = readConfig(workspace, { home });
  const reviewPath = path.join(home, ".codex", "skill-config", "ravo-review.json");
  const reviewState = readJsonState(reviewPath);
  const errors = [];
  let reviewFingerprint = "";
  let reviewValidation = { status: reviewState.status, valid: reviewState.status !== "error", errors: [] };
  if (reviewState.status === "healthy") {
    const validatorPath = options.reviewValidatorPath || (sourceRoot ? path.join(sourceRoot, "plugins", "ravo", "modules", "ravo-review", "scripts", "review-config.js") : "");
    if (!validatorPath || !fs.existsSync(validatorPath)) {
      errors.push("review_validator_missing");
      reviewValidation = { status: "error", valid: false, errors: [{ code: "review_validator_missing" }] };
    } else {
      try {
        delete require.cache[require.resolve(validatorPath)];
        const result = require(validatorPath).normalizeReviewConfig(reviewState.value);
        reviewFingerprint = result.redactedConfigFingerprint;
        reviewValidation = { status: result.valid ? "healthy" : "error", valid: result.valid, errors: result.errors, counts: result.counts, configShape: result.configShape };
        if (!result.valid) errors.push("review_config_invalid");
      } catch (_error) {
        errors.push("review_validator_error");
        reviewValidation = { status: "error", valid: false, errors: [{ code: "review_validator_error" }] };
      }
    }
  } else if (reviewState.status === "error") {
    errors.push("review_config_invalid_json");
  }
  if (config.states.user === "error") errors.push("user_config_invalid_json");
  if (config.states.workspace === "error") errors.push("workspace_config_invalid_json");
  const statuses = [config.states.user, config.states.workspace, reviewState.status];
  const status = errors.length ? "error" : statuses.every((value) => value === "missing") ? "missing" : "healthy";
  const fingerprint = sha({
    user: sanitizeConfig(readJson(config.paths.userConfigPath)),
    workspace: sanitizeConfig(readJson(config.paths.workspaceConfigPath)),
    review: reviewFingerprint || sanitizeConfig(reviewState.value)
  });
  return {
    status,
    fingerprint,
    effective: config.config,
    warnings: config.warnings,
    files: {
      user: { path: config.paths.userConfigPath, status: config.states.user },
      workspace: { path: config.paths.workspaceConfigPath, status: config.states.workspace },
      review: { path: reviewPath, status: reviewState.status, validation: reviewValidation }
    },
    errors
  };
}

function codexConfigEvidence(home) {
  const file = path.join(home, ".codex", "config.toml");
  const epochFile = path.join(home, ".codex", "ravo", "config-integrity", "runtime-epoch.json");
  let status = "missing";
  let hash = "";
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) status = "error";
    else { status = "healthy"; hash = sha(fs.readFileSync(file)); }
  } catch (error) {
    status = error.code === "ENOENT" ? "missing" : "error";
  }
  const epoch = readJson(epochFile) || {};
  return {
    status,
    hash,
    epochId: typeof epoch.epochId === "string" ? epoch.epochId : "initial",
    epochUpdatedAt: typeof epoch.updatedAt === "string" ? epoch.updatedAt : "",
    file,
    epochFile
  };
}

const CORE_RUNTIME_EVENTS = [];
const CORE_RUNTIME_STATUSES = new Set(["verified", "partial", "missing", "failed"]);
const OBSERVED_EVIDENCE_STATUSES = new Set(["pass", "missing", "fail"]);
const TERMINAL_TELEMETRY_STATUSES = new Set(["observed", "unknown", "unsupported", "failed"]);
const SUBAGENT_EVIDENCE_STATUSES = new Set(["observed", "missing", "failed", "not_requested"]);

function latestRuntimeProbe(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort().reverse(); } catch (_error) { return null; }
  for (const file of files) {
    const artifact = readJson(path.join(dir, file));
    if (artifact && (artifact.kind === "runtime_probe" || artifact.type === "runtime_probe")) return { file: path.join(dir, file), artifact };
  }
  return null;
}

function coverageFor(expectedEvents, passedEvents) {
  if (!expectedEvents.length) return "not_applicable";
  if (!passedEvents.size) return "none";
  return expectedEvents.every((event) => passedEvents.has(event)) ? "full" : "partial";
}

function defaultTerminalTelemetry(status = "unknown", summary = "Stop runtime evidence was not observed during this task.") {
  return { event: "Stop", status, summary, evidenceRef: "" };
}

function probeEvidence(dir, fingerprint, expectedHookEvents) {
  const latest = latestRuntimeProbe(dir);
  if (!latest) {
    return {
      status: "missing", coverage: "none", artifactPath: "", sessionIds: [], promptRefs: [], staleReason: "",
      layered: false, coreRuntimeStatus: "missing", coreCoverage: "none", coreExpectedEvents: [], terminalTelemetry: defaultTerminalTelemetry()
    };
  }
  const probe = latest.artifact;
  if (!probe.fingerprint || !Array.isArray(probe.observedEvidence)) {
    return {
      status: "unknown", coverage: "none", artifactPath: latest.file, sessionIds: probe.sessionIds || [], promptRefs: probe.promptRefs || [], staleReason: "invalid_probe_shape",
      layered: false, coreRuntimeStatus: "unknown", coreCoverage: "none", coreExpectedEvents: [], terminalTelemetry: defaultTerminalTelemetry()
    };
  }
  if (probe.fingerprint !== fingerprint) {
    return {
      status: "stale", coverage: "none", artifactPath: latest.file, sessionIds: probe.sessionIds || [], promptRefs: probe.promptRefs || [], staleReason: "runtime_fingerprint_changed",
      layered: Boolean(probe.coreRuntimeStatus), coreRuntimeStatus: "unknown", coreCoverage: "none", coreExpectedEvents: [], terminalTelemetry: defaultTerminalTelemetry()
    };
  }
  const passedEvents = new Set(probe.observedEvidence.filter((entry) => entry?.status === "pass").map((entry) => entry.event));
  const coverage = coverageFor(expectedHookEvents, passedEvents);
  const legacyStatus = probe.status === "pass" && coverage === "full" ? "pass"
    : probe.status === "partial" && coverage === "partial" ? "partial"
      : probe.status === "fail" ? "fail" : "unknown";
  const base = {
    status: legacyStatus,
    coverage,
    artifactPath: latest.file,
    sessionIds: Array.isArray(probe.sessionIds) ? probe.sessionIds : [],
    promptRefs: Array.isArray(probe.promptRefs) ? probe.promptRefs : [],
    staleReason: ""
  };
  if (!probe.coreRuntimeStatus && !probe.terminalTelemetry) {
    return {
      ...base,
      layered: false,
      coreRuntimeStatus: "unknown",
      coreCoverage: "none",
      coreExpectedEvents: [],
      terminalTelemetry: defaultTerminalTelemetry()
    };
  }

  const coreExpectedEvents = Array.isArray(probe.coreExpectedEvents) ? [...new Set(probe.coreExpectedEvents.filter((event) => typeof event === "string" && event))] : [];
  const expectedBaseCoreEvents = CORE_RUNTIME_EVENTS.filter((event) => expectedHookEvents.includes(event));
  const coreFailures = probe.observedEvidence.some((entry) => coreExpectedEvents.includes(entry?.event) && entry?.status === "fail");
  const coreCoverage = coverageFor(coreExpectedEvents, passedEvents);
  const derivedCoreStatus = coreFailures ? "failed"
    : coreCoverage === "full" ? "verified"
      : coreCoverage === "none" ? "missing" : "partial";
  const terminalTelemetry = probe.terminalTelemetry && typeof probe.terminalTelemetry === "object" ? probe.terminalTelemetry : null;
  const terminalStatus = terminalTelemetry?.status;
  const stopEvidence = probe.observedEvidence.filter((entry) => entry?.event === "Stop");
  const stopPassed = stopEvidence.some((entry) => entry?.status === "pass");
  const stopFailed = stopEvidence.some((entry) => entry?.status === "fail");
  const subagentEvidence = probe.observedEvidence.filter((entry) => entry?.event === "SubagentStart");
  const derivedSubagentStatus = subagentEvidence.some((entry) => entry?.status === "pass") ? "observed"
    : subagentEvidence.some((entry) => entry?.status === "fail") ? "failed"
      : subagentEvidence.some((entry) => entry?.status === "missing") ? "missing"
        : "not_requested";
  const layeredValid = CORE_RUNTIME_EVENTS.every((event) => expectedBaseCoreEvents.includes(event) && coreExpectedEvents.includes(event))
    && coreExpectedEvents.every((event) => expectedHookEvents.includes(event))
    && probe.observedEvidence.every((entry) => OBSERVED_EVIDENCE_STATUSES.has(entry?.status))
    && CORE_RUNTIME_STATUSES.has(probe.coreRuntimeStatus)
    && probe.coreRuntimeStatus === derivedCoreStatus
    && TERMINAL_TELEMETRY_STATUSES.has(terminalStatus)
    && ((terminalStatus === "observed" && stopPassed) || (terminalStatus === "failed" && stopFailed) || (["unknown", "unsupported"].includes(terminalStatus) && !stopPassed && !stopFailed))
    && SUBAGENT_EVIDENCE_STATUSES.has(probe.subagentEvidenceStatus)
    && probe.subagentEvidenceStatus === derivedSubagentStatus;
  if (!layeredValid) {
    return {
      ...base,
      status: "unknown",
      layered: true,
      coreRuntimeStatus: "unknown",
      coreCoverage: "none",
      coreExpectedEvents,
      terminalTelemetry: defaultTerminalTelemetry("unknown", "The layered Runtime probe is internally inconsistent.")
    };
  }
  return {
    ...base,
    layered: true,
    coreRuntimeStatus: derivedCoreStatus,
    coreCoverage,
    coreExpectedEvents,
    terminalTelemetry: {
      event: "Stop",
      status: terminalStatus,
      summary: typeof terminalTelemetry.summary === "string" && terminalTelemetry.summary ? terminalTelemetry.summary : "Stop telemetry diagnostic.",
      evidenceRef: typeof terminalTelemetry.evidenceRef === "string" ? terminalTelemetry.evidenceRef : ""
    },
    subagentEvidenceStatus: derivedSubagentStatus
  };
}

function runtimeHealth({ marketplaceStatus, pluginStatus, versionStatus, hookTrustEvidence, runtimeProbe, manifestStatus, configStatus, codexConfigStatus }) {
  if (marketplaceStatus === "error" || pluginStatus === "error") return "error";
  if (marketplaceStatus === "missing" || pluginStatus === "missing") return "missing";
  if (pluginStatus === "degraded" || versionStatus !== "aligned" || ["missing", "unknown"].includes(hookTrustEvidence) || ["missing", "error"].includes(manifestStatus) || configStatus === "error" || codexConfigStatus !== "healthy") return "degraded";
  if (runtimeProbe.layered && runtimeProbe.coreRuntimeStatus === "verified") {
    return runtimeProbe.terminalTelemetry?.status === "observed" ? "healthy" : "core_verified";
  }
  if (runtimeProbe.layered && runtimeProbe.coreExpectedEvents?.length === 0 && runtimeProbe.terminalTelemetry?.status === "observed") return "healthy";
  if (runtimeProbe.status === "pass") return "healthy";
  if (runtimeProbe.status === "missing" || runtimeProbe.coverage === "partial") return "configured_unverified";
  return "degraded";
}

function recoveryStepsFor(state) {
  const steps = [];
  if (state.marketplaceStatus === "missing") steps.push("Add the RAVO marketplace, then refresh Runtime status.");
  if (state.marketplaceStatus === "error") steps.push("Repair Codex marketplace JSON diagnostics before trusting Runtime state.");
  for (const plugin of state.plugins.filter((entry) => !entry.installed || !entry.enabled)) {
    steps.push(`Install and enable ${plugin.pluginId}.`);
  }
  if (state.versionStatus === "drift") steps.push("Run the controlled RAVO upgrade flow and verify every required plugin version.");
  if (["missing", "unknown"].includes(state.hookTrustEvidence)) steps.push(HOOK_TRUST_RECOVERY);
  const coreNeedsProbe = !state.runtimeProbe.layered
    ? ["missing", "stale"].includes(state.runtimeProbe.status) || state.runtimeProbe.coverage === "partial"
    : ["missing", "partial", "failed", "unknown"].includes(state.runtimeProbe.coreRuntimeStatus) || ["missing", "stale", "unknown"].includes(state.runtimeProbe.status);
  if (coreNeedsProbe) steps.push("Start a fresh Codex task and run the generated RAVO Runtime verification prompt.");
  if (state.runtimeProbe.terminalTelemetry?.status === "failed") steps.push("Inspect the recorded Stop telemetry failure before relying on terminal diagnostics.");
  if (state.manifestStatus !== "healthy") steps.push("Initialize or repair knowledge/.ravo/manifest.json for this workspace.");
  if (state.configStatus === "error") steps.push("Repair the reported RAVO config file before continuing.");
  if (state.codexConfigStatus !== "healthy") steps.push("Repair ~/.codex/config.toml ownership, permissions, or parseability before trusting Runtime state.");
  if (["drift", "approval_required", "error"].includes(state.configIntegrityStatus)) steps.push("Open SoloDesk Config Integrity, review the protected changes, and create a fresh repair plan.");
  if (["no_snapshot", "configured_unverified"].includes(state.configIntegrityStatus)) steps.push("Create or verify a known-good config snapshot in a fresh Codex task.");
  return [...new Set(steps)];
}

function buildStatus(workspace, explicitRepo = "", options = {}) {
  const root = path.resolve(workspace);
  const home = path.resolve(options.home || os.homedir());
  const ravoRoot = path.join(root, "knowledge", ".ravo");
  const manifestPath = path.join(ravoRoot, "manifest.json");
  const manifestState = readJsonState(manifestPath);
  const marketplaceCommand = commandResult(["plugin", "marketplace", "list", "--json"], root, options);
  const pluginCommand = commandResult(["plugin", "list", "--marketplace", "ravo", "--json"], root, options);
  const marketplaces = Array.isArray(marketplaceCommand.value?.marketplaces) ? marketplaceCommand.value.marketplaces : [];
  const marketplace = marketplaces.find((entry) => entry?.name === "ravo") || null;
  const marketplaceStatus = marketplaceCommand.status === "error" ? "error" : marketplace ? "present" : "missing";
  const installedEntries = Array.isArray(pluginCommand.value?.installed) ? pluginCommand.value.installed : [];
  const sourceRoot = resolveSourceRoot(explicitRepo, marketplace, installedEntries);
  const plugins = pluginEvidence(sourceRoot, home, installedEntries);
  const core = plugins.find((plugin) => plugin.name === "ravo");
  const pluginStatus = pluginCommand.status === "error" ? "error"
    : !core?.installed ? "missing"
      : plugins.every((plugin) => plugin.installed && plugin.enabled) ? "healthy" : "degraded";
  const versionStatus = plugins.some((plugin) => plugin.drift) ? "drift"
    : plugins.every((plugin) => plugin.sourceVersion && plugin.runtimeVersion && plugin.cacheVersion) ? "aligned" : "unknown";
  const hooks = hookDefinitions(sourceRoot, plugins);
  const trust = scanHookTrust(path.join(home, ".codex", "config.toml"), hooks.expected, hooks.errors);
  const config = configEvidence(root, sourceRoot, { ...options, home });
  const userConfig = readJson(config.files.user.path) || {};
  const workspaceConfig = readJson(config.files.workspace.path) || {};
  const deliveryProfileSource = Object.hasOwn(workspaceConfig, "deliveryProfile")
    ? "workspace"
    : Object.hasOwn(userConfig, "deliveryProfile") ? "user" : "default";
  let effectiveDeliveryProfile;
  try {
    effectiveDeliveryProfile = resolveDeliveryProfile(config.effective, { profileSource: deliveryProfileSource });
  } catch (error) {
    effectiveDeliveryProfile = null;
    config.warnings.push(`Unable to resolve delivery profile: ${error.message}`);
  }
  const codexConfig = codexConfigEvidence(home);
  const pluginFingerprint = sha({
    marketplace: marketplace ? {
      name: "ravo",
      root: marketplace.root || "",
      sourceType: marketplace.marketplaceSource?.sourceType || "",
      source: marketplace.marketplaceSource?.source || ""
    } : null,
    plugins: plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      installed: plugin.installed,
      enabled: plugin.enabled,
      sourceVersion: plugin.sourceVersion,
      runtimeVersion: plugin.runtimeVersion,
      cacheVersion: plugin.cacheVersion
    })),
    hookManifests: hooks.manifests
  });
  const fingerprint = sha({
    pluginFingerprint,
    configFingerprint: config.fingerprint,
    codexConfigHash: codexConfig.hash,
    configMutationEpoch: codexConfig.epochId
  });
  const expectedHookEvents = [...new Set(hooks.expected.map((entry) => entry.event))].sort();
  const runtimeProbe = probeEvidence(path.join(ravoRoot, "quick-validation"), fingerprint, expectedHookEvents);
  const state = {
    marketplaceStatus,
    pluginStatus,
    versionStatus,
    hookTrustEvidence: trust.status,
    runtimeProbe,
    manifestStatus: manifestState.status,
    configStatus: config.status,
    codexConfigStatus: codexConfig.status,
    plugins
  };
  const baseHealth = runtimeHealth(state);
  const integrityRuntime = {
    sourceRoot,
    marketplaceStatus,
    marketplace: marketplace ? {
      name: "ravo",
      sourceType: marketplace.marketplaceSource?.sourceType || "unknown",
      root: marketplace.root || marketplace.marketplaceSource?.source || ""
    } : null,
    pluginStatus,
    versionStatus,
    hookTrustEvidence: trust.status,
    runtimeProbeStatus: runtimeProbe.status,
    coreRuntimeStatus: runtimeProbe.coreRuntimeStatus,
    terminalTelemetryStatus: runtimeProbe.terminalTelemetry?.status || "unknown",
    runtimeHealth: baseHealth,
    configMutationEpoch: codexConfig.epochId,
    pluginFingerprint,
    plugins,
    hookTrust: { expected: trust.expected, errors: trust.errors, identityEvidence: "structural_only_until_matching_runtime_probe" },
    hookManifests: hooks.manifests,
    runtimeProbe
  };
  let configIntegrity;
  try {
    configIntegrity = require("./ravo-config-integrity").getIntegrityStatus({ home, runtimeStatus: integrityRuntime });
  } catch (error) {
    configIntegrity = {
      configIntegrityStatus: "error",
      selectedSnapshotId: "",
      driftSections: [],
      repairRequired: false,
      approvalRequired: [],
      errorCode: error.code || "config_integrity_error"
    };
  }
  const health = ["drift", "approval_required", "error"].includes(configIntegrity.configIntegrityStatus)
    ? "degraded"
    : ["no_snapshot", "configured_unverified"].includes(configIntegrity.configIntegrityStatus) && ["healthy", "core_verified"].includes(baseHealth)
      ? "configured_unverified"
      : baseHealth;
  state.configIntegrityStatus = configIntegrity.configIntegrityStatus;
  const moduleDirs = ["analysis", "workstream", "quick-validation", "acceptance", "continuation", "knowledge", "review"];
  const latestArtifacts = Object.fromEntries(moduleDirs.map((dir) => [dir, latestJson(path.join(ravoRoot, dir))]));
  const available = ["healthy", "core_verified"].includes(health);
  const pmBrief = buildPmBrief({
    headline: health === "healthy" ? "本机 RAVO 运行正常"
      : health === "core_verified" ? "本机 RAVO 核心能力已经验证"
        : health === "configured_unverified" ? "本机 RAVO 已配置，实际使用仍待确认"
          : health === "degraded" ? "本机 RAVO 有一项问题需要处理"
            : health === "missing" ? "本机尚未准备好 RAVO" : "无法确认本机 RAVO 状态",
    stage: "operate",
    productState: available ? "locally_available" : health === "configured_unverified" ? "in_progress" : health === "degraded" ? "degraded" : ["missing", "error"].includes(health) ? "blocked" : "unknown",
    userImpact: available
      ? "你可以继续在本机使用；这不代表任何能力已经发布给其他用户。"
      : health === "configured_unverified" ? "现有配置已经就绪，Codex 仍需通过真实任务确认实际可用性。" : "现有产品数据不会被自动修改，Codex 会先恢复或补齐验证。",
    actionRequired: "none",
    nextStep: available ? "Codex 将继续当前产品工作，并在发生变化时更新实际体验结论。" : "Codex 将按恢复步骤处理本机环境并重新验证。",
    decisionCard: null,
    evidenceBoundary: {
      proves: [available ? "本机核心能力已被当前状态证据支持" : "已记录本机环境的当前健康情况"],
      doesNotProve: [available ? "尚不代表已经发布给其他用户" : "尚不代表本机已经可以稳定使用全部能力"]
    },
    sourceRefs: [manifestState.status === "healthy" ? manifestPath : "", runtimeProbe.file || "", `status:${root}`].filter(Boolean)
  });
  return {
    status: manifestState.status === "healthy" ? "ok" : manifestState.status === "missing" ? "missing_manifest" : "error",
    workspace: root,
    sourceRoot,
    manifestPath,
    manifestExists: manifestState.status === "healthy",
    schemaVersion: manifestState.value?.schemaVersion || "",
    marketplaceStatus,
    marketplace: marketplace ? {
      name: "ravo",
      sourceType: marketplace.marketplaceSource?.sourceType || "unknown",
      root: marketplace.root || marketplace.marketplaceSource?.source || ""
    } : null,
    pluginStatus,
    versionStatus,
    hookTrustEvidence: trust.status,
    runtimeProbeStatus: runtimeProbe.status,
    coreRuntimeStatus: runtimeProbe.coreRuntimeStatus,
    terminalTelemetryStatus: runtimeProbe.terminalTelemetry?.status || "unknown",
    terminalTelemetry: runtimeProbe.terminalTelemetry,
    manifestStatus: manifestState.status,
    configStatus: config.status,
    codexConfigStatus: codexConfig.status,
    runtimeHealth: health,
    fingerprint,
    pluginFingerprint,
    configFingerprint: config.fingerprint,
    codexConfigHash: codexConfig.hash,
    configMutationEpoch: codexConfig.epochId,
    expectedHookEvents,
    hookTrust: { expected: trust.expected, errors: trust.errors, identityEvidence: "structural_only_until_matching_runtime_probe" },
    hookManifests: hooks.manifests,
    runtimeProbe,
    configIntegrityStatus: configIntegrity.configIntegrityStatus,
    selectedSnapshotId: configIntegrity.selectedSnapshotId,
    driftSections: configIntegrity.driftSections,
    repairRequired: configIntegrity.repairRequired,
    configIntegrityApprovalRequired: configIntegrity.approvalRequired,
    configIntegrityErrorCode: configIntegrity.errorCode || "",
    plugins,
    latestArtifacts,
    pmBrief,
    config: config.effective,
    effectiveDeliveryProfile,
    effectiveRequestRouting: config.effective.requestRouting,
    configFiles: config.files,
    configPaths: {
      userConfigPath: config.files.user.path,
      workspaceConfigPath: config.files.workspace.path,
      reviewConfigPath: config.files.review.path
    },
    warnings: [
      ...config.warnings,
      ...config.errors,
      ...(!sourceRoot ? ["trusted_ravo_source_unresolved"] : []),
      ...(configIntegrity.errorCode ? [`config_integrity_error:${configIntegrity.errorCode}`] : []),
      ...(marketplaceCommand.error ? [`marketplace_json_error:${marketplaceCommand.error}`] : []),
      ...(pluginCommand.error ? [`plugin_json_error:${pluginCommand.error}`] : [])
    ],
    driftWarnings: plugins.filter((plugin) => plugin.drift).map((plugin) => `${plugin.name} source=${plugin.sourceVersion} runtime=${plugin.runtimeVersion} cache=${plugin.cacheVersion}`),
    recoverySteps: recoveryStepsFor({ ...state, runtimeHealth: health }),
    reminders: [
      "A hook trust record does not prove that the current Codex task loaded the hook.",
      "After install or upgrade, start a fresh Codex task and record a matching Runtime probe.",
      "Preview global AGENTS.md changes before applying; never edit it silently."
    ]
  };
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-status.js [--workspace <path>] [--repo <marketplace-root>] [--codex <binary>]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const repo = argValue("--repo", "");
  console.log(JSON.stringify(buildStatus(workspace, repo, { codexPath: argValue("--codex", "codex") }), null, 2));
}

if (require.main === module) main();

module.exports = {
  DEFAULT_CONFIG,
  REQUIRED_PLUGINS,
  buildStatus,
  expandHome,
  readConfig,
  scanHookTrust
};
