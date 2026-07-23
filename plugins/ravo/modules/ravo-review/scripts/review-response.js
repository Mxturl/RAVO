const crypto = require("node:crypto");

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VERIFICATION_KINDS = new Set(["command", "script", "file_inspection", "official_document", "procedure"]);
const VERIFICATION_SAFETY = new Set(["read_only", "mutation_requires_authorization"]);
const TRUNCATION_REASONS = /(?:^|[_-])(length|max(?:imum)?[_-]?(?:output[_-]?)?tokens?|incomplete|trunc(?:ated|ation)?)(?:$|[_-])/i;

function addError(errors, error) {
  if (!errors.includes(error)) errors.push(error);
}

function parseSseEvents(input) {
  const events = [];
  let current = { event: "", data: [] };

  function flush() {
    if (!current.data.length) {
      current = { event: "", data: [] };
      return;
    }
    const data = current.data.join("\n");
    if (data !== "[DONE]") {
      let value = data;
      try { value = JSON.parse(data); } catch (_error) { /* Preserve malformed provider data. */ }
      events.push({ event: current.event, data: value });
    }
    current = { event: "", data: [] };
  }

  for (const line of String(input || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!line) {
      flush();
    } else if (line.startsWith("event:")) {
      current.event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      current.data.push(line.slice(5).trimStart());
    }
  }
  flush();
  return events;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || /reasoning|summary/i.test(String(part.type || ""))) return "";
    if (!["", "text", "output_text"].includes(String(part.type || ""))) return "";
    return typeof part.text === "string" ? part.text : typeof part.output_text === "string" ? part.output_text : "";
  }).filter(Boolean).join("");
}

function responseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (Array.isArray(payload.output_text)) return payload.output_text.filter((value) => typeof value === "string").join("");
  if (!Array.isArray(payload.output)) return "";
  return payload.output.map((item) => {
    if (!item || /reasoning/i.test(String(item.type || ""))) return "";
    if (item.type === "message" || item.role === "assistant" || !item.type) return contentText(item.content);
    if (item.type === "output_text") return typeof item.text === "string" ? item.text : "";
    return "";
  }).filter(Boolean).join("\n");
}

function chatText(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return contentText(choice?.message?.content ?? choice?.delta?.content);
}

function truncationReason(payload) {
  if (!payload || typeof payload !== "object") return "";
  const reasons = [
    payload.incomplete_details?.reason,
    payload.finish_reason,
    ...(Array.isArray(payload.choices) ? payload.choices.map((choice) => choice?.finish_reason) : []),
    ...(Array.isArray(payload.output) ? payload.output.map((item) => item?.status === "incomplete" ? "incomplete" : "") : []),
    payload.status === "incomplete" ? "incomplete" : ""
  ].filter(Boolean).map(String);
  return reasons.find((reason) => TRUNCATION_REASONS.test(reason)) || "";
}

function numericUsage(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const result = {};
  for (const [rawKey, child] of Object.entries(value).slice(0, 50)) {
    const key = String(rawKey).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
    if (!key) continue;
    if (typeof child === "number" && Number.isFinite(child) && child >= 0) {
      result[key] = child;
      continue;
    }
    const nested = numericUsage(child, depth + 1);
    if (Object.keys(nested).length) result[key] = nested;
  }
  return result;
}

function providerBehavior(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: "", finishReason: "", incompleteReason: "", usage: {} };
  }
  const finishReason = [
    payload.finish_reason,
    ...(Array.isArray(payload.choices) ? payload.choices.map((choice) => choice?.finish_reason) : [])
  ].find(Boolean);
  const detectedTruncation = truncationReason(payload);
  const incompleteReason = payload.incomplete_details?.reason
    || detectedTruncation
    || (payload.status === "incomplete" ? "incomplete" : "");
  const status = payload.status
    || (finishReason ? TRUNCATION_REASONS.test(String(finishReason)) ? "incomplete" : "completed" : "");
  return {
    status: String(status || "").slice(0, 120),
    finishReason: String(finishReason || "").slice(0, 200),
    incompleteReason: String(incompleteReason || "").slice(0, 200),
    usage: numericUsage(payload.usage)
  };
}

