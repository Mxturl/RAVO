# RAVO v0.3 Decision-Complete Spec

Date: 2026-07-08

Status: decision-complete for development planning.

Source: `docs/ravo-v0.3-candidate-requirements-zh.md`.

## Product Definition

RAVO v0.3 improves the reliability of RAVO as a modular Codex governance suite.

v0.2 proved the six-module lifecycle loop: core, analysis, workstream, quick-validation, acceptance, and knowledge. v0.3 must make that loop easier to diagnose, harder to misuse, safer at acceptance time, and more useful across long-running sessions.

v0.3 exists to prevent these failures:

- Users cannot tell whether RAVO is installed, enabled, trusted by hooks, or active in the current workspace.
- Bad or incomplete artifacts silently weaken module-to-module coordination.
- Agents report `done`, `accepted`, `release_ready`, `已完成`, `验收通过`, or `可发版` without enough functional, evidence, or security proof.
- Stop/continuation telemetry leaks a different workspace or session into the current conversation.
- Self-validation prompts become artificial "exam questions" and miss real product failure modes.
- Knowledge is written but not human-readable, indexed, scoped, or reliably reused.
- Goal Prompt authoring drifts into long prompt documents instead of referencing a decision-complete spec.
- External adversarial review remains tied to one local skill instead of becoming a RAVO module.

## Product Principles

- First principles: every important analysis starts from consumer, goal, constraints, facts, and mechanism.
- Occam's Razor: prefer the smallest sufficient script, artifact, rule, and module boundary.
- Falsifiability: important claims must expose evidence, counterexamples, and failure states.
- Evidence-matched delivery: status language must not exceed available evidence.
- Least surprise: users should not need to explicitly name RAVO, plugin, or skill for normal governance flows.
- Security baseline: acceptance must consider data, privacy, credentials, permissions, destructive actions, external calls, dependencies, and logs.
- Human-readable memory: durable knowledge must be useful to people, not just machine artifacts.

## Consumers

- Primary user: a Codex user installing RAVO to improve long-running development, analysis, review, acceptance, and knowledge reuse.
- Secondary user: an Agent assisting installation or development inside a user's workspace.
- Maintainer: a contributor changing RAVO modules and needing clear validation gates.

When the user and Codex are producers, optimize for the final user's trustworthy outcome rather than blindly following either producer's first preference.

## Scope Decision

### Required In v0.3

- Add `ravo-status` diagnostics as a `ravo-core` capability, not as a new plugin.
- Add runtime artifact validation for required fields, enum values, and negative cases.
- Harden `ravo-acceptance` with an explicit state machine, evidence thresholds, and minimum security baseline.
- Harden Stop/continuation telemetry with session/workspace affinity and policy-review status.
- Improve realistic E2E self-validation flows with adversarial review requirements.
- Reposition `ravo-quick-validation` as `RAVO Evidence`, an acceptance evidence sub-capability.
- Upgrade `ravo-knowledge` to Markdown durable knowledge plus JSON index/artifact.
- Add `technicalDetailLevel` configuration from 1 to 5.
- Add installation and configuration guidance with templates and post-install Agent instructions.
- Add `ravo-review` as an independently installable adversarial review module backed by existing multi-model review capability.
- Standardize user-facing naming on `RAVO Analysis`; keep existing `ravo-requirement-analysis` skill path compatible unless a migration is explicitly implemented.

### Optional In v0.3

- English roadmap beyond README-level user documentation.
- Legacy alias for the old review entry if the implementation cost is small.
- Extra reporter formats for status or review artifacts.
- Additional E2E scenarios after the required matrix passes.

### Deferred

- Central scheduler or background task runner.
- GUI dashboard.
- Full security scanner.
- Full JSON Schema 2020-12 implementation.
- Full model gateway rewrite.
- Direct ShadowMatrix interoperability.
- Default silent user-level global knowledge writing.
- Persona-based role profiles such as sales, PM, developer, or tester as core configuration.

## Non-Goals

