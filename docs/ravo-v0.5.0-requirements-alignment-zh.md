# RAVO v0.5.0 需求对齐文档

日期：2026-07-10

状态：扩展内容已对齐并写入 decision-complete Spec

本文件不是可执行规格，不能单独作为 Goal Prompt 的需求来源。最终执行范围以 `docs/ravo-v0.5.0-decision-complete-spec-zh.md` 为准。

## 1. 对齐来源

- RAVO v0.4.0 规格：`docs/ravo-v0.4.0-decision-complete-spec-zh.md`
- RAVO v0.4.0 PM 验收结果（workspace-local artifact，不随仓库发布）
- 当前 Session 关于“基本满足”与可执行验证清单的讨论
- Codex Session：`019f23ae-d42a-7de3-b70e-69da39bb74e1`
- `Wanted` 项目中的 SoloDesk / RAVO Dashboard 规格（外部产品输入，不随本仓库发布）
- `Wanted` 项目的插件系统愿景（外部产品输入，不随本仓库发布）
- `Wanted` 项目的参考产品调研（外部产品输入，不随本仓库发布）
- 2026-07-10 基于 RAVO 当前产品定义对 v0.5.0 的范围复审
- 当前 `ravo-status`、`codex plugin list --json`、marketplace 和 hook trust 记录的真实诊断结果
- 2026-07-10 关于 SoloDesk 配置管理、RAVO Review 多 Provider/多模型和一键升级的新增需求
- `knowledge/.ravo/analysis/2026-07-10T06-32-39-588Z-ravo-review-provider.json` 中关于重复配置解析和错误状态 artifact 的根因结论
- Codex Session `019f47b0-91a2-7182-a0e0-0a4fe081d07b` 中关于“没有外部授权所以跳过 Review”的真实案例
- 外部 `Skills` 工作区中的 RAVO Review 多模型需求评审证据（不随本仓库发布）
- 外部 `Skills` 工作区中的 RAVO Review 根因分析证据（不随本仓库发布）

## 2. 一句话对齐

RAVO v0.5.0 在 v0.4.0 治理闭环基础上新增六个产品级能力：

1. 把模糊的 PM 验收判断升级为“需求满足程度 + 验证状态 + 可执行验证任务”的闭环。
2. 将 SoloDesk 收口为 RAVO 的跨 workspace Dashboard，让产品经理快速看到状态、进展、成本信号、堵点和下一步，并生成可直接进入 Codex Session 的上下文 Prompt。
3. 让 Dashboard 同时证明“这些判断是否可信”：展示 R/A/V/O 生命周期覆盖、Spec/证据新鲜度、RAVO 插件与 hook 运行健康、数据置信度和跨项目续跑上下文。
4. 在 SoloDesk 中集中管理 RAVO 各模块的可配置参数，展示当前值、生效来源、校验结果和敏感字段状态。
5. 把 RAVO Review 的多 Provider/多模型能力产品化，同时补齐外发决策、可用响应、语义重试、真实退避、问题台账和 coverage 证据契约。
6. 提供 RAVO 更新检查和用户确认的一键升级，升级前备份配置，升级后验证版本、配置完整性和 Runtime 状态。

## 3. Session 最终决策

### 3.1 采纳内容

- `SoloDesk = RAVO Dashboard`，不是独立产品管理系统。
- `Codex workspace = Product`，不再新增一套 Product 主数据。
- `Codex Session = Execution Unit`。
- `RAVO Artifact = Source Fact`。
- Dashboard 中的状态、指标和下一步都是派生视图，必须能回溯到 artifact 或 session。
- 主要操作继续发生在 Codex Session 中；Dashboard 负责查看、定位、组织和生成下一步入口。
- Dashboard 首屏应回答：哪些 workspace 正在推进、进展到哪里、哪里卡住、哪些待验收、成本/效率信号如何、下一步应做什么。
- 快捷指令本质是带上下文的 Prompt 模板，不是绕过 RAVO 规则的业务按钮。
- RAVO 的长期消费者包括使用 AI/Codex 推进多个产品的产品经理超级个体。
- SoloDesk 同时是 RAVO 的受控配置与升级入口，但不是通用 Codex 配置编辑器。
- v0.5.0 只管理所有 RAVO 自身公开的用户级/workspace 配置；第三方 skill 配置接入延后，当前只显示“未受 SoloDesk 管理”。
- RAVO Review 以 `providerId/modelId` 作为唯一模型标识，允许不同 Provider 使用相同 model id。
- Provider 已配置只代表具备调用能力，不代表任意私有内容都已获得外发授权。
- 通用且已脱敏的 Review 摘要通过数据边界检查后可以自动进入 Review；敏感内容才需要进一步脱敏或单独确认，凭据和禁止类别始终不得外发。
- Provider 返回 HTTP 成功不等于 Review 成功；只有存在非空最终正文、没有未处理的 incomplete/truncation、且结构化 finding 校验通过时才算 usable response。
- Review 的初始调用、transport retry、semantic retry、fallback 和补偿运行必须归入同一个逻辑 `reviewRunId`，不能让最新单个 artifact 覆盖整体证据语义。
- RAVO 升级以整套 RAVO 插件为版本单元，配置文件独立于插件缓存并在升级前建立可恢复备份。

