---
name: ravo-knowledge
description: Write, retrieve, and apply reusable lessons, experiences, principles, facts, and decisions in RAVO workspace knowledge; optionally create redacted user-level transferable lessons after explicit opt-in.
---

# RAVO Knowledge

Use for non-trivial tasks where previous project facts, decisions, lessons, principles, or evidence may affect the result.

## Workflow

Write workspace-local knowledge:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-knowledge/scripts/write-knowledge-artifact.js" --kind lesson --title "<title>" --summary "<summary>" --content "<lesson>" --applicability "<when it applies>"
```

This writes both human-readable Markdown and a JSON index under `knowledge/.ravo/knowledge/`.

Capture closeout/session knowledge from an Agent-provided summary:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-knowledge/scripts/capture-knowledge.js" --summary "<summary>" --content "<reusable lesson>" --source agent-closeout --source-ref "<session-or-artifact-ref>" --applicability "<when it applies>"
```

Retrieve relevant knowledge:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-knowledge/scripts/retrieve-knowledge.js" --query "<task>"
```

For read-only consumers such as SoloDesk:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-knowledge/scripts/retrieve-knowledge.js" --query "<task>" --record-use false
```

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Raw facts stay workspace-local by default.
- User-level transferable lessons require `--scope user --opt-in true`, `--source`, `--sensitivity public|redacted`, and at least one `--applicability`.
- Transferable lessons must be redacted and must not include canary facts.
- User-level global knowledge is disabled by default and must never be written silently.
- `--record-use false` is a strict read-only query: it must not update `lastUsedAt`, indexes, Markdown, JSON, or file mtimes.
- Knowledge capture/reuse requests authorize knowledge operations only. Do not modify product code, source files, or non-knowledge docs unless the user explicitly asks.
- Do not use this skill for simple concept explanations, direct FAQs, or basic how-to questions unless the user asks for history, prior decisions, or workspace-specific evidence.
- For task closeout, the Agent must provide the actual summary; RAVO does not infer hidden conversation content.
- If workspace-local knowledge is written or proposed, the final visible reply must include the Markdown path. Do not add a separate notice that user-level global knowledge was not written.
- If user-level global knowledge is written or proposed, the user-visible final paragraph must state what was written, where, source, sensitivity, applicability, and opt-in status.
- Prefer durable Markdown for human value; JSON index is for discovery and artifact connection.
- Capture a reusable technical lesson only when it has a source, applicability, non-applicability, confidence, and enough evidence to confirm it. Product principles, business judgments, and product decisions require PM confirmation before becoming active Knowledge.
- Rejected Work Items stay decision history and do not become active Knowledge automatically. Create a separate Knowledge record only when the rejection reason forms a reusable principle with its own source and boundary.
- When retrieved knowledge affects the output, state what was applied and what was not applicable.
- For a product-manager audience, describe the reusable lesson, where it applies, how it changes the next product decision, and what it does not prove before storage or index details.
