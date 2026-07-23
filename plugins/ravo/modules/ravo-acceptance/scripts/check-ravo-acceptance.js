#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const PRODUCT_VERSION = "0.6.2";

function resolvePmBriefModulePath(scriptDir = __dirname, productVersion = PRODUCT_VERSION) {
  const workspaceModule = path.resolve(scriptDir, "../../ravo-core/scripts/ravo-pm-brief.js");
  if (fs.existsSync(workspaceModule)) return workspaceModule;
  const installedModule = process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-pm-brief.js") : "";
  return fs.existsSync(installedModule) ? installedModule : "";
}

const pmBriefModulePath = resolvePmBriefModulePath();
const pmBriefModule = pmBriefModulePath ? require(pmBriefModulePath) : null;
const validatePmBrief = pmBriefModule?.validatePmBrief || (() => ["RAVO PM Brief validator is unavailable."]);
const validatePmMarkdown = pmBriefModule?.validatePmMarkdown || (() => ["RAVO PM Markdown validator is unavailable."]);
const {
  artifactMatchesSubject,
  externalBlockerState,
  hasSourceBinding,
  needsExternalBlockerPmDecision,
  parseAcceptanceItems,
  pmDecisionErrors,
  requiresGitBaseline,
  requiresPmDecision,
  securityReady,
  validateAcceptanceItems,
  validateOverallStatus
} = require("./acceptance-model");

function loadVersionPolicyModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-version-policy.js"),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-version-policy.js") : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-version-policy.js") : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO version policy module is unavailable.");
  return require(file);
}

const { validateReleaseRecord, validateVersionBuildEvidence } = loadVersionPolicyModule();

function requiresVersionGovernance(specText) {
  return /R512-\d{3}|v0\.5\.12-product-version-governance/i.test(String(specText || ""));
}

function resolveReviewDispositionModulePath(scriptDir = __dirname, productVersion = PRODUCT_VERSION) {
  const workspaceModule = path.resolve(scriptDir, "../../ravo-review/scripts/review-disposition.js");
  if (fs.existsSync(workspaceModule)) return workspaceModule;
  const installedModule = process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-review/scripts/review-disposition.js") : "";
  return fs.existsSync(installedModule) ? installedModule : "";
}

