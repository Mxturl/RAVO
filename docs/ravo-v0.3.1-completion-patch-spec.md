# RAVO v0.3.1 Completion Patch Spec

Date: 2026-07-08

Status: decision-complete for development planning.

Source: post-v0.3 gap review after `e525c03`.

## Product Definition

RAVO v0.3.1 completes the parts of v0.3 that were present as product intent but not fully implemented as runtime behavior.

v0.3 delivered the modular governance loop, stronger acceptance, realistic E2E records, status diagnostics, and the initial `ravo-review` and `ravo-knowledge` modules. v0.3.1 must close the remaining gap between "documented capability" and "usable capability" for external review and knowledge capture.

v0.3.1 exists to prevent these failures:

- Agents keep looking for the legacy review entry instead of using the public `RAVO Review` entry.
- `ravo-review` records artifacts but cannot actually run configured provider/model reviews.
- Important review evidence is recorded as `partial` even when provider config exists.
- Knowledge is only captured when the user explicitly asks, so useful lessons from analysis, requirements, reviews, and acceptance are lost.
- User-level transferable knowledge can be under-specified or silently skipped without a visible opt-in boundary.
- Acceptance can report readiness without clearly consuming review and knowledge evidence.
- Installed plugin cache and source repo drift is not caught before E2E validation.

## Product Principles

- RAVO has no central dispatcher: `AGENTS.md` decides when to delegate; the selected RAVO module decides how to execute.
- RAVO Review is the public review entry. Legacy names must not appear in user-facing routing, docs, or final reports.
- Evidence must be falsifiable: review coverage, model failures, timeout, truncation, and degraded execution are visible.
- Knowledge must be human-readable first and machine-discoverable second.
- Workspace-local knowledge is safe by default; user-level knowledge requires explicit opt-in and redaction metadata.
- Hooks may suggest, capture, or warn, but must not silently leak project facts into user-level global storage.
- Minimal implementation first: use Node.js stdlib, local files, and current artifact protocol before adding dependencies.

## Consumers

- Primary user: a Codex/RAVO user relying on RAVO to review high-impact decisions and preserve reusable lessons without manual ceremony.
- Secondary user: an Agent installing, upgrading, or operating RAVO in another user's workspace.
- Maintainer: a contributor changing RAVO modules and needing deterministic validation before release.

When the user and Codex are producers, optimize for the final user's trustworthy outcome.

## Scope Decision

### Required In v0.3.1

- Replace remaining user-facing legacy review-entry references with `ravo-review` / `RAVO Review`.
- Update global Codex `~/.codex/AGENTS.md` routing to prefer `ravo-review` for important proposals, high-risk plans, realistic E2E design, and release-sensitive judgments.
- Add `ravo-review` live runner that reads `~/.codex/skill-config/ravo-review.json`, calls configured providers/models, and writes review artifacts.
- Support both current flat review config and provider-array config from `templates/ravo-review-config.example.json`.
- Never print API keys, tokens, or sensitive provider config.
- Detect and record full, partial, none, failure, timeout, provider-error, and likely truncation states.
- Add `--no-stream` or equivalent buffered fallback when streaming is unsupported or fails.
- Add fake-provider tests for success, partial failure, timeout, truncation, and redaction.
- Add `ravo-knowledge` closeout/capture path that can turn Agent-provided session summaries into Markdown + JSON + index artifacts.
- Add knowledge capture advisory for task closeout or Stop where practical, without treating Stop as a hard before-final gate.
- Add knowledge retrieval advisory for medium/high-complexity tasks, not only prompts that explicitly mention knowledge or lessons.
- Enforce user-level knowledge metadata: source, sensitivity, applicability, redaction status, and explicit opt-in.
- Add acceptance discovery for latest review and knowledge artifacts, and expose whether they support, warn, or block the current status.
- Update README/README_ZH with live `RAVO Review` setup, provider config migration, verification commands, and knowledge closeout behavior.
- Add regression checks that prevent reintroducing legacy review-skill naming in user-facing docs, skills, AGENTS snippet, and final report templates.
- Reinstall local RAVO plugins after source changes before fresh Codex E2E validation.

### Optional In v0.3.1

- Add a one-shot migration script from legacy review config path to `~/.codex/skill-config/ravo-review.json`.
- Add raw review response sidecar files under `knowledge/.ravo/review/raw/`.
- Add a compact `ravo-review --dry-run-config` mode.
- Add configurable knowledge closeout thresholds.

