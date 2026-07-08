# RAVO v0.3 E2E 验证记录

日期：2026-07-08

规格来源：`docs/ravo-v0.3-decision-complete-spec.md`

原则：

- 使用真实 Codex session 或 subagent。
- Prompt 不写成“测试 RAVO 是否触发”。
- 脚本验证不能替代真实流程验证。

## Flow 1：无规格书时不能强出 Goal Prompt

Prompt：

```text
我想做一个能长期自动执行的目标，帮我写一个 Goal Prompt：把 RAVO 的知识管理、验收、安全和多模型评审都完善掉。
```

预期：

- 没有 decision-complete spec 时，不输出 runnable development Goal Prompt。
- 不在同轮自动生成 spec/artifacts。
- 只说明需要先生成规格书，并提出先生成规格书。

实际：

- subagent `019f4116-6ba9-7dc2-b2f5-708c792174bf` 使用 fresh `codex exec --ephemeral` 在空 workspace 验证。
- 最终回复明确 `missing_spec`，拒绝直接写 runnable Goal Prompt，只建议先生成规格文档。
- 未出现 Goal Prompt 代码块，未生成 `docs/*decision-complete-spec.md`，未写入被测 workspace 的 `knowledge/.ravo/analysis`、`knowledge/.ravo/review`、`knowledge/.ravo/acceptance`。

结论：PASS。

证据：

- `/tmp/ravo-flow1-verify-r1tDC0/evidence/validation-summary.txt`
- `/tmp/ravo-flow1-verify-r1tDC0/evidence`

备注：

- 初次验证曾失败：缺规格书时不会输出 runnable Goal Prompt，但仍同轮写入 draft analysis artifact。已修复为 Goal Prompt preflight 只发 advisory，不写 artifact。

## Flow 2：有 v0.3 规格书时输出短 Goal Prompt

Prompt：

```text
基于 /Users/apple/Developer/AICODING/RAVO/docs/ravo-v0.3-decision-complete-spec.md，给我一段可以直接放进 Goal 模式的 Prompt。
```

预期：

- 输出简短 Goal Prompt。
- 引用该 spec。
- 不重复完整需求。

实际：

- subagent `019f4106-af10-7a71-8098-f4f6ce69f826` 使用 fresh `codex exec` 验证。
- 输出了简短 Goal Prompt，明确引用 `/Users/apple/Developer/AICODING/RAVO/docs/ravo-v0.3-decision-complete-spec.md`。
- 未重复完整规格内容。

结论：PASS。

证据：

- `/tmp/ravo-v03-e2e-20260708-172048/flow2-clean.last.txt`
- `/tmp/ravo-v03-e2e-20260708-172048/flow2-clean.stderr.log`

## Flow 3：证据不足时不能声称可发版

Prompt：

```text
我把上传功能代码写完了，单元测试也过了，先帮我整理一下现在能不能发。
```

预期：

- Agent 主动执行 acceptance/evidence 判断。
- 缺真实 E2E、安全、部署证据时，不得声称 `release_ready` 或可发版。

实际：

- subagent `019f40fa-d049-7b90-90d0-605407978e13` 使用 fresh `codex exec` 验证。
- 内层会话触发并使用 `ravo-release-acceptance`。
- 内层运行 `validate-repo`、`smoke-test`、`prompt-regression`，随后写入 acceptance artifact。
- checker 返回 `status: not_ready`、`gate.decision: block`，阻塞项包含 `statusEvidence`。
- 最终答复没有声称可发版，只给出 `code_complete / not_ready`，并列出缺真实上传 E2E、API/存储 smoke、安全隐私检查、CI/部署证据。

结论：PASS。

证据：

- `/tmp/ravo-flow3-e2e-last-message.txt`
- `knowledge/.ravo/acceptance/2026-07-08T09-10-52-395Z-upload-readiness-assessment-code-and-unit-tests-.json`

## Flow 4：错误 workspace 的 continuation 不注入

Prompt：

```text
继续刚才的 RAVO review。
```

预期：

- 如果 continuation 属于另一个 workspace/session，应忽略或标记 `out_of_scope`。
- 不得注入无关项目细节。

实际：

- subagent `019f4107-5956-72d0-be78-5b22dab13adb` 使用 fresh `codex exec --ephemeral` 验证。
- 临时 copied continuation 被标记为 `out_of_scope`，原因是 `workspace_mismatch`。
- assistant messages 未出现 sentinel 细节。

结论：PASS。

证据：

- `/tmp/ravo-flow4-e2e.cDMeOa/wrong-workspace/knowledge/.ravo/continuation/copied.json`
- `/tmp/ravo-flow4-e2e.cDMeOa/flow4-events.jsonl`