### 3.2 被后续决策替代的内容

- 不把 SoloDesk 作为独立产品管理 SaaS 推进。
- 不建立独立的 Product、Version、Requirement、Task 重型 CRUD。
- 不把旧 Wanted PRD 的完整对象模型搬进 RAVO。
- 不把 Linear、Plane、Huly 等传统 PM 产品的整体形态作为 RAVO Dashboard 主参照。
- 不因品牌探索而重命名 RAVO 仓库；`Wanted`、`Product Desk`、`ScopeDesk` 等命名讨论只保留为历史探索。
- 不在 v0.5.0 承诺未经验证的一键创建 Codex Task API；必须先交付可复制、可追溯的 Prompt，宿主 API 稳定后再增强。
- 不管理任何第三方 skill 配置，不扫描或猜测任意配置文件；兼容配置契约只作为后续扩展方向。
- 不通过 SoloDesk 升级 Codex Desktop/CLI 本体；一键升级只覆盖 RAVO marketplace 和 RAVO 插件集合。
- 不在 UI、日志、API、artifact 或备份清单中返回 API Key、token 或其它 secret 原值。

## 4. PM 验收新口径

### 当前问题

v0.4.0 PM 验收文档中的“基本满足”无法区分：

- 功能已经满足，只缺 PM 人工确认。
- 功能已经实现，但 Codex 还没有完成真实 E2E。
- 功能存在已知边界或降级。
- 功能只通过 smoke、fake provider 或 prompt regression，尚未证明真实效果。

现有生成器还只输出“验收项：基本满足”，没有把 Spec 已要求的 PM 验收方式、必需证据、产品边界和风险变成可执行清单。

### 对齐结论

验收必须拆成两个维度：

| 维度 | 值 |
|---|---|
| 需求满足程度 | 满足 / 部分满足 / 不满足 / 不适用 / 未判定 |
| 验证状态 | 已验证 / 待 Codex 补证 / 待 PM 验证 / 阻塞 / 待分类 |

任何不是“已验证”的验收项必须产生验证任务。验证任务至少包含：

- 待验证结论。
- 当前未确认原因。
- 验证责任人。
- 具体步骤。
- 预期结果。
- 必需证据。
- 验证失败后的状态降级和处理动作。
- 是否阻塞整体验收或发版。

### 团队责任边界

- Codex 能自动完成的验证必须在交付前执行，不得转嫁给 PM。
- PM 验收清单主要保留体验、业务效果、需求理解和主观可用性判断。
- 外部 provider、账号、权限或设备缺失导致无法执行时，应标记阻塞并提供恢复入口。
- “基本满足”不得继续作为无后续动作的终态；旧 artifact 必须重新分类或重新生成。

## 5. Dashboard 产品边界

### 真实消费者

- 本职是产品经理。
- 同时使用 Codex/RAVO 推进多个产品 workspace。
- 经常在大量项目之间切换，需要快速恢复上下文。
- 主要在 Session 内做分析、开发和验收，在 Dashboard 中做巡视和选择下一步。

### 核心场景

