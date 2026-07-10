# RAVO v0.5.0 版本规格书

日期：2026-07-10

状态：decision-complete for development planning

## 来源

- `docs/ravo-v0.4.0-decision-complete-spec-zh.md`
- `docs/ravo-v0.5.0-requirements-alignment-zh.md`
- RAVO v0.4.0 PM 验收结果（workspace-local artifact，不随仓库发布）
- 当前 Session 关于“基本满足”、验收责任和可执行验证清单的讨论
- Codex Session `019f23ae-d42a-7de3-b70e-69da39bb74e1`
- `Wanted` 项目中的 SoloDesk / RAVO Dashboard 规格（外部产品输入，不随本仓库发布）
- `Wanted` 项目的插件系统愿景（外部产品输入，不随本仓库发布）
- `Wanted` 项目的参考产品调研（外部产品输入，不随本仓库发布）
- 2026-07-10 基于 RAVO 当前 Reason / Act / Verify / Organize 产品定义进行的 v0.5.0 范围复审
- 当前 `ravo-status`、`codex plugin list --json`、marketplace 和 hook trust record 的真实诊断结果
- 2026-07-10 关于 SoloDesk 配置管理、RAVO Review 多 Provider/多模型和一键升级的新增需求
- `knowledge/.ravo/analysis/2026-07-10T06-32-39-588Z-ravo-review-provider.json` 中关于配置状态误判的根因分析
- Codex Session `019f47b0-91a2-7182-a0e0-0a4fe081d07b` 中关于“没有外部授权所以跳过 Review”的真实案例
- 外部 `Skills` 工作区中的 RAVO Review 多模型需求评审证据（不随本仓库发布）
- 外部 `Skills` 工作区中的 RAVO Review 根因分析证据（不随本仓库发布）

本 Spec 是 RAVO v0.5.0 的唯一需求来源。来源文档只用于解释决策背景；当来源文档与本 Spec 冲突时，以本 Spec 为准。

## 产品定义

RAVO v0.5.0 要把 v0.4.0 的“可信治理闭环”升级为“产品经理可以持续巡视、理解并推进多个产品 workspace 的治理工作台”。

v0.5.0 包含六条相互支撑的主线：

1. PM 验收从模糊状态标签升级为可执行闭环。每个验收项必须区分需求满足程度和验证状态，任何未验证项都必须给出明确的责任人、步骤、预期结果和必需证据。
2. SoloDesk 作为 RAVO Dashboard 进入 RAVO 产品。它按 Codex workspace 聚合 RAVO artifacts 和 Session 元数据，展示状态、进展、成本/效率信号、堵点和下一步，并生成可直接用于下一轮 Codex Session 的上下文 Prompt。
3. Dashboard 必须证明自己的判断是否可信：按 Reason / Act / Verify / Organize / Runtime 组织注意力，识别 Spec 和证据陈旧、RAVO 运行健康、暂停/归档项目、数据置信度和知识复用边界。
4. SoloDesk 提供 RAVO 配置中心，集中管理各 RAVO 模块公开的用户级/workspace 级配置，并明确当前值、生效来源、合法范围和敏感字段状态。
5. RAVO Review 把已有 provider-array runner 能力升级为完整的多 Provider/多模型产品契约，配置、外发决策、可用响应、重试、问题台账、coverage 和 artifact 使用同一可信证据规则。
6. SoloDesk 提供 RAVO 更新检查和用户确认的一键升级，升级前备份配置，升级后验证插件集合、配置完整性和 fresh-session Runtime 状态。

用户可见名称：`SoloDesk`。

技术模块名称：`RAVO Dashboard` / `ravo-dashboard`。

核心映射：

```text
Codex workspace = Product
Codex Session = Execution Unit
RAVO Artifact = Source Fact
Dashboard View = Derived View
Shortcut = Pre-filled RAVO/Codex Prompt
```

## 与 v0.4.0 的关系

- v0.4.0 已开发能力是 v0.5.0 的回归基线，不在 v0.5.0 中重新定义或缩减。
- v0.5.0 必须保持 Review、Analysis、Root Cause、Acceptance、Knowledge、Goal Prompt、Workstream、Spec maintenance、Roadmap Audit 和 Technical Detail Level 的现有契约。
- v0.5.0 不得因为新增 Dashboard 而引入中心调度器，也不得让 Dashboard 替代现有 RAVO artifacts。
- v0.5.0 的版本交付必须同时通过新增能力验收和 v0.4.0 回归矩阵。
- v0.4.0 PM 验收文档中的未验证项不能自动继承为已验收；必须按 v0.5.0 新模型重新分类和补证。
- Dashboard 是 RAVO 生命周期的观察和入口层；R/A/V/O 各模块仍对自己的 artifact 和行为契约负责。
- SoloDesk 的配置与升级能力只作用于 allowlist 内 RAVO 配置和 RAVO marketplace/plugin，不扩大为任意 Codex 配置或包管理器。

## 真实消费者

### 主要消费者

本职是产品经理，同时使用 Codex/RAVO 推进多个产品 workspace 的个人用户。他们经常在多个项目之间切换，需要快速恢复上下文、判断优先级并发起下一步工作。

用户不仅需要知道哪个 workspace 更紧急，还需要表达哪些产品处于 active、paused 或 archived，避免系统把业务上主动暂停的产品误判为失控。

他们需要回答：

- 哪些 workspace 正在推进？
- 当前进展到哪里？
- 哪些结论只是实现了但尚未验证？
- 哪些工作被 blocker、验收或 Review 卡住？
- 哪些 workspace 长期未推进？
- 当前可观察到的效率和成本信号是什么？
- 下一步应该打开哪个 workspace，创建什么 Codex Session？

### 次要消费者

负责最终验收的产品经理。他们需要一份可以直接执行的验收清单，而不是“基本满足”“脚本通过”或 artifact 路径列表。

### 维护消费者

RAVO 开发者。他们需要明确 Dashboard 的数据来源、状态推导、降级行为、安全边界、API、UI 验收和回归要求。

## 目标

### 产品目标

- 用户在 30 秒内识别最需要关注的 workspace 及原因。
- 用户能从任何 Dashboard 结论追溯到源 artifact 或 Session。
- 用户能看清“功能是否满足”和“证据是否验证”是两件不同的事。
- 用户能直接获得下一轮 Codex Session 所需的上下文 Prompt。
- Dashboard 不建立第二套产品事实库，不增加传统 PM CRUD 负担。
- 用户能判断 RAVO marketplace、插件、hook trust record、版本和 workspace manifest 是否足以支撑当前结论。
- 用户能识别 Spec、Review 和 Acceptance 是否已被更新输入或实现证据淘汰。
- 暂停和归档 workspace 不制造 stale 噪声，真正需要注意的工作集中进入跨 workspace 注意力队列。
- 用户能在 SoloDesk 中安全修改 RAVO 配置，不需要手工编辑 JSON，也不会看到或意外覆盖 secret 原值。
- 用户能按 Provider 管理 Review models，并在发起前看清 Provider/model/round 数和最大调用次数。
- 用户能区分“Provider 已配置”“当前内容允许外发”“模型已响应”和“模型产生可用 Review”四种不同状态。
- 用户能从 Review 结论追溯到脱敏输入、真实 raw response、结构化 findings、issue ledger、重试/fallback 和聚合 coverage。
- 用户能检查 RAVO 更新并通过一次确认完成升级；配置、权限和语义在升级前后可核对、可恢复。

### 成功标准

- PM 验收文档不再生成“基本满足”终态。
- 所有非已验证项都有可执行验证任务。
- `pending_codex` 与 `pending_pm` 在文档和 checker 中被明确分区。
- Dashboard 能读取至少 5 个真实 workspace，并正确处理 active、pending/blocker、no_ravo_data、paused、archived 和损坏数据状态。
- Dashboard 展示的每个状态、指标和建议都有来源或明确规则。
- 至少 3 类 Dashboard 快捷指令通过真实 Codex Session E2E。
- 桌面和移动视口的真实界面通过 PM 验收，无重叠、截断或不可操作控件。
- RAVO marketplace/plugin/hook trust record 缺失时，Dashboard 在一次刷新内显示 Runtime 降级，不能继续给出高置信度治理结论。
- newer alignment/spec delta/相关实现证据存在时，Dashboard 把 Spec 或 Acceptance 标记 stale，并阻止不安全的续跑 Prompt。
- paused/archived workspace 不进入默认推进建议；priority 只用于可解释排序，不生成综合分。
- “继续这个 workspace”生成的 Continuation Brief 能让 fresh Codex Session 直接说明目标、milestone、blocker、待验证项和证据边界。
- SoloDesk 配置中心覆盖全部 RAVO 公开配置，非法输入不落盘，合法输入重启后仍生效。
- 至少两个 Provider、每个至少一个 model 的 Review 运行能独立记录成功、失败、重试和 coverage。
- Review 对空正文、仅 reasoning、`incomplete`、截断和 schema 无效响应不会报告 usable/full；双模型 raw findings 与 issue ledger 可核对一致。
- Retry 证据中的计划等待和真实等待一致，transport retry 与 semantic retry 都受调用预览中的统一 attempt budget 约束。
- 从旧版 RAVO 到 v0.5.0 的一键升级 E2E 证明配置未丢失、未被模板覆盖，失败可从 journal 恢复。

## 当前基线

### 已开发且继续保留

- RAVO 已有 `analysis`、`workstream`、`quick-validation`、`acceptance`、`knowledge`、`review` artifacts。
- 每个启用 RAVO 的 workspace 可通过 `knowledge/.ravo/manifest.json` 发现模块和最新 artifact。
- Acceptance 能生成 PM Markdown 和 JSON artifact，并能校验证据等级与安全基线。
- Goal Prompt 能检查缺失或陈旧 Spec。
- Workstream 能记录 milestone、Roadmap Audit 和 worker evidence。
- Knowledge 能检索 workspace-local knowledge，并在授权后读取用户级知识。
- Codex 本地保存 Session 索引和 rollout 元数据，可用于只读恢复 workspace 活动。

### 已开发但存在明确差距

| 模块 | 当前实现 | 明确差距 | v0.5.0 处理 |
|---|---|---|---|
| Acceptance 状态 | 每个 item 只有自由文本 `judgment` | “基本满足”混合功能缺口和证据缺口 | 拆为满足程度和验证状态 |
| PM 验收清单 | 输出 `验收项：判断` | 没有责任人、步骤、预期结果和证据 | 输出结构化验证任务 |
| Acceptance writer | 表格只有需求、方案、效果、判断 | Spec 已要求的 PM 验收方式、必需证据、风险没有落地 | 扩展 schema、Markdown 和 checker |
| Acceptance fallback | `accepted` 默认写成“基本满足” | `accepted` 与“仍需验证”语义冲突 | 删除该 fallback，按新状态推导 |
| 验收责任 | 未区分 Codex 和 PM | Codex 可能把可自动验证工作推给 PM | 强制 `pending_codex` / `pending_pm` 分区 |
| 跨 workspace 可见性 | artifacts 只在各 workspace 内 | 用户需要逐个翻目录和 Session 恢复状态 | 新增 SoloDesk Dashboard |
| 成本/效率 | 没有跨 workspace 视图 | 用户无法识别反复分析、长期停滞和多次验收失败 | 展示可验证信号，不做伪精确分数 |
| 下一步 | 单个 Session closeout 有建议 | 没有跨 workspace 的巡视和优先级入口 | 基于规则和来源生成主要关注原因与 Prompt |
| 生命周期视图 | 模块各自写 artifact | 用户无法按 Reason/Act/Verify/Organize 判断缺的是哪一段闭环 | 增加 R/A/V/O/Runtime 视图和注意力分类 |
| Portfolio 上下文 | workspace 全部按同一规则处理 | paused/archived 项目会制造 stale 噪声，缺少产品优先级 | 增加最小 workspace override 配置 |
| Spec/证据新鲜度 | Goal Prompt 有 stale guard，Dashboard 尚未消费 | 最新文件不一定是当前有效结论 | 增加 spec/evidence freshness 与置信度 |
| Runtime 健康 | `ravo-status` 主要看源码和安装缓存 | 不能证明 Codex marketplace/plugin enabled/hook trust record 当前有效 | 扩展 status 契约并进入 Dashboard |
| Continuation | 下一步建议是短文本 | fresh Session 仍可能重新猜目标、阻塞和验收缺口 | 增加 Continuation Brief |
| Knowledge 复用 | 单 workspace 任务可检索 knowledge | Dashboard 快捷指令没有稳定带入相关经验 | 在高影响 Prompt 生成前复用现有 retrieval |
| RAVO 配置 | `ravo.json`、`ravo-review.json` 和 workspace config 主要靠手工编辑 | 参数分散、来源不透明、非法值和 secret 容易被误处理 | SoloDesk schema-driven 配置中心 |
| Review Providers | runner/template 已支持 flat config 和 `providers[]`，可并行执行多个 provider/model pair | 缺少 UI、权威配置状态、重复 model id 消歧和多 Provider E2E；调用方曾误判配置不存在 | 提取共享归一化/校验入口并产品化管理 |
| Review 外发与响应 | 依赖 Agent 临场判断；HTTP 返回即进入 `modelsCompleted` | Provider 配置可能被误当外发授权；空正文/incomplete 可能计成功；coverage 不等于可用证据 | 三态外发决策、usable response gate 和证据分层 |
| Review Retry | timeout、连接错误和部分 HTTP 状态可重试 | 不重试空正文/incomplete/schema 无效；记录的 delay 与真实等待可能不一致 | transport/semantic retry、真实退避和统一 attempt budget |
| Review Issue Ledger | 按包含“风险/建议”的文本行正则抽取 | finding 丢失、严重度降级、证据/建议错配，可能污染后续轮次和 Acceptance | 结构化 findings、parser 完整性门禁和 raw 可重建性 |
| Analysis Complete | requirement artifact 只强制 fact、challenge、conclusion | 大量关键字段为空仍可标 complete，用户可见结论与 artifact 可漂移 | 按分析类型强校验字段和 Review evidence |
| Plugin Runtime Path | Prompt/Agent 可能硬编码缓存版本路径 | 插件升级后旧 Skill 元数据与 scripts 版本漂移，触发 `MODULE_NOT_FOUND` | 当前 plugin root 或稳定版本无关入口 |
| RAVO 升级 | 依赖手工执行 marketplace/plugin 命令和安装后检查 | 没有更新预览、整套版本检查、配置备份、migration journal 和恢复入口 | SoloDesk 一键升级程序 |

### 未开发功能

