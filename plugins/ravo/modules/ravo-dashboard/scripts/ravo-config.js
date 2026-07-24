#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePluginScript } = require("./ravo-plugin-resolver");

const CONTRACT_PATH = path.join(__dirname, "..", "config", "ravo-config-contract.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
const PRODUCT_VERSION = "0.6.3";
const SECRET_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const DEPRECATED_CORE_FIELDS = new Set(["technicalDetailLevel", "audience"]);

class ConfigError extends Error {
  constructor(code, message, status = 400, fieldErrors = []) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sha(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function semanticFingerprint(value) {
  function redact(input, key = "") {
    if (Array.isArray(input)) return input.map((item) => redact(item, key));
    if (!input || typeof input !== "object") return /(?:apiKey|secret|token|password)/i.test(key) && input ? "configured" : input;
    return Object.fromEntries(Object.entries(input).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  return sha(JSON.stringify(stableValue(redact(value))));
}

function deepMerge(base, override) {
  const out = clone(base) || {};
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function hasPath(object, dottedPath) {
  const parts = dottedPath.split(".");
  let current = object;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, part) => value && typeof value === "object" ? value[part] : undefined, object);
}

function setPath(object, dottedPath, value) {
  const parts = dottedPath.split(".");
  let current = object;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = clone(value);
    else {
      if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
      current = current[part];
    }
  });
}

function deletePath(object, dottedPath) {
  const parts = dottedPath.split(".");
  const last = parts.pop();
  const parent = parts.reduce((value, part) => value && typeof value === "object" ? value[part] : undefined, object);
  if (parent && typeof parent === "object") delete parent[last];
}

function deprecatedCorePaths(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return [];
  return collectSubmittedPaths(values, new Set()).filter((item) => DEPRECATED_CORE_FIELDS.has(item));
}

function withoutDeprecatedCoreFields(value) {
  const result = clone(value) || {};
  for (const field of DEPRECATED_CORE_FIELDS) delete result[field];
  return result;
}

function moduleContract(moduleId) {
  const module = CONTRACT.modules.find((entry) => entry.moduleId === moduleId);
  if (!module) throw new ConfigError("unknown_module", `Unknown RAVO config module: ${moduleId}`, 404);
  return module;
}

function defaultUserConfig() {
  const result = { schemaVersion: "0.5.0" };
  for (const module of CONTRACT.modules.filter((entry) => entry.target === "user-ravo")) {
    for (const field of module.fields) if (!hasPath(result, field.path)) setPath(result, field.path, field.default);
  }
  return result;
}

function defaultModuleValues(module) {
  const values = {};
  for (const field of module.fields) setPath(values, field.path, field.default);
  return values;
}

function configPaths(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  return {
    home,
    userRavo: path.join(home, ".codex", "skill-config", "ravo.json"),
    review: path.join(home, ".codex", "skill-config", "ravo-review.json"),
    backupRoot: path.join(home, ".codex", "ravo", "backups", "config"),
    lockPath: path.join(home, ".codex", "ravo", "mutation.lock")
  };
}

function canonicalWorkspace(workspace) {
  if (!workspace) throw new ConfigError("workspace_required", "A selected allowlisted workspace is required for workspace scope.");
  try { return fs.realpathSync(path.resolve(workspace)); } catch (_error) {
    throw new ConfigError("workspace_missing", "The selected workspace no longer exists.", 404);
  }
}

function targetFor(module, options = {}) {
  const paths = configPaths(options);
  const scope = options.scope || module.scope || "user";
  if (scope === "workspace") {
    if (!module.workspaceTarget || !module.fields.some((field) => field.workspaceAllowed)) {
      throw new ConfigError("scope_not_supported", `${module.moduleId} has no workspace-level configurable fields.`);
    }
    const workspace = canonicalWorkspace(options.workspace);
    return { scope, workspace, target: path.join(workspace, "knowledge", ".ravo", "config.json"), targetKind: "workspace-ravo", paths };
  }
  if (scope !== "user") throw new ConfigError("invalid_scope", "Config scope must be user or workspace.");
  return { scope, workspace: "", target: module.target === "review" ? paths.review : paths.userRavo, targetKind: module.target, paths };
}

function readJsonState(file) {
  if (!fs.existsSync(file)) return { status: "missing", value: {}, bytes: null, stat: null };
  try {
    const bytes = fs.readFileSync(file);
    return { status: "healthy", value: JSON.parse(bytes.toString("utf8")), bytes, stat: fs.statSync(file) };
  } catch (_error) {
    return { status: "error", value: {}, bytes: null, stat: null };
  }
}

function assertSafeParent(file) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: PRIVATE_DIR_MODE });
  try { fs.accessSync(parent, fs.constants.R_OK | fs.constants.W_OK); } catch (_error) {
    throw new ConfigError("config_permission_denied", `Config directory is not readable and writable: ${parent}`, 403);
  }
}

