#!/usr/bin/env node

const fs = require("node:fs");
const { normalizeReviewConfig } = require("./review-config");
const PRODUCT_VERSION = "0.6.3";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: review-config-cli.js --validate < config.json");
  process.exit(0);
}
if (process.argv.includes("--version")) {
  console.log(PRODUCT_VERSION);
  process.exit(0);
}
if (process.argv.slice(2).some((arg) => arg !== "--validate")) fail("Only --validate is supported; config JSON must be provided through stdin.");

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (_error) {
  fail("stdin must contain one valid Review config JSON object.");
}

const result = normalizeReviewConfig(input);
console.log(JSON.stringify({
  valid: result.valid,
  configShape: result.configShape,
  migrationStatus: result.migrationStatus,
  runClass: result.runClass,
  formalEvidenceEligible: result.formalEvidenceEligible,
  formalTimeoutProfile: result.formalTimeoutProfile,
  effectiveTimeoutProfile: result.effectiveTimeoutProfile,
  formalProfileErrors: result.formalProfileErrors,
  counts: result.counts,
  errors: result.errors,
  normalized: result.normalized,
  redactedConfigFingerprint: result.redactedConfigFingerprint
}, null, 2));