function mergeProviderBehavior(current, next) {
  return {
    status: next.status || current.status,
    finishReason: next.finishReason || current.finishReason,
    incompleteReason: next.incompleteReason || current.incompleteReason,
    usage: Object.keys(next.usage || {}).length ? next.usage : current.usage
  };
}

function extractFromSse(input) {
  const events = parseSseEvents(input);
  const errors = [];
  const responseDeltas = [];
  const chatDeltas = new Map();
  let responseDoneText = "";
  let terminalText = "";
  let truncated = "";
  let behavior = { status: "", finishReason: "", incompleteReason: "", usage: {} };

  for (const entry of events) {
    const event = entry.data;
    if (!event || typeof event !== "object") {
      addError(errors, "response.sse_event_invalid");
      continue;
    }
    const type = String(event.type || entry.event || "");
    if (type === "response.output_text.delta" && typeof event.delta === "string") responseDeltas.push(event.delta);
    if (type === "response.output_text.done" && typeof event.text === "string") responseDoneText = event.text;
    if (type === "response.completed" || type === "response.incomplete") {
      const response = event.response || event;
      terminalText = responseText(response) || terminalText;
      truncated = truncationReason(response) || (type === "response.incomplete" ? "incomplete" : truncated);
      behavior = mergeProviderBehavior(behavior, providerBehavior(response));
    }
    if (Array.isArray(event.choices)) {
      for (const choice of event.choices) {
        const index = Number.isInteger(choice?.index) ? choice.index : 0;
        const delta = contentText(choice?.delta?.content);
        if (delta) chatDeltas.set(index, `${chatDeltas.get(index) || ""}${delta}`);
      }
      truncated = truncationReason(event) || truncated;
      behavior = mergeProviderBehavior(behavior, providerBehavior(event));
    }
    truncated = truncationReason(event) || truncated;
    behavior = mergeProviderBehavior(behavior, providerBehavior(event));
  }

  const firstChat = [...chatDeltas.entries()].sort(([a], [b]) => a - b)[0]?.[1] || "";
  return {
    finalText: (terminalText || responseDoneText || responseDeltas.join("") || firstChat).trim(),
    incomplete: Boolean(truncated),
    truncationReason: truncated,
    format: "sse",
    parserErrors: errors,
    providerBehavior: behavior
  };
}

function looksLikeSse(input) {
  return /^(?:event|data):/m.test(String(input || ""));
}

function extractFinalText(input) {
  if (Buffer.isBuffer(input)) input = input.toString("utf8");
  if (typeof input === "string" && looksLikeSse(input)) return extractFromSse(input);

  let payload = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    try { payload = JSON.parse(trimmed); } catch (_error) {
      return {
        finalText: trimmed,
        incomplete: false,
        truncationReason: "",
        format: "text",
        parserErrors: [],
        providerBehavior: { status: "", finishReason: "", incompleteReason: "", usage: {} }
      };
    }
  }

  if (payload && typeof payload === "object" && typeof payload.summary === "string" && Array.isArray(payload.findings)) {
    return {
      finalText: JSON.stringify(payload),
      incomplete: false,
      truncationReason: "",
      format: "reviewer_json",
      parserErrors: [],
      providerBehavior: { status: "", finishReason: "", incompleteReason: "", usage: {} }
    };
  }

  const responseBody = responseText(payload);
  const chatBody = chatText(payload);
  return {
    finalText: (responseBody || chatBody).trim(),
    incomplete: Boolean(truncationReason(payload)),
    truncationReason: truncationReason(payload),
    format: responseBody ? "responses_json" : chatBody ? "chat_completions_json" : "json",
    parserErrors: [],
    providerBehavior: providerBehavior(payload)
  };
}

