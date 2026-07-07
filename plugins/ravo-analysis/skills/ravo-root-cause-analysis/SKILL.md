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
- `Alternative Hypotheses`: at least one plausible competing explanation and why it is weaker or unverified.
- `Mechanism Root Cause`: the mechanism that explains recurrence.
- `Why Chain`: continue until the cause is actionable and verifiable.
- `Boundary`: why analysis stops here if the cause is external or uncontrollable.
- `Smallest Fix`: one root-level fix, not scattered symptom guards.
- `Verification`: the smallest check that would fail if the root cause returns.

For important work, or when a RAVO advisory triggered this skill, write an artifact:

```bash
node "$RAVO_ANALYSIS_PLUGIN_ROOT/scripts/write-analysis-artifact.js" --type root-cause --status complete --title "<short title>" --symptom "<symptom>" --proximate-cause "<near cause>" --mechanism-root-cause "<mechanism>" --alternative-hypothesis "<plausible alternative>" --why "<why step>" --conclusion "<derived conclusion>"
```

Set `RAVO_ANALYSIS_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume `plugins/ravo-analysis` exists in the user's workspace after installation.
Automatic hook-triggered placeholder artifacts stay `draft`; reusable artifacts should be written as `complete`.

## Rules

- Do not stop at symptoms.
- Do not skip the artifact for non-trivial root-cause analysis when `knowledge/` is available.
- Do not stop at "prompt issue", "user asked", "implementation mistake", or "missing check" unless that is the verified mechanism boundary.
- Test the leading root-cause hypothesis against at least one plausible alternative before locking the conclusion.
- If the first explanation is just a wording gap or a missing guard, continue asking why that gap existed until the recurrence mechanism is explained or the boundary is explicit.
- Grep callers before editing a shared bug path; fix once where all callers route through.
