---
name: ravo-release-acceptance
description: Create or check RAVO acceptance evidence before Codex claims work is pending acceptance, accepted, release-ready, live, or ready for user acceptance. Use for delivery summaries, release conclusions, readiness checks, and evidence-matched status reporting.
---

# RAVO Release Acceptance

Use this skill before giving a delivery-status conclusion.

## Workflow

1. Inspect the change scope and existing evidence.
2. Reuse any upstream RAVO analysis artifact from `knowledge/.ravo/manifest.json`.
3. Write an acceptance artifact when there is enough evidence:

```bash
node plugins/ravo-acceptance/scripts/write-acceptance-artifact.js --status pending_acceptance --evidence-level smoke --summary "<summary>"
```

4. Check the gate:

```bash
node plugins/ravo-acceptance/scripts/check-ravo-acceptance.js
```

## Evidence Levels

- `none`: no evidence.
- `notes`: manual notes only.
- `script`: deterministic script check.
- `api`: representative API check.
- `smoke`: target-flow smoke check.
- `real_e2e`: real user or core business path verification.

## Rules

- Do not say `accepted`, `release-ready`, or `live` unless evidence supports it.
- API tests, script passes, page smoke tests, and oral confirmation are not real E2E.
- If evidence is incomplete, report `not_ready`, `in_progress`, or `code_complete` instead.
