---
name: ravo-review
description: Run or record RAVO adversarial review for requirements, architecture, technical design, tests, acceptance, security, auditability, Agent workflows, and long-running plans.
---

# RAVO Review

Use this skill when important work needs external or adversarial review.

## Workflow

1. Check data boundaries before sending anything to external models.
2. Prefer the existing `ravo-review` or `model-review-council` capability when available for live multi-model review.
3. Record the result as a RAVO artifact:

```bash
node "$RAVO_REVIEW_PLUGIN_ROOT/scripts/write-review-artifact.js" --domain architecture --coverage partial --model-requested "<model>" --model-completed "<model>" --risk "<risk>" --recommendation "<recommendation>" --summary "<summary>"
```

Set `RAVO_REVIEW_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Do not send secrets, credentials, customer data, or confidential project facts externally without explicit authorization.
- Record full, partial, failure, timeout, and truncation states visibly.
- `partial_external_review` is not equivalent to `full_external_review`.
- Review is optional for routine tasks but recommended for high-impact plans, self-confirming E2E design, security-sensitive changes, and release claims.
- Store artifacts under `knowledge/.ravo/review/`.