- Acceptance 双维状态 schema。
- 结构化验证任务及责任人分区。
- 旧 `基本满足` artifact 的兼容迁移和重新分类检查。
- 跨 workspace RAVO artifact 索引。
- SoloDesk 本地服务、API 和前端。
- workspace 多维状态和主要关注原因。
- 跨 workspace 轻量效率/成本信号。
- Dashboard Prompt 快捷指令和真实 Codex Session E2E。
- R/A/V/O/Runtime 生命周期覆盖视图和跨 workspace 注意力队列。
- workspace priority、active/paused/archived 最小 Dashboard 配置。
- Spec、Review、Acceptance 和派生视图的新鲜度/置信度模型。
- Codex marketplace/plugin JSON、hook trust record 和 manifest 的运行健康检查。
- Continuation Brief 和快捷指令中的 workspace/global knowledge 复用。
- SoloDesk RAVO 配置中心、配置契约和受控写入 API。
- Review Provider/model 管理界面、权威 config status 和多 Provider E2E。
- Review 三态外发决策、usable response gate、semantic retry、真实退避和统一 attempt budget。
- 结构化 reviewer findings、可重建 issue ledger、Review 聚合运行和基于 usable pair 的 coverage。
- Analysis complete artifact 强校验和版本无关插件运行入口。
- RAVO 更新检查、一键升级、配置备份/migration journal 和失败恢复。

## Open-Source First 决策

已讨论和检查的参照对象包括 Linear、Productboard、Plane、Huly、OpenHands、Claude Code hooks、GitHub Spec Kit、BMAD Method 和 ChatPRD。

结论：

- 不 fork Plane/Huly 等重型 PM 系统。它们的对象模型、部署复杂度和许可证边界超出 v0.5.0 本地治理工作台与受控配置/升级需求。
- 不复制 Linear 的传统 issue/project 交互；只借鉴其信息密度和快速定位原则。
- 借鉴 Productboard/Dovetail/Canny 的“信号到判断”思路，但不建立客户反馈 SaaS。
- 借鉴 OpenHands 类 agent console 的活动可见性，但不做通用 Agent 调度平台。
- 复用 RAVO 现有 artifact、Spec、Goal Prompt 和 Acceptance 协议，不新增第二套工作流引擎。
- Dashboard MVP 使用 Node.js 标准库和静态前端，不新增数据库或重型框架。
- 配置写入复用 Node.js 标准库、现有 RAVO config reader 和原子文件替换，不引入通用配置平台。
- 更新程序复用 Codex 原生 marketplace/plugin CLI，不自建下载器或包管理器。
- 图标使用本地打包的 Lucide 图标子集并保留许可证说明，不依赖 CDN。

## 范围决策

### v0.5.0 必须完成

1. Acceptance 双维状态模型。
2. 非已验证项的结构化验证任务。
3. Codex 补证与 PM 验证责任分离。
4. PM 验收 Markdown、JSON schema、writer、checker 和模板同步升级。
5. 旧“基本满足”artifact 的保守兼容和重新分类规则。
6. 重新生成 v0.4.0 PM 验收包，按新口径列出真实待验证项。
7. 新增 `ravo-dashboard` 插件模块，用户可见名称为 SoloDesk。
8. 配置化 workspace roots 和只读 workspace discovery。
9. manifest、artifact、Session 元数据的本地索引。
10. workspace 总览、详情、时间线和来源查看。
11. 活跃度、交付、Review、数据完整性四维状态。
12. 主要关注原因、堵点和下一步建议。
13. 可验证的效率/成本信号。
14. 11 个上下文 Prompt 快捷指令，并按状态最多展示 4 个主要动作。
15. 空状态、无 RAVO 数据、损坏 artifact、权限错误和部分数据降级。
16. 本地服务安全边界、路径 allowlist、输出转义和日志脱敏。
17. 桌面/移动响应式 UI、真实截图和 PM 验收清单。
18. 至少 5 个真实 workspace 和 5 类真实 Codex Session 快捷指令 E2E。
19. v0.4.0 全能力回归。
20. README、README_ZH、配置模板、schema、smoke、validation、installed plugin cache 和版本号同步。
21. R/A/V/O/Runtime 生命周期视图和跨 workspace 注意力队列。
22. `workspaceOverrides`：displayName、priority、active/paused/archived。
23. `specHealth`、Review/Acceptance freshness、`derivedAt`、`sourceUpdatedAt` 和 confidence。
24. 扩展 `ravo-status`：marketplace、Codex plugin enabled、source/cache/runtime version、hook trust record、manifest/config 健康。
25. Runtime 健康异常时的全局 warning、workspace 置信度降级和恢复入口。
26. Continuation Brief：目标、Spec、milestone、blocker、待验证项、知识、Runtime 和数据缺口。
27. 高影响快捷指令生成前检索 workspace knowledge；用户已 opt-in 时再检索 user scope。
28. 无 RAVO 数据 workspace 的初始化 Prompt；不自动执行。
29. 基于真实用户 Session 意图样本校准快捷指令目录，并按当前状态只展示最相关动作。
30. Knowledge retrieval 增加无写入查询模式；Dashboard 读取 knowledge 时不得更新 `lastUsedAt` 或任何 artifact/index。
31. 为全部 RAVO 公开配置提供单一配置契约，包含 module、作用域、固定目标文件、字段类型、默认值、合法范围、secret 标记和说明。
32. SoloDesk 配置中心：按模块分组展示 effective value/source/status，并支持 user/workspace 配置的校验、保存和恢复。
33. 配置写入必须深合并保留未知字段、原子替换、保留 owner、使用安全权限、写前备份；secret 不回显、不记录。
34. 提取 RAVO Review 共享 config normalizer/validator，runner、SoloDesk 和 status 必须复用；支持多个 Provider 下多个 models 和 `providerId/modelId` 唯一标识。
35. 多 Provider Review 的调用预览、逐 Provider/model 运行证据、独立失败/重试和 coverage 计算。
36. SoloDesk RAVO 更新检查和用户确认的一键升级，只调用固定的 Codex marketplace/plugin 子命令。
37. 升级前配置快照、版本集合、schema migration preview、升级 journal、失败恢复、升级后配置/Runtime/fresh-session 验证。
38. Review 三态数据边界决策、脱敏摘要和授权来源证据。
39. `modelsResponded/modelsUsable/modelsFailed` 分层与 usable response 强校验。
40. transport retry、semantic retry、真实退避和调用预览内的统一 attempt budget。
41. 结构化 reviewer findings、可重建 issue ledger 和 parser 完整性门禁。
42. `reviewRunId` 聚合、fallback/补偿证据和基于 usable pair/round 的顶层 coverage。
43. Analysis complete artifact 按类型强校验，并要求高影响任务具备匹配的 Review evidence。
44. RAVO 插件使用版本无关运行入口，升级后通过 fresh-session 路径回归。

### v0.5.0 明确不做

- 不做独立 SoloDesk 产品管理系统。
- 不做 Product、Requirement、Version、Task 主数据 CRUD。
- 不做团队账号、权限、云同步或远程服务。
- 不做 roadmap、甘特图、工时和 issue tracker。
- 不自动修改 Spec、artifact、knowledge 或项目源码。
- 不做中心调度器或通用 Agent 控制平台。
- 不扫描整个用户主目录。
- 不默认展示完整 Session prompt、工具输出或响应正文。
- 不在缺少稳定来源时估算 token、货币成本或效率分。
- 不在 v0.5.0 强制实现一键创建 Codex Task；默认交付可复制 Prompt。宿主提供稳定 API 后再评估。
- 不把 Dashboard 的派生状态写回为新的项目事实。
- 不把 `technicalDetailLevel=1` 解释为省略证据或隐藏风险。
- 不管理任何第三方 skill 配置，不提供任意 JSON/文件编辑器；兼容配置契约只作为后续版本扩展方向。
- 不升级 Codex Desktop/CLI 本体，不从用户输入的 URL、路径或命令安装软件。
- 不自动修改无关 `~/.codex/config.toml`、批准 hook 或静默升级；只有用户明确确认后才能升级 RAVO marketplace/plugin。
- 不做后台通知、系统托盘、邮件提醒或跨设备推送。
- 不做持久化 snooze/acknowledge 工作流；需要时进入后续版本。
- 不从完整 Session 正文自动训练或生成用户画像。

## 假设

- 用户本机可运行 Node.js，且 RAVO 现有脚本运行环境保持可用。
- Codex Session 索引或 rollout 文件格式可能变化，因此必须有版本容错和降级状态。
- workspace roots 可以由用户级 RAVO 配置维护。
- Browser 能访问本机 `127.0.0.1` 服务。
- Dashboard 读取的数据主要是本地项目事实，不需要外部网络。
- PM 验收文档可以在最终对话中发送核心内容并提供本地路径。
- Codex CLI 当前提供 `plugin marketplace upgrade`、`plugin list --json` 和 `plugin add --json`；实现必须在目标版本上验证其实际升级语义。
- RAVO 用户配置位于插件缓存之外；升级程序仍必须独立备份和验证，不能依赖这一目录关系作为唯一保障。

## 非目标

- v0.5.0 不修复 Codex Desktop 对本地 marketplace 配置重写的宿主机制，但必须检测 marketplace/plugin/hook trust record 缺失、降低状态置信度并给出恢复入口。
- v0.5.0 不承诺 Session token/cost 数据一定可用；没有可信字段时必须显示“无可用数据”。
- v0.5.0 不把 Dashboard 作为正式需求库或产品主数据源。
- v0.5.0 不要求 Dashboard 在 RAVO 未安装的 workspace 中推断治理状态。
- v0.5.0 不管理任何第三方 Codex skill 配置；兼容配置契约只作为后续版本扩展方向。
- v0.5.0 不自动 `git pull` 本地 marketplace source；本地 source 只比较当前 checkout 与 installed cache，并在用户确认后重装当前 source。

## 输入与输出

### 输入

- v0.5.0 Acceptance item 和现有 acceptance artifact。
- 用户级 RAVO Dashboard 配置与本次 CLI override。
- allowlist 内 workspace 的 `knowledge/.ravo/manifest.json` 和 artifacts。
- 与 allowlist workspace 匹配的 Codex Session 元数据。
- 可选、只读的 Git 状态元数据。
- 用户在 Dashboard 中选择的 workspace 和快捷指令类型。
- Codex marketplace/plugin JSON 状态、RAVO hook 文件和 hook trust record。
- workspace override：displayName、priority、lifecycle。
- Goal Prompt stale-spec 检查结果和相关 knowledge retrieval 结果。
- RAVO 配置契约、用户级/workspace 级配置和 secret configured 状态。
- `ravo-review.json` 中的 Provider/model 配置，以及共享 validator 的脱敏结果。
- Review subject 的数据边界分类、脱敏摘要、授权来源和逻辑 `reviewRunId`。
- Codex marketplace source type、可用/已安装插件版本和用户发起的更新/升级操作。

### 输出

- 新 schema 的 acceptance JSON artifact。
- 面向产品经理的验收 Markdown。
- Codex 补证清单和 PM 验收清单。
- localhost Dashboard API 和 SoloDesk UI。
- 可追溯的 workspace 多维状态、指标、主要关注原因和下一步建议。
- 可预览、可复制的 RAVO/Codex Prompt。
- Dashboard 与快捷指令的真实 E2E 证据、截图和 PM 验收包。
- R/A/V/O/Runtime 生命周期状态和跨 workspace 注意力队列。
- Runtime 健康、Spec/证据新鲜度、数据置信度和恢复入口。
- 可用于 fresh Session 的 Continuation Brief。
- 配置中心的脱敏配置视图、校验结果、备份引用和保存结果。
- Review Provider/model 列表、调用预览和脱敏运行状态。
- Review 的 transport/usable 模型状态、attempt 证据、结构化 findings、可重建 issue ledger 和聚合 coverage。
- 更新检查结果、升级计划、配置备份、upgrade journal、逐插件结果和重启/fresh-session 提示。

## 触发规则

- Codex 发起交付、验收、完成、发版、readiness、done 或等价结论时，触发新版 Acceptance 检查和 PM 验收文档生成。
- Acceptance item 出现非 `verified` 状态时，强制生成验证任务；出现 `pending_codex` 时优先继续补证，不进入最终 PM 验收。
- 读取旧 artifact 发现“基本满足”时，触发重新分类，不允许原样继承为通过状态。
- 用户显式启动 `ravo-dashboard`、调用 Dashboard skill 或运行 Dashboard CLI 时启动 SoloDesk；不通过 SessionStart hook 自动常驻启动服务。
- Dashboard 启动、用户手动刷新或达到刷新周期时重建内存索引。
- 用户选择 workspace 时按需加载详情和时间线。
- 用户选择快捷指令时生成 Prompt 预览；选择 Goal Prompt 时必须先运行 missing/stale Spec guard。
- Dashboard 发现 blocker、pending verification、Review gap、stale workstream 或数据错误时生成对应主要关注原因，但不自动执行下一步。
- Dashboard 发现 marketplace/plugin/hook trust record 缺失或版本漂移时，Runtime warning 优先于业务推进建议。
- Dashboard 发现 newer alignment、candidate、spec delta、TODO 或相关 evidence 晚于正式结论时，触发 freshness 降级。
- paused/archived workspace 不触发 stale 或“继续推进”建议。
- 生成 `继续 workspace`、`分析需求`、`找堵点`、`检查验收缺口` 或 Goal Prompt 等中高影响 Prompt 前，触发现有 Knowledge 检索；无高价值结果时保持静默。
- 用户进入设置时读取 RAVO 配置契约和脱敏 effective config；只有点击保存并通过校验后才写入。
- 用户新增/修改 Review Provider 或 model 时调用共享 validator；保存不发起外部请求，连接测试或 Review 必须由用户单独触发。
- SoloDesk 只有用户显式发起 Review/Provider test 才允许外部请求；Codex 治理流程已触发 Review 时先执行三态数据边界检查，`safe_sanitized` 可继续，`sensitive_requires_consent` 停在确认门，`prohibited` 拒绝外发。
- Review 返回后先执行 usable response 和 findings schema 校验，再更新 issue ledger、coverage 和 manifest；不得先写成功状态再补校验。
- 用户点击检查更新时刷新 RAVO marketplace/版本信息；点击升级并确认计划后才执行备份和固定 Codex plugin 命令。
- 升级完成后强制刷新 Runtime 状态，并提示新建 Session；有 hook 的插件未通过 fresh-session probe 前不得标 healthy。
- Dashboard 不改变现有 RAVO Analysis、Review、Root Cause、Knowledge、Workstream 和 Goal 的触发规则。

## 统一失败与降级行为

