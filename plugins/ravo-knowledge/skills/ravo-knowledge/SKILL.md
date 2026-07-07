---
name: ravo-knowledge
description: Write, retrieve, and apply RAVO workspace knowledge; optionally create redacted user-level transferable lessons after explicit opt-in.
---

# RAVO Knowledge

Use for non-trivial tasks where previous project facts, decisions, lessons, principles, or evidence may affect the result.

## Workflow

Write workspace-local knowledge:

```bash
node "$RAVO_KNOWLEDGE_PLUGIN_ROOT/scripts/write-knowledge-artifact.js" --kind lesson --content "<lesson>" --applicability "<when it applies>"
```

Retrieve relevant knowledge:

```bash
node "$RAVO_KNOWLEDGE_PLUGIN_ROOT/scripts/retrieve-knowledge.js" --query "<task>"
```

Set `RAVO_KNOWLEDGE_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Raw facts stay workspace-local by default.
- User-level transferable lessons require `--scope user --opt-in true`.
- Transferable lessons must be redacted and must not include canary facts.
- When retrieved knowledge affects the output, state what was applied and what was not applicable.