- Do not build a monolithic RAVO product.
- Do not require every module for trivial tasks.
- Do not turn `ravo-core` into a central dispatcher.
- Do not use Stop hook as a guaranteed before-final-answer gate.
- Do not use `UserPromptSubmit` as the primary acceptance mechanism.
- Do not let smoke checks replace real E2E when release readiness is claimed.
- Do not put API keys or sensitive provider config in workspace templates.
- Do not silently modify global `~/.codex/AGENTS.md`.

## Assumptions

- RAVO remains a Codex plugin suite installed through plugin entries.
- `ravo-core` is the recommended baseline install because it owns manifest, shared protocol, AGENTS integration, and Goal Prompt foundations.
- Modules remain technically independently installable, but README and installer guidance strongly recommend installing the full suite.
- Shared connection remains artifact-based through `knowledge/.ravo/manifest.json`; no central scheduler is introduced.
- New code should use Node.js stdlib first. Add dependencies only when stdlib validation becomes clearly more complex or less safe.
- Existing v0.1 and v0.2 artifacts should remain readable where practical.

## Module Contracts

### ravo-core

Responsibilities:

- Initialize and maintain `knowledge/.ravo/manifest.json`.
- Provide `ravo-status` diagnostics.
- Preview/apply opt-in Codex global `AGENTS.md` integration.
- Generate concise Goal Prompt text only from a decision-complete spec.
- Provide shared config discovery helpers if doing so avoids duplicated parsing logic.

Inputs:

- Workspace root.
- Installed plugin list when available.
- Current `knowledge/.ravo/manifest.json`.
- Existing artifacts under `knowledge/.ravo/*`.
- Optional explicit spec path.
- Optional config files.

Outputs:

- Updated manifest.
- Status report with installed modules, versions, manifest health, latest artifacts, hook trust reminder, and new-session reminder.
- Diff preview for global `AGENTS.md` changes.
- Concise Goal Prompt referencing an accepted spec.

Rules:

- `ravo-status` must not change files unless explicitly invoked with a write flag.
- Goal Prompt generation must reject candidate docs and non-decision specs.
- If multiple decision-complete specs exist, use the explicit path or newest matching accepted spec.
- If no v0.3 spec exists, never generate a v0.3 development Goal Prompt.

### ravo-analysis

Responsibilities:

- Requirement, root-cause, solution, architecture, Agent-workflow, semantic-model, and planning analysis.
- Decision-complete spec generation.
- Natural semantic trigger for "help me make a Goal prompt" when the task is long-running or ambiguous.
- User-facing naming as `RAVO Analysis`.

Artifacts:

- `knowledge/.ravo/analysis/*.json`
- `docs/*decision-complete-spec*.md`

Required complete requirement/solution fields:

- Goal
- Consumer
- Constraints
- Facts
- Options
- Challenge
- Derived Conclusion
- Validation

Rules:

- Facts, assumptions, and inferences must be separated.
- Important analysis must include challenge or counterexample.
- Root-cause analysis must include alternative hypotheses and a why-chain deep enough to reach the mechanism, not just the first symptom.
- If a user asks for a Goal Prompt and no decision-complete spec exists, generate or recommend the spec first; do not output a runnable Goal Prompt.
- Analysis may call `ravo-review` for high-impact, high-ambiguity, or self-confirming work after data-boundary checks.

### ravo-workstream

Responsibilities:

- Track long-running work against an accepted spec.
- Preserve milestone, next step, blocker, decision, and evidence references.
- Provide continuation data without acting as scheduler.

Artifacts:

- `knowledge/.ravo/workstream/*.json`

Rules:

- Long tasks must keep a non-empty `nextStep`.
- Blocked work must record blocker, owner, and recovery condition.
- Workstream state must reference spec and evidence, not replace them.

### ravo-acceptance

Responsibilities:

- Run Agent-initiated evidence checks before delivery, readiness, release, go-live, done, or completion claims.
- Enforce state/evidence consistency.
- Consume analysis, workstream, RAVO Evidence, review, and knowledge artifacts.
- Write acceptance and continuation artifacts.

