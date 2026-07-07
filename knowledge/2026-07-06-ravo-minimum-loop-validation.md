# RAVO v0.1 最小可用闭环验证

日期：2026-07-06

## 结论

当前状态：最小可用闭环通过。

已证明：
- RAVO 三个插件可安装启用。
- `ravo-analysis` 和 `ravo-acceptance` hook 级回归通过。
- `knowledge/.ravo/manifest.json`、analysis artifact、acceptance artifact 的脚本级连接通过。
- Hook 运行需要用户审批/信任；用户审批后，真实 subagent runtime 记录显示 `UserPromptSubmit` fallback gate 生效。
- 真实 subagent 需求分析 prompt 可自然触发 `ravo-analysis` advisory，并写入 `knowledge/.ravo/analysis`。
- 真实 subagent 交付/发版 prompt 可自然触发 `ravo-acceptance` fallback block，并写入 `knowledge/.ravo/acceptance`。
- `SessionStart`/`SubagentStart` 已被审批/信任，真实 subagent runtime 中可审计到 `RAVO_ACCEPTANCE_ACTIVE` 进入 developer 上下文。
- 普通交付任务中，Agent 在 final 前主动运行了 RAVO acceptance evidence check，并写入 `pending_acceptance` + `smoke` artifact。

边界：
- 新 Codex app thread 的 `read_thread` 结果无法读取可审查的 assistant 内容；CLI `codex exec` 本轮也没有成功把 prompt 送进模型，不能作为有效 runtime 证据。
- 没有找到可拦截 Agent final response 的 Codex hook；当前通过 `SessionStart`/`SubagentStart` 主动规则注入 + `UserPromptSubmit` fallback 达到 v0.1 最小闭环。
- `SessionStart`/`SubagentStart` hook trust 是前置条件；未审批时会退化成只有 fallback gate 生效。

## 真实 Prompt 结果

### 需求分析

Prompt：AI 穿搭小程序新增“旅行场景穿搭推荐”，先判断用户、目标、边界、风险和方案。

结果：通过。

证据：
- 子 Agent 输出包含 first-principles analysis、用户、边界、风险和推荐方案。
- Wardrobe workspace 写入了 `knowledge/.ravo/analysis/2026-07-06T14-41-36-801Z-analysis.json`。

缺口：
- 输出没有显式说明来自 RAVO skill；可接受，因为自然触发不要求暴露内部 skill。

### 根因分析

Prompt：验收插件能拦截“可以验收了吗”，但不能拦截“这个版本是不是能发”，继续追问机制根因。

结果：修复后通过。

首次失败点：
- 子 Agent 修复了旧 `release-acceptance-gate`，不是 RAVO 本体。
- 没有证明写入 `knowledge/.ravo/analysis` root-cause artifact。

最小修复：
- `ravo-analysis` advisory 增加 artifact 写入要求。
- `ravo-root-cause-analysis` skill 明确：RAVO advisory 触发时，非平凡根因分析必须写 artifact。
- `ravo-analysis` hook 在自然 prompt 命中时自动写入 `knowledge/.ravo/analysis` 最小 artifact。

复测证据：
- 直接调用缓存后的 `ravo-analysis-gate.js`，根因 prompt 返回 `RAVO_ANALYSIS_GATE:ADVISORY`。
- 临时 workspace 自动生成 `knowledge/.ravo/analysis/<timestamp>-analysis.json` 和 `knowledge/.ravo/manifest.json`。
- 早期子 Agent 输出偏向旧 `release-acceptance-gate` 语境，暴露了运行路径漂移问题。
- 2026-07-07 复测 subagent `019f383f-a342-72e3-a6f0-5e0fa83d805b`：session jsonl 记录 `RAVO analysis trigger matched: root-cause`，未再被 `ravo-acceptance` 抢先 block。
- 该 subagent 最终根因报告写入 Wardrobe `knowledge/2026-07-07-ravo-acceptance-release-intent-root-cause.md`，结论为：真实启用插件识别不足 + 测试未绑定当前启用 hook 路径，而不是 checker 失败。

新增最小修复：
- `ravo-acceptance-gate` 对明确根因/原因/为什么分析 prompt 做 bypass，避免 acceptance fallback 抢断 root-cause analysis。
- `prompt-regression` 增加 `root-cause prompt with release wording -> acceptance fallback bypass`。

### 交付验收

Prompt：积分扣减功能已完成且单测通过，请给交付结论和下一步安排。

结果：修复后通过。

首次失败点：
- 子 Agent 使用旧 release acceptance 体系，未证明 `ravo-acceptance` 主动验收。
- RAVO acceptance hook 未覆盖“交付结论/下一步安排”类自然表达。

最小修复：
- `ravo-acceptance-gate` 增加交付结论、交付状态、代码已完成且测试通过等 delivery-status prompt 识别。
- `prompt-regression` 增加 delivery conclusion prompt without evidence -> block。
- `ravo-acceptance` hook 在自然交付 prompt 命中时自动写入 `knowledge/.ravo/acceptance` 的 `not_ready` 最小 artifact，再执行 checker。

