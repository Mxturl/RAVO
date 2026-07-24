#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateDataBoundary } = require("./review-boundary");
const { buildIssueLedger, parseReviewResponse } = require("./review-response");

const SCHEMA_VERSION = "0.5.0";
const PRODUCT_VERSION = "0.6.3";
const REVIEW_DIR = path.join("knowledge", ".ravo", "review");
const MAX_LEGACY_RAW_BYTES = 10 * 1024 * 1024;
const VALUE_OPTIONS = new Set(["--workspace", "--source", "--subject-ref", "--data-boundary", "--authorization-source"]);
const FLAG_OPTIONS = new Set(["--help", "-h", "--version", "--confirm-sensitive"]);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
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

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function resolveWorkspaceFile(workspace, ref) {
  const root = path.resolve(workspace);
  const file = path.resolve(root, ref || "");
  return file.startsWith(`${root}${path.sep}`) ? file : "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateCliArgs() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (FLAG_OPTIONS.has(token)) continue;
    if (!VALUE_OPTIONS.has(token)) fail(token.startsWith("-") ? `Unknown option: ${token}` : `Unexpected positional argument: ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${token} requires a value.`);
    index += 1;
  }
}

function sourceRawRefs(source) {
  return [
    ...(Array.isArray(source.rawResultRefs) ? source.rawResultRefs : []),
    ...(source.rawResultRef ? [source.rawResultRef] : [])
  ].filter(Boolean);
}

function normalizeRawRecords(rawValue, rawRef) {
  const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
  return entries.map((entry, index) => ({
    round: Number(entry?.round || 1),
    providerModelKey: String(entry?.providerModelKey || entry?.model || `legacy/model-${index + 1}`),
    rawResponseRef: `${rawRef}#/records/${index}`,
    raw: entry?.result ?? entry?.raw ?? entry
  }));
}

