#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

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
const PRODUCT_VERSION = "0.6.3";
const TYPES = new Set(["requirement", "root-cause", "solution"]);
const STATUSES = new Set(["draft", "complete"]);
const IMPACT_LEVELS = new Set(["low", "medium", "high"]);
const REVIEW_EVIDENCE = new Set(["not_required", "partial", "full", "blocked"]);
const BLIND_SPOT_BASIS = new Set(["fact", "inference", "assumption", "needs_validation"]);
const BLIND_SPOT_IMPACT = new Set(["high", "medium", "low"]);
const BLIND_SPOT_ACTIONS = new Set(["clarify", "proceed_as_assumption", "mark_out_of_scope", "split_milestone", "run_review", "update_spec"]);
const VALUE_OPTIONS = new Set([
  "--workspace", "--type", "--status", "--title", "--impact-level", "--review-required", "--review-evidence",
  "--related-artifact", "--subject-ref", "--source-ref", "--goal", "--consumer", "--constraint", "--fact",
  "--option", "--challenge", "--why", "--alternative-hypothesis", "--symptom", "--proximate-cause",
  "--mechanism-root-cause", "--boundary", "--smallest-fix", "--verification", "--analysis-mode",
  "--clarification-status", "--open-question", "--assumption", "--co-creation-decision", "--blind-spot",
  "--validation", "--review-artifact", "--review-run-id", "--review-blocking-reason", "--review-blocker-impact",
  "--review-temporary-fallback", "--review-recovery-entry", "--conclusion", "--risk", "--next-action",
  "--pm-headline", "--pm-user-impact", "--pm-action", "--pm-next-step", "--pm-decision-card-json",
  "--pm-evidence-proves", "--pm-evidence-does-not-prove"
]);

function hasArg(name) {
  return process.argv.includes(name);
}

function validateCliArgs() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) fail([`Unexpected positional argument: ${token}`]);
    if (!VALUE_OPTIONS.has(token)) fail([`Unknown option: ${token}`]);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail([`${token} requires a value.`]);
    index += 1;
  }
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values;
}

