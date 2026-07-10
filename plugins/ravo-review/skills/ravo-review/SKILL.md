---
name: ravo-review
description: Run or record RAVO adversarial review for requirements, architecture, technical design, tests, acceptance, security, auditability, Agent workflows, and long-running plans.
---

# RAVO Review

Use this skill when important work needs external or adversarial review.

## Workflow

1. Check data boundaries before sending anything to external models.
2. Run the live RAVO Review runner when provider config is available:

```bash
node "$RAVO_REVIEW_PLUGIN_ROOT/scripts/run-review.js" --domain architecture --subject "<proposal>"
```

The runner uses `rounds` from `~/.codex/skill-config/ravo-review.json`, defaults to `2`, and accepts only `1`, `2`, or `3`. Round 1 is independent review, Round 2 is challenge response, and Round 3 is convergence adjudication.

For bounded exploratory checks, pass one configured model:

```bash
node "$RAVO_REVIEW_PLUGIN_ROOT/scripts/run-review.js" --domain architecture --model "<model-id>" --rounds 1 --timeout-ms 60000 --subject "<proposal>" --no-stream
```

3. If providers are unavailable, still record `coverage=none` or a partial artifact so the missing evidence is visible:

```bash
node "$RAVO_REVIEW_PLUGIN_ROOT/scripts/write-review-artifact.js" --domain architecture --coverage partial --model-requested "<model>" --model-completed "<model>" --risk "<risk>" --recommendation "<recommendation>" --summary "<summary>"
```

Set `RAVO_REVIEW_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Do not send secrets, credentials, customer data, or confidential project facts externally without explicit authorization.
- Record full, partial, failure, timeout, and truncation states visibly.
- Record challenge brief, convergence brief, issue ledger, round input hashes, attempts, and retry/fallback states when multi-round review runs.
- Keep round coverage visible; top-level `coverage` represents the whole requested multi-round run.
- `partial_external_review` is not equivalent to `full_external_review`.
- Review is optional for routine tasks but recommended for high-impact plans, self-confirming E2E design, security-sensitive changes, and release claims.
- Provider config lives at `~/.codex/skill-config/ravo-review.json`; never print API keys.
- Store artifacts under `knowledge/.ravo/review/`.
