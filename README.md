<div align="center">

# RAVO Lifecycle Governance

### Modular governance plugins for Codex agents

[English](README.md) | [中文](README_ZH.md)

</div>

## Why RAVO?

AI coding agents are powerful, but long-running work often fails in predictable ways: requirements are accepted too early, root-cause analysis stops at symptoms, unnecessary workflow machinery gets added, delivery status is claimed without evidence, and useful lessons disappear after the session ends.

**RAVO** gives Codex agents a lightweight lifecycle governance layer. It adds installable skills, hooks, scripts, and shared artifacts so agents can reason before building, verify before claiming readiness, and preserve reusable project evidence without forcing users into a heavy all-in-one framework.

```text
R = Reason      requirements, solutions, root causes
A = Act         workstream planning and execution handoff
V = Verify      acceptance evidence and status gates
O = Organize    durable knowledge capture and reuse
```

## Core Principles

- **First Principles** — start from the goal, real consumer, constraints, facts, and mechanism-level cause before choosing an implementation path.
- **Occam's Razor** — prefer the smallest sufficient process, artifact, and implementation; avoid a central dispatcher when independent modules and shared files are enough.
- **Falsifiability** — important plans and delivery claims must be challengeable. RAVO uses adversarial review and evidence-matched delivery so weak assumptions, missing validation, and unsupported `accepted`, `release ready`, or `live` claims are exposed before they mislead users.
- **Principle of Least Astonishment** — governance should feel natural. Users should not need to say "call RAVO" during normal work; skills and hooks should activate from the task semantics.

## Features

### Requirement and Solution Analysis

- Identify the real goal, consumer, constraints, options, and validation path.
- For medium/high-complexity requirements, start with requirement co-creation: background, current state, scenarios, consumer, pain, references, constraints, and a `continue clarifying / direct to solution` choice.
- Surface likely user blind spots with judgment and suggested action, not just risk hints.
- Separate facts from assumptions and make the basis of the recommendation explicit.
- Challenge the preferred option once before concluding, instead of only defending it.
- Use first-principles reasoning before implementation when the request is ambiguous or important.
- Write reusable analysis artifacts under `knowledge/.ravo/analysis`.

### Goal Prompt Methodology

Most people start Goal Mode by stuffing a long requirement list into one prompt. That makes the goal hard to audit, hard to resume, and easy to reinterpret.

RAVO's design intent is simple: Goal Mode is for long-running autonomous work, so it needs a stable spec first; the Goal Prompt should be an execution contract, not the requirements container.

RAVO treats Goal Prompt authoring as a first-class lifecycle capability:

- Check whether a decision-complete spec already exists before writing a Goal Prompt.
- If no spec exists, do not produce any runnable Goal Prompt. Generate or request the spec according to config first.
- If a spec exists, check whether newer alignment drafts, candidate requirements, spec deltas, or TODOs remain unmerged. If they do, update the spec first and do not output a runnable Goal Prompt.
- If a current spec exists, generate a short Goal Prompt that references the spec as the single source of truth.
- Keep the Goal Prompt focused on execution contract, evidence, recovery, and acceptance, not requirement duplication.
- Use RAVO artifacts so long-running work can resume from spec, workstream, validation, and acceptance evidence.

### Root-Cause Analysis

- Separate symptoms, proximate causes, mechanism root cause, recurrence risk, smallest fix, and verification.
- Compare at least one plausible competing explanation before locking the root cause.
- Avoid shallow answers such as "prompt issue", "user asked", or "missing check" when those are only surface causes.
- For complex or high-impact root causes, connect RAVO Review and keep `full/partial/unavailable` review evidence explicit.

### Acceptance and Release Gates

- Check delivery, acceptance, release, go-live, readiness, and completed/done conclusions against evidence.
- Write acceptance artifacts under `knowledge/.ravo/acceptance`.
- Generate a PM-facing acceptance document with expected behavior, current implementation approach, actual effect, real responses, screenshots or substitute evidence, gaps, and risks.
- Treat prompt-time readiness hooks as fallback advisory only; the agent should run acceptance checks proactively before delivery conclusions.

