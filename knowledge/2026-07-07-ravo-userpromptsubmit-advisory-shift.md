# RAVO UserPromptSubmit 从 Block 改为 Advisory

日期：2026-07-07

## First-Principles Analysis

- goal：在不依赖宿主 final-response hook 的前提下，让 RAVO 对验收/发版类 prompt 生效，同时不破坏自然治理。
- constraints：当前 Codex 没有可靠的 final-response interception hook；`SessionStart` / `SubagentStart` 可注入主动规则；`UserPromptSubmit` 只能作为兜底。
- facts：
  - 当前实现把 `UserPromptSubmit` fallback 做成了 `decision: block`。
  - 实际 UI 效果是阻止用户发消息，并显示强引导性错误提示。
  - fallback hook 还会先写入 `not_ready` artifact，再运行 checker，导致它天然污染最新证据，ready 路径无法通过。
- symptom：用户消息被阻止发送；提示文案像系统驳回而不是 Agent 内部治理；即使已有足够证据，fallback 也可能自我污染后误判。
- proximate cause：把“约束 Agent 的交付结论”错误实现成了“拦截用户 prompt”。
- mechanism root cause：为了弥补缺少 final-response hook 的宿主能力，错误地把 `UserPromptSubmit` 当成了产品主交互面，而不是一个对 Agent 可见的 advisory 注入点。
- derived conclusion：`UserPromptSubmit` 必须降级为 advisory，不得再 block 用户消息；检查顺序必须先跑 checker，再在失败时记录 `not_ready` artifact。

## Decision

- `ravo-acceptance` 的 `UserPromptSubmit` fallback 从 `block` 改为 `advisory`。
- direct readiness prompt 允许继续发送，但 Agent 必须在回答中降级状态并指出缺失证据。
- checker 必须先读已有证据；只有失败时才追加 `not_ready` artifact，不能先写后查。

## Validation

- `node scripts/prompt-regression.js`
  - 需求分析：仍为 advisory
  - 根因分析：仍 bypass acceptance fallback
  - 验收/发版/交付结论：由 `BLOCK` 改为 `ADVISORY`
  - ready workspace：不再被 fallback 自我污染
- `node scripts/smoke-test.js`
- `node scripts/validate-repo.js`

## Product Impact

- 自然治理边界更清晰：治理约束 Agent，不阻止用户提问。
- UI 不再出现“Hook 已阻止此消息”这类高侵入反馈。
- fallback 仍保留安全作用，但退回到正确角色：辅助 Agent 回答，而不是替 Agent 拒绝用户。