function jsonCandidates(text) {
  const candidates = [String(text || "").trim()];
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  for (let match = fence.exec(String(text || "")); match; match = fence.exec(String(text || ""))) {
    candidates.push(match[1].trim());
  }
  return [...new Set(candidates.filter(Boolean))];
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVerification(value) {
  const errors = [];
  if (value === undefined) return { present: false, valid: false, verification: null, errors: ["missing"] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { present: true, valid: false, verification: null, errors: ["object_required"] };
  const verification = {
    kind: textValue(value.kind),
    steps: Array.isArray(value.steps) ? value.steps.map(textValue).filter(Boolean) : [],
    command: textValue(value.command),
    expected: textValue(value.expected),
    environment: textValue(value.environment),
    safety: textValue(value.safety),
    commandNotApplicableReason: textValue(value.commandNotApplicableReason)
  };
  if (!VERIFICATION_KINDS.has(verification.kind)) errors.push("kind_invalid");
  if (!verification.steps.length) errors.push("steps_required");
  if (!verification.expected) errors.push("expected_required");
  if (!verification.environment) errors.push("environment_required");
  if (!VERIFICATION_SAFETY.has(verification.safety)) errors.push("safety_invalid");
  if (["command", "script"].includes(verification.kind) && !verification.command) errors.push("command_required");
  if (!["command", "script"].includes(verification.kind) && !verification.commandNotApplicableReason) errors.push("command_not_applicable_reason_required");
  return { present: true, valid: errors.length === 0, verification, errors };
}

function defaultDisposition() {
  return {
    status: "pending",
    verificationMethod: "none",
    evidenceRefs: [],
    observed: "",
    reason: "",
    environment: "",
    decidedAt: ""
  };
}

function validateReviewerPayload(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, rawFindingCount: 0, parserErrors: ["review.schema_object_required"], reviewer: null };
  }
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary) addError(errors, "review.summary_required");
  if (!Array.isArray(value.findings)) addError(errors, "review.findings_array_required");
  else if (value.findings.length === 0) addError(errors, "review.findings_empty");

  const findings = Array.isArray(value.findings) ? value.findings.map((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      addError(errors, `review.findings[${index}].object_required`);
      return null;
    }
    const normalized = {};
    for (const field of ["title", "evidence", "mechanismRisk", "recommendation"]) {
      normalized[field] = typeof finding[field] === "string" ? finding[field].trim() : "";
      if (!normalized[field]) addError(errors, `review.findings[${index}].${field}_required`);
    }
    normalized.severity = typeof finding.severity === "string" ? finding.severity.trim().toLowerCase() : "";
    if (!SEVERITIES.has(normalized.severity)) addError(errors, `review.findings[${index}].severity_invalid`);
    const verification = normalizeVerification(finding.verification);
    const requiresVerification = ["critical", "high"].includes(normalized.severity);
    if (requiresVerification && !verification.valid) {
      normalized.verificationStatus = "missing";
      normalized.decisionEligibility = "advisory_only";
      normalized.verificationErrors = verification.errors;
    } else if (!requiresVerification && verification.present && !verification.valid) {
      for (const error of verification.errors) addError(errors, `review.findings[${index}].verification.${error}`);
      normalized.verificationStatus = "invalid";
      normalized.decisionEligibility = "not_required";
    } else {
      normalized.verificationStatus = requiresVerification ? "ready" : verification.present ? "provided" : "not_required";
      normalized.decisionEligibility = requiresVerification ? "pending_local_verification" : "not_required";
    }
    if (verification.verification) normalized.verification = verification.verification;
    normalized.localDisposition = defaultDisposition();
    return normalized;
  }).filter(Boolean) : [];

  return {
    valid: errors.length === 0,
    rawFindingCount: Array.isArray(value.findings) ? value.findings.length : 0,
    parserErrors: errors,
    reviewer: errors.length ? null : { summary, findings }
  };
}

function parseReviewerJson(text) {
  const parseErrors = [];
  let rawFindingCount = 0;
  for (const candidate of jsonCandidates(text)) {
    let value;
    try { value = JSON.parse(candidate); } catch (_error) {
      addError(parseErrors, "review.invalid_json");
      continue;
    }
    const validated = validateReviewerPayload(value);
    if (validated.valid) return validated;
    for (const error of validated.parserErrors) addError(parseErrors, error);
    rawFindingCount = Math.max(rawFindingCount, validated.rawFindingCount);
  }
  return {
    valid: false,
    rawFindingCount,
    parserErrors: parseErrors.length ? parseErrors : ["review.invalid_json"],
    reviewer: null
  };
}

function findingKey(finding) {
  return JSON.stringify([
    finding.title,
    finding.severity,
    finding.evidence,
    finding.mechanismRisk,
    finding.recommendation
  ]);
}