1. 打开 Dashboard，在 30 秒内知道哪些 workspace 最需要关注。
2. 查看某个 workspace 的 RAVO artifact 与 Codex Session 时间线。
3. 发现 blocker、待补证据、待 PM 验收、缺 Review 或长期未推进状态。
4. 查看轻量效率和成本信号，不生成缺乏数据依据的精确分数。
5. 根据当前状态生成“继续 workspace”“找堵点”“检查验收缺口”“生成 Goal Prompt”等 Prompt。
6. 从任何结论跳回源 artifact、session 或 workspace。

### 不做

- 不做团队协作、云同步、账号体系。
- 不做传统 issue tracker、roadmap、甘特图或工时系统。
- 不把 Dashboard 变成中心调度器。
- 不让 Dashboard 自动修改 RAVO artifact、Spec 或项目事实。
- 仅允许通过受控配置中心修改 allowlist 内的 RAVO 配置文件；不得提供任意路径、任意 JSON 或任意 shell 编辑能力。
- 不在缺少稳定 token/cost 数据时展示货币成本或伪精确效率分。
- 不扫描用户整个主目录。

## 6. 关键设计决策

### 多维状态而不是单一状态

原 Dashboard 草稿使用 `active / stale / blocked / needs_acceptance / needs_review` 单一状态，但这些状态可能同时成立。例如，一个 workspace 可以最近活跃、同时被 blocker 卡住并等待验收。

v0.5.0 改为四个维度：

- 活跃度状态：active / stale / dormant / unknown。
- 交付状态：no_data / in_progress / code_complete / pending_acceptance / blocked / accepted / not_ready。
- Review 状态：current / needed / partial / unavailable / not_applicable。
- 数据状态：complete / partial / no_ravo_data / error。

Dashboard 再根据优先级生成一个“主要关注原因”，用于排序和下一步建议。

### 数据真实性

- manifest 和 artifact 是 RAVO 状态的主要事实源。
- Session 只读取本地元数据；默认不展示完整 prompt 正文。
- Dashboard 不建立第二套产品事实库。
- 派生结论必须包含来源引用和计算规则。
- artifact 损坏或缺失时显示降级状态，不猜测结果。

### R/A/V/O 生命周期视图

Dashboard 不应只显示一组技术状态，而应按 RAVO 的产品定义组织用户注意力：

- Reason：目标、需求分析、盲区、Spec 完整性与陈旧风险。
- Act：活跃 workstream、当前 milestone、blocker、进展和续跑入口。
- Verify：Review、Evidence、Acceptance、Codex 补证和 PM 验收。
- Organize：可复用 knowledge、最近决策和经验适用性。
- Runtime：marketplace、插件启用、版本漂移、hook trust 记录、manifest 和配置健康。

生命周期视图不是综合评分。每个结论仍必须显示来源、新鲜度和数据完整性。

### 跨 workspace 注意力队列

仅按“最近活跃”或“是否 blocked”排序不足以支持产品经理决策。v0.5.0 必须形成跨 workspace 注意力队列，每条至少包含：

- workspace。
- R/A/V/O/Runtime 分类。
- 严重程度。
- 触发原因。
- source refs。
- 数据置信度与新鲜度。
- 建议动作和预期结果。

当数据置信度低或 Runtime 不健康时，优先建议恢复事实链路，而不是直接给产品推进建议。

### 产品组合最小上下文

`workspace = Product` 不代表所有 workspace 都应持续推进。为避免暂停项目被反复标记 stale，允许在用户级配置中维护最小 Dashboard 元数据：

- `displayName`。
- `priority=high|normal|low`。
- `lifecycle=active|paused|archived`。

这只是 Dashboard 偏好，不是新的产品事实库：

- 未配置时默认 `normal + active`。
- paused 不生成“应继续推进”建议。
- archived 默认不进入总览和注意力队列。
- priority 只用于筛选和同级排序，不生成不透明综合分。
- v0.5.0 提供 SoloDesk 配置中心维护这些 Dashboard 偏好；写入前必须校验、备份并显示实际目标文件。

### Spec 与证据新鲜度

仅展示“最新 artifact”会产生错误确定性。v0.5.0 必须增加：

- `specHealth=current|missing|draft|stale|error`，复用 Goal Prompt stale-spec guard。
- Acceptance freshness：如果 Spec、workstream、Review issue 或相关实现证据晚于验收，标记 stale/unknown。
- Review freshness：input hash 或 source ref 与当前对象不一致时不算 current。
- 每个派生视图提供 `derivedAt`、`sourceUpdatedAt`、`freshness` 和 `confidence`。
- stale/unknown 结论不能支持 accepted、release_ready 或高置信度下一步。