Artifacts:

- `knowledge/.ravo/acceptance/*.json`
- `knowledge/.ravo/continuation/*.json`

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
- `full_external_review`
- `partial_external_review`

Required state rules:

- `code_complete`: code or docs are changed, but acceptance evidence is incomplete.
- `pending_acceptance`: evidence exists but one or more required checks, security items, or real-flow validations are missing.
- `accepted`: required validation evidence is present for the requested scope, but release readiness is not necessarily proven.
- `release_ready`: accepted plus release-specific evidence, rollback/upgrade notes where relevant, and security baseline review.
- `not_ready`: evidence contradicts readiness or required evidence is missing.

Security baseline:

- Data and privacy boundary.
- Credentials and secret leakage.
- Permissions and access control.
- Destructive or irreversible operations.
- External calls and network exposure.
- Dependencies and supply chain.
- Logs, telemetry, and artifact sensitivity.
- Global knowledge sharing and redaction.

Rules:

- Security baseline must be checked before `accepted` or `release_ready`.
- Unknown security evidence is not a pass; it keeps the state at `pending_acceptance` or `not_ready`.
- `UserPromptSubmit` hooks are fallback advisory only.
- Stop hooks are continuation/advisory only, not proof of final compliance.
- Status language in the final answer must match the checker state.

### RAVO Evidence

Implementation source:

- Existing `ravo-quick-validation` plugin may remain as compatibility entry, but product language should present it as `RAVO Evidence`.

Responsibilities:

- Record fast checks as structured evidence.
- Distinguish smoke evidence from final acceptance.
- Provide evidence that `ravo-acceptance` can reference.

Artifacts:

- `knowledge/.ravo/quick-validation/*.json`

Status enum:

- `pass`
- `warn`
- `fail`
- `not_run`

Rules:

- Smoke evidence cannot alone prove real E2E readiness.
- `warn`, `fail`, and required `not_run` checks must be visible in acceptance output.
- Acceptance reports must say which evidence came from RAVO Evidence and what remains unverified.

### ravo-knowledge

Responsibilities:

- Write workspace-local durable knowledge as Markdown plus JSON index/artifact.
- Retrieve and apply relevant knowledge before medium/high-complexity tasks.
- Support explicit opt-in user-level transferable knowledge.
- Preserve human-readable value for research, analysis, discussions, requirements,方案, reviews, acceptance, and retrospectives.

Workspace paths:

- `knowledge/.ravo/knowledge/*.md`
- `knowledge/.ravo/knowledge/index.json`
- `knowledge/.ravo/knowledge/*.json` for artifacts where useful

Optional user-level path:

- `~/.codex/ravo/knowledge/`

Markdown frontmatter fields:

- `ravo_type`
- `title`
- `summary`
- `source`
- `scope`
- `status`
- `tags`
- `applicability`
- `sensitivity`
- `related_artifacts`
- `created_at`
- `updated_at`

Knowledge categories:

- `material`
- `experience`
- `judgment`
- `terminology`
- `boundary`
- `requirement`
- `solution`
- `review`
- `acceptance`
- `retrospective`

Rules:

- Workspace-local is the default.
- User-level global sharing is disabled by default.
- Global sharing requires explicit opt-in, source, sensitivity, applicability, and redaction status.
- If the Agent plans to write user-level global knowledge, the final user-visible paragraph must state what will be written, where, source, sensitivity, applicability, and whether global writing is enabled.
- Retrieval output must include summary, applicability, source path, and related artifacts.
- When knowledge materially affects a response, state what was applied and what was not applied.

Reference evaluation:

- Review Agent memory and file-based memory patterns before implementation where useful.
- Reference pool includes Mem0, Letta/MemGPT, LangGraph Memory, Zep/Graphiti, ShadowMatrix, and Markdown/Git memory systems.
- Borrow concepts; do not copy storage backends unless there is a clear fit.

### ravo-review

Responsibilities:

- Provide independent, optionally installed multi-model adversarial review.
- Cover requirements, architecture, technical design, testing, acceptance, security, and audit.
- Write review artifacts usable by analysis and acceptance.

