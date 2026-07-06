---
name: ravo-core
description: Initialize or manage the RAVO lifecycle governance workspace protocol. Use when Codex needs to create knowledge/.ravo/manifest.json, inspect RAVO module artifacts, or preview/apply the opt-in AGENTS.md snippet for RAVO.
---

# RAVO Core

Use this skill to initialize the shared RAVO artifact protocol before other RAVO modules need to connect.

## Workflow

1. Initialize the workspace manifest when `knowledge/.ravo/manifest.json` is missing:

```bash
node plugins/ravo-core/scripts/ravo-init.js
```

2. For opt-in `AGENTS.md` integration, preview first:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md
```

3. Apply only after the user explicitly asks:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --apply
```

The apply path creates a backup and updates the marked RAVO block idempotently.

## Rules

- Do not silently modify `AGENTS.md`.
- Do not require every RAVO module for small tasks.
- Use `knowledge/.ravo/manifest.json` as the connection point; do not build a dispatcher.
