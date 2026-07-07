# Stop hook 能力边界实验

日期：2026-07-07

## 结论

当前 Codex `Stop` hook 不适合作为 RAVO acceptance 的 before-final-answer 出口 gate。

可用定位：

- 可作为 final 之后的收尾观察点或日志点。
- 不应用于阻止、改写、或稳定约束最终回复。
- 若未来要接入 RAVO，最多定位为“收尾 advisory / telemetry”，用于记录 evidence gap、提示下一轮补验收，而不是当前轮硬门禁。

## 实验设计

最小临时插件：`/tmp/ravo-stop-probe`

hook event：`Stop`

hook 行为：

- 写入 `/tmp/ravo-stop-probe-log.jsonl`。
- 返回固定 `additionalContext`：要求最终回答包含 `STOP_PROBE_TOKEN_7f3c`。
- 追加测试两种阻断尝试：JSON `decision: block` 和非零退出码。

执行方式：

```bash
codex exec --dangerously-bypass-hook-trust --skip-git-repo-check --json -C /tmp/ravo-stop-probe-work -o /tmp/ravo-stop-probe-output.txt "<prompt>"
```

## 结果

### advisory 输出

- 最终输出：`BASE_REPLY_ONLY`
- Stop hook 日志包含：
  - `hook_event_name: "Stop"`
  - `last_assistant_message: "BASE_REPLY_ONLY"`
  - `stop_hook_active: false`
- 最终输出没有包含 `STOP_PROBE_TOKEN_7f3c`。

判断：Stop hook 在 assistant final 已经生成之后触发，不能向当前最终回复注入有效约束。

### JSON block 输出

- hook 返回 `decision: "block"`。
- 最终输出仍为：`BLOCK_MODE_BASE_REPLY`
- 事件流正常 `turn.completed`，没有阻断效果。

判断：`decision:block` 对 Stop hook 不构成当前轮硬拦截。

### 非零退出

- hook 退出码为 2，stderr 为 `STOP_PROBE_EXIT_2`。
- Stop hook 被反复触发，后续输入里：
  - `stop_hook_active: true`
  - `last_assistant_message: "STOP_PROBE_EXIT_2"`
- 事件流反复追加 `agent_message: "STOP_PROBE_EXIT_2"`，未稳定完成，人工中断。

判断：非零退出不是可用 gate，而是可能造成 stop-loop。

## Derived Decision

RAVO acceptance 不应迁移到 `Stop` hook 作为出口硬门禁。

短期方案保持：

- 主机制：`SessionStart` / `SubagentStart` 注入交付前主动验收规则。
- fallback：`UserPromptSubmit` advisory 辅助用户直接问 readiness/验收/发版。
- 可选增强：新增 Stop hook 只能做 after-final telemetry，例如发现最终文本含 `已完成/可发版/验收通过` 且 evidence 不足时，记录 artifact 或为下一轮注入提醒；不能承诺阻止当前错误输出。

## 风险

- Stop telemetry 可能会在错误输出之后才记录问题，用户仍可能先看到错误结论。
- 非零退出会导致循环，不得用于生产逻辑。
- 真实桌面 app 与 CLI 可能存在 UI 表现差异，但 CLI 证据已经足够否定“稳定 before-final gate”假设。