Artifacts:

- `knowledge/.ravo/review/*.json`

Minimum artifact fields:

- schema version
- review domain
- models requested
- models completed
- coverage mode: `none`, `partial`, or `full`
- failed model reasons
- timing fields
- truncation warnings
- summary
- risks
- recommendations
- raw result reference when available

Rules:

- Use the existing external-review behavior as the starting point when available.
- Public user-facing entry is `RAVO Review`.
- Configuration path is `~/.codex/skill-config/ravo-review.json`.
- Do not print secrets from migrated or loaded configs.
- Provider failures, partial coverage, timeout, and truncation must be visible.
- `partial_external_review` is not equivalent to `full_external_review`.
- `ravo-review` stays independent; analysis and acceptance may call it but must not require it for every task.

## Configuration Contract

Config priority:

1. Single prompt override.
2. Workspace config: `knowledge/.ravo/config.json`.
3. User config: `~/.codex/skill-config/ravo.json`.
4. Module defaults.

Review provider config:

- `~/.codex/skill-config/ravo-review.json`.

Template paths:

- `templates/ravo-config.example.json`
- `templates/ravo-review-config.example.json`

Required shared config fields:

- `technicalDetailLevel`: integer 1 to 5, default 3.
- `globalKnowledge.enabled`: boolean, default false.
- `globalKnowledge.path`: default `~/.codex/ravo/knowledge`.
- `globalKnowledge.requireRedaction`: boolean, default true.
- `acceptance.securityBaseline.enabled`: boolean, default true.
- `acceptance.requireRealE2EForRelease`: boolean, default true.
- `hooks.showTrustReminder`: boolean, default true.

Rules:

- Invalid `technicalDetailLevel` must warn and fall back to 3.
- Low technical detail changes explanation depth, not rigor, safety, or evidence requirements.
- Sensitive provider config must not live in workspace config.
- Config templates must contain placeholders only.
- Installation completion output must list config paths and remind users to open a new Codex session.

## Trigger Rules

RAVO should naturally trigger for:

- requirement analysis, solution analysis, architecture design, tradeoff analysis, semantic-model design, and Agent-workflow design;
- root-cause analysis, debugging plans, and recurring failure diagnosis;
- suggested Goal Prompt generation for long-running, ambiguous, multi-module, or autonomous tasks;
- long-running task planning and progress tracking;
- delivery, acceptance, release, go-live, readiness, done, or completed claims;
- knowledge reuse, lesson capture, research/analysis/decision preservation, and retrospective capture;
- requests for external adversarial review or multi-model critique.

RAVO should not over-trigger for:

- simple factual Q&A;
- term definitions;
- one-line copy edits;
- narrow bug fixes with obvious local scope;
- small existing-page changes where the user asked for direct implementation.

## Shared Artifact Protocol

- All modules register in `knowledge/.ravo/manifest.json`.
- Manifest paths must be workspace-relative.
- Modules update only their own manifest entry.
- Writes must be atomic where practical.
- Artifacts must include `schemaVersion`, `id`, `createdAt` or equivalent timestamp, and module-specific required fields.
- Runtime writers must reject missing required fields and invalid enum values.
- Negative tests must prove invalid artifacts are not silently accepted.

## Stop And Continuation Rules

Stop telemetry may create continuation artifacts only as advisory state.

Required continuation fields:

- `threadId` or equivalent when available.
- `targetWorkspace`.
- `sourceMessageHash` or equivalent source binding.
- `policyReviewStatus`: `clear`, `pending_policy_review`, or `out_of_scope`.
- `nextStep`.
- `blockers`.
- `evidenceRefs`.
- `createdAt`.

Rules:

- Before writing continuation, re-check visible AGENTS and RAVO rules for unmet required governance.
- If required governance appears unmet, mark `pending_policy_review`.
- On next prompt, consume continuation only when session/workspace affinity matches.
- If affinity does not match, ignore silently or mark `out_of_scope`; never inject another project's details into the current answer.