### RAVO 运行健康

真实使用已经证明：源码、安装缓存和 Codex 启用状态不是同一件事。当前 `ravo-status` 主要检查源码与缓存版本，还需要扩展为宿主运行健康：

- `codex plugin marketplace list --json` 中是否存在 RAVO marketplace。
- `codex plugin list --marketplace ravo --json` 中必需插件是否 installed/enabled。
- source、installed cache 和 Codex runtime 版本是否一致。
- 有 hooks 的插件是否存在对应 hook 文件与 trust record；无法证明宿主实际加载时必须标 unknown，而不是 healthy。
- 是否需要新开 Session 才能使用刚安装/升级的 hook。
- workspace manifest 和配置是否可读。

Dashboard 默认只负责检测、降级置信度和给恢复入口；只有用户在升级界面明确确认后，才可调用 Codex 原生命令升级 RAVO marketplace/插件。自动修改无关 `~/.codex/config.toml`、替用户批准 hook 或静默升级仍不在 v0.5.0 范围内。

### SoloDesk 配置中心

配置中心面向 RAVO 自身公开配置，不做任意文件编辑器：

- 按 Core、Analysis、Workstream、Evidence、Acceptance、Knowledge、Review、Dashboard 分组展示参数；没有参数的模块显示“无可配置项”。
- 每个参数必须有类型、默认值、合法范围、敏感级别、目标文件和作用域；UI 控件由已声明契约生成。
- 展示 `effectiveValue`、`source=user|workspace|default` 和校验状态；workspace override 只在明确选择 workspace 后编辑。
- 写入采用临时文件 + 原子替换，并在写入前建立备份；校验失败不改变原文件。
- “原子”只承诺单文件 `write + fsync + rename + read-back`；跨文件操作使用 journal，不伪装成事务。
- secret 只显示 `configured/not_configured`，支持替换或清除，不回显原值。
- v0.5.0 必须管理 `~/.codex/skill-config/ravo.json`、`~/.codex/skill-config/ravo-review.json` 和已选择 workspace 的 `knowledge/.ravo/config.json`。

### RAVO Review 多 Provider/多模型

- 一个 Review 配置可以包含多个 Provider，每个 Provider 维护独立的 `id`、`label`、`enabled`、`apiBase`、`apiMode`、credential 状态、timeout 和 models。
- 每个 Provider 下可以启用多个 model；运行和 artifact 使用 `providerId/modelId`，避免同名模型冲突。
- coverage 按实际请求的 Provider/Model 对计算；某个 Provider 失败不得抹掉其它 Provider 的成功结果。
- SoloDesk 保存前必须使用与 runner 相同的配置归一化和校验逻辑，不得再次实现只识别 `providers[]` 或只识别 flat config 的临时探针。
- Review 发起前显示本次 Provider 数、model 数、round 数和最大调用次数，避免误触发大规模外部调用。

### Review 外发决策与证据完整性

- Review 发起前必须形成 `safe_sanitized | sensitive_requires_consent | prohibited` 三态数据边界决策，并记录脱敏摘要与授权来源。
- SoloDesk 只有用户显式点击 Review/Provider test 才允许外部调用；Codex 治理流程已触发 Review 时，`safe_sanitized` 不再重复询问，`sensitive_requires_consent` 必须确认，`prohibited` 始终拒绝外发。
- 运行证据必须区分 `modelsRequested`、`modelsResponded`、`modelsUsable` 和 `modelsFailed`。空正文、仅 reasoning、`incomplete`、截断或 schema 无效不得进入 `modelsUsable`。
- timeout、连接错误和 429/5xx 使用 transport retry；空正文、incomplete、截断和 schema 无效使用 semantic retry。所有尝试共享调用预览中的 `maxAttempts` 预算，不允许隐藏请求。
- retry artifact 同时记录 `plannedDelayMs` 和 `actualDelayMs`；实现不得为了测试把真实退避静默缩短。
- Reviewer 优先返回结构化 JSON findings；issue ledger 必须保持 title、severity、evidence、mechanismRisk、recommendation 和 source model 的对应关系。
- parser 失败、finding 数不一致、建议错配或 Ledger 无法由 raw response 重建时，整体证据最多为 `partial`，不得生成通用占位问题冒充真实 finding。
- 顶层 `coverage` 按 usable provider/model pair 和实际完成轮次计算；transport response 只作为诊断证据，不能提高 coverage。
- 同一逻辑 Review 的 retry、fallback 和补偿 artifact 使用稳定 `reviewRunId` 聚合；Dashboard 和 Acceptance 读取聚合结果，不只读取最后一个子 artifact。
- Analysis `status=complete` 必须校验当前分析类型要求的核心字段和所需 Review evidence，不能只凭一条 fact、challenge 和 conclusion 通过。
- 插件脚本通过当前 Skill/plugin root 或稳定版本无关入口解析；不得在 Prompt、hook 或调用脚本中硬编码缓存版本目录。