- 单个 workspace、manifest、artifact 或 Session 解析失败时，隔离到该数据源并返回 `partial|error`；其它 workspace 继续可用。
- 配置缺失或非法时使用本 Spec 定义的保守默认值，并把 warning 显示给用户。
- workspace roots 为空时只索引当前 workspace，不扩大扫描范围。
- Session 元数据不可用时继续展示 artifact 状态，并明确 Session 数据缺口。
- artifact 不足以推导状态时使用 `unknown|no_data|pending_classification`，不得猜测。
- Runtime 健康证据不完整时使用 `unknown|degraded`，不得只因缓存目录存在就报告 healthy。
- Spec/Review/Acceptance freshness 无法建立 source 关系时使用 `unknown`，不得按“文件名最新”推断 current。
- Knowledge retrieval 失败不阻塞只读 Dashboard，但 Prompt 必须标明未应用相关知识，且不能把缺知识解释为功能风险。
- Dashboard 服务端口不可用时尝试后续可用端口；全部失败时输出明确错误和手工指定端口方式。
- UI 无法打开或截图工具不可用时，不得用 API smoke 代替 UI 验收；记录阻塞并提供恢复入口。
- 快捷指令缺少关键 source refs 时只生成不完整上下文提示，不生成看似可直接执行的高风险 Prompt。
- RAVO Review provider 不可用时记录 `coverage=none|partial`，不伪造外部评审。
- Provider 已响应但正文为空、仅包含 reasoning、`incomplete`、截断或 schema 无效时，记录 responded 诊断和 semantic retry；attempt 耗尽后该 pair 为 failed/unusable，不能进入 `modelsUsable`。
- Issue ledger 无法从结构化 findings 重建、finding 数不一致或字段错配时，parser 状态为 error/partial，顶层 coverage 最高为 `partial`。
- Retry 实际等待与计划退避不一致时，本次 retry evidence 无效并使 Review 最高为 `partial`；不得只相信 artifact 中声明的 `delayMs`。
- 配置校验失败、备份失败或写锁被占用时不改变原文件，并返回字段级错误或恢复入口。
- 升级计划无法建立、配置备份不完整、任一 required plugin 安装失败或升级后版本混合时，状态为 `failed|partial`，不得显示升级成功。
- schema migration 失败时恢复升级前配置并保留 journal；不能恢复时标 blocked 并给出备份路径和手工恢复步骤。
- 多 Provider Review 中单个 provider/model 失败只降低对应 pair 和整体 coverage，不丢弃其它成功结果。
- 任何失败降级都不得提高 Acceptance、Review 或 release readiness 状态。

## 总体架构

```text
configured workspace roots
        |
        v
workspace discovery
        |
        +--> knowledge/.ravo/manifest.json
        +--> knowledge/.ravo/** artifacts
        +--> Codex session index / rollout metadata
        +--> optional git metadata
        +--> codex marketplace/plugin JSON
        +--> hook files and trust records
        +--> Goal Prompt spec check
        +--> RAVO knowledge retrieval
        +--> RAVO config contracts and allowlisted config files
        +--> Codex marketplace/plugin update state
        |
        v
in-memory workspace index
        |
        +--> R/A/V/O/Runtime lifecycle lanes
        +--> runtime/spec/evidence freshness
        +--> multi-dimensional state
        +--> cross-workspace attention queue
        +--> metrics/signals
        +--> source references
        +--> continuation/shortcut context
        |
        v
localhost API
        |
        +--> read-only governance views
        +--> allowlisted config mutations
        +--> user-confirmed RAVO upgrade
        |
        v
SoloDesk UI
```

架构原则：

- 读现有事实，不建立数据库。
- 规则优先，不为基础状态判断引入 LLM。
- 每个派生结论可追溯。
- 一个 workspace 数据损坏不能拖垮整个 Dashboard。
- 默认本地；治理事实只读。仅用户明确触发的 allowlist 配置写入、RAVO 升级和 Review/Provider test 可以产生受控写入或外部调用。
- Dashboard 不成为 RAVO 模块之间的新中心依赖。
- Dashboard 复用 RAVO Core、Goal Prompt、Acceptance 和 Knowledge 的既有判断，不复制实现规则。
- 没有宿主运行证据时，配置存在只能说明 configured，不能说明自然触发已在当前 Session 生效。

## 模块契约 1：可执行 PM 验收

### 产品目标

Codex 发起交付时，必须清楚说明哪些需求已经满足、哪些还未满足、哪些证据已经验证、哪些仍需 Codex 或 PM 验证，并给出可直接执行的步骤。

### Acceptance Item Schema

每个验收项必须包含：

```text
id
name
required
expected
implementation
effect
fulfillmentStatus
verificationStatus
verificationOwner
verificationReason
verificationTasks[]
sourceRefs[]
risk
boundary
```

合法值：

- `fulfillmentStatus`：`met | partial | not_met | not_applicable | unknown`
- `verificationStatus`：`verified | pending_codex | pending_pm | blocked | pending_classification`
- `verificationOwner`：`codex | pm | shared | external`

每个 `verificationTask` 必须包含：

```text
id
claim
reason
owner
steps[]
expectedResult
evidenceRequired[]
failureAction
blocking
```

### 状态规则

- `verified`：必需证据存在，结论已按验收方式复核。
- `pending_codex`：Codex 仍能通过测试、真实 Session、截图、日志或数据检查补齐证据。
- `pending_pm`：只剩产品判断、体验判断、业务效果或用户主观确认。
- `blocked`：缺账号、权限、provider、设备、外部系统或其它不可由当前 Agent 消除的条件。
- `pending_classification`：旧 artifact 或输入无法判断缺的是实现还是证据。

### 强制行为

- 任何 `verificationStatus != verified` 的 required item 必须至少有一个验证任务。
- `pending_codex` 项必须出现在“Codex 尚需完成的验证”中，不能伪装成 PM 验收项。
- 存在未阻塞的 `pending_codex` 时，Codex 应继续补证，不能发起最终 PM 验收。
- `pending_pm` 项进入“PM 验收清单”，必须写明用户路径和判断标准。
- `blocked` 项必须写阻塞原因、影响、临时降级、恢复入口和解除阻塞后的验证步骤。
- `not_applicable` 必须给出理由和替代证据，不能用来跳过本应执行的验证。
- `partial` 和 `not_met` 必须列出缺口，不能只列验证任务。
- PM 验收文档不得再生成“基本满足”作为终态。

### 总体状态推导

| 条件 | 最高允许状态 |
|---|---|
| required item 为 `not_met` | `not_ready` |
| required item 为 `partial` | `not_ready` 或明确阻塞降级 |
| 存在未阻塞的 `pending_codex` | `code_complete` |
| required item 均 `met`，只剩 `pending_pm` | `pending_acceptance` |
| required item 均 `met` 且全部 `verified` | `accepted` |
| `accepted` 加真实 E2E/full review 和安全基线 | 才可进一步判断 `release_ready` |

### 旧 artifact 兼容

- v0.5.0 writer 不再输出 `judgment=基本满足`。
- 读取旧 artifact 时，“基本满足”只能降级为：`fulfillmentStatus=unknown`、`verificationStatus=pending_classification`。
- 旧 artifact 如果没有责任人和验证任务，checker 必须报告缺口，不能自动推断为 `pending_pm`。
- v0.4.0 PM 验收包必须重新生成，不能通过字符串替换完成迁移。

### PM 验收 Markdown 结构

1. 验收结论摘要。
2. 需求预期、当前方案、实现效果、满足程度、验证状态对比表。
3. Codex 尚需完成的验证。
4. PM 验收清单。
5. 已验证证据。
6. 未满足/部分满足项。
7. 阻塞、风险和产品边界。
8. 下一步建议。

每个 PM 验收任务必须包含：

- 验收目标。
- 前置条件。
- 操作步骤。
- 预期结果。
- 需要提供的证据。
- 失败时应记录的实际结果和后续处理。

### v0.4.0 验收项重新分类要求

| 验收项 | v0.5.0 初始处理 |
|---|---|
| Review 多轮编排 | fake provider 证据不能替代真实 provider；先标 `pending_codex` |
| 需求共创与盲区 | prompt regression 不能替代真实交互；至少包含真实 Session 和 PM 体验验证 |
| RCA 强化 | 普通问题真实 Session 由 Codex补证；多模型 provider 缺失时标阻塞 |
| PM 验收包 | 当前缺逐项验收方式和验证任务，满足程度不得高于 `partial` |
| Knowledge 复用与价值门槛 | smoke 后仍需真实跨 workspace 复用路径验证 |
| technicalDetailLevel=1 | 需要 PM 对真实输出进行可读性和证据保留验证 |
| Goal Prompt missing/stale spec | 保留现有真实 Session 证据并按新 schema 复核 |
| Roadmap Audit 与 worker evidence | 需要真实多 milestone Goal 运行证据 |

### Checker 契约

checker 必须机械检查：

- required fields 是否存在。
- enum 是否有效。
- 非已验证项是否有任务。
- task 是否包含步骤、预期结果、证据和失败处理。
- `pending_codex` 是否错误进入 PM 清单。
- `pending_pm` 是否有 PM 可执行用户路径。
- blocked 是否有恢复入口。
- overall status 是否超过 item 证据允许的上限。
- accepted/release_ready 是否通过安全基线。

### 降级行为

- 输入只有自由文本时，生成 `pending_classification`，不猜测结论。
- PM 文档字段缺失时仍生成可读文档，但 checker 返回 `not_ready` 和具体缺失字段。
- 旧 artifact 解析失败时保留原文引用，并要求重新生成。

## 模块契约 2：RAVO Dashboard / SoloDesk

### 产品目标

在不建立第二套产品数据库的前提下，把多个 workspace 的 RAVO 过程事实组织成可巡视、可追溯、可行动的产品视图。

### 插件结构

新增：

```text
plugins/ravo-dashboard/
  .codex-plugin/plugin.json
  skills/ravo-dashboard/SKILL.md
  scripts/ravo-dashboard.js
  scripts/ravo-config.js
  scripts/ravo-upgrade.js
  config/ravo-config-contract.json
  app/index.html
  app/styles.css
  app/app.js
  app/assets/
```

约束：

- 使用 Node.js 标准库提供本地 HTTP 服务。
- 前端使用原生 HTML/CSS/JavaScript。
- 不新增数据库、构建系统或前端框架。
- 图标资源本地打包，不使用外部 CDN。
- 默认监听 `127.0.0.1:4317`；端口占用时自动选择下一个可用端口并打印实际 URL。
- 支持 `--open`、`--port`、`--refresh` 和 `--workspace-root` 的有界 CLI override。
- 配置写入和升级只通过固定模块 id、固定配置路径和固定 Codex argv；不接受任意路径、命令、URL 或 executable override。

### 配置

用户级 `~/.codex/skill-config/ravo.json` 增加：

```json
{
  "dashboard": {
    "enabled": true,
    "workspaceRoots": [],
    "workspaceOverrides": {},
    "port": 4317,
    "staleAfterDays": 7,
    "refreshSeconds": 60,
    "artifactLimitPerWorkspace": 500,
    "showPromptSnippets": false,
    "includeGitStatus": false
  }
}
```

`workspaceOverrides` 示例：

```json
{
  "/absolute/workspace/path": {
    "displayName": "RAVO",
    "priority": "high",
    "lifecycle": "active"
  }
}
```

规则：

- `workspaceRoots` 是目录 allowlist，不是单个 workspace 列表。
- `workspaceOverrides` 只接受 canonical absolute path；合法字段为 `displayName`、`priority=high|normal|low`、`lifecycle=active|paused|archived`。
- 未配置 override 时使用目录名、`priority=normal`、`lifecycle=active`。
- `paused` 不生成继续推进或 stale 建议；`archived` 默认不进入总览、指标和注意力队列，但可通过筛选查看。
- override 是 Dashboard 偏好，不写入 workspace，不参与 Spec、Acceptance 或 release 状态推导。
- 未配置 roots 时，只索引启动命令所在 workspace，并在 UI 显示配置提示。
- 不默认扫描 `/Users/<name>`、`~` 或整个磁盘。
- CLI override 只影响本次运行，不静默写配置。
- 非法端口、天数、刷新周期和数量限制回退到默认值并显示 warning。

### RAVO 配置契约

`config/ravo-config-contract.json` 是 SoloDesk 可编辑配置的唯一 allowlist。每个模块条目至少包含：

```text
moduleId
displayName
scope=user|workspace
target=user-ravo|review|workspace-ravo
fields[]
```

每个 field 至少包含：

```text
path
label
type=boolean|integer|string|enum|string-array|object-list|secret
default
required
min/max 或 options
secret
description
```

v0.5.0 必须覆盖：

- Core/Analysis/Workstream/Evidence/Acceptance/Knowledge/Dashboard 在 `~/.codex/skill-config/ravo.json` 中公开的参数。
- Review 在 `~/.codex/skill-config/ravo-review.json` 中公开的轮次、retry、timeout、stream、token、Provider 和 model 参数。
- 用户明确选择 workspace 后，该 workspace `knowledge/.ravo/config.json` 中允许覆盖的参数。
- 没有公开参数的模块在 UI 显示“无可配置项”，不制造空表单。

规则：

- target 到实际路径的映射写死在服务端；浏览器和配置契约不能提交任意文件路径。
- 读取时深合并 `default < user < workspace`，返回 `effectiveValue`、`source` 和 validation status。
- 保存时只修改契约声明字段，深合并保留文件中的未知字段，避免旧版/新版字段被 UI 擦除。
- 写前在同一文件系统创建临时文件，执行 `write + fsync + rename + read-back` 后完成单文件原子替换；保留 owner，包含 secret 的配置和备份使用 `0600`，备份目录使用 `0700`。跨文件操作不声称原子，使用 journal 显示阶段状态。
- 每次写入前备份原文件并 read-back 校验大小/哈希；备份失败时不写原文件。不存在原文件时记录 `created`，不伪造备份。
- secret 的 GET 响应只能返回 `configured=true|false`；PUT 只接受 `keep|replace|clear` 和 replace 时的新值。
- secret replace 只能位于同源 POST/PUT body 或脚本 stdin；禁止 query string、URL、CLI argv、环境变量和临时明文文件传递。
- UI 和 API 不返回旧 secret，不把新 secret 写入日志、artifact、错误或截图。
- 配置写入与升级共用单个本地锁；锁存在时另一个 mutation 返回 `409 operation_in_progress`。
- 如果运行环境存在 `RAVO_REVIEW_CONFIG` 等路径 override，SoloDesk 只显示 `runtimeOverride=present` warning，不读取或编辑 override 指向的任意路径；用户解除 override 后再管理 canonical config。

### RAVO Review Provider/Model 契约

必须把当前 `run-review.js` 内的 config normalization/validation 提取为共享入口，由 runner、SoloDesk、status、测试共同调用。

Provider 字段：

```text
id
label
enabled
apiBase
apiMode=responses|chat|fake
credentialStatus
timeoutMs
stream
models[]
```

