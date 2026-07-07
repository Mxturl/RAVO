# RAVO 自然语义触发测试发现

日期：2026-07-06

## 触发来源

用户用以下自然 Prompt 新开会话测试：

```text
我们正在做一个 AI 穿搭小程序，用户上传衣服照片后，系统自动生成衣橱标签。现在我想新增“旅行场景穿搭推荐”：用户输入目的地、天数、天气和行李箱大小，系统推荐每天穿什么。这个需求先别开发，帮我判断真正的用户是谁、目标是什么、有哪些边界和风险，然后给出推荐方案。
```

## 发现

该会话完成了普通产品分析，但没有证明 RAVO 自然触发已生效：

- 未看到 `ravo-requirement-analysis` 被明确触发。
- 未看到 RAVO analysis advisory hook 注入上下文。
- 未生成 `knowledge/.ravo/analysis` artifact。
- 实际行为更像普通 Codex 按全局规则完成需求分析。

## 根因

- `ravo-analysis` 只有 skills，没有 advisory hook。
- `ravo-acceptance` 虽有 hook 文件，但 plugin manifest 未显式声明 `hooks`，真实运行时可能不会启用。
- 仅依赖 skill description 自动召回，不足以支撑“用户无需刻意调用”的产品目标。

## 修复

- 给 `ravo-analysis` 增加 `UserPromptSubmit` advisory hook。
- 对需求/方案/架构/消费者/边界/风险类 Prompt 注入 `ravo-requirement-analysis` 建议。
- 对根因/五个 Why/机制根因/防复发类 Prompt 注入 `ravo-root-cause-analysis` 建议。
- 给 `ravo-analysis` 和 `ravo-acceptance` manifest 显式声明 `hooks`。
- 移除 hook command 里的 `; exit 0`，避免脚本路径、Node 或 JSON 输出失败被吞掉。
- 刷新本地安装缓存：`codex plugin add ravo-analysis@ravo`、`codex plugin add ravo-acceptance@ravo`。

## 验证

- `node scripts/validate-repo.js`：通过。
- `node scripts/prompt-regression.js`：通过。
- 对旅行穿搭 Prompt 直接执行 `ravo-analysis-gate.js`：返回 `RAVO_ANALYSIS_GATE:ADVISORY`，分类为 `requirement`。
- 对验收插件根因 Prompt 直接执行 `ravo-analysis-gate.js`：返回 `RAVO_ANALYSIS_GATE:ADVISORY`，分类为 `root-cause`。
- cache 中已确认存在 `ravo-analysis/hooks/ravo-analysis-gate.js` 和 `hooks/claude-codex-hooks.json`。

## 残余风险

仍需要新 Codex thread 做真实 UI 级验证，确认 `UserPromptSubmit` hook 在当前 Codex app runtime 中会自动注入 advisory。

## 后续测试策略

- `hook-level deterministic test`：使用 `node scripts/prompt-regression.js` 覆盖大多数自然 Prompt 分类，避免用户手工转发基础用例。
- `runtime probe`：只用少量新 Codex thread 验证插件安装、hook trust、`UserPromptSubmit` 注入和模型可见上下文是否贯通。
- 不把 runtime probe 做成大矩阵；大矩阵应留在确定性 hook 测试里。

## 2026-07-06 追加修复

- 子 Agent 审查指出 `; exit 0` 会吞掉 hook 失败，已移除。
- 子 Agent 审查指出输出契约仍可能缺 `Options` 和 `Validation`，已把 advisory 文案改成 `Required headings`，并要求 requirement analysis 至少包含两个 options with tradeoffs。
- 新增 `scripts/prompt-regression.js`，覆盖 requirement、root-cause、trivial no-op、acceptance block。
