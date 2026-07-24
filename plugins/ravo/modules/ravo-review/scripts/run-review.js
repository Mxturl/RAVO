#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluateDataBoundary, sanitizeText } = require("./review-boundary");
const { normalizeReviewConfig } = require("./review-config");
const { buildIssueLedger, extractFinalText, parseReviewResponse, parseSseEvents } = require("./review-response");
const { evaluateDiagnostic, evaluateReviewTrigger } = require("./review-trigger-gate");

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

const SCHEMA_VERSION = "0.5.1";
const PRODUCT_VERSION = "0.6.3";
const REVIEW_DIR = path.join("knowledge", ".ravo", "review");
const VALUE_OPTIONS = new Set([
  "--workspace", "--config", "--domain", "--subject", "--file", "--model", "--rounds", "--discussion-file",
  "--timeout-ms", "--first-event-timeout-ms", "--first-content-timeout-ms", "--idle-timeout-ms", "--run-class",
  "--max-tokens", "--max-attempts", "--base-delay-ms", "--max-delay-ms", "--data-boundary",
  "--authorization-source", "--redaction-summary", "--subject-ref", "--review-run-id", "--parent-review-run-id",
  "--compensation-for", "--provider-test", "--governance-path", "--trigger-reason", "--trigger-source-ref",
  "--decision-impact", "--trigger-evidence-ref", "--subject-version", "--diagnostic-reason"
]);
const FLAG_OPTIONS = new Set(["--help", "-h", "--version", "--no-stream", "--confirm-sensitive", "--preview"]);

