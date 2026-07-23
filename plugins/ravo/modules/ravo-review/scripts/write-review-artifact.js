#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateDataBoundary } = require("./review-boundary");

function loadPmBriefModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-pm-brief.js"),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-pm-brief.js") : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-pm-brief.js") : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO PM Brief module is unavailable.");
  return require(file);
}

const { buildPmBrief } = loadPmBriefModule();

const SCHEMA_VERSION = "0.5.0";
const PRODUCT_VERSION = "0.6.2";
const COVERAGE = new Set(["none", "partial", "full"]);
const PARSER_STATUS = new Set(["not_run", "pass", "partial", "error", "legacy_unclassified"]);
const VALUE_OPTIONS = new Set([
  "--workspace", "--workflow-coverage", "--coverage", "--parser-status", "--subject-ref", "--model-requested",
  "--model-responded", "--model-completed", "--model-usable", "--model-failed", "--issue-ledger-ref",
  "--ledger-finding-count", "--raw-finding-count", "--deduplicated-count", "--authorization-source", "--subject",
  "--data-boundary", "--redaction-summary", "--summary", "--review-run-id", "--attempt", "--domain", "--input-hash",
  "--source-ref", "--transport-coverage", "--invocation-coverage", "--failure-reason", "--parser-error", "--risk",
  "--recommendation", "--blocking-reason", "--blocker-impact", "--temporary-fallback", "--recovery-entry",
  "--pm-headline", "--pm-user-impact", "--pm-action", "--pm-next-step", "--pm-decision-card-json",
  "--pm-evidence-proves", "--pm-evidence-does-not-prove"
]);
const FLAG_OPTIONS = new Set(["--help", "-h", "--version", "--confirm-sensitive"]);

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

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values.map((value) => value.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "review";
}

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
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

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseOptionalObject(value, label) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (_error) {
    fail(`${label} must be a valid JSON object.`);
  }
}

