---
name: ravo-core
description: Initialize or manage the RAVO lifecycle governance workspace protocol. Use when Codex needs to create knowledge/.ravo/manifest.json, inspect RAVO module artifacts, preview/apply the opt-in AGENTS.md snippet, or generate a short Goal prompt from an accepted spec.
---

# RAVO Core

Use this skill to initialize the shared RAVO artifact protocol before other RAVO modules need to connect.

## Workflow

1. Initialize the workspace manifest when `knowledge/.ravo/manifest.json` is missing:

```bash
node "$RAVO_CORE_PLUGIN_ROOT/scripts/ravo-init.js"
```

2. For opt-in Codex global `AGENTS.md` integration, preview first:

```bash
node "$RAVO_CORE_PLUGIN_ROOT/scripts/ravo-agents.js"
```

3. Apply only after the user explicitly asks:

```bash
node "$RAVO_CORE_PLUGIN_ROOT/scripts/ravo-agents.js" --apply
```

By default, this targets Codex global `AGENTS.md` under the current user's home directory. Use `--file <path>` only when you intentionally want a different target file. The apply path creates a backup and updates the marked RAVO block idempotently.

4. For suggested Goal-mode prompts, check for a decision-complete spec first:

```bash
node "$RAVO_CORE_PLUGIN_ROOT/scripts/ravo-goal-prompt.js" --workspace <workspace>
```

If the script returns `missing_spec`, do not create a huge Goal prompt. Tell the user to generate a spec first. If it returns `ok`, use the short `goalPrompt` string and link the `specPath`.

Set `RAVO_CORE_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume `plugins/ravo-core` exists in the user's workspace after installation.

## Rules

- Do not silently modify `AGENTS.md`.
- Do not require every RAVO module for small tasks.
- Use `knowledge/.ravo/manifest.json` as the connection point; do not build a dispatcher.
- Goal prompts should reference the accepted spec, not duplicate it.
