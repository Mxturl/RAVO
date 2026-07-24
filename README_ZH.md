<div align="center">

# RAVO

### 面向产品经理与 Codex 的轻量协作框架

[English](README.md) | 中文

</div>

当前开发版本：`v0.6.3`。版本号只表示产品代码版本，不代表已经验收、可发版或已发布。

## RAVO 是什么

RAVO 帮助产品经理和 Codex 更快得到正确、可信、可纠偏的结果。它会系统化处理需求、根因、重要方案和交付证据，但不治理 Codex 的每一个步骤，也不要求简单工作套用完整流程。

RAVO 以一个 `ravo@ravo` 插件完整安装，内部包含九个按需加载的 Skills。`AGENTS.md` 只负责场景召回和硬边界；具体方法由 Skill 与 Codex 根据任务选择。数据、凭据、权限、外部调用、不可逆操作、发布授权和状态真实性仍是不可绕过的边界。

## 怎么使用

像平常一样使用 Codex，不需要先选择流程，也不用记住模块名。明确的实施、修改或修复请求默认会推进到当前授权范围内的实现、验证和可恢复本地集成；你不需要再补一句“一次性完成”。讨论、解释、分析、规划和脑暴仍只回答当前问题。明确的小任务、事实问答、只读检查和低风险本地工作应直接完成；RAVO 未被召回时保持安静。

应用 RAVO 的用户级 `AGENTS.md` 引导后，你一次性授权 Codex 根据完整语境自然创建或复用 Goal，不需要在每个任务中提及 Goal。模型会结合当前意图、既有范围、剩余承诺和操作边界，判断连续执行是否能实质帮助完成任务；可靠步骤、跨轮推进和恢复价值只是语境信号，不是必须同时满足的清单、评分项或关键词。Goal 只提供连续执行，不会自动增加 Spec、Review、Acceptance 或证据要求。活跃 Goal 中的“继续”会复用当前目标，已经完成、终态阻塞或停放的 Goal 不会因为一句“继续”重复创建；只有出现新的独立目标才重新判断。宿主没有 Goal 能力或工具契约不允许创建时，Codex 仍继续默认交付，并对明显长程任务说明真实降级。

面对重要或模糊需求，可以直接说“帮我系统化梳理这个需求”。RAVO 会补齐消费者、场景、痛点、目标、边界、成功标准、非目标、约束和风险，并明确区分已确认事实、合理假设和待决策项。只有会改变产品方向、范围或成功标准的问题才需要你决定，其余缺口会作为可纠正的合理假设继续推进。

当对话中形成明确的新需求、范围外问题或可复用经验时，Codex 会先做最小分析，再显性说明已记录、已合并、已更新、进入 Spec Delta，或为什么无需持久化。你已经明确表达的需求会直接成为 confirmed candidate，不再重复询问“是否是需求”；Codex 推断的内容保持 `needs_triage`。接受、拒绝、延期、重复和理由都保留，但候选版本不会自动变成版本承诺或 Release Slice。

你可以直接问“下一版本候选需求有哪些”。Codex 会从当前 workspace 的结构化 Pool 返回 PM 列表，区分已锁定、候选和待确认，并显示类型、价值、优先级、下一步和责任人；不要求先打开 SoloDesk。普通事实问题、纯脑暴和无复用价值的一次性细节不会触发入池仪式。

遇到 Bug 时，先查清实际原因。稳定、局部、原因确定的问题只给出症状、根因、最小根级修复和一个回归检查；重复、未知、共享机制、高影响、数据、安全或权限问题才展开完整 RCA。简单问题不会因为使用了 RAVO 就变成一份长报告。

验证强度与真实风险、留证成本相称。每项改动仍需做实际检查；简单、局部、可逆、低风险 case 如果专门留证的时间或 Token 成本明显高于价值，可以只说明直接检查结果，不强制生成 Evidence Artifact。复杂、跨模块、高影响、数据、安全、权限、不可逆、验收和发布 case 仍必须有明确可追溯证据。

当你需要判断“是否完成、能否验收、是否可发版”时，使用 RAVO Acceptance。实现完成、自动验证通过、本机可用、PM 已接受、具备发布条件和已经发布是六个不同状态，必须分别由证据支持。

对于非简单任务，RAVO 会在阶段收口时给出一条明确负责人的具体下一步。它不会要求 PM 重复确认既定决策，也不会把范围内安全本地工作重新交回 PM；简单问答和一次性结果不会为了补建议而强行续写。

## 按需 Skills

| Skill | 何时使用 |
|---|---|
| `ravo-core` | 直接执行与 Goal 选择、Goal 生命周期、初始化、状态、入池决策、AGENTS、Release Goal Prompt、预检和迁移 |
| `ravo-requirement-analysis` | 重要或模糊需求需要系统化打磨 |
| `ravo-root-cause-analysis` | Bug 或失败需要查清实际原因 |
| `ravo-workstream` | 长程任务需要里程碑、阻塞和续跑证据 |
| `ravo-quick-validation` | 根据风险和采集成本选择验证与留证强度，用户语言为 RAVO Evidence |
| `ravo-release-acceptance` | 非简单交付、验收、发版或上线状态判断 |
| `ravo-knowledge` | 项目历史、决策或经验可能改变当前结果 |
| `ravo-review` | 重要、高风险或发布敏感方案需要独立对抗式审查 |
| `ravo-dashboard` | 直接查询下一版本候选，或打开、诊断本机 SoloDesk |

