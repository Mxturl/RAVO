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
- Use first-principles reasoning before implementation when the request is ambiguous or important.
- Write reusable analysis artifacts under `knowledge/.ravo/analysis`.

### Root-Cause Analysis

- Separate symptoms, proximate causes, mechanism root cause, recurrence risk, smallest fix, and verification.
- Avoid shallow answers such as "prompt issue", "user asked", or "missing check" when those are only surface causes.

### Acceptance and Release Gates

- Check delivery, acceptance, release, go-live, readiness, and completed/done conclusions against evidence.
- Write acceptance artifacts under `knowledge/.ravo/acceptance`.
- Treat prompt-time readiness hooks as fallback only; the agent should run acceptance checks proactively before delivery conclusions.

### Shared Artifact Protocol

RAVO modules connect through workspace files, not a central dispatcher:

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── acceptance/
├── workstream/
└── knowledge/
```

Single modules work alone. When multiple RAVO modules are installed, they discover upstream artifacts from `knowledge/.ravo/manifest.json`.

## Download and Installation

This repository uses a repo-local marketplace at `.agents/plugins/marketplace.json`.

From the repository root:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-acceptance@ravo
```

Start a new Codex thread after installing so skills and hooks are picked up.

### Hook Trust

Codex may ask the user to approve newly installed plugin hooks before they run. Approval is per hook event, so approving `UserPromptSubmit` does not automatically approve later `SessionStart` or `SubagentStart` hooks added by an upgrade. If RAVO does not react to natural prompts, approve/trust all RAVO hooks, then start a fresh Codex thread.

## AGENTS.md Integration

RAVO never silently edits `AGENTS.md`.

Different users keep different `AGENTS.md` structures. Treat the RAVO snippet as a recommended policy block, not as text that must be mechanically inserted unchanged.

### Manual Mode

Use this when the user installs RAVO directly and wants to review the suggested policy text.

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --apply
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --restore AGENTS.md.ravo-bak-...
```

The apply path creates a timestamped backup and updates the same marked block idempotently.

### Agent-Assisted Mode

Use this when a user's Agent installs RAVO or maintains their Codex environment.

The installing Agent should:

- Inspect the existing `AGENTS.md` before proposing changes.
- Decide whether RAVO needs a new marked block, a smaller merge into an existing section, or no change because equivalent rules already exist.
- Show the user the proposed diff and explain the incremental behavior change.
- Ask for explicit approval before writing.
- Create a backup before any write.
- Never silently modify the user's rules file.

If the existing `AGENTS.md` is already opinionated, prefer a minimal merge over inserting duplicate RAVO wording.

## FAQ

<details>
<summary><strong>Do users need to explicitly call RAVO?</strong></summary>

No. RAVO is designed for natural interaction. Explicit skill names are useful for testing and debugging, but normal requirement, root-cause, and readiness prompts should activate the relevant capability through skill descriptions and hooks.

</details>

<details>
<summary><strong>Is RAVO one big workflow engine?</strong></summary>

No. RAVO follows Occam's Razor: modules stay independently installable and connect through artifacts. A central dispatcher should only exist if shared artifacts stop being enough.

</details>

<details>
<summary><strong>Can RAVO modify AGENTS.md automatically?</strong></summary>

No. RAVO can preview and apply a suggested block, but the user or installing Agent must review the existing file, inspect the diff, and approve the write.

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
