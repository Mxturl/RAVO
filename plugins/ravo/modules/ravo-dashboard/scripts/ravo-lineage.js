#!/usr/bin/env node

const path = require("node:path");

const FORMAL_TIMEOUT_PROFILE = Object.freeze({ timeoutMs: 900000, firstEventTimeoutMs: 120000, firstContentTimeoutMs: 300000, idleTimeoutMs: 180000, stream: true });
const TIMEOUT_FIELDS = ["timeoutMs", "firstEventTimeoutMs", "firstContentTimeoutMs", "idleTimeoutMs"];
const PHASE_TIMING_FIELDS = ["requestStartedAt", "responseHeadersAt", "firstByteAt", "firstEventAt", "firstContentAt", "lastEventAt", "lastSubstantiveEventAt", "abortAt", "completedAt"];

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRef(value) {
  return typeof value === "string" ? value.trim().split(path.sep).join("/") : "";
}

function relativeArtifactPath(workspace, file) {
  if (!file) return "";
  const normalized = normalizeRef(file);
  if (!path.isAbsolute(file) || !workspace) return normalized;
  const relative = path.relative(workspace, file);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? normalized
    : normalizeRef(relative);
}

function valueOf(artifact, field) {
  return artifact?.[field] !== undefined ? artifact[field] : artifact?.details?.[field];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameProfile(left, right) {
  return isObject(left) && isObject(right) && TIMEOUT_FIELDS.every((field) => left[field] === right[field]) && left.stream === right.stream;
}

function formalReviewTelemetryEligible(artifact) {
  const callPlan = valueOf(artifact, "callPlan");
  if (!isObject(callPlan) || callPlan.runClass !== "formal" || callPlan.formalEvidenceEligible !== true) return false;
  const requested = callPlan.requestedTimeoutProfile;
  if (!isObject(requested) || TIMEOUT_FIELDS.some((field) => !Number.isInteger(requested[field]) || requested[field] < FORMAL_TIMEOUT_PROFILE[field]) || requested.stream !== true) return false;
  const pairs = Array.isArray(callPlan.requestedPairs) ? callPlan.requestedPairs : [];
  const profiles = Array.isArray(callPlan.timeoutProfiles) ? callPlan.timeoutProfiles : [];
  const byPair = new Map(profiles.filter(isObject).map((entry) => [entry.providerModelKey, entry]));
  if (!pairs.length || pairs.some((pair) => !byPair.has(pair))) return false;
  if (profiles.some((entry) => !sameProfile(entry.requested, requested) || !sameProfile(entry.effective, requested))) return false;
  if (!Number.isInteger(callPlan.maxAttempts) || !isObject(callPlan.retryPolicy) || !Number.isInteger(callPlan.maximumRequests) || !Number.isSafeInteger(callPlan.maximumRunMs)) return false;
  const attempts = valueOf(artifact, "attempts");
  const responded = valueOf(artifact, "modelsResponded");
  if (!Array.isArray(attempts) || (Array.isArray(responded) && responded.length > 0 && attempts.length === 0)) return false;
  return attempts.every((attempt) => {
    if (!isObject(attempt) || !byPair.has(attempt.providerModelKey)) return false;
    if (!sameProfile(attempt.requestedTimeoutProfile, byPair.get(attempt.providerModelKey).requested) || !sameProfile(attempt.effectiveTimeoutProfile, byPair.get(attempt.providerModelKey).effective)) return false;
    if (typeof attempt.timeoutType !== "string" || !isObject(attempt.phaseTiming) || PHASE_TIMING_FIELDS.some((field) => typeof attempt.phaseTiming[field] !== "string") || !attempt.phaseTiming.requestStartedAt) return false;
    if (["responseBytes", "partialBytes", "remainingAttemptBudget", "plannedDelayMs", "actualDelayMs"].some((field) => !Number.isInteger(attempt[field]) || attempt[field] < 0)) return false;
    if (typeof attempt.partialResponseRef !== "string" || (attempt.partialBytes > 0 && !attempt.partialResponseRef)) return false;
    if (!isObject(attempt.attemptBudget) || !isObject(attempt.retryParameterDelta) || typeof attempt.jitterPolicy !== "string" || !isObject(attempt.jitterRangeMs)) return false;
    if (typeof attempt.delayStartedAt !== "string" || typeof attempt.delayEndedAt !== "string") return false;
    return !attempt.timeoutType || Boolean(attempt.phaseTiming.abortAt);
  });
}

function formalReviewEvidenceEligible(review) {
  const artifact = review?.artifact && typeof review.artifact === "object" ? review.artifact : review || {};
  const schemaVersion = String(valueOf(artifact, "schemaVersion") || "");
  const runClass = String(valueOf(artifact, "runClass") || "");
  const eligible = valueOf(artifact, "formalEvidenceEligible");
  return schemaVersion === "0.5.1" && runClass === "formal" && eligible === true && formalReviewTelemetryEligible(artifact);
}

function normalizeCandidate(entry, workspace = "") {
  const artifact = entry?.artifact && typeof entry.artifact === "object" ? entry.artifact : entry || {};
  const artifactPath = relativeArtifactPath(workspace, entry?.file || entry?.relativePath || artifact.artifactPath || "");
  const sourceRefs = unique([
    ...(Array.isArray(valueOf(artifact, "sourceRefs")) ? valueOf(artifact, "sourceRefs") : []),
    ...(Array.isArray(valueOf(artifact, "evidenceRefs")) ? valueOf(artifact, "evidenceRefs") : [])
  ]).map(normalizeRef);
  return {
    entry,
    artifact,
    artifactPath,
    id: String(valueOf(artifact, "id") || (artifactPath ? path.basename(artifactPath, path.extname(artifactPath)) : "")),
    status: String(valueOf(artifact, "status") || "unknown"),
    subjectRef: normalizeRef(valueOf(artifact, "subjectRef")),
    releaseRef: normalizeRef(valueOf(artifact, "releaseRef")),
    specRef: normalizeRef(valueOf(artifact, "specRef")),
    workstreamArtifact: normalizeRef(valueOf(artifact, "workstreamArtifact")),
    reviewArtifact: normalizeRef(valueOf(artifact, "reviewArtifact")),
    reviewRunId: String(valueOf(artifact, "reviewRunId") || ""),
    relatedArtifact: normalizeRef(valueOf(artifact, "relatedArtifact")),
    acceptanceScope: String(valueOf(artifact, "acceptanceScope") || ""),
    milestoneRef: String(valueOf(artifact, "milestoneRef") || ""),
    supersedes: unique(valueOf(artifact, "supersedes")).map(normalizeRef),
    createdAt: String(valueOf(artifact, "createdAt") || ""),
    updatedAt: Math.max(
      parseTime(valueOf(artifact, "updatedAt")),
      parseTime(valueOf(artifact, "createdAt")),
      parseTime(entry?.updatedAt),
      parseTime(entry?.fileUpdatedAt)
    ),
    sourceRefs
  };
}

function supersededCandidates(candidates) {
  const superseded = new Set();
  for (const candidate of candidates) {
    for (const ref of candidate.supersedes || []) {
      const target = findReferenced(ref, candidates);
      if (target) superseded.add(target.artifactPath || target.id);
    }
  }
  return superseded;
}

function compareNewest(left, right) {
  return right.updatedAt - left.updatedAt
    || String(right.createdAt).localeCompare(String(left.createdAt))
    || String(right.id).localeCompare(String(left.id))
    || String(right.artifactPath).localeCompare(String(left.artifactPath));
}

function newest(candidates) {
  return [...candidates].sort(compareNewest)[0] || null;
}

function lineageKey(candidate) {
  if (!candidate) return "";
  if (candidate.releaseRef) return `release:${candidate.releaseRef}`;
  if (candidate.subjectRef) return `subject:${candidate.subjectRef}`;
  if (candidate.specRef) return `spec:${candidate.specRef}`;
  return "";
}

function matchesTarget(candidate, target = {}) {
  if (!candidate) return false;
  if (target.targetReleaseRef && candidate.releaseRef !== target.targetReleaseRef) return false;
  if (target.targetSubjectRef && candidate.subjectRef !== target.targetSubjectRef) return false;
  if (target.targetSpecRef && candidate.specRef !== target.targetSpecRef) return false;
  return Boolean(target.targetReleaseRef || target.targetSubjectRef || target.targetSpecRef) || Boolean(lineageKey(candidate));
}

function targetDefined(target) {
  return Boolean(target.targetReleaseRef || target.targetSubjectRef || target.targetSpecRef);
}

function findReferenced(ref, candidates) {
  const normalized = normalizeRef(ref);
  if (!normalized) return null;
  return candidates.find((candidate) => candidate.artifactPath === normalized || candidate.id === normalized) || null;
}

function releaseAcceptance(candidate) {
  if (!candidate) return false;
  if (candidate.acceptanceScope === "milestone" || candidate.milestoneRef) return false;
  if (candidate.acceptanceScope) return candidate.acceptanceScope === "release";
  return Boolean(candidate.releaseRef || candidate.specRef || candidate.workstreamArtifact);
}

function explicitWorkstreamRefs(acceptance, workstreams) {
  if (acceptance.workstreamArtifact) return [acceptance.workstreamArtifact];
  return acceptance.sourceRefs.filter((ref) => findReferenced(ref, workstreams));
}

function targetMatchesAcceptance(acceptance, target, workstreams) {
  if (!targetDefined(target)) return true;
  if (matchesTarget(acceptance, target)) return true;
  return explicitWorkstreamRefs(acceptance, workstreams)
    .map((ref) => findReferenced(ref, workstreams))
    .filter(Boolean)
    .some((workstream) => matchesTarget(workstream, target));
}

function blankSelection(relationStatus = "unknown", selectionReason = "") {
  return {
    artifactPath: "",
    lineageKey: "",
    selectionReason,
    supersededArtifacts: [],
    relationStatus,
    sourceRefs: []
  };
}

function selectWorkstream(workstreams, acceptances, target) {
  const superseded = supersededCandidates(workstreams);
  const activeWorkstreams = workstreams.filter((workstream) => !superseded.has(workstream.artifactPath || workstream.id));
  const scopedAcceptances = acceptances.filter(releaseAcceptance)
    .filter((acceptance) => targetMatchesAcceptance(acceptance, target, activeWorkstreams));
  const explicit = scopedAcceptances.map((acceptance) => {
    const refs = explicitWorkstreamRefs(acceptance, activeWorkstreams);
    const resolved = refs.map((ref) => findReferenced(ref, activeWorkstreams)).filter(Boolean);
    return { acceptance, refs, resolved: resolved.filter((workstream) => !targetDefined(target) || matchesTarget(workstream, target)) };
  }).filter((binding) => binding.refs.length > 0);
  const broken = explicit.filter((binding) => binding.resolved.length === 0);
  const valid = explicit.flatMap((binding) => binding.resolved.map((workstream) => ({ acceptance: binding.acceptance, workstream })));
  const distinctPaths = unique(valid.map((binding) => binding.workstream.artifactPath || binding.workstream.id));
  if (distinctPaths.length > 1) {
    return { workstream: null, acceptance: null, result: blankSelection("ambiguous", "conflicting_explicit_workstream_refs"), acceptanceRelation: "ambiguous" };
  }
  if (distinctPaths.length === 1) {
    const workstream = valid[0].workstream;
    const matchingBindings = valid.filter((binding) => binding.workstream === workstream);
    const acceptance = newest(matchingBindings.map((binding) => binding.acceptance));
    return {
      workstream,
      acceptance,
      result: {
        artifactPath: workstream.artifactPath,
        lineageKey: lineageKey(workstream),
        selectionReason: "acceptance_explicit_workstream_ref",
        supersededArtifacts: [],
        relationStatus: "matched",
        sourceRefs: unique([workstream.artifactPath, acceptance?.artifactPath])
      },
      acceptanceRelation: "matched"
    };
  }
  if (broken.length) {
    return { workstream: null, acceptance: null, result: blankSelection("unmatched", "broken_explicit_workstream_ref"), acceptanceRelation: "unmatched" };
  }

  const scopedWorkstreams = activeWorkstreams.filter((candidate) => !targetDefined(target) || matchesTarget(candidate, target));
  if (!scopedWorkstreams.length) {
    return { workstream: null, acceptance: null, result: blankSelection(workstreams.length ? "unmatched" : "unscoped", "no_target_workstream"), acceptanceRelation: "unmatched" };
  }
  const grouped = new Map();
  for (const candidate of scopedWorkstreams) {
    const key = lineageKey(candidate);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }
  if (grouped.size !== 1) {
    return { workstream: null, acceptance: null, result: blankSelection(grouped.size > 1 ? "ambiguous" : "unscoped", grouped.size > 1 ? "multiple_target_lineages" : "missing_lineage_key"), acceptanceRelation: grouped.size > 1 ? "ambiguous" : "unmatched" };
  }
  const [key, group] = [...grouped.entries()][0];
  const workstream = newest(group);
  return {
    workstream,
    acceptance: null,
    result: {
      artifactPath: workstream.artifactPath,
      lineageKey: key,
      selectionReason: "target_lineage_latest",
      supersededArtifacts: group.filter((candidate) => candidate !== workstream).sort(compareNewest).map((candidate) => candidate.artifactPath),
      relationStatus: "matched",
      sourceRefs: unique(group.map((candidate) => candidate.artifactPath))
    },
    acceptanceRelation: ""
  };
}

function selectAcceptance(acceptances, workstream, target, preselected, relationHint) {
  if (!workstream) return blankSelection(relationHint || "unmatched");
  const candidates = acceptances.filter(releaseAcceptance)
    .filter((acceptance) => targetMatchesAcceptance(acceptance, target, [workstream]));
  if (preselected) {
    return {
      artifactPath: preselected.artifactPath,
      selectionReason: "workstream_artifact_exact",
      relationStatus: "matched",
      sourceRefs: unique([preselected.artifactPath, workstream.artifactPath])
    };
  }
  const exactWorkstream = candidates.filter((acceptance) => explicitWorkstreamRefs(acceptance, [workstream])
    .some((ref) => Boolean(findReferenced(ref, [workstream]))));
  if (exactWorkstream.length) {
    const selected = newest(exactWorkstream);
    return { artifactPath: selected.artifactPath, selectionReason: "workstream_artifact_exact", relationStatus: "matched", sourceRefs: unique([selected.artifactPath, workstream.artifactPath]) };
  }
  if (workstream.releaseRef) {
    const exactRelease = candidates.filter((acceptance) => acceptance.releaseRef === workstream.releaseRef);
    if (exactRelease.length) {
      const selected = newest(exactRelease);
      return { artifactPath: selected.artifactPath, selectionReason: "release_ref_exact", relationStatus: "matched", sourceRefs: unique([selected.artifactPath, workstream.artifactPath]) };
    }
  }
  if (workstream.subjectRef) {
    const exactSubject = candidates.filter((acceptance) => acceptance.subjectRef === workstream.subjectRef);
    if (exactSubject.length) {
      const selected = newest(exactSubject);
      return { artifactPath: selected.artifactPath, selectionReason: "subject_ref_exact", relationStatus: "matched", sourceRefs: unique([selected.artifactPath, workstream.artifactPath]) };
    }
  }
  if (workstream.specRef) {
    const exactSpec = candidates.filter((acceptance) => acceptance.specRef === workstream.specRef
      && (!acceptance.releaseRef || !workstream.releaseRef || acceptance.releaseRef === workstream.releaseRef)
      && (!acceptance.subjectRef || !workstream.subjectRef || acceptance.subjectRef === workstream.subjectRef));
    if (exactSpec.length === 1) {
      return { artifactPath: exactSpec[0].artifactPath, selectionReason: "unique_spec_ref", relationStatus: "matched", sourceRefs: unique([exactSpec[0].artifactPath, workstream.artifactPath]) };
    }
    if (exactSpec.length > 1) return blankSelection("ambiguous", "multiple_spec_acceptances");
  }
  const acceptanceExpected = !["planned", "active"].includes(workstream.status);
  return blankSelection(
    acceptanceExpected && acceptances.length ? "unmatched" : "matched_no_artifact",
    acceptanceExpected && acceptances.length ? "no_related_acceptance" : "no_acceptance_artifact"
  );
}

function classifyReview(review) {
  if (!review) return "needed";
  const artifact = review?.artifact && typeof review.artifact === "object" ? review.artifact : review;
  if (!formalReviewEvidenceEligible(artifact)) return "unavailable";
  const usable = Array.isArray(valueOf(artifact, "modelsUsable")) ? valueOf(artifact, "modelsUsable") : [];
  const valid = typeof valueOf(artifact, "validResults") === "boolean" ? valueOf(artifact, "validResults") : usable.length > 0;
  const coverage = valueOf(artifact, "workflowCoverage") || valueOf(artifact, "coverage") || "";
  const parser = valueOf(artifact, "parserStatus") || "";
  if (coverage === "full" && parser === "pass" && valid && usable.length) return "current";
  if (["full", "partial"].includes(coverage) && valid) return "partial";
  return "unavailable";
}

function selectReleaseReview(reviews, acceptance, workstream) {
  if (acceptance?.reviewArtifact) {
    const exact = findReferenced(acceptance.reviewArtifact, reviews);
    if (!exact) return { ...blankSelection("unmatched", "broken_explicit_review_ref"), status: "needed" };
    return { artifactPath: exact.artifactPath, selectionReason: "acceptance_explicit_review_ref", relationStatus: "matched", status: classifyReview(exact), sourceRefs: unique([exact.artifactPath, acceptance.artifactPath]) };
  }
  if (!workstream) return { ...blankSelection("unscoped", "no_authoritative_workstream"), status: "not_applicable" };
  const related = reviews.filter((review) => (workstream.releaseRef && review.releaseRef === workstream.releaseRef)
    || (workstream.subjectRef && review.subjectRef === workstream.subjectRef));
  if (!related.length) return { ...blankSelection("unmatched", "no_release_review"), status: "not_applicable" };
  const selected = newest(related);
  return { artifactPath: selected.artifactPath, selectionReason: workstream.releaseRef && selected.releaseRef === workstream.releaseRef ? "release_ref_exact" : "subject_ref_exact", relationStatus: "matched", status: classifyReview(selected), sourceRefs: unique([selected.artifactPath, workstream.artifactPath]) };
}

function analysisReview(analysis, reviews) {
  if (valueOf(analysis.artifact, "reviewEvidence") === "blocked") {
    return { analysisArtifact: analysis.artifactPath, subjectRef: analysis.subjectRef, reviewArtifact: "", status: "unavailable", relationStatus: "blocked", selectionReason: "analysis_review_blocked" };
  }
  let review = analysis.reviewArtifact ? findReferenced(analysis.reviewArtifact, reviews) : null;
  let reason = review ? "analysis_explicit_review_ref" : "";
  if (!review && analysis.reviewRunId) {
    review = reviews.find((candidate) => candidate.reviewRunId === analysis.reviewRunId) || null;
    if (review) reason = "review_run_id_exact";
  }
  if (!review && analysis.subjectRef) {
    review = reviews.find((candidate) => candidate.subjectRef === analysis.subjectRef || candidate.sourceRefs.includes(analysis.subjectRef)) || null;
    if (review) reason = "analysis_subject_exact";
  }
  if (!review) return { analysisArtifact: analysis.artifactPath, subjectRef: analysis.subjectRef, reviewArtifact: "", status: "needed", relationStatus: "unmatched", selectionReason: "no_analysis_review" };
  const sourceChanged = !analysis.reviewArtifact && analysis.updatedAt > review.updatedAt + 1;
  return {
    analysisArtifact: analysis.artifactPath,
    subjectRef: analysis.subjectRef,
    reviewArtifact: review.artifactPath,
    status: sourceChanged ? "needed" : classifyReview(review),
    relationStatus: "matched",
    selectionReason: reason,
    sourceChanged
  };
}

function selectArtifactLineage(input = {}) {
  const workspace = input.workspace || "";
  const workstreams = (input.workstreams || []).map((entry) => normalizeCandidate(entry, workspace));
  const acceptances = (input.acceptances || []).map((entry) => normalizeCandidate(entry, workspace));
  const reviews = (input.reviews || []).map((entry) => normalizeCandidate(entry, workspace));
  const analyses = (input.analyses || []).map((entry) => normalizeCandidate(entry, workspace));
  const target = {
    targetSpecRef: normalizeRef(input.targetSpecRef),
    targetReleaseRef: normalizeRef(input.targetReleaseRef),
    targetSubjectRef: normalizeRef(input.targetSubjectRef)
  };
  const selectedWorkstream = selectWorkstream(workstreams, acceptances, target);
  const selectedAcceptance = selectAcceptance(acceptances, selectedWorkstream.workstream, target, selectedWorkstream.acceptance, selectedWorkstream.acceptanceRelation);
  const acceptanceCandidate = findReferenced(selectedAcceptance.artifactPath, acceptances);
  const releaseReview = selectReleaseReview(reviews, acceptanceCandidate, selectedWorkstream.workstream);
  const openAnalysisReviews = analyses
    .filter((analysis) => analysis.status === "complete" && (valueOf(analysis.artifact, "impactLevel") === "high" || valueOf(analysis.artifact, "reviewRequired") === true))
    .map((analysis) => analysisReview(analysis, reviews))
    .sort((left, right) => String(left.analysisArtifact).localeCompare(String(right.analysisArtifact)));
  const superseded = selectedWorkstream.workstream
    ? workstreams.filter((candidate) => candidate !== selectedWorkstream.workstream && (
      selectedWorkstream.result.selectionReason === "acceptance_explicit_workstream_ref"
        ? (!targetDefined(target) || matchesTarget(candidate, target))
        : lineageKey(candidate) === lineageKey(selectedWorkstream.workstream)
    )).sort(compareNewest).map((candidate) => candidate.artifactPath)
    : [];
  return {
    target,
    authoritativeWorkstream: {
      ...selectedWorkstream.result,
      supersededArtifacts: superseded,
      sourceRefs: unique([...selectedWorkstream.result.sourceRefs, ...superseded])
    },
    selectedAcceptance,
    releaseReview,
    openAnalysisReviews
  };
}

module.exports = {
  classifyReview,
  formalReviewEvidenceEligible,
  formalReviewTelemetryEligible,
  lineageKey,
  normalizeCandidate,
  selectArtifactLineage
};