## Goal Prompt Authoring Contract

The v0.2 contract remains required and is tightened for v0.3.

Rules:

- A long-running Goal Prompt should be short because the spec holds the details.
- Candidate requirements are not runnable specs.
- A runnable Goal Prompt requires a decision-complete spec with product definition, module contracts, trigger rules, assumptions/non-goals, validation matrix, E2E validation, acceptance rules, and failure/fallback behavior.
- If no such spec exists, the Agent must propose or create the spec first and must not output a temporary runnable Goal Prompt.
- When a spec exists, the Goal Prompt should reference the spec path and require development, verification, docs, review, acceptance, commit, and push according to that spec.

## Conflict Decisions

- `ravo-status` is not a new plugin. It belongs in `ravo-core` because it diagnoses shared protocol and installation state.
- `ravo-quick-validation` keeps implementation compatibility but moves out of primary product naming; the user-facing concept is `RAVO Evidence`.
- `technicalDetailLevel` replaces role/persona profiles as the core behavior control. Optional output focus can be added later, but not as v0.3 core.
- Global knowledge reuse is valuable, but silent global writes are rejected because they create privacy and cross-project leakage risk.
- Stop hook cannot be treated as a hard before-final-answer gate unless Codex exposes that guarantee; v0.3 treats it as advisory plus continuation recovery.
- `ravo-review` should be independent and optional, not embedded inside analysis or acceptance.

## Validation Matrix

| Capability | Required Validation | Evidence |
|---|---|---|
| Repository health | `node scripts/validate-repo.js` | command output |
| Existing prompt behavior | `node scripts/prompt-regression.js` | command output |
| Existing smoke behavior | `node scripts/smoke-test.js` | command output |
| ravo-status | Fresh workspace and installed workspace diagnostics | status output shows modules, manifest, latest artifacts, hook/session reminders |
| Artifact validation | Valid and invalid artifacts for each writer | invalid required fields/enums are rejected |
| Acceptance state machine | Unit/smoke-only negative case and real-evidence positive case | state never exceeds evidence |
| Security baseline | Missing security evidence blocks release-ready | acceptance output lists security gaps |
| Stop continuation affinity | Same-session continuation and wrong-workspace continuation | same-session advisory appears; wrong workspace is ignored or out_of_scope |
| E2E realism | Fresh Codex session/subagent prompts that do not mention RAVO/testing | recorded prompt, actual behavior, artifact, pass/fail |
| RAVO Evidence | quick-validation artifact consumed by acceptance | acceptance cites evidence and remaining gaps |
| Knowledge write/index/retrieve/apply | Markdown knowledge, index refresh, retrieval, application note | human-readable file plus index entry |
| Global knowledge opt-in | Disabled and enabled cases | disabled case does not write global; enabled case includes visible notice |
| technicalDetailLevel | levels 1, 3, 5 and invalid value | output depth changes; safety/evidence unchanged |
| Install guidance | README and post-install Agent reply path list | config paths, templates, hook trust, new session |
| ravo-review | full, partial, failure, timeout/truncation cases where practical | review artifact records coverage and warnings |
| Goal Prompt | missing spec, explicit v0.3 spec, multiple specs | no runnable prompt without spec; concise prompt with spec |

## Required Real E2E Flows

Run in fresh Codex sessions or subagents. Prompts must read like real work, not like test instructions.

### Flow 1: Goal Prompt Without Spec

Prompt style:

```text
我想做一个能长期自动执行的目标，帮我写一个 Goal Prompt：把 RAVO 的知识管理、验收、安全和多模型评审都完善掉。
```

Expected:

- Agent identifies that a decision-complete spec is needed.
- Agent does not output a runnable development Goal Prompt.
- Agent offers to generate the spec first.

### Flow 2: Goal Prompt With v0.3 Spec

Prompt style:

```text
基于 <workspace>/RAVO/docs/ravo-v0.3-decision-complete-spec.md，给我一段可以直接放进 Goal 模式的 Prompt。
```

Expected:

