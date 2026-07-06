---
name: ravo-root-cause-analysis
description: Perform mechanism-level root-cause analysis for bugs, failures, regressions, shallow diagnoses, repeated mistakes, and process breakdowns. Use when Codex must distinguish symptoms, proximate causes, mechanism root cause, recurrence risk, and the smallest verifiable fix.
---

# RAVO Root-Cause Analysis

Use this skill when a symptom report could hide a deeper mechanism.

## Output Contract

Include:

- `Symptom`: the observed failure.
- `Proximate Cause`: the nearest technical or process cause.
- `Mechanism Root Cause`: the mechanism that explains recurrence.
- `Why Chain`: continue until the cause is actionable and verifiable.
- `Boundary`: why analysis stops here if the cause is external or uncontrollable.
- `Smallest Fix`: one root-level fix, not scattered symptom guards.
- `Verification`: the smallest check that would fail if the root cause returns.

For important work, write an artifact:

```bash
node plugins/ravo-analysis/scripts/write-analysis-artifact.js --type root-cause --title "<short title>" --symptom "<symptom>" --proximate-cause "<near cause>" --mechanism-root-cause "<mechanism>" --conclusion "<derived conclusion>"
```

## Rules

- Do not stop at symptoms.
- Do not stop at "prompt issue", "user asked", "implementation mistake", or "missing check" unless that is the verified mechanism boundary.
- Grep callers before editing a shared bug path; fix once where all callers route through.
