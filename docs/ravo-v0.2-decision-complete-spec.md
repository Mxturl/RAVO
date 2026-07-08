# RAVO v0.2 Decision-Complete Spec

Date: 2026-07-07

## Product Definition

RAVO v0.2 upgrades RAVO from a minimal `core + analysis + acceptance` loop into a complete lifecycle governance suite for Codex agents.

RAVO v0.2 exists to prevent five recurring failures:

- Requirements are accepted before the real consumer, goal, constraints, and evidence are clear.
- Long-running work loses milestone state, next steps, blockers, and decision history.
- Fast checks are not captured as reusable evidence, so final acceptance becomes subjective.
- Agents claim `done`, `accepted`, `release_ready`, `live`, `已完成`, `验收通过`, or `可发版` without evidence.
- Lessons learned in one project are either lost or copied globally without redaction and scope control.

RAVO v0.2 is modular. It must not become a central scheduler, task platform, or monolithic plugin. Modules stay independently installable and connect through workspace artifacts.

## Product Principles

- First principles: reason from goal, consumer, constraints, facts, and mechanism root cause.
- Occam's Razor: prefer the smallest sufficient artifact, script, hook, and module boundary.
- Falsifiability: important analysis and delivery claims must be challengeable by evidence.
- Least surprise: users should not need to explicitly call RAVO for normal analysis, orchestration, or acceptance flows.
- Producer responsibility: acceptance is primarily initiated by the Agent before delivery claims, not by the user asking whether work is ready.

## Non-Goals

- Do not build a central dispatcher or scheduler.
- Do not build a general project management platform.
- Do not default to cross-project sharing of raw facts, customer requirements, code conventions, or acceptance evidence.
- Do not treat `UserPromptSubmit` as the primary acceptance gate.
- Do not turn the Goal prompt itself into a huge requirements document.

## Module Contracts

### ravo-core

Responsibilities:

- Initialize `knowledge/.ravo/manifest.json`.
- Create standard artifact directories.
- Preview/apply the opt-in Codex global `AGENTS.md` integration block.
- Define Goal Prompt Authoring behavior.

Inputs:

- Workspace root.
- Existing global `AGENTS.md`.
- Optional existing decision-complete spec path.

Outputs:

- `knowledge/.ravo/manifest.json`.
- Optional backed-up and updated global `AGENTS.md`.
- Goal prompt derived from an accepted spec.

Rules:

- RAVO never silently modifies global `AGENTS.md`.
- Agent-assisted installation must read the user's current global `AGENTS.md`, show a diff, and wait for explicit approval.
- `AGENTS.md` decides when to delegate; RAVO decides how to execute once delegated.

### ravo-analysis

Responsibilities:

- Requirement analysis.
- Root-cause analysis.
- Solution and architecture analysis.
- Decision-complete requirement spec generation.

Required output headings for analysis:

- Goal
- Consumer
- Constraints
- Facts
- Options
- Challenge
- Derived Conclusion
- Validation

Artifacts:

- `knowledge/.ravo/analysis/*.json`
- `docs/*spec*.md` for human-readable decision-complete specs.

Rules:

- Complete artifacts must include facts and challenge for requirement/solution analysis.
- Complete root-cause artifacts must include symptom, proximate cause, alternative hypotheses, mechanism root cause, why chain, conclusion, and verification.
- Important proposals must run external review when available after data-boundary checks.

### ravo-workstream

Responsibilities:

- Convert an accepted spec or long-running goal into milestones.
- Track current milestone, next step, blockers, decisions, and evidence references.
- Make progress mechanically visible for long tasks.

Artifacts:

- `knowledge/.ravo/workstream/*.json`

Status enum:

- `planned`
- `active`
- `blocked`
- `ready_for_acceptance`
- `closed`

Minimum artifact fields:

```json
{
  "schemaVersion": "0.2.0",
  "id": "workstream-id",
  "status": "active",
  "goal": "short goal",
  "specRef": "docs/ravo-v0.2-decision-complete-spec.md",
  "milestones": [],
  "currentMilestone": "",
  "nextStep": "",
  "blockers": [],
  "decisions": [],
  "evidenceRefs": [],
  "createdAt": "",
  "updatedAt": ""
}
```

Rules:

- Long-running tasks must have a non-empty `nextStep`.
- A blocked task must record a blocker and a recovery condition.
- Workstream does not judge release readiness; it hands evidence to acceptance.

### ravo-quick-validation

Responsibilities:

- Record fast checks as structured smoke evidence.
- Provide branch-level or phase-level validation before final acceptance.
- Mark risks that cannot be fully validated yet.

Artifacts:

- `knowledge/.ravo/quick-validation/*.json`

Status enum:

- `pass`
- `warn`
- `fail`
- `not_run`

Minimum artifact fields:

```json
{
  "schemaVersion": "0.2.0",
  "id": "smoke-id",
  "scope": "module or phase",
  "status": "pass",
  "checks": [],
  "evidenceRefs": [],
  "risks": [],
  "createdAt": ""
}
```

Rules:

- Smoke evidence is not final acceptance.
- `real-device-pending` is a risk marker, not a pass.
- Required smoke failures must block `ready_for_acceptance`.

### ravo-acceptance

Responsibilities:

- Verify evidence before delivery, release, go-live, readiness, done, or completion claims.
- Consume analysis, workstream, quick-validation, and acceptance artifacts.
- Write acceptance artifacts.
- Provide prompt-time and Stop-hook advisory only as fallback.

Artifacts:

- `knowledge/.ravo/acceptance/*.json`
- `knowledge/.ravo/continuation/*.json` for Stop telemetry continuation.

Status enum:

- `in_progress`
- `code_complete`
- `pending_acceptance`
- `accepted`
- `release_ready`
- `not_ready`

Evidence level enum:

- `none`
- `notes`
- `script`
- `api`
- `smoke`
- `real_e2e`

Rules:

- The main acceptance mechanism is Agent-initiated before final delivery claims.
- `UserPromptSubmit` is fallback advisory when the user asks about readiness.
- `Stop` is after-final telemetry only; it must not be used as a hard before-final gate.
- If evidence is incomplete, the Agent must say `not_ready`, `in_progress`, or `code_complete`, not `accepted`, `release_ready`, `live`, `已完成`, `验收通过`, or `可发版`.
- Real E2E means a realistic user journey, not merely passing scripts.

### ravo-knowledge

Responsibilities:

- Write workspace-local knowledge.
- Retrieve relevant knowledge before medium/high-complexity tasks.
- Apply retrieved knowledge explicitly in analysis or execution plans.
- Support opt-in user-level transferable lessons.

Artifacts:

- `knowledge/.ravo/knowledge/*.json`
- User-level transferable lessons only after explicit opt-in.

Knowledge kinds:

- `fact`
- `decision`
- `lesson`
- `principle`
- `evidence`

Minimum artifact fields:

```json
{
  "schemaVersion": "0.2.0",
  "id": "knowledge-id",
  "kind": "lesson",
  "scope": "workspace",
  "source": "",
  "content": "",
  "applicability": [],
  "confidence": 0.8,
  "redactionStatus": "not_required",
  "lastUsedAt": ""
}
```

Rules:

- Raw project facts are workspace-local by default.
- Transferable lessons are disabled by default.
- Transferable lessons require explicit opt-in, redaction, source, scope label, applicability, confidence, and canary leakage test.
- The Agent must state what knowledge was applied and what was not applicable when knowledge materially affects the result.

## Goal Prompt Authoring Contract

When the user asks Codex for a suggested Goal-mode prompt, Codex must not expand the Goal prompt into a large requirements document.

Flow:

1. Check whether a decision-complete requirement spec exists.
2. If an accepted spec exists, generate a concise Goal prompt that references the spec path and requires implementation according to the spec.
3. If no accepted spec exists, tell the user that a spec should be generated first and do not output any runnable Goal prompt, including short, temporary, or draft versions.
4. After generating the spec, return both:
   - the spec document link,
   - the matching Goal prompt.

Spec discovery order:

1. Use an explicit spec path from the user prompt when provided.
2. Otherwise inspect likely workspace docs in this order:
   - `docs/*decision-complete-spec*.md`
   - `docs/*spec*.md`
   - `knowledge/*spec*.md`
   - `knowledge/.ravo/analysis/*`
3. Treat a document as accepted only if it contains the decision-complete sections listed below or an explicit accepted/reviewed status.
4. If several candidate specs exist, use the newest accepted spec unless the user named a different target.
5. If no candidate is decision-complete, do not generate any runnable Goal prompt; offer to generate the spec first.

A spec is decision-complete only if it includes:

- product goal and consumer,
- in/out of scope,
- module or feature contracts,
- inputs and outputs,
- artifact or API shape where applicable,
- trigger rules,
- validation matrix,
- failure and fallback behavior,
- explicit assumptions.

This requirement applies to long-running, multi-module, high-risk, ambiguous, or autonomous Goal-mode tasks. Small, clear tasks may receive a direct Goal prompt without a separate spec.