### RAVO 更新与配置保全

- SoloDesk 使用 Codex 原生 `plugin marketplace upgrade`、`plugin list --json` 和 `plugin add --json` 完成检查与安装，不自建下载器。
- 升级前记录当前 RAVO 插件版本集合，并把所有 allowlist 配置复制到权限受限的时间戳备份目录，同时记录哈希、权限和 schemaVersion；备份清单不得包含 secret 原值。
- 备份必须 read-back 并校验大小/哈希后才能进入安装阶段；备份失败时不执行任何插件安装。
- 插件模板不得覆盖用户配置。需要 schema migration 时必须先预览、再执行迁移，并保留原文件备份。
- migration journal 逐项记录 migration id、from/to schema、状态和脱敏输入/输出 fingerprint；幂等定义为重复执行后目标配置语义不再变化。
- 升级后验证 marketplace、全部 required 插件版本、enabled 状态、缓存漂移、配置哈希/可解析性和 hook fresh-session 提示。
- 升级中断允许从 journal 继续或恢复配置；不能把部分升级包装成成功。
- Codex CLI 无法回退插件代码时不承诺完整事务回滚；配置可恢复，但插件集合标 `partial|indeterminate` 并给出人工恢复入口。
- 配置编辑与升级共用一个本地互斥锁，避免同时写入。

### 续跑上下文与知识复用

“继续这个 workspace”不能只是拼接最近 artifact。必须生成 Continuation Brief，至少包含：

- 当前目标和最新 decision-complete Spec。
- Spec 健康状态。
- 当前 milestone、blocker 和未决决策。
- Codex 尚需补证与 PM 待验收项。
- 最近活动与关键 source refs。
- 当前 RAVO Runtime 健康。
- 数据缺口。
- 与当前问题相关的 workspace knowledge。
- 用户已启用全局知识时，可加入脱敏且适用的 user-scope 经验。
- 请求动作和证据边界。

没有高价值知识时保持静默；Knowledge 只能提供连续性，不能替代功能证据。
现有 retrieval 会更新命中知识的 `lastUsedAt`，因此 v0.5.0 必须增加无写入查询模式；Dashboard 使用该模式时不得修改 workspace 或 user-scope knowledge 文件。

### 最小实现

- 在 RAVO 仓库新增 `ravo-dashboard` 插件模块，用户可见名称为 SoloDesk。
- 使用本地 Node.js 服务和静态前端，不引入数据库和重型前端框架。
- 服务只绑定 `127.0.0.1`。
- workspace roots 由配置维护；未配置时只显示当前 workspace 和设置入口，不广泛扫描磁盘。
- 索引使用内存缓存，启动、手动刷新和短周期刷新即可，不做复杂文件监听。
- 配置中心和升级程序复用 Node.js 标准库、Codex CLI 与现有 RAVO config reader；不新增数据库、凭据服务或包管理器。

## 7. v0.5.0 必须范围

