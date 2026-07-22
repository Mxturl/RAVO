---
name: ravo-quick-validation
description: Choose risk- and cost-proportional validation, and write RAVO Evidence only when retained traceability is useful or required. Use for lightweight checks, deterministic regression evidence, or complex/high-impact proof.
---

# RAVO Evidence

Use this skill to choose the smallest validation and evidence level that is sufficient for the actual risk. No case may skip the necessary check merely because a dedicated artifact would be expensive.

## Evidence Tiers

- `lightweight`: simple, local, reversible, low-risk work where collecting dedicated evidence would cost more time or tokens than its reuse value. Run at least one check directly tied to the result, then state what was checked. A RAVO Evidence artifact is optional.
- `traceable`: non-trivial changes, shared behavior, meaningful regression risk, or work that needs handoff. Run deterministic checks and retain a concise result through existing test output or a RAVO Evidence artifact.
- `required_evidence`: complex, cross-module, high-impact, data, security, permission, irreversible, real E2E, acceptance, or release work. Bind every required conclusion to explicit, traceable evidence and record gaps and recovery entries.

Use the higher tier when the case spans multiple levels. Do not upgrade merely because RAVO is present or downgrade merely to save tokens.

## Workflow

For `traceable` or `required_evidence` work that needs a retained smoke manifest:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-quick-validation/scripts/write-smoke-artifact.js" --scope "<scope>" --status pass --check "<check>" --evidence-ref "<path>"
```

Check the latest retained smoke manifest:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-quick-validation/scripts/check-smoke-artifact.js"
```

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Product Manager Communication

- Summarize what the validation proves, what it does not prove, its effect on actual usability, and what Codex will do next.
- For `lightweight` work, one short sentence naming the actual check is enough; do not create process language to explain why no artifact exists.
- Legacy configuration never changes this fixed PM projection or the complete validation artifact.
- A script or smoke pass is `validated`, not `locally_available`. Only real evidence from the actual local environment may claim local availability.
- Validation failures remain Codex work unless they expose a genuine product tradeoff. Do not delegate test repair to the PM.

## Rules

- No dedicated artifact does not mean no validation. A lightweight case without an actual result check is unverified.
- Smoke evidence is not final acceptance.
- `real-device-pending` is a risk marker, not a pass.
- Required smoke failures must block readiness.
- Complex, high-impact, data, security, permission, irreversible, acceptance, and release cases cannot use `lightweight` evidence.
- Lightweight evidence cannot support `accepted`, `release_ready`, `live`, or `released` status claims.
- User-facing language should say RAVO Evidence; `ravo-quick-validation` remains the compatibility entry name.
