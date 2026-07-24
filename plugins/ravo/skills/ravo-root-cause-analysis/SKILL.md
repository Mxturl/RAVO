---
name: ravo-root-cause-analysis
description: Find and fix the actual cause of a bug or failure at the lightest justified depth, and visibly capture unresolved or out-of-scope follow-up issues. Use minimal RCA for deterministic local issues and full mechanism-level RCA for recurring, uncertain, shared, high-impact, data, security, or permission failures.
---

# RAVO Root-Cause Analysis

Use this skill when a bug or failure needs an actual-cause conclusion. Keep a simple problem simple while still fixing the shared root point.

## Required Outcomes

Choose the full path if any of these is true: recurrence, unknown cause, multiple plausible hypotheses, shared mechanism, high impact, data, security, or permissions. The full path takes precedence when criteria overlap. Otherwise use minimal RCA for a stable reproduction with a known, local, low-impact cause and no recurrence history.

Minimal RCA requires only the symptom, actual cause, smallest root-level fix, and one runnable regression check. It does not require a Why chain, alternative hypotheses, an Artifact, or Review.

If a one-off local problem is fixed in scope and has no recurrence or follow-up value, keep only the regression check and do not force an Issue Pool ceremony. If the issue remains unresolved, is outside the current scope, recurs, blocks an external dependency, or has future value, form the observation, user impact, evidence or reproduction, current boundary, and workaround or next step, then capture a confirmed Issue candidate with `capture-pool-item.js --kind issue`. Continue safe in-scope work after capture.

Full RCA requires symptom, proximate cause, mechanism root cause, plausible alternatives, recurrence mechanism, root-level fix, prevention validation, and residual risk. Use a concise natural conclusion unless the user or the impact needs a full report. For PM audiences, lead with user impact, safe current use, next action, and whether a decision is required.

When RCA confirms a stable reusable fact with sufficient evidence and a clear applicability boundary, run one Knowledge candidate check immediately. Do not wait for the whole delivery to finish, and do not turn a one-off fix into Knowledge.

Persist an RCA only for a downstream Alignment, Spec, or decision, cross-task reuse, `governed_change`, a direct recording request, or an explicit Spec requirement. Use `$RAVO_PLUGIN_ROOT/modules/ravo-analysis/scripts/write-analysis-artifact.js` only then.

## Boundaries

- Test a plausible alternative only when it could change the fix; a minimal deterministic case needs one regression check instead.
- Inspect callers before changing a shared path and fix the common mechanism once.
- Use RAVO Review only when actual impact reaches its existing trigger; labels alone do not prove high impact.
- A diagnosis does not prove the fix is implemented, validated, locally available, accepted, or released.