function validateCliArgs() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (FLAG_OPTIONS.has(token)) continue;
    if (!VALUE_OPTIONS.has(token)) throw new Error(token.startsWith("-") ? `Unknown option: ${token}` : `Unexpected positional argument: ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    index += 1;
  }
}

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value, "utf8");
  fs.renameSync(tmp, file);
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function emitProgress(event) {
  if (process.env.RAVO_REVIEW_PROGRESS !== "jsonl") return;
  process.stderr.write(`RAVO_PROGRESS ${JSON.stringify({ ...event, emittedAt: new Date().toISOString() })}\n`);
}

function appendAttempt(attempts, value) {
  attempts.push(value);
  emitProgress({
    type: "attempt",
    reviewRunId: value.reviewRunId,
    providerModelKey: value.providerModelKey,
    round: value.round,
    attempt: value.attempt,
    attemptType: value.attemptType,
    reason: value.reason,
    result: value.result,
    parserStatus: value.parserStatus || "",
    providerStatus: value.providerStatus || "",
    finishReason: value.finishReason || "",
    incompleteReason: value.incompleteReason || "",
    requestedMaxTokens: value.requestedMaxTokens,
    triggerReason: value.triggerReason || "",
    timeoutType: value.timeoutType || "",
    partialBytes: value.partialBytes || 0,
    partialResponseRef: value.partialResponseRef || "",
    remainingAttemptBudget: value.remainingAttemptBudget,
    plannedDelayMs: value.plannedDelayMs,
    actualDelayMs: value.actualDelayMs
  });
}

function slug(value) {
  return String(value || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "review";
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch (_err) {
    return "";
  }
}

function subjectText() {
  const file = argValue("--file", "");
  if (file) return fs.readFileSync(path.resolve(file), "utf8");
  return argValue("--subject", "") || readStdin();
}

function configPath() {
  return path.resolve(argValue("--config", process.env.RAVO_REVIEW_CONFIG || path.join(os.homedir(), ".codex", "skill-config", "ravo-review.json")));
}

function numericOverride(name) {
  return hasArg(name) ? argValue(name) : undefined;
}

function rawProviders(config) {
  if (Array.isArray(config?.providers)) return config.providers;
  if (!config || !["apiBase", "apiMode", "apiKey", "models"].some((key) => config[key] !== undefined)) return [];
  return [{
    id: "default",
    label: "Default",
    enabled: true,
    apiBase: config.apiBase,
    apiMode: config.apiMode,
    apiKey: config.apiKey,
    models: config.models
  }];
}

function runtimePairs(config, configResult) {
  const sources = rawProviders(config);
  return configResult.normalized.providers.flatMap((provider, index) => {
    const source = sources[index] || {};
    return provider.models.filter((model) => provider.enabled && model.enabled).map((model) => ({
      key: model.providerModelKey,
      providerId: provider.providerId,
      modelId: model.modelId,
      apiMode: provider.apiMode,
      apiBase: String(source.apiBase || ""),
      apiKey: String(source.apiKey || ""),
      timeoutMs: provider.timeoutMs,
      firstEventTimeoutMs: provider.firstEventTimeoutMs,
      firstContentTimeoutMs: provider.firstContentTimeoutMs,
      idleTimeoutMs: provider.idleTimeoutMs,
      stream: provider.stream,
      requestedTimeoutProfile: { ...configResult.requestedTimeoutProfile },
      effectiveTimeoutProfile: {
        timeoutMs: provider.timeoutMs,
        firstEventTimeoutMs: provider.firstEventTimeoutMs,
        firstContentTimeoutMs: provider.firstContentTimeoutMs,
        idleTimeoutMs: provider.idleTimeoutMs,
        stream: provider.stream
      },
      maxTokensMode: provider.maxTokensMode,
      maxTokens: provider.maxTokens,
      autoFallbackMaxTokens: provider.autoFallbackMaxTokens,
      enableReasoningParams: provider.enableReasoningParams
    }));
  });
}

function resolveKeys(values, pairs, label) {
  const resolved = [];
  for (const value of values) {
    if (value.includes("/")) {
      if (!pairs.some((pair) => pair.key === value)) throw new Error(`${label} references unknown provider/model pair: ${value}`);
      resolved.push(value);
      continue;
    }
    const matches = pairs.filter((pair) => pair.modelId === value).map((pair) => pair.key);
    if (matches.length === 0) throw new Error(`${label} references unknown model: ${value}`);
    if (matches.length > 1) throw new Error(`${label} model id is ambiguous across providers: ${value}`);
    resolved.push(matches[0]);
  }
  return [...new Set(resolved)];
}

function selectPairs(configResult, allPairs) {
  const overrides = argValues("--model");
  const fallbackValues = configResult.effectiveFallbackPairs || [];
  const fallbackKeys = resolveKeys(fallbackValues, allPairs, "fallbackPairs");
  const requestedKeys = overrides.length
    ? resolveKeys(overrides, allPairs, "--model")
    : allPairs.map((pair) => pair.key).filter((key) => !fallbackKeys.includes(key));
  return {
    requested: allPairs.filter((pair) => requestedKeys.includes(pair.key)),
    fallback: allPairs.filter((pair) => fallbackKeys.includes(pair.key) && !requestedKeys.includes(pair.key))
  };
}

function endpointFor(pair) {
  const base = pair.apiBase.replace(/\/+$/, "");
  if (pair.apiMode === "responses" && !/\/responses$/i.test(base)) return `${base}/responses`;
  if (pair.apiMode === "chat" && !/\/chat\/completions$/i.test(base)) return `${base}/chat/completions`;
  return base;
}

function reviewerContract() {
  return [
    "Return one JSON object only. Do not wrap it in prose unless the transport forces a JSON code fence.",
    "Schema:",
    '{"summary":"non-empty","findings":[{"title":"non-empty","severity":"critical|high|medium|low","evidence":"specific evidence from the subject","mechanismRisk":"why this can fail or recur","recommendation":"concrete action","verification":{"kind":"command|script|file_inspection|official_document|procedure","steps":["deterministic step"],"command":"optional","expected":"observable result","environment":"target version/platform","safety":"read_only|mutation_requires_authorization","commandNotApplicableReason":"required without command/script"}}]}',
    "critical and high findings must include verification; medium and low findings may omit it.",
    "findings must contain at least one item. Do not invent evidence. Do not output private reasoning."
  ].join("\n");
}

function roundPurpose(round) {
  return round === 1 ? "independent_review" : round === 2 ? "challenge_response" : "convergence_adjudication";
}

function promptFor({ subject, domain, round, rounds, challengeBrief, convergenceBrief, ownRound1 }) {
  const common = [
    "Run an adversarial RAVO Review.",
    `Domain: ${domain}`,
    `Round: ${round} of ${rounds}`,
    `Purpose: ${roundPurpose(round)}`,
    reviewerContract()
  ];
  if (round === 1) return [...common, "", "Subject:", subject].join("\n");
  if (round === 2) return [
    ...common,
    "Use the challenge brief and your own Round 1 structured result. Do not replay other reviewers' full text.",
    "",
    "Challenge brief:",
    challengeBrief,
    "",
    "Your Round 1 result:",
    JSON.stringify(ownRound1 || {}, null, 2),
    "",
    "Subject excerpt:",
    subject.slice(0, 3000)
  ].join("\n");
  return [
    ...common,
    "Adjudicate the unresolved findings and identify residual risk.",
    "",
    "Convergence brief:",
    convergenceBrief
  ].join("\n");
}

function repairPrompt(original, parserErrors) {
  return [
    original,
    "",
    "Your previous response was unusable.",
    `Parser errors: ${parserErrors.join(", ")}`,
    "Return the required JSON object now. Do not include analysis or commentary outside the final JSON."
  ].join("\n");
}

function validReviewer(modelId, prompt) {
  return {
    summary: `${modelId} found an evidence-integrity risk.`,
    findings: [{
      title: `${modelId}: acceptance evidence can be overstated`,
      severity: /critical/i.test(modelId) ? "critical" : "high",
      evidence: `The reviewed prompt contains ${prompt.length} characters and requires evidence-matched status.`,
      mechanismRisk: "A response can be counted before final text, schema, and provenance are verified.",
      recommendation: "Count only structured, non-truncated final responses as usable and preserve their raw reference.",
      verification: {
        kind: "script",
        steps: ["Run the controlled Review parser fixture."],
        command: "node scripts/review-response-test.js",
        expected: "The parser accepts only a structured, non-truncated final response.",
        environment: "RAVO controlled fixture",
        safety: "read_only",
        commandNotApplicableReason: ""
      }
    }]
  };
}

function fakeResponse(pair, prompt, attempt, requestedMaxTokens) {
  const model = pair.modelId;
  const roundTwo = /Round:\s*2\s+of\s+/i.test(prompt);
  if (/round2-timeout/i.test(model) && roundTwo) {
    const error = new Error("fake round 2 timeout");
    error.kind = "timeout";
    error.timeoutType = "first_event_timeout";
    throw error;
  }
  if (/round2-schema/i.test(model) && roundTwo) {
    return { status: "completed", output_text: JSON.stringify({ summary: "invalid round 2", findings: [] }), usage: { output_tokens: 12 } };
  }
  const transient = /(?:timeout|429|503)-once/i.test(model) && attempt === 1;
  if (/timeout/i.test(model) && !/round2-timeout/i.test(model) && (!/-once/i.test(model) || transient)) {
    const error = new Error("fake timeout");
    error.kind = "timeout";
    error.timeoutType = "first_event_timeout";
    throw error;
  }
  if (/429/i.test(model) && (!/-once/i.test(model) || transient)) {
    const error = new Error("fake HTTP 429");
    error.kind = "provider-error";
    error.httpStatus = 429;
    throw error;
  }
  if (/503/i.test(model) && (!/-once/i.test(model) || transient)) {
    const error = new Error("fake HTTP 503");
    error.kind = "provider-error";
    error.httpStatus = 503;
    throw error;
  }
  if (/fail|error/i.test(model)) {
    const error = new Error("fake provider error");
    error.kind = "provider-error";
    throw error;
  }
  if (/empty/i.test(model)) return { status: "completed", output: [] };
  if (/reasoning/i.test(model)) return { status: "completed", output: [{ type: "reasoning", content: [{ type: "output_text", text: JSON.stringify(validReviewer(model, prompt)) }] }] };
  if (/trunc|length/i.test(model)) return {
    status: "incomplete",
    incomplete_details: { reason: requestedMaxTokens === null ? "provider_default_limit" : "max_output_tokens" },
    output_text: JSON.stringify(validReviewer(model, prompt)),
    usage: { output_tokens: requestedMaxTokens === null ? 2048 : requestedMaxTokens }
  };
  if (/invalid-finding-once/i.test(model) && attempt === 1) {
    return { status: "completed", output_text: JSON.stringify({ summary: "invalid first response", findings: [{ title: "missing fields" }] }) };
  }
  if (/schema/i.test(model) && !/schema-once/i.test(model)) return { status: "completed", output_text: JSON.stringify({ summary: "invalid", findings: [] }) };
  if (/schema-once/i.test(model) && attempt === 1) return { status: "completed", output_text: JSON.stringify({ summary: "invalid", findings: [] }) };
  return { status: "completed", output_text: JSON.stringify(validReviewer(model, prompt)), usage: { input_tokens: prompt.length, output_tokens: 128, total_tokens: prompt.length + 128 } };
}

function timeoutError(message, timeoutType = "timeout") {
  const error = new Error(message);
  error.kind = "timeout";
  error.timeoutType = timeoutType;
  return error;
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function phaseTiming(requestStartedAt = new Date().toISOString()) {
  return {
    requestStartedAt,
    responseHeadersAt: "",
    firstByteAt: "",
    firstEventAt: "",
    firstContentAt: "",
    lastEventAt: "",
    lastSubstantiveEventAt: "",
    abortAt: "",
    completedAt: ""
  };
}

function substantiveSseEventCount(body) {
  return parseSseEvents(body).filter((entry) => {
    const data = entry.data;
    const type = String(data?.type || entry.event || "").toLowerCase();
    if (/(?:^|[._-])(heartbeat|keepalive|ping|pong)(?:$|[._-])/.test(type)) return false;
    if (typeof data === "string") return Boolean(data.trim());
    return Boolean(data && typeof data === "object");
  }).length;
}

async function readStreamBody(response, pair, enforceStreamTimeouts = true, timing = phaseTiming()) {
  if (!response.body?.getReader) {
    try {
      const body = await response.text();
      const observedAt = new Date().toISOString();
      timing.firstByteAt = body ? observedAt : "";
      timing.firstEventAt = body ? observedAt : "";
      timing.firstContentAt = body.trim() ? observedAt : "";
      timing.lastEventAt = body ? observedAt : "";
      timing.lastSubstantiveEventAt = body.trim() ? observedAt : "";
      timing.completedAt = observedAt;
      return { body, phaseTiming: timing, responseBytes: byteLength(body) };
    } catch (error) {
      error.partialRaw = "";
      error.partialBytes = 0;
      error.phaseTiming = { ...timing, abortAt: new Date().toISOString() };
      throw error;
    }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  const startedAt = Date.now();
  const declaredSse = /text\/event-stream/i.test(String(response.headers?.get?.("content-type") || ""));
  let observedEventCount = 0;
  let observedSubstantiveEventCount = 0;
  let sawEvent = false;
  let sawContent = false;
  let idleDeadline = 0;

  try {
    while (true) {
      const now = Date.now();
      const deadlines = [];
      if (enforceStreamTimeouts && !sawEvent && pair.firstEventTimeoutMs > 0) {
        deadlines.push({ at: startedAt + pair.firstEventTimeoutMs, type: "first_event_timeout", message: "provider first-event timeout" });
      }
      if (enforceStreamTimeouts && !sawContent && pair.firstContentTimeoutMs > 0) {
        deadlines.push({ at: startedAt + pair.firstContentTimeoutMs, type: "first_content_timeout", message: "provider first-content timeout" });
      }
      if (enforceStreamTimeouts && sawEvent && pair.idleTimeoutMs > 0) {
        deadlines.push({ at: idleDeadline, type: "idle_timeout", message: "provider idle timeout" });
      }
      deadlines.sort((left, right) => left.at - right.at);
      const deadline = deadlines[0];
      if (deadline && deadline.at <= now) throw timeoutError(deadline.message, deadline.type);

      let timer;
      const read = reader.read();
      const result = deadline
        ? await Promise.race([
            read,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(timeoutError(deadline.message, deadline.type)), Math.max(1, deadline.at - now));
            })
          ])
        : await read;
      if (timer) clearTimeout(timer);
      if (result.done) break;
      chunks.push(decoder.decode(result.value, { stream: true }));
      const observedAt = new Date().toISOString();
      if (!timing.firstByteAt) timing.firstByteAt = observedAt;
      const body = chunks.join("");
      const isSse = declaredSse || /^(?:event|data):/m.test(body);
      const eventCount = isSse ? parseSseEvents(body).length : chunks.length;
      const substantiveEventCount = isSse ? substantiveSseEventCount(body) : chunks.length;
      if (eventCount > observedEventCount) {
        observedEventCount = eventCount;
        sawEvent = true;
        if (!timing.firstEventAt) timing.firstEventAt = observedAt;
        timing.lastEventAt = observedAt;
        if (!idleDeadline) idleDeadline = Date.now() + pair.idleTimeoutMs;
      }
      if (substantiveEventCount > observedSubstantiveEventCount) {
        observedSubstantiveEventCount = substantiveEventCount;
        timing.lastSubstantiveEventAt = observedAt;
        idleDeadline = Date.now() + pair.idleTimeoutMs;
      }
      if (!sawContent) {
        sawContent = isSse ? Boolean(extractFinalText(body).finalText) : Boolean(body.trim());
        if (sawContent) timing.firstContentAt = observedAt;
      }
    }
  } catch (error) {
    try { await reader.cancel(); } catch (_cancelError) { /* AbortController cleanup remains authoritative. */ }
    const partialRaw = chunks.join("");
    error.partialRaw = partialRaw;
    error.partialBytes = byteLength(partialRaw);
    error.phaseTiming = { ...timing, abortAt: new Date().toISOString() };
    throw error;
  }
  chunks.push(decoder.decode());
  const body = chunks.join("");
  timing.completedAt = new Date().toISOString();
  return { body, phaseTiming: timing, responseBytes: byteLength(body) };
}

async function postProvider(pair, prompt, stream, attempt = 1, requestedMaxTokens = pair.maxTokens) {
  const requestStartedAt = new Date().toISOString();
  const timing = phaseTiming(requestStartedAt);
  if (pair.apiMode === "fake" || /^fake:\/\//.test(pair.apiBase)) {
    try {
      const raw = fakeResponse(pair, prompt, attempt, requestedMaxTokens);
      const observedAt = new Date().toISOString();
      Object.assign(timing, {
        responseHeadersAt: observedAt,
        firstByteAt: observedAt,
        firstEventAt: observedAt,
        firstContentAt: observedAt,
        lastEventAt: observedAt,
        lastSubstantiveEventAt: observedAt,
        completedAt: observedAt
      });
      return { raw, phaseTiming: timing, responseBytes: byteLength(JSON.stringify(raw)) };
    } catch (error) {
      error.phaseTiming = {
        ...timing,
        abortAt: error.kind === "timeout" ? new Date().toISOString() : "",
        completedAt: error.kind === "timeout" ? "" : new Date().toISOString()
      };
      error.partialRaw = "";
      error.partialBytes = 0;
      throw error;
    }
  }
  if (!pair.apiBase || !pair.apiKey) {
    const error = new Error("missing provider apiBase or apiKey");
    error.kind = "missing-config";
    throw error;
  }
  const controller = new AbortController();
  let totalAbortAt = "";
  const timer = setTimeout(() => {
    totalAbortAt = new Date().toISOString();
    controller.abort();
  }, pair.timeoutMs);
  const isChat = pair.apiMode === "chat";
  const body = isChat
    ? {
        model: pair.modelId,
        messages: [
          { role: "system", content: `You are an adversarial reviewer.\n${reviewerContract()}` },
          { role: "user", content: prompt }
        ],
        ...(requestedMaxTokens === null ? {} : { max_tokens: requestedMaxTokens }),
        stream
      }
    : {
        model: pair.modelId,
        input: prompt,
        ...(requestedMaxTokens === null ? {} : { max_output_tokens: requestedMaxTokens }),
        stream,
        ...(pair.enableReasoningParams ? { reasoning: { effort: "medium" } } : {})
      };
  try {
    const response = await fetch(endpointFor(pair), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${pair.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    timing.responseHeadersAt = new Date().toISOString();
    const streamed = await readStreamBody(response, pair, stream, timing);
    const rawText = streamed.body;
    if (!response.ok) {
      const error = new Error(`provider HTTP ${response.status}`);
      error.kind = "provider-error";
      error.httpStatus = response.status;
      error.raw = rawText.slice(0, 4000);
      error.phaseTiming = streamed.phaseTiming;
      error.partialRaw = "";
      error.partialBytes = 0;
      throw error;
    }
    const raw = stream ? rawText : (() => {
      try { return JSON.parse(rawText); } catch (_err) { return rawText; }
    })();
    return { raw, phaseTiming: streamed.phaseTiming, responseBytes: streamed.responseBytes };
  } catch (err) {
    const error = new Error(err.name === "AbortError" ? "provider timeout" : err.message);
    error.kind = err.name === "AbortError" || totalAbortAt ? "timeout" : (err.kind || "connection");
    error.timeoutType = err.timeoutType || (err.name === "AbortError" || totalAbortAt ? "total_timeout" : "");
    error.httpStatus = err.httpStatus || 0;
    error.raw = err.raw || "";
    error.partialRaw = err.partialRaw || "";
    error.partialBytes = Number(err.partialBytes || 0);
    error.phaseTiming = {
      ...timing,
      ...(err.phaseTiming || {}),
      abortAt: err.phaseTiming?.abortAt || totalAbortAt || (error.kind === "timeout" ? new Date().toISOString() : ""),
      completedAt: error.kind === "timeout" ? "" : (err.phaseTiming?.completedAt || new Date().toISOString())
    };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function retryable(error, retry) {
  if (error.kind === "timeout") {
    // Retry only before the provider has returned valid content.
    const timeoutType = String(error.timeoutType || "");
    const hasFirstContent = Boolean(error.phaseTiming?.firstContentAt);
    return !hasFirstContent && ["first_event_timeout", "first_content_timeout"].includes(timeoutType);
  }
  return error.kind === "connection" || retry.retryableStatusCodes.includes(Number(error.httpStatus || 0));
}

function isStreamFallback(error, stream) {
  return stream && [400, 415, 422].includes(Number(error.httpStatus || 0));
}

function requiresOutputBudgetField(error, pair) {
  if (![400, 422].includes(Number(error.httpStatus || 0))) return false;
  const text = String(error.raw || error.message || "").toLowerCase();
  const mentionsTokenField = pair.apiMode === "chat"
    ? /max[_ -]?tokens/.test(text)
    : /max[_ -]?(?:output[_ -]?)?tokens/.test(text);
  return mentionsTokenField && /required|missing|must\s+(?:be\s+)?(?:provide|include|set)|field\s+required/.test(text);
}

function outputBudgetEvidence(pair, requestedMaxTokens, triggerReason) {
  return {
    maxTokensMode: requestedMaxTokens === null ? "auto" : "fixed",
    requestedMaxTokens,
    tokenField: requestedMaxTokens === null ? "omitted" : pair.apiMode === "chat" ? "max_tokens" : "max_output_tokens",
    triggerReason
  };
}

function providerBehaviorEvidence(parsed) {
  const behavior = parsed?.providerBehavior || {};
  return {
    providerStatus: behavior.status || "",
    finishReason: behavior.finishReason || "",
    incompleteReason: behavior.incompleteReason || "",
    usage: behavior.usage || {}
  };
}

async function waitDelay(ms) {
  if (ms <= 0) return { plannedDelayMs: 0, actualDelayMs: 0, delayStartedAt: "", delayEndedAt: "" };
  const started = Date.now();
  const delayStartedAt = new Date(started).toISOString();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const ended = Date.now();
  return { plannedDelayMs: ms, actualDelayMs: ended - started, delayStartedAt, delayEndedAt: new Date(ended).toISOString() };
}

function rawRefFor(runId, pair, round, attempt) {
  return path.join(REVIEW_DIR, "raw", `${runId}-${slug(pair.key)}-round-${round}-attempt-${attempt}.json`);
}

function timeoutEvidence(pair, stream) {
  return {
    requestedTimeoutProfile: pair.requestedTimeoutProfile,
    effectiveTimeoutProfile: {
      timeoutMs: pair.timeoutMs,
      firstEventTimeoutMs: pair.firstEventTimeoutMs,
      firstContentTimeoutMs: pair.firstContentTimeoutMs,
      idleTimeoutMs: pair.idleTimeoutMs,
      stream
    }
  };
}

function retryEvidence(retry, attempt, parameterDelta, delay = {}) {
  return {
    remainingAttemptBudget: Math.max(0, retry.maxAttempts - attempt),
    attemptBudget: { maxAttempts: retry.maxAttempts, attemptNumber: attempt, remainingAfterAttempt: Math.max(0, retry.maxAttempts - attempt) },
    retryParameterDelta: parameterDelta,
    jitterPolicy: "none",
    jitterRangeMs: { min: 0, max: 0 },
    plannedDelayMs: delay.plannedDelayMs || 0,
    actualDelayMs: delay.actualDelayMs || 0,
    delayStartedAt: delay.delayStartedAt || "",
    delayEndedAt: delay.delayEndedAt || ""
  };
}

function nextOutputBudget(pair, current) {
  const configured = Number(pair.autoFallbackMaxTokens || 0);
  const currentValue = current === null ? 0 : Number(current || 0);
  return configured > currentValue ? configured : 0;
}

async function runPairWithRetry({ workspace, reviewRunId, pair, round, prompt, retry, attempts, initialAttemptType = "initial", noStream = false }) {
  let attemptType = initialAttemptType;
  let currentPrompt = prompt;
  let stream = pair.stream && !noStream;
  let requestedMaxTokens = pair.maxTokensMode === "auto" ? null : pair.maxTokens;
  let triggerReason = initialAttemptType === "initial" ? "initial_request" : initialAttemptType;
  let responded = false;
  let lastParser = null;
  let lastError = null;
  let lastFailureReason = "";
  let parameterDelta = {};

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const ref = rawRefFor(reviewRunId, pair, round, attempt);
    try {
      const transport = await postProvider(pair, currentPrompt, stream, attempt, requestedMaxTokens);
      const raw = transport.raw;
      responded = true;
      writeJson(path.join(workspace, ref), { reviewRunId, providerModelKey: pair.key, round, attempt, raw });
      const parsed = parseReviewResponse(raw, { providerModelKey: pair.key, round, rawResponseRef: ref });
      lastParser = parsed;
      const endedMs = Date.now();
      const endedAt = new Date(endedMs).toISOString();
      if (parsed.usable) {
        appendAttempt(attempts, {
          reviewRunId, providerModelKey: pair.key, round, attempt, attemptType,
          reason: "usable_response", timeoutMs: pair.timeoutMs,
          startedAt, endedAt, durationMs: endedMs - startedMs, result: "usable", rawResponseRef: ref,
          timeoutType: "", phaseTiming: transport.phaseTiming, responseBytes: transport.responseBytes,
          partialResponseRef: "", partialBytes: 0,
          ...timeoutEvidence(pair, stream),
          ...retryEvidence(retry, attempt, parameterDelta),
          rawFindingCount: parsed.rawFindingCount, parserStatus: parsed.parserStatus, parserErrors: parsed.parserErrors,
          ...outputBudgetEvidence(pair, requestedMaxTokens, triggerReason),
          ...providerBehaviorEvidence(parsed)
        });
        return { pair, responded: true, usable: true, parser: parsed, rawResponseRef: ref, failureReason: "" };
      }
      const hasRemainingAttempt = attempt < retry.maxAttempts;
      const wantsOutputBudgetFallback = parsed.incomplete;
      const fallbackMaxTokens = nextOutputBudget(pair, requestedMaxTokens);
      const canOutputBudgetFallback = wantsOutputBudgetFallback && fallbackMaxTokens > 0 && hasRemainingAttempt;
      const canSemanticRetry = !wantsOutputBudgetFallback && hasRemainingAttempt;
      const plannedDelayMs = canSemanticRetry ? Math.min(retry.baseDelayMs * (2 ** (attempt - 1)), retry.maxDelayMs) : 0;
      const delay = canSemanticRetry ? await waitDelay(plannedDelayMs) : await waitDelay(0);
      const parserReason = parsed.parserErrors.join("|") || "semantic_failure";
      const reason = wantsOutputBudgetFallback
        ? pair.autoFallbackMaxTokens === 0
          ? `output_budget_fallback_disabled:${parsed.truncationReason || "incomplete"}`
          : fallbackMaxTokens === 0
            ? `output_budget_fallback_not_larger:${parsed.truncationReason || "incomplete"}`
          : hasRemainingAttempt
            ? `output_budget_fallback:${parsed.truncationReason || "incomplete"}`
            : `output_budget_fallback_budget_exhausted:${parsed.truncationReason || "incomplete"}`
        : parserReason;
      lastFailureReason = reason;
      appendAttempt(attempts, {
        reviewRunId, providerModelKey: pair.key, round, attempt, attemptType,
        reason,
        timeoutMs: pair.timeoutMs, startedAt, endedAt, durationMs: endedMs - startedMs,
        result: "responded_unusable", rawResponseRef: ref,
        timeoutType: "", phaseTiming: transport.phaseTiming, responseBytes: transport.responseBytes,
        partialResponseRef: "", partialBytes: 0,
        ...timeoutEvidence(pair, stream),
        ...retryEvidence(retry, attempt, parameterDelta, delay),
        rawFindingCount: parsed.rawFindingCount, parserStatus: parsed.parserStatus, parserErrors: parsed.parserErrors,
        ...outputBudgetEvidence(pair, requestedMaxTokens, triggerReason),
        ...providerBehaviorEvidence(parsed)
      });
      if (canOutputBudgetFallback) {
        attemptType = "output_budget_fallback";
        parameterDelta = { requestedMaxTokens: { from: requestedMaxTokens, to: fallbackMaxTokens } };
        requestedMaxTokens = fallbackMaxTokens;
        triggerReason = parsed.truncationReason || "incomplete";
        currentPrompt = prompt;
      } else if (canSemanticRetry) {
        attemptType = "semantic_retry";
        parameterDelta = { promptContract: { from: "original", to: "repair_prompt" } };
        triggerReason = parserReason;
        currentPrompt = repairPrompt(prompt, parsed.parserErrors);
      } else {
        break;
      }
    } catch (error) {
      lastError = error;
      const hasRemainingAttempt = attempt < retry.maxAttempts;
      const outputBudgetRequired = requestedMaxTokens === null && requiresOutputBudgetField(error, pair);
      const canOutputBudgetFallback = outputBudgetRequired && pair.autoFallbackMaxTokens > 0 && hasRemainingAttempt;
      const streamFallback = !outputBudgetRequired && isStreamFallback(error, stream);
      const canRetry = canOutputBudgetFallback || (hasRemainingAttempt && (streamFallback || retryable(error, retry)));
      const plannedDelayMs = canRetry && !streamFallback ? Math.min(retry.baseDelayMs * (2 ** (attempt - 1)), retry.maxDelayMs) : 0;
      const effectiveDelayMs = canOutputBudgetFallback ? 0 : plannedDelayMs;
      const endedMs = Date.now();
      const endedAt = new Date(endedMs).toISOString();
      const delay = canRetry ? await waitDelay(effectiveDelayMs) : await waitDelay(0);
      if (error.partialRaw) {
        writeJson(path.join(workspace, ref), {
          reviewRunId,
          providerModelKey: pair.key,
          round,
          attempt,
          partial: true,
          timeoutType: error.timeoutType || "",
          phaseTiming: error.phaseTiming || {},
          raw: error.partialRaw
        });
      } else if (error.raw) {
        writeJson(path.join(workspace, ref), { reviewRunId, providerModelKey: pair.key, round, attempt, error: error.raw });
      }
      const reason = outputBudgetRequired
        ? pair.autoFallbackMaxTokens === 0
          ? "output_budget_fallback_disabled:provider_token_field_required"
          : hasRemainingAttempt
            ? "output_budget_fallback:provider_token_field_required"
            : "output_budget_fallback_budget_exhausted:provider_token_field_required"
        : streamFallback
          ? canRetry ? "stream_fallback" : "stream_fallback_budget_exhausted"
          : (error.timeoutType || error.kind || "provider_error");
      lastFailureReason = reason;
      appendAttempt(attempts, {
        reviewRunId, providerModelKey: pair.key, round, attempt, attemptType,
        reason,
        timeoutMs: pair.timeoutMs, startedAt, endedAt, durationMs: endedMs - startedMs,
        result: canRetry ? "retrying" : "failed", ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
        timeoutType: error.timeoutType || "",
        phaseTiming: error.phaseTiming || phaseTiming(startedAt),
        responseBytes: error.raw ? byteLength(error.raw) : 0,
        partialResponseRef: error.partialRaw ? ref : "",
        partialBytes: Number(error.partialBytes || 0),
        ...(error.raw ? { rawResponseRef: ref } : {}),
        ...timeoutEvidence(pair, stream),
        ...retryEvidence(retry, attempt, parameterDelta, delay),
        ...outputBudgetEvidence(pair, requestedMaxTokens, triggerReason)
      });
      if (!canRetry) break;
      if (canOutputBudgetFallback) {
        attemptType = "output_budget_fallback";
        parameterDelta = { requestedMaxTokens: { from: requestedMaxTokens, to: pair.autoFallbackMaxTokens } };
        requestedMaxTokens = pair.autoFallbackMaxTokens;
        triggerReason = "provider_token_field_required";
      } else if (streamFallback) {
        parameterDelta = { stream: { from: true, to: false } };
        stream = false;
        attemptType = "stream_fallback";
        triggerReason = reason;
      } else {
        attemptType = "transport_retry";
        parameterDelta = {};
        triggerReason = reason;
      }
    }
  }
  const failureReason = lastFailureReason || (lastParser
    ? lastParser.parserErrors.join("|") || "semantic_failure"
    : `${lastError?.kind || "provider_error"}:${lastError?.message || "unknown failure"}`);
  return { pair, responded, usable: false, parser: lastParser, rawResponseRef: "", failureReason };
}

function coverageOf(done, total) {
  if (total <= 0 || done <= 0) return "none";
  return done >= total ? "full" : "partial";
}

function issueStatusCounts(issues) {
  return issues.reduce((counts, issue) => {
    const status = issue.status || "open";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function challengeBriefFor(ledger) {
  if (!ledger.issues.length) return "No usable finding exists. Challenge why the evidence could not be parsed or verified.";
  return ledger.issues.map((issue) => [
    `${issue.id}: ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Evidence: ${issue.evidence}`,
    `Mechanism risk: ${issue.mechanismRisk}`,
    "Question: keep, revise, withdraw, or add stronger evidence?"
  ].join("\n")).join("\n\n");
}

function convergenceBriefFor(ledger) {
  if (!ledger.issues.length) return "No usable finding exists; determine whether Review must remain unavailable.";
  return ledger.issues.map((issue) => [
    `${issue.id}: ${issue.title}`,
    `Evidence: ${issue.evidence}`,
    `Recommendation: ${issue.recommendation}`,
    "Adjudicate residual risk and the evidence needed to close it."
  ].join("\n")).join("\n\n");
}

async function runRound({ workspace, reviewRunId, round, rounds, primaryPairs, fallbackPairs, subject, domain, retry, attempts, previousReviewers, ledger, noStream, discussion, decisionImpact }) {
  const challengeBrief = round === 2 ? (discussion || challengeBriefFor(ledger)) : "";
  const convergenceBrief = round === 3 ? convergenceBriefFor(ledger) : "";
  const briefRef = round === 2
    ? path.join(REVIEW_DIR, "briefs", `${reviewRunId}-challenge.md`)
    : round === 3
      ? path.join(REVIEW_DIR, "briefs", `${reviewRunId}-convergence.md`)
      : "";
  if (briefRef) writeText(path.join(workspace, briefRef), round === 2 ? challengeBrief : convergenceBrief);
  const promptRecords = primaryPairs.map((pair) => ({
    pair,
    prompt: promptFor({
      subject,
      domain,
      round,
      rounds,
      challengeBrief,
      convergenceBrief,
      ownRound1: previousReviewers.get(pair.key)
    })
  }));
  const inputRef = path.join(REVIEW_DIR, "inputs", `${reviewRunId}-round-${round}.txt`);
  writeText(path.join(workspace, inputRef), promptRecords.map((record) => `--- ${record.pair.key} ---\n${record.prompt}`).join("\n\n"));
  const outcomes = await Promise.all(promptRecords.map((record) => runPairWithRetry({
    workspace, reviewRunId, pair: record.pair, round, prompt: record.prompt, retry, attempts, noStream
  })));
  const failedPrimary = outcomes.filter((outcome) => !outcome.usable);
  let fallbackOutcomes = [];
  if (failedPrimary.length && fallbackPairs.length) {
    const fallbackPrompts = fallbackPairs.map((pair) => ({
      pair,
      prompt: promptFor({ subject, domain, round, rounds, challengeBrief, convergenceBrief, ownRound1: previousReviewers.get(pair.key) })
    }));
    fallbackOutcomes = await Promise.all(fallbackPrompts.map((record) => runPairWithRetry({
      workspace, reviewRunId, pair: record.pair, round, prompt: record.prompt, retry, attempts, initialAttemptType: "model_fallback", noStream
    })));
  }
  const all = [...outcomes, ...fallbackOutcomes];
  const records = all.filter((outcome) => outcome.usable).map((outcome) => ({
    providerModelKey: outcome.pair.key,
    round,
    rawResponseRef: outcome.rawResponseRef,
    reviewer: outcome.parser.reviewer,
    decisionImpact
  }));
  const parserErrors = all.flatMap((outcome) => outcome.parser?.parserErrors || []);
  return {
    round,
    purpose: roundPurpose(round),
    briefRef,
    inputRef,
    inputHash: sha(fs.readFileSync(path.join(workspace, inputRef), "utf8")),
    primaryRequested: primaryPairs.map((pair) => pair.key),
    fallbackRequested: fallbackOutcomes.map((outcome) => outcome.pair.key),
    modelsResponded: all.filter((outcome) => outcome.responded).map((outcome) => outcome.pair.key),
    modelsUsable: all.filter((outcome) => outcome.usable).map((outcome) => outcome.pair.key),
    modelsFailed: all.filter((outcome) => !outcome.usable).map((outcome) => outcome.pair.key),
    failedModelReasons: all.filter((outcome) => !outcome.usable).map((outcome) => `${outcome.pair.key}: ${outcome.failureReason}`),
    parserErrors,
    records,
    coverage: coverageOf(outcomes.filter((outcome) => outcome.usable).length, primaryPairs.length)
  };
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: "0.3.1", workspace: ".", modules: {} };
  manifest.modules = manifest.modules || {};
  manifest.modules.review = {
    ...(manifest.modules.review || {}),
    enabled: true,
    artifacts: [REVIEW_DIR],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function callPlan(configResult, selected, rounds, boundary, subjectRef, subjectVersion, reviewTriggerGate) {
  const plannedPairs = [...selected.requested, ...selected.fallback];
  const retryDelayBudgetMs = Array.from({ length: Math.max(0, configResult.effectiveRetry.maxAttempts - 1) }, (_, index) => (
    Math.min(configResult.effectiveRetry.baseDelayMs * (2 ** index), configResult.effectiveRetry.maxDelayMs)
  )).reduce((sum, value) => sum + value, 0);
  const maximumRunMs = plannedPairs.reduce((sum, pair) => (
    sum + ((pair.timeoutMs * configResult.effectiveRetry.maxAttempts) + retryDelayBudgetMs) * rounds
  ), 0);
  return {
    configFingerprint: configResult.redactedConfigFingerprint,
    subjectRef,
    subjectVersion,
    subjectHash: boundary.subjectHash,
    reviewTriggerGate,
    dataBoundary: {
      decision: boundary.decision,
      authorizationSource: boundary.authorizationSource,
      externalCallAllowed: boundary.externalCallAllowed,
      redactionSummary: boundary.redactionSummary
    },
    providerCount: new Set(plannedPairs.map((pair) => pair.providerId)).size,
    modelCount: plannedPairs.length,
    requestedPairs: selected.requested.map((pair) => pair.key),
    fallbackPairs: selected.fallback.map((pair) => pair.key),
    endpointStatus: plannedPairs.map((pair) => ({
      providerModelKey: pair.key,
      apiMode: pair.apiMode,
      endpointConfigured: pair.apiMode === "fake" || /^fake:\/\//.test(pair.apiBase) || /^https?:\/\//.test(pair.apiBase),
      credentialStatus: pair.apiMode === "fake" || /^fake:\/\//.test(pair.apiBase) ? "not_required" : pair.apiKey ? "configured" : "missing"
    })),
    rounds,
    runClass: configResult.runClass,
    formalEvidenceEligible: configResult.formalEvidenceEligible,
    formalTimeoutProfile: configResult.formalTimeoutProfile,
    requestedTimeoutProfile: configResult.requestedTimeoutProfile,
    timeoutProfiles: plannedPairs.map((pair) => ({
      providerModelKey: pair.key,
      requested: pair.requestedTimeoutProfile,
      effective: pair.effectiveTimeoutProfile
    })),
    maxAttempts: configResult.effectiveRetry.maxAttempts,
    retryPolicy: {
      ...configResult.effectiveRetry,
      jitterPolicy: "none",
      jitterRangeMs: { min: 0, max: 0 },
      retryDelayBudgetMs
    },
    outputBudgets: plannedPairs.map((pair) => ({
      providerModelKey: pair.key,
      maxTokensMode: pair.maxTokensMode,
      requestedMaxTokens: pair.maxTokensMode === "auto" ? null : pair.maxTokens,
      autoFallbackMaxTokens: pair.autoFallbackMaxTokens
    })),
    streamFallbackConsumesAttempt: true,
    streamFallbackAvailable: configResult.effectiveRetry.maxAttempts >= 2,
    maximumRequests: plannedPairs.length * rounds * configResult.effectiveRetry.maxAttempts,
    maximumRunMs,
    artifactTypes: ["aggregate_review", "raw_response", "round_input", "issue_ledger"]
  };
}

async function providerTest({ workspace, pair, retry, noStream }) {
  const reviewRunId = `provider-test-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const attempts = [];
  const prompt = ["Provider connectivity test.", reviewerContract(), "Subject: generic non-sensitive test payload."].join("\n");
  const result = await runPairWithRetry({ workspace, reviewRunId, pair, round: 1, prompt, retry, attempts, noStream });
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "provider_test",
    runClass: "diagnostic",
    formalEvidenceEligible: false,
    coverage: "none",
    id: reviewRunId,
    providerModelKey: pair.key,
    usable: result.usable,
    attempts,
    failureReason: result.failureReason,
    createdAt: new Date().toISOString(),
    note: "Provider tests do not count as formal Review evidence."
  };
  const artifactPath = path.join(workspace, REVIEW_DIR, "provider-tests", `${reviewRunId}.json`);
  writeJson(artifactPath, artifact);
  return { status: result.usable ? "pass" : "fail", runClass: "diagnostic", formalEvidenceEligible: false, coverage: "none", artifactPath, providerModelKey: pair.key, usable: result.usable, attempts };
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    console.log([
      "Usage: run-review.js [options]",
      "  --subject <text> | --file <path>",
      "  --subject-ref <stable object id>",
      "  --subject-version <version|commit|baseline>",
      "  --governance-path governed_change --trigger-reason <reason> --trigger-source-ref <ref>",
      "  --decision-impact <description> [--trigger-evidence-ref <ref>]",
      "  --data-boundary safe_sanitized|sensitive_requires_consent|prohibited",
      "  --authorization-source explicit_user_action|conversation_confirmation|policy_safe_sanitized|none",
      "  --confirm-sensitive",
      "  --run-class formal|diagnostic [--diagnostic-reason user_explicit|provider_recovery|implementation_debug]",
      "  --preview",
      "  --provider-test <provider/model>"
    ].join("\n"));
    return;
  }
  if (hasArg("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  validateCliArgs();

  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const configFile = configPath();
  const config = readJson(configFile) || {};
  const overrides = {
    rounds: numericOverride("--rounds"),
    timeoutMs: numericOverride("--timeout-ms"),
    firstEventTimeoutMs: numericOverride("--first-event-timeout-ms"),
    firstContentTimeoutMs: numericOverride("--first-content-timeout-ms"),
    idleTimeoutMs: numericOverride("--idle-timeout-ms"),
    runClass: argValue("--run-class", hasArg("--provider-test") ? "diagnostic" : "formal"),
    maxTokens: numericOverride("--max-tokens"),
    noStream: hasArg("--no-stream"),
    retry: {
      maxAttempts: numericOverride("--max-attempts"),
      baseDelayMs: numericOverride("--base-delay-ms"),
      maxDelayMs: numericOverride("--max-delay-ms")
    }
  };
  const configResult = normalizeReviewConfig(config, overrides);
  const allPairs = runtimePairs(config, configResult);
  let selected = { requested: [], fallback: [] };
  const selectionErrors = [];
  try { selected = selectPairs(configResult, allPairs); } catch (error) { selectionErrors.push(error.message); }

  const subject = subjectText().trim();
  const discussionFile = argValue("--discussion-file", "");
  const discussion = discussionFile ? fs.readFileSync(path.resolve(discussionFile), "utf8") : "";
  const fakeOnly = [...selected.requested, ...selected.fallback].length > 0
    && [...selected.requested, ...selected.fallback].every((pair) => pair.apiMode === "fake" || /^fake:\/\//.test(pair.apiBase));
  const authorizationSource = argValue("--authorization-source", fakeOnly ? "policy_safe_sanitized" : "none");
  const boundary = evaluateDataBoundary([subject, discussion].filter(Boolean).join("\n\n"), {
    decision: argValue("--data-boundary", ""),
    authorizationSource,
    consentConfirmed: hasArg("--confirm-sensitive"),
    redactionSummary: argValues("--redaction-summary")
  });
  const sanitizedSubject = sanitizeText(subject);
  const sanitizedDiscussion = sanitizeText(discussion);
  const subjectRef = argValue("--subject-ref", "");
  const subjectVersion = argValue("--subject-version", "");
  const rounds = configResult.effectiveRounds;
  if (discussionFile && rounds < 2) throw new Error("--discussion-file requires --rounds 2 or 3");
  const formalTrigger = evaluateReviewTrigger({
    workspace,
    governancePath: argValue("--governance-path", ""),
    triggerReason: argValue("--trigger-reason", ""),
    triggerSourceRef: argValue("--trigger-source-ref", ""),
    triggerEvidenceRefs: argValues("--trigger-evidence-ref"),
    decisionImpact: argValue("--decision-impact", ""),
    subjectRef,
    subjectVersion,
    subjectHash: boundary.subjectHash
  });
  const diagnosticGate = evaluateDiagnostic({
    diagnosticReason: argValue("--diagnostic-reason", ""),
    modelCount: selected.requested.length,
    fallbackCount: selected.fallback.length,
    rounds
  });
  const reviewTriggerGate = configResult.runClass === "formal" ? formalTrigger : diagnosticGate;
  const plan = callPlan(configResult, selected, rounds, boundary, subjectRef, subjectVersion, reviewTriggerGate);
  emitProgress({
    type: "plan",
    subjectRef,
    requestedPairs: plan.requestedPairs,
    fallbackPairs: plan.fallbackPairs,
    rounds: plan.rounds,
    maxAttempts: plan.maxAttempts,
    maximumRequests: plan.maximumRequests,
    maximumRunMs: plan.maximumRunMs,
    runClass: plan.runClass,
    formalEvidenceEligible: plan.formalEvidenceEligible,
    dataBoundary: plan.dataBoundary
  });

  if (hasArg("--preview")) {
    console.log(JSON.stringify({
      status: configResult.valid && !selectionErrors.length && reviewTriggerGate.decision === "allow" ? "ok" : reviewTriggerGate.decision === "deny" ? "review_gate_denied" : "invalid_config",
      configPath: configFile,
      config: {
        valid: configResult.valid,
        configShape: configResult.configShape,
        migrationStatus: configResult.migrationStatus,
        counts: configResult.counts,
        errors: [...configResult.errors, ...selectionErrors.map((message) => ({ path: "selection", code: "invalid_selection", message }))],
        redactedConfigFingerprint: configResult.redactedConfigFingerprint
      },
      callPlan: plan,
      reviewTriggerGate
    }, null, 2));
    return;
  }

  const testKey = argValue("--provider-test", "");
  if (testKey) {
    if (!configResult.valid || selectionErrors.length) throw new Error("Provider test requires a valid shared Review configuration.");
    const keys = resolveKeys([testKey], allPairs, "--provider-test");
    const pair = allPairs.find((item) => item.key === keys[0]);
    console.log(JSON.stringify(await providerTest({ workspace, pair, retry: configResult.effectiveRetry, noStream: hasArg("--no-stream") }), null, 2));
    return;
  }

  if (reviewTriggerGate.decision !== "allow") {
    console.log(JSON.stringify({
      status: "review_gate_denied",
      reviewTriggerGate,
      callPlan: plan,
      externalRequestCount: 0,
      reviewArtifactsCreated: 0
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const started = Date.now();
  const createdAt = new Date().toISOString();
  const reviewRunId = argValue("--review-run-id", `${createdAt.replace(/[:.]/g, "-")}-${slug(argValue("--domain", "general"))}`);
  const domain = argValue("--domain", "general");
  const attempts = [];
  const roundResults = [];
  const reviewerRecords = [];
  const previousReviewers = new Map();
  let activePairs = selected.requested;
  let roundStopReason = "";
  const blockers = [
    ...configResult.errors.map((item) => `${item.path}:${item.code}`),
    ...selectionErrors,
    ...(!subject ? ["review subject is empty"] : []),
    ...(!boundary.externalCallAllowed ? [boundary.blockingReason] : []),
    ...(!selected.requested.length ? ["no requested provider/model pair"] : [])
  ].filter(Boolean);
  const canRun = configResult.valid && !selectionErrors.length && Boolean(subject) && boundary.externalCallAllowed && selected.requested.length > 0;

  if (canRun) {
    for (let round = 1; round <= rounds; round += 1) {
      if (round > 1 && !activePairs.length) {
        roundStopReason = `round${round}_no_usable_models`;
        break;
      }
      const ledger = buildIssueLedger(reviewerRecords);
      emitProgress({ type: "round_started", reviewRunId, round, pairs: activePairs.map((pair) => pair.key) });
      const result = await runRound({
        workspace,
        reviewRunId,
        round,
        rounds,
        primaryPairs: activePairs,
        fallbackPairs: selected.fallback.filter((pair) => !activePairs.some((active) => active.key === pair.key)),
        subject: sanitizedSubject,
        domain,
        retry: configResult.effectiveRetry,
        attempts,
        previousReviewers,
        ledger,
        noStream: hasArg("--no-stream"),
        discussion: sanitizedDiscussion,
        decisionImpact: reviewTriggerGate.decisionImpact || ""
      });
      roundResults.push(result);
      emitProgress({
        type: "round_completed",
        reviewRunId,
        round,
        coverage: result.coverage,
        modelsResponded: result.modelsResponded,
        modelsUsable: result.modelsUsable,
        modelsFailed: result.modelsFailed
      });
      reviewerRecords.push(...result.records);
      for (const record of result.records) if (round === 1) previousReviewers.set(record.providerModelKey, record.reviewer);
      activePairs = [...selected.requested, ...selected.fallback].filter((pair) => result.modelsUsable.includes(pair.key));
    }
  }

  const ledgerBase = buildIssueLedger(reviewerRecords);
  const issueLifecycleStatus = roundResults.length >= 3 ? "residual" : roundResults.length >= 2 ? "challenged" : "open";
  const issues = ledgerBase.issues.map((issue) => ({
    ...issue,
    status: issueLifecycleStatus,
    codexDecision: "none",
    codexDecisionReason: "",
    residualRisk: issue.mechanismRisk
  }));
  const respondedPairs = [...new Set(roundResults.flatMap((result) => result.modelsResponded))];
  const usablePairs = [...new Set(roundResults.flatMap((result) => result.modelsUsable))];
  const failedPairs = [...new Set(roundResults.flatMap((result) => result.modelsFailed))];
  const failedReasons = roundResults.flatMap((result) => result.failedModelReasons);
  const parserErrors = [...new Set(roundResults.flatMap((result) => result.parserErrors))];
  const validResults = reviewerRecords.length > 0;
  const expectedPairRounds = selected.requested.length * rounds;
  const invokedPairRounds = roundResults.reduce((count, result) => count + result.primaryRequested.length, 0);
  const respondedPairRounds = roundResults.reduce((count, result) => count + result.primaryRequested.filter((key) => result.modelsResponded.includes(key)).length, 0);
  const primaryWorkflowUsable = selected.requested.filter((pair) => roundResults.length === rounds && roundResults.every((result) => result.modelsUsable.includes(pair.key)));
  const requiredModelCount = configResult.effectiveRequiredModelCount || selected.requested.length;
  const parserStatus = !roundResults.length ? "not_run"
    : usablePairs.length === 0 ? "error"
      : parserErrors.length || roundResults.some((result) => result.modelsFailed.length) ? "partial"
        : ledgerBase.parserStatus;
  const computedWorkflowCoverage = !canRun || usablePairs.length === 0
    ? "none"
    : roundResults.length === rounds
      && primaryWorkflowUsable.length === selected.requested.length
      && primaryWorkflowUsable.length >= requiredModelCount
      && parserStatus === "pass"
      && ledgerBase.ledgerFindingCount > 0
      ? "full"
      : "partial";
  const formalEvidenceEligible = configResult.runClass === "formal" && configResult.formalEvidenceEligible === true;
  const workflowCoverage = formalEvidenceEligible ? computedWorkflowCoverage : "none";
  const diagnosticExecutionCoverage = configResult.runClass === "diagnostic" ? computedWorkflowCoverage : "not_applicable";
  const transportCoverage = coverageOf(respondedPairRounds, expectedPairRounds);
  const invocationCoverage = coverageOf(invokedPairRounds, expectedPairRounds);
  const issueLedgerRef = path.join(REVIEW_DIR, "issues", `${reviewRunId}.json`);
  const attemptRawFindingCount = attempts.reduce((count, attempt) => count + Number(attempt.rawFindingCount || 0), 0);
  const attemptParserErrors = [...new Set(attempts.flatMap((attempt) => Array.isArray(attempt.parserErrors) ? attempt.parserErrors : []))];
  writeJson(path.join(workspace, issueLedgerRef), {
    schemaVersion: SCHEMA_VERSION,
    findingDispositionVersion: "0.5.6",
    reviewRunId,
    parserStatus,
    rawFindingCount: attemptRawFindingCount,
    ledgerFindingCount: ledgerBase.ledgerFindingCount,
    deduplicatedCount: ledgerBase.deduplicatedCount,
    parserErrors: [...new Set([...ledgerBase.parserErrors, ...parserErrors, ...attemptParserErrors])],
    decisionImpact: reviewTriggerGate.decisionImpact || "",
    issues
  });

  attempts.sort((a, b) => `${a.startedAt}:${a.providerModelKey}:${a.attempt}`.localeCompare(`${b.startedAt}:${b.providerModelKey}:${b.attempt}`));
  const outputBudgetWarnings = [...new Set(attempts.flatMap((attempt) => {
    if (String(attempt.reason).startsWith("output_budget_fallback_disabled:")) {
      return [`${attempt.providerModelKey} round ${attempt.round}: output was incomplete, but autoFallbackMaxTokens=0 disabled compensation.`];
    }
    if (String(attempt.reason).startsWith("output_budget_fallback_not_larger:")) {
      return [`${attempt.providerModelKey} round ${attempt.round}: output was incomplete, but autoFallbackMaxTokens was not larger than the attempted fixed budget.`];
    }
    if (String(attempt.reason).startsWith("output_budget_fallback_budget_exhausted:")) {
      return [`${attempt.providerModelKey} round ${attempt.round}: output was incomplete, but no attempt remained for output-budget compensation.`];
    }
    return [];
  }))];
  const truncationWarnings = [...new Set([
    ...parserErrors.filter((error) => /truncat|incomplete|max_output_tokens|length/i.test(error)),
    ...failedReasons.filter((error) => /timeout/i.test(error)),
    ...outputBudgetWarnings
  ])];
  const providerBehavior = attempts.filter((attempt) => attempt.providerStatus
    || attempt.finishReason
    || attempt.incompleteReason
    || Object.keys(attempt.usage || {}).length).map((attempt) => ({
      providerModelKey: attempt.providerModelKey,
      round: attempt.round,
      attempt: attempt.attempt,
      status: attempt.providerStatus || "",
      finishReason: attempt.finishReason || "",
      incompleteReason: attempt.incompleteReason || "",
      usage: attempt.usage || {}
    }));
  const challengeRound = roundResults.find((result) => result.round === 2);
  const convergenceRound = roundResults.find((result) => result.round === 3);
  const challengeStatus = rounds < 2 ? "not_requested" : challengeRound?.coverage === "full" ? "complete" : "incomplete";
  const convergenceStatus = rounds < 3 ? "not_requested" : convergenceRound?.coverage === "full" ? "complete" : "incomplete";
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id: reviewRunId,
    reviewRunId,
    artifactKind: "aggregate",
    parentReviewRunId: argValue("--parent-review-run-id", ""),
    compensationFor: argValue("--compensation-for", ""),
    domain,
    subjectRef,
    subjectVersion,
    inputHash: boundary.subjectHash,
    runClass: configResult.runClass,
    formalEvidenceEligible,
    diagnosticExecutionCoverage,
    dataBoundary: {
      decision: boundary.decision,
      subjectHash: boundary.subjectHash,
      redactionSummary: boundary.redactionSummary,
      authorizationSource: boundary.authorizationSource,
      externalCallAllowed: boundary.externalCallAllowed,
      reason: boundary.reason
    },
    config: {
      valid: configResult.valid,
      configShape: configResult.configShape,
      migrationStatus: configResult.migrationStatus,
      counts: configResult.counts,
      errors: [...configResult.errors, ...selectionErrors.map((message) => ({ path: "selection", code: "invalid_selection", message }))],
      redactedConfigFingerprint: configResult.redactedConfigFingerprint,
      requiredModelCount,
      fallbackPairs: configResult.effectiveFallbackPairs,
      maxTokensMode: configResult.effectiveMaxTokensMode,
      maxTokens: configResult.effectiveMaxTokens,
      autoFallbackMaxTokens: configResult.effectiveAutoFallbackMaxTokens,
      timeoutProfile: configResult.effectiveTimeoutProfile,
      formalTimeoutProfile: configResult.formalTimeoutProfile,
      formalProfileErrors: configResult.formalProfileErrors
    },
    callPlan: plan,
    reviewTriggerGate,
    roundsRequested: rounds,
    roundsExecuted: roundResults.length,
    roundStopReason,
    roundPolicy: "fixed",
    orchestrationVersion: "multi-round-v2",
    modelsRequested: plan.requestedPairs,
    fallbackModelsPlanned: plan.fallbackPairs,
    modelsResponded: respondedPairs,
    modelsUsable: usablePairs,
    modelsCompleted: respondedPairs,
    modelsFailed: failedPairs,
    failedModelReasons: failedReasons,
    transportCoverage,
    invocationCoverage,
    workflowCoverage,
    coverage: workflowCoverage,
    computedWorkflowCoverage,
    validResults,
    parserStatus,
    rawFindingCount: attemptRawFindingCount,
    ledgerFindingCount: ledgerBase.ledgerFindingCount,
    deduplicatedCount: ledgerBase.deduplicatedCount,
    parserErrors: [...new Set([...ledgerBase.parserErrors, ...parserErrors, ...attemptParserErrors])],
    truncationWarnings,
    outputBudgetWarnings,
    providerBehavior,
    issueLedgerRef,
    findingDispositionVersion: "0.5.6",
    briefs: {
      challengeBriefRef: roundResults.find((result) => result.round === 2)?.briefRef || "",
      convergenceBriefRef: roundResults.find((result) => result.round === 3)?.briefRef || ""
    },
    issueStatusCounts: issueStatusCounts(issues),
    attempts,
    roundCoverage: roundResults.map((result) => ({
      round: result.round,
      purpose: result.purpose,
      briefRef: result.briefRef,
      coverage: result.coverage,
      primaryRequested: result.primaryRequested,
      fallbackRequested: result.fallbackRequested,
      modelsResponded: result.modelsResponded,
      modelsUsable: result.modelsUsable,
      modelsFailed: result.modelsFailed,
      failedModelReasons: result.failedModelReasons,
      parserErrors: result.parserErrors,
      inputRef: result.inputRef,
      inputHash: result.inputHash
    })),
    second_round_coverage: roundResults[1]?.coverage || null,
    challengeStatus,
    convergenceStatus,
    executionState: !canRun ? "unavailable" : configResult.runClass === "diagnostic" ? "diagnostic_complete" : workflowCoverage,
    summary: reviewerRecords.length
      ? reviewerRecords.map((record) => record.reviewer.summary).filter(Boolean).join(" | ")
      : `RAVO Review unavailable: ${blockers.join("; ") || "no usable reviewer response"}.`,
    risks: issues.map((issue) => `${issue.severity}: ${issue.title}`),
    recommendations: issues.map((issue) => issue.recommendation),
    blockingReason: !canRun ? blockers.join("; ") : !formalEvidenceEligible ? "diagnostic_review_not_formal_evidence" : "",
    blockerImpact: formalEvidenceEligible ? "" : "External Review evidence cannot support acceptance or release conclusions.",
    temporaryFallback: formalEvidenceEligible ? "" : boundary.temporaryFallback || "Use this run only for diagnosis, then rerun with the canonical formal profile.",
    recoveryEntry: formalEvidenceEligible ? "" : !canRun
      ? boundary.recoveryEntry || "Fix Review config and rerun the same subjectRef."
      : "Rerun the same sanitized subject with runClass=formal and the canonical uniform timeout profile.",
    timing: { totalMs: Date.now() - started },
    createdAt
  };
  artifact.pmBrief = buildPmBrief({
    headline: workflowCoverage === "full" ? "外部复核已经完成" : workflowCoverage === "partial" ? "外部复核只完成了一部分" : "外部复核没有形成可用结论",
    stage: "verify",
    productState: workflowCoverage === "full" && parserStatus === "pass" ? "validated" : "in_progress",
    userImpact: workflowCoverage === "full"
      ? `外部复核发现了 ${ledgerBase.ledgerFindingCount} 项需要处理的意见；它们不会自动改变当前产品。`
      : "当前外部意见不足以支持最终验收或发布判断，现有产品和使用环境不会因此改变。",
    actionRequired: "none",
    nextStep: "Codex 将处理有效发现、记录剩余风险，并继续完成本地验证。",
    decisionCard: null,
    evidenceBoundary: {
      proves: [workflowCoverage === "full" ? "已完成计划内的外部复核并保留发现记录" : "已记录本次外部复核的实际覆盖和失败情况"],
      doesNotProve: ["外部复核不能替代真实产品体验和发布验收"]
    },
    sourceRefs: [issueLedgerRef, `review:${reviewRunId}`]
  });
  const artifactPath = path.join(workspace, REVIEW_DIR, `${reviewRunId}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  emitProgress({
    type: "completed",
    reviewRunId,
    coverage: workflowCoverage,
    transportCoverage,
    invocationCoverage,
    workflowCoverage,
    computedWorkflowCoverage,
    diagnosticExecutionCoverage,
    runClass: configResult.runClass,
    formalEvidenceEligible,
    validResults,
    parserStatus,
    modelsResponded: respondedPairs,
    modelsUsable: usablePairs,
    modelsFailed: failedPairs,
    artifactPath
  });
  console.log(JSON.stringify({
    status: "ok",
    artifactPath,
    manifestPath,
    reviewRunId,
    callPlan: plan,
    reviewTriggerGate,
    coverage: workflowCoverage,
    transportCoverage,
    invocationCoverage,
    workflowCoverage,
    computedWorkflowCoverage,
    diagnosticExecutionCoverage,
    runClass: configResult.runClass,
    formalEvidenceEligible,
    validResults,
    parserStatus,
    modelsRequested: artifact.modelsRequested,
    modelsResponded: respondedPairs,
    modelsUsable: usablePairs,
    modelsCompleted: respondedPairs,
    modelsFailed: failedPairs,
    failedModelReasons: failedReasons,
    roundsRequested: rounds,
    roundsExecuted: roundResults.length,
    roundStopReason,
    roundCoverage: artifact.roundCoverage,
    second_round_coverage: artifact.second_round_coverage,
    challengeStatus: artifact.challengeStatus,
    convergenceStatus: artifact.convergenceStatus,
    issueLedgerRef,
    rawFindingCount: artifact.rawFindingCount,
    ledgerFindingCount: artifact.ledgerFindingCount,
    truncationWarnings,
    outputBudgetWarnings,
    providerBehavior,
    attempts
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`RAVO Review runner failed: ${error.message}\n`);
  process.exit(1);
});
