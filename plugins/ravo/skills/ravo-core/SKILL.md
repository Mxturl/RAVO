---
name: ravo-core
description: Choose or maintain RAVO execution context, including direct work and existing Codex Goals. Use for bounded multi-turn Goal decisions, Goal lifecycle, workspace setup, status, Pool decisions, AGENTS guidance, release Goal prompts, plugin preflight, or legacy migration.
---

# RAVO Core

Use this skill for explicit RAVO setup and maintenance. Ordinary product work does not need to initialize or inspect RAVO first.

## Context-Driven Execution

Choose the smallest sufficient mode from the current context. This is an internal judgment, not a status label or decision matrix to show the user:

- A clear implementation, change, or fix request carries a default delivery commitment: complete the authorized scope through implementation, validation, and reversible local integration unless a real blocker or PM product decision stops it. The user does not need to say "finish everything". Discussion, explanation, analysis, planning, and brainstorming requests do not become implementation requests under this rule.
- Work directly for simple questions, read-only checks, clear local fixes, and short reversible tasks.
- Use RAVO Analysis when missing product meaning, scope, or success criteria could change the direction.
- Create or reuse one Codex Goal when the full conversation context shows a clear implementation outcome, enough authorization to continue without PM supervision, and that continuity would materially help complete the work. Several reliable steps, likely multi-turn progress, and meaningful recovery value are contextual signals, not required conditions or a scoring checklist. Infer usefulness from intent, prior decisions, remaining commitments, and boundaries; do not use keywords or require the user to mention Goal.
- Add the relevant governance Skill only for actual data, credentials, permissions, production, shared-service, irreversible-action, acceptance, or release boundaries.

Do not initialize RAVO, create artifacts, or announce the mode merely to classify a clear bounded task.

When the user-level RAVO AGENTS block is installed, its standing instruction explicitly delegates semantic Goal selection, so no per-task Goal phrase is required. Still use Codex Goal capability only when the host already started a Goal or the current tool contract authorizes creation. Never synthesize a `/goal` user message, bypass tool authority, or block ordinary work because Goal capability is unavailable; for clearly long-running work, continue the default delivery commitment and describe the real fallback once.

For Goal lifecycle:

- Reuse an active Goal when the user says to continue; do not create another Goal for the same objective.
- A completed, terminally blocked, or explicitly parked Goal does not restart because the user says only “continue”. Continue ordinary discussion or report that no work remains.
- Reconsider Goal mode only for a new, independent objective that still meets the eligibility conditions.
- An ordinary clear multi-turn Goal does not require a Spec. A version delivery, Release Slice, acceptance, go-live, or publication Goal still requires a current decision-complete Spec.
- Goal selection alone does not add a Spec, Review, Acceptance, Evidence artifact, or other RAVO process. Those remain proportional to the task's actual ambiguity, risk, and status claim.
- Goal mode changes the execution container, not authorization. It never expands data, credential, permission, remote, production, destructive-action, or release boundaries.

## Workflow

1. Initialize the workspace manifest when `knowledge/.ravo/manifest.json` is missing:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-init.js"
```

2. Inspect RAVO status without changing files:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-status.js" --workspace <workspace>
```

Use this when the user asks whether RAVO is installed, active, trusted, configured, or writing artifacts. Report manifest health, module versions, latest artifacts, config paths, hook trust reminder, and fresh-session reminder.

3. Inspect the installed unified plugin without changing files:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-preflight.js"
```

For an explicit new requirement or issue, capture the minimum analysis and source without repeating PM confirmation:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/capture-pool-item.js" --workspace <workspace> --kind requirement --title "<title>" --description "<minimum analysis>" --target-user "<consumer>" --scenario "<scenario>" --pain-point "<pain or value>" --expected-outcome "<expected result>" --scope-boundary "<boundary>" --user-value "<value>" --source-ref "<source>" [--candidate-version vX.Y.Z]
```

Keep the readable minimum analysis in `--description`, and also populate every supported dedicated minimum-analysis field. Do not leave the dedicated fields empty merely because the same content appears in prose.

