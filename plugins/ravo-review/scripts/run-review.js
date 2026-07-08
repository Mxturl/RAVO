#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.1";

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
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

function promptFor(subject, domain) {
  return [
    "Run an adversarial RAVO Review.",
    `Domain: ${domain}`,
    "Return concise findings with risks and recommendations.",
    "Do not assume evidence that is not present.",
    "",
    subject
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

async function postJson(provider, model, subject, stream) {
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
          { role: "user", content: promptFor(subject, argValue("--domain", "general")) }
        ],
        max_tokens: Number(provider.maxTokens) || 4000,
        stream
      }
    : {
        model,
        input: promptFor(subject, argValue("--domain", "general")),
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
    error.raw = err.raw || "";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runModel(provider, model, subject, noStream) {
  if (provider.apiMode === "fake" || /^fake:\/\//.test(provider.apiBase)) return fakeReview(model, subject);
  if (!provider.apiBase || !provider.apiKey) {
    const error = new Error("missing provider apiBase or apiKey");
    error.kind = "missing-config";
    throw error;
  }
  const wantsStream = provider.stream && !noStream;
  try {
    return await postJson(provider, model, subject, wantsStream);
  } catch (err) {
    if (wantsStream && /stream|unsupported|400|422|provider/.test(err.message)) {
      return postJson(provider, model, subject, false);
    }
    throw err;
  }
}

function summarize(texts) {
  const joined = texts.join("\n").trim();
  return joined.split(/\n/).find((line) => /summary|结论|总体/i.test(line)) || joined.slice(0, 240) || "No usable review content.";
}

function linesMatching(texts, pattern, fallback) {
  const values = texts.flatMap((text) => text.split(/\n/).filter((line) => pattern.test(line)).map((line) => line.replace(/^(risk|recommendation|建议|风险)\s*[:：-]\s*/i, "").trim()));
  return values.length ? values : fallback;
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
    artifacts: ["knowledge/.ravo/review"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Usage: run-review.js [--workspace <dir>] [--config <file>] [--domain <name>] [--subject <text> | --file <file>] [--model <id>] [--timeout-ms <ms>] [--no-stream]",
      "",
      "Reads ~/.codex/skill-config/ravo-review.json by default.",
      "Writes knowledge/.ravo/review/*.json and updates the RAVO manifest.",
      "Never prints API keys or provider secrets."
    ].join("\n"));
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const domain = argValue("--domain", "general");
  const subject = subjectText().trim();
  const started = Date.now();
  const config = readJson(configPath());
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

  if (!requested.length) {
    warnings.push("review provider config unavailable or no enabled models");
  }

  for (const item of requested) {
    try {
      const result = await runModel(item.provider, item.model, subject, process.argv.includes("--no-stream"));
      completed.push(item.key);
      texts.push(result.text || "");
      raw.push({ model: item.key, result: result.raw });
      if (/length|trunc|incomplete/i.test(result.finishReason || "")) warnings.push(`${item.key}: likely truncation (${result.finishReason})`);
    } catch (err) {
      failed.push(item.key);
      failedReasons.push(`${item.key}: ${err.kind || "provider-error"}: ${err.message}`);
      if ((err.kind || "") === "timeout") warnings.push(`${item.key}: timeout`);
      if (err.raw) raw.push({ model: item.key, error: err.raw });
    }
  }

  const coverage = requested.length === 0
    ? "none"
    : completed.length === requested.length && failed.length === 0 && warnings.length === 0
      ? "full"
      : completed.length > 0
        ? "partial"
        : "none";
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(domain)}`;
  const rawResultRef = raw.length ? path.join("knowledge", ".ravo", "review", "raw", `${id}.json`) : "";
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    domain,
    coverage,
    executionState: requested.length === 0 ? "unavailable" : (failed.length ? "failure" : coverage),
    modelsRequested: requested.map((item) => item.key),
    modelsCompleted: completed,
    modelsFailed: failed,
    failedModelReasons: failedReasons,
    timing: { totalMs: Date.now() - started },
    truncationWarnings: warnings,
    summary: completed.length ? summarize(texts) : "RAVO Review unavailable: no configured provider/model completed.",
    risks: completed.length ? linesMatching(texts, /risk|风险/i, ["Review completed without explicit risk lines."]) : ["No external review findings are available."],
    recommendations: completed.length ? linesMatching(texts, /recommendation|建议/i, ["Review completed without explicit recommendation lines."]) : ["Configure RAVO Review providers before relying on external review coverage."],
    rawResultRef,
    createdAt: now
  };
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "review", `${id}.json`);
  if (rawResultRef) writeJson(path.join(workspace, rawResultRef), raw);
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
    truncationWarnings: warnings
  }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`RAVO Review runner failed: ${err.message}\n`);
  process.exit(1);
});