Model 字段：

```text
id
enabled
```

规则：

- 支持多个 Provider，每个 Provider 支持多个 model。
- `provider.id` 在配置内唯一；同一 Provider 内 `model.id` 唯一，不同 Provider 可使用相同 model id。
- 运行、筛选、重试、失败原因和 artifact 统一使用 `providerId/modelId`。
- legacy flat config 继续读取，并在 SoloDesk 中显示“可迁移”；只有用户确认保存时才转换为 provider-array，迁移前保留备份。
- validator 返回脱敏的 provider/model counts、错误字段、normalized shape 和 redacted config fingerprint；不得返回 credential 或完整 apiBase query。
- `coverage` 是兼容字段，语义等于 `workflowCoverage`；不能再直接按 HTTP 返回或 `modelsCompleted` 推导。
- Review 前 UI 显示 Provider 数、model 数、round 数、requested/fallback pair 和预计最大请求次数 `plannedProviderModelPairs * rounds * maxAttempts`；用户确认后才发起。
- Provider 连通性测试只发送最小脱敏请求并记录 test result，不写成正式 Review evidence。

#### Review 数据边界决策

每次正式 Review 在外部调用前必须写入：

```text
dataBoundary.decision=safe_sanitized|sensitive_requires_consent|prohibited
dataBoundary.subjectHash
dataBoundary.redactionSummary[]
dataBoundary.authorizationSource=explicit_user_action|conversation_confirmation|policy_safe_sanitized|none
dataBoundary.externalCallAllowed
```

规则：

- Provider credential/configured 状态只表示具备调用能力，不作为内容外发授权。
- `safe_sanitized`：subject 只包含通用、必要且已脱敏的摘要。Codex 治理规则已触发 Review 时可以继续；SoloDesk 仍要求用户显式点击发起。
- `sensitive_requires_consent`：先尝试进一步摘要/脱敏；仍含项目私有事实、个人数据或其它受控内容时必须等待用户确认。
- `prohibited`：credentials、secret、API key、customer data、private personal data、canary 命中和明确禁止类别不得外发，即使 Provider 已配置。
- 用户拒绝或未提供必要授权时记录 `coverage=none`、原因和可恢复入口，并可执行不冒充外部 Review 的内联对抗检查。

#### Review 响应与 Attempt 契约

Review artifact 必须区分：

```text
reviewRunId
modelsRequested[]
modelsResponded[]
modelsUsable[]
modelsFailed[]
attempts[]
transportCoverage=none|partial|full
invocationCoverage=none|partial|full
workflowCoverage=none|partial|full
coverage=none|partial|full
parserStatus=not_run|pass|partial|error
```

`attempts[]` 每项至少包含：

```text
providerModelKey
round
attempt
attemptType=initial|transport_retry|semantic_retry|stream_fallback|model_fallback
reason
plannedDelayMs
actualDelayMs
timeoutMs
startedAt
endedAt
result=responded_unusable|usable|retrying|failed
```

规则：

- `modelsResponded` 只表示 Provider 返回了可解析响应；它不能提高 Review coverage。
- 只有非空最终正文存在、响应不是未处理的 `incomplete/truncation`、并通过 findings schema 校验时，pair 才进入 `modelsUsable`。
- 仅 reasoning、空 `output_text`、长度截断、schema 无效、finding 为空或 parser 无法建立 Ledger 的响应均为 semantic failure。
- timeout、connection、429、502、503、504 使用 transport retry；semantic failure 使用 semantic retry。两类重试共享 `maxAttempts`，不得产生调用预览之外的隐藏请求。
- model fallback 只能使用调用预览中明确列出的 fallback pair，并计入最大请求次数；未预览的模型不得自动调用。
- `plannedDelayMs` 必须真实等待；`actualDelayMs` 不得小于 `max(0, plannedDelayMs - 25)`，可以因调度变长，但不能被测试便利逻辑静默压缩。不满足时 retry evidence 标 invalid。
- 同一逻辑 Review 的初始、重试、fallback 和补偿运行使用同一个 `reviewRunId`；子 artifact 记录 `parentReviewRunId/compensationFor`，聚合 artifact 才能更新 manifest 的 current Review 指针。

#### Reviewer Findings 与 Issue Ledger

Reviewer 首选输出：

```text
summary
findings[]:
  title
  severity=critical|high|medium|low
  evidence
  mechanismRisk
  recommendation
```

规则：

- runner 必须使用结构化解析器校验字段，不得仅按包含“风险”“建议”等关键词的文本行配对。
- issue ledger 必须保留 finding 与 `providerId/modelId`、round、raw response ref 的稳定对应关系。
- `rawFindingCount`、`ledgerFindingCount`、去重数量和 parser 错误必须进入 artifact。
- schema 或 parser 首次失败时可在 attempt budget 内要求同一模型重发结构化最终答案；仍失败则保留 raw response，pair 不进入 `modelsUsable`。
- 不得用 `evidence may be incomplete`、`keep acceptance status tied to artifacts` 等通用占位文本冒充真实 reviewer finding。
- `workflowCoverage=full` 要求：全部策略要求的 provider/model pair 和 rounds 均 usable、无未处理截断、parserStatus=pass、Ledger 可由 raw findings 重建，并满足该对象的 required model count。
- 部分 pair usable、未满足 required model count、parser partial 或只有单模型探索证据时为 `workflowCoverage=partial`。
- 全部 pair unusable、无授权、无 Provider 或无请求时为 `workflowCoverage=none`，并保留具体原因。

#### Analysis Complete 与运行路径门禁

- requirement/solution artifact 标记 `complete` 时至少校验 goal、consumer、constraints、facts、options、assumptions、challenge、blindSpotFindings、validation、risks、nextActions 和 derivedConclusion。
- root-cause artifact 继续校验 symptom、proximateCause、alternativeHypotheses、mechanismRootCause、whyChain、boundary、smallestFix、verification 和 conclusion。
- 高影响 analysis/root-cause 还必须记录匹配对象的 `reviewEvidence`、review artifact/run id 或明确 external Review 阻塞；字段缺失时只能写 `draft`。
- artifact 写入器的 `--help`、`--version` 和参数错误路径不得创建 artifact 或更新 manifest。
- Prompt、hook、skill 和脚本不得硬编码 `.../plugins/cache/<plugin>/<version>/...`；运行入口从当前 Skill/plugin root、marketplace manifest 或稳定版本无关 shim 解析。
- 一键升级后的 fresh-session probe 必须实际调用这些入口，证明不存在旧缓存版本路径漂移。

### RAVO 更新程序

更新对象是 `ravo` marketplace 中的全部 required RAVO plugins，包括 `ravo-dashboard`；不是 Codex App/CLI。

检查流程：

1. 读取 `codex plugin marketplace list --json` 和 `codex plugin list --marketplace ravo --json`。
2. Git marketplace 只在用户点击检查更新后调用 `codex plugin marketplace upgrade ravo`；local marketplace 不执行 `git pull`。
3. 从 marketplace entry 和各 `.codex-plugin/plugin.json` 读取 source version，与 installed cache version 比较。
4. 输出 current、available、source type、required plugin set、drift 和 fresh-session requirement。

升级流程：

1. 获取 mutation lock，执行磁盘/权限/CLI/marketplace/config 可读性 preflight。
2. 记录升级前全部 required plugin 版本、enabled 状态和 source fingerprint。
3. 将 `ravo.json`、`ravo-review.json` 和已存在的 RAVO workspace config 复制到 `~/.codex/ravo/backups/<timestamp>/`；备份目录 `0700`、文件 `0600`。所有备份 read-back 的大小/哈希匹配后才能进入安装阶段。
4. 写入 upgrade journal，状态依次为 `planned|backed_up|installing|verifying|succeeded|partial|failed|recovered|indeterminate`；每个 migration 记录 id、from/to schema、状态和脱敏 input/output fingerprint。
5. 仅用 `execFile` 和固定 argv 调用 `codex plugin add <plugin>@ravo --json`；逐项记录结果。
6. 如目标版本要求 config migration，先生成 preview，再运行版本化 migration；幂等定义为对同一目标版本重复执行后配置语义不再变化，模板默认值不得覆盖已有用户值。
7. 重新读取插件列表、缓存版本、配置解析结果和配置完整性；任一 required plugin/version 不一致则不是成功。
8. 刷新 Runtime fingerprint，并提示创建 fresh Session；hook probe 未完成前状态最高为 `configured_unverified`。

恢复规则：

- 配置在任何阶段被非预期改变或 migration 失败时，从本次备份恢复配置并校验哈希/语义。
- 插件部分升级无法自动回退时保留 `partial` journal，列出已升级/未升级项和可恢复命令；不得声称成功。
- Codex CLI 无法安装旧版本时不承诺插件代码事务回滚；如果当前代码/配置兼容性无法证明，journal 使用 `indeterminate`，Runtime=degraded，并阻止 RAVO 完成/发版结论。
- 服务重启后能读取未完成 journal，并提供“继续验证/恢复配置”，不自动重复安装。
- UI 只展示备份目录、文件名、match/mismatch 和结果，不展示 secret、配置全文或 checksum 原值。

### Workspace Discovery

输入：

- 配置的 workspace roots。
- 本次 CLI `--workspace-root`。

行为：

- 只扫描 allowlist root 的直接子目录和 root 自身。
- 以存在 `.git`、`knowledge/.ravo/manifest.json` 或明确配置为 workspace 的目录作为候选。
- 使用 canonical path 去重，workspace id 使用 canonical path 的稳定 hash。
- symlink 解析后仍必须位于 allowlist 内。
- 不跟随会逃出 allowlist 的 symlink。

输出：

```text
workspaceId
name
canonicalPath
discoverySource
ravoPresent
priority
lifecycle
lastIndexedAt
dataStatus
```

### Artifact Index

主要来源：

- `knowledge/.ravo/manifest.json`
- manifest 引用的 latest artifact。
- `knowledge/.ravo/{analysis,workstream,quick-validation,acceptance,knowledge,review}/`

规则：

- manifest 优先。
- manifest 缺失时显示 `no_ravo_data`，不根据普通文档猜测治理状态。
- manifest 损坏时可对已知 artifact 目录执行有界降级扫描，并标 `dataStatus=partial`。
- 只索引 JSON/Markdown 元数据和引用，不执行 artifact 内任何代码。
- 单 workspace 默认最多读取最近 500 个 artifact 元数据，旧数据按需加载。
- 同一 artifact 按 id 和 canonical path 去重。

### Session Index

主要来源：

- `~/.codex/session_index.jsonl`
- `~/.codex/sessions/**/rollout-*.jsonl` 的 session metadata fallback。

规则：

- 只关联 `cwd` 位于 allowlist workspace 内的 Session。
- 默认只读取 session id、cwd、创建/更新时间、标题或已有摘要。
- `showPromptSnippets=false` 时不读取或展示完整用户 Prompt。
- 不索引工具输出、密钥、环境变量或完整响应正文。
- 索引格式不兼容时标 `sessionDataStatus=partial|error`，Dashboard 其它数据仍可用。

### R/A/V/O/Runtime 生命周期模型

每个 workspace 生成五个独立 lane，不生成综合健康分：

```text
Reason
Act
Verify
Organize
Runtime
```

每个 lane 输出：

```text
status=clear|attention|blocked|unknown|not_applicable
summary
items[]
sourceRefs[]
freshness
confidence
```

映射规则：

- Reason：decision-complete Spec、stale inputs、Analysis open questions、blind spots 和未决需求。
- Act：active workstream、milestone、Roadmap Audit、blocker、nextStep 和最近 Session 活动。
- Verify：quick evidence、Review coverage、Acceptance item、Codex 补证和 PM 验收。
- Organize：workspace knowledge、相关可复用经验、最近 decisions 和经验适用性。
- Runtime：marketplace、plugin enabled、版本、hook trust record、runtime probe、manifest 和配置。

lane `clear` 只表示当前可见事实没有未处理问题，不等于产品已完成或 release_ready。

### 跨 Workspace 注意力队列

Dashboard 根据各 lane 生成统一 attention item：

```text
id
workspaceId
lane
severity=critical|high|medium|low
title
reason
sourceRefs[]
sourceUpdatedAt
freshness
confidence
suggestedAction
expectedOutcome
blocking
```

排序规则：

1. `critical` 和 required blocker。
2. Runtime missing/degraded、stale Spec 或 stale Acceptance 等会使后续判断失真的问题。
3. `not_ready`、`not_met` 和 `pending_codex`。
4. `pending_pm`、Review gap 和 stale active workstream。
5. 同级时按 workspace priority、source freshness 和 workspace 名称稳定排序。

约束：

- 不生成不透明 attention score。
- paused workspace 默认只显示 critical/runtime/data integrity 问题，不显示继续推进建议。
- archived workspace 默认不生成 attention item。
- confidence=low 时 suggestedAction 必须先修复数据或 Runtime，不直接建议产品范围决策。

### Spec 与证据新鲜度

#### Spec Health

扩展 `ravo-goal-prompt` 支持 `--check-only`，只输出检查结果，不生成 Goal Prompt。

合法状态：

- `current`
- `missing`
- `draft`
- `stale`
- `error`

Dashboard 必须消费同一 stale-spec guard，显示 `specPath`、`staleInputs`、`checkedAt` 和错误原因。不得在 Dashboard 内重新实现一套文件名/mtime 判断。

#### Acceptance Freshness

- 最新 acceptance artifact 必须关联 Spec、workstream、release 或明确 source refs。
- 关联 Spec、workstream、Review issue、required evidence 或实现版本在 acceptance 后更新时，标 `stale`。
- 无法建立关联时标 `unknown`，不能只因为 acceptance 文件名最新就标 current。
- stale Acceptance 不能支持 `accepted`、`release_ready` 或“无需处理”的 Dashboard 结论。

#### 派生结论元数据

每个状态、指标和建议至少包含：

```text
derivedAt
sourceUpdatedAt
freshness=current|stale|unknown
confidence=high|medium|low
sourceRefs[]
```

- `high`：必需源完整、freshness=current，且 Runtime 有匹配当前版本的 fresh-session probe。
- `medium`：核心 artifact 当前，但 Runtime 只有配置/信任记录或可选源缺失。
- `low`：Runtime degraded/missing、Spec/Acceptance stale、数据 partial/error 或 source 关系无法确认。

### RAVO Runtime Health

`ravo-status` 必须扩展并作为 Dashboard 的唯一 Runtime 状态来源。

输入：

- `codex plugin marketplace list --json`
- `codex plugin list --marketplace ravo --json`
- RAVO source plugin manifests。
- installed cache manifests。
- 有 hooks 的插件 hook manifest。
- `~/.codex/config.toml` 中对应 hook trust record；只读取 RAVO key，不输出其它配置。
- workspace manifest/config。
- 最新 fresh-session runtime probe artifact。