### Workstream and RAVO Evidence

- Track long-running work with milestone, next step, blocker, decision, and evidence artifacts.
- Record a Roadmap Audit after each milestone: remaining required items, evidence gaps, blockers, and whether the spec must change.
- Worker/subagent evidence should state what was done, what changed, what was learned, evidence, blockers, and next recommendation.
- Record fast smoke evidence under `knowledge/.ravo/quick-validation`.
- Keep smoke evidence separate from final acceptance.

### RAVO Review

- Run configured provider/model reviews through `ravo-review`.
- Default to two rounds: independent review then challenge response; explicit three-round runs add convergence adjudication.
- Record adversarial review coverage under `knowledge/.ravo/review`.
- Keep full, partial, timeout, failure, truncation, retry attempts, challenge briefs, issue ledgers, and convergence state visible.
- Support both flat config and provider-array config at `~/.codex/skill-config/ravo-review.json`.
- Keep missing provider config visible as `coverage=none`; do not require review providers for routine tasks.

### Knowledge Reuse

- Write, retrieve, and apply workspace-local facts, decisions, lessons, principles, and evidence.
- Capture closeout/session lessons from Agent-provided summaries.
- Retrieve workspace knowledge for medium/high-complexity planning, architecture, review, acceptance, and long-running work even when the user does not say "knowledge".
- When user-level global knowledge is explicitly enabled, retrieval includes user scope and reports source, sensitivity, applicability, and staleness risk; cross-project lessons remain advisory.
- Support opt-in transferable lessons only after redaction, scope labeling, and leakage checks.
- Store durable knowledge as human-readable Markdown plus a JSON index so it can be read by people and retrieved by agents.

### Shared Artifact Protocol

RAVO modules connect through workspace files, not a central dispatcher:

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── workstream/
├── quick-validation/
├── acceptance/
├── knowledge/
└── review/
```

Single modules are technically installable on their own. For real use, install `ravo-core` first and treat it as the baseline module: it owns the shared manifest, artifact protocol, AGENTS.md integration, and Goal Prompt foundation. RAVO works best when the full module set is installed together. Raw project facts and evidence are workspace-local by default. Abstracted lessons and principles may become transferable user-level knowledge only after redaction, scope labeling, and explicit opt-in.

## Download and Installation

This repository uses a repo-local marketplace at `.agents/plugins/marketplace.json`.

From the repository root:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-workstream@ravo
codex plugin add ravo-quick-validation@ravo
codex plugin add ravo-acceptance@ravo
codex plugin add ravo-knowledge@ravo
codex plugin add ravo-review@ravo
```

`ravo-core` is the recommended baseline install. The other modules remain modular, but new users should install the full suite unless they have a specific reason not to.

Start a new Codex thread after installing so skills and hooks are picked up.

After installation, the installing Agent should point the user to the key configuration locations:

- Workspace RAVO config: `knowledge/.ravo/config.json`; template: `templates/ravo-config.example.json`.
- User-level RAVO defaults: `~/.codex/skill-config/ravo.json`.
- RAVO Review provider config: `~/.codex/skill-config/ravo-review.json`; template: `templates/ravo-review-config.example.json`.
- Codex global rules: `~/.codex/AGENTS.md`; preview and apply through `ravo-core`, never silently edit it.

RAVO Review can be checked without exposing secrets:

```bash
node plugins/ravo-review/scripts/run-review.js --domain architecture --subject "Review this plan" --no-stream
```

By default the runner uses `rounds=2`. Set `rounds` in `~/.codex/skill-config/ravo-review.json`, or pass `--rounds 1`, `--rounds 2`, or `--rounds 3`.

For a bounded check against one configured model:

```bash
node plugins/ravo-review/scripts/run-review.js --domain architecture --model "<model-id>" --rounds 1 --timeout-ms 60000 --subject "Review this plan" --no-stream
```

If no provider is configured, the command still writes a `coverage=none` artifact so acceptance can see that external review is unavailable rather than silently assuming it happened.

Closeout knowledge can be captured from an Agent-provided summary:

```bash
node plugins/ravo-knowledge/scripts/capture-knowledge.js --summary "Reusable lesson" --content "State what was learned and when it applies." --source agent-closeout --applicability "similar future work"
```

Workspace-local knowledge is the default. User-level transferable knowledge requires explicit opt-in plus source, sensitivity, applicability, and redaction metadata.

For diagnostics, run:

```bash
node plugins/ravo-core/scripts/ravo-status.js --workspace "$(pwd)"
```

The report shows manifest health, installed module versions, latest artifacts, config paths, and hook/session reminders.

If an existing Codex Agent is installing RAVO for a user, it should treat `AGENTS.md` integration as a selective upgrade step after plugin installation. The agent must inspect the user's Codex global `AGENTS.md`, propose how RAVO should fit into the existing rules, show a diff, and wait for explicit approval before writing.

> [!IMPORTANT]
> **Hook trust is part of the product, not an optional detail.**
> Without trusted `SessionStart` / `SubagentStart` / `UserPromptSubmit` hooks, RAVO loses most of its natural-governance behavior. In that degraded state, requirement analysis may not trigger reliably, and proactive acceptance falls back to weaker prompt-time behavior.
>
> After installation or upgrade:
> 1. check whether RAVO hooks are trusted or approved,
> 2. approve any newly added hook events,
> 3. start a fresh Codex thread before testing.

### Hook Trust

Codex may ask the user to approve newly installed plugin hooks before they run. Approval is per hook event, so approving `UserPromptSubmit` does not automatically approve later `SessionStart` or `SubagentStart` hooks added by an upgrade.

The host may not always show a prominent approval prompt. After installation, the agent should explicitly remind the user to confirm RAVO hook trust if natural triggering does not appear to work. If RAVO does not react to natural prompts, check or approve RAVO hook trust first, then start a fresh Codex thread.

### Upgrading RAVO

RAVO is designed to be upgrade-friendly: plugin ids stay stable (`ravo-core`, `ravo-analysis`, `ravo-workstream`, `ravo-quick-validation`, `ravo-acceptance`, `ravo-knowledge`), the shared workspace protocol is versioned through `knowledge/.ravo/manifest.json`, and each module can be upgraded independently.

Typical upgrade flow:

```bash
git pull
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-workstream@ravo
codex plugin add ravo-quick-validation@ravo
codex plugin add ravo-acceptance@ravo
codex plugin add ravo-knowledge@ravo
codex plugin add ravo-review@ravo
```

If your marketplace source is a Git marketplace rather than the current local repo checkout, refresh it first:

```bash
codex plugin marketplace upgrade
```

After any upgrade:

- start a new Codex thread,
- re-check hook trust for any newly introduced hook events,
- rerun a short RAVO test prompt before relying on the new behavior.

## AGENTS.md Integration

RAVO never silently edits Codex global `AGENTS.md`.

Different users keep different `AGENTS.md` structures. Treat the RAVO snippet as a recommended policy block, not as text that must be mechanically inserted unchanged.

The intended boundary is:

- `AGENTS.md` decides **when** to delegate: global priority, safety, interaction style, data boundaries, and fallback behavior.
- RAVO decides **how** to execute once delegated: analysis structure, acceptance evidence, scripts, schemas, hooks, and artifacts.

RAVO covers `analysis`, `workstream`, `RAVO Evidence` (`ravo-quick-validation` compatibility entry), `acceptance`, `knowledge`, and `review` as independently installable modules. Small, clearly bounded tasks do not require every module.

### Manual Mode

Use this when the user installs RAVO directly and wants to review the suggested policy text for Codex global `AGENTS.md`.

```bash
node plugins/ravo-core/scripts/ravo-agents.js
node plugins/ravo-core/scripts/ravo-agents.js --apply
node plugins/ravo-core/scripts/ravo-agents.js --restore <backup-path>
```

By default, `ravo-agents.js` targets Codex global `AGENTS.md` in the current user's home directory. Use `--file <path>` only when you intentionally want a different file. The apply path creates a timestamped backup and updates the same marked block idempotently.