1. Acceptance 双维状态模型。
2. 非已验证项的结构化验证任务。
3. Codex 补证与 PM 验证责任分离。
4. PM 验收文档、artifact schema 和 checker 同步升级。
5. 旧“基本满足”artifact 的降级兼容和重新分类规则。
6. SoloDesk 本地 Dashboard 启动入口。
7. workspace discovery、manifest/artifact/session 元数据索引。
8. workspace 总览、详情、时间线、来源跳转。
9. R/A/V/O/Runtime 生命周期视图。
10. 跨 workspace 注意力队列。
11. workspace priority、active/paused/archived 最小配置。
12. 多维状态、主要关注原因和下一步建议。
13. Spec、Review、Acceptance 和派生视图的新鲜度/置信度。
14. RAVO marketplace、插件启用、版本漂移、hook trust record 和 manifest 运行健康。
15. 运行健康异常时的置信度降级和恢复入口。
16. 轻量效率/成本信号，明确数据边界。
17. Continuation Brief 和跨项目知识复用。
18. 基于真实用户 Session 习惯校准的上下文 Prompt 快捷指令。
19. 无 RAVO 数据 workspace 的初始化 Prompt，不自动执行。
20. Dashboard Knowledge 无写入查询模式。
21. 空状态、损坏数据、无 RAVO 数据和权限错误降级。
22. 本地安全边界和路径白名单。
23. 真实 workspace、真实 Codex Session、桌面和移动视口 E2E。
24. Runtime 健康、stale Spec、paused/archived 和低置信度反例 E2E。
25. v0.4.0 全能力回归。
26. SoloDesk RAVO 配置中心和全部公开配置参数的分组管理。
27. 配置契约、作用域/来源展示、校验、原子写入、备份和 secret 脱敏。
28. RAVO Review 多 Provider/多模型配置、唯一标识、执行和 coverage 证据。
29. RAVO 更新检查和用户确认的一键升级。
30. 升级前配置备份、schema migration、升级 journal、失败恢复和配置完整性校验。
31. 配置写入、多 Provider Review、升级保全和 fresh-session Runtime 的真实 E2E。
32. Review 三态数据边界决策、脱敏摘要和授权来源证据。
33. `modelsResponded/modelsUsable/modelsFailed` 分层与 usable response 强校验。
34. transport retry、semantic retry、真实退避和统一 attempt budget。
35. 结构化 reviewer findings、可重建 issue ledger 和 parser 完整性门禁。
36. `reviewRunId` 聚合、fallback/补偿证据和基于 usable pair 的 coverage。
37. Analysis complete artifact 强校验和高影响任务 Review evidence 门禁。
38. 版本无关插件运行入口与升级后 fresh-session 路径回归。

## 8. 验收原则

- v0.5.0 可以按阶段开发，但交付必须覆盖全部 required 能力。
- Dashboard 不能只用构造 JSON 验收，必须读取至少 5 个真实 workspace，覆盖 active、pending/blocker、no_ravo_data、paused 和 archived。
- 快捷指令 E2E 必须真实创建 Codex Session，并记录 session/thread id、Prompt、响应摘要和 artifact。
- UI 必须提供截图证据；不能用脚本通过替代真实界面验收。
- PM 验收包必须分别列出 Codex 尚需验证的内容和 PM 需要验证的内容。
- 任何 `pending_codex` 项未闭环时，不得把版本提交给 PM 做最终验收，除非存在明确外部阻塞。
- 至少一个真实 E2E 必须模拟 marketplace/plugin/hook trust record 缺失，确认 Dashboard 不会给出假健康。
- 至少一个 paused 和一个 archived workspace 必须证明不会被误标为 stale 或推荐继续推进。
- 至少一个 newer alignment/spec delta 必须证明 Dashboard 将 Spec 标记 stale，并阻止生成实现型 Goal Prompt。
- Continuation Brief 必须真实创建 Codex Session，并验证新 Session 不需要重新猜目标、阻塞和验收缺口。
- 配置中心必须用隔离 HOME/workspace 做真实写入 E2E，证明非法值不落盘、合法值重启后仍生效、secret 不出现在响应和日志中。
- 多 Provider Review 必须至少使用两个 Provider、每个至少一个 model 的 fake-provider E2E，并使用真实 Provider 完成至少两个 `providerId/modelId` 的外部 Review；外部条件不足时逐项标阻塞。
- Review E2E 必须覆盖空正文、仅 reasoning、`incomplete`、截断、schema 无效和 ledger 提取失败，证明这些场景不会进入 `modelsUsable` 或 `coverage=full`。
- Retry E2E 必须核对计划等待时间和真实经过时间，不能只检查 attempts 中记录的 `delayMs`。
- 至少一组双模型真实响应必须人工核对 raw findings 与 issue ledger，严重度、证据和建议不得错配或静默丢失。
- 数据边界 E2E 必须分别证明：`safe_sanitized` 可继续、`sensitive_requires_consent` 会停在确认门、`prohibited` 不会发起网络请求。
- 一键升级 E2E 必须从旧版 RAVO 安装与真实配置开始，完成检查、备份、升级、配置哈希/语义校验和 fresh-session probe；不得只验证升级脚本退出码。

