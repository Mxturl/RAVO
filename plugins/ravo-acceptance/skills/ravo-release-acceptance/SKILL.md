---
name: ravo-release-acceptance
description: Create or check RAVO acceptance evidence before Codex claims work is pending acceptance, accepted, release-ready, live, or ready for user acceptance. Use for delivery summaries, release conclusions, readiness checks, and evidence-matched status reporting.
---

# RAVO Release Acceptance

Use this skill proactively before giving a delivery-status conclusion. The agent must initiate acceptance checks before asking the user to accept work or before claiming `pending_acceptance`, `accepted`, `release_ready`, or `live`.

Prompt-time hooks are only a fallback advisory for direct user readiness prompts. They do not replace this agent-initiated delivery gate.

## Workflow

1. Inspect the change scope and existing evidence.
2. Reuse any upstream RAVO analysis artifact from `knowledge/.ravo/manifest.json`.
3. Write an acceptance artifact when there is enough evidence:

```bash
node "$RAVO_ACCEPTANCE_PLUGIN_ROOT/scripts/write-acceptance-artifact.js" --status pending_acceptance --evidence-level smoke --summary "<summary>"
```

4. Check the gate:

```bash
node "$RAVO_ACCEPTANCE_PLUGIN_ROOT/scripts/check-ravo-acceptance.js"
```

Set `RAVO_ACCEPTANCE_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume `plugins/ravo-acceptance` exists in the user's workspace after installation.

## Evidence Levels

- `none`: no evidence.
- `notes`: manual notes only.
- `script`: deterministic script check.
- `api`: representative API check.
- `smoke`: target-flow smoke check.
- `real_e2e`: real user or core business path verification.
- `full_external_review`: full external/adversarial review evidence.
- `partial_external_review`: partial external/adversarial review evidence.

## Security Baseline

Before `accepted` or `release_ready`, record security evidence with `--security-pass` for:

- `data_privacy`
- `credentials`
- `permissions`
- `destructive_actions`
- `external_calls`
- `dependencies`
- `logs_artifacts`
- `global_knowledge`

## Rules

- Do not say `accepted`, `release-ready`, or `live` unless evidence supports it.
- API tests, script passes, page smoke tests, and oral confirmation are not real E2E.
- Unknown security evidence is not a pass.
- `release_ready` requires `real_e2e` or `full_external_review` evidence plus security baseline.
- If evidence is incomplete, report `not_ready`, `in_progress`, or `code_complete` instead.
- Do not wait for the user to ask "can this be accepted?" when the current answer is a delivery or release conclusion.