### Agent-Assisted Mode

Use this when a user's Agent installs RAVO or maintains their Codex environment.

The installing Agent should:

- Inspect Codex global `AGENTS.md` before proposing changes.
- Decide whether RAVO needs a new marked block, a smaller merge into existing sections, or no change because equivalent rules already exist.
- Preserve user-specific rules that are not RAVO concerns, such as language preference, SSH policy, safety boundaries, or project conventions.
- Add or merge only the missing RAVO boundary rules: `AGENTS.md` owns when to delegate, RAVO owns how to execute, simple factual questions are exempt from forced first-principles structure, and RAVO-unavailable fallback must be explicit.
- Show the user the proposed diff and explain the incremental behavior change.
- Ask for explicit approval before writing.
- Create a backup before any write.
- Never silently modify the user's rules file.

If the existing `AGENTS.md` is already opinionated, prefer a minimal merge over inserting duplicate RAVO wording. The goal is a selective upgrade, not a second policy manual.

## FAQ

<details>
<summary><strong>Do users need to explicitly call RAVO?</strong></summary>

No. RAVO is designed for natural interaction. Explicit skill names are useful for testing and debugging, but normal requirement, root-cause, and readiness prompts should activate the relevant capability through skill descriptions and hooks.

</details>

<details>
<summary><strong>Does installing RAVO also install Grill-me?</strong></summary>

No. RAVO does not bundle the Grill-me repository or install it as a separate dependency. What RAVO borrows is the *analysis posture*: challenge the first answer, surface alternative hypotheses, and require evidence-backed reasoning instead of shallow conclusions.

In practice, that means RAVO now encodes parts of that posture inside its own skills and prompts, such as `Facts`, `Challenge`, and `Alternative Hypotheses`.

</details>

<details>
<summary><strong>Is RAVO one big workflow engine?</strong></summary>

No. RAVO follows Occam's Razor: modules stay independently installable and connect through artifacts. A central dispatcher should only exist if shared artifacts stop being enough.

</details>

<details>
<summary><strong>Can RAVO modify AGENTS.md automatically?</strong></summary>

No. RAVO can preview and apply a suggested block to Codex global `AGENTS.md`, but the user or installing Agent must review the existing file, inspect the diff, and approve the write.

When an Agent performs the installation, it should choose the smallest safe integration:

- no change when equivalent rules already exist,
- a small merge into the existing working-rules section when that is clearer,
- a marked `RAVO` block only when the file has no suitable structure.

</details>

<details>
<summary><strong>Which AGENTS.md does RAVO target by default?</strong></summary>

Codex global `AGENTS.md` under the current user's home directory. Use `--file <path>` only when you intentionally want a different target.

</details>

<details>
<summary><strong>What if I do not see a hook approval prompt?</strong></summary>

Some hosts may not show a prominent approval prompt. If natural triggering does not appear to work after installation, explicitly check whether RAVO hooks are trusted or approved, then start a fresh Codex thread and retry a short manual test.

</details>

<details>
<summary><strong>Where are the shortest no-context manual test prompts?</strong></summary>

See [docs/quick-test-cases.md](./docs/quick-test-cases.md). Those prompts are designed for a fresh session with no project context and should finish quickly.

</details>

## Check After Changes

You do not need these commands if you only install and use RAVO.

If you change RAVO code, docs, skills, hooks, schemas, or scripts, run:

```bash
node scripts/validate-repo.js
node scripts/smoke-test.js
node scripts/prompt-regression.js
```

These checks confirm that RAVO's core structure, shared artifact protocol, and prompt-trigger regressions still work.

For fast semantic-trigger checks with no project context, see [docs/quick-test-cases.md](./docs/quick-test-cases.md).

For multi-turn runtime scenario checks that better simulate a real development conversation, including the agent-initiated delivery-governance path, see [docs/runtime-flow-tests.md](./docs/runtime-flow-tests.md).

If you changed hooks, acceptance behavior, or trigger logic, do not treat the script trio alone as proof of the proactive runtime path. Run at least one runtime-flow test as well.