实现约束：

- 使用 `execFile` 调用 `codex` JSON 命令，不拼接 shell 命令。
- marketplace/plugin 状态只使用 Codex JSON 输出；不解析其人类可读表格。
- 当前 Codex 没有 hook trust JSON API。v0.5.0 允许使用有界只读 scanner，仅识别 `[hooks.state."ravo-..."]` table header 和 `trusted_hash` 是否存在；不解析其它 TOML、不返回 hash 原值，遇到未知语法即标 `hookTrustEvidence=unknown`。
- `codex doctor --json` 当前可能长时间不返回，不作为 Dashboard 必需依赖。
- 不把 trust record 存在表达为“宿主一定已在当前 Session 加载 hook”。
- 不读取或输出无关 marketplace、plugin、MCP、环境变量或密钥配置。
- status 脚本只诊断，不修改配置或安装状态。

输出：

```text
marketplaceStatus=present|missing|error
pluginStatus=healthy|degraded|missing|error
versionStatus=aligned|drift|unknown
hookTrustEvidence=recorded|missing|not_applicable|unknown
runtimeProbeStatus=pass|stale|missing|fail|unknown
manifestStatus=healthy|missing|error
configStatus=healthy|missing|error
runtimeHealth=healthy|configured_unverified|degraded|missing|error
recoverySteps[]
```

状态规则：

- `healthy`：marketplace 和 required plugins present/enabled，版本一致，required hook trust records 存在，且有匹配当前 plugin/version fingerprint 的 fresh-session runtime probe pass。
- `configured_unverified`：配置与 trust records 看起来完整，但没有当前 fingerprint 的 fresh-session probe。
- `degraded`：部分插件 disabled、版本漂移、hook trust record 缺失、manifest/config 不完整或 runtime probe stale/fail。
- `missing`：RAVO marketplace 或 core plugin 不存在。
- `error`：无法执行 Codex JSON 命令或解析关键状态。

Runtime probe：

- 复用 `knowledge/.ravo/quick-validation/`，artifact type/kind 使用 `runtime_probe`，不新增 Runtime artifact 模块。
- plugin/version fingerprint 使用 SHA-256，输入为排序后的 RAVO marketplace source、required plugin id/enabled/version/source、installed cache version 和 hook manifest 文件 SHA-256；不包含绝对用户目录之外的秘密或 trust hash 原值。
- artifact 必须记录 `fingerprint`、`expectedHookEvents[]`、`observedEvidence[]`、`sessionIds[]`、`promptRefs[]`、`pass|fail|partial` 和 `createdAt`。
- 必须由真实新 Codex Session 使用自然语言 Prompt 触发，并记录 session id、plugin/version fingerprint、期望 hook advisory、真实响应摘要和 pass/fail。
- probe coverage 至少覆盖当前已安装 hook manifest 中的 `SessionStart`、`UserPromptSubmit` 和 `SubagentStart`；`Stop` 等非直接用户可见事件用真实 artifact/telemetry 证据验证。
- 只有 required hook events 全部有对应真实证据时 probe 才能记为 `pass`；部分覆盖只能记 `partial`，Runtime 最高为 `configured_unverified`。
- 脚本直接执行 hook 不能替代 fresh-session probe。
- 安装、升级、marketplace 配置变化或 hook manifest 变化后，旧 probe 自动 stale。
- Dashboard 只生成“运行验证 Prompt”和恢复步骤，不自动创建 Session 或修改宿主配置。

### 多维状态模型

#### 活跃度状态

- `active`：最近 `staleAfterDays` 内有 Session 或 RAVO artifact。
- `stale`：超过阈值无活动，且存在未结束 workstream、blocker 或 pending acceptance。
- `dormant`：超过阈值无活动，且没有可见未完成事项。
- `unknown`：缺少可靠时间信息。

#### 交付状态

- `no_data`
- `in_progress`
- `code_complete`
- `pending_acceptance`
- `blocked`
- `accepted`
- `not_ready`

交付状态来自最新有效 workstream 和 acceptance artifact，不能仅由 Session 文本推断。

#### Review 状态

- `current`：高影响对象存在与之匹配、未过期且 `workflowCoverage=full` 的 usable review evidence。
- `needed`：高影响 analysis/spec/workstream 缺 Review。
- `partial`：Review coverage 不完整、只有部分 usable 模型、parser partial、超时、截断或 semantic failure 未补齐。
- `unavailable`：明确需要 Review，但 provider 不可用、外部条件阻塞或必要授权未获得。
- `not_applicable`：没有高影响对象或已明确不适用。

Review 匹配与过期规则：

- 优先使用 review artifact 的 `inputHash`、`relatedArtifact` 或等价 source ref 匹配被评审对象。
- `workflowCoverage=full`、`parserStatus=pass`、required model count 满足且 input hash 与当前对象一致时可判定 `current`。
- 没有 input hash 时，只有 review 明确引用该对象、review 时间不早于对象当前版本、且对象之后没有更新，才可判定 `current`。
- 被评审对象在 review 后发生内容或 mtime 更新时，该 review 自动降级为 `needed`；不能只按固定天数判断过期。
- `partial_external_review`、timeout、truncation、semantic failure、parser partial/error、少于要求 usable 模型数或只有 responded 没有 usable 时只能判定 `partial|unavailable`。

#### 数据状态

- `complete`
- `partial`
- `no_ravo_data`
- `error`

### 主要关注原因

每个 workspace 最多显示一个主要关注原因，用于默认排序，但保留全部状态标签。

优先级：

1. Runtime missing/degraded、数据 error 或 stale Spec/Acceptance 等会使后续结论失真的问题。
2. required blocker。
3. `not_ready` 或 `not_met`。
4. `pending_codex` 验证任务。
5. `pending_pm` 验收。
6. Review needed/partial/unavailable。
7. stale 且存在未结束工作。
8. code_complete 尚未形成验收包。
9. 可执行下一步建议。
10. 无 RAVO 数据或数据不完整。

主要关注原因必须包含：

- 简短结论。
- 触发规则。
- source refs。
- 建议动作。
- 数据完整性提示。
- lifecycle lane、freshness 和 confidence。

### 指标与成本/效率信号

允许展示：

- 活跃 workspace 数。
- 最近 7 天 Session 数。
- 最近 7 天 artifact 数。
- pending Codex verification 数。
- pending PM acceptance 数。
- blocker 数。
- stale workspace 数。
- Runtime degraded/missing workspace 数。
- stale Spec 和 stale Acceptance 数。
- Reason / Act / Verify / Organize 各 lane attention 数。
- repeated analysis 信号。
- acceptance 重复失败/缺证信号。
- 从最后活动到当前的天数。

信号计算规则：

- 只有两个及以上 analysis artifact 引用同一个 `relatedArtifact`、`subjectRef` 或等价稳定对象 id 时，才显示 repeated analysis；没有稳定引用时只显示 analysis 总数。
- acceptance 重复失败/缺证只在同一 workstream、Spec 或 release ref 上连续出现两个及以上 `not_ready|pending_acceptance` artifact 时显示。
- 所有信号必须显示统计窗口、计数和 source refs；默认窗口为最近 30 天。
- 数据无法建立同一对象关联时不生成“反复”结论。
- paused/archived workspace 不进入 active、stale、Session 产出和推进效率统计；可单独筛选查看。

禁止：

- 没有真实 token 字段时估算 token。
- 没有账单来源时估算货币成本。
- 把 Session 数量直接解释为产出效率。
- 生成无可解释规则的综合“效率分”。

UI 必须把这组数据标为“工作量/成本信号”或等价自然语言，而不是精确成本。

### 下一步建议

第一版使用确定性规则，不调用外部 LLM。

建议至少包含：

```text
action
reason
sourceRefs[]
expectedOutcome
blocking
```

规则示例：

- 有 `pending_codex`：建议先补对应真实 E2E 或证据。
- 只有 `pending_pm`：建议打开 PM 验收清单。
- 有 blocker：建议处理恢复入口，而不是继续开发。
- Runtime missing/degraded：建议先恢复 marketplace/plugin/hook trust record 或运行 fresh-session probe。
- Spec stale/missing：建议先维护 Spec，不生成实现型继续 Prompt。
- Acceptance stale：建议重新生成或补验，不显示“等待 PM 即可”。
- stale 且有未结束 workstream：建议生成“继续这个 workspace”Prompt。
- 高影响 analysis 缺 Review：建议发起 RAVO Review。
- 无 decision-complete Spec：Goal Prompt 快捷指令必须提示先生成/更新 Spec。
- lifecycle=paused：不建议继续推进，只显示 critical/runtime/data integrity 问题。
- lifecycle=archived：默认不生成建议。

### 快捷指令

每个 Prompt 必须包含：

```text
workspace 路径
目标
当前状态
主要关注原因
相关 source refs
约束
期望输出
验收边界
Runtime 健康
freshness/confidence
数据缺口
相关 knowledge refs
```

v0.5.0 必须提供：

1. `继续这个 workspace`
2. `分析新需求`
3. `分析问题根因`
4. `找堵点`
5. `检查验收缺口`
6. `发起 RAVO Review`
7. `总结最近进展`
8. `提取经验`
9. `生成 Goal Prompt`
10. `检查 RAVO 状态`
11. `初始化 RAVO`，仅在 no_ravo_data 时出现

UI 不同时展示全部指令。根据 attention lane 和 workspace 状态展示最多 4 个主要动作，其余进入菜单。

快捷指令目录必须用用户真实 Session 意图样本校准，至少证明 Reason、Act、Verify、Organize、Runtime 各有真实使用场景；不能只由开发者主观列按钮。

#### Continuation Brief

`继续这个 workspace` 必须生成结构化 Continuation Brief：

```text
workspace
currentGoal
decisionCompleteSpec
specHealth
activeMilestone
roadmapAudit
openDecisions[]
blockers[]
pendingCodexVerification[]
pendingPmVerification[]
recentActivity[]
relevantKnowledge[]
runtimeHealth
sourceRefs[]
dataGaps[]
requestedAction
evidenceBoundary
```

规则：

- currentGoal 和 milestone 必须来自 Spec/workstream，不从 Session 摘要猜测。
- Spec missing/stale 时，Brief 的 requestedAction 必须先维护 Spec，不得直接继续实现。
- Runtime degraded/missing 时，Brief 必须先恢复或验证 RAVO 运行状态。
- paused/archived workspace 默认不能生成继续实现 Brief；用户显式要求时只生成恢复评估 Prompt。
- technicalDetailLevel 控制表达密度；level 1 仍保留 blocker、pending verification、source refs 和证据边界。
- Prompt 应保持可读和有界；默认正文不超过 1200 中文字，超出内容以 source refs 代替。

#### Knowledge 复用

- `继续 workspace`、`分析新需求`、`分析问题根因`、`找堵点`、`检查验收缺口`、`发起 Review` 和 `生成 Goal Prompt` 生成前检索 workspace knowledge。
- 扩展现有 retrieval 支持 `--record-use false` 或等价显式参数；Dashboard 必须使用无写入模式。
- 无写入模式不得修改 knowledge JSON、Markdown、index、`lastUsedAt` 或 user-scope 文件。
- 用户级 globalKnowledge 已启用且当前数据边界允许时，再检索 user scope。
- 只把与当前 action 有明确 applicability 的结果加入 Prompt，最多 3 条；其余只显示检索数量。
- Prompt 必须区分已应用、可能过期和不适用知识。
- 无高价值匹配时不提示“没有知识”，也不写 knowledge artifact。
- Knowledge 不能提高 fulfillment、verification、Review coverage 或 release readiness 状态。

行为：

- UI 提供预览和复制。
- 不自动运行 Prompt。
- `生成 Goal Prompt` 必须复用现有 missing/stale Spec guard。
- `提取经验` 只生成 capture 草稿，不自动写用户级知识。
- `检查 RAVO 状态` 复用扩展后的 `ravo-status`，只生成诊断与恢复建议。
- `初始化 RAVO` 只生成可审阅命令/Prompt，不自动执行 `ravo-init` 或安装插件。
- source refs 缺失时明确提示上下文不完整。
- technicalDetailLevel 影响 Prompt 的技术细节密度，但不改变证据要求。

### 本地 API

必须提供：

- `GET /api/health`
- `GET /api/runtime`
- `GET /api/attention`
- `GET /api/workspaces`
- `GET /api/workspaces/:id`
- `GET /api/workspaces/:id/timeline`
- `GET /api/workspaces/:id/continuation`
- `GET /api/workspaces/:id/shortcuts/:kind`
- `GET /api/config`
- `GET /api/config/:module`
- `POST /api/config/:module/validate`
- `PUT /api/config/:module`
- `GET /api/updates`
- `POST /api/updates/check`
- `POST /api/updates/apply`
- `POST /api/updates/recover-config`
- `POST /api/refresh`

限制：

- 只接受本机请求。
- 只接受 loopback Host；非 `127.0.0.1`、`localhost` 或实际监听 loopback 地址的 Host 请求必须拒绝。
- 不启用 CORS；带外部 Origin 的请求必须拒绝，UI 同源请求除外。
- 所有 mutation endpoint 必须校验启动时生成的同源 CSRF token；upgrade apply 还必须校验与当前 upgrade plan 绑定的单次 confirmation token。
- 所有 workspace id 必须解析到 allowlist canonical path。
- 不接受任意文件路径查询。
- `POST /api/refresh` 只刷新内存索引；只有 allowlist 配置 PUT、update apply 和 recover-config 可以产生本 Spec 定义的受控写入。
- 错误返回结构化 code/message，不返回 stack、密钥或完整文件内容。
- Runtime API 只返回 RAVO 相关 marketplace/plugin/hook trust evidence，不暴露其它 Codex 配置。
- 配置 API 不接受 path 参数或未知 module/field；secret GET 永远不返回原值。
- update API 不接受 marketplace、plugin、URL、命令或 executable 参数；目标固定为 RAVO required plugin set。

### 刷新与缓存

- 启动时构建索引。
- UI 可手动刷新。
- 服务运行时按 `refreshSeconds` 定时刷新。
- 不使用跨目录文件 watcher。
- 缓存只在内存中，服务重启后重建。
- 刷新中继续提供上一版成功索引，并显示刷新状态。
- Codex marketplace/plugin JSON 和 Runtime fingerprint 按刷新周期缓存，不在每个 workspace 请求中重复执行。

### UI 信息架构

#### 首屏：Workspace 总览

首屏直接展示可用 Dashboard，不做营销 landing page。

包含：