function ensurePairKeys(values, field) {
  if (values.some((value) => !/^[^/]+\/[^/]+$/.test(value))) fail(`${field} values must use providerId/modelId.`);
  return [...new Set(values)];
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: "0.3.1", workspace: ".", modules: {} };
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

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: write-review-artifact.js --subject-ref <id> --coverage none [blocker options]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  validateCliArgs();
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const requestedCoverage = argValue("--workflow-coverage", argValue("--coverage", "none"));
  if (!COVERAGE.has(requestedCoverage)) fail(`Unsupported review coverage: ${requestedCoverage}`);
  const parserStatus = argValue("--parser-status", argValues("--model-completed").length ? "legacy_unclassified" : "not_run");
  if (!PARSER_STATUS.has(parserStatus)) fail(`Unsupported parser status: ${parserStatus}`);
  const subjectRef = argValue("--subject-ref", "").trim();
  if (!subjectRef) fail("Manual Review artifact requires --subject-ref.");
  const modelsRequested = ensurePairKeys(argValues("--model-requested"), "--model-requested");
  const modelsResponded = ensurePairKeys([...argValues("--model-responded"), ...argValues("--model-completed")], "--model-responded/--model-completed");
  const modelsUsable = ensurePairKeys(argValues("--model-usable"), "--model-usable");
  const modelsFailed = ensurePairKeys(argValues("--model-failed"), "--model-failed");
  const issueLedgerRef = argValue("--issue-ledger-ref", "");
  const ledgerPath = issueLedgerRef ? path.resolve(workspace, issueLedgerRef) : "";
  const ledger = ledgerPath && ledgerPath.startsWith(`${workspace}${path.sep}`) ? readJson(ledgerPath) : null;
  const ledgerFindingCount = Number(argValue("--ledger-finding-count", ledger?.ledgerFindingCount || ledger?.issues?.length || "0"));
  const rawFindingCount = Number(argValue("--raw-finding-count", ledger?.rawFindingCount || ledgerFindingCount || "0"));
  const deduplicatedCount = Number(argValue("--deduplicated-count", Math.max(0, rawFindingCount - ledgerFindingCount)));
  if (requestedCoverage !== "none") {
    fail("Manual Review records cannot claim partial/full coverage. Use run-review.js or migrate-review-artifact.js so raw responses and the Issue Ledger are mechanically derived.");
  }
  if (modelsUsable.length || ledgerFindingCount > 0 || rawFindingCount > 0 || ["pass", "partial"].includes(parserStatus)) {
    fail("coverage=none manual records cannot contain usable models, parsed findings, or pass/partial parser status.");
  }

  const authorizationSource = argValue("--authorization-source", "none");
  const boundary = evaluateDataBoundary(argValue("--subject", subjectRef), {
    decision: argValue("--data-boundary", requestedCoverage === "none" ? "sensitive_requires_consent" : "safe_sanitized"),
    authorizationSource,
    consentConfirmed: process.argv.includes("--confirm-sensitive"),
    redactionSummary: argValues("--redaction-summary")
  });
  const summary = argValue("--summary", "RAVO manual Review record");
  const now = new Date().toISOString();
  const reviewRunId = argValue("--review-run-id", `${now.replace(/[:.]/g, "-")}-${slug(summary)}`);
  const attempts = argValues("--attempt").map((value) => {
    try { return JSON.parse(value); } catch (_err) { fail("--attempt must be valid JSON."); }
  });
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id: reviewRunId,
    reviewRunId,
    artifactKind: "manual_record",
    domain: argValue("--domain", "general"),
    subjectRef,
    inputHash: argValue("--input-hash", sha(argValue("--subject", subjectRef))),
    sourceRefs: argValues("--source-ref"),
    dataBoundary: {
      decision: boundary.decision,
      subjectHash: boundary.subjectHash,
      redactionSummary: boundary.redactionSummary,
      authorizationSource: boundary.authorizationSource,
      externalCallAllowed: boundary.externalCallAllowed,
      reason: boundary.reason
    },
    modelsRequested,
    modelsResponded,
    modelsUsable,
    modelsCompleted: modelsResponded,
    modelsFailed,
    failedModelReasons: argValues("--failure-reason"),
    transportCoverage: argValue("--transport-coverage", modelsResponded.length ? "partial" : "none"),
    invocationCoverage: argValue("--invocation-coverage", modelsRequested.length ? "partial" : "none"),
    workflowCoverage: requestedCoverage,
    coverage: requestedCoverage,
    validResults: false,
    parserStatus,
    attempts,
    rawFindingCount,
    ledgerFindingCount,
    deduplicatedCount,
    parserErrors: argValues("--parser-error"),
    issueLedgerRef,
    summary,
    risks: argValues("--risk"),
    recommendations: argValues("--recommendation"),
    blockingReason: argValue("--blocking-reason", requestedCoverage === "none" ? boundary.blockingReason || "No usable external Review evidence was recorded." : ""),
    blockerImpact: argValue("--blocker-impact", requestedCoverage === "none" ? "Review cannot support acceptance or release evidence." : ""),
    temporaryFallback: argValue("--temporary-fallback", requestedCoverage === "none" ? boundary.temporaryFallback : ""),
    recoveryEntry: argValue("--recovery-entry", requestedCoverage === "none" ? boundary.recoveryEntry : ""),
    createdAt: now
  };
  const pmAction = argValue("--pm-action", "none").trim();
  artifact.pmBrief = buildPmBrief({
    headline: argValue("--pm-headline", requestedCoverage === "full" ? "外部复核已经完成" : requestedCoverage === "partial" ? "外部复核只完成了一部分" : "外部复核没有执行"),
    stage: "verify",
    productState: pmAction === "none" ? (requestedCoverage === "full" && parserStatus === "pass" ? "validated" : "in_progress") : "awaiting_pm",
    userImpact: argValue("--pm-user-impact", requestedCoverage === "none"
      ? "当前结论只能由本地检查支持，不能把外部复核作为验收或发布证据。"
      : requestedCoverage === "full" ? "当前方案已经获得完整外部复核，具体发现仍需逐项处理。" : "部分外部意见可用于改进，但不足以支持最终验收结论。"),
    actionRequired: pmAction,
    nextStep: argValue("--pm-next-step", pmAction === "none" ? "Codex 将继续处理已知风险，并保留尚未覆盖的证据边界。" : "请查看决策卡并选择是否接受当前风险。"),
    decisionCard: parseOptionalObject(argValue("--pm-decision-card-json", ""), "--pm-decision-card-json"),
    evidenceBoundary: {
      proves: argValues("--pm-evidence-proves").length ? argValues("--pm-evidence-proves") : [requestedCoverage === "none" ? "已记录外部复核未执行的原因和影响" : "已记录本次外部复核的实际覆盖"],
      doesNotProve: argValues("--pm-evidence-does-not-prove").length ? argValues("--pm-evidence-does-not-prove") : [requestedCoverage === "full" ? "外部复核不能替代真实产品验收" : "当前覆盖不足以支持最终验收或发布结论"]
    },
    sourceRefs: artifact.sourceRefs.length ? artifact.sourceRefs : [`review:${artifact.reviewRunId}`]
  });
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "review", `${reviewRunId}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath, reviewRunId, coverage: requestedCoverage, parserStatus }, null, 2));
}

if (require.main === module) main();
