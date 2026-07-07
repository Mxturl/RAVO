---
name: ravo-requirement-analysis
description: Analyze ambiguous or important requirements, product flows, architecture options, semantic models, or agent workflows using RAVO first-principles reasoning. Use before implementation when goals, consumers, constraints, facts, tradeoffs, assumptions, or validation criteria are not yet clear.
---

# RAVO Requirement Analysis

Use this skill before implementation when the request needs a decision, not just code.

## Output Contract

Include:

- `Goal`: what success means.
- `Consumer`: who consumes the result; if the user and Codex are producers, optimize for the final user.
- `Constraints`: facts, boundaries, safety, time, compatibility, and evidence limits.
- `Facts`: what is known from the prompt, code, docs, data, or explicit evidence; separate fact from inference or assumption.
- `Options`: realistic paths and tradeoffs.
- `Challenge`: the strongest objection, disconfirming scenario, or reason your preferred option could fail.
- `Derived Conclusion`: the chosen path and why it follows from the facts.
- `Validation`: how the result will be checked.

For important work, or when a RAVO advisory triggered this skill, write an artifact:

```bash
node "$RAVO_ANALYSIS_PLUGIN_ROOT/scripts/write-analysis-artifact.js" --type requirement --status complete --title "<short title>" --fact "<explicit fact>" --challenge "<strongest objection>" --conclusion "<derived conclusion>"
```

Set `RAVO_ANALYSIS_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume `plugins/ravo-analysis` exists in the user's workspace after installation.
Automatic hook-triggered placeholder artifacts stay `draft`; reusable artifacts should be written as `complete`.

When the user needs a long-running Goal prompt but no decision-complete spec exists, create the spec first:

```bash
node "$RAVO_ANALYSIS_PLUGIN_ROOT/scripts/write-decision-spec.js" --title "<short title>" --goal "<product goal>" --consumer "<real consumer>" --in-scope "<included behavior>" --out-of-scope "<excluded behavior>" --contract "<module or feature contract>" --validation "<checkable validation>" --fallback "<failure or fallback behavior>" --assumption "<explicit assumption>"
```

After writing the spec, return the spec path and let `ravo-core` generate the concise Goal prompt from that spec. Do not inflate the Goal prompt with the full requirements body.

## Rules

- A conclusion without derivation is invalid.
- Preserve original user intent separately from recommended changes when generating specs.
- Do not skip the artifact for non-trivial analysis when `knowledge/` is available.
- Do not turn user preference into automatic arbitration when the final consumer is someone else.
- Every major option must distinguish facts, inferences, and assumptions.
- Challenge the preferred option before finalizing the recommendation.
- If the basis is missing, say what evidence or clarification would change the recommendation; do not pretend certainty.
- For high-impact proposals, run external review when available.