- 顶部紧凑工具栏：SoloDesk/RAVO 标识、搜索、状态筛选、刷新、设置说明入口。
- 全局 Runtime 健康提示：healthy/configured_unverified/degraded/missing/error；非 healthy 时始终可见。
- 跨 workspace 注意力队列：默认展示最高优先级 10 项，可进入完整列表。
- 总览指标：活跃 workspace、待 Codex 补证、待 PM 验收、blocker、stale、stale Spec/Acceptance、Runtime degraded。
- R/A/V/O/Runtime lane 筛选。
- workspace 密集列表或表格：名称、priority、lifecycle、最近活动、交付状态、Spec/Runtime 健康、主要关注原因、confidence、下一步动作。
- 默认按主要关注原因优先级排序。

设置入口进入配置与升级视图，包含：模块配置、Review Providers、RAVO 更新。所有保存/升级操作显示目标范围、校验结果和备份状态。

#### 设置：模块配置

- 左侧按 RAVO 模块分组，右侧使用对应类型控件编辑已声明字段。
- 显示 effective value、source、default、作用域、目标文件和 validation status。
- secret 使用 masked/configured 状态和替换/清除动作，不提供 reveal。
- workspace 配置必须先选择具体 allowlist workspace；不得默认批量修改全部 workspace。
- 保存前显示字段级 diff，不显示 secret 原值；成功后显示备份路径和重新加载结果。

#### 设置：Review Providers

- Provider 使用可排序列表；每项显示 label、enabled、api mode、credential status、model 数和最近测试/Review 状态。
- Provider 详情支持编辑固定字段和 model enabled 列表；model 用稳定行/表格，不做嵌套卡片。
- 同名 model 必须同时显示 Provider，所有运行选择使用 `providerId/modelId`。
- 发起连通性测试或 Review 是独立命令，不能由“保存配置”隐式触发。
- Review 预览显示数据边界决策、脱敏摘要、requested/fallback pairs、round、attempt budget 和最大请求次数。
- 运行状态分别显示 responded、usable、failed、retrying 和 parser 状态；不得把 Provider HTTP success 直接显示为 Review 成功。
- Review 详情允许跳转聚合 artifact、raw response 和 issue ledger，并说明 `coverage` 的 workflow 语义。

#### 设置：RAVO 更新

- 显示 marketplace source type、当前/可用版本、required plugin set、版本漂移和上次 upgrade journal。
- “检查更新”只检查；“升级”在展示计划、配置备份范围和 fresh-session 影响后由用户确认一次执行。
- 升级过程显示 planned/backed_up/installing/verifying/result，不把进度动画当成功证据。
- partial/failed 显示逐插件结果、配置是否已恢复和下一步；succeeded 显示 fresh Session/re-trust 提示。

#### Workspace 详情

包含：

- 状态摘要和数据完整性。
- R/A/V/O/Runtime 生命周期摘要。
- Spec、Review、Acceptance freshness 和 confidence。
- 主要关注原因和下一步。
- RAVO artifact / Session 时间线。
- blocker、待验证项、最近决策、Review 和 Acceptance 摘要。
- 工作量/成本信号。
- 相关可复用 knowledge；无匹配时不显示空模块。
- Continuation Brief 预览。
- 快捷指令区。
- 来源查看和路径复制。

#### 来源查看

- Artifact 可在 Dashboard 内以只读方式查看摘要和路径。
- Session 显示 id、时间、cwd、标题/摘要和路径，不默认显示完整对话。
- Workspace 显示 canonical path 并支持复制。
- 浏览器无法直接打开本地文件时，复制路径仍是 required fallback。

### UI 设计约束

- 面向频繁巡视的产品经理，采用安静、紧凑、可扫描的工作台布局。
- 不使用大型 Hero、装饰性渐变、光球或卡片套卡片。
- 重复 workspace 使用表格/列表，详情区域使用无框分区。
- 卡片圆角不超过 8px。
- 工具按钮使用本地 Lucide 图标，并提供 tooltip。
- 状态不能只靠颜色表达，必须有文字或图标。
- 桌面和移动视口均不得出现文本溢出、控件重叠或横向不可达操作。
- 移动端把表格转换为稳定的摘要行/分区，不通过缩小字体硬塞。
- 所有动态区域有稳定尺寸或占位，刷新不引发布局跳动。
- 字距为 0，不按 viewport width 缩放字体。
- 色彩使用中性底色加有限状态色，避免单一蓝紫、深蓝或棕橙主题。

### 空状态与错误状态

必须覆盖：

- 未配置 workspace roots。
- 配置 root 不存在或无权限。
- 没有发现 workspace。
- workspace 没有 RAVO 数据。
- RAVO marketplace 缺失。
- required plugin disabled/missing 或版本漂移。
- hook trust record 缺失或无法判断。
- runtime probe missing/stale/fail。
- Spec missing/draft/stale。
- Acceptance stale/unknown。
- workspace paused 或 archived。
- manifest 损坏。
- 单个 artifact 损坏。
- Session 索引不存在或格式变化。
- 刷新失败。
- 端口占用。
- source ref 已不存在。
- 配置文件不存在、损坏、字段非法或权限不足。
- secret 未配置或需要替换，但不泄露原值。
- Review Provider/model id 重复、Provider 无 enabled model 或 legacy config 待迁移。
- marketplace 为 local source、无更新、检查失败、升级 preflight 失败、升级 partial、配置恢复失败或 fresh Session 待验证。

每个状态都必须说明当前影响和下一步，不显示无意义的通用错误。

### 性能边界

- 使用 manifest 和 latest artifact 优先完成首屏索引。
- Runtime JSON 命令只在启动/刷新周期执行一次并缓存，失败时保留上一版成功结果并标 freshness=stale。
- 详细 artifact 和时间线按 workspace 懒加载。
- 验收数据集：至少 50 个 workspace 候选、每个 workspace 最多 500 个 artifact 元数据。
- 在目标开发机上，50 个 workspace 的首屏 API 应在 3 秒内返回；详细时间线单次请求应在 1 秒内返回，超限时必须显示性能证据和优化计划。
- 不因一个大 workspace 阻塞其它 workspace 的首屏结果。

## 数据边界与安全基线

### 数据与隐私

- Dashboard 默认完全本地运行；只有用户显式发起 Review/Provider test 或 Git marketplace 更新检查时才允许对应外部调用。用户点击只授权本次已预览的目标和调用规模，不构成其它内容的永久授权。
- Session 默认只读取元数据，不读取完整 Prompt、响应和工具输出。
- 不把项目路径、artifact 或 Session 数据写入用户级全局知识。
- 不把任何 Dashboard 数据发送给 Review provider，除非用户另行发起 RAVO Review/Provider test 并通过三态数据边界检查。
- Codex 治理流程自动触发 Review 时，只有 `safe_sanitized` 可直接调用；`sensitive_requires_consent` 必须确认，`prohibited` 不得调用。
- user-scope knowledge 只在 `globalKnowledge.enabled=true` 且当前 action 允许时读取；Dashboard 不改变 opt-in 状态。

### Credentials

- 配置服务端可以为保留/替换 Review credential 读取 allowlist 配置文件，但 API/UI 只能返回 configured 状态；不得读取无关环境变量、`.env`、Git credentials 或其它 provider secrets。
- 读取 `~/.codex/config.toml` 时只提取 RAVO marketplace/plugin/hook state；API 和日志只输出状态，不输出 `trusted_hash` 原值或其它配置段。
- 日志不得包含 artifact 正文、完整 Prompt、密钥或用户级配置全文。

### Permissions

- 服务只读取 allowlist 内 workspace、所需 Codex Session 元数据和 allowlist RAVO 配置；只写本 Spec 定义的 RAVO 配置/备份/journal。
- Runtime 诊断可以只读调用 `codex plugin marketplace list --json` 和 `codex plugin list --marketplace ravo --json`。
- 用户显式检查/升级时可以固定 argv 调用 `codex plugin marketplace upgrade ravo` 和 `codex plugin add <required-plugin>@ravo --json`。
- canonical path 和 symlink 检查必须防止目录逃逸。
- API 不接受任意绝对路径。

### Destructive Actions

- v0.5.0 Dashboard 不提供项目文件删除/修改、提交、发布、任意 shell 或自动创建 Task 的能力。
- 允许受控修改 RAVO 配置、备份/journal，并通过固定 argv 的 `execFile` 调用本 Spec 列出的 Codex plugin 命令；不接受用户传入命令、URL、路径、参数或可执行文件。
- `POST /api/refresh` 只更新内存状态。

### External Calls

- 前端不加载 CDN、远程字体、远程图片或遥测脚本。
- 服务默认不联网；显式 Review/Provider test/marketplace update 操作是有界例外，必须显示目标、数据边界决策、调用规模和结果。

### Dependencies

- 优先 Node.js 标准库。
- 本地打包的第三方静态资源必须记录来源、版本和许可证。

### Logs 与 Artifacts

- 错误日志只记录 workspace id、错误 code 和必要路径摘要。
- 配置和升级日志只记录 module/plugin id、阶段、结果和脱敏路径；不得记录配置正文、secret、Authorization header、完整 apiBase 或 checksum 原值。
- 测试截图和验收 artifact 不得包含密钥或不必要的完整 Session 内容。
- UI E2E 优先选择无敏感内容的 workspace；必须使用真实敏感 workspace 时，截图前应隐藏 Prompt 摘要和私有路径，或对证据做可验证脱敏。

### 前端安全

- 所有路径、标题和 artifact 文本必须按纯文本转义。
- 配置本地 CSP，禁止远程脚本和任意内联执行。
- API 响应使用正确 content type 和 `nosniff`。
- 不根据 artifact 内容动态执行 HTML、Markdown 脚本或命令。

## 配置优先级

Dashboard 配置优先级：

```text
单次 CLI override
> 用户级 ~/.codex/skill-config/ravo.json
> 内置默认值
```

说明：Dashboard 跨多个 workspace，不使用某个 workspace 的 `knowledge/.ravo/config.json` 覆盖 workspace roots。单个 workspace 的 RAVO 配置只影响该 workspace 的派生显示，例如 `technicalDetailLevel`。

配置中心必须按字段所属配置链展示来源，不能假设所有模块共用一条优先级：

- 通用 RAVO 字段：`workspace knowledge/.ravo/config.json > user ravo.json > built-in default`。
- Dashboard 字段：`single-run CLI override > user ravo.json.dashboard > built-in default`。
- Review Provider/runner 字段：`single-run CLI override > ravo-review.json > built-in default`；不被 workspace config 覆盖。
- 编辑 workspace config 时只修改选定 workspace；编辑 user/module config 时显示影响范围。
- 未知字段原样保留，但不在 UI 中变成可编辑项。

## 验证矩阵

