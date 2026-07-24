---
name: ravo-requirement-analysis
description: Systematically shape important or ambiguous requirements before implementation, and visibly capture explicit new requirements or inferred future product needs. Use when consumers, scenarios, pain, goals, boundaries, success, non-goals, constraints, risks, facts, assumptions, product decisions, or next-version ideas need clarification.
---

# RAVO Analysis

Use this skill when an important request needs systematic requirement co-creation. Do not use it for simple factual questions or a clear bounded task merely because the prompt mentions requirements, plans, or risks.

## Required Outcomes

Cover the real consumer, scenario, pain, goal, boundary, success criteria, non-goals, constraints, and risks. Preserve systematic coverage because it is the foundation for later implementation; use natural prose rather than mandatory visible sections.

Separate conclusions into confirmed facts, reasonable assumptions, and open product decisions. Ask the PM one recommendation-backed question only when the answer changes product direction, scope, or success criteria. Make other missing details visible as reasonable assumptions that the user can correct, then keep moving.

Before development, make the result decision-complete enough to feed an Alignment or Spec. Include viable options, tradeoffs, blind spots, the strongest challenge, the derived conclusion, and how it will be validated when those affect the decision.

State product outcome, current user impact, PM action, and next step first for PM audiences. Ask one recommendation-backed product question only when a decision is needed.

When the result contains an explicit new requirement stated by the PM, form the minimum analysis (target user, scenario, pain or value, expected outcome, and boundary), then use `$RAVO_PLUGIN_ROOT/modules/ravo-core/scripts/capture-pool-item.js` to store a confirmed candidate. Pass the minimum analysis both as readable `--description` content and through the dedicated `--target-user`, `--scenario`, `--pain-point`, `--expected-outcome`, `--scope-boundary`, and `--user-value` fields. State the capture result in one line and do not ask the PM to confirm that the requirement exists again. A next-version suggestion adds only `candidateVersions`; it does not set `committedVersion` or a Release Slice.

For scope placement, inspect the workspace manifest and its current Workstream/Spec pointer before any broad search. This is a direct manifest lookup and does not require loading the Workstream Skill. If there is no active Workstream or current Spec, record the explicit requirement as an uncommitted candidate; do not scan unrelated history merely to prove that no current Slice exists.

After capture, use the returned `pmBrief` as the authoritative facts, not as a response template. Default to one concise product sentence naming what was recorded and whichever boundary or next step matters now. Do not expose Work Item IDs, artifact paths, commands, raw JSON, or Skill/module names unless the PM asks for technical evidence. If a higher-priority rule requires capability disclosure, keep that disclosure to one separate short line without internal identifiers or paths.

When the requirement is inferred by Codex rather than explicitly stated, capture it only when it has clear follow-up value, with `confirmationStatus=needs_triage` and `decisionStatus=needs_triage`. Show the inference and its key assumption; it must not become approved or version-committed before PM confirmation. Ordinary questions, raw brainstorming, current implementation steps, and one-off details do not enter the Pool.

Artifact is required only when it feeds an Alignment, Spec, or decision; the conclusion must be reused across tasks; the route is `governed_change`; the user explicitly asks to record it; or the current Spec requires it. Use `$RAVO_PLUGIN_ROOT/modules/ravo-analysis/scripts/write-analysis-artifact.js` when an Artifact is required.

Risk follows actual data, permissions, security, release, irreversibility, and impact scope; an `Agent workflow` label alone is not a Review trigger. Use RAVO Review when its existing high-risk trigger applies.

For a long-running Goal Prompt, first use `ravo-core` to check a current decision-complete Spec. Without one, do not output a runnable Goal Prompt.

## Boundaries

- Preserve original intent separately from recommendations and do not make user preference automatic arbitration for another consumer.
- Name missing evidence or assumptions that would change the conclusion; do not claim implementation or local availability from analysis alone.
- Equivalent methods may replace defaults only when required results, evidence, boundaries, recovery, scope, and Spec-required methods remain intact.
- If equivalence cannot be shown, keep the default or escalate; model strength is not evidence.
