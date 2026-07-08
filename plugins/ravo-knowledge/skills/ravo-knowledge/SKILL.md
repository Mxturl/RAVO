---
name: ravo-knowledge
description: Write, retrieve, and apply RAVO workspace knowledge; optionally create redacted user-level transferable lessons after explicit opt-in.
---

# RAVO Knowledge

Use for non-trivial tasks where previous project facts, decisions, lessons, principles, or evidence may affect the result.

## Workflow

Write workspace-local knowledge:

```bash
node "$RAVO_KNOWLEDGE_PLUGIN_ROOT/scripts/write-knowledge-artifact.js" --kind lesson --title "<title>" --summary "<summary>" --content "<lesson>" --applicability "<when it applies>"
```

This writes both human-readable Markdown and a JSON index under `knowledge/.ravo/knowledge/`.

Capture closeout/session knowledge from an Agent-provided summary:

```bash
node "$RAVO_KNOWLEDGE_PLUGIN_ROOT/scripts/capture-knowledge.js" --summary "<summary>" --content "<reusable lesson>" --source agent-closeout --applicability "<when it applies>"
```

Retrieve relevant knowledge:

```bash
node "$RAVO_KNOWLEDGE_PLUGIN_ROOT/scripts/retrieve-knowledge.js" --query "<task>"
```

Set `RAVO_KNOWLEDGE_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Raw facts stay workspace-local by default.
- User-level transferable lessons require `--scope user --opt-in true`, `--source`, `--sensitivity public|redacted`, and at least one `--applicability`.
- Transferable lessons must be redacted and must not include canary facts.
- User-level global knowledge is disabled by default and must never be written silently.
- Knowledge capture/reuse requests authorize knowledge operations only. Do not modify product code, source files, or non-knowledge docs unless the user explicitly asks.
- Do not use this skill for simple concept explanations, direct FAQs, or basic how-to questions unless the user asks for history, prior decisions, or workspace-specific evidence.
- For task closeout, the Agent must provide the actual summary; hooks may advise capture but must not invent hidden conversation content.
- If workspace-local knowledge is written or proposed, the final visible reply must include the Markdown path and state that user-level global knowledge was not written unless explicit opt-in was used.
- If user-level global knowledge is written or proposed, the user-visible final paragraph must state what was written, where, source, sensitivity, applicability, and opt-in status.
- Prefer durable Markdown for human value; JSON index is for discovery and artifact connection.
- When retrieved knowledge affects the output, state what was applied and what was not applicable.