| 领域 | 场景 | 期望 |
|---|---|---|
| Acceptance | item 全字段 | writer 生成满足程度、验证状态和任务 |
| Acceptance | `pending_codex` | 出现在 Codex 补证区，不进入 PM 验收区 |
| Acceptance | `pending_pm` | 输出 PM 可执行步骤、预期结果和证据 |
| Acceptance | `blocked` | 输出原因、影响、降级、恢复入口和补验步骤 |
| Acceptance | `partial` | 明确实现缺口，不伪装成只缺验证 |
| Acceptance | `not_applicable` | 必须有理由和替代证据 |
| Acceptance | 非 verified 无任务 | checker 失败并指出 item id |
| Acceptance | legacy “基本满足” | 降级为 pending_classification，不自动通过 |
| Acceptance | accepted fallback | 不再生成“基本满足” |
| Acceptance | overall status | 不超过 item 证据允许上限 |
| Acceptance | v0.4 包重生成 | 每个原“基本满足”项都有新分类和验证任务 |
| Dashboard | 无 roots 配置 | 只显示当前 workspace 和配置提示，不扫描 home |
| Dashboard | 多 roots | 只索引 allowlist 内目录，canonical path 去重 |
| Dashboard | symlink 逃逸 | 拒绝并记录安全 warning |
| Dashboard | 有 RAVO workspace | 读取 manifest、latest artifact 和状态 |
| Dashboard | 无 RAVO workspace | 显示 no_ravo_data，不编造状态 |
| Dashboard | manifest 损坏 | 有界降级扫描并标 partial，或标 error |
| Dashboard | 单 artifact 损坏 | 其它 workspace 和 artifact 仍可展示 |
| Dashboard | Session index 存在 | 正确关联 cwd、session id 和时间 |
| Dashboard | Session 格式变化 | 降级为 partial/error，不崩溃 |
| Config | module list | 覆盖全部 RAVO 公开配置；无参数模块显示无可配置项 |
| Config | effective value | 正确显示 default/user/workspace/module source，不混淆作用域 |
| Config | 合法 user 配置 | 校验通过、写前备份、原子落盘、重读后生效 |
| Config | 合法 workspace 配置 | 只修改选定 allowlist workspace，不影响其它 workspace |
| Config | 非法字段/类型/范围 | 返回字段级错误，原文件字节和 mtime 不变 |
| Config | 未知现有字段 | 保存已知字段后未知字段仍保留 |
| Config | runtime path override | 显示 warning，不读取/编辑 override path，不谎称 canonical config 已生效 |
| Config | 并发保存/升级 | 单锁串行；后到请求返回 409，不产生交错文件 |
| Config | secret GET | 只返回 configured 状态，不返回原值或可逆派生值 |
| Config | secret keep/replace/clear | 三种动作语义正确，日志/API/artifact/截图无 secret |
| Config | 文件权限 | secret config/backup 为 0600，backup dir 为 0700；权限不足时拒绝写入 |
| Review config | legacy flat | runner/status/SoloDesk 得到一致 provider/model count，并可预览迁移 |
| Review config | provider array | 多 Provider/多 model 正确归一化为 providerId/modelId |
| Review config | 重复 provider/model id | 同 Provider 内拒绝重复；跨 Provider 同名 model 可用且不混淆 |
| Review config | invalid Provider | 缺 id/apiMode/enabled model 等返回字段级错误，不写文件 |
| Review | 两 Provider 各一 model | 两个 pair 均执行并分别记录 requested/responded/usable/failed |
| Review | 一个 Provider 失败 | 其它 Provider 成功保留，整体 coverage=partial |
| Review | 全部 pair usable | workflowCoverage/coverage=full，artifact 带 redacted config fingerprint/source |
| Review | 调用预览 | Provider/model/round/max attempts 和最大请求次数与实际计划一致 |
| Review | config status | 只使用共享 normalizer/validator；禁止 ad hoc providers-only 判断 |
| Review boundary | `safe_sanitized` + Codex 治理触发 | 记录 policy_safe_sanitized 后执行，不重复询问，不发送未脱敏上下文 |
| Review boundary | `sensitive_requires_consent` | 停在确认门；未确认不产生网络请求，artifact 记录原因和恢复入口 |
| Review boundary | `prohibited` | 始终不发起网络请求，不因 Provider configured 或用户笼统同意而绕过 |
| Review response | HTTP 成功 + 最终正文可用 | 进入 responded 和 usable，结构化 findings 校验通过 |
| Review response | HTTP 成功 + 空正文/仅 reasoning | 只进入 responded，触发 semantic retry，不进入 usable |
| Review response | `incomplete`/length/truncation | 触发 semantic retry；耗尽后 pair failed/unusable，coverage 不为 full |
| Review response | schema 无效或 findings 为空 | 保留 raw，重试结构化输出；耗尽后 parserStatus=error/partial |
| Review retry | timeout/429/5xx | 在统一 attempt budget 内 transport retry，attemptType/reason 正确 |
| Review retry | semantic failure | 在统一 attempt budget 内 semantic retry，不产生隐藏请求 |
| Review retry | backoff | `actualDelayMs` 与 `plannedDelayMs` 在容差内，真实经过时间可验证 |
| Review fallback | 预览内 fallback pair | 允许切换并计入最大请求数；未预览 pair 不调用 |
| Review ledger | 双模型结构化 findings | rawFindingCount、ledgerFindingCount、severity/evidence/recommendation 一致 |
| Review ledger | parser 漏项/错配 | parserStatus=partial/error，workflowCoverage 最高 partial，不写通用占位 finding |
| Review aggregate | 初始 + retry + fallback/补偿 | 共用 reviewRunId，manifest 指向聚合 artifact，不只指向最后子运行 |
| Analysis artifact | requirement complete 缺核心字段 | writer 拒绝并保持 draft，不更新 latestCompleteArtifact |
| Analysis artifact | high-impact 无 Review evidence | writer 拒绝 complete，除非记录明确 external blocker |
| Analysis CLI | `--help`/参数错误 | 不创建 artifact，不更新 manifest |
| Runtime path | 插件升级后 fresh Session | 所有 RAVO 入口从当前版本解析，无旧缓存版本 `MODULE_NOT_FOUND` |
| Upgrade | check local marketplace | 不执行 git pull，比较 source manifest 与 installed cache |
| Upgrade | check Git marketplace | 仅显式操作调用 marketplace upgrade，并返回 current/available |
| Upgrade | preflight/backup 失败 | 不安装任何插件，状态 failed，原配置不变 |
| Upgrade | 备份 read-back/hash 不匹配 | 阻断安装并保留原配置/失败证据 |
| Upgrade | happy path | required plugin set 全部目标版本，配置语义/权限完整，journal=succeeded |
| Upgrade | template 新增默认字段 | 不覆盖已有用户值；缺失字段按默认或 migration 规则处理 |
| Upgrade | migration 失败 | 恢复配置，journal=recovered|failed，提供恢复证据 |
| Upgrade | 中途插件失败 | journal=partial，列出逐插件结果，不显示升级成功 |
| Upgrade | 服务重启遇到未完成 journal | 可继续验证或恢复配置，不自动重复安装 |
| Upgrade | 完成后 hooks | Runtime 最高 configured_unverified，fresh-session probe 后才可 healthy |
| Portfolio | 默认 workspace | priority=normal、lifecycle=active |
| Portfolio | paused workspace | 不标 stale，不生成继续推进建议 |
| Portfolio | archived workspace | 默认不进入总览、指标和注意力队列，可筛选查看 |
| Portfolio | high/normal/low | 仅作为筛选和同级排序依据，不生成综合分 |
| Lifecycle | Reason | 展示 Spec、analysis、open question 和 blind spot 状态 |
| Lifecycle | Act | 展示 workstream、milestone、Roadmap Audit、blocker 和 nextStep |
| Lifecycle | Verify | 展示 evidence、Review、Acceptance、Codex/PM verification |
| Lifecycle | Organize | 只在有相关知识/决策时展示，不提示空知识 |
| Lifecycle | Runtime | 展示 marketplace/plugin/version/hook trust record/probe/manifest/config |
| Attention | Runtime degraded + blocker | Runtime/data integrity 先于业务推进建议 |
| Attention | 同 severity | 按 priority、source freshness、workspace 名稳定排序 |
| Runtime | marketplace missing | runtimeHealth=missing，不因 cache 存在误报 healthy |
| Runtime | plugin disabled/missing | runtimeHealth=degraded|missing，并列出具体 plugin |
| Runtime | source/cache/runtime version drift | versionStatus=drift，runtimeHealth=degraded |
| Runtime | hook trust record missing | hookTrustEvidence=missing，不声称 hooks 可用 |
| Runtime | trust record present, no probe | runtimeHealth=configured_unverified |
| Runtime | matching fresh-session probe pass | runtimeHealth 可为 healthy |
| Runtime | probe 只覆盖部分 required hook events | probe=partial，runtimeHealth 最高 configured_unverified |
| Runtime | plugin/config fingerprint changed | 旧 probe 标 stale |
| Runtime | Codex JSON 命令失败 | runtimeHealth=error，保留上次结果并标 stale |
| Spec health | current spec | `--check-only` 返回 current，不生成 Goal Prompt |
| Spec health | missing/draft spec | 返回对应状态，不生成实现型 Continuation Brief |
| Spec health | newer alignment/spec delta | specHealth=stale，列出 staleInputs |
| Freshness | newer workstream/evidence | 旧 Acceptance 标 stale，不支持 accepted |
| Freshness | source relation unavailable | freshness=unknown，不推断 current |
| Confidence | runtime probe + current sources | 可判 high |
| Confidence | configured but unverified runtime | 最高 medium |
| Confidence | stale/error/partial source | low，建议先恢复事实链路 |
| State | active + blocked | 同时显示多维状态，主要关注原因为 blocker |
| State | stale + pending PM | 同时显示，主要关注原因为 pending acceptance |
| State | no reliable time | 活跃度 unknown，不猜测 stale |
| Metrics | token/cost 缺失 | 显示无可用数据，不估算金额 |
| Recommendation | pending Codex | 建议补证并引用对应 acceptance task |
| Recommendation | stale workstream | 生成继续 workspace 建议和来源 |
| Recommendation | paused/archived | 不生成继续推进建议 |
| Shortcut | 继续 workspace | Continuation Brief 包含 Spec、milestone、blocker、verification、Runtime、knowledge 和数据缺口 |
| Shortcut | stale/missing spec | requestedAction 先维护 Spec，不继续实现 |
| Shortcut | runtime degraded | requestedAction 先检查/恢复 RAVO Runtime |
| Shortcut | 检查验收缺口 | Prompt 引用最新 acceptance/workstream |
| Shortcut | Goal Prompt + missing spec | 触发 auto_spec/阻断逻辑，不绕过 guard |
| Shortcut | Goal Prompt + stale spec | 阻断可执行 Prompt并指向更新 Spec |
| Shortcut | 提取经验 | 只生成草稿，不自动写用户级知识 |
| Shortcut | 检查 RAVO 状态 | 复用 ravo-status，只输出诊断和恢复入口 |
| Shortcut | 初始化 RAVO | no_ravo_data 时生成可审阅 Prompt/命令，不自动执行 |
| Shortcut | 上下文动作 | 首屏最多展示 4 个最相关动作，其余进入菜单 |
| Knowledge | workspace match | Prompt 最多引用 3 条有 applicability 的知识 |
| Knowledge | Dashboard retrieval | 使用无写入模式，knowledge 文件和 mtime 均不变化 |
| Knowledge | user scope disabled | 不读取 user scope |
| Knowledge | user scope enabled | 经数据边界检查后读取并标 scope/source/staleness |
| Knowledge | 无高价值匹配 | 不显示空提示，不写 artifact |
| API | 任意 path 参数 | 无法读取 allowlist 外文件 |
| API | refresh | 只更新内存索引，不修改文件 |
| API | mutation 无 CSRF | 403，不产生文件或插件变化 |
| API | upgrade plan token 失效 | 409/403，必须重新检查并确认 |
| API | 未知 module/plugin/field | 拒绝，不映射为路径或命令 |
| Security | XSS artifact | UI 以纯文本显示，不执行脚本 |
| Security | logs | 不出现密钥、完整 Prompt 或 artifact 正文 |
| UI | 1440x900 | 首屏可扫描、无重叠、主要关注项可见 |
| UI | 390x844 | 文字和控件不溢出，关键动作可达 |
| UI | loading/refresh | 有稳定占位，不发生明显布局跳动 |
| Performance | 50 workspace | 首屏 API 目标 3 秒内返回 |
| Real E2E | 5+真实 workspace | active、pending/blocker、no_ravo_data、paused、archived 与真实文件/配置一致 |
| Real E2E | fresh-session runtime probe | 记录 fingerprint、session id、真实 advisory/响应和 pass/fail |
| Real E2E | 5 类快捷指令 | 覆盖 R/A/V/O/Runtime，真实创建 Codex Session并记录 id 和响应 |
| Real E2E | 配置保存与重启 | 隔离 HOME/workspace 中合法值持久生效，非法值不落盘，secret 无泄漏 |
| Real E2E | 多 Provider Review | fake 两 Provider 全矩阵通过；真实至少两个 provider/model pair 有 usable 响应，raw/ledger 一致，或逐项阻塞 |
| Real E2E | 旧版到新版升级 | 真实旧版安装、真实配置、备份、升级、版本/配置校验和 fresh-session probe |
| Regression | v0.4 smoke | 全部通过 |
| Regression | v0.4 prompt regression | 全部通过 |
| Regression | hooks/skills | 新插件不破坏现有模块发现和安装 |

## 真实 E2E 契约

### Dashboard E2E

至少选择 5 个真实 workspace：

- 一个 RAVO 数据完整且近期活跃。
- 一个存在 pending acceptance、blocker 或 Review gap。
- 一个没有 RAVO 数据或数据不完整。
- 一个配置为 paused。
- 一个配置为 archived。

记录：

- workspace path 和选择原因。
- Dashboard 实际状态。
- source refs。
- 与真实 artifact/Session 的人工核对结果。
- desktop/mobile screenshot。
- pass/fail 和缺口。

还必须用隔离的 Codex 配置或可恢复的安全测试环境覆盖 marketplace missing、plugin disabled 和 hook trust record missing；不得为测试破坏用户当前有效配置。

### Runtime Probe E2E

- 使用当前版本 fingerprint 生成 Runtime 验证 Prompt。
- 真实创建 fresh Codex Session。
- 使用自然语言中高复杂任务验证预期 RAVO advisory/skill 是否可见。
- 记录 session id、Prompt、真实响应摘要、预期 hooks、实际结果和 pass/fail。
- 修改测试 fingerprint 后确认旧 probe 自动 stale。
- 直接执行 hook 脚本只作为诊断证据，不计入 runtime probe pass。

### 快捷指令 E2E

至少测试 5 类，覆盖 R/A/V/O/Runtime：

- `继续这个 workspace`
- `分析新需求` 或 `分析问题根因`
- `检查验收缺口`
- `生成 Goal Prompt`
- `检查 RAVO 状态`

每条必须：

- 从 Dashboard 生成 Prompt。
- 真实创建 Codex Session/Task。
- 记录 session/thread id。
- 记录 Prompt 原文或脱敏版本。
- 记录真实响应摘要。
- 记录产生的 RAVO artifact。
- 判断是否遵守 Spec、证据和数据边界。
- 检查相关 workspace/user knowledge 是否按 opt-in 和 applicability 正确加入或保持静默。

脚本构造输出、fake session 或只检查 Prompt 字符串不能替代该 E2E。

### 配置中心 E2E

必须使用隔离 HOME 和至少一个隔离 workspace，覆盖：

- 从不存在配置文件开始保存 user config，并在服务重启后读取同一 effective value。
- 修改 workspace override，只影响指定 workspace。
- 保存已知字段时保留预置未知字段。
- 非法类型、越界值、未知 module/field、symlink/path escape 和无 CSRF 请求均不改变文件。
- Review credential 的 keep/replace/clear；API、浏览器网络响应、日志、截图、artifact 和备份清单均不得出现 secret 原值。
- 每次成功写入存在权限正确的备份；恢复后配置语义与写入前一致。

记录 config target、脱敏 before/after、backup path、文件权限、重启后结果和 pass/fail；不得记录 secret 或完整配置正文。

### 多 Provider Review E2E

自动化必须使用至少两个 fake Provider，每个至少一个 enabled model，覆盖：

- 全成功。
- 单 Provider 失败、timeout、429/5xx retry 后成功和 retry exhausted。
- HTTP 成功但空正文、仅 reasoning、`incomplete`、截断、schema 无效和 findings 为空。
- semantic retry 成功和 semantic retry exhausted。
- `plannedDelayMs/actualDelayMs` 与真实经过时间一致；测试不得通过生产代码压缩等待时间。
- `safe_sanitized`、`sensitive_requires_consent`、`prohibited` 三种数据边界结果及网络调用次数。
- 双模型 raw findings 到 issue ledger 的字段一致性、finding 数量和 parser failure 降级。
- 初始、retry、fallback/补偿共用 `reviewRunId`，聚合 artifact 更新 manifest。
- 跨 Provider 同名 model。
- legacy flat config 与 provider-array config 得到一致的 normalized semantics。
- SoloDesk、共享 validator 和 runner 的 Provider/model count、key 和错误一致。

真实外部 E2E 至少完成两个独立 `providerId/modelId` 的 usable 响应，并人工核对 raw response、结构化 findings 和 issue ledger。优先使用两个 Provider；如果当前只配置一个 Provider，可在同一 Provider 使用两个 models，但必须把“跨 Provider 真实验证”标为 blocked，记录所需配置和恢复入口，不能用 fake 结果代替。

真实外部 E2E 还必须保留至少一个 timeout/retry 或 semantic failure 的负向 artifact，证明失败证据不会被后续成功子运行覆盖或误报为完整多模型 Review。

### 一键升级 E2E

必须在隔离 Codex HOME/marketplace 或可完整恢复的测试环境中，从低于 v0.5.0 的真实 RAVO 安装开始：

1. 准备包含 non-default 参数、Review Provider/models、secret configured 状态和未知字段的真实配置。
2. 在 SoloDesk 检查更新，核对 current/available/required plugin set。
3. 点击一次升级并确认计划，记录 backup、journal 和逐插件真实 CLI JSON 结果。
4. 验证所有 required plugin 的 installed/enabled/version/source/cache 一致。
5. 验证配置值、未知字段、secret configured 状态、owner/mode 和 workspace override 未丢失或被模板覆盖。
6. 真实创建 fresh Codex Session，完成 Runtime probe；旧 Session 不作为升级后生效证据。
7. 注入一次中途失败，证明 journal=partial/failed、配置可恢复且 UI 不显示成功。

只运行 migration 单测、复制模板或比较脚本退出码不能替代该 E2E。

