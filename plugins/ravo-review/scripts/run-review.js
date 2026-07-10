#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.1";
const REVIEW_DIR = path.join("knowledge", ".ravo", "review");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.flatMap(splitList).filter(Boolean);
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  if (value && typeof value === "object" && value.id) return [String(value.id)];
  return String(value || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "review";
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function readRavoConfig(workspace) {
  return readJson(path.join(workspace, "knowledge", ".ravo", "config.json"))
    || readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json"))
    || {};
}

function technicalDetailLevel(workspace) {
  const level = readRavoConfig(workspace).technicalDetailLevel;
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : 3;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
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
  const direct = argValue("--subject", "");
  if (direct) return direct;
  return readStdin();
}

function configPath() {
  return path.resolve(
    argValue("--config", process.env.RAVO_REVIEW_CONFIG || path.join(os.homedir(), ".codex", "skill-config", "ravo-review.json"))
  );
}

function clampRoundCount(value) {
  const rounds = Number(value ?? 2);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) {
    throw new Error("review rounds must be an integer from 1 to 3");
  }
  return rounds;
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return splitList(models);
  return models.flatMap((model) => {
    if (typeof model === "string") return splitList(model);
    if (model && model.enabled !== false && model.id) return [String(model.id)];
    return [];
  });
}

function normalizeProviders(config) {
  if (!config) return [];
  const timeoutOverride = Number(argValue("--timeout-ms", "0"));
  const inherited = {
    maxTokens: config.maxTokens || 4000,
    timeoutMs: timeoutOverride || config.timeoutMs || 120000,
    stream: config.stream !== false
  };
  const providers = Array.isArray(config.providers) ? config.providers : [{
    id: "default",
    label: "Default",
    enabled: true,
    apiBase: config.apiBase,
    apiMode: config.apiMode,
    apiKey: config.apiKey,
    models: config.models,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    stream: config.stream
  }];
  return providers
    .filter((provider) => provider && provider.enabled !== false)
    .map((provider) => ({
      id: String(provider.id || provider.label || "provider"),
      label: String(provider.label || provider.id || "provider"),
      apiBase: provider.apiBase || "",
      apiMode: provider.apiMode || "responses",
      apiKey: provider.apiKey || "",
      maxTokens: provider.maxTokens || inherited.maxTokens,
      timeoutMs: timeoutOverride || provider.timeoutMs || inherited.timeoutMs,
      stream: provider.stream !== undefined ? provider.stream !== false : inherited.stream,
      models: normalizeModels(provider.models)
    }))
    .filter((provider) => provider.models.length > 0);
}

