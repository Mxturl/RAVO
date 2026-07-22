"use strict";

const HIGH_SEVERITIES = new Set(["critical", "high"]);
const DISPOSITION_STATUSES = new Set(["pending", "confirmed", "rejected", "inconclusive", "out_of_scope"]);
const VERIFICATION_METHODS = new Set(["command", "script", "file_inspection", "official_document", "procedure", "none"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isHigh(issue) {
  return HIGH_SEVERITIES.has(String(issue?.severity || "").toLowerCase());
}

function dispositionFor(issue) {
  const value = issue?.localDisposition;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {
    status: "pending",
    verificationMethod: "none",
    evidenceRefs: [],
    observed: "",
    reason: "",
    environment: "",
    decidedAt: ""
  };
}

function evaluateIssue(issue, options = {}) {
  if (!isHigh(issue)) return { id: issue?.id || "", status: "not_applicable", blocking: false, reason: "not_high_or_critical" };
  const disposition = dispositionFor(issue);
  const evidenceRefs = Array.isArray(disposition.evidenceRefs) ? disposition.evidenceRefs.filter((value) => text(value)) : [];
  const impact = text(issue?.decisionImpact || options.decisionImpact);
  const highRiskDecision = Boolean(impact);
  const unresolved = (reason) => ({ id: issue?.id || "", status: "unresolved_high", blocking: highRiskDecision, reason, disposition });
  if (["confirmed", "rejected"].includes(disposition.status)) {
    if (!evidenceRefs.length) return unresolved("resolved_disposition_requires_evidence_ref");
    return { id: issue?.id || "", status: disposition.status, blocking: false, reason: "local_evidence_recorded", disposition };
  }
  if (disposition.status === "out_of_scope") {
    if (!text(disposition.reason)) return unresolved("out_of_scope_requires_reason");
    return { id: issue?.id || "", status: "out_of_scope", blocking: false, reason: "scope_reason_recorded", disposition };
  }
  if (disposition.status === "inconclusive" && text(disposition.pmRiskAcceptanceRef)) {
    return { id: issue?.id || "", status: "pm_risk_accepted", blocking: false, reason: "pm_risk_acceptance_recorded", disposition };
  }
  if (issue?.verificationStatus === "missing") return unresolved("verification_missing");
  return unresolved(disposition.status === "inconclusive" ? "inconclusive_high_finding" : "pending_local_verification");
}

function checkLedger(ledger, options = {}) {
  const issues = Array.isArray(ledger?.issues) ? ledger.issues : [];
  const results = issues.map((issue) => evaluateIssue(issue, { decisionImpact: ledger?.decisionImpact }));
  const unresolvedHigh = results.filter((result) => result.status === "unresolved_high");
  const requireAllHigh = options.requireAllHigh === true;
  return {
    status: unresolvedHigh.some((result) => result.blocking) || requireAllHigh && unresolvedHigh.length ? "not_ready" : "pass",
    issueResults: results,
    unresolvedHigh,
    decisionImpact: text(ledger?.decisionImpact),
    requireAllHigh
  };
}

module.exports = { DISPOSITION_STATUSES, HIGH_SEVERITIES, VERIFICATION_METHODS, checkLedger, dispositionFor, evaluateIssue, isHigh, text };
