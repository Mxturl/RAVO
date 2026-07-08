---
name: ravo-quick-validation
description: Write and check RAVO Evidence smoke manifests for fast branch, phase, script, or risk validation evidence.
---

# RAVO Evidence

Use this skill to record fast validation evidence before final acceptance.

## Workflow

Write a smoke manifest:

```bash
node "$RAVO_QUICK_VALIDATION_PLUGIN_ROOT/scripts/write-smoke-artifact.js" --scope "<scope>" --status pass --check "<check>" --evidence-ref "<path>"
```

Check the latest smoke manifest:

```bash
node "$RAVO_QUICK_VALIDATION_PLUGIN_ROOT/scripts/check-smoke-artifact.js"
```

Set `RAVO_QUICK_VALIDATION_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Smoke evidence is not final acceptance.
- `real-device-pending` is a risk marker, not a pass.
- Required smoke failures must block readiness.
- User-facing language should say RAVO Evidence; `ravo-quick-validation` remains the compatibility entry name.
