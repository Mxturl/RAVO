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
- 区分事实、推断和假设，让方案依据显式可见。
- 在下结论前，先主动挑战一次首选方案，而不是只做顺向论证。
- 在需求重要或不清晰时，先做第一性原理分析，再进入实现。
- 将可复用分析结果写入 `knowledge/.ravo/analysis`。

### 根因分析

- 区分现象、近因、机制根因、复发风险、最小修复和验证方式。
- 至少比较一个合理的竞争性解释，再锁定根因。
- 避免把“提示词问题”“用户要求”“缺少检查”这类表层原因误当成根因。

### 验收与发布门禁

- 在交付、验收、发版、上线、ready、done 等结论前检查证据。
- 将验收证据写入 `knowledge/.ravo/acceptance`。
- prompt-time readiness hook 只是兜底 advisory；主机制应该是 Agent 在给交付结论前主动运行验收检查。

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

单个模块可以独立工作。多个 RAVO 模块同时安装时，通过 `knowledge/.ravo/manifest.json` 发现上游 artifacts。原始项目事实和证据默认只属于当前 workspace；抽象后的经验和原则只有在脱敏、标注适用边界并经用户明确 opt-in 后，才可以沉淀为用户级可迁移知识。

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

如果是用户已有的 Codex Agent 帮忙安装 RAVO，`AGENTS.md` 接入应作为插件安装后的选择性升级步骤。Agent 必须先读取用户的 Codex 全局 `AGENTS.md`，判断 RAVO 应如何融入现有规则，展示 diff，并等待用户明确批准后再写入。

> [!IMPORTANT]
> **hooks 信任是 RAVO 产品能力的一部分，不是可忽略细节。**
> 如果 `SessionStart` / `SubagentStart` / `UserPromptSubmit` 这些 hooks 没有被信任或批准，RAVO 的自然治理能力会明显退化。此时需求分析可能无法稳定自然触发，主动验收也会退化成更弱的 prompt-time 行为。
>
> 安装或升级后，建议按这个顺序检查：
> 1. 确认 RAVO hooks 是否已被信任或批准；
> 2. 如果新增了 hook event，补做对应授权；
> 3. 新开一个 Codex 会话后再开始测试。

### Hook 授权

Codex 可能会要求用户授权新安装的 plugin hooks。授权按 hook event 生效，所以批准过 `UserPromptSubmit` 不代表后续新增的 `SessionStart` 或 `SubagentStart` 已批准。

宿主不一定总会弹出很显眼的授权提示。安装完成后，如果自然触发看起来没有生效，Agent 应主动提醒用户检查 RAVO hooks 是否已被信任或批准；确认后再新开会话继续验证。

### 升级 RAVO

RAVO 的设计本身支持相对平滑的升级：plugin id 保持稳定（`ravo-core`、`ravo-analysis`、`ravo-acceptance`），共享协议通过 `knowledge/.ravo/manifest.json` 做版本化管理，各模块也可以独立升级。

常见升级流程：

```bash
git pull
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-acceptance@ravo
```

如果你用的不是当前本地仓库，而是 Git marketplace，需要先刷新 marketplace snapshot：

```bash
codex plugin marketplace upgrade
```

每次升级后建议：

- 新开一个 Codex thread，
- 检查是否新增了需要授权的 hook event，
- 先跑一条简短 RAVO 测试 prompt，再依赖新版本能力。

## `AGENTS.md` 接入

RAVO 不会静默修改 Codex 全局 `AGENTS.md`。

不同用户的 `AGENTS.md` 结构不同。RAVO snippet 是推荐治理块，不是必须机械插入的固定文本。

推荐边界是：

- `AGENTS.md` 决定 **何时委派**：全局优先级、安全边界、交互风格、数据边界和 fallback 行为。
- RAVO 决定 **如何执行**：分析结构、验收证据、scripts、schemas、hooks 和 artifacts。

不要宣称 RAVO 已接管尚未实现的模块。v0.1 完整覆盖的是 `analysis` 和 `acceptance`；`workstream` 与 `knowledge` 只是协议兼容点，不是完整模块。

### 手动模式

适用于用户自己安装 RAVO，并希望先审阅 Codex 全局 `AGENTS.md` 的推荐规则文本。

```bash
node plugins/ravo-core/scripts/ravo-agents.js
node plugins/ravo-core/scripts/ravo-agents.js --apply
node plugins/ravo-core/scripts/ravo-agents.js --restore <备份路径>
```

