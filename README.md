<div align="center">

# RAVO

### A lightweight collaboration framework for product managers and Codex

English | [中文](README_ZH.md)

</div>

Current development version: `v0.6.2`. A version number does not imply acceptance, release readiness, or publication.

## What RAVO Is

RAVO helps product managers and Codex reach correct, trustworthy, and correctable outcomes faster. It applies systematic thinking to requirements, root causes, important proposals, and delivery evidence without governing every Codex action or forcing a full workflow onto simple work.

One `ravo@ravo` plugin installs nine on-demand Skills. `AGENTS.md` provides scenario recall and hard boundaries; each Skill and Codex can adapt the method to the task. Data, credentials, permissions, external calls, irreversible actions, release authorization, and truthful status remain hard boundaries.

## How To Use It

Use Codex normally. You do not need to choose a workflow or remember module names. Clear small tasks, factual questions, read-only checks, and low-risk local work should be handled directly; RAVO stays quiet when it is not useful.

For a clear task that needs several turns or reliable steps, Codex may use the host's existing Goal capability when it is available and authorized. You do not need to type a special Goal prompt. “Continue” reuses an active Goal; it does not recreate a completed, terminally blocked, or parked Goal unless you introduce a new independent objective. If Goal capability is unavailable, Codex continues normally instead of blocking the work.

For an important or ambiguous requirement, ask Codex to shape it systematically. RAVO covers the consumer, scenario, pain, goal, boundary, success criteria, non-goals, constraints, and risks, while separating confirmed facts, reasonable assumptions, and open product decisions. Only decisions that change direction, scope, or success criteria should interrupt the PM.

When the conversation forms an explicit new requirement, out-of-scope issue, or reusable lesson, Codex performs the minimum analysis and visibly says whether it was recorded, merged, updated, moved to Spec Delta, or intentionally not persisted. Explicit PM requirements become confirmed candidates without another existence-confirmation question; Codex inferences remain `needs_triage`. Accepted, rejected, deferred, and duplicate decisions retain their reasons, while candidate versions never become commitments or a Release Slice automatically.

Ask “what are the next version candidates?” to receive a direct PM list from the workspace Pool, separated into locked, candidate, and needs-confirmation groups with type, value, priority, next step, and owner. SoloDesk does not need to be open. Factual questions, raw brainstorming, and one-off details do not trigger Pool ceremony.

For a bug, find the actual cause first. A stable local issue with a known cause gets a minimal RCA: symptom, actual cause, smallest root-level fix, and one regression check. Recurring, uncertain, shared, high-impact, data, security, or permission failures use full mechanism-level RCA.

Validation is proportional to risk and evidence cost. Every change still gets an actual check. A simple, local, reversible, low-risk case may finish with that direct check and no dedicated Evidence artifact when artifact collection would cost more than it helps. Complex, cross-module, high-impact, data, security, permission, irreversible, acceptance, and release cases require explicit traceable evidence.

For “done,” acceptance, release, or go-live decisions, use RAVO Acceptance. Implementation complete, automated checks passed, locally usable, PM accepted, release-ready, and released are six separate states and require separate evidence.

For non-trivial work, RAVO ends a phase with one concrete, owner-assigned next step. It does not ask the PM to reconfirm settled decisions or authorize safe in-scope local work; simple answers and one-off results do not add a forced recommendation.

## On-Demand Skills

| Skill | Use it when |
|---|---|
| `ravo-core` | Direct-vs-Goal context, Goal lifecycle, setup, status, Pool decisions, AGENTS, release Goal prompts, preflight, or migration |
| `ravo-requirement-analysis` | An important or ambiguous requirement needs systematic shaping |
| `ravo-root-cause-analysis` | A bug or failure needs an actual-cause conclusion |
| `ravo-workstream` | Long-running work needs milestones, blockers, and resumable evidence |
| `ravo-quick-validation` | Validation strength and retained evidence should match risk and collection cost |
| `ravo-release-acceptance` | Non-trivial delivery, acceptance, release, or go-live status must match evidence |
| `ravo-knowledge` | Relevant project history may change a non-trivial result |
| `ravo-review` | An important, high-risk, or release-sensitive proposal needs adversarial review |
| `ravo-dashboard` | Query next-version candidates directly, or open and diagnose local SoloDesk |