function fsyncDirectory(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (_error) {
    // Some filesystems do not support directory fsync; file fsync and read-back still apply.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWriteBuffer(file, bytes, previousStat = null) {
  assertSafeParent(file);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", previousStat?.mode ? previousStat.mode & 0o777 : SECRET_MODE);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tmp, SECRET_MODE);
    if (previousStat && typeof process.getuid === "function" && process.getuid() === 0) fs.chownSync(tmp, previousStat.uid, previousStat.gid);
    fs.renameSync(tmp, file);
    fs.chmodSync(file, SECRET_MODE);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_error) { /* Best-effort temp cleanup. */ }
  }
  const readBack = fs.readFileSync(file);
  if (readBack.length !== bytes.length || sha(readBack) !== sha(bytes)) throw new ConfigError("config_readback_mismatch", "Config read-back size/hash mismatch.", 500);
  return readBack;
}

function atomicWriteJson(file, value, previousStat = null) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  atomicWriteBuffer(file, bytes, previousStat);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) {
    throw new ConfigError("config_readback_invalid", "Config read-back is not valid JSON.", 500);
  }
}

function backupId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(5).toString("hex")}`;
}

function createBackup(module, target, state, options = {}) {
  if (state.status === "missing") return { status: "created", backupId: "", existed: false };
  if (state.status !== "healthy" || !state.bytes) throw new ConfigError("backup_source_invalid", "Existing config cannot be read and backed up; no write was attempted.", 409);
  const id = backupId();
  const dir = path.join(target.paths.backupRoot, id);
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.chmodSync(dir, PRIVATE_DIR_MODE);
  const backupFile = path.join(dir, "config.json");
  fs.writeFileSync(backupFile, state.bytes, { mode: SECRET_MODE });
  fs.chmodSync(backupFile, SECRET_MODE);
  const readBack = fs.readFileSync(backupFile);
  if (readBack.length !== state.bytes.length || sha(readBack) !== sha(state.bytes)) throw new ConfigError("backup_readback_mismatch", "Backup read-back size/hash mismatch; no write was attempted.", 500);
  const metadata = {
    schemaVersion: "0.5.0",
    backupId: id,
    moduleId: module.moduleId,
    scope: target.scope,
    workspace: target.workspace,
    targetKind: target.targetKind,
    targetPath: target.target,
    size: readBack.length,
    hash: sha(readBack),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: SECRET_MODE });
  fs.chmodSync(path.join(dir, "metadata.json"), SECRET_MODE);
  return { status: "backed_up", backupId: id, existed: true, directory: dir };
}

function withMutationLock(options, operation) {
  const paths = configPaths(options);
  fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true, mode: PRIVATE_DIR_MODE });
  let fd;
  try {
    fd = fs.openSync(paths.lockPath, "wx", SECRET_MODE);
  } catch (error) {
    if (error.code === "EEXIST") throw new ConfigError("operation_in_progress", "Another RAVO config or upgrade mutation is in progress.", 409);
    throw error;
  }
  try {
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    fs.fsyncSync(fd);
    return operation();
  } finally {
    try { fs.closeSync(fd); } catch (_error) { /* Already closed. */ }
    try { fs.unlinkSync(paths.lockPath); } catch (_error) { /* Lock cleanup is best effort after operation completion. */ }
  }
}

function validateField(field, value) {
  const errors = [];
  const fieldError = (code, message) => errors.push({ path: field.path, code, message });
  if (value === undefined) return errors;
  if (value === null && field.nullable === true) return errors;
  if (field.type === "boolean" && typeof value !== "boolean") fieldError("invalid_type", "must be a boolean");
  if (field.type === "integer") {
    if (!Number.isInteger(value)) fieldError("invalid_type", "must be an integer");
    else if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) fieldError("out_of_range", `must be from ${field.min} to ${field.max}`);
  }
  if (field.type === "string" && typeof value !== "string") fieldError("invalid_type", "must be a string");
  if (field.type === "enum" && !field.options.includes(value)) fieldError("invalid_enum", `must be one of ${field.options.join(", ")}`);
  if (field.type === "string-array" && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) fieldError("invalid_type", "must be an array of strings");
  if (field.type === "object-list" && !(Array.isArray(value) || (value && typeof value === "object"))) fieldError("invalid_type", "must be an array or object map");
  return errors;
}

function deliveryProfileModulePath(options = {}) {
  const script = resolvePluginScript("ravo-core", "scripts/ravo-delivery-profile.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.corePluginRoot,
    envRoot: process.env.RAVO_CORE_PLUGIN_ROOT,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new ConfigError("delivery_profile_module_missing", "The current RAVO Core delivery profile module could not be resolved.", 500);
  return script;
}

function requestRoutingModulePath(options = {}) {
  const script = resolvePluginScript("ravo-analysis", "scripts/ravo-governance-route.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.analysisPluginRoot,
    envRoot: process.env.RAVO_ANALYSIS_PLUGIN_ROOT,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new ConfigError("request_routing_module_missing", "The current RAVO Analysis request routing module could not be resolved.", 500);
  return script;
}

function validateCoreCandidate(candidate, options = {}) {
  const { validateDeliveryConfig } = require(deliveryProfileModulePath(options));
  const result = validateDeliveryConfig(candidate);
  if (!result.valid) throw new ConfigError("config_validation_failed", "Delivery profile config validation failed.", 422, result.errors);
  const { validateRequestRouting } = require(requestRoutingModulePath(options));
  const routing = validateRequestRouting(candidate);
  if (!routing.valid) throw new ConfigError("config_validation_failed", "Request routing config validation failed.", 422, routing.errors);
  return result;
}

function resolveCoreProfile(config, options = {}) {
  const { resolveDeliveryProfile } = require(deliveryProfileModulePath(options));
  return resolveDeliveryProfile(config, options);
}

function collectSubmittedPaths(value, terminalPaths, prefix = "", output = []) {
  if (prefix && terminalPaths.has(prefix)) {
    output.push(prefix);
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (prefix) output.push(prefix);
    return output;
  }
  for (const [key, child] of Object.entries(value)) collectSubmittedPaths(child, terminalPaths, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

function validateGenericPatch(module, values, scope) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ConfigError("invalid_values", "values must be an object.");
  const fields = module.fields.filter((field) => scope !== "workspace" || field.workspaceAllowed);
  const allowed = new Set(fields.map((field) => field.path));
  const terminal = new Set(fields.filter((field) => ["object-list", "string-array"].includes(field.type)).map((field) => field.path));
  if (module.moduleId === "core") {
    allowed.add("requestRouting");
    terminal.add("requestRouting");
    for (const field of DEPRECATED_CORE_FIELDS) allowed.add(field);
  }
  const unknown = collectSubmittedPaths(values, terminal).filter((submitted) => !allowed.has(submitted));
  const errors = unknown.map((submitted) => ({ path: submitted, code: "unknown_field", message: "is not declared in the RAVO config contract" }));
  for (const field of fields) if (hasPath(values, field.path)) errors.push(...validateField(field, getPath(values, field.path)));
  if (errors.length) throw new ConfigError("config_validation_failed", "Config validation failed.", 422, errors);
  return fields;
}

function sanitizeApiBase(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) { return "invalid"; }
}

function redactReviewConfig(config) {
  const source = clone(config) || {};
  const value = {};
  const module = moduleContract("review");
  for (const field of module.fields.filter((entry) => entry.path !== "providers")) {
    if (hasPath(source, field.path)) setPath(value, field.path, getPath(source, field.path));
  }
  if (source.schemaVersion) value.schemaVersion = source.schemaVersion;
  const redactProvider = (provider) => {
    const out = {};
    for (const key of [
      "id", "label", "enabled", "apiMode", "timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs",
      "idleTimeoutMs", "stream", "maxTokensMode", "maxTokens", "autoFallbackMaxTokens", "enableReasoningParams"
    ]) if (provider?.[key] !== undefined) out[key] = clone(provider[key]);
    out.apiBase = sanitizeApiBase(provider?.apiBase);
    out.apiBaseConfigured = Boolean(provider?.apiBase);
    out.apiKey = { configured: typeof provider?.apiKey === "string" && provider.apiKey.trim().length > 0 };
    out.credentialStatus = out.apiKey.configured ? "configured" : "missing";
    out.models = (Array.isArray(provider?.models) ? provider.models : []).map((model) => ({
      id: String(model?.id || ""),
      enabled: model?.enabled !== false
    })).filter((model) => model.id);
    return out;
  };
  if (Array.isArray(source.providers)) value.providers = source.providers.map(redactProvider);
  else if (["apiBase", "apiMode", "apiKey", "models"].some((key) => source[key] !== undefined)) {
    value.legacyProvider = redactProvider({
      id: "default",
      label: "Default",
      enabled: true,
      apiBase: source.apiBase,
      apiMode: source.apiMode,
      apiKey: source.apiKey,
      models: typeof source.models === "string" ? source.models.split(/[\s,]+/).filter(Boolean).map((id) => ({ id, enabled: true })) : source.models
    });
  }
  return value;
}

function reviewValidatorPath(options = {}) {
  const script = resolvePluginScript("ravo-review", "scripts/review-config.js", {
    fromDir: __dirname,
    home: options.home,
    explicitRoot: options.reviewPluginRoot,
    envRoot: process.env.RAVO_REVIEW_PLUGIN_ROOT,
    execute: options.executeCodex,
    codexPath: options.codexPath
  });
  if (!script) throw new ConfigError("review_validator_missing", "The current RAVO Review validator could not be resolved.", 500);
  return script;
}

function inspectReviewCandidate(candidate, options = {}) {
  const { normalizeReviewConfig } = require(reviewValidatorPath(options));
  return normalizeReviewConfig(candidate);
}

function validateReviewCandidate(candidate, options = {}) {
  const result = inspectReviewCandidate(candidate, options);
  if (!result.valid) throw new ConfigError("config_validation_failed", "Review config validation failed.", 422, result.errors);
  return result;
}

function reviewSemanticSummary(result) {
  return {
    rounds: result.effectiveRounds,
    requiredModelCount: result.effectiveRequiredModelCount,
    fallbackPairs: result.effectiveFallbackPairs,
    retry: result.effectiveRetry,
    maxTokensMode: result.effectiveMaxTokensMode,
    maxTokens: result.effectiveMaxTokens,
    autoFallbackMaxTokens: result.effectiveAutoFallbackMaxTokens,
    enableReasoningParams: result.effectiveEnableReasoningParams,
    providers: result.normalized.providers.map((provider) => ({
      providerId: provider.providerId,
      enabled: provider.enabled,
      apiMode: provider.apiMode,
      endpointConfigured: provider.endpointConfigured,
      credentialConfigured: provider.credentialConfigured,
      maxTokensMode: provider.maxTokensMode,
      maxTokens: provider.maxTokens,
      autoFallbackMaxTokens: provider.autoFallbackMaxTokens,
      enableReasoningParams: provider.enableReasoningParams,
      models: provider.models.map((model) => ({ modelId: model.modelId, enabled: model.enabled }))
    }))
  };
}

function reviewMigrationPreview(existing, candidate, before, after, module) {
  const legacyMigration = before.configShape === "legacy_flat" && after.configShape === "providers";
  const canonicalProfileMigration = before.configShape === "providers" && rootProfileNeedsMigration(existing, module);
  if (!legacyMigration && !canonicalProfileMigration) return { required: false, confirmationRequired: false };
  const beforeSemantics = reviewSemanticSummary(before);
  const afterSemantics = reviewSemanticSummary(after);
  const changes = [];
  if (legacyMigration) changes.push({ path: "providers", change: "legacy_flat_to_providers", providerCount: after.providerCount, modelCount: after.modelCount });
  if (legacyMigration || JSON.stringify(before.effectiveTimeoutProfile) !== JSON.stringify(after.effectiveTimeoutProfile)) {
    changes.push({
      path: "timeoutProfile",
      change: "controlled_formal_profile_migration",
      before: before.effectiveTimeoutProfile,
      after: after.effectiveTimeoutProfile,
      reason: legacyMigration
        ? "Legacy config is made explicit as the RAVO v0.5.1 root-level formal timeout profile."
        : "RAVO v0.5.1 formal Review uses one root-level timeout profile for every Provider/model pair."
    });
  }
  if (Array.isArray(existing.providers) && existing.providers.some(providerProfileFieldsPresent)) {
    changes.push({ path: "providers[].timeout", change: "remove_provider_level_timeout_fields", reason: "Canonical formal timeout settings are root-level only." });
  }
  const semanticChecks = {
    nonTimeoutSemanticsPreserved: JSON.stringify(stableValue(beforeSemantics)) === JSON.stringify(stableValue(afterSemantics)),
    providerCountPreserved: before.providerCount === after.providerCount,
    modelCountPreserved: before.modelCount === after.modelCount,
    endpointConfigurationPreserved: beforeSemantics.providers.every((provider, index) => provider.endpointConfigured === afterSemantics.providers[index]?.endpointConfigured),
    credentialConfigurationPreserved: beforeSemantics.providers.every((provider, index) => provider.credentialConfigured === afterSemantics.providers[index]?.credentialConfigured)
  };
  const preview = {
    required: true,
    confirmationRequired: true,
    sourceShape: before.configShape,
    targetShape: after.configShape,
    changes,
    semanticChecks,
    secretHandling: "keep_without_echo",
    legacyFieldsAfterWrite: "removed_after_validated_canonical_write",
    writeProtection: ["verified_backup", "atomic_write", "read_back", "0600_permissions"],
    candidateFingerprint: after.redactedConfigFingerprint
  };
  return { ...preview, previewId: sha(JSON.stringify(stableValue(preview))) };
}

function allowedProviderKeys() {
  return new Set([
    "id", "label", "enabled", "apiBase", "apiBaseConfigured", "apiMode", "apiKey", "credentialConfigured", "credentialStatus",
    "timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs", "stream", "maxTokensMode", "maxTokens", "autoFallbackMaxTokens",
    "enableReasoningParams", "models"
  ]);
}

const PROVIDER_TIMEOUT_FIELDS = ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs", "stream"];

function providerProfileFieldsPresent(provider) {
  return PROVIDER_TIMEOUT_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(provider || {}, key));
}

function rootProfileNeedsMigration(config, module) {
  const belowFloor = PROVIDER_TIMEOUT_FIELDS.filter((key) => key !== "stream").some((fieldPath) => {
    const field = module.fields.find((entry) => entry.path === fieldPath);
    const current = Number(getPath(config, fieldPath));
    return Number.isFinite(current) && current < field.default;
  });
  return belowFloor || config.stream === false || (Array.isArray(config.providers) && config.providers.some(providerProfileFieldsPresent));
}

function migrateFormalRootProfile(candidate, module) {
  for (const fieldPath of PROVIDER_TIMEOUT_FIELDS.filter((key) => key !== "stream")) {
    const field = module.fields.find((entry) => entry.path === fieldPath);
    const current = Number(getPath(candidate, fieldPath));
    setPath(candidate, fieldPath, Number.isFinite(current) ? Math.max(current, field.default) : field.default);
  }
  candidate.stream = true;
  if (Array.isArray(candidate.providers)) {
    candidate.providers = candidate.providers.map((provider) => {
      const next = clone(provider);
      for (const key of PROVIDER_TIMEOUT_FIELDS) delete next[key];
      return next;
    });
  }
  candidate.schemaVersion = "0.5.1";
}

function applySecretAction(existingValue, request, pathName) {
  if (request === undefined) return existingValue;
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new ConfigError("secret_action_required", `${pathName} must use keep, replace, or clear.`, 422, [{ path: pathName, code: "secret_action_required", message: "must use keep, replace, or clear" }]);
  if (request.action === "keep") return existingValue;
  if (request.action === "clear") return "";
  if (request.action === "replace" && typeof request.value === "string" && request.value.trim()) return request.value;
  throw new ConfigError("invalid_secret_action", `${pathName} has an invalid secret action.`, 422, [{ path: pathName, code: "invalid_secret_action", message: "replace requires a non-empty value" }]);
}

function prepareReviewCandidate(existing, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ConfigError("invalid_values", "values must be an object.");
  const module = moduleContract("review");
  const migratingLegacy = !Array.isArray(existing.providers)
    && ["apiBase", "apiMode", "apiKey", "models"].some((key) => existing[key] !== undefined)
    && Array.isArray(values.providers);
  const migratingCanonicalProfile = Array.isArray(existing.providers) && rootProfileNeedsMigration(existing, module);
  const fields = validateGenericPatch(module, values, "user");
  const candidate = clone(existing) || {};
  for (const field of fields.filter((field) => field.path !== "providers")) {
    if (hasPath(values, field.path)) setPath(candidate, field.path, getPath(values, field.path));
  }
  if (!hasPath(values, "providers")) {
    if (migratingCanonicalProfile) migrateFormalRootProfile(candidate, module);
    return candidate;
  }
  if (!Array.isArray(values.providers)) throw new ConfigError("config_validation_failed", "Review providers must be an array.", 422, [{ path: "providers", code: "invalid_type", message: "must be an array" }]);
  const existingProviders = Array.isArray(existing.providers)
    ? existing.providers
    : ["apiBase", "apiMode", "apiKey", "models"].some((key) => existing[key] !== undefined)
      ? [{
          id: "default",
          label: "Default",
          enabled: true,
          apiBase: existing.apiBase,
          apiMode: existing.apiMode,
          apiKey: existing.apiKey,
          timeoutMs: existing.timeoutMs,
          firstEventTimeoutMs: existing.firstEventTimeoutMs,
          firstContentTimeoutMs: existing.firstContentTimeoutMs,
          idleTimeoutMs: existing.idleTimeoutMs,
          stream: existing.stream,
          maxTokensMode: existing.maxTokensMode || (Number.isInteger(existing.maxTokens) ? "fixed" : undefined),
          maxTokens: existing.maxTokens,
          autoFallbackMaxTokens: existing.autoFallbackMaxTokens,
          enableReasoningParams: existing.enableReasoningParams,
          models: typeof existing.models === "string" ? existing.models.split(/[\s,]+/).filter(Boolean).map((id) => ({ id, enabled: true })) : existing.models
        }]
      : [];
  const byId = new Map(existingProviders.map((provider) => [provider.id, provider]));
  const providerKeys = allowedProviderKeys();
  candidate.providers = values.providers.map((submitted, index) => {
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) throw new ConfigError("config_validation_failed", "Provider must be an object.", 422, [{ path: `providers[${index}]`, code: "invalid_type", message: "must be an object" }]);
    const unknown = Object.keys(submitted).filter((key) => !providerKeys.has(key));
    if (unknown.length) throw new ConfigError("config_validation_failed", "Provider contains unknown fields.", 422, unknown.map((key) => ({ path: `providers[${index}].${key}`, code: "unknown_field", message: "is not declared" })));
    const timeoutOverrides = PROVIDER_TIMEOUT_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(submitted, key));
    if (timeoutOverrides.length) {
      throw new ConfigError(
        "config_validation_failed",
        "Formal Review timeout and stream settings are root-level only.",
        422,
        timeoutOverrides.map((key) => ({ path: `providers[${index}].${key}`, code: "provider_timeout_override_forbidden", message: "must be configured once at the Review root" }))
      );
    }
    const previous = byId.get(submitted.id) || {};
    const next = { ...clone(previous), ...clone(submitted) };
    next.apiKey = applySecretAction(previous.apiKey || "", submitted.apiKey, `providers[${index}].apiKey`);
    for (const key of ["credentialConfigured", "credentialStatus", "apiBaseConfigured", ...PROVIDER_TIMEOUT_FIELDS]) delete next[key];
    return next;
  });
  if (migratingLegacy || migratingCanonicalProfile) migrateFormalRootProfile(candidate, module);
  for (const key of ["apiBase", "apiMode", "apiKey", "models", "credentialConfigured", "credentialStatus"]) delete candidate[key];
  candidate.schemaVersion = "0.5.1";
  return candidate;
}

function applyGenericPatch(existing, module, values, scope) {
  const fields = validateGenericPatch(module, values, scope);
  const candidate = clone(existing) || {};
  for (const field of fields) if (hasPath(values, field.path)) setPath(candidate, field.path, getPath(values, field.path));
  if (module.moduleId === "core" && hasPath(values, "requestRouting")) setPath(candidate, "requestRouting", getPath(values, "requestRouting"));
  if (!candidate.schemaVersion) candidate.schemaVersion = "0.5.0";
  return candidate;
}

function fieldView(module, effective, sources, scope) {
  return module.fields
    .filter((field) => scope !== "workspace" || field.workspaceAllowed)
    .map((field) => ({
      ...field,
      effectiveValue: getPath(effective, field.path),
      source: sources[field.path] || "default"
    }));
}

function effectiveGenericView(module, target, options = {}) {
  const defaults = defaultUserConfig();
  const userState = readJsonState(target.paths.userRavo);
  const workspaceState = target.scope === "workspace" ? readJsonState(target.target) : { status: "missing", value: {} };
  const effective = target.scope === "workspace"
    ? deepMerge(deepMerge(defaults, userState.value), workspaceState.value)
    : deepMerge(defaults, userState.value);
  if (module.moduleId === "core") {
    for (const field of DEPRECATED_CORE_FIELDS) delete effective[field];
  }
  const sources = {};
  for (const field of module.fields) {
    sources[field.path] = target.scope === "workspace" && hasPath(workspaceState.value, field.path)
      ? "workspace"
      : hasPath(userState.value, field.path) ? "user" : "default";
  }
  const view = {
    moduleId: module.moduleId,
    displayName: module.displayName,
    scope: target.scope,
    target: target.targetKind,
    targetPath: target.target,
    sourcePrecedence: target.scope === "workspace" ? ["workspace", "user", "default"] : ["user", "default"],
    status: target.scope === "workspace" ? workspaceState.status : userState.status,
    configurable: module.fields.some((field) => target.scope !== "workspace" || field.workspaceAllowed),
    fields: fieldView(module, effective, sources, target.scope),
    warnings: [],
    backups: listBackups(module.moduleId, target, options),
    fingerprint: semanticFingerprint(effective)
  };
  if (module.moduleId === "core") {
    try { view.effectiveDeliveryProfile = resolveCoreProfile(effective, { ...options, profileSource: sources.deliveryProfile }); }
    catch (error) { view.warnings.push(error.message); }
  }
  return view;
}

function effectiveReviewView(module, target, options = {}) {
  const state = readJsonState(target.target);
  const raw = state.value;
  let validation;
  try {
    const { normalizeReviewConfig } = require(reviewValidatorPath(options));
    validation = normalizeReviewConfig(raw);
  } catch (error) {
    validation = { valid: false, configShape: "error", migrationStatus: "blocked", counts: {}, errors: [{ path: "review", code: error.code || "validator_error", message: error.message }], normalized: defaultModuleValues(module), redactedConfigFingerprint: "" };
  }
  const values = state.status === "missing" ? defaultModuleValues(module) : redactReviewConfig(raw);
  const fields = module.fields.map((field) => {
    let effectiveValue = field.path === "providers"
      ? (Array.isArray(values.providers) ? values.providers : [])
      : getPath(validation.normalized || values, field.path) ?? getPath(values, field.path) ?? field.default;
    if (field.type === "string-array" && Array.isArray(effectiveValue)) effectiveValue = effectiveValue.map(String);
    return {
      ...field,
      effectiveValue,
      source: hasPath(raw, field.path) || (field.path === "providers" && ["apiBase", "apiMode", "apiKey", "models"].some((key) => raw[key] !== undefined)) ? "user" : "default"
    };
  });
  return {
    moduleId: module.moduleId,
    displayName: module.displayName,
    scope: "user",
    target: "review",
    targetPath: target.target,
    sourcePrecedence: ["user", "default"],
    status: state.status,
    configurable: true,
    fields,
    values,
    configShape: validation.configShape,
    migrationStatus: validation.migrationStatus,
    counts: validation.counts,
    valid: validation.valid,
    errors: validation.errors,
    redactedConfigFingerprint: validation.redactedConfigFingerprint,
    runtimeOverride: process.env.RAVO_REVIEW_CONFIG ? "present" : "absent",
    warnings: process.env.RAVO_REVIEW_CONFIG ? ["RAVO_REVIEW_CONFIG runtime override is present; SoloDesk manages only the canonical config path."] : [],
    backups: listBackups(module.moduleId, target, options)
  };
}

function getConfig(moduleId, options = {}) {
  const module = moduleContract(moduleId);
  const target = targetFor(module, options);
  return module.target === "review" ? effectiveReviewView(module, target, options) : effectiveGenericView(module, target, options);
}

function validateConfig(moduleId, values, options = {}) {
  const module = moduleContract(moduleId);
  const target = targetFor(module, options);
  const existing = readJsonState(target.target);
  if (existing.status === "error") throw new ConfigError("config_parse_error", "Existing config is invalid JSON; repair it before using SoloDesk mutation.", 409);
  const candidate = module.target === "review"
    ? prepareReviewCandidate(existing.value, values)
    : applyGenericPatch(existing.value, module, values, target.scope);
  if (module.moduleId === "core") validateCoreCandidate(candidate, options);
  const beforeValidation = module.target === "review" ? inspectReviewCandidate(existing.value, options) : null;
  const validation = module.target === "review" ? validateReviewCandidate(candidate, options) : { valid: true, errors: [] };
  const migrationPreview = module.target === "review"
    ? reviewMigrationPreview(existing.value, candidate, beforeValidation, validation, module)
    : { required: false, confirmationRequired: false };
  const visibleCandidate = module.moduleId === "core" ? withoutDeprecatedCoreFields(candidate) : candidate;
  return {
    valid: true,
    moduleId,
    scope: target.scope,
    target: target.targetKind,
    fieldErrors: validation.errors || [],
    redactedConfigFingerprint: module.target === "review" ? validation.redactedConfigFingerprint : semanticFingerprint(visibleCandidate),
    candidate: module.target === "review" ? redactReviewConfig(candidate) : visibleCandidate,
    deprecatedIgnored: module.moduleId === "core" ? deprecatedCorePaths(values) : [],
    ...(module.target === "review" ? { migrationPreview } : {})
  };
}

function saveConfig(moduleId, values, options = {}) {
  const module = moduleContract(moduleId);
  if (!module.fields.length) throw new ConfigError("no_configurable_fields", `${module.displayName} has no configurable fields.`);
  const target = targetFor(module, options);
  return withMutationLock(options, () => {
    const existing = readJsonState(target.target);
    if (existing.status === "error") throw new ConfigError("config_parse_error", "Existing config is invalid JSON; no write was attempted.", 409);
    const candidate = module.target === "review"
      ? prepareReviewCandidate(existing.value, values)
      : applyGenericPatch(existing.value, module, values, target.scope);
    const deprecatedIgnored = module.moduleId === "core" ? deprecatedCorePaths(values) : [];
    if (module.target === "review") validateReviewCandidate(candidate, options);
    if (module.moduleId === "core") validateCoreCandidate(candidate, options);
    const submittedPaths = collectSubmittedPaths(values, new Set(module.fields.filter((field) => ["object-list", "string-array"].includes(field.type)).map((field) => field.path)));
    const onlyDeprecated = deprecatedIgnored.length > 0 && submittedPaths.every((field) => DEPRECATED_CORE_FIELDS.has(field));
    if (onlyDeprecated) {
      return {
        status: "deprecated_ignored",
        moduleId,
        scope: target.scope,
        deprecatedIgnored,
        config: getConfig(moduleId, options)
      };
    }
    const backup = createBackup(module, target, existing, options);
    try {
      atomicWriteJson(target.target, candidate, existing.stat);
    } catch (error) {
      if (backup.backupId) {
        const backupFile = path.join(target.paths.backupRoot, backup.backupId, "config.json");
        if (fs.existsSync(backupFile)) atomicWriteBuffer(target.target, fs.readFileSync(backupFile), existing.stat);
      }
      throw error;
    }
    return {
      status: "saved",
      moduleId,
      scope: target.scope,
      backup,
      deprecatedIgnored,
      config: getConfig(moduleId, options)
    };
  });
}

function listBackups(moduleId, target, options = {}) {
  const root = target?.paths?.backupRoot || configPaths(options).backupRoot;
  let ids = [];
  try { ids = fs.readdirSync(root).filter((id) => /^[A-Za-z0-9-]+$/.test(id)); } catch (_error) { return []; }
  return ids.map((id) => {
    const metadata = readJsonState(path.join(root, id, "metadata.json"));
    return metadata.status === "healthy" ? metadata.value : null;
  }).filter((entry) => entry && entry.moduleId === moduleId && (!target || (entry.scope === target.scope && entry.targetPath === target.target)))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .map((entry) => ({ backupId: entry.backupId, createdAt: entry.createdAt, scope: entry.scope, size: entry.size, status: "available" }));
}

function validateBackupValue(module, value, options = {}) {
  if (module.target === "review") validateReviewCandidate(value, options);
  else {
    for (const field of module.fields) if (hasPath(value, field.path)) {
      const errors = validateField(field, getPath(value, field.path));
      if (errors.length) throw new ConfigError("backup_validation_failed", "Backup does not satisfy the current config contract.", 422, errors);
    }
    if (module.moduleId === "core") validateCoreCandidate(value, options);
  }
}

function restoreConfig(moduleId, id, options = {}) {
  if (!/^[A-Za-z0-9-]+$/.test(String(id || ""))) throw new ConfigError("invalid_backup_id", "Backup id is invalid.");
  const module = moduleContract(moduleId);
  const target = targetFor(module, options);
  return withMutationLock(options, () => {
    const dir = path.join(target.paths.backupRoot, id);
    const metadataState = readJsonState(path.join(dir, "metadata.json"));
    const backupFile = path.join(dir, "config.json");
    if (metadataState.status !== "healthy" || !fs.existsSync(backupFile)) throw new ConfigError("backup_not_found", "Backup id was not found.", 404);
    const metadata = metadataState.value;
    if (metadata.moduleId !== moduleId || metadata.scope !== target.scope || metadata.targetPath !== target.target || metadata.targetKind !== target.targetKind) {
      throw new ConfigError("backup_scope_mismatch", "Backup does not belong to this module and scope.", 403);
    }
    const backupBytes = fs.readFileSync(backupFile);
    if (backupBytes.length !== metadata.size || sha(backupBytes) !== metadata.hash) throw new ConfigError("backup_integrity_failed", "Backup integrity validation failed.", 409);
    let backupValue;
    try { backupValue = JSON.parse(backupBytes.toString("utf8")); } catch (_error) {
      throw new ConfigError("backup_parse_error", "Backup is not valid JSON.", 409);
    }
    validateBackupValue(module, backupValue, options);
    const current = readJsonState(target.target);
    if (current.status === "error") throw new ConfigError("config_parse_error", "Current config is invalid JSON; automatic restore is blocked to preserve evidence.", 409);
    const preRestoreBackup = createBackup(module, target, current, options);
    atomicWriteBuffer(target.target, backupBytes, current.stat);
    return {
      status: "restored",
      moduleId,
      scope: target.scope,
      restoredBackupId: id,
      preRestoreBackup,
      config: getConfig(moduleId, options)
    };
  });
}

function listModules(options = {}) {
  return CONTRACT.modules.map((module) => ({
    moduleId: module.moduleId,
    displayName: module.displayName,
    scope: module.scope,
    target: module.target,
    configurable: module.fields.length > 0,
    fieldCount: module.fields.length,
    workspaceConfigurable: module.fields.some((field) => field.workspaceAllowed)
  }));
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-config.js --list-modules | --get <module> [--scope user|workspace --workspace <path>]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const argValue = (name, fallback = "") => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] || fallback : fallback;
  };
  const options = { home: argValue("--home", os.homedir()), scope: argValue("--scope", "user"), workspace: argValue("--workspace", "") };
  if (process.argv.includes("--list-modules")) console.log(JSON.stringify({ status: "ok", modules: listModules(options) }, null, 2));
  else if (process.argv.includes("--get")) console.log(JSON.stringify(getConfig(argValue("--get"), options), null, 2));
  else throw new ConfigError("missing_action", "Use --list-modules or --get.");
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || "config_error", message: error.message, fieldErrors: error.fieldErrors || [] })}\n`);
    process.exit(1);
  }
}

module.exports = {
  CONTRACT,
  ConfigError,
  atomicWriteBuffer,
  atomicWriteJson,
  configPaths,
  createBackup,
  defaultUserConfig,
  getConfig,
  listBackups,
  listModules,
  moduleContract,
  restoreConfig,
  saveConfig,
  semanticFingerprint,
  targetFor,
  validateConfig,
  withMutationLock
};