`ravo-agents.js` 默认目标是当前用户主目录下的 Codex 全局 `AGENTS.md`。只有你明确想操作别的文件时，才使用 `--file <path>`。写入时会创建带时间戳的备份，并幂等更新同一个 RAVO 标记块。

### Agent 辅助模式

适用于用户的 Agent 帮忙安装 RAVO 或维护 Codex 环境。

安装 Agent 应该：

- 先读取 Codex 全局 `AGENTS.md`，再提出修改建议。
- 判断应该新增 RAVO marked block、合并到现有段落，还是因为已有等价规则而不修改。
- 保留与 RAVO 无关的用户规则，例如语言偏好、SSH 策略、安全边界或项目约定。
- 只补齐缺失的 RAVO 边界规则：`AGENTS.md` 决定何时委派，RAVO 决定如何执行；简单事实问答不强制套第一性原理结构；RAVO 不可用时必须走明确 fallback。
- 展示 proposed diff，并说明增量行为变化。
- 等待用户明确批准后再写入。
- 写入前创建备份。
- 绝不静默修改用户规则文件。

如果现有 `AGENTS.md` 已经有强治理规则，优先做最小合并，避免重复插入同义 RAVO 文案。目标是选择性升级，不是再塞一份规则手册。

## 常见问题

<details>
<summary><strong>用户需要显式调用 RAVO 吗？</strong></summary>

不需要。RAVO 的目标是自然交互。显式 skill 名称适合测试和调试，但普通需求、根因、验收 prompt 应该通过 skill description 和 hooks 自动触发对应能力。

</details>

<details>
<summary><strong>安装 RAVO 时会同步安装 Grill-me 吗？</strong></summary>

不会。RAVO 不会把 Grill-me 仓库本体作为依赖一起安装。RAVO 借鉴的是它的*分析姿态*，不是把它当作一个外部插件打包进来。

具体来说，RAVO 现在把其中一部分思想写进了自己的 skill 契约里，比如要求分析时显式给出 `Facts`、`Challenge`、`Alternative Hypotheses`，避免停在第一反应和表层解释。

</details>

<details>
<summary><strong>RAVO 是一个大而全流程引擎吗？</strong></summary>

不是。RAVO 遵循奥卡姆剃刀原理：模块保持独立安装，通过 artifacts 连接。只有当共享 artifacts 不够用时，才考虑中心化调度器。

</details>

<details>
<summary><strong>RAVO 会自动修改 AGENTS.md 吗？</strong></summary>

不会。RAVO 可以预览并应用 Codex 全局 `AGENTS.md` 的推荐规则块，但用户或安装 Agent 必须先读取现有文件、检查 diff，并确认后再写入。

如果由 Agent 执行安装，应选择最小安全接入方式：

- 已有等价规则时不修改；
- 现有结构清晰时合并到原有 working-rules 段落；
- 没有合适结构时才新增带标记的 `RAVO` block。

</details>

<details>
<summary><strong>RAVO 默认作用于哪个 AGENTS.md？</strong></summary>

默认是当前用户主目录下的 Codex 全局 `AGENTS.md`。只有你明确想操作别的文件时，才使用 `--file <path>`。

</details>

<details>
<summary><strong>如果没有看到 hooks 授权提示怎么办？</strong></summary>

有些宿主不会弹出很显眼的授权提示。如果安装后自然触发看起来没有生效，就主动检查 RAVO hooks 是否已经被信任或批准；确认后新开一个 Codex 会话，再用几条简短 prompt 复测。

</details>

<details>
<summary><strong>最短的无上下文手工测试用例在哪里？</strong></summary>

可查看 [docs/quick-test-cases-zh.md](./docs/quick-test-cases-zh.md)。这些 prompt 适合在全新会话里直接测试，而且通常会很快结束。

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

如果你想用几条完全无上下文、不会跑太久的 prompt 做语义触发试用，可看 [docs/quick-test-cases-zh.md](./docs/quick-test-cases-zh.md)。

如果你想测试更接近真实开发过程的多轮场景，尤其是 Agent 主动交付治理链路，可看 [docs/runtime-flow-tests-zh.md](./docs/runtime-flow-tests-zh.md)。

如果你改动了 hooks、验收行为或触发逻辑，不要把这三条脚本命令本身当成“主动运行时链路已经证明”的结论；至少还应补跑一条 runtime flow。
