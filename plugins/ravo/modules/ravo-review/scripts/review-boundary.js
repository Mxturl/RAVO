"use strict";

const crypto = require("node:crypto");

const DECISIONS = new Set(["safe_sanitized", "sensitive_requires_consent", "prohibited"]);
const AUTHORIZATION_SOURCES = new Set(["explicit_user_action", "conversation_confirmation", "policy_safe_sanitized", "none"]);

const PROHIBITED_PATTERNS = [
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi },
  { id: "authorization_header", pattern: /authorization\s*:\s*(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi },
  { id: "api_key_assignment", pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[a-z0-9_./+\-=]{8,}/gi },
  { id: "openai_style_secret", pattern: /\bsk-[a-z0-9_-]{12,}/gi },
  { id: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "canary", pattern: /\bCANARY_[A-Z0-9_-]{4,}\b/g }
];

const SENSITIVE_PATTERNS = [
  { id: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: "phone", pattern: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g },
  { id: "user_path", pattern: /\/(?:Users|home)\/[^\s/]+\/[A-Za-z0-9._~\/-]+/g },
  { id: "private_ipv4", pattern: /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/g },
  { id: "env_file", pattern: /(?:^|[\s/])\.env(?:\.[A-Za-z0-9_-]+)?(?:$|[\s:])/g }
];

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function collectMatches(text, patterns) {
  return patterns.flatMap(({ id, pattern }) => {
    const matches = String(text || "").match(new RegExp(pattern.source, pattern.flags)) || [];
    return matches.map((value) => ({ id, value }));
  });
}

function redactMatches(text, patterns, label) {
  let result = String(text || "");
  for (const { id, pattern } of patterns) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), `[REDACTED_${label}_${id.toUpperCase()}]`);
  }
  return result;
}

function summarizeMatches(matches, prefix) {
  const counts = matches.reduce((result, match) => {
    result[match.id] = (result[match.id] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([id, count]) => `${prefix}:${id}:${count}`);
}

function sanitizeText(value) {
  return redactMatches(redactMatches(String(value || ""), PROHIBITED_PATTERNS, "PROHIBITED"), SENSITIVE_PATTERNS, "SENSITIVE");
}

function evaluateDataBoundary(subject, options = {}) {
  const text = String(subject || "");
  const requestedDecision = options.decision || "";
  const authorizationSource = options.authorizationSource || "none";
  if (requestedDecision && !DECISIONS.has(requestedDecision)) throw new Error(`Unsupported data-boundary decision: ${requestedDecision}`);
  if (!AUTHORIZATION_SOURCES.has(authorizationSource)) throw new Error(`Unsupported authorization source: ${authorizationSource}`);

  const prohibitedMatches = collectMatches(text, PROHIBITED_PATTERNS);
  const sensitiveMatches = collectMatches(text, SENSITIVE_PATTERNS);
  let decision = requestedDecision || "safe_sanitized";
  if (prohibitedMatches.length || requestedDecision === "prohibited") decision = "prohibited";
  else if (sensitiveMatches.length || requestedDecision === "sensitive_requires_consent") decision = "sensitive_requires_consent";

  const redactionSummary = [
    ...summarizeMatches(prohibitedMatches, "prohibited"),
    ...summarizeMatches(sensitiveMatches, "sensitive")
  ];
  if (Array.isArray(options.redactionSummary)) {
    redactionSummary.push(...options.redactionSummary.map((item) => String(item || "").trim()).filter(Boolean));
  }
  const sanitizedSubject = sanitizeText(text);
  const consentConfirmed = options.consentConfirmed === true;
  const externalCallAllowed = decision === "safe_sanitized"
    ? ["policy_safe_sanitized", "explicit_user_action", "conversation_confirmation"].includes(authorizationSource)
    : decision === "sensitive_requires_consent"
      ? consentConfirmed && ["explicit_user_action", "conversation_confirmation"].includes(authorizationSource)
      : false;
  const reason = decision === "prohibited"
    ? "The subject contains a prohibited category or the caller explicitly prohibited external transmission."
    : decision === "sensitive_requires_consent" && !externalCallAllowed
      ? "The sanitized subject still requires explicit consent before an external call."
      : decision === "sensitive_requires_consent"
        ? "Explicit consent allows the sanitized subject for this bounded call."
        : externalCallAllowed
          ? "The subject is sanitized and the authorization source permits this bounded call."
          : "A safe subject still requires an allowed authorization source.";

  return {
    decision,
    subjectHash: sha(text),
    sanitizedSubject,
    redactionSummary: [...new Set(redactionSummary)],
    authorizationSource,
    consentConfirmed,
    externalCallAllowed,
    reason,
    blockingReason: externalCallAllowed ? "" : reason,
    temporaryFallback: externalCallAllowed ? "" : "Run an inline adversarial check without claiming external Review coverage.",
    recoveryEntry: decision === "prohibited"
      ? "Remove prohibited data and create a new sanitized Review subject."
      : decision === "sensitive_requires_consent"
        ? "Confirm the sanitized preview for this call or further reduce the subject."
        : "Record policy_safe_sanitized, explicit_user_action, or conversation_confirmation authorization."
  };
}

module.exports = {
  AUTHORIZATION_SOURCES,
  DECISIONS,
  evaluateDataBoundary,
  sanitizeText
};
