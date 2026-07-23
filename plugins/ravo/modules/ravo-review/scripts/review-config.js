const crypto = require("node:crypto");

const FORMAL_TIMEOUT_PROFILE = Object.freeze({
  timeoutMs: 900000,
  firstEventTimeoutMs: 120000,
  firstContentTimeoutMs: 300000,
  idleTimeoutMs: 180000,
  stream: true
});

const DEFAULTS = Object.freeze({
  rounds: 2,
  retry: Object.freeze({
    maxAttempts: 2,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    retryableStatusCodes: Object.freeze([429, 502, 503, 504])
  }),
  maxTokensMode: "auto",
  maxTokens: null,
  autoFallbackMaxTokens: 48000,
  ...FORMAL_TIMEOUT_PROFILE,
  enableReasoningParams: false,
});

const API_MODES = new Set(["responses", "chat", "fake"]);
const MAX_TOKENS_MODES = new Set(["auto", "fixed"]);
const RUN_CLASSES = new Set(["formal", "diagnostic"]);
const TIMEOUT_FIELDS = Object.freeze(["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs"]);
const RETRYABLE_STATUS_CODES = new Set(DEFAULTS.retry.retryableStatusCodes);
const SECRET_PLACEHOLDER = /^(?:replace|changeme|your[-_ ]?(?:api[-_ ]?)?key|example|placeholder)/i;

function error(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value, fallback, path, min, max, errors, coerce = false) {
  const candidate = coerce && typeof value === "string" && value.trim() ? Number(value) : value;
  if (value === undefined) return fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    errors.push(error(path, "out_of_range", `must be an integer from ${min} to ${max}`));
    return fallback;
  }
  return candidate;
}

function boolean(value, fallback, path, errors) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    errors.push(error(path, "invalid_type", "must be a boolean"));
    return fallback;
  }
  return value;
}

function outputBudget(values, inherited, paths, errors, coerce = false) {
  const hasMode = values.maxTokensMode !== undefined;
  const hasTokens = values.maxTokens !== undefined && values.maxTokens !== null && values.maxTokens !== "";
  let maxTokensMode = hasMode
    ? typeof values.maxTokensMode === "string" ? values.maxTokensMode.trim().toLowerCase() : values.maxTokensMode
    : hasTokens ? "fixed" : inherited.maxTokensMode;
  if (!MAX_TOKENS_MODES.has(maxTokensMode)) {
    errors.push(error(paths.maxTokensMode, "invalid_enum", "must be auto or fixed"));
    maxTokensMode = inherited.maxTokensMode;
  }

  let maxTokens = null;
  if (maxTokensMode === "fixed") {
    const candidate = hasTokens ? values.maxTokens : inherited.maxTokens;
    if (candidate === undefined || candidate === null || candidate === "") {
      errors.push(error(paths.maxTokens, "required", "is required when maxTokensMode is fixed"));
    } else {
      maxTokens = integer(candidate, inherited.maxTokens, paths.maxTokens, 1, 2000000, errors, coerce);
    }
  }

  const autoFallbackMaxTokens = integer(
    values.autoFallbackMaxTokens,
    inherited.autoFallbackMaxTokens,
    paths.autoFallbackMaxTokens,
    0,
    2000000,
    errors,
    coerce
  );
  return { maxTokensMode, maxTokens, autoFallbackMaxTokens };
}

function text(value, fallback, path, errors, required = false) {
  if (value === undefined || value === null) {
    if (required) errors.push(error(path, "required", "is required"));
    return fallback;
  }
  if (typeof value !== "string") {
    errors.push(error(path, "invalid_type", "must be a string"));
    return fallback;
  }
  const normalized = value.trim();
  if (required && !normalized) errors.push(error(path, "required", "must not be empty"));
  return normalized || fallback;
}

