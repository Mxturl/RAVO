#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const LEVELS = ["none", "patch", "minor", "major"];
const BUILD_STATUSES = new Set(["not_built", "verified", "unverified"]);
const RELEASE_STATUSES = new Set(["not_released", "planned", "released", "rolled_back"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseVersion(value) {
  const match = text(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function formatVersion(value) {
  return value ? `v${value.major}.${value.minor}.${value.patch}` : "";
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

function validLevel(value) {
  return LEVELS.includes(value);
}

function aggregateChangeLevel(values) {
  const levels = Array.isArray(values) ? values : [];
  if (!levels.length || levels.some((value) => !validLevel(value))) return "";
  return levels.reduce((highest, value) => LEVELS.indexOf(value) > LEVELS.indexOf(highest) ? value : highest, "none");
}

function nextVersion(baseVersion, level) {
  const base = parseVersion(baseVersion);
  if (!base || !validLevel(level)) return "";
  if (level === "major") return formatVersion({ major: base.major + 1, minor: 0, patch: 0 });
  if (level === "minor") return formatVersion({ major: base.major, minor: base.minor + 1, patch: 0 });
  if (level === "patch") return formatVersion({ major: base.major, minor: base.minor, patch: base.patch + 1 });
  return formatVersion(base);
}

function validatePolicy(policy) {
  const errors = [];
  const value = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : null;
  if (!value) return { valid: false, errors: ["Version policy must be a JSON object."] };
  if (text(value.schemaVersion) !== "1.0") errors.push("schemaVersion must be 1.0.");
  if (text(value.scheme) !== "product-semver") errors.push("scheme must be product-semver.");
  if (!parseVersion(value.effectiveAfter)) errors.push("effectiveAfter must be a semantic version.");
  if (Object.prototype.hasOwnProperty.call(value, "bootstrapVersion") && !parseVersion(value.bootstrapVersion)) errors.push("bootstrapVersion must be a semantic version when present.");
  if (typeof value.patchAutoAssign !== "boolean") errors.push("patchAutoAssign must be boolean.");
  if (text(value.versionAuthority?.major) !== "pm") errors.push("versionAuthority.major must be pm.");
  if (text(value.versionAuthority?.minor) !== "pm") errors.push("versionAuthority.minor must be pm.");
  if (text(value.versionAuthority?.patch) !== "pm_or_preapproved") errors.push("versionAuthority.patch must be pm_or_preapproved.");
  if (text(value.buildNumberPolicy) !== "project_defined_monotonic") errors.push("buildNumberPolicy must be project_defined_monotonic.");
  return { valid: errors.length === 0, errors };
}

function readVersionPolicy(workspace, policyRef = "ravo-version-policy.json") {
  const file = path.resolve(workspace, policyRef);
  if (!file.startsWith(`${path.resolve(workspace)}${path.sep}`) || !fs.existsSync(file)) {
    return { status: "version_policy_missing", policy: null, policyPath: file, errors: ["Project version policy is missing."] };
  }
  try {
    const policy = JSON.parse(fs.readFileSync(file, "utf8"));
    const validation = validatePolicy(policy);
    return validation.valid
      ? { status: "ok", policy, policyPath: file, errors: [] }
      : { status: "version_policy_missing", policy, policyPath: file, errors: validation.errors };
  } catch (error) {
    return { status: "version_policy_missing", policy: null, policyPath: file, errors: [error.message] };
  }
}

function recommendation(assessment, policy = {}) {
  const level = text(assessment?.changeLevel);
  const baseVersion = text(assessment?.baseVersion);
  const highestInputLevel = aggregateChangeLevel(assessment?.inputLevels || [level]);
  const recommendedVersion = nextVersion(baseVersion, highestInputLevel);
  const requiresPmConfirmation = ["major", "minor"].includes(highestInputLevel)
    || (highestInputLevel === "patch" && policy.patchAutoAssign !== true);
  const anomalies = !recommendedVersion || !highestInputLevel ? ["version_classification_pending"] : [];
  return {
    recommendedLevel: highestInputLevel || "none",
    recommendedVersion,
    reason: text(assessment?.rationale),
    requiresPmConfirmation,
    anomalies,
    highestInputLevel: highestInputLevel || "none",
    notCovered: Array.isArray(assessment?.notCovered) ? assessment.notCovered : []
  };
}

function itemVersions(item) {
  return [
    text(item?.committedVersion),
    text(item?.actualReleaseVersion),
    text(item?.versionBuildEvidence?.productVersion),
    ...(Array.isArray(item?.externalBuildVersions) ? item.externalBuildVersions.map(text) : []),
    ...(Array.isArray(item?.candidateVersions) ? item.candidateVersions.map(text) : [])
  ].filter(Boolean);
}

function occupiedVersions(entries, releaseSlice) {
  const occupied = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const sameSlice = text(entry?.releaseSlice) === text(releaseSlice);
    for (const version of itemVersions(entry)) {
      if (!sameSlice || text(entry?.actualReleaseVersion) === version) occupied.push({ version, entry });
    }
  }
  return occupied;
}

function versionAnomalies({ baseVersion, level, committedVersion, entries = [], releaseSlice = "", override = false }) {
  const anomalies = [];
  const base = parseVersion(baseVersion);
  const target = parseVersion(committedVersion);
  const expected = nextVersion(baseVersion, level);
  if (!base || !target || !validLevel(level)) return ["version_classification_pending"];
  if (compareVersions(committedVersion, baseVersion) <= 0 && level !== "none") anomalies.push("target_not_higher_than_base");
  if (level === "major" && (target.minor !== 0 || target.patch !== 0)) anomalies.push("major_low_components_not_reset");
  if (level === "minor" && target.patch !== 0) anomalies.push("minor_patch_not_reset");
  if (!override && expected !== committedVersion) anomalies.push("unexpected_version_level");
  const expectedValue = parseVersion(expected);
  if (expectedValue && (target.major > expectedValue.major || (target.major === expectedValue.major && target.minor > expectedValue.minor))) {
    anomalies.push("unexplained_version_skip");
  }
  if (occupiedVersions(entries, releaseSlice).some((entry) => entry.version === committedVersion)) anomalies.push("version_conflict");
  return [...new Set(anomalies)];
}

function pmDecision(item) {
  return text(item?.versionDecisionOwner) === "pm" && text(item?.versionDecisionReason) && text(item?.versionDecisionAt);
}

function preapprovedPatch(item) {
  return ["policy", "preapproved"].includes(text(item?.versionDecisionOwner)) && text(item?.versionDecisionReason);
}

function validOverride(items) {
  return (items || []).some((item) => pmDecision(item) && text(item.versionOverrideReason));
}

function versionLockStatus(input = {}) {
  const policyValidation = validatePolicy(input.policy);
  if (!policyValidation.valid) return { status: "version_policy_missing", errors: policyValidation.errors };
  const items = (Array.isArray(input.items) ? input.items : []).filter((item) => item?.scopeClass !== "candidate" && item?.scopeClass !== "deferred");
  if (!items.length) return { status: "version_classification_pending", errors: ["No must-ship versioned item is available."] };
  const levels = items.map((item) => text(item.changeLevel));
  const highestLevel = aggregateChangeLevel(levels);
  if (!highestLevel) return { status: "version_classification_pending", errors: ["Every must-ship item needs changeLevel."] };
  const baseVersions = [...new Set(items.map((item) => text(item.baseVersion)).filter(Boolean))];
  if (baseVersions.length !== 1 || !parseVersion(baseVersions[0])) return { status: "base_version_unknown", errors: ["Must-ship items need one valid baseVersion."] };
  const committedVersions = [...new Set(items.map((item) => text(item.committedVersion)).filter(Boolean))];
  if (committedVersions.length !== 1) return { status: "version_classification_pending", errors: ["Must-ship items need one committedVersion."] };
  const releaseSlices = [...new Set(items.map((item) => text(item.releaseSlice)).filter(Boolean))];
  if (releaseSlices.length !== 1 || (input.releaseSlice && releaseSlices[0] !== input.releaseSlice)) {
    return { status: "version_classification_pending", errors: ["Must-ship items need one matching releaseSlice."] };
  }
  const override = validOverride(items);
  const anomalies = versionAnomalies({
    baseVersion: baseVersions[0],
    level: highestLevel,
    committedVersion: committedVersions[0],
    entries: input.entries || [],
    releaseSlice: releaseSlices[0],
    override
  });
  if (anomalies.includes("version_conflict")) return { status: "version_conflict", highestLevel, anomalies, errors: ["Target version is already occupied."] };
  if (anomalies.length) return { status: "version_anomaly", highestLevel, anomalies, errors: ["Target version does not match the allowed progression."] };
  const requiresPm = ["major", "minor"].includes(highestLevel) || (highestLevel === "patch" && input.policy.patchAutoAssign !== true);
  const decisionsReady = requiresPm ? items.every(pmDecision) : items.every(preapprovedPatch);
  if (!decisionsReady) return { status: "version_classification_pending", highestLevel, errors: ["Version decision authority is missing."] };
  if (items.some((item) => !text(item.gitBaseline) || !text(item.predecessorBaselineRef) || text(item.predecessorVersion) !== baseVersions[0])) {
    return { status: "base_dependency_pending", highestLevel, errors: ["Predecessor baseline metadata is incomplete."] };
  }
  return {
    status: "version_locked",
    highestLevel,
    baseVersion: baseVersions[0],
    committedVersion: committedVersions[0],
    releaseSlice: releaseSlices[0],
    override,
    anomalies: []
  };
}

function predecessorBaselineStatus(workspace, ref) {
  const commit = text(ref).replace(/^git-commit:/, "");
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) return { status: "base_dependency_pending", error: "predecessorBaselineRef is missing or invalid." };
  const result = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: workspace, encoding: "utf8", timeout: 30000 });
  if (result.status === 0) return { status: "current", predecessorBaselineRef: `git-commit:${commit}` };
  return { status: "base_dependency_pending", error: "Current Worktree does not contain the required predecessor baseline.", predecessorBaselineRef: `git-commit:${commit}` };
}

function scopeExpansionStatus(lockedLevel, items) {
  const highest = aggregateChangeLevel((items || []).map((item) => text(item.changeLevel)));
  if (!highest || !validLevel(lockedLevel)) return { status: "version_classification_pending", highestLevel: highest || "none" };
  return LEVELS.indexOf(highest) > LEVELS.indexOf(lockedLevel)
    ? { status: "stale", highestLevel: highest }
    : { status: "current", highestLevel: highest };
}

function parallelDependencyStatus({ releasedPatchVersion, dependencyIds = [] } = {}) {
  if (!parseVersion(releasedPatchVersion)) return { status: "current" };
  const included = dependencyIds.some((value) => String(value).includes(releasedPatchVersion));
  return included
    ? { status: "current" }
    : { status: "release_dependency_pending", recoveryEntry: `Record the dependency that includes ${releasedPatchVersion}, then merge and reverify.` };
}

function nextPatchAfterRollback(releasedVersion) {
  return nextVersion(releasedVersion, "patch");
}

function number(value) {
  return text(String(value)) !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function validateVersionBuildEvidence(input = {}) {
  const evidence = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const targetProductVersion = text(evidence.targetProductVersion || evidence.productVersion);
  const verificationStatus = text(evidence.verificationStatus || "not_built");
  const errors = [];
  if (!parseVersion(targetProductVersion)) errors.push("targetProductVersion must be a semantic version.");
  if (!BUILD_STATUSES.has(verificationStatus)) errors.push("verificationStatus is invalid.");
  if (verificationStatus === "not_built") {
    if (text(evidence.productVersion) || text(evidence.buildNumber) || text(evidence.observedVersion) || text(evidence.observedBuildNumber)) {
      errors.push("not_built evidence cannot claim an actual product version or build number.");
    }
    return { status: errors.length ? "build_version_unverified" : "not_built", errors, evidence: { ...evidence, targetProductVersion, verificationStatus } };
  }
  const buildNumber = number(evidence.buildNumber);
  const observedBuildNumber = number(evidence.observedBuildNumber);
  if (!parseVersion(evidence.productVersion)) errors.push("productVersion must be a semantic version after a build.");
  if (buildNumber === null) errors.push("buildNumber must be a non-negative integer.");
  if (text(evidence.releaseChannel) === "") errors.push("releaseChannel is required after a build.");
  if (text(evidence.artifactRef) === "") errors.push("artifactRef is required after a build.");
  if (text(evidence.verificationCommandRef) === "") errors.push("verificationCommandRef is required after a build.");
  if (text(evidence.observedVersion) !== text(evidence.productVersion)) errors.push("observedVersion must equal productVersion.");
  if (observedBuildNumber === null || observedBuildNumber !== buildNumber) errors.push("observedBuildNumber must equal buildNumber.");
  if (!text(evidence.createdAt)) errors.push("createdAt is required after a build.");
  if (!Array.isArray(evidence.sourceRefs) || !evidence.sourceRefs.length) errors.push("sourceRefs are required after a build.");
  const previous = (Array.isArray(evidence.previousBuildNumbers) ? evidence.previousBuildNumbers : []).map(number).filter((value) => value !== null);
  if (buildNumber !== null && previous.some((value) => value >= buildNumber)) errors.push("buildNumber must be greater than every recorded build number.");
  return {
    status: errors.length || verificationStatus !== "verified" ? "build_version_unverified" : "verified",
    errors,
    evidence: { ...evidence, targetProductVersion, verificationStatus, buildNumber, observedBuildNumber }
  };
}

function validateReleaseRecord(input = {}) {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const status = text(record.releaseStatus || "not_released");
  const errors = [];
  if (!RELEASE_STATUSES.has(status)) errors.push("releaseStatus is invalid.");
  const actualFields = [text(record.actualReleaseVersion), text(record.releaseChannel), text(record.actualReleaseAt)];
  if (["released", "rolled_back"].includes(status)) {
    if (!parseVersion(record.actualReleaseVersion)) errors.push(`${status} requires actualReleaseVersion.`);
    if (!text(record.releaseChannel)) errors.push(`${status} requires releaseChannel.`);
    if (!Number.isFinite(Date.parse(text(record.actualReleaseAt)))) errors.push(`${status} requires actualReleaseAt.`);
    if (!text(record.releaseUrl) && !(Array.isArray(record.sourceRefs) && record.sourceRefs.some((value) => text(value)))) {
      errors.push(`${status} requires a releaseUrl or sourceRefs for real channel evidence.`);
    }
  } else if (actualFields.some(Boolean)) {
    errors.push("not_released/planned cannot record an actual release version, channel, or time.");
  }
  return { valid: errors.length === 0, errors, record: { ...record, releaseStatus: status } };
}

function versionGovernanceGate(workspace, input = {}) {
  const version = text(input.version);
  const policyResult = readVersionPolicy(workspace, input.policyRef);
  const policy = policyResult.policy;
  const applies = policy && ((compareVersions(version, policy.effectiveAfter) ?? -1) >= 0 || version === text(policy.bootstrapVersion));
  const governanceStartsAt = "v0.5.12";
  if (!applies) return policyResult.status === "version_policy_missing" && (compareVersions(version, governanceStartsAt) ?? -1) >= 0
    ? { applicable: true, status: "version_policy_missing", errors: policyResult.errors }
    : { applicable: false, status: "current", errors: [] };
  const requiredIds = new Set(input.requirementIds || []);
  const items = (input.entries || []).filter((entry) => entry?.releaseSlice === input.releaseSlice && (entry?.legacyIds || []).some((id) => requiredIds.has(id)));
  const lockedLevel = aggregateChangeLevel(items.map((item) => text(item.lockedChangeLevel)).filter(Boolean));
  const scope = lockedLevel ? scopeExpansionStatus(lockedLevel, items) : { status: "current", highestLevel: "none" };
  if (scope.status !== "current") return { applicable: true, ...scope };
  const lock = versionLockStatus({ policy, items, releaseSlice: input.releaseSlice, entries: input.entries });
  if (lock.status !== "version_locked") return { applicable: true, ...lock };
  const baseline = predecessorBaselineStatus(workspace, items[0].predecessorBaselineRef);
  if (baseline.status !== "current") return { applicable: true, ...baseline, lock };
  return { applicable: true, status: "current", lock, baseline, scope: lockedLevel ? scope : scopeExpansionStatus(lock.highestLevel, items) };
}

module.exports = {
  LEVELS,
  aggregateChangeLevel,
  compareVersions,
  nextPatchAfterRollback,
  nextVersion,
  parallelDependencyStatus,
  parseVersion,
  predecessorBaselineStatus,
  recommendation,
  scopeExpansionStatus,
  validatePolicy,
  validateReleaseRecord,
  validateVersionBuildEvidence,
  versionAnomalies,
  versionGovernanceGate,
  versionLockStatus
};