function listArg(name) {
  return argValues(name)
    .flatMap((value) => String(value || "").split(/\s*\|\|\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function slug(value) {
  return String(value || "analysis")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "analysis";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function resolveWorkspaceFile(workspace, ref) {
  if (!ref) return "";
  const root = path.resolve(workspace);
  const file = path.resolve(root, ref);
  return file.startsWith(`${root}${path.sep}`) ? file : "";
}

function reviewMatchesAnalysis(review, artifact) {
  const expected = [artifact.subjectRef, artifact.relatedArtifact].filter(nonEmpty);
  if (!expected.length) return false;
  const actual = [review.subjectRef, review.relatedArtifact, review.inputRef, review.inputHash]
    .filter(nonEmpty);
  if (Array.isArray(review.sourceRefs)) actual.push(...review.sourceRefs.filter(nonEmpty));
  return expected.some((value) => actual.includes(value));
}

function findReviewByRunId(workspace, reviewRunId) {
  const dir = path.join(workspace, "knowledge", ".ravo", "review");
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(dir, name))
      .map((file) => ({ file, artifact: readJson(file) }))
      .filter((entry) => entry.artifact?.reviewRunId === reviewRunId)
      .sort((a, b) => String(a.artifact.createdAt || "").localeCompare(String(b.artifact.createdAt || "")))
      .at(-1) || null;
  } catch (_err) {
    return null;
  }
}

function validateReviewReference(workspace, artifact) {
  if (artifact.status !== "complete" || !["partial", "full"].includes(artifact.reviewEvidence)) return [];
  const errors = [];
  let entry = null;
  if (artifact.reviewArtifact) {
    const file = resolveWorkspaceFile(workspace, artifact.reviewArtifact);
    entry = file ? { file, artifact: readJson(file) } : null;
  } else if (artifact.reviewRunId) {
    entry = findReviewByRunId(workspace, artifact.reviewRunId);
  }
  if (!entry?.artifact) return ["Review evidence must resolve to an existing workspace Review artifact."];
  const review = entry.artifact;
  if (artifact.reviewRunId && review.reviewRunId !== artifact.reviewRunId) errors.push("Review artifact reviewRunId does not match the analysis reference.");
  if (!reviewMatchesAnalysis(review, artifact)) errors.push("Review artifact does not match analysis subjectRef/relatedArtifact.");
  const usable = Array.isArray(review.modelsUsable) ? review.modelsUsable : [];
  const validResults = typeof review.validResults === "boolean" ? review.validResults : usable.length > 0;
  const parserStatus = review.parserStatus || "legacy_unclassified";
  const workflowCoverage = review.workflowCoverage || "legacy_unclassified";
  const evidenceIntegrity = review.coverage === workflowCoverage
    && review.dataBoundary?.externalCallAllowed === true
    && Number(review.ledgerFindingCount || 0) > 0;
  const coverageValid = artifact.reviewEvidence === "full"
    ? validResults && workflowCoverage === "full" && parserStatus === "pass" && usable.length > 0 && evidenceIntegrity
    : validResults && ["full", "partial"].includes(workflowCoverage) && ["pass", "partial"].includes(parserStatus) && usable.length > 0 && evidenceIntegrity;
  if (!coverageValid) errors.push(`Review artifact does not support reviewEvidence=${artifact.reviewEvidence}.`);
  return errors;
}

function parseBoolean(value, fallback) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseBlindSpot(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (_err) {
    // Preserve concise CLI input while still producing the structured contract.
  }
  return {
    title: String(value || "").trim(),
    basis: "inference",
    impact: "medium",
    suggestedAction: "clarify",
    specUpdateRequired: false
  };
}

function parseOptionalObject(value, label) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (_error) {
    fail([`${label} must be a valid JSON object.`]);
  }
}

function ensureManifest(workspace, latestArtifact, artifactStatus) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: "0.3.1",
    workspace: ".",
    modules: {}
  };
  manifest.modules = manifest.modules || {};
  manifest.modules.analysis = {
    ...(manifest.modules.analysis || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/analysis"],
    latestArtifact: path.relative(workspace, latestArtifact),
    ...(artifactStatus === "complete"
      ? { latestCompleteArtifact: path.relative(workspace, latestArtifact) }
      : {}),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateBlindSpot(item, index) {
  const errors = [];
  const label = `blindSpotFindings[${index}]`;
  if (!item || typeof item !== "object" || Array.isArray(item)) return [`${label} must be an object.`];
  if (!nonEmpty(item.title)) errors.push(`${label}.title is required.`);
  if (!BLIND_SPOT_BASIS.has(item.basis)) errors.push(`${label}.basis is invalid.`);
  if (!BLIND_SPOT_IMPACT.has(item.impact)) errors.push(`${label}.impact is invalid.`);
  if (!BLIND_SPOT_ACTIONS.has(item.suggestedAction)) errors.push(`${label}.suggestedAction is invalid.`);
  if (typeof item.specUpdateRequired !== "boolean") errors.push(`${label}.specUpdateRequired must be boolean.`);
  return errors;
}

function requireString(errors, artifact, field) {
  if (!nonEmpty(artifact[field])) errors.push(`${field} is required for complete ${artifact.type} analysis.`);
}

function requireList(errors, artifact, field) {
  if (!Array.isArray(artifact[field]) || artifact[field].length === 0) errors.push(`${field} requires at least one entry for complete ${artifact.type} analysis.`);
}

function validateReviewEvidence(artifact, errors) {
  const gated = artifact.impactLevel === "high" || artifact.reviewRequired === true;
  if (["partial", "full"].includes(artifact.reviewEvidence) && !artifact.reviewArtifact && !artifact.reviewRunId) {
    errors.push("reviewEvidence=partial|full requires reviewArtifact or reviewRunId.");
  }
  if (gated && ["partial", "full"].includes(artifact.reviewEvidence) && !artifact.subjectRef && !artifact.relatedArtifact) {
    errors.push("High-impact Review evidence requires subjectRef or relatedArtifact so the reviewed object can be matched.");
  }
  if (gated && !["partial", "full", "blocked"].includes(artifact.reviewEvidence)) {
    errors.push("High-impact or review-required analysis needs matching Review evidence or a structured external blocker.");
  }
  if (artifact.reviewEvidence === "blocked") {
    for (const field of ["blockingReason", "blockerImpact", "temporaryFallback", "recoveryEntry"]) {
      if (!nonEmpty(artifact.reviewBlocker[field])) errors.push(`reviewBlocker.${field} is required when Review is blocked.`);
    }
  }
}

function validateArtifact(artifact, explicit) {
  const errors = [];
  if (!TYPES.has(artifact.type)) errors.push(`Unsupported analysis artifact type: ${artifact.type}`);
  if (!STATUSES.has(artifact.status)) errors.push(`Unsupported analysis artifact status: ${artifact.status}`);
  if (!nonEmpty(artifact.title)) errors.push("title is required.");
  if (!IMPACT_LEVELS.has(artifact.impactLevel)) errors.push(`Unsupported impactLevel: ${artifact.impactLevel}`);
  if (typeof artifact.reviewRequired !== "boolean") errors.push("reviewRequired must be true or false.");
  if (!REVIEW_EVIDENCE.has(artifact.reviewEvidence)) errors.push(`Unsupported reviewEvidence: ${artifact.reviewEvidence}`);
  artifact.blindSpotFindings.forEach((item, index) => errors.push(...validateBlindSpot(item, index)));

  if (artifact.status !== "complete") return errors;
  if (!explicit.impactLevel) errors.push("Complete analysis requires explicit --impact-level.");
  if (!explicit.reviewRequired) errors.push("Complete analysis requires explicit --review-required true|false.");
  if (!explicit.reviewEvidence) errors.push("Complete analysis requires explicit --review-evidence.");
  validateReviewEvidence(artifact, errors);

  if (["requirement", "solution"].includes(artifact.type)) {
    for (const field of ["goal", "consumer", "challenge", "derivedConclusion"]) requireString(errors, artifact, field);
    for (const field of ["constraints", "facts", "options", "assumptions", "blindSpotFindings", "validation", "risks", "nextActions"]) requireList(errors, artifact, field);
  }

  if (artifact.type === "root-cause") {
    if (!nonEmpty(artifact.rootCause.symptom)) errors.push("rootCause.symptom is required for complete root-cause analysis.");
    if (!nonEmpty(artifact.rootCause.proximateCause)) errors.push("rootCause.proximateCause is required for complete root-cause analysis.");
    if (!nonEmpty(artifact.rootCause.mechanismRootCause)) errors.push("rootCause.mechanismRootCause is required for complete root-cause analysis.");
    requireList(errors, artifact, "alternativeHypotheses");
    requireList(errors, artifact, "whyChain");
    requireString(errors, artifact, "boundary");
    requireString(errors, artifact, "smallestFix");
    requireList(errors, artifact, "verification");
    requireString(errors, artifact, "derivedConclusion");
  }
  return errors;
}

function fail(errors) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

function printHelp() {
  process.stdout.write([
    "Usage: write-analysis-artifact.js [options]",
    "  --type requirement|solution|root-cause",
    "  --status draft|complete",
    "  --impact-level low|medium|high",
    "  --review-required true|false",
    "  --review-evidence not_required|partial|full|blocked"
  ].join("\n") + "\n");
}

function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printHelp();
    return;
  }
  if (hasArg("--version")) {
    process.stdout.write(`${PRODUCT_VERSION}\n`);
    return;
  }
  validateCliArgs();

  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const type = argValue("--type", "requirement").trim();
  const status = argValue("--status", "draft").trim() || "draft";
  const title = argValue("--title", "Untitled analysis").trim();
  const impactLevel = argValue("--impact-level", status === "draft" ? "medium" : "").trim();
  const reviewRequired = parseBoolean(argValue("--review-required", status === "draft" ? "false" : ""), null);
  const reviewEvidence = argValue("--review-evidence", status === "draft" ? "not_required" : "").trim();
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id: "",
    type,
    status,
    title,
    createdAt: "",
    impactLevel,
    reviewRequired,
    relatedArtifact: argValue("--related-artifact", "").trim(),
    subjectRef: argValue("--subject-ref", "").trim(),
    sourceRefs: listArg("--source-ref"),
    goal: argValue("--goal", "").trim(),
    consumer: argValue("--consumer", "").trim(),
    constraints: listArg("--constraint"),
    facts: listArg("--fact"),
    options: listArg("--option"),
    challenge: argValue("--challenge", "").trim(),
    whyChain: listArg("--why"),
    alternativeHypotheses: listArg("--alternative-hypothesis"),
    rootCause: {
      symptom: argValue("--symptom", "").trim(),
      proximateCause: argValue("--proximate-cause", "").trim(),
      mechanismRootCause: argValue("--mechanism-root-cause", "").trim()
    },
    boundary: argValue("--boundary", "").trim(),
    smallestFix: argValue("--smallest-fix", "").trim(),
    verification: listArg("--verification"),
    analysisMode: argValue("--analysis-mode", "").trim(),
    clarificationStatus: argValue("--clarification-status", "").trim(),
    openQuestions: listArg("--open-question"),
    assumptions: listArg("--assumption"),
    coCreationDecision: argValue("--co-creation-decision", "").trim(),
    blindSpotFindings: listArg("--blind-spot").map(parseBlindSpot),
    validation: listArg("--validation"),
    reviewEvidence,
    reviewArtifact: argValue("--review-artifact", "").trim(),
    reviewRunId: argValue("--review-run-id", "").trim(),
    reviewBlocker: {
      blockingReason: argValue("--review-blocking-reason", "").trim(),
      blockerImpact: argValue("--review-blocker-impact", "").trim(),
      temporaryFallback: argValue("--review-temporary-fallback", "").trim(),
      recoveryEntry: argValue("--review-recovery-entry", "").trim()
    },
    derivedConclusion: argValue("--conclusion", status === "draft" ? "Draft analysis artifact created; complete the analysis before using it as evidence." : "").trim(),
    risks: listArg("--risk"),
    nextActions: listArg("--next-action")
  };

  const errors = validateArtifact(artifact, {
    impactLevel: hasArg("--impact-level"),
    reviewRequired: hasArg("--review-required"),
    reviewEvidence: hasArg("--review-evidence")
  });
  errors.push(...validateReviewReference(workspace, artifact));
  if (errors.length) fail(errors);

  const now = new Date().toISOString();
  artifact.createdAt = now;
  artifact.id = `${now.replace(/[:.]/g, "-")}-${slug(title)}`;
  const pmAction = argValue("--pm-action", "none").trim();
  const pmState = pmAction === "none" ? (status === "draft" ? "needs_alignment" : "planned") : "awaiting_pm";
  const stage = type === "requirement" ? "capture" : "align";
  const defaultHeadline = status === "draft"
    ? "需求仍在梳理"
    : type === "root-cause" ? "问题原因已经定位" : type === "solution" ? "解决方向已经形成" : "需求分析已经形成结论";
  artifact.pmBrief = buildPmBrief({
    headline: argValue("--pm-headline", defaultHeadline),
    stage,
    productState: pmState,
    userImpact: argValue("--pm-user-impact", status === "draft"
      ? "当前信息还不足以确定交付范围，现有产品和使用环境不会变化。"
      : "这份结论可用于确定下一步范围，但功能尚未因此实现或进入实际使用环境。"),
    actionRequired: pmAction,
    nextStep: argValue("--pm-next-step", pmAction === "none"
      ? "Codex 将根据当前结论维护已确认范围并继续下一步。"
      : "请查看决策卡并选择最符合产品目标的方案。"),
    decisionCard: parseOptionalObject(argValue("--pm-decision-card-json", ""), "--pm-decision-card-json"),
    evidenceBoundary: {
      proves: listArg("--pm-evidence-proves").length ? listArg("--pm-evidence-proves") : [status === "draft" ? "已记录当前需求背景和待澄清事项" : "已形成可追溯的分析结论"],
      doesNotProve: listArg("--pm-evidence-does-not-prove").length ? listArg("--pm-evidence-does-not-prove") : ["尚不代表功能已经实现或可以使用"]
    },
    sourceRefs: artifact.sourceRefs.length ? artifact.sourceRefs : [`analysis:${artifact.id}`]
  });
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "analysis", `${artifact.id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath, status);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();

module.exports = { validateArtifact };