## PM 验收要求

### PM 验收包必须提交

最终对话必须发送：

- v0.5.0 验收结论摘要。
- 需求预期、当前实现方案、实现效果、满足程度、验证状态对比。
- Codex 尚需完成的验证清单。
- PM 验收清单。
- Dashboard 实际 URL 或启动方式。
- 真实响应和 Session id。
- Review 数据边界决策、raw response、structured findings、issue ledger、attempts 和聚合 coverage 证据。
- desktop/mobile screenshot 路径。
- 数据、API、日志和 artifact 证据。
- 未满足项、阻塞、风险和下一步。

### PM 重点验收

- 30 秒内能否判断最需要关注的 workspace。
- 状态和下一步是否符合用户对真实项目的理解。
- 是否能清楚区分实现缺口、Codex 补证和 PM 验证。
- 快捷指令是否能减少恢复上下文的工作，而不是生成泛化 Prompt。
- R/A/V/O/Runtime 分类是否能快速说明当前缺的是分析、执行、验证、知识还是运行环境。
- 注意力队列是否把真正影响判断可信度的问题排在普通业务建议之前。
- paused/archived 和 priority 是否符合用户对产品组合的真实意图，没有制造 stale 噪声。
- Runtime health 是否诚实区分 healthy、configured_unverified 和 degraded；trust record 存在时不夸大为 hook 已在当前 Session 生效。
- stale Spec/Review/Acceptance 是否被正确降级，没有继续展示为当前结论。
- Continuation Brief 是否让 fresh Session 能直接继续，而不是重新追问目标、milestone、blocker 和验收缺口。
- workspace/global knowledge 是否只在有实际 applicability 时进入 Prompt，并遵守 opt-in。
- 配置中心是否让用户理解参数属于哪个模块、作用域和目标文件，且不会误改其它 workspace。
- Review Provider/model 管理是否清楚显示 credential 状态、模型归属、调用规模和真实运行结果。
- Review 是否清楚区分 Provider configured、内容允许外发、模型已响应和模型可用；空正文/incomplete 不得显示为成功。
- Issue ledger 是否与双模型真实响应一致，没有漏项、严重度降级或证据/建议错配。
- 一键升级是否让用户在一次确认内完成升级，同时明确备份、逐插件结果、配置保全和 fresh-session 要求。
- 成本/效率信号是否诚实、可解释、不误导。
- Dashboard 是否比直接翻目录和 artifacts 更有效。
- 移动端是否仍能完成巡视和复制 Prompt。

## 实施计划

可以按阶段推进，但阶段完成不等于 v0.5.0 完成。版本交付时必须覆盖全部 required 能力，除非逐项记录明确阻塞。

### 阶段 1：规格确认与轻量 H5 原型

- 根据本 Spec 制作 SoloDesk 首屏和 workspace 详情的轻量 H5 原型。
- 使用至少 5 个真实 workspace 的匿名/本地数据验证信息密度、R/A/V/O/Runtime lane、注意力队列和 portfolio metadata。
- PM 确认首屏是否能回答状态、进展、堵点、Runtime、Spec freshness、成本信号和下一步。
- 原型同时覆盖模块配置、Review Providers 和 RAVO 更新三类设置流程，验证信息架构和确认边界。
- 原型确认只验证交互方向，不算 v0.5.0 功能交付。

### 阶段 2：Acceptance 可执行验证模型

- 更新 acceptance schema、writer、checker、skill 和模板。
- 实现双维状态、verification tasks 和总体状态推导。
- 实现 legacy “基本满足”降级兼容。
- 更新 smoke 和 regression。
- 重新生成 v0.4.0 PM 验收包并形成真实补验清单。

### 阶段 3：共享配置、Review 证据与升级保全基础

- 建立 RAVO 配置契约，覆盖 user、Review module 和 workspace scope。
- 复用/提取现有 config reader，增加字段校验、脱敏 effective view、未知字段保留、原子写入、权限和写前备份。
- 从 `run-review.js` 提取共享 config normalizer/validator，runner/status/SoloDesk 共用。
- 实现三态数据边界决策、usable response gate、transport/semantic retry、真实退避和统一 attempt budget。
- 实现结构化 reviewer findings、issue ledger 完整性检查、`reviewRunId` 聚合和基于 usable pair 的 coverage。
- 强化 Analysis complete artifact 校验，并把所有插件脚本调用迁移到版本无关入口。
- 实现 RAVO update check、upgrade plan、配置 snapshot、journal、固定 Codex argv 和恢复入口。
- 使用隔离 HOME 完成配置写入、secret 脱敏、Review 负向响应、真实退避、migration 和中断恢复测试。

### 阶段 4：RAVO Runtime 与 Freshness 基础

- 扩展 `ravo-status`，读取 Codex marketplace/plugin JSON、版本、hook trust record、manifest/config 和 runtime probe。
- 增加 plugin/version fingerprint 和 fresh-session runtime probe artifact。
- 给 `ravo-goal-prompt` 增加 `--check-only`，Dashboard 复用同一 missing/stale Spec 逻辑。
- 实现 Review/Acceptance freshness 与派生结论 confidence。
- 增加 marketplace missing、plugin disabled、trust record missing、probe stale 和 newer spec input 回归。

### 阶段 5：Dashboard 数据层

- 新建 `ravo-dashboard` 插件和配置读取。
- 实现 workspace discovery、path allowlist 和 canonicalization。
- 实现 workspaceOverrides、priority、active/paused/archived。
- 接入配置 effective/status、Review Provider/model 和 update state API；mutation 只走共享配置/升级脚本。
- 实现 manifest/artifact/session index。
- 实现 R/A/V/O/Runtime lifecycle lanes、跨 workspace 注意力队列、多维状态、指标和建议规则。
- 增加损坏数据、无数据和格式变化测试。

### 阶段 6：Dashboard UI

- 实现 Runtime banner、注意力队列、workspace 总览、lane/priority/lifecycle 筛选和稳定排序。
- 实现 workspace 详情、生命周期摘要、freshness/confidence、时间线、待验证项、来源查看和指标。
- 实现模块配置、Review Providers 和 RAVO 更新视图，包括 diff、secret 状态、调用预览、备份和 journal 结果。
- 实现空状态、错误状态、loading 和 refresh。
- 完成 desktop/mobile responsive 和可访问性基础。
- 使用 Playwright 或等价浏览器自动化生成截图证据。

### 阶段 7：Continuation Brief、Knowledge 与快捷指令

- 实现 Continuation Brief 和 11 个上下文 Prompt 模板，首屏最多展示 4 个相关动作。
- 复用 Goal Prompt missing/stale Spec guard。
- 复用 workspace/global Knowledge retrieval，遵守 opt-in、applicability 和静默规则。
- 给 retrieval 增加无写入查询模式；Dashboard 所有检索使用该模式，并验证 workspace/user knowledge mtime 不变化。
- 实现 Prompt 预览和复制。
- 确保 technicalDetailLevel 和数据边界生效。
- 使用真实用户 Session 意图样本校准目录，不把未出现的低价值动作放到首屏。

### 阶段 8：真实 E2E、Review 和总验收

- 使用至少 5 个真实 workspace 做 Dashboard E2E，覆盖 active、pending/blocker、no_ravo_data、paused 和 archived。
- 运行 fresh-session Runtime probe，并在隔离配置中验证 marketplace/plugin/hook trust record 缺失降级。
- 验证 newer alignment/spec delta、stale Acceptance 和 low confidence 路径。
- 从 Dashboard 真实创建至少 5 个 Codex Session，覆盖 R/A/V/O/Runtime。
- 在隔离 HOME/workspace 完成配置中心写入/重启/secret 脱敏 E2E。
- 完成 fake 两 Provider 全矩阵和真实至少两个 provider/model pair Review E2E；跨 Provider 外部条件不足时逐项记录阻塞。
- 完成三态数据边界、空正文/incomplete/schema 无效、semantic retry、真实退避和 raw-to-ledger 一致性 E2E。
- 完成插件升级后的 fresh-session 版本无关入口回归，确认不存在旧缓存版本路径。
- 从真实旧版 RAVO 执行一键升级，验证配置保全、逐插件版本、journal、失败恢复和 fresh-session probe。
- 运行 v0.4.0 smoke、prompt regression 和 repo validation。
- 运行 RAVO Review，检查需求遗漏、状态误判、数据边界、UI 和验收自证风险。
- 运行 RAVO acceptance evidence check。
- 生成并在最终对话提交面向 PM 的 v0.5.0 验收文档。

## Goal 模式完成条件

Goal 只能在以下条件全部满足后标记 complete：

- 本 Spec 全部 required 功能已实现。
- 验证矩阵全部通过，或逐项记录明确阻塞、影响、降级和恢复入口。
- v0.4.0 回归全部通过。
- v0.4.0 PM 验收包已按新模型重生成。
- 至少 5 个真实 workspace Dashboard E2E 已记录。
- 至少 5 个真实 Codex Session 快捷指令 E2E 已记录，覆盖 R/A/V/O/Runtime。
- 当前 plugin/version fingerprint 的 fresh-session runtime probe 已通过；如果宿主明确阻塞，必须记录降级和恢复入口。
- marketplace missing、plugin disabled、hook trust record missing 和 probe stale 的隔离反例已通过。
- paused/archived 不误报 stale，priority 排序可解释。
- stale Spec/Acceptance 和 low confidence 不支持高置信度推进或验收结论。
- Continuation Brief 已在 fresh Session 中证明可直接续跑。
- workspace/global knowledge 检索的 opt-in、applicability、staleness 和静默行为已验证。
- Dashboard knowledge retrieval 无写入行为已验证。
- 配置中心覆盖全部 RAVO 公开参数；合法值持久生效，非法值不落盘，未知字段和 secret 均未丢失/泄漏。
- Review 共享 normalizer/validator 已成为 runner、SoloDesk、status 的唯一配置状态来源。
- fake 多 Provider 矩阵和真实至少两个 provider/model pair E2E 已记录；未完成的跨 Provider 外部验证有明确阻塞和恢复入口。
- 三态数据边界决策已通过无网络反例；Provider 配置没有被当成任意内容的永久外发授权。
- `modelsResponded/modelsUsable/modelsFailed`、transport/semantic retry 和统一 attempt budget 已通过正反例。
- retry 的计划等待、真实等待和 wall-clock 证据一致，不存在生产路径静默压缩退避。
- 双模型 raw findings、结构化 findings 和 issue ledger 已人工核对一致；parser 失败不会产生 full coverage。
- 同一逻辑 Review 的 retry、fallback 和补偿证据已按 `reviewRunId` 聚合，manifest/current Review 不被最后一个子 artifact 误导。
- Analysis complete artifact 强校验和版本无关插件入口已通过升级后 fresh-session 回归。
- 一键升级已从真实旧版安装验证配置备份、migration、逐插件版本一致、失败恢复和 fresh-session 生效。
- desktop/mobile 截图已提交并人工检查。
- RAVO Review coverage 与实际 provider 证据一致。
- 安全基线全部检查。
- PM 验收文档已在最终对话中提交核心内容。
- 所有 `pending_codex` 已闭环，或存在明确外部阻塞。
- 最终回复包含基于剩余状态的简短下一步建议。

## 发布口径

满足全部完成条件后可以说：

> RAVO v0.5.0 提供 SoloDesk 本地工作台，可按 Reason、Act、Verify、Organize 和 Runtime 跨 Codex workspace 查看可追溯的治理状态，生成带 Continuation Brief 的 RAVO/Codex Prompt，集中管理 RAVO 配置与 Review Providers，并在配置备份和验证保护下检查、升级整套 RAVO 插件；PM 验收同时区分需求满足程度和验证状态，所有未验证项都带有可执行验证任务。

不能说：

> SoloDesk 是完整产品管理系统。

不能说：

> Dashboard 展示的是精确效率或真实货币成本。

不能说：

> Dashboard 状态可以替代源 artifact、真实 E2E 或 PM 验收。

不能说：

> hook trust record 存在就证明 RAVO 已在当前 Session 生效。

不能说：

> paused 或 archived workspace 长期无活动就代表项目失控。

不能说：

> 只要需求标记“满足”，就代表已经验收。

不能说：

> 某个阶段或 H5 原型完成就代表 v0.5.0 已完成。

不能说：

> 只要插件安装命令退出码为 0，就代表一键升级成功或配置一定未丢失。

不能说：

> SoloDesk 可以管理任意 Skill 配置或升级 Codex 本体。

## Decision-Complete 检查

- 产品目标、真实消费者和核心场景明确。
- v0.4.0 基线与 v0.5.0 增量关系明确。
- Session 中被后续决策替代的独立产品管理分支已排除。
- Acceptance 双维状态、任务 schema、责任边界和总体状态推导明确。
- “基本满足”的兼容和禁止生成规则明确。
- SoloDesk 的产品边界、插件位置、技术栈和配置明确。
- workspace discovery、artifact/session 数据源和降级行为明确。
- R/A/V/O/Runtime 生命周期模型和跨 workspace 注意力队列明确。
- workspace priority、active/paused/archived 边界明确，且不形成第二套产品库。
- Runtime health 区分 Codex marketplace/plugin 状态、hook trust evidence 和 fresh-session probe。
- Spec、Review、Acceptance 和派生视图的新鲜度/置信度规则明确。
- 多维状态解决了 active/blocked/stale 可同时成立的问题。
- 指标只使用可验证信号，不制造伪精确成本或效率分。
- 快捷指令范围、上下文契约和 Goal Prompt guard 明确。
- Continuation Brief、Knowledge retrieval、用户 opt-in 和静默规则明确。
- Dashboard Knowledge 无写入查询契约明确。
- RAVO 配置契约、作用域、effective source、原子写入、备份、secret 和第三方 skill 边界明确。
- Review 多 Provider/多模型、共享 normalizer/validator、调用预览和 coverage 规则明确。
- Review 三态外发决策、usable response、transport/semantic retry、真实退避、结构化 findings、issue ledger 和聚合 coverage 规则明确。
- Analysis complete artifact 和版本无关插件运行入口的门禁明确。
- RAVO 更新检查、一键升级、配置保全、migration、journal、失败恢复和 fresh-session 规则明确。
- 本 Spec 已在 alignment 最终状态更新后再次同步 `docs/ravo-v0.5.0-requirements-alignment-zh.md` 的 2026-07-10 全部新增需求与五类真实 workspace 验收口径。
- UI 信息架构、响应式、错误状态和截图验收明确。
- 数据、凭据、权限、破坏性动作、外部调用、依赖和日志边界明确。
- 验证矩阵、真实 E2E、PM 验收和发布口径明确。
- 实施可以分阶段，但版本交付必须覆盖全部 required 功能。