### Deferred

- GUI dashboard.
- Central scheduler or background job runner.
- Full model gateway rewrite.
- Full security scanner.
- Direct ShadowMatrix interoperability.
- Default silent user-level global knowledge writing.
- Semantic/vector memory database.
- Hard before-final-answer gate.

## Module Contracts

### Global AGENTS.md Integration

Responsibilities:

- Route important review scenarios directly to `ravo-review` when available.
- Keep data-boundary checks before external model calls.
- Preserve fallback behavior when RAVO is unavailable.

Rules:

- Do not route to an abstract `ravo` dispatcher.
- Do not reference legacy review-skill names.
- Do not silently edit global `AGENTS.md`; show the intended replacement and require explicit user approval unless the user directly asks to apply it.

### ravo-review

Responsibilities:

- Run live adversarial/multi-model review when configured.
- Record review artifacts even when coverage is partial or failed.
- Cover requirements, architecture, technical design, tests, acceptance, security, auditability, Agent workflows, and long-running plans.

Inputs:

- Review domain.
- Review subject text, file, or stdin.
- Workspace root.
- `~/.codex/skill-config/ravo-review.json`.
- Optional provider/model overrides.
- Optional stream/no-stream choice.

Outputs:

- `knowledge/.ravo/review/*.json`.
- Optional raw sidecar file if the response is long or malformed.
- Manifest update under `knowledge/.ravo/manifest.json`.

Required artifact fields:

- `schemaVersion`
- `id`
- `domain`
- `coverage`: `none`, `partial`, or `full`
- `modelsRequested`
- `modelsCompleted`
- `modelsFailed`
- `failedModelReasons`
- `timing`
- `truncationWarnings`
- `summary`
- `risks`
- `recommendations`
- `rawResultRef`
- `createdAt`

Config rules:

- Flat config is supported: `apiBase`, `apiMode`, `apiKey`, `models`.
- Provider-array config is supported: `providers[].apiBase`, `apiMode`, `apiKey`, `models[]`.
- Disabled providers or models are skipped and recorded only when explicitly requested.
- API keys must be read from config or environment but never printed.
- Missing provider config results in `coverage=none`, not a false success.

Execution rules:

- Full coverage means every enabled/requested model completed with usable findings.
- Partial coverage means at least one model completed but one or more requested models failed, timed out, truncated, or were skipped.
- Provider failures, timeout, stream errors, unsupported params, and truncation must be visible in the artifact.
- `partial_external_review` is not equivalent to `full_external_review`.
- Runner must not require every user to configure providers; absence of config is an explicit unavailable state.

### ravo-knowledge

Responsibilities:

- Retrieve relevant knowledge before medium/high-complexity work.
- Capture durable workspace-local knowledge from explicit user requests and Agent closeout summaries.
- Support opt-in user-level transferable knowledge with strict metadata and redaction checks.

Inputs:

- Workspace root.
- User prompt.
- Optional closeout summary from the Agent.
- Optional related artifact paths.
- Optional user-level opt-in flag.

Outputs:

- `knowledge/.ravo/knowledge/*.md`
- `knowledge/.ravo/knowledge/*.json`
- `knowledge/.ravo/knowledge/index.json`
- Optional `~/.codex/ravo/knowledge/*.md` and `.json` only after explicit opt-in.

Capture rules:

- Hooks may advise capture, but the Agent or capture script must provide the actual summary; the hook must not invent hidden conversation content.
- Workspace-local capture may be automatic for explicit knowledge-capture prompts.
- For generic task closeout, capture may be advisory by default unless the user has enabled workspace auto-capture.
- User-level global capture must require explicit opt-in plus source, sensitivity, applicability, redaction status, and canary leakage checks.
- Final visible output must state what was captured, where, and whether user-level global knowledge was disabled or enabled.

Retrieval rules:

- Retrieval output must include summary, applicability, source path, sensitivity, and related artifacts.
- Complete JSON artifacts outrank stale index entries.
- When retrieved knowledge affects a response, state what was applied and what was not applicable.
- For medium/high-complexity analysis, planning, architecture, review, acceptance, and long-running work, retrieve workspace knowledge even if the user does not explicitly say "knowledge".

### ravo-acceptance

Responsibilities:

- Consume review and knowledge evidence in addition to analysis, workstream, and RAVO Evidence.
- Keep status language aligned with evidence.

Rules:

- If release readiness depends on external review, distinguish `full_external_review`, `partial_external_review`, and unavailable review.
- Knowledge artifacts can support continuity and prior lessons, but cannot replace functional validation.
- Acceptance output must list review and knowledge evidence when present and identify remaining gaps.

### ravo-core

Responsibilities:

- Keep `ravo-status` accurate for `ravo-review` and `ravo-knowledge`.
- Report installed-vs-source drift when practical.
- Keep AGENTS integration preview aligned with v0.3.1 routing.

Rules:

- `ravo-core` remains protocol/status/AGENTS/Goal Prompt support, not a dispatcher.
- AGENTS snippets should route to concrete modules such as `ravo-analysis`, `ravo-review`, `ravo-acceptance`, and `ravo-knowledge`.

## Configuration Contract

Config priority:

1. Single prompt override.
2. Workspace config: `knowledge/.ravo/config.json`.
3. User config: `~/.codex/skill-config/ravo.json`.
4. Module config: `~/.codex/skill-config/ravo-review.json`.
5. Module defaults.

Review provider config:

- Primary path: `~/.codex/skill-config/ravo-review.json`.
- Legacy review config names must not be documented as active user-facing paths.
- Optional migration may read a legacy file only to copy values into the RAVO Review config, without printing secrets.

Knowledge config:

- `globalKnowledge.enabled`: default `false`.
- `globalKnowledge.path`: default `~/.codex/ravo/knowledge`.
- `globalKnowledge.requireRedaction`: default `true`.
- `knowledge.autoCaptureWorkspace`: default `false` unless explicitly enabled.
- `knowledge.closeoutAdvisory`: default `true`.

## Trigger Rules

RAVO Review should naturally trigger for:

- important proposals, architecture designs, high-risk implementation plans;
- realistic E2E test designs and self-validation plans;
- release-sensitive judgments;
- security-sensitive or data-boundary-sensitive decisions;
- user requests for adversarial review, external review, multi-model critique, or independent challenge.

RAVO Knowledge should naturally trigger for:

- explicit knowledge capture, lesson, experience, retrospective, reuse, or "remember this" prompts;
- medium/high-complexity analysis, architecture, planning, review, acceptance, and long-running work where prior knowledge may affect the result;
- task closeout when the Agent can identify reusable lessons, decisions, constraints, or acceptance outcomes.

RAVO should not over-trigger for:

- simple factual Q&A;
- term definitions;
- one-line copy edits;
- narrow local bug fixes with no reusable lesson;
- routine review when no provider config exists and no review was requested.

## Validation Matrix

| Capability | Required Validation | Evidence |
|---|---|---|
| Repository health | `node scripts/validate-repo.js` | command output |
| Prompt regressions | `node scripts/prompt-regression.js` | command output |
| Smoke suite | `node scripts/smoke-test.js` | command output |
| Legacy review naming removal | Search user-facing docs/skills/AGENTS snippet for legacy review name | no matches outside historical notes or migration tests |
| AGENTS routing | Preview/apply target text routes direct to `ravo-review` | diff preview and idempotence |
| Review config loading | Flat and provider-array config fixtures | parsed without printing secrets |
| Review runner success | fake provider returns usable findings for all requested models | `coverage=full` artifact |
| Review runner partial | one fake model succeeds and one fails | `coverage=partial`, failed reasons visible |
| Review runner unavailable | no provider config | `coverage=none`, no false success |
| Review timeout/truncation | fake timeout and length finish | timeout/truncation warnings visible |
| Knowledge explicit capture | explicit lesson prompt writes Markdown + JSON + index | paths and metadata present |
| Knowledge closeout advisory | task closeout or Stop suggests capture without leaking global knowledge | advisory output and no user-level write |
| Knowledge retrieval | medium/high-complexity prompt retrieves relevant workspace knowledge | retrieval summary and applied/not-applied note |
| User-level knowledge opt-in | disabled and enabled cases | disabled writes none; enabled requires metadata and redaction |
| Acceptance evidence consumption | review and knowledge artifacts discovered | acceptance output lists support/gaps |
| Installed cache consistency | reinstall local plugins before fresh E2E | installed skill text matches source behavior |
| Real E2E | Fresh Codex sessions/subagents for review, knowledge, AGENTS routing, and no-overgovern cases | recorded prompts, outputs, artifacts, pass/fail |