Recommended response when no spec exists:

```text
当前还没有 decision-complete 的需求规格文档。这个目标会长时间自动执行，不能先输出临时或短版 Goal Prompt；建议先生成规格文档，规格确认后我会同时给出文档链接和配套 Goal Prompt。
```

Recommended Goal prompt pattern when a spec exists:

```text
目标：
严格按照 <spec path> 完成全部开发、验证、文档和验收工作。

完成标准：
1. 规格文档中的所有 required 能力均已实现。
2. 规格文档中的验证矩阵全部通过或明确记录阻塞原因。
3. 最终输出包含证据路径、剩余风险和提交信息。
```

Required Goal authoring validation scenarios:

- Existing spec: user asks for a suggested Goal prompt; output includes the spec link and a concise Goal prompt that references it.
- Missing spec: user asks for a suggested Goal prompt; output says a decision-complete spec should be generated first and produces no runnable Goal prompt.
- Newly generated spec: after spec generation, output includes both the spec link and the matching Goal prompt.
- Multiple specs: the Agent selects the newest accepted spec or asks only if multiple accepted specs target different products/modules.

## Natural Trigger Rules

RAVO should naturally trigger when the user asks for:

- requirement analysis,
- root-cause analysis,
- architecture or solution planning,
- long-running task execution,
- Goal prompt generation,
- readiness, acceptance, release, go-live, completed, or done conclusions,
- knowledge reuse or lessons learned.

RAVO should not force structure for:

- simple factual Q&A,
- term definitions,
- trivial one-line changes,
- clearly bounded implementation-only requests.

## Shared Artifact Protocol

All modules register in `knowledge/.ravo/manifest.json`.

Required manifest behavior:

- Preserve existing module entries.
- Update only the owning module's entry.
- Use atomic write through temporary file and rename.
- Treat artifact paths as workspace-relative.
- Do not use manifest as a scheduler.

## Validation Matrix

| Capability | Script Validation | Real Flow Validation |
|---|---|---|
| Core manifest | `node scripts/smoke-test.js` | New workspace init creates manifest and directories |
| Analysis | `node scripts/prompt-regression.js` | Natural requirement/root-cause prompts create advisory and artifacts |
| Workstream | New workstream regression | Long task creates plan, milestone, `nextStep`, and evidence index |
| Quick validation | New smoke manifest regression | Branch/phase validation writes smoke evidence and risk marker |
| Acceptance | Existing and expanded acceptance regression | Agent runs evidence check before delivery conclusion |
| Knowledge | New write/retrieve/apply regression | Similar task retrieves and applies workspace knowledge |
| Transferable lessons | Canary leakage regression | New workspace retrieves lesson without raw fact leakage |
| AGENTS integration | Existing `ravo-agents` tests | Diff preview, backup, idempotent apply, no silent modification |
| Natural governance | Prompt regression + real session | User does not need to explicitly say RAVO/plugin/skill |

## Required Real Session Tests

Use fresh Codex sessions or subagents. Prompts must sound like real user requests, not test instructions.

Scenario 1: requirement to execution planning

- Prompt: ask for a new ambiguous product capability.
- Expected: analysis artifact, spec or workstream recommendation, no premature implementation.

Scenario 2: long-running development

- Prompt: ask Codex to carry out a multi-step implementation goal.
- Expected: workstream artifact, milestone progress, `nextStep`, evidence refs.

Scenario 3: delivery conclusion

- Prompt: ask Codex to finish or summarize implemented work.
- Expected: Agent-initiated acceptance evidence check before any `done` claim.

Scenario 4: knowledge reuse

- Prompt: ask for a similar task in a new workspace after a lesson was created.
- Expected: transferable lesson retrieved, raw project fact not leaked.

## Versioning And Upgrade

v0.2.0 should update plugin versions consistently when implementation begins.

Stable plugin ids:

- `ravo-core`
- `ravo-analysis`
- `ravo-workstream`
- `ravo-quick-validation`
- `ravo-acceptance`
- `ravo-knowledge`

Upgrade must keep existing v0.1.x artifacts readable where possible.

## Final Acceptance Rules

RAVO v0.2 is not acceptable unless:

- repository validation passes,
- prompt regression passes,
- smoke test passes,
- new module tests pass,
- real session/subagent scenarios are recorded,
- model-review-council review has run or is explicitly marked partial/unavailable,
- RAVO acceptance check returns ready,
- final report states status, evidence paths, risks, commit, and push state.
