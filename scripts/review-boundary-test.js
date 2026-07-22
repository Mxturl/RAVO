#!/usr/bin/env node

const assert = require("node:assert");
const path = require("node:path");
const { evaluateDataBoundary } = require("../plugins/ravo/modules/ravo-review/scripts/review-boundary");

const safe = evaluateDataBoundary("Review a generic acceptance-state contract.", {
  decision: "safe_sanitized",
  authorizationSource: "policy_safe_sanitized"
});
assert.equal(safe.decision, "safe_sanitized");
assert.equal(safe.externalCallAllowed, true);
assert.match(safe.subjectHash, /^sha256:/);

const privateSpec = path.join(path.sep, "Users", "example", "private", "spec.md");
const sensitive = evaluateDataBoundary(`Review ${privateSpec} and notify pm@example.com.`, {
  decision: "safe_sanitized",
  authorizationSource: "explicit_user_action"
});
assert.equal(sensitive.decision, "sensitive_requires_consent", "detector cannot be downgraded by a safe caller label");
assert.equal(sensitive.externalCallAllowed, false);
assert.doesNotMatch(sensitive.sanitizedSubject, /pm@example\.com|\/Users\/example/);

const consented = evaluateDataBoundary(`Review ${privateSpec}.`, {
  decision: "sensitive_requires_consent",
  authorizationSource: "conversation_confirmation",
  consentConfirmed: true
});
assert.equal(consented.externalCallAllowed, true);

const prohibited = evaluateDataBoundary("Authorization: Bearer sk-secret-canary-value and CANARY_CUSTOMER_42", {
  decision: "safe_sanitized",
  authorizationSource: "explicit_user_action",
  consentConfirmed: true
});
assert.equal(prohibited.decision, "prohibited");
assert.equal(prohibited.externalCallAllowed, false);
assert.doesNotMatch(prohibited.sanitizedSubject, /sk-secret-canary-value|CANARY_CUSTOMER_42/);

console.log(JSON.stringify({ status: "pass", checks: ["safe", "sensitive", "consented", "prohibited"] }, null, 2));