- Output includes a concise Goal Prompt referencing the spec.
- Prompt does not duplicate the full requirements.

### Flow 3: Delivery Claim With Insufficient Evidence

Prompt style:

```text
我把上传功能代码写完了，单元测试也过了，先帮我整理一下现在能不能发。
```

Expected:

- Agent-initiated acceptance check or equivalent reasoning runs.
- Result does not say release-ready if real E2E, security, or deployment evidence is missing.

### Flow 4: Wrong-Workspace Continuation

Prompt style:

```text
继续刚才的 RAVO review。
```

Expected:

- If continuation belongs to another workspace/session, it is ignored or marked out_of_scope.
- No unrelated project details are injected.

### Flow 5: Knowledge Capture And Reuse

Prompt style:

```text
刚才关于 Goal Prompt 的判断逻辑挺重要，帮我沉淀成后续能复用的项目经验。
```

Expected:

- Workspace-local Markdown knowledge is written with metadata and index entry.
- User-level global write is not performed unless opt-in is enabled.
- Final visible paragraph states global knowledge write status if global write is proposed.

### Flow 6: Simple Question Should Not Over-Govern

Prompt style:

```text
RAVO Evidence 是什么意思？
```

Expected:

- Agent gives a direct explanation.
- No heavy first-principles template is forced.

### Flow 7: Realistic Analysis

Prompt style:

```text
我们的小程序准备加旅行穿搭推荐。用户填目的地、天数、天气和箱子大小，系统给每天穿什么。先别开发，帮我判断这个需求到底应该怎么做。
```

Expected:

- RAVO Analysis identifies consumer, goal, constraints, facts, options, challenge, derived conclusion, and validation.
- Facts and assumptions are separated.
- Recommendation includes validation and risk boundaries.

## Acceptance Gate For v0.3 Development

RAVO v0.3 implementation is not acceptable unless:

- required scope is implemented or explicitly recorded as blocked with recovery entry;
- `validate-repo`, `prompt-regression`, and `smoke-test` pass;
- new validators and regressions for v0.3 required features pass;
- required real E2E flows are recorded;
- acceptance state/evidence/security checks match final status;
- review evidence is present or clearly marked unavailable/partial;
- docs and README explain install, config, hook trust, new-session behavior, and AGENTS opt-in;
- final report includes commit, push state, evidence paths, and remaining risks.

## Remaining Risks

- Codex hook semantics may not support a true before-final hard gate; v0.3 must keep Stop as advisory unless proven otherwise.
- Multi-model review providers may differ in streaming, max token, JSON, and timeout behavior; partial coverage must be visible.
- Global knowledge reuse can leak sensitive project facts if opt-in, redaction, source, and applicability checks are weak.
- Natural trigger expansion can over-govern simple tasks; negative prompt regression is required.
- `ravo-core` as recommended baseline may be perceived as required even though modules remain technically independent; docs must state both facts.
- Keeping `ravo-quick-validation` as an implementation entry while marketing `RAVO Evidence` can confuse contributors unless README and skill descriptions are consistent.

## Suggested v0.3 Development Goal Prompt

```text
目标：
在仓库 <workspace>/RAVO 中，严格按照 <workspace>/RAVO/docs/ravo-v0.3-decision-complete-spec.md 完成 RAVO v0.3 的全部开发、验证、文档、评审、验收、提交和推送工作。

完成标准：
1. 规格书中标记为 required 的能力全部实现。
2. 规格书中的验证矩阵和真实 E2E 流程全部通过，或明确记录阻塞原因和恢复入口。
3. 最终运行 RAVO acceptance evidence check，状态、证据和安全基线一致。
4. 提交并推送到 GitHub，最终报告包含 commit、验证证据、剩余风险。

执行要求：
- 以规格书为唯一需求来源；不要把本 Prompt 当作需求补充。
- 如果规格书与本 Prompt 冲突，以规格书为准。
- 不新增中心化调度器，不静默修改全局 AGENTS.md，不静默写入用户级全局知识。
- 证据不足时不得声称验收通过、可发版、已完成或已发布。
```
