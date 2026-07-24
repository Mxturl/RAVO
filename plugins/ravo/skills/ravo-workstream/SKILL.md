---
name: ravo-workstream
description: Create or update RAVO workstream artifacts for long-running goals, milestones, blockers, decisions, next steps, and evidence references.
---

# RAVO Workstream

Use when a task is long-running, multi-phase, multi-agent, or needs milestone progress visibility.

## Workflow

Create or update a workstream artifact:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-workstream/scripts/write-workstream-artifact.js" --status active --goal "<goal>" --subject-ref "<stable goal/release id>" --spec-ref "<spec>" --current-milestone "<phase>" --next-step "<next step>" --evidence-ref "<path>"
```

For a rapid-delivery workstream, resolve and record the effective execution policy rather than describing a planned policy in prose:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-delivery-profile.js" --workspace <workspace> --task-class <task-class>
node "$RAVO_PLUGIN_ROOT/modules/ravo-workstream/scripts/write-workstream-artifact.js" \
  --status active \
  --goal "<goal>" \
  --current-milestone "<phase>" \
  --next-step "<next step>" \
  --effective-profile-json '<effectiveProfile JSON>' \
  --timing-json '<timing JSON>' \
  --capability-route-json '<route JSON>'
```

Use `advisory_only` when Runtime cannot enforce model or reasoning parameters. Do not report a suggested tier as applied.

For v0.5.1 execution governance, pass structured values rather than encoding them in prose:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-workstream/scripts/write-workstream-artifact.js" \
  --status active \
  --goal "<goal>" \
  --current-milestone "<milestone>" \
  --next-step "<next step>" \
  --blocker-json '<Blocker Ledger item JSON>' \
  --execution-lanes-json '<development/acceptance/recovery JSON>' \
  --execution-decision-json '<rule decision JSON>' \
  --authorization-envelope-json '<bounded authorization JSON>'
```

Before a repeated attempt or fast-track decision, use the controlled evaluator:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-workstream/scripts/ravo-execution-gate.js" --input <request.json>
```

For milestone closeout, add Roadmap Audit and worker evidence:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-workstream/scripts/write-workstream-artifact.js" --status active --goal "<goal>" --spec-ref "<spec>" --current-milestone "<phase>" --next-step "<next step>" --roadmap-audit "<what changed / what remains / blockers>" --worker-evidence '{"did":"...","changed":"...","learned":"...","evidence":"...","blockers":"...","next":"..."}'
```

At milestone closeout, run one Knowledge candidate check for stable reusable facts, then route unfinished work and blockers back to Workstream/Continuation. Skip the inventory when the milestone produced no durable candidate.

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Product Manager Communication

- Visible progress starts with the product outcome, current usability, user impact, PM action, and next step. Milestone ids, lanes, fingerprints, attempts, and ownership internals remain supporting evidence.
- Legacy configuration never changes the underlying facts or shortens the Agent record; the visible PM response may be organized naturally for the current question.
- A blocked engineering step stays owned by Codex or the recorded technical owner. Only an explicitly PM-owned product decision may set a PM action, and it must include a complete decision card.
- Do not turn local integration or local environment alignment inside the confirmed scope into a PM blocker.

## Rules

- Keep a non-empty `nextStep` for active long-running work.
- Record blockers with recovery conditions.
- Record decisions and evidence paths.
- Record `effectiveDeliveryProfile`, `timing`, and actual `capabilityRoutes` when a Delivery Profile is used. Unknown timing values stay `null`.
- After each milestone, record a Roadmap Audit: completed scope, remaining required items, blockers, risks, evidence gaps, spec delta, and whether to continue.
- Worker/subagent evidence must say what was done, what changed, what was learned, what evidence exists, what is blocked, dependency impact, and the next recommendation.
- New artifacts use `blockerLedger`, `executionLanes`, `executionDecisions`, and `authorizationEnvelopes`; legacy `blockers` and `recovery` are compatibility summaries only.
- Do not repeat an attempt with the same fingerprint or exceed the autonomous ceiling without a valid Authorization Envelope.
- Do not decide release readiness; hand evidence to `ravo-acceptance`.