function hasCredential(provider, path, errors) {
  if (provider.credentialConfigured !== undefined && typeof provider.credentialConfigured !== "boolean") {
    errors.push(error(`${path}.credentialConfigured`, "invalid_type", "must be a boolean"));
  }
  if (provider.credentialStatus !== undefined && typeof provider.credentialStatus !== "string") {
    errors.push(error(`${path}.credentialStatus`, "invalid_type", "must be a string"));
  }
  if (provider.apiKey !== undefined && typeof provider.apiKey !== "string") {
    errors.push(error(`${path}.apiKey`, "invalid_type", "must be a string"));
  }
  if (provider.credentialConfigured === true || provider.credentialStatus === "configured") return true;
  return typeof provider.apiKey === "string"
    && provider.apiKey.trim().length > 0
    && !SECRET_PLACEHOLDER.test(provider.apiKey.trim());
}

function validateEndpoint(apiBase, apiMode, path, errors) {
  if (!apiBase) return false;
  try {
    const url = new URL(apiBase);
    const validProtocol = apiMode === "fake" ? url.protocol === "fake:" : ["http:", "https:"].includes(url.protocol);
    if (!validProtocol) throw new Error("unsupported protocol");
    return true;
  } catch (_err) {
    errors.push(error(path, "invalid_endpoint", apiMode === "fake"
      ? "must use fake:// for fake mode"
      : "must be an absolute http(s) URL"));
    return false;
  }
}