function ensureManifest(workspace, artifactPath) {
  const manifestPath = path.join(workspace, "knowledge", ".ravo", "manifest.json");
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

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: migrate-review-artifact.js --workspace <path> --source <legacy-review.json> [boundary options]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  validateCliArgs();
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const sourceRef = argValue("--source", "");
  const sourcePath = resolveWorkspaceFile(workspace, sourceRef);
  const source = sourcePath ? readJson(sourcePath) : null;
  if (!source) fail("--source must reference a readable workspace Review artifact.");
  if (source.schemaVersion === SCHEMA_VERSION && source.artifactKind) fail("Source is already a v0.5 Review artifact.");
  const sourceBefore = fs.readFileSync(sourcePath, "utf8");
  const rawRefs = sourceRawRefs(source);
  const rawRecords = [];
  const missingRawRefs = [];
  const oversizedRawRefs = [];
  for (const ref of rawRefs) {
    const file = resolveWorkspaceFile(workspace, ref);
    let raw = null;
    if (file) {
      try {
        if (fs.statSync(file).size > MAX_LEGACY_RAW_BYTES) oversizedRawRefs.push(ref);
        else raw = readJson(file);
      } catch (_error) { /* Unreadable sources are classified below. */ }
    }
    if (raw) rawRecords.push(...normalizeRawRecords(raw, ref));
    else if (!oversizedRawRefs.includes(ref)) missingRawRefs.push(ref);
  }

  const subjectRef = argValue("--subject-ref", source.subjectRef || source.relatedArtifact || source.inputHash || source.id);
  const boundary = evaluateDataBoundary(subjectRef, {
    decision: argValue("--data-boundary", "sensitive_requires_consent"),
    authorizationSource: argValue("--authorization-source", "none"),
    consentConfirmed: process.argv.includes("--confirm-sensitive"),
    redactionSummary: ["migration:legacy_review_artifact"]
  });
  const reviewerRecords = [];
  const modelsResponded = [];
  const modelsUsable = [];
  const modelsFailed = [];
  const parserErrors = [];
  let rawFindingCount = 0;
  rawRecords.forEach((record, index) => {
    const rawResponseRef = record.rawResponseRef || `${sourceRef}#/records/${index}`;
    const parsed = parseReviewResponse(record.raw, {
      providerModelKey: record.providerModelKey,
      round: record.round,
      rawResponseRef
    });
    modelsResponded.push(record.providerModelKey);
    rawFindingCount += parsed.rawFindingCount;
    if (parsed.usable) {
      modelsUsable.push(record.providerModelKey);
      reviewerRecords.push({ providerModelKey: record.providerModelKey, round: record.round, rawResponseRef, reviewer: parsed.reviewer });
    } else {
      modelsFailed.push(record.providerModelKey);
      parserErrors.push(...parsed.parserErrors.map((error) => `${record.providerModelKey}:${error}`));
    }
  });
  const ledger = buildIssueLedger(reviewerRecords);
  const requested = Array.isArray(source.modelsRequested) ? source.modelsRequested : [];
  const rounds = Number(source.roundsRequested || 1);
  const usablePairRounds = new Set(reviewerRecords.map((record) => `${record.providerModelKey}@${record.round}`));
  const expectedPairRounds = requested.flatMap((key) => Array.from({ length: rounds }, (_value, index) => `${key}@${index + 1}`));
  const parserStatus = rawRecords.length === 0 ? "legacy_unclassified"
    : modelsUsable.length === 0 ? "error"
      : parserErrors.length || ledger.parserStatus === "partial" ? "partial"
        : "pass";
  const evidenceAllowed = boundary.externalCallAllowed;
  const workflowCoverage = !rawRecords.length || !evidenceAllowed || !modelsUsable.length
    ? "none"
    : expectedPairRounds.length > 0 && expectedPairRounds.every((key) => usablePairRounds.has(key)) && parserStatus === "pass" && ledger.ledgerFindingCount > 0
      ? "full"
      : "partial";
  const now = new Date().toISOString();
  const reviewRunId = `${now.replace(/[:.]/g, "-")}-legacy-review-migration`;
  const issueLedgerRef = path.join(REVIEW_DIR, "issues", `${reviewRunId}.json`);
  writeJson(path.join(workspace, issueLedgerRef), {
    schemaVersion: SCHEMA_VERSION,
    reviewRunId,
    parserStatus,
    rawFindingCount,
    ledgerFindingCount: ledger.ledgerFindingCount,
    deduplicatedCount: ledger.deduplicatedCount,
    parserErrors: [...new Set([...ledger.parserErrors, ...parserErrors])],
    issues: ledger.issues
  });
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id: reviewRunId,
    reviewRunId,
    artifactKind: "derived_migration",
    sourceArtifactRef: sourceRef,
    sourceArtifactId: source.id || "",
    sourceArtifactSchemaVersion: source.schemaVersion || "unknown",
    provenance: {
      sourceArtifactHash: sha(sourceBefore),
      sourceCreatedAt: source.createdAt || source.executedAt || "unknown",
      sourceReviewRunId: source.reviewRunId || source.id || "unknown",
      sourceModels: Array.isArray(source.modelsRequested) ? source.modelsRequested : Array.isArray(source.modelsCompleted) ? source.modelsCompleted : [],
      migrationTool: "migrate-review-artifact.js",
      migrationSchemaVersion: SCHEMA_VERSION,
      migratedAt: now
    },
    sourceRefs: [sourceRef, ...rawRefs],
    domain: source.domain || "general",
    subjectRef,
    inputHash: source.inputHash || sha(subjectRef),
    dataBoundary: {
      decision: boundary.decision,
      subjectHash: boundary.subjectHash,
      redactionSummary: boundary.redactionSummary,
      authorizationSource: boundary.authorizationSource,
      externalCallAllowed: boundary.externalCallAllowed,
      reason: boundary.reason
    },
    modelsRequested: requested,
    modelsResponded: [...new Set(modelsResponded)],
    modelsUsable: [...new Set(modelsUsable)],
    modelsCompleted: [...new Set(modelsResponded)],
    modelsFailed: [...new Set(modelsFailed)],
    failedModelReasons: parserErrors,
    transportCoverage: rawRecords.length ? "partial" : "none",
    invocationCoverage: rawRecords.length ? "partial" : "none",
    workflowCoverage,
    coverage: workflowCoverage,
    validResults: reviewerRecords.length > 0,
    parserStatus,
    attempts: [],
    rawFindingCount,
    ledgerFindingCount: ledger.ledgerFindingCount,
    deduplicatedCount: ledger.deduplicatedCount,
    parserErrors: [...new Set([...ledger.parserErrors, ...parserErrors])],
    issueLedgerRef,
    summary: rawRecords.length
      ? `Derived migration re-parsed ${rawRecords.length} legacy raw response record(s).`
      : "Legacy Review artifact has no readable raw response; evidence remains unclassified.",
    risks: [
      ...missingRawRefs.map((ref) => `Missing legacy raw response: ${ref}`),
      ...oversizedRawRefs.map((ref) => `Legacy raw response exceeds ${MAX_LEGACY_RAW_BYTES} bytes and was not parsed: ${ref}`),
      ...parserErrors.map((error) => `Legacy raw response is not usable under the v0.5 schema: ${error}`)
    ],
    recommendations: workflowCoverage === "none" ? ["Run a new authorized v0.5 Review for the same subjectRef."] : [],
    blockingReason: workflowCoverage === "none"
      ? rawRecords.length
        ? boundary.blockingReason || parserErrors.join("; ") || "Legacy raw responses did not produce a usable v0.5 Issue Ledger."
        : "Legacy artifact has no readable raw response."
      : "",
    blockerImpact: workflowCoverage === "none" ? "Legacy coverage cannot support v0.5 external Review evidence." : "",
    temporaryFallback: workflowCoverage === "none" ? "Keep coverage=none and use only inline adversarial analysis." : "",
    recoveryEntry: workflowCoverage === "none" ? "Run a new authorized v0.5 Review for the same subjectRef." : "",
    createdAt: now
  };
  const artifactPath = path.join(workspace, REVIEW_DIR, `${reviewRunId}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  if (fs.readFileSync(sourcePath, "utf8") !== sourceBefore) fail("Legacy source artifact changed during migration.");
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath, reviewRunId, workflowCoverage, parserStatus, modelsUsable: artifact.modelsUsable }, null, 2));
}

if (require.main === module) main();