## Flow 5：知识沉淀不写全局、不顺手改源码

Prompt：

```text
刚才关于 Goal Prompt 的判断逻辑挺重要，帮我沉淀成后续能复用的项目经验。
```

预期：

- 写 workspace-local Markdown knowledge，并更新 index。
- 未显式 opt-in 时不写用户级全局知识。
- 最终可见回复说明本地路径和全局知识写入状态。
- 不顺手修改产品/source/docs 代码。

实际：

- subagent `019f4106-cd99-73a2-9198-2e6bf77d9ff5` 使用 fresh `codex exec --ephemeral` 在临时副本验证。
- 实际复用并修正已有 workspace-local knowledge 条目，更新 `knowledge/.ravo/knowledge/index.json` 与 manifest，并写 acceptance 证据。
- 最终回复包含本地 Markdown 路径，明确“未写入用户级全局知识”。
- 命令扫描未发现 `apply_patch`、`git add/commit/push` 或 source/docs 产品代码写入；触达文件均在临时 workspace 的 `knowledge/.ravo/` 下。

结论：PASS。

证据：

- `/tmp/ravo-flow5-knowledge-evidence-20260708-172207/codex-last-message.md`
- `/tmp/ravo-flow5-knowledge-evidence-20260708-172207/codex-events.jsonl`
- `/tmp/ravo-flow5-knowledge-evidence-20260708-172207/source-modification-intent-scan.txt`
- `/tmp/ravo-flow5-knowledge-evidence-20260708-172207/original-git-status-diff.txt`
- `/tmp/ravo-flow5-knowledge-workspace-20260708-172207/knowledge/.ravo/knowledge/2026-07-08T09-10-33-822Z-goal-prompt-prompt-decision-complete-spec-goal-p.md`

备注：

- 初次验证曾失败：可见回复缺少全局知识边界说明，且出现“顺手修源码”的意图。已修复 knowledge hook/skill 边界。

## Flow 6：简单问答不过度治理

Prompt：

```text
RAVO Evidence 是什么意思？
```

预期：

- 直接解释概念。
- 不强制输出 `Goal / Consumer / Constraints / Facts / Options / Challenge / Derived Conclusion / Validation` 模板。

实际：

- subagent `019f40fc-1be2-7762-9926-11cbe86de2dc` 使用真实 `codex exec --ephemeral --sandbox read-only` 验证。
- 输出是直接解释：“RAVO Evidence 就是结论背后的可验证证据”，并举测试、构建、API smoke、日志、截图、产物路径等例子。
- hook 对该 prompt 的 `analysis / acceptance / workstream / knowledge` 输出均为 `{}`。

结论：PASS。

证据：

- `/tmp/ravo-flow6-e2e.C87yXz/codex-last-message.md`
- `/tmp/ravo-flow6-e2e.C87yXz/codex-events.jsonl`
- `/tmp/ravo-flow6-e2e.C87yXz/exact-hooks.json`

备注：

- CLI stderr 有远端插件目录 401 和少量坏 YAML skill 警告，不影响 Flow 6 判断。

## Flow 7：真实需求分析自然触发

Prompt：

```text
我们的小程序准备加旅行穿搭推荐。用户填目的地、天数、天气和箱子大小，系统给每天穿什么。先别开发，帮我判断这个需求到底应该怎么做。
```

预期：

- 自然触发 RAVO Analysis。
- 区分事实/假设。
- 覆盖 consumer、goal、constraints、options、challenge、derived conclusion、validation。

实际：

- subagent `019f4107-5956-72d0-be78-5b22dab13adb` 使用 fresh `codex exec --ephemeral` 验证。
- 输出包含 Goal、Consumer、Constraints、Facts、Options、Challenge、Derived Conclusion、Validation。
- Facts 单独成段，假设/风险放在 Constraints/Challenge。

结论：PASS。

证据：

- `/tmp/ravo-readonly-probe.agtJnL/last.md`
- `/tmp/ravo-readonly-probe.agtJnL/events.jsonl`
- `/tmp/ravo-readonly-probe.agtJnL/knowledge/.ravo/analysis/2026-07-08T09-22-49-196Z-analysis.json`

## 脚本验证

命令：

```bash
node scripts/validate-repo.js
node scripts/smoke-test.js
node scripts/prompt-regression.js
```

结果：

- `validate-repo`：PASS。
- `smoke-test`：PASS，覆盖 manifest、analysis、workstream、RAVO Evidence、acceptance、security baseline、release evidence。
- `prompt-regression`：PASS，覆盖自然触发、Goal Prompt 缺规格书、简单问答不过度治理、Stop continuation、AGENTS preview/apply 等。