## Required Real E2E Flows

Run in fresh Codex sessions or subagents. Prompts must read like real work, not tests.

### Flow 1: Review A High-Impact Plan

Prompt style:

```text
我准备把 RAVO 的评审能力从记录 artifact 升级成真正调用多模型 Provider。先别开发，帮我做一次对抗式评审，看看这个方案有没有明显风险。
```

Expected:

- Uses `RAVO Review` as the public entry.
- Performs data-boundary check.
- If provider config is available, runs configured models and records full/partial/failure artifact.
- If unavailable, records `coverage=none` and explains the missing config without naming legacy skills.

### Flow 2: Knowledge Closeout

Prompt style:

```text
刚才这轮关于 Goal Prompt、评审和知识沉淀的判断挺关键，帮我把能复用的经验沉淀下来。
```

Expected:

- Writes workspace-local Markdown + JSON + index.
- Final answer states local path and global knowledge status.
- Does not modify product/source/docs outside knowledge artifacts.

### Flow 3: Medium-Complexity Work Reuses Knowledge

Prompt style:

```text
我们接下来要做一个长程插件升级，先帮我判断应该从哪里开始，不要直接写代码。
```

Expected:

- Retrieves relevant workspace knowledge even though the prompt did not say "knowledge".
- States which knowledge was applied and which was not applicable if it affects the recommendation.

### Flow 4: Acceptance Consumes Review And Knowledge

Prompt style:

```text
我已经把这轮 RAVO 升级做完了，脚本也过了。现在能不能说可以发版？
```

Expected:

- Agent-initiated acceptance checks include review and knowledge evidence.
- Missing full review or real E2E prevents `release_ready` unless other evidence satisfies the release rule.
- Status language matches evidence.

### Flow 5: Simple Question Does Not Trigger Heavy Governance

Prompt style:

```text
RAVO Review 是什么？
```

Expected:

- Direct explanation.
- No forced first-principles or review-run template.

## Acceptance Gate For v0.3.1

RAVO v0.3.1 is not acceptable unless:

- required scope is implemented or explicitly recorded as blocked with recovery entry;
- legacy review-skill user-facing naming is removed;
- `ravo-review` can run configured fake/live provider paths and record full/partial/failure/timeout/truncation coverage;
- `ravo-knowledge` can capture closeout knowledge and retrieve relevant knowledge for medium/high-complexity work;
- `ravo-acceptance` discovers review and knowledge artifacts;
- `validate-repo`, `prompt-regression`, and `smoke-test` pass;
- required fresh Codex session/subagent E2E flows are recorded;
- final RAVO acceptance evidence check returns a status consistent with evidence;
- local plugin cache is refreshed before E2E validation;
- final report includes commit, push state, evidence paths, and remaining risks.

## Failure And Fallback Behavior

- If review config is missing, record `coverage=none`; do not claim external review happened.
- If some models fail, record `coverage=partial`; do not upgrade to full review.
- If JSON parsing fails but raw content exists, save raw reference and summarize best-effort findings with truncation or parse warnings.
- If provider rejects streaming, retry buffered mode when allowed.
- If user-level knowledge metadata is incomplete, block global write and keep workspace-local capture only.
- If hooks are not trusted or not loaded, scripts and skills remain manually callable and docs must state this.
- If real E2E cannot run, keep status below release-ready and document recovery entry.

## Non-Goals

- Do not add a central RAVO dispatcher.
- Do not require review providers for routine tasks.
- Do not store API keys in workspace.
- Do not silently write user-level global knowledge.
- Do not use Stop hook as a hard final-answer gate.
- Do not build a vector database or memory service.
- Do not replace all historical knowledge references where preserving history matters; remove legacy naming from current user-facing routing and docs.

## Remaining Risks

- Real provider APIs may differ in streaming, JSON, token-limit, and error semantics; fake-provider tests cannot prove every provider behavior.
- Hook timing still cannot guarantee before-final enforcement; closeout capture remains advisory unless the user or Agent invokes it.
- Automatic knowledge retrieval can over-influence responses if stale knowledge is not challenged; responses must state applied and ignored knowledge.
- Removing legacy review naming may break users who still know the old skill name; RAVO should explain the new public entry in README and migration notes.