Use `--inferred true` only for a Codex inference; it remains `needs_triage`. Record an explicit PM decision with revision compare-and-swap:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/capture-pool-item.js" --workspace <workspace> --id <id> --decision approved|rejected|deferred|duplicate|closed --reason "<reason>" --owner pm --source-ref "<source>" --expected-revision <revision>
```

Approval does not set a committed version or Release Slice. A missing rejection reason is recorded honestly rather than forcing the PM to fill a form.

For PM-visible capture or decision replies, use the returned `pmBrief` as the factual source, not as a response template. Answer the current product question naturally and show the relevant result and boundary without Work Item IDs, paths, commands, raw JSON, or internal status fields unless the PM explicitly requests technical evidence.

4. For opt-in Codex global `AGENTS.md` integration, preview first:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-agents.js"
```

5. Apply only after the user explicitly asks:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-agents.js" --apply
```

By default, this targets Codex global `AGENTS.md` under the current user's home directory. Use `--file <path>` only when you intentionally want a different target file. The apply path creates a backup and updates the marked RAVO block idempotently.

6. For a RAVO release, acceptance, publication, or Release Slice Goal Prompt, check for a decision-complete spec first:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-goal-prompt.js" --workspace <workspace>
```

If the script returns `missing_spec`, do not create a runnable RAVO release Goal Prompt, including short, temporary, or draft versions. This guard does not make a Spec mandatory for an ordinary clear host Goal. If the user asked for a version delivery, acceptance, publication, or Release Slice Goal Prompt, explain that the Spec is needed first and offer to generate it. A runnable RAVO release Goal Prompt is generated only after a decision-complete, non-draft Spec exists and is checked again.

7. Preview the supported eight-plugin `0.5.5` to unified `0.6.3` migration before applying it:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-migrate.js" --preview
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-migrate.js" --apply
```

The apply path creates an offline legacy restore snapshot before removal and automatically restores it after a partial failure. Start a fresh Codex task after a successful migration. Do not delete the snapshot before PM acceptance.

8. For a v0.5.5 trusted acceptance baseline, capture the startup Git state before changing files:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/ravo-git-baseline.js" --workspace <workspace> --capture --output knowledge/.ravo/acceptance/git-startup-baseline.json
```

Before requesting PM acceptance, finalize that snapshot with explicit task-owned paths. The command creates a local commit only for those paths and returns `commit_blocked` when ownership is not safe; it never pushes or resets the repository.

## Product Manager Communication

- PM-visible content optimizes for the current product question. Usually lead with the outcome, then include usability, user impact, PM action, or next step only when they help this reply. Before sending, remove any default evidence appendix, internal IDs, paths, commands, or raw status fields unless the PM asked for them or they materially affect the decision.
- Explain a technical mechanism only for the current explicit question; do not persist a language preference or change later ordinary PM replies.
- Use the structured `pmBrief` from RAVO outputs as facts, not a field-by-field layout. Let the model choose natural prose, a list, a table, or steps; do not rewrite the facts into a conflicting second status.
- If PM action is required, ask one product question with a recommendation, mutually exclusive options, each outcome, and the impact of waiting. Do not ask the PM to choose routine local engineering steps.
- After validated work inside the confirmed scope, continue through reversible local integration, local RAVO refresh, and real local experience verification without splitting them into separate approvals. Ask again only for scope expansion, failed checks requiring a product tradeoff, semantic conflict, user data, credentials, remote/production state, active shared services, destructive action, or an unrecoverable change.

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume the RAVO source repository exists in the user's workspace after installation.

## Rules

- Do not silently modify `AGENTS.md`.
- Do not initialize, inspect, or require every RAVO module for small tasks.
- Use `knowledge/.ravo/manifest.json` as the connection point; do not build a dispatcher.
- RAVO release, acceptance, publication, and Release Slice Goal prompts should reference the accepted Spec, not duplicate it; ordinary host Goals are not forced through this generator.
- Status wording must distinguish implementation complete, validated, locally available, PM accepted, release ready, and released.
- When a Goal references v0.5.5, run the bounded Git baseline and, for Runtime-owned changes, Runtime Delivery Preflight before Fresh Session evidence. A roadmap item outside the current Release Slice does not expand the Goal.
