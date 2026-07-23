#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FORMAL_REASONS = new Set([
  "spec_required",
  "user_explicit_formal_review",
  "production_or_release_risk",
  "security_permission_or_credential_risk",
  "data_integrity_or_migration_risk",
  "high_impact_architecture_decision",
  "material_local_fact_conflict"
]);
const DIAGNOSTIC_REASONS = new Set(["user_explicit", "provider_recovery", "implementation_debug"]);
const SAFE_REFERENCE = /^[A-Za-z0-9._:/#@-]{1,500}$/;

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeReference(value, field) {
  const text = valueOf(value);
  if (!text) return { valid: false, error: `${field}_required` };
  if (!SAFE_REFERENCE.test(text)) return { valid: false, error: `${field}_invalid` };
  if (/(?:authorization|bearer\s|api[_-]?key|secret|password|sk-[a-z0-9])/i.test(text)) return { valid: false, error: `${field}_contains_sensitive_value` };
  return { valid: true, value: text };
}

function sourceFile(workspace, ref) {
  const source = String(ref || "").split("#")[0];
  if (!source.startsWith("docs/") && !source.startsWith("knowledge/")) return "";
  const root = path.resolve(workspace || process.cwd());
  const file = path.resolve(root, source);
  return file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) ? file : "";
}

function specRequiredAllowed(input, sourceRef) {
  const requirement = String(sourceRef || "").match(/#(R\d{3,}-\d{3,})\b/i)?.[1] || "";
  const file = sourceFile(input.workspace, sourceRef);
  if (!requirement || !file) return { allowed: false, reason: "spec_required_needs_current_spec_requirement_ref" };
  const text = fs.readFileSync(file, "utf8");
  if (!/^\s*(?:状态|Status)\s*[：:]\s*decision-complete\s*$/im.test(text)) return { allowed: false, reason: "spec_required_ref_not_decision_complete" };
  if (!text.includes(requirement)) return { allowed: false, reason: "spec_required_requirement_not_found" };
  return { allowed: true, reason: "spec_required" };
}

function highImpactDescription(value) {
  return /(?:认证|数据完整性|可用性|外部合同|多个模块|难以回滚|不可逆)/i.test(String(value || ""));
}

function evaluateReviewTrigger(input = {}) {
  const triggerReason = valueOf(input.triggerReason);
  const sourceRef = safeReference(input.triggerSourceRef, "trigger_source_ref");
  const subjectRef = safeReference(input.subjectRef, "subject_ref");
  const subjectVersion = safeReference(input.subjectVersion, "subject_version");
  const impact = valueOf(input.decisionImpact);
  const evidenceRefs = Array.isArray(input.triggerEvidenceRefs) ? input.triggerEvidenceRefs.map((value) => safeReference(value, "trigger_evidence_ref")).filter((entry) => entry.valid).map((entry) => entry.value) : [];
  const deny = (reason) => ({ decision: "deny", reason, triggerReason, sourceRef: sourceRef.value || "", subjectRef: subjectRef.value || "", subjectVersion: subjectVersion.value || "", triggerEvidenceRefs: evidenceRefs });
  if (input.governancePath !== "governed_change") return deny("governance_path_must_be_governed_change");
  if (!FORMAL_REASONS.has(triggerReason)) return deny("trigger_reason_not_allowlisted");
  if (!sourceRef.valid) return deny(sourceRef.error);
  if (!subjectRef.valid) return deny(subjectRef.error);
  if (!subjectVersion.valid) return deny(subjectVersion.error);
  if (!valueOf(input.subjectHash)) return deny("subject_hash_required");
  if (!impact) return deny("decision_impact_required");
  if (triggerReason === "spec_required") {
    const result = specRequiredAllowed(input, sourceRef.value);
    if (!result.allowed) return deny(result.reason);
  }
  if (triggerReason === "user_explicit_formal_review" && !/^conversation:[^#]+#[^#]+$/i.test(sourceRef.value)) return deny("user_explicit_requires_conversation_turn_ref");
  if (["production_or_release_risk", "security_permission_or_credential_risk", "data_integrity_or_migration_risk"].includes(triggerReason) && !evidenceRefs.length) return deny("risk_trigger_requires_evidence_ref");
  if (triggerReason === "high_impact_architecture_decision" && (!highImpactDescription(impact) || !evidenceRefs.length)) return deny("high_impact_architecture_requires_impact_and_evidence");
  if (triggerReason === "material_local_fact_conflict" && evidenceRefs.length < 2) return deny("material_conflict_requires_two_evidence_refs");
  return {
    decision: "allow",
    reason: `allowed_${triggerReason}`,
    triggerReason,
    sourceRef: sourceRef.value,
    subjectRef: subjectRef.value,
    subjectVersion: subjectVersion.value,
    subjectHash: String(input.subjectHash),
    decisionImpact: impact,
    triggerEvidenceRefs: evidenceRefs
  };
}

function evaluateDiagnostic(input = {}) {
  const reason = valueOf(input.diagnosticReason);
  const modelCount = Number(input.modelCount || 0);
  const rounds = Number(input.rounds || 0);
  const fallbackCount = Number(input.fallbackCount || 0);
  if (modelCount !== 1) return { decision: "deny", reason: "diagnostic_requires_exactly_one_model", diagnosticReason: reason };
  if (rounds !== 1) return { decision: "deny", reason: "diagnostic_requires_one_round", diagnosticReason: reason };
  if (fallbackCount !== 0) return { decision: "deny", reason: "diagnostic_disallows_fallback", diagnosticReason: reason };
  if (!DIAGNOSTIC_REASONS.has(reason)) return { decision: "deny", reason: "diagnostic_reason_not_allowlisted", diagnosticReason: reason };
  return { decision: "allow", reason: `allowed_${reason}`, diagnosticReason: reason };
}

module.exports = { DIAGNOSTIC_REASONS, FORMAL_REASONS, evaluateDiagnostic, evaluateReviewTrigger, safeReference };