function endpointIdentity(apiBase) {
  if (!apiBase) return "";
  try {
    const url = new URL(apiBase);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (_err) {
    return "invalid";
  }
}

function normalizeRetry(configRetry, overrideRetry, errors) {
  const configured = configRetry === undefined ? {} : configRetry;
  const override = overrideRetry === undefined ? {} : overrideRetry;
  if (!isObject(configured)) errors.push(error("retry", "invalid_type", "must be an object"));
  if (!isObject(override)) errors.push(error("overrides.retry", "invalid_type", "must be an object"));
  const source = isObject(configured) ? configured : {};
  const cli = isObject(override) ? override : {};
  const pick = (key) => cli[key] !== undefined ? cli[key] : source[key];
  const pathFor = (key) => cli[key] !== undefined ? `overrides.retry.${key}` : `retry.${key}`;
  const maxAttempts = integer(pick("maxAttempts"), DEFAULTS.retry.maxAttempts, pathFor("maxAttempts"), 1, 10, errors, true);
  const baseDelayMs = integer(pick("baseDelayMs"), DEFAULTS.retry.baseDelayMs, pathFor("baseDelayMs"), 0, 300000, errors, true);
  let maxDelayMs = integer(pick("maxDelayMs"), DEFAULTS.retry.maxDelayMs, pathFor("maxDelayMs"), 0, 900000, errors, true);
  if (maxDelayMs < baseDelayMs) {
    errors.push(error(pathFor("maxDelayMs"), "invalid_range", "must be greater than or equal to baseDelayMs"));
    maxDelayMs = baseDelayMs;
  }

  const rawStatusCodes = pick("retryableStatusCodes") ?? DEFAULTS.retry.retryableStatusCodes;
  let retryableStatusCodes = DEFAULTS.retry.retryableStatusCodes.slice();
  if (!Array.isArray(rawStatusCodes) || rawStatusCodes.some((code) => !RETRYABLE_STATUS_CODES.has(Number(code)))) {
    errors.push(error(pathFor("retryableStatusCodes"), "invalid_status_codes", "may contain only 429, 502, 503, and 504"));
  } else {
    retryableStatusCodes = [...new Set(rawStatusCodes.map(Number))].sort((a, b) => a - b);
  }

  return { maxAttempts, baseDelayMs, maxDelayMs, retryableStatusCodes };
}

function rawProviders(config) {
  if (Array.isArray(config.providers)) return { configShape: "providers", providers: config.providers };
  const hasLegacyFields = ["apiBase", "apiMode", "apiKey", "models"].some((key) => config[key] !== undefined);
  if (!hasLegacyFields) return { configShape: "empty", providers: [] };
  return {
    configShape: "legacy_flat",
    providers: [{
      id: "default",
      label: "Default",
      enabled: true,
      apiBase: config.apiBase,
      apiMode: config.apiMode,
      apiKey: config.apiKey,
      credentialConfigured: config.credentialConfigured,
      credentialStatus: config.credentialStatus,
      timeoutMs: config.timeoutMs,
      firstEventTimeoutMs: config.firstEventTimeoutMs,
      firstContentTimeoutMs: config.firstContentTimeoutMs,
      idleTimeoutMs: config.idleTimeoutMs,
      stream: config.stream,
      maxTokensMode: config.maxTokensMode,
      maxTokens: config.maxTokens,
      autoFallbackMaxTokens: config.autoFallbackMaxTokens,
      models: config.models
    }]
  };
}

function normalizeModels(models, providerId, providerPath, errors) {
  const sourceModels = typeof models === "string"
    ? models.split(/[,\s]+/).map((model) => model.trim()).filter(Boolean)
    : models;
  if (!Array.isArray(sourceModels)) {
    errors.push(error(`${providerPath}.models`, "invalid_type", "must be an array or legacy comma-separated string"));
    return [];
  }
  const seen = new Set();
  return sourceModels.map((model, index) => {
    const modelPath = `${providerPath}.models[${index}]`;
    const source = typeof model === "string" ? { id: model, enabled: true } : model;
    if (!isObject(source)) {
      errors.push(error(modelPath, "invalid_type", "must be a model id string or object"));
      return { providerId, modelId: `model-${index + 1}`, enabled: false, providerModelKey: `${providerId}/model-${index + 1}` };
    }
    const modelId = text(source.id, `model-${index + 1}`, `${modelPath}.id`, errors, true);
    const enabled = boolean(source.enabled, true, `${modelPath}.enabled`, errors);
    if (seen.has(modelId)) errors.push(error(`${modelPath}.id`, "duplicate_model_id", "must be unique within its provider"));
    seen.add(modelId);
    return { providerId, modelId, enabled, providerModelKey: `${providerId}/${modelId}` };
  });
}

function normalizePairList(values, providers, field, errors) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    errors.push(error(field, "invalid_type", "must be an array of provider/model keys or unambiguous model ids"));
    return [];
  }
  const enabledModels = providers.flatMap((provider) => provider.enabled
    ? provider.models.filter((model) => model.enabled)
    : []);
  const resolved = [];
  values.forEach((value, index) => {
    const itemPath = `${field}[${index}]`;
    if (typeof value !== "string" || !value.trim()) {
      errors.push(error(itemPath, "invalid_pair", "must be a non-empty provider/model key or model id"));
      return;
    }
    const candidate = value.trim();
    let matches;
    if (candidate.includes("/")) {
      matches = enabledModels.filter((model) => model.providerModelKey === candidate);
    } else {
      matches = enabledModels.filter((model) => model.modelId === candidate);
    }
    if (matches.length === 0) {
      errors.push(error(itemPath, "unknown_pair", "must reference an enabled provider/model pair"));
      return;
    }
    if (matches.length > 1) {
      errors.push(error(itemPath, "ambiguous_model_id", "must use provider/model because this model id exists under multiple providers"));
      return;
    }
    const key = matches[0].providerModelKey;
    if (resolved.includes(key)) {
      errors.push(error(itemPath, "duplicate_pair", "must not repeat a provider/model pair"));
      return;
    }
    resolved.push(key);
  });
  return resolved;
}