Codex 安装时只发现 Skill 的名称与简短描述，匹配场景或用户明确指定后才读取正文。这里的“按需”是上下文与召回策略，不是权限系统、固定步骤或调用顺序。

## 安装

本仓库使用 `.agents/plugins/marketplace.json` 作为本地 marketplace。在仓库根目录执行：

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo@ravo
```

安装后新建一个 Codex Task，让统一 Skills 和 Hooks 从干净会话加载。

### 从 v0.5.5 迁移

v0.6.3 正式支持从同一 marketplace 的八个 `0.5.5` legacy 插件迁移。先安装统一插件，再预览：

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js --preview
```

确认本机状态符合预期后执行：

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js --apply
```

apply 会先把八个已安装包复制到本机离线恢复快照，再逐项移除旧插件。中途失败会自动恢复八插件状态；如果自动恢复也失败，结果只提供同一个快照恢复命令。快照不读取或复制 Review Provider 配置，默认保留到 PM 验收完成，本版本不会自动删除。迁移成功后必须新建 Codex Task，旧 Session 不能证明 legacy Hooks 已消失。

只读检查统一包：

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-preflight.js
```

## AGENTS.md 召回

RAVO 不会静默修改 Codex 全局 `AGENTS.md`。先预览，再按用户明确要求应用：

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-agents.js
node plugins/ravo/modules/ravo-core/scripts/ravo-agents.js --apply
```

marked block 只有七条规则：默认交付与自然 Goal 生命周期、需求与 RCA 分级、按风险选择 Skill 与证据、Release Goal/Spec 和显性入池边界、下一版本候选投影、不可绕过的硬边界与状态真实性，以及非简单任务的一条明确负责人下一步。Skill 拥有结果契约，不垄断固定方法。

## Hooks

统一插件只注册：

- `Stop`：只读检查高阶验收/发布声明是否绑定当前响应显式引用或当前任务的 Acceptance，并检查明确形成需求、问题、经验或产品决定却遗漏显性处置的情况；它不会借用其它任务的 latest Acceptance，带直接检查的局部完成也不强制要求 Acceptance Artifact。两类检查合并为一次决定，同一回合最多续写一次，零 Artifact、零 telemetry、零网络写入。

v0.6.3 不注册 `PermissionRequest`、`UserPromptSubmit`、`SessionStart`、`SubagentStart`、`SubagentStop`、`PreToolUse` 或 `PostToolUse`。Requirement、RCA、Review 和 Acceptance 主要通过 Skill description 与 `AGENTS.md` 召回，而不是 Prompt 路由 Hook。

## Goal 与 Release Goal Prompt

普通、清晰的多轮 Codex Goal 不强制要求 Spec。应用用户级 RAVO AGENTS 引导后，模型获得基于完整语境选择 Goal 的持续授权；Goal 只解决连续执行，不改变默认交付责任或治理强度。宿主未启动、无能力或工具契约仍不允许时，RAVO 不会伪装 Goal 已生效。

RAVO 的版本交付、Release Slice、验收、上线或发布 Goal Prompt 是更严格的执行契约，生成前必须存在 current、decision-complete 的 Spec；新需求进入 Requirement/Issue Pool 或 Spec Delta，不能静默扩大当前 Release Slice。

```bash
node plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt.js --workspace "$(pwd)"
```

## SoloDesk

```bash
node plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk.js open
```

SoloDesk 只监听 loopback，复用单一用户实例，并只读取显式 allowlist 的 workspace。Dashboard 健康不等于当前功能已经本机可用，仍应以匹配的真实体验或 Acceptance 证据为准。

无需启动 SoloDesk 服务也能读取下一版本候选：

```bash
node plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool.js --scenario next_version_candidates --workspace "$(pwd)" [--version v0.6.3]
```

## Review 与知识

Review Provider 配置保存在 `~/.codex/skill-config/ravo-review.json`，示例为 `templates/ravo-review-config.example.json`。外部评审前必须先检查数据边界；Provider 已配置不等于内容已经获准外发。

```bash
node plugins/ravo/modules/ravo-review/scripts/run-review.js --preview --domain architecture --subject "Review this plan"
```

原始项目事实和证据默认只写当前 workspace。用户级可迁移知识必须显式 opt-in，并经过脱敏、scope、sensitivity 和 applicability 标注。

RCA、Review、smoke 或 Acceptance 形成稳定可复用事实时，产生事实的 Skill 会立即检查 Knowledge 候选；Goal、阶段或用户显式收尾时，再做一次 Knowledge、Pool、未完成事项、Spec Delta 或不保存的轻量分类。简单工作和空盘点保持静默，不使用 Stop Hook，也不承诺 100% 召回。

```bash
node plugins/ravo/modules/ravo-knowledge/scripts/retrieve-knowledge.js --query "<task>" --record-use false
```

## Artifact 协议

内部模块仍通过 workspace 文件连接，不引入中央流程引擎：

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── workstream/
├── quick-validation/
├── acceptance/
├── pool/
├── knowledge/
└── review/
```

Artifact/config/schema 的 `0.5.x` 版本是兼容协议，不随产品版本 `0.6.3` 自动改写。

## 本地验证

```bash
npm test
node scripts/validate-repo.js
node scripts/smoke-test.js
node scripts/prompt-regression.js
node scripts/ravo-v0.6-architecture-test.js
node scripts/ravo-v0.6-hook-test.js
node scripts/ravo-v0.6-migration-test.js
```

脚本通过只能证明对应自动检查，不等于 PM 已验收、可发版或已经发布。

## License

[MIT](LICENSE)

仓库：https://github.com/Mxturl/RAVO
