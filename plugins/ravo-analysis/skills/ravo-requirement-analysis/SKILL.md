---
name: ravo-requirement-analysis
description: Analyze ambiguous or important requirements, product flows, architecture options, semantic models, or agent workflows using RAVO first-principles reasoning. Use before implementation when goals, consumers, constraints, tradeoffs, assumptions, or validation criteria are not yet clear.
---

# RAVO Requirement Analysis

Use this skill before implementation when the request needs a decision, not just code.

## Output Contract

Include:

- `Goal`: what success means.
- `Consumer`: who consumes the result; if the user and Codex are producers, optimize for the final user.
- `Constraints`: facts, boundaries, safety, time, compatibility, and evidence limits.
- `Options`: realistic paths and tradeoffs.
- `Derived Conclusion`: the chosen path and why it follows from the facts.
- `Validation`: how the result will be checked.

For important work, write an artifact:

```bash
node plugins/ravo-analysis/scripts/write-analysis-artifact.js --type requirement --title "<short title>" --conclusion "<derived conclusion>"
```

## Rules

- A conclusion without derivation is invalid.
- Do not turn user preference into automatic arbitration when the final consumer is someone else.
- For high-impact proposals, run external review when available.
