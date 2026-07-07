<div align="center">

# RAVO 生命周期治理

### 面向 Codex Agent 的模块化治理插件

[English](README.md) | 中文

</div>

## 为什么选择 RAVO？

AI 编程 Agent 很强，但长程任务经常在固定位置失控：需求过早被接受，根因分析停在症状层，流程复杂度不断膨胀，证据不足却宣称完成，经验教训在会话结束后消失。

**RAVO** 为 Codex Agent 提供一层轻量生命周期治理能力。它通过可安装的 skills、hooks、scripts 和共享 artifacts，让 Agent 在开发前先分析、交付前先验证，并把可复用证据沉淀下来，而不是把用户绑进一个大而全框架。

```text
R = Reason      需求、方案、根因
A = Act         任务编排与执行交接
V = Verify      验收证据与状态门禁
O = Organize    知识沉淀与复用
```

## 核心原则

- **第一性原理**：先从目标、真实消费者、约束、事实和机制根因出发，再决定实现路径。
- **奥卡姆剃刀原理**：优先选择足够简单的流程、artifact 和实现；模块与共享文件足够时，不做中心化调度器。
- **可证伪性原则**：重要方案和交付结论必须能被挑战。RAVO 通过对抗式审查和证据匹配交付，提前暴露错误假设、验证缺口和不被证据支持的 `验收通过`、`可发版`、`已上线` 结论。
- **最小惊讶原则**：治理能力应该自然融入交互。用户正常描述需求、问题或验收诉求即可触发能力，不应要求用户日常显式说“调用 RAVO”。

## 功能特性

### 需求与方案分析

- 识别真实目标、真实消费者、约束、方案选项和验证路径。
- 在需求重要或不清晰时，先做第一性原理分析，再进入实现。
- 将可复用分析结果写入 `knowledge/.ravo/analysis`。

### 根因分析

- 区分现象、近因、机制根因、复发风险、最小修复和验证方式。
- 避免把“提示词问题”“用户要求”“缺少检查”这类表层原因误当成根因。

### 验收与发布门禁

- 在交付、验收、发版、上线、ready、done 等结论前检查证据。
- 将验收证据写入 `knowledge/.ravo/acceptance`。
- prompt-time readiness hook 只是兜底；主机制应该是 Agent 在给交付结论前主动运行验收检查。

### 共享 Artifact 协议

RAVO 模块通过 workspace 文件连接，不做中心化 dispatcher：

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── acceptance/
├── workstream/
└── knowledge/
```

单个模块可以独立工作。多个 RAVO 模块同时安装时，通过 `knowledge/.ravo/manifest.json` 发现上游 artifacts。

## 下载安装

当前仓库使用 `.agents/plugins/marketplace.json` 作为本地 marketplace。

在仓库根目录执行：

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-acceptance@ravo
```

安装后新开一个 Codex thread，让 skills 和 hooks 生效。

### Hook 授权

Codex 可能会要求用户授权新安装的 plugin hooks。授权按 hook event 生效，所以批准过 `UserPromptSubmit` 不代表后续新增的 `SessionStart` 或 `SubagentStart` 已批准。如果 RAVO 安装后没有自然触发，先确认 RAVO hooks 已授权，再新开会话。

## `AGENTS.md` 接入

RAVO 不会静默修改 `AGENTS.md`。

不同用户的 `AGENTS.md` 结构不同。RAVO snippet 是推荐治理块，不是必须机械插入的固定文本。

### 手动模式

适用于用户自己安装 RAVO，并希望先审阅推荐规则文本。

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --apply
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --restore AGENTS.md.ravo-bak-...
```

写入时会创建带时间戳的备份，并幂等更新同一个 RAVO 标记块。

### Agent 辅助模式

适用于用户的 Agent 帮忙安装 RAVO 或维护 Codex 环境。

安装 Agent 应该：

- 先读取现有 `AGENTS.md`，再提出修改建议。
- 判断应该新增 RAVO marked block、合并到现有段落，还是因为已有等价规则而不修改。
- 展示 proposed diff，并说明增量行为变化。
- 等待用户明确批准后再写入。
- 写入前创建备份。
- 绝不静默修改用户规则文件。

如果现有 `AGENTS.md` 已经有强治理规则，优先做最小合并，避免重复插入同义 RAVO 文案。

## 常见问题

<details>
<summary><strong>用户需要显式调用 RAVO 吗？</strong></summary>

不需要。RAVO 的目标是自然交互。显式 skill 名称适合测试和调试，但普通需求、根因、验收 prompt 应该通过 skill description 和 hooks 自动触发对应能力。

</details>

<details>
<summary><strong>RAVO 是一个大而全流程引擎吗？</strong></summary>

不是。RAVO 遵循奥卡姆剃刀原理：模块保持独立安装，通过 artifacts 连接。只有当共享 artifacts 不够用时，才考虑中心化调度器。

</details>

<details>
<summary><strong>RAVO 会自动修改 AGENTS.md 吗？</strong></summary>

不会。RAVO 可以预览并应用推荐规则块，但用户或安装 Agent 必须先读取现有文件、检查 diff，并确认后再写入。

</details>

## 修改后自检

如果你只是安装和使用 RAVO，不需要运行这些命令。

如果你修改了 RAVO 的代码、文档、skill、hook、schema 或脚本，建议运行：

```bash
node scripts/validate-repo.js
node scripts/smoke-test.js
node scripts/prompt-regression.js
```

这些检查用于确认 RAVO 的核心结构、共享 artifact 协议和 prompt 触发回归仍然正常。