Codex discovers Skill names and short descriptions at install time, then reads a matching Skill body only when the scenario or user invokes it. This is context disclosure, not access control or a mandatory call order.

## Install

This repository is a local marketplace through `.agents/plugins/marketplace.json`:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo@ravo
```

Start a fresh Codex task after installation.

### Migrate From v0.5.5

v0.6.2 supports the eight legacy `0.5.5` plugins from the same marketplace. Install the unified plugin, then preview and apply migration:

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js --preview
node plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js --apply
```

Apply creates an offline legacy marketplace snapshot before removing anything. A partial failure automatically restores the eight-plugin state; a failed rollback exposes the same snapshot recovery command. Provider configuration and workspace artifacts are not copied or deleted. Keep the snapshot until PM acceptance, and start a fresh Codex task after a successful migration.

Read-only unified package check:

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-preflight.js
```

## AGENTS.md Recall

RAVO never silently edits global `AGENTS.md`. Preview first and apply only when the user explicitly requests it:

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-agents.js
node plugins/ravo/modules/ravo-core/scripts/ravo-agents.js --apply
```

The marked block is limited to seven rules: direct work and existing Goal lifecycle, requirement and RCA depth, proportional evidence and risk-based Skill recall, release Goal/Spec and Pool boundaries, next-version candidate projection, hard safety/status boundaries, and one owner-assigned next step for non-trivial work.

## Hooks

The unified plugin registers only:

- `Stop`: read-only checks positive completion/acceptance/release claims and explicit requirement, issue, lesson, or product-decision statements that omit their Pool disposition. Both checks produce at most one continuation per user turn and write no artifact or telemetry. Quotes, negations, brainstorming, mechanism explanations, ordinary Q&A, and read-only candidate lists pass through.

v0.6.2 does not register permission-request, prompt, session, subagent, pre-tool, or post-tool routing Hooks. Skill descriptions and `AGENTS.md` provide recall.

## Goals And Release Goal Prompts

An ordinary clear multi-turn Codex Goal does not require a Spec. RAVO uses the host capability when available and never simulates an active Goal when it is not.

A RAVO version-delivery, Release Slice, acceptance, go-live, or publication Goal Prompt is a stricter execution contract. It requires a current decision-complete Spec and commits only the current Release Slice.

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt.js --workspace "$(pwd)"
```

## SoloDesk

```bash
node plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk.js open
```

SoloDesk binds only to loopback, reuses one user instance, and reads explicitly allowlisted workspaces. Dashboard health does not prove that a feature is locally usable.

The next-version scenario does not require the SoloDesk service:

```bash
node plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool.js --scenario next_version_candidates --workspace "$(pwd)" [--version v0.6.2]
```

## Review And Knowledge

Review Provider configuration stays at `~/.codex/skill-config/ravo-review.json`; see `templates/ravo-review-config.example.json`. Check the data boundary before every external review.

```bash
node plugins/ravo/modules/ravo-review/scripts/run-review.js --preview --domain architecture --subject "Review this plan"
node plugins/ravo/modules/ravo-knowledge/scripts/retrieve-knowledge.js --query "<task>" --record-use false
```

Raw project facts and evidence remain workspace-local by default. Transferable user knowledge requires explicit opt-in, redaction, scope, sensitivity, and applicability.

Known limitation in v0.6.2: after RCA, Review, or smoke validation establishes a reusable fact, Codex may continue solving the task without proactively capturing that fact in RAVO Knowledge. For an important lesson, explicitly ask Codex to record it; unverified solution candidates should remain marked as candidates rather than conclusions.

## Artifact Protocol

Internal modules connect through workspace files rather than a central workflow engine:

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── workstream/
├── quick-validation/
├── acceptance/
├── pool/
├── knowledge/
└── review/
```

Existing `0.5.x` artifact, config, and schema versions remain compatibility protocol versions under product `0.6.2`.

## Local Validation

```bash
npm test
node scripts/validate-repo.js
node scripts/smoke-test.js
node scripts/prompt-regression.js
node scripts/ravo-v0.6-architecture-test.js
node scripts/ravo-v0.6-hook-test.js
node scripts/ravo-v0.6-migration-test.js
```

Passing scripts does not mean PM acceptance, release readiness, or publication.

## License

[MIT](LICENSE)

Repository: https://github.com/Mxturl/RAVO