function normalizeProvider(provider, index, inherited, errors, configShape, forcedBudget = null) {
  const providerPath = `providers[${index}]`;
  if (!isObject(provider)) {
    errors.push(error(providerPath, "invalid_type", "must be an object"));
    provider = {};
  }
  const providerId = text(provider.id, `provider-${index + 1}`, `${providerPath}.id`, errors, true);
  const label = text(provider.label, providerId, `${providerPath}.label`, errors);
  const enabled = boolean(provider.enabled, true, `${providerPath}.enabled`, errors);
  const apiMode = text(provider.apiMode, "responses", `${providerPath}.apiMode`, errors, configShape === "providers");
  if (!API_MODES.has(apiMode)) errors.push(error(`${providerPath}.apiMode`, "invalid_enum", "must be responses, chat, or fake"));
  const rawApiBase = text(provider.apiBase, "", `${providerPath}.apiBase`, errors);
  const endpointConfigured = validateEndpoint(rawApiBase, apiMode, `${providerPath}.apiBase`, errors);
  const credentialConfigured = hasCredential(provider, providerPath, errors);
  const timeoutMs = integer(provider.timeoutMs, inherited.timeoutMs, `${providerPath}.timeoutMs`, 1, 3600000, errors);
  const firstEventTimeoutMs = integer(provider.firstEventTimeoutMs, inherited.firstEventTimeoutMs, `${providerPath}.firstEventTimeoutMs`, 0, 3600000, errors);
  const firstContentTimeoutMs = integer(provider.firstContentTimeoutMs, inherited.firstContentTimeoutMs, `${providerPath}.firstContentTimeoutMs`, 0, 3600000, errors);
  const idleTimeoutMs = integer(provider.idleTimeoutMs, inherited.idleTimeoutMs, `${providerPath}.idleTimeoutMs`, 0, 3600000, errors);
  const stream = boolean(provider.stream, inherited.stream, `${providerPath}.stream`, errors);
  const budgetValues = forcedBudget ? {
    ...provider,
    maxTokensMode: forcedBudget.maxTokensMode,
    maxTokens: forcedBudget.maxTokens
  } : provider;
  const budget = outputBudget(budgetValues, inherited, {
    maxTokensMode: `${providerPath}.maxTokensMode`,
    maxTokens: `${providerPath}.maxTokens`,
    autoFallbackMaxTokens: `${providerPath}.autoFallbackMaxTokens`
  }, errors);
  const enableReasoningParams = boolean(provider.enableReasoningParams, inherited.enableReasoningParams, `${providerPath}.enableReasoningParams`, errors);
  const models = normalizeModels(provider.models, providerId, providerPath, errors);

  if (enabled && apiMode !== "fake" && !endpointConfigured) {
    errors.push(error(`${providerPath}.apiBase`, "endpoint_not_configured", "is required for an enabled provider"));
  }
  if (enabled && apiMode !== "fake" && !credentialConfigured) {
    errors.push(error(`${providerPath}.credential`, "credential_not_configured", "is required for an enabled provider"));
  }
  if (enabled && !models.some((model) => model.enabled)) {
    errors.push(error(`${providerPath}.models`, "no_enabled_models", "must include at least one enabled model"));
  }

  return {
    providerId,
    label,
    enabled,
    apiMode: API_MODES.has(apiMode) ? apiMode : "responses",
    credentialConfigured,
    endpointConfigured,
    timeoutMs,
    firstEventTimeoutMs,
    firstContentTimeoutMs,
    idleTimeoutMs,
    stream,
    maxTokensMode: budget.maxTokensMode,
    maxTokens: budget.maxTokens,
    autoFallbackMaxTokens: budget.autoFallbackMaxTokens,
    enableReasoningParams,
    models
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function validateOverrides(overrides, errors) {
  if (!isObject(overrides)) {
    errors.push(error("overrides", "invalid_type", "must be an object"));
    return {};
  }
  for (const key of ["apiKey", "apiBase", "credential", "providers"]) {
    if (overrides[key] !== undefined) errors.push(error(`overrides.${key}`, "forbidden_override", "cannot override provider endpoints or credentials"));
  }
  return overrides;
}

function timeoutProfile(value) {
  return {
    timeoutMs: value.timeoutMs,
    firstEventTimeoutMs: value.firstEventTimeoutMs,
    firstContentTimeoutMs: value.firstContentTimeoutMs,
    idleTimeoutMs: value.idleTimeoutMs,
    stream: value.stream
  };
}

function validateFormalProfile({ config, source, overrides, configured, effective, providers }, errors) {
  const formalErrors = [];
  const add = (path, code, message) => {
    const item = error(path, code, message);
    errors.push(item);
    formalErrors.push(item);
  };

  for (const field of TIMEOUT_FIELDS) {
    if (effective[field] < FORMAL_TIMEOUT_PROFILE[field]) {
      add(field, "invalid_formal_timeout_profile", `formal Review requires ${field} >= ${FORMAL_TIMEOUT_PROFILE[field]} for comparable external evidence; use --run-class diagnostic for bounded local experiments`);
    }
    if (overrides[field] !== undefined && effective[field] < configured[field]) {
      add(`overrides.${field}`, "formal_timeout_override_may_not_decrease", `formal Review overrides may only increase the configured ${field}`);
    }
  }
  if (effective.stream !== true) add("stream", "invalid_formal_timeout_profile", "formal Review requires stream=true for phase telemetry; use --run-class diagnostic for no-stream experiments");

  if (source.configShape === "providers") {
    source.providers.forEach((provider, index) => {
      for (const field of [...TIMEOUT_FIELDS, "stream"]) {
        if (provider?.[field] !== undefined) {
          add(`providers[${index}].${field}`, "provider_timeout_override_not_formal", "formal Review timeout and stream settings must come from the canonical root profile");
        }
      }
    });
  }

  providers.forEach((provider, index) => {
    for (const field of TIMEOUT_FIELDS) {
      if (provider[field] !== effective[field]) {
        add(`providers[${index}].${field}`, "non_uniform_formal_timeout_profile", `all formal provider/model pairs must inherit the same root ${field}`);
      }
    }
    if (provider.stream !== effective.stream) {
      add(`providers[${index}].stream`, "non_uniform_formal_timeout_profile", "all formal provider/model pairs must inherit root stream=true");
    }
  });

  return formalErrors;
}

function normalizeReviewConfig(input = {}, cliOverrides = {}) {
  const errors = [];
  const config = isObject(input) ? input : {};
  if (!isObject(input)) errors.push(error("config", "invalid_type", "must be an object"));
  if (config.schemaVersion !== undefined && typeof config.schemaVersion !== "string") {
    errors.push(error("schemaVersion", "invalid_type", "must be a string"));
  }
  const overrides = validateOverrides(cliOverrides, errors);
  const runClass = typeof overrides.runClass === "string" ? overrides.runClass.trim().toLowerCase() : "formal";
  if (!RUN_CLASSES.has(runClass)) errors.push(error("overrides.runClass", "invalid_run_class", "must be formal or diagnostic"));
  const source = rawProviders(config);
  if (config.providers !== undefined && !Array.isArray(config.providers)) {
    errors.push(error("providers", "invalid_type", "must be an array"));
  }

  const effectiveRounds = integer(overrides.rounds, integer(config.rounds, DEFAULTS.rounds, "rounds", 1, 3, errors), "overrides.rounds", 1, 3, errors, true);
  const configuredTimeoutMs = integer(config.timeoutMs, DEFAULTS.timeoutMs, "timeoutMs", 1, 3600000, errors);
  const configuredFirstEventTimeoutMs = integer(config.firstEventTimeoutMs, DEFAULTS.firstEventTimeoutMs, "firstEventTimeoutMs", 0, 3600000, errors);
  const configuredFirstContentTimeoutMs = integer(config.firstContentTimeoutMs, DEFAULTS.firstContentTimeoutMs, "firstContentTimeoutMs", 0, 3600000, errors);
  const configuredIdleTimeoutMs = integer(config.idleTimeoutMs, DEFAULTS.idleTimeoutMs, "idleTimeoutMs", 0, 3600000, errors);
  const effectiveTimeoutMs = integer(overrides.timeoutMs, configuredTimeoutMs, "overrides.timeoutMs", 1, 3600000, errors, true);
  const effectiveFirstEventTimeoutMs = integer(overrides.firstEventTimeoutMs, configuredFirstEventTimeoutMs, "overrides.firstEventTimeoutMs", 0, 3600000, errors, true);
  const effectiveFirstContentTimeoutMs = integer(overrides.firstContentTimeoutMs, configuredFirstContentTimeoutMs, "overrides.firstContentTimeoutMs", 0, 3600000, errors, true);
  const effectiveIdleTimeoutMs = integer(overrides.idleTimeoutMs, configuredIdleTimeoutMs, "overrides.idleTimeoutMs", 0, 3600000, errors, true);
  const effectiveStream = overrides.noStream === true
    ? false
    : boolean(overrides.stream, boolean(config.stream, DEFAULTS.stream, "stream", errors), "overrides.stream", errors);
  const cliMaxTokens = overrides.maxTokens;
  const cliRequestsAuto = typeof cliMaxTokens === "string" && cliMaxTokens.trim().toLowerCase() === "auto";
  const effectiveBudget = outputBudget({
    maxTokensMode: cliMaxTokens !== undefined
      ? cliRequestsAuto ? "auto" : "fixed"
      : overrides.maxTokensMode !== undefined ? overrides.maxTokensMode : config.maxTokensMode,
    maxTokens: cliMaxTokens !== undefined
      ? cliRequestsAuto ? null : cliMaxTokens
      : config.maxTokens,
    autoFallbackMaxTokens: overrides.autoFallbackMaxTokens !== undefined
      ? overrides.autoFallbackMaxTokens
      : config.autoFallbackMaxTokens
  }, DEFAULTS, {
    maxTokensMode: cliMaxTokens !== undefined || overrides.maxTokensMode !== undefined ? "overrides.maxTokensMode" : "maxTokensMode",
    maxTokens: cliMaxTokens !== undefined ? "overrides.maxTokens" : "maxTokens",
    autoFallbackMaxTokens: overrides.autoFallbackMaxTokens !== undefined ? "overrides.autoFallbackMaxTokens" : "autoFallbackMaxTokens"
  }, errors, true);
  const effectiveEnableReasoningParams = boolean(overrides.enableReasoningParams, boolean(config.enableReasoningParams, DEFAULTS.enableReasoningParams, "enableReasoningParams", errors), "overrides.enableReasoningParams", errors);
  const effectiveRetry = normalizeRetry(config.retry, overrides.retry, errors);
  const inherited = {
    timeoutMs: effectiveTimeoutMs,
    firstEventTimeoutMs: effectiveFirstEventTimeoutMs,
    firstContentTimeoutMs: effectiveFirstContentTimeoutMs,
    idleTimeoutMs: effectiveIdleTimeoutMs,
    stream: effectiveStream,
    maxTokensMode: effectiveBudget.maxTokensMode,
    maxTokens: effectiveBudget.maxTokens,
    autoFallbackMaxTokens: effectiveBudget.autoFallbackMaxTokens,
    enableReasoningParams: effectiveEnableReasoningParams
  };
  const forcedBudget = cliMaxTokens !== undefined || overrides.maxTokensMode !== undefined
    ? { maxTokensMode: effectiveBudget.maxTokensMode, maxTokens: effectiveBudget.maxTokens }
    : null;
  const providers = source.providers.map((provider, index) => normalizeProvider(provider, index, inherited, errors, source.configShape, forcedBudget));
  const effectiveProfile = timeoutProfile(inherited);
  const configuredProfile = {
    timeoutMs: configuredTimeoutMs,
    firstEventTimeoutMs: configuredFirstEventTimeoutMs,
    firstContentTimeoutMs: configuredFirstContentTimeoutMs,
    idleTimeoutMs: configuredIdleTimeoutMs,
    stream: boolean(config.stream, DEFAULTS.stream, "stream", [])
  };
  const formalProfileErrors = runClass === "formal" ? validateFormalProfile({
    config,
    source,
    overrides,
    configured: configuredProfile,
    effective: effectiveProfile,
    providers
  }, errors) : [];

  const providerIds = new Set();
  providers.forEach((provider, index) => {
    if (providerIds.has(provider.providerId)) errors.push(error(`providers[${index}].id`, "duplicate_provider_id", "must be unique"));
    providerIds.add(provider.providerId);
  });
  if (source.configShape === "empty" || providers.length === 0) {
    errors.push(error("providers", "missing_providers", "configure providers[] or legacy flat provider fields"));
  }

  const providerCount = providers.length;
  const modelCount = providers.reduce((count, provider) => count + provider.models.length, 0);
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const enabledProviderCount = enabledProviders.length;
  const enabledModelCount = enabledProviders.reduce((count, provider) => count + provider.models.filter((model) => model.enabled).length, 0);
  const fallbackPairs = normalizePairList(config.fallbackPairs, providers, "fallbackPairs", errors);
  const requestedModelCount = enabledModelCount - fallbackPairs.length;
  if (requestedModelCount <= 0 && enabledModelCount > 0) {
    errors.push(error("fallbackPairs", "no_primary_models", "must leave at least one enabled provider/model pair as a primary Review target"));
  }
  const requiredModelCount = requestedModelCount > 0
    ? integer(config.requiredModelCount, requestedModelCount, "requiredModelCount", 1, requestedModelCount, errors)
    : 0;
  const normalized = {
    schemaVersion: "0.5.1",
    rounds: effectiveRounds,
    requiredModelCount,
    fallbackPairs,
    retry: effectiveRetry,
    timeoutMs: effectiveTimeoutMs,
    firstEventTimeoutMs: effectiveFirstEventTimeoutMs,
    firstContentTimeoutMs: effectiveFirstContentTimeoutMs,
    idleTimeoutMs: effectiveIdleTimeoutMs,
    stream: effectiveStream,
    maxTokensMode: effectiveBudget.maxTokensMode,
    maxTokens: effectiveBudget.maxTokens,
    autoFallbackMaxTokens: effectiveBudget.autoFallbackMaxTokens,
    enableReasoningParams: effectiveEnableReasoningParams,
    providers
  };
  const fingerprintProviders = normalized.providers.map((provider, index) => ({
    ...provider,
    endpointIdentity: endpointIdentity(source.providers[index]?.apiBase)
  }));
  const redactedConfigFingerprint = fingerprint({ ...normalized, providers: fingerprintProviders });
  const valid = errors.length === 0;
  const formalEvidenceEligible = runClass === "formal" && formalProfileErrors.length === 0 && valid;
  const migrationStatus = source.configShape === "legacy_flat"
    ? valid ? "available" : "blocked"
    : source.configShape === "providers" ? "not_required" : "not_applicable";

  return {
    valid,
    runClass: RUN_CLASSES.has(runClass) ? runClass : "diagnostic",
    formalEvidenceEligible,
    formalTimeoutProfile: FORMAL_TIMEOUT_PROFILE,
    requestedTimeoutProfile: configuredProfile,
    effectiveTimeoutProfile: effectiveProfile,
    formalProfileErrors,
    configShape: source.configShape,
    migrationStatus,
    providerCount,
    modelCount,
    enabledProviderCount,
    enabledModelCount,
    counts: { providerCount, modelCount, enabledProviderCount, enabledModelCount },
    errors,
    normalized,
    redactedConfigFingerprint,
    effective: {
      rounds: effectiveRounds,
      retry: effectiveRetry,
      timeoutMs: effectiveTimeoutMs,
      firstEventTimeoutMs: effectiveFirstEventTimeoutMs,
      firstContentTimeoutMs: effectiveFirstContentTimeoutMs,
      idleTimeoutMs: effectiveIdleTimeoutMs,
      stream: effectiveStream,
      maxTokensMode: effectiveBudget.maxTokensMode,
      maxTokens: effectiveBudget.maxTokens,
      autoFallbackMaxTokens: effectiveBudget.autoFallbackMaxTokens,
      enableReasoningParams: effectiveEnableReasoningParams
    },
    effectiveRounds,
    effectiveRequiredModelCount: requiredModelCount,
    effectiveFallbackPairs: fallbackPairs,
    effectiveRetry,
    effectiveTimeoutMs,
    effectiveFirstEventTimeoutMs,
    effectiveFirstContentTimeoutMs,
    effectiveIdleTimeoutMs,
    effectiveStream,
    effectiveMaxTokensMode: effectiveBudget.maxTokensMode,
    effectiveMaxTokens: effectiveBudget.maxTokens,
    effectiveAutoFallbackMaxTokens: effectiveBudget.autoFallbackMaxTokens,
    effectiveEnableReasoningParams
  };
}

function validateReviewConfig(input = {}, cliOverrides = {}) {
  return normalizeReviewConfig(input, cliOverrides);
}

function providerModelKey(providerId, modelId) {
  return `${String(providerId)}/${String(modelId)}`;
}

module.exports = {
  DEFAULTS,
  FORMAL_TIMEOUT_PROFILE,
  RUN_CLASSES,
  normalizeReviewConfig,
  providerModelKey,
  validateReviewConfig
};