function sourceFor(record) {
  return {
    providerModelKey: record.providerModelKey ?? null,
    round: record.round ?? null,
    rawResponseRef: record.rawResponseRef ?? null
  };
}

function sourceKey(source) {
  return JSON.stringify([source.providerModelKey, source.round, source.rawResponseRef]);
}

function buildIssueLedger(records) {
  const list = Array.isArray(records) ? records : [];
  const parserErrors = [];
  const issuesByKey = new Map();
  let rawFindingCount = 0;
  let validFindingCount = 0;
  let validRecordCount = 0;

  list.forEach((record, index) => {
    const reviewer = record?.reviewer || (record?.summary !== undefined ? record : null);
    const validated = validateReviewerPayload(reviewer);
    rawFindingCount += validated.rawFindingCount;
    if (!validated.valid) {
      for (const error of validated.parserErrors) addError(parserErrors, `records[${index}].${error}`);
      return;
    }
    validRecordCount += 1;
    validFindingCount += validated.reviewer.findings.length;
    const source = sourceFor(record);
    for (const finding of validated.reviewer.findings) {
      const key = findingKey(finding);
      let issue = issuesByKey.get(key);
      if (!issue) {
        issue = {
          id: `RR-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12).toUpperCase()}`,
          ...finding,
          ...source,
          decisionImpact: textValue(record?.decisionImpact),
          sources: []
        };
        issuesByKey.set(key, issue);
      }
      if (!issue.decisionImpact && textValue(record?.decisionImpact)) issue.decisionImpact = textValue(record.decisionImpact);
      if (!issue.sources.some((item) => sourceKey(item) === sourceKey(source))) issue.sources.push(source);
    }
  });

  const issues = [...issuesByKey.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const issue of issues) {
    issue.sources.sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
    Object.assign(issue, issue.sources[0]);
  }
  const ledgerFindingCount = issues.length;
  const parserStatus = list.length === 0 ? "not_run"
    : validRecordCount === 0 ? "error"
      : validRecordCount < list.length ? "partial"
        : "pass";
  return {
    issues,
    rawFindingCount,
    ledgerFindingCount,
    deduplicatedCount: validFindingCount - ledgerFindingCount,
    parserErrors,
    parserStatus
  };
}

function parseReviewResponse(input, context = {}) {
  const extracted = extractFinalText(input);
  const parserErrors = [...extracted.parserErrors];
  if (!extracted.finalText) addError(parserErrors, "response.empty_final_text");
  if (extracted.incomplete) addError(parserErrors, `response.truncated:${extracted.truncationReason || "incomplete"}`);

  const parsed = extracted.finalText ? parseReviewerJson(extracted.finalText) : { valid: false, rawFindingCount: 0, parserErrors: [], reviewer: null };
  for (const error of parsed.parserErrors) addError(parserErrors, error);
  const usable = Boolean(extracted.finalText && !extracted.incomplete && extracted.parserErrors.length === 0 && parsed.valid);
  const ledger = usable ? buildIssueLedger([{ ...context, reviewer: parsed.reviewer }]) : {
    issues: [],
    rawFindingCount: parsed.rawFindingCount || 0,
    ledgerFindingCount: 0,
    deduplicatedCount: 0,
    parserErrors: [],
    parserStatus: "error"
  };
  for (const error of ledger.parserErrors) addError(parserErrors, error);

  return {
    ...extracted,
    reviewer: parsed.reviewer,
    summary: parsed.reviewer?.summary || "",
    findings: parsed.reviewer?.findings || [],
    issueLedger: ledger.issues,
    rawFindingCount: ledger.rawFindingCount,
    ledgerFindingCount: ledger.ledgerFindingCount,
    deduplicatedCount: ledger.deduplicatedCount,
    parserErrors,
    parserStatus: usable ? ledger.parserStatus : "error",
    usable,
    semanticFailure: !usable
  };
}

module.exports = {
  buildIssueLedger,
  defaultDisposition,
  extractFinalText,
  normalizeVerification,
  parseReviewResponse,
  parseReviewerJson,
  parseSseEvents,
  validateReviewerPayload
};
