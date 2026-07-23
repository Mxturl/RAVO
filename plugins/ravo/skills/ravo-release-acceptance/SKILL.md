---
name: ravo-release-acceptance
description: Create or check RAVO acceptance evidence before Codex claims work is pending acceptance, accepted, release-ready, live, or ready for user acceptance. Use for non-trivial delivery summaries and readiness claims; do not invoke it just because a simple low-risk task ended.
---

# RAVO Release Acceptance

Use this skill proactively before giving a delivery-status conclusion. The agent must initiate acceptance checks before asking the user to accept work or before claiming `pending_acceptance`, `accepted`, `release_ready`, or `live`.

A simple, local, reversible, low-risk task may close with its actual direct check and no Acceptance artifact when no acceptance, readiness, go-live, or release conclusion is being made. This exception reduces evidence collection, not validation. Complex, cross-module, high-impact, data, security, permission, irreversible, real E2E, acceptance, and release work still requires explicit traceable evidence.

The Stop hook can request one correction when status language exceeds evidence. It does not replace this agent-initiated delivery gate or prove acceptance.

## Workflow

1. Inspect the change scope and classify whether Acceptance is actually needed. If the task is a lightweight case with no high-order status claim, return to direct completion after naming the actual check.
2. Reuse any upstream RAVO analysis artifact from `knowledge/.ravo/manifest.json`.
3. For a v0.5.5 Slice, capture and finalize the local Git baseline before creating the acceptance package. Use `prepare-acceptance-baseline.js --start` at Goal start and `--finalize` before acceptance. Stage only explicitly task-owned changes; `mixed_or_unknown` or `commit_blocked` must remain visible and must not be silently cleaned.
4. If the Slice changes RAVO plugins, Hooks, manifests, CLI, upgrade scripts, or Runtime behavior, run Runtime Delivery Preflight before any Fresh Session. Safe reversible local alignment continues under the default local delivery policy; only an explicitly marked exception returns an authorization decision. Do not start Fresh Session before alignment.
5. Classify every required item on two independent axes: `fulfillmentStatus` and `verificationStatus`. Every non-verified required item needs an executable `verificationTask`; do not use `基本满足` as a final state.
6. Write an acceptance artifact when there is enough evidence. This also creates a PM-facing acceptance document that must be sent or summarized in the final chat:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-dashboard/scripts/ravo-runtime-delivery.js" --workspace <workspace> --changed-path <runtime-owned-path>
```

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-acceptance/scripts/write-acceptance-artifact.js" --status pending_acceptance --evidence-level smoke --summary "<summary>" --subject-ref "<stable subject id>" --baseline-ref "<git-commit-or-tree>" --git-baseline-artifact "<git baseline artifact>" --source-ref "<spec or release ref>" --real-response-ref "<response or path>" --screenshot-ref "<screenshot path>" --data-evidence-ref "<artifact path>" --acceptance-item '<v0.5.1 acceptance item JSON>'
```

5. Check the gate:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-acceptance/scripts/check-ravo-acceptance.js"
```

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume the RAVO source repository exists in the user's workspace after installation.

## Product Manager Communication

- The PM document starts with the authoritative `pmBrief`: current product state, user impact, whether PM action is needed, and the next step.
- PM projection is fixed regardless of legacy configuration: keep no-action documents to 5-8 visible lines and PM experience to at most three steps; retain full evidence only in the Agent artifact.
- Only product experience or business judgment belongs in the PM decision card. Keep all remaining Codex-verifiable work in the Codex section.
- Every PM decision card asks one question, recommends an option, explains each option's result, and states the impact of waiting.
- Never use implementation complete, script pass, or environment aligned as a synonym for PM accepted, release ready, or released.
- Do not turn the absence of a lightweight Artifact into a PM action or a new workflow step.

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
- Lightweight direct checks may support a bounded simple-task completion statement, but cannot support `pending_acceptance`, `accepted`, `release_ready`, `live`, or `released`.
- A top-level status cannot exceed the weakest required acceptance item. `not_met`, `partial`, `pending_codex`, `blocked`, and `pending_classification` must mechanically lower the status ceiling.
- Keep `pending_codex` work in the Codex verification section. Only `pending_pm` tasks belong in the PM checklist.
- Blocked items must state `blockingReason`, `blockerImpact`, `temporaryFallback`, and `recoveryEntry` separately.
- API tests, script passes, page smoke tests, and oral confirmation are not real E2E.
- Unknown security evidence is not a pass.
- `release_ready` requires `real_e2e` or `full_external_review` evidence plus security baseline.
- If evidence is incomplete, report `not_ready`, `in_progress`, or `code_complete` instead.
- Do not wait for the user to ask "can this be accepted?" when the current answer is a delivery or release conclusion.
- For `pending_acceptance`, `accepted`, or `release_ready`, include the PM acceptance document path and core checklist in the final user-visible reply. Script passes alone are not PM acceptance.
- Acceptance-facing artifacts require a real response reference and screenshot/recording evidence, or an explicit alternative-evidence reason when no UI exists.
- For a v0.5.5 `accepted` or `release_ready` artifact, provide `--pm-decision-json` with an explicit, scope-bound PM acceptance sentence and `conversation:<thread>#<turn>` source; `确认`/`同意`/`可以` alone is invalid.