const FORMAL_TIMEOUT_PROFILE = Object.freeze({
  timeoutMs: 900000,
  firstEventTimeoutMs: 120000,
  firstContentTimeoutMs: 300000,
  idleTimeoutMs: 180000,
  stream: true
});
const TIMEOUT_FIELDS = ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs"];
const PHASE_TIMING_FIELDS = ["requestStartedAt", "responseHeadersAt", "firstByteAt", "firstEventAt", "firstContentAt", "lastEventAt", "lastSubstantiveEventAt", "abortAt", "completedAt"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function validateCliArgs() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (["--help", "-h", "--version"].includes(token)) continue;
    if (token !== "--acceptance-artifact") throw new Error(token.startsWith("-") ? `Unknown option: ${token}` : `Unexpected positional argument: ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    index += 1;
  }
}

function latestJson(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .sort()
      .at(-1) || "";
  } catch (_err) {
    return "";
  }
}

function resolveWorkspaceRef(cwd, ref) {
  if (!ref || typeof ref !== "string") return "";
  const root = path.resolve(cwd);
  const candidate = path.resolve(root, ref);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : "";
}

function acceptancePath(cwd, manifest, explicitRef = "") {
  if (explicitRef) return resolveWorkspaceRef(cwd, explicitRef);
  const ref = manifest?.modules?.acceptance?.latestArtifact;
  if (ref) return resolveWorkspaceRef(cwd, ref);
  return latestJson(path.join(cwd, "knowledge", ".ravo", "acceptance"));
}

function addCheck(checks, id, status, required, summary, details = []) {
  checks.push({ id, status, required, summary, ...(details.length ? { details } : {}) });
}

function readBoundArtifact(cwd, ref) {
  const file = resolveWorkspaceRef(cwd, ref);
  if (!file) return { file: "", artifact: null, error: ref ? "Reference escapes the workspace or is invalid." : "Reference is missing." };
  if (!fs.existsSync(file)) return { file, artifact: null, error: "Referenced artifact does not exist." };
  const artifact = readJson(file);
  return artifact ? { file, artifact, error: "" } : { file, artifact: null, error: "Referenced artifact is not valid JSON." };
}

function checkBoundArtifact(checks, cwd, acceptance, field, checkId, validator, required = false) {
  const ref = acceptance?.[field] || "";
  if (!ref) {
    addCheck(checks, checkId, required ? "fail" : "skip", required, required ? `${field} is required.` : `${field} is not bound to this acceptance artifact.`);
    return { file: "", artifact: null };
  }
  const result = readBoundArtifact(cwd, ref);
  if (result.error) {
    addCheck(checks, checkId, "fail", true, `${field}: ${result.error}`);
    return result;
  }
  const validation = validator ? validator(result.artifact) : { pass: true, summary: `${field} is readable.` };
  addCheck(checks, checkId, validation.pass ? "pass" : "fail", true, validation.summary, validation.details || []);
  return result;
}

function markdownSection(markdown, heading, nextHeadings = []) {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const candidates = (Array.isArray(nextHeadings) ? nextHeadings : [nextHeadings])
    .filter(Boolean)
    .map((nextHeading) => markdown.indexOf(nextHeading, start + heading.length))
    .filter((index) => index >= 0);
  const end = candidates.length ? Math.min(...candidates) : -1;
  return markdown.slice(start, end < 0 ? undefined : end);
}

function checkPmDocument(checks, cwd, acceptance, specText = "") {
  const needsPackage = ["pending_acceptance", "accepted", "release_ready"].includes(acceptance?.status);
  const pmPath = resolveWorkspaceRef(cwd, acceptance?.pmChecklistRef || "");
  if (!needsPackage && !pmPath) {
    addCheck(checks, "pmAcceptancePackage", "skip", false, "PM acceptance package is not required for this status.");
    return "";
  }
  if (!pmPath || !fs.existsSync(pmPath)) {
    addCheck(checks, "pmAcceptancePackage", "fail", needsPackage, "PM acceptance package is missing or outside the workspace.");
    return "";
  }
  const markdown = fs.readFileSync(pmPath, "utf8");
  if (!acceptance.pmBrief) {
    addCheck(checks, "pmAcceptancePackage", "skip", false, "Historical acceptance package has no fixed PM projection to validate.");
    addCheck(checks, "pmTaskPlacement", "skip", false, "Historical acceptance package keeps its original PM task layout.");
    return pmPath;
  }
  const requiredLines = ["结论：", "当前可用：", "影响：", "PM 行动：", "状态边界：", "下一步：", "风险："];
  const missing = requiredLines.filter((line) => !markdown.includes(line));
  const pmErrors = validatePmMarkdown(markdown, { kind: "acceptance", actionRequired: acceptance.pmBrief?.actionRequired || "none" });
  if (acceptance.pmBrief?.actionRequired !== "none") {
    if (!markdown.includes("## 体验步骤")) missing.push("PM experience document is missing its steps.");
    if (!markdown.includes("## 需要你决定")) missing.push("PM experience document is missing its single decision.");
  }
  missing.push(...pmErrors);
  addCheck(
    checks,
    "pmAcceptancePackage",
    missing.length ? "fail" : "pass",
    needsPackage,
    missing.length ? "PM acceptance package is incomplete." : "PM acceptance package follows the fixed product-facing projection.",
    missing
  );
  const pendingPm = needsPackage && (acceptance.acceptanceItems || []).some((item) => item.verificationStatus === "pending_pm" || needsExternalBlockerPmDecision(item, acceptance.specRef));
  const placementErrors = pendingPm && acceptance.pmBrief?.actionRequired === "none" ? ["PM verification exists but the PM Brief does not request one decision."] : [];
  addCheck(checks, "pmTaskPlacement", placementErrors.length ? "fail" : "pass", needsPackage, placementErrors.length ? "PM decision placement is inconsistent." : "PM steps are limited to the product experience.", placementErrors);
  return pmPath;
}

function reviewCoverage(review) {
  const usable = Array.isArray(review?.modelsUsable) ? review.modelsUsable : [];
  const workflowCoverage = review?.workflowCoverage || "legacy_unclassified";
  const parserStatus = review?.parserStatus || "legacy_unclassified";
  const validResults = typeof review?.validResults === "boolean" ? review.validResults : usable.length > 0;
  return { usable, workflowCoverage, parserStatus, validResults };
}

function formalReviewEvidenceEligible(review) {
  const schemaVersion = String(review?.schemaVersion ?? review?.details?.schemaVersion ?? "");
  const runClass = String(review?.runClass ?? review?.details?.runClass ?? "");
  const eligible = review?.formalEvidenceEligible ?? review?.details?.formalEvidenceEligible;
  return schemaVersion === "0.5.1" && runClass === "formal" && eligible === true;
}

function sameProfile(left, right) {
  return isObject(left) && isObject(right)
    && TIMEOUT_FIELDS.every((field) => left[field] === right[field])
    && left.stream === right.stream;
}

function formalReviewTelemetryErrors(review) {
  const errors = [];
  const boundary = review?.dataBoundary;
  const authorizedBoundary = isObject(boundary)
    && ["safe_sanitized", "sensitive_requires_consent"].includes(boundary.decision)
    && boundary.externalCallAllowed === true
    && ["policy_safe_sanitized", "explicit_user_action", "conversation_confirmation"].includes(boundary.authorizationSource)
    && (boundary.decision !== "sensitive_requires_consent" || ["explicit_user_action", "conversation_confirmation"].includes(boundary.authorizationSource));
  if (!authorizedBoundary) errors.push("Formal Review data boundary is missing or not authorized.");
  const callPlan = review?.callPlan;
  if (!isObject(callPlan)) return ["Formal Review callPlan is missing."];
  if (callPlan.runClass !== "formal" || callPlan.formalEvidenceEligible !== true) errors.push("callPlan must be formal and evidence-eligible.");
  const requestedProfile = callPlan.requestedTimeoutProfile;
  if (!isObject(requestedProfile)) errors.push("callPlan.requestedTimeoutProfile is missing.");
  else {
    for (const field of TIMEOUT_FIELDS) if (!Number.isInteger(requestedProfile[field]) || requestedProfile[field] < FORMAL_TIMEOUT_PROFILE[field]) errors.push(`callPlan.requestedTimeoutProfile.${field} is below the formal floor.`);
    if (requestedProfile.stream !== true) errors.push("callPlan.requestedTimeoutProfile.stream must be true.");
  }
  const requestedPairs = Array.isArray(callPlan.requestedPairs) ? callPlan.requestedPairs : [];
  const timeoutProfiles = Array.isArray(callPlan.timeoutProfiles) ? callPlan.timeoutProfiles : [];
  if (!requestedPairs.length) errors.push("callPlan.requestedPairs is empty.");
  if (!timeoutProfiles.length) errors.push("callPlan.timeoutProfiles is empty.");
  const byPair = new Map();
  for (const entry of timeoutProfiles) {
    if (!isObject(entry) || typeof entry.providerModelKey !== "string") {
      errors.push("callPlan.timeoutProfiles contains an invalid entry.");
      continue;
    }
    byPair.set(entry.providerModelKey, entry);
    if (!sameProfile(entry.requested, requestedProfile) || !sameProfile(entry.effective, requestedProfile)) errors.push(`${entry.providerModelKey} does not inherit the uniform formal timeout profile.`);
  }
  for (const pair of requestedPairs) if (!byPair.has(pair)) errors.push(`Missing timeout profile for ${pair}.`);
  if (!Number.isInteger(callPlan.maxAttempts) || callPlan.maxAttempts < 1) errors.push("callPlan.maxAttempts is invalid.");
  if (!isObject(callPlan.retryPolicy)) errors.push("callPlan.retryPolicy is missing.");
  if (!Number.isInteger(callPlan.maximumRequests) || callPlan.maximumRequests < 1) errors.push("callPlan.maximumRequests is invalid.");
  if (!Number.isSafeInteger(callPlan.maximumRunMs) || callPlan.maximumRunMs < 1) errors.push("callPlan.maximumRunMs is invalid.");

  const attempts = Array.isArray(review?.attempts) ? review.attempts : [];
  const telemetryText = JSON.stringify({ callPlan, attempts });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|authorization\s*:\s*(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*|\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[a-z0-9_./+\-=]{8,}|\bsk-[a-z0-9_-]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i.test(telemetryText)) {
    errors.push("Formal Review telemetry contains a secret-like value.");
  }
  if ((review?.modelsResponded || []).length > 0 && attempts.length === 0) errors.push("Formal Review has responses but no attempt telemetry.");
  const requiredAttempts = Array.isArray(review?.roundCoverage) && review.roundCoverage.length
    ? review.roundCoverage.flatMap((round) => (round?.primaryRequested || []).map((providerModelKey) => ({ providerModelKey, round: round.round })))
    : requestedPairs.map((providerModelKey) => ({ providerModelKey, round: null }));
  for (const required of requiredAttempts) {
    const found = attempts.some((attempt) => attempt?.providerModelKey === required.providerModelKey && (required.round === null || attempt.round === required.round));
    if (!found) errors.push(`Missing attempt telemetry for ${required.providerModelKey}${required.round === null ? "" : ` round ${required.round}`}.`);
  }
  attempts.forEach((attempt, index) => {
    const label = `attempts[${index}]`;
    if (!isObject(attempt)) {
      errors.push(`${label} is invalid.`);
      return;
    }
    const entry = byPair.get(attempt.providerModelKey);
    if (!entry) errors.push(`${label}.providerModelKey has no call-plan timeout profile.`);
    if (!sameProfile(attempt.requestedTimeoutProfile, entry?.requested) || !sameProfile(attempt.effectiveTimeoutProfile, entry?.effective)) errors.push(`${label} timeout profile does not match the call plan.`);
    if (typeof attempt.timeoutType !== "string") errors.push(`${label}.timeoutType is missing.`);
    if (!isObject(attempt.phaseTiming) || PHASE_TIMING_FIELDS.some((field) => typeof attempt.phaseTiming[field] !== "string") || !attempt.phaseTiming?.requestStartedAt) errors.push(`${label}.phaseTiming is incomplete.`);
    for (const field of ["responseBytes", "partialBytes", "remainingAttemptBudget", "plannedDelayMs", "actualDelayMs"]) {
      if (!Number.isInteger(attempt[field]) || attempt[field] < 0) errors.push(`${label}.${field} is invalid.`);
    }
    if (typeof attempt.partialResponseRef !== "string") errors.push(`${label}.partialResponseRef is missing.`);
    if (attempt.partialBytes > 0 && !attempt.partialResponseRef) errors.push(`${label} has partial bytes without a partial response reference.`);
    if (!isObject(attempt.attemptBudget) || !Number.isInteger(attempt.attemptBudget.maxAttempts) || !Number.isInteger(attempt.attemptBudget.attemptNumber) || !Number.isInteger(attempt.attemptBudget.remainingAfterAttempt)) errors.push(`${label}.attemptBudget is incomplete.`);
    if (!isObject(attempt.retryParameterDelta)) errors.push(`${label}.retryParameterDelta is missing.`);
    if (typeof attempt.jitterPolicy !== "string" || !isObject(attempt.jitterRangeMs) || !Number.isInteger(attempt.jitterRangeMs.min) || !Number.isInteger(attempt.jitterRangeMs.max)) errors.push(`${label}.jitter telemetry is incomplete.`);
    else if (attempt.jitterRangeMs.min < 0 || attempt.jitterRangeMs.max < attempt.jitterRangeMs.min) errors.push(`${label}.jitterRangeMs is invalid.`);
    if (typeof attempt.delayStartedAt !== "string" || typeof attempt.delayEndedAt !== "string") errors.push(`${label}.delay timing is missing.`);
    if ((attempt.plannedDelayMs > 0 || attempt.actualDelayMs > 0) && (!attempt.delayStartedAt || !attempt.delayEndedAt)) errors.push(`${label} records a delay without start/end timestamps.`);
    if (attempt.timeoutType && !attempt.phaseTiming?.abortAt) errors.push(`${label} records a timeout without abortAt.`);
  });
  return [...new Set(errors)];
}

function reviewMatchesSubject(review, subjectRef) {
  if (!subjectRef) return false;
  const candidates = [review?.subjectRef, review?.relatedArtifact, review?.inputRef, review?.inputHash]
    .filter((item) => typeof item === "string");
  if (Array.isArray(review?.sourceRefs)) candidates.push(...review.sourceRefs.filter((item) => typeof item === "string"));
  return candidates.includes(subjectRef);
}

function reviewDispositionCheck(cwd, review, options = {}) {
  const ledgerRef = typeof review?.issueLedgerRef === "string" ? review.issueLedgerRef : "";
  if (!ledgerRef) return { pass: false, details: ["Review artifact is missing issueLedgerRef."], result: null };
  const ledger = readBoundArtifact(cwd, ledgerRef);
  if (ledger.error) return { pass: false, details: [`Issue Ledger: ${ledger.error}`], result: null };
  const modulePath = resolveReviewDispositionModulePath();
  if (!modulePath) return { pass: false, details: ["Review disposition checker is unavailable."], result: null };
  const { checkLedger } = require(modulePath);
  const result = checkLedger(ledger.artifact, { requireAllHigh: options.requireAllHigh === true });
  const details = result.unresolvedHigh.map((item) => `${item.id || "unknown"}: ${item.reason || "pending_local_verification"}`);
  return { pass: result.status === "pass", details, result };
}

function specRequiresFindingDisposition(specText) {
  return typeof specText === "string" && /\bR056-010\b/.test(specText);
}

function buildResult(cwd = process.cwd(), options = {}) {
  const workspace = path.resolve(cwd);
  const ravoRoot = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(ravoRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const checks = [];

  addCheck(checks, "manifest", manifest ? "pass" : "fail", true, manifest ? "RAVO manifest exists." : "knowledge/.ravo/manifest.json is missing.");

  const latestAcceptance = acceptancePath(workspace, manifest, options.acceptanceArtifact || "");
  const acceptance = latestAcceptance ? readJson(latestAcceptance) : null;
  addCheck(checks, "acceptanceArtifact", acceptance ? "pass" : "fail", true, acceptance ? "Acceptance artifact exists." : "Acceptance artifact is missing or invalid.");

  if (!acceptance) {
    const blocking = checks.filter((check) => check.required && check.status === "fail");
    return {
      status: "not_ready",
      gate: { decision: "block", reason: blocking.map((check) => check.summary).join(" ") },
      manifestPath,
      latestAcceptance: "",
      checks
    };
  }

  const parsedItems = parseAcceptanceItems(acceptance.acceptanceItems, acceptance.summary || "");
  acceptance.acceptanceItems = parsedItems.items;
  const itemErrors = validateAcceptanceItems(acceptance.acceptanceItems);
  if (parsedItems.legacyItems || parsedItems.generatedItems) {
    itemErrors.push(`Acceptance contains ${parsedItems.legacyItems} legacy and ${parsedItems.generatedItems} generated item(s); regenerate with v0.5.1 fields.`);
  }
  addCheck(checks, "acceptanceItems", itemErrors.length ? "fail" : "pass", true, itemErrors.length ? "Acceptance item validation failed." : "Acceptance items satisfy the v0.5.1 contract.", itemErrors);

  const pmBriefRequired = Boolean(acceptance.pmBrief);
  const pmBriefErrors = pmBriefRequired ? validatePmBrief(acceptance.pmBrief) : [];
  addCheck(
    checks,
    "pmBrief",
    pmBriefErrors.length ? "fail" : pmBriefRequired ? "pass" : "skip",
    pmBriefRequired,
    pmBriefErrors.length ? "PM-facing product summary is invalid." : pmBriefRequired ? "PM-facing product summary and decision card are valid." : "Historical acceptance package has no PM Brief to validate.",
    pmBriefErrors
  );

  const specFileForStatus = resolveWorkspaceRef(workspace, acceptance.specRef || "");
  const specTextForStatus = specFileForStatus && fs.existsSync(specFileForStatus) ? fs.readFileSync(specFileForStatus, "utf8") : null;
  const overall = validateOverallStatus(acceptance, { specText: specTextForStatus });
  const scope = overall.acceptanceScope;
  const scopeErrors = overall.scopeErrors;
  addCheck(checks, "acceptanceScope", scopeErrors.length ? "fail" : "pass", true, scopeErrors.length ? "Acceptance scope is invalid." : `Acceptance scope is ${scope}.`, scopeErrors);

  const ceilingErrors = [...overall.statusErrors];
  if (acceptance.statusCeiling !== overall.statusCeiling) ceilingErrors.push(`Recorded statusCeiling=${acceptance.statusCeiling || "missing"}; derived=${overall.statusCeiling}.`);
  addCheck(checks, "overallStatus", ceilingErrors.length ? "fail" : "pass", true, ceilingErrors.length ? "Overall status exceeds or conflicts with item evidence." : `Overall status is within the ${overall.statusCeiling} item ceiling.`, ceilingErrors);

  const pmDecisionRequired = requiresPmDecision(acceptance, specTextForStatus);
  const pmDecisionCheckErrors = pmDecisionRequired ? pmDecisionErrors(acceptance, { specText: specTextForStatus, required: true }) : [];
  addCheck(
    checks,
    "pmDecision",
    pmDecisionCheckErrors.length ? "fail" : "pass",
    pmDecisionRequired && ["accepted", "release_ready"].includes(acceptance.status),
    pmDecisionCheckErrors.length ? "PM acceptance decision is missing, ambiguous, or not bound to this package." : pmDecisionRequired ? "PM acceptance decision is explicitly bound to the current package." : "PM decision binding is not required by the referenced Spec.",
    pmDecisionCheckErrors
  );

  const sourceBindingErrors = [];
  if (["pending_acceptance", "accepted", "release_ready"].includes(acceptance.status)) {
    if (!hasSourceBinding(acceptance)) sourceBindingErrors.push("Acceptance-facing status requires subjectRef plus a typed spec/release/artifact binding.");
    if (scope === "release" && acceptance.releaseRef && acceptance.releaseRef !== acceptance.subjectRef) sourceBindingErrors.push("releaseRef must equal subjectRef.");
    if (acceptance.specRef) {
      const specPath = resolveWorkspaceRef(workspace, acceptance.specRef);
      if (!specPath || !fs.existsSync(specPath) || !fs.statSync(specPath).isFile()) sourceBindingErrors.push("specRef is missing or outside the workspace.");
    }
  }
  addCheck(checks, "sourceBinding", sourceBindingErrors.length ? "fail" : "pass", true, sourceBindingErrors.length ? "Acceptance source binding is invalid." : "Acceptance source binding is explicit and typed.", sourceBindingErrors);

  const versionGovernanceRequired = requiresVersionGovernance(specTextForStatus);
  const versionEvidenceErrors = [];
  if (versionGovernanceRequired) {
    if (!acceptance.versionBuildEvidence) versionEvidenceErrors.push("versionBuildEvidence is missing.");
    else {
      const build = validateVersionBuildEvidence(acceptance.versionBuildEvidence);
      versionEvidenceErrors.push(...build.errors);
      if (acceptance.status === "release_ready" && build.status !== "verified") versionEvidenceErrors.push("release_ready requires verified versionBuildEvidence.");
    }
    if (!acceptance.releaseRecord) versionEvidenceErrors.push("releaseRecord is missing.");
    else versionEvidenceErrors.push(...validateReleaseRecord(acceptance.releaseRecord).errors);
  }
  addCheck(
    checks,
    "versionBuildEvidence",
    versionEvidenceErrors.length ? "fail" : versionGovernanceRequired ? "pass" : "skip",
    versionGovernanceRequired,
    versionEvidenceErrors.length ? "Product version/build/release evidence is invalid." : versionGovernanceRequired ? "Product version, build, acceptance, and release states are separated." : "Version governance evidence is not required by the referenced Spec.",
    versionEvidenceErrors
  );

  const gitBaselineRequired = requiresGitBaseline(acceptance, specTextForStatus);
  const gitBaselineErrors = [];
  if (gitBaselineRequired && ["pending_acceptance", "accepted", "release_ready"].includes(acceptance.status)) {
    const baselineFile = resolveWorkspaceRef(workspace, acceptance.gitBaselineArtifact || "");
    const baseline = baselineFile ? readJson(baselineFile) : null;
    if (!baselineFile || !baseline) gitBaselineErrors.push("v0.5.5 acceptance requires a readable gitBaselineArtifact.");
    if (!String(acceptance.baselineRef || "").match(/^git-(?:commit|tree):/)) gitBaselineErrors.push("v0.5.5 acceptance baselineRef must bind a git commit or tree.");
    if (acceptance.gitBaselineStatus === "commit_blocked" || baseline?.status === "commit_blocked") gitBaselineErrors.push("git baseline is commit_blocked.");
    if (baseline && !["committed", "unchanged"].includes(baseline.status)) gitBaselineErrors.push(`Unsupported git baseline status: ${baseline.status || "missing"}.`);
    if (baseline?.baselineRef && acceptance.baselineRef !== baseline.baselineRef) gitBaselineErrors.push("Acceptance baselineRef does not match git baseline evidence.");
  }
  addCheck(checks, "gitBaseline", gitBaselineErrors.length ? "fail" : "pass", gitBaselineRequired && ["pending_acceptance", "accepted", "release_ready"].includes(acceptance.status), gitBaselineErrors.length ? "Git acceptance baseline is missing or blocked." : gitBaselineRequired ? "Git acceptance baseline is bound and locally verified." : "Git baseline is not required by the referenced Spec.", gitBaselineErrors);

  const expectedCodexIds = acceptance.acceptanceItems.filter((item) => item.verificationStatus === "pending_codex").map((item) => item.id).sort();
  const expectedPmIds = acceptance.acceptanceItems
    .filter((item) => item.verificationStatus === "pending_pm" || needsExternalBlockerPmDecision(item, acceptance.specRef))
    .map((item) => item.id)
    .sort();
  const actualCodexIds = Array.isArray(acceptance.codexVerificationItemIds) ? [...acceptance.codexVerificationItemIds].sort() : [];
  const actualPmIds = Array.isArray(acceptance.pmChecklistItemIds) ? [...acceptance.pmChecklistItemIds].sort() : [];
  const placementIndexErrors = [];
  if (JSON.stringify(expectedCodexIds) !== JSON.stringify(actualCodexIds)) placementIndexErrors.push("codexVerificationItemIds does not match pending_codex items.");
  if (JSON.stringify(expectedPmIds) !== JSON.stringify(actualPmIds)) placementIndexErrors.push("pmChecklistItemIds does not match pending_pm items.");
  addCheck(checks, "verificationIndexes", placementIndexErrors.length ? "fail" : "pass", true, placementIndexErrors.length ? "Verification indexes are inconsistent." : "Verification indexes match item statuses.", placementIndexErrors);

  const readyStatuses = new Set(["pending_acceptance", "accepted", "release_ready"]);
  const statusReady = readyStatuses.has(acceptance.status);
  addCheck(checks, "statusEvidence", statusReady ? "pass" : "fail", true, statusReady ? "Acceptance status is eligible for an acceptance-facing gate." : `Acceptance status ${acceptance.status} is not ready for PM/release acceptance.`);

  const needsSecurity = ["accepted", "release_ready"].includes(acceptance.status);
  const securityBaselineReady = securityReady(acceptance.securityChecklist);
  addCheck(checks, "securityBaseline", !needsSecurity || securityBaselineReady ? "pass" : "fail", true, needsSecurity ? "Security baseline supports accepted/release_ready." : "Security baseline is not required for this status.");
  addCheck(checks, "releaseEvidence", acceptance.status !== "release_ready" || ["real_e2e", "full_external_review"].includes(acceptance.evidenceLevel) ? "pass" : "fail", true, "release_ready requires real_e2e or full_external_review evidence.");

  const needsPmPackage = readyStatuses.has(acceptance.status);
  checkPmDocument(checks, workspace, acceptance, specTextForStatus);
  addCheck(checks, "nextStep", typeof acceptance.nextStep === "string" && acceptance.nextStep.trim() ? "pass" : "fail", true, acceptance.nextStep ? "Acceptance includes a concrete next step." : "Acceptance nextStep is missing.");

  const realResponseReady = Array.isArray(acceptance.realResponseRefs) && acceptance.realResponseRefs.length > 0;
  addCheck(checks, "realResponseEvidence", !needsPmPackage || realResponseReady ? "pass" : "fail", needsPmPackage, realResponseReady ? "Real response evidence is referenced." : "Acceptance-facing status requires real response evidence.");
  const visualReady = (Array.isArray(acceptance.screenshotRefs) && acceptance.screenshotRefs.length > 0) || (Array.isArray(acceptance.notApplicableEvidence) && acceptance.notApplicableEvidence.length > 0);
  addCheck(checks, "visualEvidence", !needsPmPackage || visualReady ? "pass" : "fail", needsPmPackage, visualReady ? "Screenshot/recording or explicit alternative evidence is referenced." : "Acceptance-facing status requires screenshot/recording or explicit alternative evidence.");

  const analysisResult = checkBoundArtifact(checks, workspace, acceptance, "analysisArtifact", "analysisEvidence", (artifact) => ({
    pass: artifact.status === "complete" && artifactMatchesSubject(artifact, acceptance.subjectRef),
    summary: artifact.status === "complete" && artifactMatchesSubject(artifact, acceptance.subjectRef)
      ? "Bound analysis artifact is complete and matches subjectRef."
      : "Bound analysis artifact is incomplete or belongs to another subject."
  }), false);

  const workstreamResult = checkBoundArtifact(checks, workspace, acceptance, "workstreamArtifact", "workstreamEvidence", (artifact) => {
    const details = [];
    if (!artifactMatchesSubject(artifact, acceptance.subjectRef)) details.push("Bound workstream does not match subjectRef.");
    if (artifact.status === "blocked") details.push("Bound workstream status is blocked.");
    if (artifact.status === "active" && !artifact.nextStep) details.push("Active workstream is missing nextStep.");
    if (artifact.schemaVersion === "0.5.1") {
      const parked = (artifact.blockerLedger || []).filter((blocker) => blocker.required === true && ["parked", "blocked_terminal"].includes(blocker.executionStatus));
      if (scope === "release" && parked.length) details.push(`Release acceptance cannot hide ${parked.length} parked/blocked_terminal required blocker(s).`);
      const recoveryWorkers = artifact.executionLanes?.recovery?.workers;
      if (Array.isArray(recoveryWorkers) && recoveryWorkers.length > 2) details.push("Workstream exceeds the two-recovery-worker hard limit.");
      if (scope === "milestone") {
        const lane = artifact.executionLanes?.acceptance || {};
        if (lane.milestoneRef && lane.milestoneRef !== acceptance.milestoneRef) details.push("Milestone acceptance does not match the acceptance lane milestoneRef.");
        if (lane.baselineRef && lane.baselineRef !== acceptance.baselineRef) details.push("Milestone acceptance does not match the acceptance lane baselineRef.");
      }
    } else if (scope === "milestone") {
      details.push("Milestone acceptance requires a v0.5.1 structured workstream.");
    }
    return { pass: details.length === 0, summary: details.length ? "Bound workstream governance evidence is invalid." : "Bound workstream evidence is usable and matches subjectRef.", details };
  }, false);

  const smokeResult = checkBoundArtifact(checks, workspace, acceptance, "quickValidationArtifact", "quickValidationEvidence", (artifact) => {
    const pass = artifactMatchesSubject(artifact, acceptance.subjectRef) && ["pass", "warn"].includes(artifact.status) && !(artifact.risks || []).includes("real-device-pending");
    return { pass, summary: pass ? "Bound quick-validation evidence is usable and matches subjectRef." : "Bound quick-validation evidence is mismatched or blocks readiness." };
  }, false);

  const externalEvidence = ["full_external_review", "partial_external_review"].includes(acceptance.evidenceLevel);
  const reviewResult = checkBoundArtifact(checks, workspace, acceptance, "reviewArtifact", "reviewEvidence", (review) => {
    const coverage = reviewCoverage(review);
    const formalEligible = formalReviewEvidenceEligible(review);
    const telemetryErrors = formalEligible ? formalReviewTelemetryErrors(review) : [];
    const subjectMatches = reviewMatchesSubject(review, acceptance.subjectRef);
    const evidenceIntegrity = review.coverage === coverage.workflowCoverage
      && review.dataBoundary?.externalCallAllowed === true
      && Number(review.ledgerFindingCount || 0) > 0
      && telemetryErrors.length === 0;
    const full = formalEligible && coverage.validResults && coverage.workflowCoverage === "full" && coverage.parserStatus === "pass" && coverage.usable.length > 0 && subjectMatches && evidenceIntegrity;
    const partial = formalEligible && coverage.validResults && ["full", "partial"].includes(coverage.workflowCoverage) && ["pass", "partial"].includes(coverage.parserStatus) && coverage.usable.length > 0 && subjectMatches && evidenceIntegrity;
    const pass = acceptance.evidenceLevel === "full_external_review" ? full : acceptance.evidenceLevel === "partial_external_review" ? partial : true;
    const details = [];
    if (externalEvidence && !formalEligible) details.push("Review artifact is diagnostic or is not eligible for formal evidence.");
    if (coverage.workflowCoverage === "legacy_unclassified") details.push("Legacy review artifact lacks workflowCoverage/modelsUsable and cannot support external evidence.");
    if (externalEvidence && !coverage.validResults) details.push("Review artifact has no aggregate usable result.");
    if (externalEvidence && !subjectMatches) details.push("Review artifact does not match acceptance.subjectRef.");
    if (externalEvidence && !evidenceIntegrity) details.push("Review coverage, data boundary, or Issue Ledger integrity is insufficient.");
    if (externalEvidence && telemetryErrors.length) details.push(...telemetryErrors);
    return { pass, summary: pass ? `Bound review evidence is ${coverage.workflowCoverage}.` : "Bound review evidence does not support the requested evidence level.", details };
  }, externalEvidence);

  const requiresFindingDisposition = Boolean(acceptance.reviewArtifact) && specRequiresFindingDisposition(specTextForStatus);
  const terminalReviewConclusion = ["accepted", "release_ready"].includes(acceptance.status);
  const reviewDisposition = requiresFindingDisposition
    ? reviewDispositionCheck(workspace, reviewResult.artifact, { requireAllHigh: true })
    : { pass: true, details: [], result: null };
  const reviewDispositionStatus = !requiresFindingDisposition
    ? "skip"
    : reviewDisposition.pass ? "pass"
      : terminalReviewConclusion ? "fail" : "skip";
  addCheck(
    checks,
    "reviewDisposition",
    reviewDispositionStatus,
    requiresFindingDisposition && terminalReviewConclusion,
    !requiresFindingDisposition
      ? "Review disposition is not required by the referenced Spec."
      : reviewDisposition.pass
        ? "High/critical Review findings have usable local dispositions."
        : terminalReviewConclusion
          ? "Terminal acceptance cannot rely on unresolved high/critical Review findings."
          : "Review disposition remains pending and must be resolved before an accepted/release_ready conclusion.",
    reviewDisposition.details
  );

  const knowledgeResult = checkBoundArtifact(checks, workspace, acceptance, "knowledgeArtifact", "knowledgeEvidence", (artifact) => {
    const count = Array.isArray(artifact.entries) ? artifact.entries.length : 1;
    return { pass: count > 0, summary: count > 0 ? `Bound knowledge evidence contains ${count} item(s).` : "Bound knowledge evidence is empty." };
  }, false);

  const blocking = checks.filter((check) => check.required && check.status === "fail");
  const externalBlockers = acceptance.acceptanceItems
    .filter((item) => item.required === true && item.verificationStatus === "blocked")
    .map((item) => ({ item, state: externalBlockerState(item, acceptance.specRef, specTextForStatus) }))
    .filter(({ state }) => state.external)
    .map(({ item, state }) => ({
      id: item.id,
      name: item.name,
      allowedBySpec: state.allowed,
      executionStatus: item.blockerExecutionStatus,
      decision: state.decision,
      specRef: item.externalBlockerSpecRef,
      specAnchor: item.externalBlockerSpecAnchor,
      blockerImpact: item.blockerImpact,
      temporaryFallback: item.temporaryFallback,
      recoveryEntry: item.recoveryEntry
    }));
  const externalPending = externalBlockers.filter((item) => item.allowedBySpec && item.decision === "pending_pm");
  const releaseEligible = blocking.length === 0 && scope === "release" && acceptance.status === "release_ready";
  const readyReason = scope === "milestone"
    ? `RAVO milestone acceptance evidence is ready${externalPending.length ? ` with ${externalPending.length} Spec-allowed blocked_external item(s) awaiting PM degradation decision` : ""}; release status is unchanged.`
    : `RAVO release acceptance evidence is ready${externalPending.length ? ` with ${externalPending.length} Spec-allowed blocked_external item(s) awaiting PM degradation decision` : ""}.`;
  return {
    status: blocking.length ? "not_ready" : "ready",
    acceptanceScope: scope,
    acceptanceStatus: acceptance.status,
    releaseEligible,
    gate: {
      decision: blocking.length ? "block" : "pass",
      reason: blocking.length ? blocking.map((check) => check.summary).join(" ") : readyReason
    },
    externalBlockers,
    manifestPath,
    latestAcceptance,
    latestAnalysis: analysisResult.artifact ? analysisResult.file : "",
    latestWorkstream: workstreamResult.artifact ? workstreamResult.file : "",
    latestSmoke: smokeResult.artifact ? smokeResult.file : "",
    latestReview: reviewResult.artifact ? reviewResult.file : "",
    reviewDisposition: reviewDisposition.result,
    latestKnowledge: knowledgeResult.artifact ? knowledgeResult.file : "",
    checks
  };
}

function main() {
  validateCliArgs();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: check-ravo-acceptance.js [--acceptance-artifact <workspace-relative-path>]");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const result = buildResult(process.cwd(), { acceptanceArtifact: argValue("--acceptance-artifact", "") });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ready") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { acceptancePath, buildResult, formalReviewTelemetryErrors, resolveReviewDispositionModulePath, reviewDispositionCheck, resolveWorkspaceRef, validateCliArgs };