复测证据：
- 直接调用缓存后的 `ravo-acceptance-gate.js`，交付结论 prompt 返回 `RAVO_ACCEPTANCE_GATE:BLOCK`。
- 临时 workspace 自动生成 `knowledge/.ravo/acceptance/<timestamp>-acceptance.json` 和 `knowledge/.ravo/manifest.json`。
- 新 Codex app thread `019f3819-19e1-7a83-bce7-5ddea6b3710e` 对交付 prompt 没有产生可读 assistant items；结合直接 hook 结果，可能是 prompt 被 gate block，但该证据不能证明 Agent final 前主动验收。
- 新增 `ravo-acceptance-session.js`，通过 `SessionStart` 和 `SubagentStart` 注入主动验收规则：交付/发布/验收结论前必须主动运行 `ravo-release-acceptance` 或等价 RAVO acceptance evidence check。
- 直接调用 `ravo-acceptance-session.js SessionStart` 和 `SubagentStart` 均返回 `RAVO_ACCEPTANCE_ACTIVE` 和主动验收上下文。
- 关键部署注意：RAVO hook 首次运行需要用户审批/信任；未审批时自然触发验证可能出现假阴性。README 已补充 hook trust 说明。
- 真实 subagent session `019f3828-fa63-7911-a96a-6e9a1d7f25fd` 的 `~/.codex/sessions/2026/07/07/...jsonl` 记录了 `RAVO acceptance gate blocked this readiness/release claim.`，证明审批后 `UserPromptSubmit` fallback 在 runtime 中生效。
- 2026-07-07 复测 subagent `019f3845-7819-7a52-a21f-ed03fae3781e`：自然 prompt `这个版本是不是能发？代码已经写完，单元测试也过了，但还没有真实端到端验证和截图。` 被 `RAVO acceptance gate blocked this readiness/release claim.` 阻断。
- Wardrobe workspace 写入 `knowledge/.ravo/acceptance/2026-07-06T16-31-44-988Z-acceptance.json`，状态 `not_ready`，证据级别 `none`。

新增最小修复：
- `ravo-acceptance-gate` 覆盖 `这个版本是不是能发`、`这个版本是不是能发版`、`这个版本能上线吗` 等口语发版问法。
- `prompt-regression` 增加 `release-readiness variants without evidence -> block`。

### 主动验收

Prompt：请在 `/tmp/ravo-proactive-runtime-check4` 创建 `hello.txt`，内容为 `hello-ravo-4`，并告诉我完成情况和验证了什么。

结果：通过。

证据：
- 子 Agent `019f385c-c3d8-7811-ae91-47fc07f1c859` 的 session jsonl 记录了 `RAVO_ACCEPTANCE_ACTIVE` developer message。
- 同一 session 在 final 前执行：
  `node "/Users/apple/.codex/plugins/cache/ravo/ravo-acceptance/0.1.0/scripts/write-acceptance-artifact.js" --status pending_acceptance --evidence-level smoke ... && node "/Users/apple/.codex/plugins/cache/ravo/ravo-acceptance/0.1.0/scripts/check-ravo-acceptance.js"`
- Wardrobe workspace 写入 `knowledge/.ravo/acceptance/2026-07-06T16-58-22-526Z-created-tmp-ravo-proactive-runtime-check4-hello-.json`，状态 `pending_acceptance`，证据级别 `smoke`。
- 目标文件 `/tmp/ravo-proactive-runtime-check4/hello.txt` 存在，内容为 `hello-ravo-4`。

新增最小修复：
- `ravo-acceptance-session.js` 将主动验收范围从 release/readiness 扩展到 Agent 自己汇报 `completed/done/已完成` 的交付场景。
- 注入文案中给出可直接运行的最小命令，避免 Agent 只理解原则但不执行检查。

### 安装后路径可用性

发现问题：
- skill 文档中的示例命令原来假设用户 workspace 存在 `plugins/ravo-*` 目录；独立安装后真实用户项目通常没有该目录。

最小修复：
- `ravo-core`、`ravo-analysis`、`ravo-acceptance` skill 文档改为用插件安装根目录环境变量示例：`RAVO_CORE_PLUGIN_ROOT`、`RAVO_ANALYSIS_PLUGIN_ROOT`、`RAVO_ACCEPTANCE_PLUGIN_ROOT`。
- `validate-repo` 增加防回退检查：skill 文档不得包含 `node plugins/ravo-` 形式的 repo-relative 命令。

## 当前脚本证据

```text
node scripts/validate-repo.js -> pass
node scripts/prompt-regression.js -> pass
  - includes root-cause/release wording bypass
  - includes release-readiness variants block
node scripts/smoke-test.js -> pass
node plugins/ravo-acceptance/scripts/check-ravo-acceptance.js -> pass after final RAVO validation artifact
```

最终 RAVO validation artifact 使用 `pending_acceptance` + `smoke`，覆盖脚本验证和真实 subagent runtime 验证证据。

## 判定标准

当前可以判定为“最小可用闭环通过”。

原因：
- hook/artifact/script 层已形成最小工程闭环。
- `SessionStart`/`SubagentStart` 已提供模型可见的主动验收规则，真实 subagent 已按规则主动运行 acceptance check。
- `UserPromptSubmit` fallback 已可自动写 artifact 和 block，但不能被误判为 Agent final-response 拦截。

剩余边界：
- 当前没有 final-response interception hook，因此 v0.1 依赖主动规则注入和 fallback gate，不是宿主级 final 硬拦截。
- 不继续扩展 `ravo-workstream` 或 `ravo-knowledge`。

## 开源 README 待保留说明

- Hook trust：安装后 Codex 可能要求用户审批/信任 hook；这是 hook-based natural triggering 生效的前置条件。未审批时不要把自然触发失败误判为语义失败。
- Hook trust 是按 hook event 记录的；后续版本新增 `SessionStart` / `SubagentStart` 时，即使用户以前批准过 `UserPromptSubmit`，仍需重新批准新增 hook。
- Agent-led setup：如果 RAVO 由用户的 Agent 自动安装，Agent 应把增量补充 `AGENTS.md` 作为安装后的主动提示，先展示 diff preview、说明增量变化，并等待用户明确确认后再 apply。