## 9. 主要风险

- Dashboard 变成第二套 PM 系统。
  - 防护：只读派生视图，不新增产品主数据 CRUD。
- 状态算法给出错误确定性。
  - 防护：多维状态、来源引用、数据完整性状态和规则说明。
- 读取 Session 暴露敏感内容。
  - 防护：默认只读元数据，不展示完整 prompt；本地绑定，不外发。
- workspace 扫描范围过大。
  - 防护：配置 allowlist、路径规范化、禁止扫描整个 home。
- “成本/效率”成为伪精确指标。
  - 防护：只展示可验证信号，缺少真实 token/cost 数据时不计算金额。
- PM 验收清单成为 Codex 推卸验证责任的工具。
  - 防护：`pending_codex` 与 `pending_pm` 分区，checker 阻止前者进入最终 PM 验收。
- Dashboard 将宿主配置故障误报为 RAVO 健康。
  - 防护：同时读取 Codex marketplace/plugin JSON、hook trust record、安装缓存和 workspace manifest；证据不足标 unknown。
- 暂停或归档项目制造大量 stale 噪声。
  - 防护：最小 portfolio lifecycle 配置，paused/archived 不参与推进建议。
- 过期 Spec、Review 或 Acceptance 被当作当前事实。
  - 防护：输入 hash/source ref/mtime 新鲜度检查，stale 状态优先于业务建议。
- Continuation Brief 只堆上下文，没有真正减少续跑成本。
  - 防护：固定最小字段、限制长度，并用真实新 Session 判断是否能直接继续。
- 快捷指令脱离用户真实习惯。
  - 防护：默认目录必须用真实 Session 意图样本校准；首屏只展示与当前状态最相关的少量动作。
- 配置中心写坏用户配置或覆盖 secret。
  - 防护：schema 校验、原子写入、权限受限备份、secret 不回显、隔离 HOME 破坏性反例 E2E。
- 多 Provider 配置再次被不同调用方用不同规则解释。
  - 防护：SoloDesk、status 和 runner 共用同一归一化/校验入口，artifact 记录 config fingerprint 和来源。
- Provider 配置被误当成任意内容的永久外发授权，或所有外发都被一律阻断。
  - 防护：三态数据边界决策、脱敏摘要和明确授权来源；Dashboard 与 Codex 治理流程使用不同触发边界但共用分类器。
- HTTP 成功、空正文或截断响应被记成完整 Review。
  - 防护：usable response gate、语义重试和 `modelsResponded/modelsUsable` 分层。
- Issue Ledger 正则解析漏掉 finding、错配建议或错误降级严重度。
  - 防护：结构化 reviewer schema、parser 完整性检查和 raw-to-ledger 人工/E2E 核对。
- Retry artifact 记录了退避时间，但实现实际没有等待。
  - 防护：记录并验证 `plannedDelayMs/actualDelayMs`，测试真实经过时间。
- 插件升级后旧缓存版本仍被 Prompt 或脚本硬编码引用。
  - 防护：稳定版本无关入口、当前 plugin root 解析和 fresh-session 路径回归。
- 一键升级形成混合插件版本或丢失配置。
  - 防护：整套版本检查、升级 journal、配置独立备份、逐插件验证和失败恢复；部分升级明确标 `partial/failed`。
- 更新入口扩大为任意命令执行或供应链入口。
  - 防护：只允许固定 Codex plugin 子命令和 `ravo` marketplace/plugin allowlist，不接受用户传入命令、URL 或路径。

## 10. 下一步

以上扩展内容已同步写入 `docs/ravo-v0.5.0-decision-complete-spec-zh.md`。实现顺序调整为：先统一 Review 配置读取、外发决策和可用证据语义，再完成升级保全与 Runtime/Freshness，最后推进 H5 原型、Dashboard 数据与 UI；否则 SoloDesk 会继续放大错误的 Review 和配置状态。
