# RAVO Lifecycle Governance

RAVO is a modular lifecycle-governance plugin suite for AI coding agents. It keeps the product identity unified while letting users install only the capabilities they need.

```text
R = Reason      requirements, solutions, root causes
A = Act         workstream planning and execution handoff
V = Verify      acceptance evidence and status gates
O = Organize    durable knowledge capture and reuse
```

## v0.1 Scope

- `ravo-core`: shared schemas, templates, workspace manifest, and opt-in `AGENTS.md` integration.
- `ravo-analysis`: requirement-analysis and root-cause-analysis skills that write analysis artifacts.
- `ravo-acceptance`: release/acceptance skill and prompt-time gate that checks status claims against evidence.

`ravo-workstream` and `ravo-knowledge` are intentionally deferred. v0.1 only keeps protocol compatibility points for them.

## Install From This Repo

This repository uses a repo-local marketplace at `.agents/plugins/marketplace.json`.

From the repository root:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-acceptance@ravo
```

Start a new Codex thread after installing so skills and hooks are picked up.

## Shared Artifact Protocol

RAVO modules connect through workspace files, not through a central dispatcher:

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── acceptance/
├── workstream/
└── knowledge/
```

Single modules work alone. When multiple RAVO modules are installed, they discover upstream artifacts from `knowledge/.ravo/manifest.json`.

## AGENTS.md Integration

RAVO never silently edits `AGENTS.md`.

Preview the snippet:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md
```

Apply only after reviewing the diff:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --apply
```

The apply path creates a timestamped backup and updates the same marked block idempotently.

Restore from a backup:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --restore AGENTS.md.ravo-bak-...
```

## Smoke Test

```bash
node scripts/smoke-test.js
```

The smoke test initializes a temporary workspace, writes an analysis artifact, writes an acceptance artifact, and verifies that acceptance discovers analysis through the shared manifest.
