---
name: ravo-requirement-analysis
description: Analyze ambiguous or important requirements, product flows, architecture options, semantic models, or agent workflows using RAVO first-principles reasoning. Use before implementation when goals, consumers, constraints, facts, tradeoffs, assumptions, or validation criteria are not yet clear.
---

# RAVO Analysis

Use this skill before implementation when the request needs a decision, not just code. User-facing language should say `RAVO Analysis`; `ravo-requirement-analysis` remains the compatibility skill id.

## Output Contract

Use the user's conversation language for visible headings. The English names below are semantic fields, not mandatory display text.

Include:

- `Requirement Co-Creation`: for medium/high-complexity requirements, summarize background, current state, scenarios, consumer, pain, reference targets, constraints, and offer `continue clarifying` or `direct to solution`.
- `Goal`: what success means.
- `Consumer`: who consumes the result; if the user and Codex are producers, optimize for the final user.
- `Constraints`: facts, boundaries, safety, time, compatibility, and evidence limits.
- `Facts`: what is known from the prompt, code, docs, data, or explicit evidence; separate fact from inference or assumption.
- `Options`: realistic paths and tradeoffs.
- `Blind Spots`: likely missing assumptions, with basis (`fact|inference|assumption|needs_validation`), impact (`high|medium|low`), suggested action (`clarify|proceed_as_assumption|mark_out_of_scope|split_milestone|run_review|update_spec`), and whether the spec must change.
- `Challenge`: the strongest objection, disconfirming scenario, or reason your preferred option could fail.
- `Derived Conclusion`: the chosen path and why it follows from the facts.
- `Validation`: how the result will be checked.

Presentation:

- Put each field in its own paragraph or bullet. Do not inline multiple labels such as `Goal`, `Constraints`, `Facts`, and `Derived Conclusion` into one dense paragraph.
- For Chinese output, prefer natural labels: `需求共创`、`目标`、`真实消费者`、`约束`、`事实`、`方案选项`、`可能盲区`、`挑战`、`推导结论`、`验证`. Each label must start on a separate line.

For important work, or when a RAVO advisory triggered this skill, write an artifact:

```bash
node "$RAVO_ANALYSIS_PLUGIN_ROOT/scripts/write-analysis-artifact.js" --type requirement --status complete --title "<short title>" --fact "<explicit fact>" --challenge "<strongest objection>" --conclusion "<derived conclusion>"
```

Set `RAVO_ANALYSIS_PLUGIN_ROOT` to the directory two levels above this `SKILL.md` file. Do not assume `plugins/ravo-analysis` exists in the user's workspace after installation.
Automatic hook-triggered placeholder artifacts stay `draft`; reusable artifacts should be written as `complete`.

When the user needs a long-running Goal prompt, check whether the decision-complete spec exists and is current. If no spec exists, or if newer alignment drafts/candidate requirements/spec deltas are unmerged, do not output a runnable Goal Prompt. If the user only asked for the prompt, stop after explaining the missing/stale spec condition and offer to create or update it:

```bash
node "$RAVO_ANALYSIS_PLUGIN_ROOT/scripts/write-decision-spec.js" --title "<short title>" --goal "<product goal>" --consumer "<real consumer>" --in-scope "<included behavior>" --out-of-scope "<excluded behavior>" --contract "<module or feature contract>" --validation "<checkable validation>" --fallback "<failure or fallback behavior>" --assumption "<explicit assumption>"
```

After writing or updating the spec, return the spec path. Let `ravo-core` generate the concise Goal prompt only after the spec is decision-complete, current, and checked again. Without a current decision-complete, non-draft spec, do not output any runnable Goal prompt, including short, temporary, or draft versions.

## Rules

- A conclusion without derivation is invalid.
- Preserve original user intent separately from recommended changes when generating specs.
- Do not skip the artifact for non-trivial analysis when `knowledge/` is available.
- Do not turn user preference into automatic arbitration when the final consumer is someone else.
- Every major option must distinguish facts, inferences, and assumptions.
- Challenge the preferred option before finalizing the recommendation.
- If the basis is missing, say what evidence or clarification would change the recommendation; do not pretend certainty.
- For high-impact proposals, run external review when available.
