#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DISPOSITION_STATUSES, VERIFICATION_METHODS, dispositionFor, isHigh, text } = require("./review-disposition");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values.map(text).filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function safeRef(value, field) {
  const reference = text(value);
  if (!reference || reference.length > 500 || /[\r\n]/.test(reference) || /(?:authorization|bearer\s|api[_-]?key|secret|password|sk-[a-z0-9])/i.test(reference)) fail(`${field} is invalid.`);
  return reference;
}

function ledgerPath(workspace, reference) {
  const file = path.resolve(workspace, reference);
  if (!file.startsWith(`${workspace}${path.sep}`) || !fs.existsSync(file)) fail("--issue-ledger-ref must reference a readable workspace file.");
  return file;
}

function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: record-review-disposition.js --workspace <path> --issue-ledger-ref <path> --issue-id <id> --status <status> --verification-method <method> --evidence-ref <ref>");
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const file = ledgerPath(workspace, argValue("--issue-ledger-ref", ""));
  const ledger = JSON.parse(fs.readFileSync(file, "utf8"));
  const issueId = text(argValue("--issue-id", ""));
  const issue = Array.isArray(ledger.issues) ? ledger.issues.find((item) => item?.id === issueId) : null;
  if (!issue) fail("Review issue was not found.");
  const status = text(argValue("--status", ""));
  const verificationMethod = text(argValue("--verification-method", "none"));
  if (!DISPOSITION_STATUSES.has(status)) fail("--status is invalid.");
  if (!VERIFICATION_METHODS.has(verificationMethod)) fail("--verification-method is invalid.");
  const evidenceRefs = argValues("--evidence-ref").map((value) => safeRef(value, "--evidence-ref"));
  const observed = text(argValue("--observed", ""));
  const reason = text(argValue("--reason", ""));
  const environment = text(argValue("--environment", ""));
  const pmRiskAcceptanceRef = argValue("--pm-risk-acceptance-ref", "") ? safeRef(argValue("--pm-risk-acceptance-ref"), "--pm-risk-acceptance-ref") : "";
  if (["confirmed", "rejected"].includes(status) && (!evidenceRefs.length || verificationMethod === "none" || !observed || !environment)) fail("confirmed/rejected requires method, evidence, observed result, and environment.");
  if (["inconclusive", "out_of_scope"].includes(status) && !reason) fail(`${status} requires --reason.`);
  if (status === "inconclusive" && isHigh(issue) && !pmRiskAcceptanceRef && !reason) fail("high inconclusive disposition requires a reason or PM risk acceptance.");

  issue.localDisposition = {
    ...dispositionFor(issue),
    status,
    verificationMethod,
    evidenceRefs,
    observed,
    reason,
    environment,
    pmRiskAcceptanceRef,
    decidedAt: new Date().toISOString()
  };
  issue.decisionEligibility = ["confirmed", "rejected", "out_of_scope"].includes(status)
    ? "eligible"
    : status === "inconclusive" && pmRiskAcceptanceRef ? "pm_risk_accepted" : isHigh(issue) ? "unresolved_high" : "not_required";
  ledger.findingDispositionVersion = "0.5.6";
  ledger.updatedAt = new Date().toISOString();
  writeJson(file, ledger);
  console.log(JSON.stringify({ status: "ok", issueId, localDisposition: issue.localDisposition, decisionEligibility: issue.decisionEligibility, issueLedgerRef: path.relative(workspace, file) }, null, 2));
}

if (require.main === module) main();