function modelKey(provider, model) {
  return `${provider.id}/${model}`;
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}\n[truncated ${text.length - max} chars]` : text;
}

function roundPurpose(round) {
  return round === 1 ? "independent_review" : round === 2 ? "challenge_response" : "convergence_adjudication";
}

function promptFor({ subject, domain, round, rounds, challengeBrief, convergenceBrief, ownRound1, issueLedger }) {
  const common = [
    "Run an adversarial RAVO Review.",
    `Domain: ${domain}`,
    `Round: ${round} of ${rounds}`,
    `Purpose: ${roundPurpose(round)}`,
    "Return concise findings with risks and recommendations.",
    "Do not assume evidence that is not present."
  ];
  if (round === 1) {
    return [...common, "", "Subject:", subject].join("\n");
  }
  if (round === 2) {
    return [
      ...common,
      "Use only the challenge brief and your own Round 1 result. Do not rely on other reviewers' full Round 1 text.",
      "",
      "Challenge brief:",
      challengeBrief,
      "",
      "Your own Round 1 result:",
      truncate(ownRound1, 12000),
      "",
      "Subject excerpt for disputed issues only:",
      truncate(subject, 2000)
    ].join("\n");
  }
  return [
    ...common,
    "Adjudicate whether Codex provisional decisions fit the evidence. Do not replay the original subject as the main input.",
    "",
    "Convergence brief:",
    convergenceBrief,
    "",
    "Current issue ledger:",
    truncate(JSON.stringify(issueLedger, null, 2), 16000)
  ].join("\n");
}

function fakeReview(model, subject) {
  if (/timeout/i.test(model)) {
    const error = new Error("fake timeout");
    error.kind = "timeout";
    throw error;
  }
  if (/fail|error/i.test(model)) {
    const error = new Error("fake provider error");
    error.kind = "provider-error";
    throw error;
  }
  const truncated = /trunc|length/i.test(model);
  return {
    text: [
      `Summary: reviewed ${subject.slice(0, 80) || "empty subject"}`,
      "Risk: evidence may be incomplete.",
      "Recommendation: keep acceptance status tied to artifacts."
    ].join("\n"),
    finishReason: truncated ? "length" : "stop",
    raw: { fake: true, model, truncated }
  };
}

function parseSse(text) {
  return text.split(/\n\n+/)
    .map((event) => event.split(/\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"))
    .filter((data) => data && data !== "[DONE]")
    .map((data) => {
      try { return JSON.parse(data); } catch (_err) { return data; }
    });
}

function extractText(apiMode, payload) {
  if (typeof payload === "string") return { text: payload, finishReason: "" };
  if (payload?.output_text) return { text: String(payload.output_text), finishReason: payload.finish_reason || "" };
  if (Array.isArray(payload?.output)) {
    const text = payload.output.flatMap((item) => item.content || [])
      .map((part) => part.text || part.output_text || "")
      .join("\n")
      .trim();
    return { text, finishReason: payload.status === "incomplete" ? "length" : "" };
  }
  if (Array.isArray(payload?.choices)) {
    return {
      text: payload.choices.map((choice) => choice.message?.content || choice.delta?.content || "").join("\n").trim(),
      finishReason: payload.choices.map((choice) => choice.finish_reason || "").filter(Boolean).join(",")
    };
  }
  if (apiMode === "sse") {
    const events = parseSse(String(payload));
    return { text: events.map((event) => event.output_text || event.text || event.choices?.[0]?.delta?.content || "").join("").trim(), finishReason: "" };
  }
  return { text: JSON.stringify(payload), finishReason: "" };
}

async function postJson(provider, model, prompt, stream) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(provider.timeoutMs) || 120000);
  const isChat = /chat/i.test(provider.apiMode);
  const endpoint = (() => {
    const base = String(provider.apiBase || "").replace(/\/+$/, "");
    if (provider.apiMode === "responses" && !/\/responses$/i.test(base)) return `${base}/responses`;
    if (isChat && !/\/chat\/completions$/i.test(base)) return `${base}/chat/completions`;
    return base;
  })();
  const body = isChat
    ? {
        model,
        messages: [
          { role: "system", content: "You are an adversarial reviewer. Return concise risks and recommendations." },
          { role: "user", content: prompt }
        ],
        max_tokens: Number(provider.maxTokens) || 4000,
        stream
      }
    : {
        model,
        input: prompt,
        max_output_tokens: Number(provider.maxTokens) || 4000,
        stream
      };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    if (!response.ok) {
      const error = new Error(`provider HTTP ${response.status}`);
      error.kind = "provider-error";
      error.httpStatus = response.status;
      error.raw = rawText.slice(0, 2000);
      throw error;
    }
    const payload = stream ? rawText : (() => {
      try { return JSON.parse(rawText); } catch (_err) { return rawText; }
    })();
    return { ...extractText(stream ? "sse" : provider.apiMode, payload), raw: payload };
  } catch (err) {
    const error = new Error(err.name === "AbortError" ? "provider timeout" : err.message);
    error.kind = err.name === "AbortError" ? "timeout" : (err.kind || "provider-error");
    error.httpStatus = err.httpStatus || 0;
    error.raw = err.raw || "";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function retryConfig(config) {
  const retry = config?.retry || {};
  return {
    maxAttempts: Math.max(1, Number(retry.maxAttempts || 2)),
    baseDelayMs: Math.max(0, Number(retry.baseDelayMs || 1000)),
    maxDelayMs: Math.max(0, Number(retry.maxDelayMs || 8000)),
    retryableStatusCodes: new Set(retry.retryableStatusCodes || [429, 502, 503, 504])
  };
}

function isRetryable(err, retry) {
  return err.kind === "timeout"
    || err.kind === "connection"
    || retry.retryableStatusCodes.has(Number(err.httpStatus || 0));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50)));
}

async function runModelOnce(provider, model, prompt, noStream, attempts, meta) {
  if (provider.apiMode === "fake" || /^fake:\/\//.test(provider.apiBase)) return fakeReview(model, prompt);
  if (!provider.apiBase || !provider.apiKey) {
    const error = new Error("missing provider apiBase or apiKey");
    error.kind = "missing-config";
    throw error;
  }
  const wantsStream = provider.stream && !noStream;
  if (!wantsStream) return postJson(provider, model, prompt, false);
  try {
    return await postJson(provider, model, prompt, true);
  } catch (err) {
    if (/stream|unsupported|400|422|provider/i.test(err.message)) {
      attempts.push({ ...meta, reason: "stream_fallback", delayMs: 0, timeoutMs: provider.timeoutMs, result: "fallbackAttempt" });
      return postJson(provider, model, prompt, false);
    }
    throw err;
  }
}

async function runModelWithRetry({ item, prompt, noStream, retry, attempts, round }) {
  let lastError = null;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    const meta = { attempt, round, model: item.key };
    try {
      const result = await runModelOnce(item.provider, item.model, prompt, noStream, attempts, meta);
      attempts.push({ ...meta, reason: attempt === 1 ? "initial" : "retry", delayMs: 0, timeoutMs: item.provider.timeoutMs, result: "success" });
      return result;
    } catch (err) {
      lastError = err;
      const canRetry = attempt < retry.maxAttempts && isRetryable(err, retry);
      const delayMs = canRetry ? Math.min(retry.baseDelayMs * (2 ** (attempt - 1)), retry.maxDelayMs) : 0;
      attempts.push({
        ...meta,
        reason: err.kind || "provider-error",
        delayMs,
        timeoutMs: item.provider.timeoutMs,
        result: canRetry ? "retryAttempt" : "failed",
        httpStatus: err.httpStatus || undefined
      });
      if (!canRetry) break;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function summarize(texts) {
  const joined = texts.join("\n").trim();
  return joined.split(/\n/).find((line) => /summary|结论|总体/i.test(line)) || joined.slice(0, 240) || "No usable review content.";
}

function linesMatching(texts, pattern, fallback) {
  const values = texts.flatMap((text) => text.split(/\n/).filter((line) => pattern.test(line)).map((line) => line.replace(/^(risk|recommendation|建议|风险)\s*[:：-]\s*/i, "").trim()));
  return values.length ? values : fallback;
}

function upsertIssue(ledger, model, round, risk, recommendation) {
  const title = truncate(risk.replace(/\s+/g, " "), 96);
  let issue = ledger.find((item) => item.title === title);
  if (!issue) {
    issue = {
      id: `RR-${String(ledger.length + 1).padStart(3, "0")}`,
      title,
      category: "requirements",
      severity: /critical|严重|高风险/i.test(risk) ? "high" : "medium",
      evidence: risk,
      recommendation,
      sourceModelsByRound: {},
      status: "open",
      codexDecision: "none",
      codexDecisionReason: "",
      proposalChange: "",
      residualRisk: ""
    };
    ledger.push(issue);
  }
  issue.sourceModelsByRound[String(round)] = [...new Set([...(issue.sourceModelsByRound[String(round)] || []), model])];
  return issue;
}

function updateIssueLedger(ledger, roundResult) {
  roundResult.texts.forEach((text, index) => {
    const model = roundResult.modelsCompleted[index] || "unknown-model";
    const risks = linesMatching([text], /risk|风险/i, ["evidence may be incomplete."]);
    const recommendations = linesMatching([text], /recommendation|建议/i, ["keep acceptance status tied to artifacts."]);
    risks.forEach((risk, riskIndex) => {
      const issue = upsertIssue(ledger, model, roundResult.round, risk, recommendations[riskIndex] || recommendations[0] || "");
      if (roundResult.round === 2 && issue.status === "open") issue.status = "challenged";
      if (roundResult.round === 3 && ["open", "challenged", "residual"].includes(issue.status)) {
        issue.status = issue.codexDecision === "accept" ? "accepted"
          : issue.codexDecision === "reject" ? "rejected"
            : issue.codexDecision === "defer" ? "deferred"
              : "residual";
      }
    });
  });
}

function provisionalDecision(issue) {
  if (issue.severity === "high" && issue.evidence) {
    return { decision: "partial", reason: "High-impact finding has evidence but still needs implementation or acceptance proof.", confidence: 0.7 };
  }
  if (!issue.evidence || /incomplete|missing|不足|缺少/i.test(issue.evidence)) {
    return { decision: "defer", reason: "Evidence is incomplete, so the issue cannot be accepted as resolved.", confidence: 0.6 };
  }
  return { decision: "partial", reason: "Reviewer concern is plausible and should remain tied to acceptance evidence.", confidence: 0.7 };
}

function applyProvisionalDecisions(ledger) {
  for (const issue of ledger) {
    const decision = provisionalDecision(issue);
    issue.codexDecision = decision.decision;
    issue.codexDecisionReason = decision.reason;
    issue.confidence = decision.confidence;
    issue.residualRisk = decision.decision === "partial" || decision.decision === "defer" ? issue.evidence : "";
  }
}

function statusCounts(ledger) {
  return ledger.reduce((counts, issue) => {
    counts[issue.status] = (counts[issue.status] || 0) + 1;
    return counts;
  }, {});
}

function convergenceStatus(ledger, rounds) {
  if (rounds < 3) return "not_requested";
  return ledger.some((issue) => ["open", "challenged", "deferred"].includes(issue.status))
    ? "unresolved"
    : ledger.some((issue) => issue.status === "residual")
      ? "converged_with_residuals"
      : "converged";
}

function challengeBriefFor(ledger) {
  if (!ledger.length) return "No explicit issue was found. Ask reviewers to challenge evidence completeness and acceptance readiness.";
  return ledger.map((issue) => [
    `${issue.id}: ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Evidence: ${issue.evidence}`,
    "Question: keep, revise, withdraw, add evidence, or mark residual risk?"
  ].join("\n")).join("\n\n");
}

function convergenceBriefFor(ledger) {
  const unresolved = ledger.filter((issue) => ["open", "challenged", "residual", "deferred"].includes(issue.status) || issue.codexDecision !== "accept");
  return (unresolved.length ? unresolved : ledger).map((issue) => [
    `${issue.id}: ${issue.title}`,
    `Codex provisional decision: ${issue.codexDecision}`,
    `Reason: ${issue.codexDecisionReason}`,
    `Residual risk: ${issue.residualRisk || "none recorded"}`,
    "Check whether the decision misreads evidence, misses high risk, or needs stronger acceptance evidence."
  ].join("\n")).join("\n\n") || "No unresolved issue remains; check for overconfident acceptance wording.";
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: SCHEMA_VERSION, workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
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

function writeRelative(workspace, relative, content) {
  const file = path.join(workspace, relative);
  writeText(file, content);
  return relative;
}

async function runRound({ workspace, id, round, rounds, requested, subject, domain, noStream, retry, attempts, challengeBrief, convergenceBrief, round1ByModel, issueLedger }) {
  const completed = [];
  const failed = [];
  const failedReasons = [];
  const warnings = [];
  const raw = [];
  const texts = [];
  const promptRecords = [];

  const outcomes = await Promise.all(requested.map(async (item) => {
    const prompt = promptFor({
      subject,
      domain,
      round,
      rounds,
      challengeBrief,
      convergenceBrief,
      ownRound1: round1ByModel.get(item.key) || "",
      issueLedger
    });
    promptRecords.push({ model: item.key, prompt });
    try {
      return {
        item,
        result: await runModelWithRetry({ item, prompt, noStream, retry, attempts, round })
      };
    } catch (err) {
      return { item, err };
    }
  }));

  for (const { item, result, err } of outcomes) {
    if (result) {
      completed.push(item.key);
      texts.push(result.text || "");
      raw.push({ round, model: item.key, result: result.raw });
      if (/length|trunc|incomplete/i.test(result.finishReason || "")) warnings.push(`round ${round} ${item.key}: likely truncation (${result.finishReason})`);
    } else {
      failed.push(item.key);
      failedReasons.push(`round ${round} ${item.key}: ${err.kind || "provider-error"}: ${err.message}`);
      if ((err.kind || "") === "timeout") warnings.push(`round ${round} ${item.key}: timeout`);
      if (err.raw) raw.push({ round, model: item.key, error: err.raw });
    }
  }

  const inputText = promptRecords.map((record) => `--- ${record.model} ---\n${record.prompt}`).join("\n\n");
  const inputRef = writeRelative(workspace, path.join(REVIEW_DIR, "inputs", `${id}-round-${round}.txt`), inputText);
  const coverage = requested.length === 0
    ? "none"
    : completed.length === requested.length && failed.length === 0 && warnings.length === 0
      ? "full"
      : completed.length > 0
        ? "partial"
        : "none";

  return {
    round,
    purpose: roundPurpose(round),
    coverage,
    modelsRequested: requested.map((item) => item.key),
    modelsCompleted: completed,
    modelsFailed: failed,
    failedModelReasons: failedReasons,
    truncationWarnings: warnings,
    inputRef,
    inputHash: sha(inputText),
    texts,
    raw
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Usage: run-review.js [--workspace <dir>] [--config <file>] [--domain <name>] [--subject <text> | --file <file>] [--model <id>] [--rounds 1..3] [--discussion-file <file>] [--timeout-ms <ms>] [--no-stream]",
      "",
      "Reads ~/.codex/skill-config/ravo-review.json by default.",
      "Writes knowledge/.ravo/review/*.json and updates the RAVO manifest.",
      "Never prints API keys or provider secrets."
    ].join("\n"));
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const domain = argValue("--domain", "general");
  const detailLevel = technicalDetailLevel(workspace);
  const subject = subjectText().trim();
  const started = Date.now();
  const config = readJson(configPath());
  const rounds = clampRoundCount(argValue("--rounds", config?.rounds ?? 2));
  const discussionFile = argValue("--discussion-file", "");
  if (discussionFile && rounds < 2) throw new Error("--discussion-file requires --rounds 2 or 3");
  const retry = retryConfig(config);
  const providers = normalizeProviders(config);
  const modelOverrides = new Set(argValues("--model"));
  const requested = providers
    .flatMap((provider) => provider.models.map((model) => ({ provider, model, key: modelKey(provider, model) })))
    .filter((item) => modelOverrides.size === 0 || modelOverrides.has(item.model) || modelOverrides.has(item.key));
  const completed = [];
  const failed = [];
  const failedReasons = [];
  const warnings = [];
  const raw = [];
  const texts = [];
  const attempts = [];
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(domain)}`;

  if (!requested.length) {
    warnings.push("review provider config unavailable or no enabled models");
  }

  const roundResults = [];
  const issueLedger = [];
  const round1ByModel = new Map();
  let activeRequested = requested;
  let roundStopReason = "";
  let challengeBrief = "";
  let challengeBriefRef = "";
  let convergenceBrief = "";
  let convergenceBriefRef = "";

  for (let round = 1; round <= rounds; round += 1) {
    if (round === 2) {
      challengeBrief = discussionFile ? fs.readFileSync(path.resolve(discussionFile), "utf8") : challengeBriefFor(issueLedger);
      challengeBriefRef = writeRelative(workspace, path.join(REVIEW_DIR, "briefs", `${id}-challenge.md`), challengeBrief);
      activeRequested = requested.filter((item) => round1ByModel.has(item.key));
    }
    if (round === 3) {
      applyProvisionalDecisions(issueLedger);
      convergenceBrief = convergenceBriefFor(issueLedger);
      convergenceBriefRef = writeRelative(workspace, path.join(REVIEW_DIR, "briefs", `${id}-convergence.md`), convergenceBrief);
      activeRequested = requested.filter((item) => round1ByModel.has(item.key));
    }
    if (round > 1 && !activeRequested.length) {
      roundStopReason = `round${round}_no_completed_models`;
      warnings.push(`round ${round}: skipped because no prior round model completed`);
      break;
    }
    const roundResult = await runRound({
      workspace,
      id,
      round,
      rounds,
      requested: activeRequested,
      subject,
      domain,
      noStream: process.argv.includes("--no-stream"),
      retry,
      attempts,
      challengeBrief,
      convergenceBrief,
      round1ByModel,
      issueLedger
    });
    roundResults.push(roundResult);
    updateIssueLedger(issueLedger, roundResult);
    if (round === 1) {
      roundResult.modelsCompleted.forEach((model, index) => {
        round1ByModel.set(model, roundResult.texts[index] || "");
      });
    }
  }

  for (const roundResult of roundResults) {
    for (const model of roundResult.modelsCompleted) if (!completed.includes(model)) completed.push(model);
    for (const model of roundResult.modelsFailed) if (!failed.includes(model)) failed.push(model);
    failedReasons.push(...roundResult.failedModelReasons);
    warnings.push(...roundResult.truncationWarnings);
    raw.push(...roundResult.raw);
    texts.push(...roundResult.texts);
  }
  if (rounds >= 2 && roundResults.length < rounds && !roundStopReason) roundStopReason = "requested_rounds_not_completed";
  const coverage = requested.length === 0
    ? "none"
    : roundResults.length === rounds && roundResults.every((roundResult) => roundResult.coverage === "full") && failed.length === 0 && warnings.length === 0
      ? "full"
      : completed.length > 0
        ? "partial"
        : "none";

  const issueLedgerRef = path.join(REVIEW_DIR, "issues", `${id}.json`);
  writeJson(path.join(workspace, issueLedgerRef), issueLedger);
  const rawResultRef = raw.length ? path.join(REVIEW_DIR, "raw", `${id}.json`) : "";
  if (rawResultRef) writeJson(path.join(workspace, rawResultRef), raw);
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    domain,
    technicalDetailLevel: detailLevel,
    summaryMode: detailLevel <= 2 ? "product" : detailLevel >= 4 ? "engineering" : "balanced",
    roundsRequested: rounds,
    roundsExecuted: roundResults.length,
    roundStopReason,
    roundPolicy: "fixed",
    orchestrationVersion: "multi-round-v1",
    coverage,
    executionState: requested.length === 0 ? "unavailable" : (failed.length ? "failure" : coverage),
    modelsRequested: requested.map((item) => item.key),
    modelsCompleted: completed,
    modelsFailed: failed,
    failedModelReasons: failedReasons,
    timing: { totalMs: Date.now() - started },
    truncationWarnings: warnings,
    roundCoverage: roundResults.map((roundResult) => ({
      round: roundResult.round,
      purpose: roundResult.purpose,
      coverage: roundResult.coverage,
      modelsRequested: roundResult.modelsRequested,
      modelsCompleted: roundResult.modelsCompleted,
      modelsFailed: roundResult.modelsFailed,
      failedModelReasons: roundResult.failedModelReasons,
      truncationWarnings: roundResult.truncationWarnings,
      inputRef: roundResult.inputRef,
      inputHash: roundResult.inputHash
    })),
    second_round_coverage: roundResults[1]?.coverage || null,
    briefs: { challengeBriefRef, convergenceBriefRef },
    issueLedgerRef,
    issueStatusCounts: statusCounts(issueLedger),
    convergenceStatus: convergenceStatus(issueLedger, rounds),
    attempts,
    summary: completed.length ? summarize(texts) : "RAVO Review unavailable: no configured provider/model completed.",
    risks: completed.length ? linesMatching(texts, /risk|风险/i, ["Review completed without explicit risk lines."]) : ["No external review findings are available."],
    recommendations: completed.length ? linesMatching(texts, /recommendation|建议/i, ["Review completed without explicit recommendation lines."]) : ["Configure RAVO Review providers before relying on external review coverage."],
    rawResultRef,
    createdAt: now
  };
  const artifactPath = path.join(workspace, REVIEW_DIR, `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({
    status: "ok",
    artifactPath,
    manifestPath,
    coverage,
    modelsRequested: artifact.modelsRequested,
    modelsCompleted: completed,
    modelsFailed: failed,
    failedModelReasons: failedReasons,
    truncationWarnings: warnings,
    roundsRequested: rounds,
    roundsExecuted: artifact.roundsExecuted,
    roundStopReason,
    roundCoverage: artifact.roundCoverage,
    second_round_coverage: artifact.second_round_coverage,
    issueLedgerRef,
    convergenceStatus: artifact.convergenceStatus,
    attempts
  }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`RAVO Review runner failed: ${err.message}\n`);
  process.exit(1);
});
