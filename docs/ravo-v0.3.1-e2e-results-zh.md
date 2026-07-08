# RAVO v0.3.1 Fresh E2E Results

Date: 2026-07-08

Scope: fresh Codex local threads against `/Users/apple/Developer/AICODING/RAVO` after reinstalling RAVO plugins to `0.3.1`.

## Summary

| Flow | Thread | Result | Evidence |
|---|---|---|---|
| Review high-impact plan | `019f425d-0dae-7593-a88f-0d11ac1175a2` | PASS | Real single-model review artifact written with `coverage=partial` and truncation warning. |
| Knowledge closeout | `019f4248-009f-7bd1-bd6f-53b9d20e00c4` | PASS | Workspace-local Markdown/JSON knowledge written; user-level global knowledge not written. |
| Medium-complexity work reuses knowledge | `019f4248-02c9-7ad3-99f2-6a965edc370b` | PASS | Retrieved RAVO knowledge and wrote analysis artifact before recommending a starting point. |
| Acceptance consumes review and knowledge | `019f4248-03de-7d43-9463-753607856823` | PASS | Refused release-ready claim; wrote current evidence acceptance artifact. |
| Simple question no heavy governance | `019f424d-2119-75e0-9644-6ae8d9bcbe32` | PASS after fix | Direct explanation; no forced analysis/review template and no legacy review-skill name. |

## Flow Details

### 1. Review High-Impact Plan

Prompt:

```text
我准备把 RAVO 的评审能力从记录 artifact 升级成真正调用多模型 Provider。先别开发，先用一个可用模型做最小对抗式评审，最多等 60 秒，看看这个方案有没有明显风险。
```

Expected:

- Use RAVO Review as the public entry.
- Check data boundaries before external review.
- Run a bounded provider review when config exists.
- Record coverage and warnings without treating partial review as full review.

Actual:

- Used RAVO Analysis, RAVO Knowledge, RAVO Review, and RAVO Acceptance.
- Sent only an abstract proposal, not secrets, paths, or customer data.
- Wrote review artifact `knowledge/.ravo/review/2026-07-08T15-36-45-896Z-architecture.json`.
- Artifact recorded `coverage=partial`, model `default/minimax-m3` completed, and truncation warning `likely truncation (length)`.
- Wrote analysis artifact `knowledge/.ravo/analysis/2026-07-08T15-37-22-909Z-ravo-review-provider-upgrade-minimal-adversarial.json`.
- Wrote acceptance artifact `knowledge/.ravo/acceptance/2026-07-08T15-37-32-141Z-minimal-one-model-adversarial-ravo-review-run-ag.json`.

### 2. Knowledge Closeout

Prompt:

```text
刚才这轮关于 Goal Prompt、评审和知识沉淀的判断挺关键，帮我把能复用的经验沉淀下来。
```

Expected:

- Write workspace-local Markdown and JSON knowledge.
- State local path and global knowledge status.
- Do not modify product/source/docs outside knowledge artifacts.

Actual:

- Wrote `knowledge/.ravo/knowledge/2026-07-08T15-12-56-795Z-1-goal-prompt-decision-complete-spec-spec-goal-p.md`.
- Final output stated user-level global knowledge was not written.
- No source code changes were made by the E2E thread.

### 3. Medium-Complexity Work Reuses Knowledge

Prompt:

```text
我们接下来要做一个长程插件升级，先帮我判断应该从哪里开始，不要直接写代码。
```

Expected:

- Retrieve relevant workspace knowledge even without an explicit "knowledge" keyword.
- State applied/not-applicable knowledge when it affects the recommendation.

Actual:

- Used RAVO Knowledge and RAVO Analysis.
- Applied the Goal Prompt/spec-first lesson.
- Wrote `knowledge/.ravo/analysis/2026-07-08T15-12-55-987Z-ravo-v0-3-1-long-plugin-upgrade-start-point.json`.
- Did not write user-level global knowledge.

### 4. Acceptance Consumes Review And Knowledge

Prompt:

```text
我已经把这轮 RAVO 升级做完了，脚本也过了。现在能不能说可以发版？
```

Expected:

- Run acceptance checks proactively.
- Refuse release-ready if current evidence is insufficient.
- Consider review and knowledge evidence.

Actual:

- Ran validation scripts.
- Refused "可以发版".
- Wrote `knowledge/.ravo/acceptance/2026-07-08T15-13-08-287Z-current-ravo-worktree-scripts-pass-release-level.json`.
- Correctly stated current status as `code_complete`, not `release_ready`.

### 5. Simple Question Does Not Trigger Heavy Governance

Prompt:

```text
RAVO Review 是什么？
```

Expected:

- Direct explanation.
- No forced first-principles structure.
- No review run.
- No legacy review-skill name in final answer.

Actual:

- First attempt exposed over-triggering because delegated prompts wrapped the user input in XML.
- Fixed `ravo-knowledge-gate.js` to extract `<input>...</input>` before trigger matching.
- Added prompt regression for delegated simple FAQ.
- Re-ran thread `019f424d-2119-75e0-9644-6ae8d9bcbe32`; final answer was a direct explanation with no heavy template and no legacy review-skill name.

## Issues Found And Fixed During E2E

- `run-review.js` did not support flat config `models` as a string; fixed and covered in smoke tests.
- `run-review.js` assumed `apiBase` already included `/responses`; fixed endpoint normalization for `responses` and `chat` modes.
- `run-review.js --help` could continue into execution; fixed with explicit help output.
- `run-review.js` lacked bounded timeout override; added `--timeout-ms`.
- `ravo-knowledge-gate.js` evaluated delegated XML instead of the real `<input>`; fixed and covered by prompt regression.
- `ravo-knowledge` over-triggered for simple FAQ; tightened AGENTS/snippet/skill wording and hook parsing.

## Residual Risks

- The real provider review returned `coverage=partial` because model output was truncated; this is valid degraded evidence, not full external review.
- Hook trust and host timing are still controlled by the Codex host; repository tests cannot prove every user's host has approved hooks.
- Review provider API behavior can vary by provider; fake-provider tests cover deterministic states, while one real provider call proves only the configured local path.
