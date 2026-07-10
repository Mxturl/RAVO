---
name: ravo-workstream
description: Create or update RAVO workstream artifacts for long-running goals, milestones, blockers, decisions, next steps, and evidence references.
---

# RAVO Workstream

Use when a task is long-running, multi-phase, multi-agent, or needs milestone progress visibility.

## Workflow

Create or update a workstream artifact:

```bash
node "$RAVO_WORKSTREAM_PLUGIN_ROOT/scripts/write-workstream-artifact.js" --status active --goal "<goal>" --spec-ref "<spec>" --current-milestone "<phase>" --next-step "<next step>" --evidence-ref "<path>"
```

For milestone closeout, add Roadmap Audit and worker evidence:

```bash
node "$RAVO_WORKSTREAM_PLUGIN_ROOT/scripts/write-workstream-artifact.js" --status active --goal "<goal>" --spec-ref "<spec>" --current-milestone "<phase>" --next-step "<next step>" --roadmap-audit "<what changed / what remains / blockers>" --worker-evidence '{"did":"...","changed":"...","learned":"...","evidence":"...","blockers":"...","next":"..."}'
```

Set `RAVO_WORKSTREAM_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Rules

- Keep a non-empty `nextStep` for active long-running work.
- Record blockers with recovery conditions.
- Record decisions and evidence paths.
- After each milestone, record a Roadmap Audit: completed scope, remaining required items, blockers, risks, evidence gaps, spec delta, and whether to continue.
- Worker/subagent evidence must say what was done, what changed, what was learned, what evidence exists, what is blocked, and the next recommendation.
- Do not decide release readiness; hand evidence to `ravo-acceptance`.
