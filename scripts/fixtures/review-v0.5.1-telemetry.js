"use strict";

const PROFILE = Object.freeze({
  timeoutMs: 900000,
  firstEventTimeoutMs: 120000,
  firstContentTimeoutMs: 300000,
  idleTimeoutMs: 180000,
  stream: true
});

function formalReviewTelemetry(providerModelKey = "provider/model") {
  const startedAt = "2026-01-04T00:00:00.000Z";
  const endedAt = "2026-01-04T00:00:01.000Z";
  return {
    schemaVersion: "0.5.1",
    runClass: "formal",
    formalEvidenceEligible: true,
    diagnosticExecutionCoverage: "not_applicable",
    modelsRequested: [providerModelKey],
    modelsResponded: [providerModelKey],
    callPlan: {
      requestedPairs: [providerModelKey],
      runClass: "formal",
      formalEvidenceEligible: true,
      formalTimeoutProfile: { ...PROFILE },
      requestedTimeoutProfile: { ...PROFILE },
      timeoutProfiles: [{ providerModelKey, requested: { ...PROFILE }, effective: { ...PROFILE } }],
      maxAttempts: 2,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 8000, retryableStatusCodes: [429, 502, 503, 504] },
      maximumRequests: 2,
      maximumRunMs: 1801000
    },
    attempts: [{
      reviewRunId: "review-fixture",
      providerModelKey,
      round: 1,
      attempt: 1,
      attemptType: "initial",
      reason: "usable_response",
      timeoutMs: PROFILE.timeoutMs,
      startedAt,
      endedAt,
      result: "usable",
      timeoutType: "",
      phaseTiming: {
        requestStartedAt: startedAt,
        responseHeadersAt: startedAt,
        firstByteAt: startedAt,
        firstEventAt: startedAt,
        firstContentAt: startedAt,
        lastEventAt: endedAt,
        lastSubstantiveEventAt: endedAt,
        abortAt: "",
        completedAt: endedAt
      },
      responseBytes: 256,
      partialResponseRef: "",
      partialBytes: 0,
      requestedTimeoutProfile: { ...PROFILE },
      effectiveTimeoutProfile: { ...PROFILE },
      remainingAttemptBudget: 1,
      attemptBudget: { maxAttempts: 2, attemptNumber: 1, remainingAfterAttempt: 1 },
      retryParameterDelta: {},
      jitterPolicy: "none",
      jitterRangeMs: { min: 0, max: 0 },
      plannedDelayMs: 0,
      actualDelayMs: 0,
      delayStartedAt: "",
      delayEndedAt: ""
    }]
  };
}

module.exports = { FORMAL_TIMEOUT_PROFILE: PROFILE, formalReviewTelemetry };
