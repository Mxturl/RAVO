# RAVO v0.3 候选需求

状态：候选，不是已承诺规格。

来源：v0.2 开发、真实自验收、full external review、发布验证后的剩余增强项。

## 定位

v0.2 已完成 required 范围：六模块安装、artifact 协议、自然触发、真实 subagent 验证、full external review、release 固化。

v0.3 不用于补 v0.2 漏洞，优先解决“可诊断性、边界硬度、运行时可靠性”。

## 筛选口径

进入 v0.3 正式规格前，每个候选需求都需要回答：

- 是否能降低真实使用中的误判、漏判或不可解释失败。
- 是否能用较小机制补强现有模块，而不是引入中心化调度器。
- 是否有可复现验证方法，包括脚本验证、负向用例或真实 Codex session/subagent 验证。
- 是否符合 RAVO 的产品原则：自然交互、第一性原理、奥卡姆剃刀、对抗式审查、证据匹配交付。
- 是否覆盖安全底线；Agent 不应因为用户不熟悉安全而省略安全风险审视。
- 是否需要外源模型评审；对高影响方案、真实 E2E 用例设计和复杂治理规则，应允许调用多模型评审能力。
- 是否能适配不同用户的技术理解深度；技术细节等级应可调，但不应破坏 RAVO 的共同底线。
- 新用户安装完成后，是否能快速找到需要配置的文件、模板和下一步检查命令。

## 候选 1：`ravo-status` 诊断能力

要解决的问题：

- 用户不知道 RAVO 是否真的生效。
- hooks 未授权、session 未重开、workspace 未初始化时，失败表现不明显。

最小能力：

- 检查六个插件版本和启用状态。
- 检查当前 workspace 的 `knowledge/.ravo/manifest.json`。
- 列出各模块最新 artifact。
- 给出 hook trust / 新开 session 的检查提示。

非目标：

- 不做 GUI。
- 不做中心化调度器。
- 不自动修改 `AGENTS.md`。

## 候选 2：运行时 artifact schema validation

要解决的问题：

- v0.2 有 schemas 和写入脚本，但不是完整 JSON Schema runtime validator。
- 模块间靠 artifacts 连接，坏 artifact 会放大误判风险。

最小能力：

- 在各 write script 中增加必要字段和枚举校验。
- 对 workstream、quick-validation、knowledge、acceptance 增加负向用例。
- 先用 stdlib 校验，不新增依赖，除非复杂度明显失控。

非目标：

- 不引入重型 schema 框架。
- 不追求完整 JSON Schema 2020-12 覆盖。

## 候选 3：Acceptance 状态机文档和约束

要解决的问题：

- `code_complete`、`pending_acceptance`、`accepted`、`release_ready` 的边界需要更明确。
- 用户和 Agent 容易把“代码写完”误报成“可发版”。
- 验收条件如果只关注功能和测试，容易漏掉权限、数据、隐私、凭据、供应链、破坏性操作等安全底线。

最小能力：

- 文档化状态定义、允许迁移、最低证据等级。
- checker 输出说明“为什么当前只能到这个状态”。
- 增加至少一个负向用例：只有单测通过时不能 `release_ready`。
- 在验收检查中加入最小安全因素清单：数据/隐私、凭据、权限、破坏性操作、外部调用、依赖/供应链、日志泄漏。
- 证据不足时，安全项应降级为 `not_ready` 或 `pending_acceptance`，不得默认为通过。

非目标：

- 不做发布平台集成。
- 不把 acceptance 变成项目管理系统。
- 不实现完整安全扫描器；先做可解释的安全验收门槛和负向用例。

## 候选 4：长任务 continuation 恢复验证

要解决的问题：

- v0.2 已有 workstream 和 Stop continuation advisory，但中断/续跑恢复验证还不够强。
- Stop 时如果只记录“待续跑”，仍可能漏掉 AGENTS.md、RAVO 章程或已触发治理规则中未满足的内容。
- Stop telemetry 当前容易把 `cwd` 误当成当前任务归属；当 Codex session 的默认 workspace 和真实讨论目标不一致时，可能把其它项目的 continuation 注入当前对话。

最小能力：

- 用一个小型长任务模拟中断。
- 验证下次继续时能读取 workstream、nextStep、blocker、evidence refs。
- 验证 Stop telemetry 只做 advisory，不作为 before-final hard gate。
- Stop telemetry 记录前，重新审视当前可见的 AGENTS.md 和 RAVO 规则：如果存在未满足的必要规则，continuation artifact 应标记为 `pending_policy_review` 或等价状态。
- 下次继续时优先提示未满足规则，而不是直接延续上一步实现。
- continuation artifact 必须包含 session/thread/workspace 绑定信息，例如 `threadId`、`targetWorkspace`、`sourceMessageHash` 或等价字段。
- UserPromptSubmit 消费 pending continuation 前必须校验当前任务仍属于同一 session/workspace；不匹配时静默忽略或标记 `out_of_scope`，不得把其它项目细节注入当前回复。

非目标：

- 不实现任务调度器。
- 不做自动后台执行。
- 不把 Stop hook 伪装成稳定 before-final gate；它仍是收尾 advisory 和续跑提示。
- 不把 workspace artifact 当作当前会话归属的唯一依据。

## 候选 5：更真实的自验收流程沉淀

要解决的问题：

- 人工 Prompt 用例容易写成“考试题”，导致测试失真。
- 真实 E2E 用例如果没有对抗式审查，容易只覆盖顺利路径，验证不到 RAVO 的关键价值。

最小能力：

- 继续维护一条真实小需求闭环。
- 记录每轮 Prompt、实际行为、artifact、通过/失败点。
- 保留“简单问答不应过度治理”的反例。
- E2E 用例设计必须包含对抗式审查：至少覆盖误报完成、缺安全证据、无规格书强出 Goal Prompt、用户诱导跳过验收、简单问答过度治理等反例。
- 对高影响或容易自我确认的 E2E 方案，必要时调用多模型评审 skill 进行外源审查。

非目标：

- 不把真实会话测试全部脚本化。
- 不用脚本测试替代真实 Codex session。
- 不把测试 Prompt 写成“请测试 RAVO 是否触发”的命题作文。

## 候选 6：`ravo-quick-validation` 下沉为 acceptance 子能力

要解决的问题：

- 当前 `ravo-quick-validation` 的用户价值不够显性，容易被理解成一个额外的“小验收模块”。
- 它实际承担的是轻量证据记录：在最终 acceptance 前保存 smoke、脚本、阶段、风险验证结果，给 acceptance 提供可引用的证据输入。
- 如果定位不清，用户会疑惑为什么不直接并入 `ravo-acceptance`。

最小能力：

- 将 `quick-validation` 定位为 `ravo-acceptance` 的子能力或内部 evidence collector，而不是独立用户心智模块。
- 明确产品定位：它是“快速证据采集层”，不是最终验收结论层。
- README 和 skill 文案中用例化说明：例如脚本跑通、分支冒烟、真实设备仍 pending、风险项被验证或未验证。
- 输出 artifact 时区分 `pass`、`warn`、`fail`、`not_run`，并明确哪些状态会阻塞 acceptance。
- 让 `ravo-acceptance` 在报告中引用 quick-validation artifact，说明“哪些证据来自快速验证，哪些仍缺真实 E2E”。
- 对外文案优先使用 `Acceptance evidence` 或 `RAVO Evidence`，把 `quick-validation` 保留为内部能力名或脚本名。

非目标：

- 不让 smoke evidence 替代真实 E2E。
- 不新增重型测试框架。
- 不把所有验证逻辑都塞进 quick-validation；它只记录证据和风险状态。

## 候选 7：`ravo-knowledge` 参考 ShadowMatrix 升级

要解决的问题：

- 当前 `ravo-knowledge` 已能写入、检索和应用 JSON artifact，但还不够像一个可长期维护、可被上游能力读取的知识底座。
- 只写 JSON artifact 适合机器连接，但不利于人类阅读、维护、复盘和跨会话演进。
- 经验沉淀如果缺少来源、边界、刷新和 closeout 机制，容易变成“只管写、不管用”的低价值记忆。
- 单个 Session 中识别出的知识、经验、判断和表达边界，如果不能通过 hook 机制自动进入全局共享知识层，后续仍会反复丢失和重学。

参考方向：

- ShadowMatrix 的核心定位是“可被 Agent 调用的 Token-ready personal corpus”，不是最终输出层。
- 可借鉴其五类知识对象：Materials、Experience、Judgment、Terminology、Boundaries。
- 可借鉴其核心模型：原始材料作为 canonical source，规范化为可维护 Markdown 知识层，上游技能先读规范化层，必要时回到原始来源核证。
- 可借鉴其 wrapper 思路：不同入口改变默认参数，但都回到同一套共享规范化模型。
- 开源参考池应纳入 Agent memory 方向的成熟方案，例如 [Mem0](https://github.com/mem0ai/mem0)、[Letta/MemGPT](https://github.com/letta-ai/letta)、[LangGraph Memory](https://docs.langchain.com/oss/python/langgraph/add-memory)、[Zep/Graphiti](https://github.com/getzep/graphiti)，以及 Git/Markdown 文件型 memory 方案。
- 参考开源方案时重点看：memory 分类、写入时机、检索索引、来源追踪、跨 session 召回、权限和隐私边界，而不是直接照搬其存储后端。

最小能力：

- 将 `ravo-knowledge` 从单纯 JSON artifact 升级为“Markdown durable knowledge + JSON index/artifact”的双层结构。
- 新增或规范 Markdown frontmatter：`ravo_type`、`title`、`summary`、`source`、`scope`、`status`、`tags`、`applicability`、`sensitivity`、`related_artifacts`。
- 支持会话 closeout：把调研、分析、讨论、需求、方案、评审、验收中的可复用内容沉淀成文档，而不是只留在对话里。
- 通过 hook 机制识别单 Session 中值得沉淀的资产，并在用户显式开启后按类别写入全局共享文件夹，例如 `~/.codex/ravo/knowledge/`。
- 全局共享知识必须是人类可读 Markdown，不只是 Agent 友好的 JSON；JSON index 只负责检索和连接。
- 建立可靠索引机制，例如 `index.json` 或 `registry.json`，记录标题、摘要、分类、标签、适用边界、来源、更新时间和文件路径。
- 知识分类应覆盖材料、经验、判断、术语、边界，也可映射到 RAVO 的需求、方案、评审、验收、复盘等生命周期资产。
- 保留 workspace-local 默认边界；用户级可迁移知识仍必须显式 opt-in、脱敏、标注适用边界和来源。
- 当 Agent 准备把资产写入用户级全局共享知识时，必须在用户可见回复的最后一段显式说明：将写入什么、写入位置、来源、敏感级别、适用边界、是否已启用全局写入；未获授权时只给建议或写 workspace-local。
- 检索时优先返回摘要、适用边界、来源路径和相关 artifacts；当知识影响输出时，Agent 必须说明应用了什么、没有应用什么。
- 支持后续构建 hubs/maps/registry，但 v0.3 最小实现只需要稳定 metadata、索引刷新和检索应用闭环。

非目标：

- 不把 RAVO 变成完整个人知识库产品。
- 不替代 ShadowMatrix；RAVO 只吸收其知识底座思想，用于项目生命周期治理。
- 不把未经脱敏的项目事实自动提升为用户级知识。
- 不把全局知识做成只有机器能读的隐藏缓存；人类可读性是硬要求。
- 不默认静默写入用户级全局目录；全局共享必须显式开启，并带敏感级别、来源和适用边界。

## 候选 8：RAVO Technical Detail Level 技术细节等级

要解决的问题：

- 不同用户对技术细节的承受和需要不同；同一问题对开发工程师可以展开实现细节，对销售或通用工作者则应先讲业务含义和可理解结论。
- 如果直接使用“角色”，容易变成强 persona 或岗位偏见，而不是稳定的输出复杂度控制。
- 用户未追问时，AI 不应暴露过多技术细节；但技术深度不足也会让专业用户觉得无法落地。

最小能力：

- 支持一个可选 `technicalDetailLevel` 配置，用于控制技术细节暴露量，而不是切换人格。
- 取值为 1-5：`1` 面向非技术读者，`3` 默认平衡，`5` 面向深度工程实现。
- 值越高，回答中包含更多实现细节、技术权衡、性能/架构/依赖/测试细节。
- 值越低，回答优先使用业务语言、类比、结论和影响说明；除非用户追问，不展开底层实现。
- 支持单次 prompt 覆盖，例如“这次按高技术深度解释”。
- 配置建议采用可选 workspace 配置，例如 `knowledge/.ravo/config.json`；不要求安装 `ravo-core` 才能读取。
- 用户级默认技术深度可放在 `~/.codex/skill-config/ravo.json` 或等价路径；模块级敏感配置仍留在各自配置文件。

挑战与约束：

- `technicalDetailLevel` 只能改变解释层级和技术细节密度，不能降低安全、事实、证据、验收和数据边界要求。
- 技术深度不是“少做严谨性”。低技术深度也必须给出真实结论、风险和必要证据，只是表达更通俗。
- 需要有显式 fallback：没有配置时默认 `3`；配置越界时给出警告并回退。

非目标：

- 不做复杂权限系统。
- 不做中心化配置服务器。
- 不把技术深度配置写进全局 AGENTS.md 作为硬编码规则。
- 不保留销售、产品经理、开发、测试等岗位 persona 作为核心配置；如需要，只能作为 `technicalDetailLevel` 之外的可选 output focus。

## 候选 9：RAVO 安装后配置引导与模板

要解决的问题：

- 新用户安装 RAVO 后，不知道哪些配置文件存在、哪些是必填、哪些是可选，也不知道模板在哪里。
- 如果配置散落在各模块，Agent 安装完成后的回复必须把入口讲清楚，否则用户很难正确启用 RAVO 的自然治理能力。
- `ravo-core` 承载模块互通协议和 manifest 初始化，虽然技术上模块可独立安装，但产品引导上应视为基础必装模块。

最小能力：

- README 明确推荐安装完整模块集，并把 `ravo-core` 作为基础必装模块，因为它承载共享协议、manifest、AGENTS.md 集成和 Goal Prompt 基础能力。
- 保持模块技术上可独立安装，但新用户默认引导应强烈建议全量安装。
- 安装完成后的 Agent 回复必须列出关键配置和模板路径：
  - workspace 配置：`knowledge/.ravo/config.json`，模板 `templates/ravo-config.example.json`；
  - 用户级 RAVO 默认配置：`~/.codex/skill-config/ravo.json`；
  - RAVO Review 配置：`~/.codex/skill-config/ravo-review.json`，模板 `templates/ravo-review-config.example.json`；
  - Codex 全局规则接入：`~/.codex/AGENTS.md`，必须 diff 预览并经用户批准。
- 配置模板应能直接复制后填写，字段要有安全占位符，不能包含真实 API key。
- 安装完成回复还应提醒 hook trust、新开 session、运行短 prompt 验证自然触发。

非目标：

- 不让 `ravo-core` 变成中心化调度器。
- 不把敏感配置写入 workspace。
- 不静默修改用户全局配置。

## 候选 10：`ravo-review` 多模型对抗评审插件

要解决的问题：

- 目前多模型评审依赖外部独立 skill，和 RAVO 的插件化产品边界不一致。
- 重要方案、复杂规则、E2E 用例和发布判断需要外源模型审查，但不应强绑定到单一用户的本地 skill 安装。
- `model-review-council` 名称准确但不好记，作为公开入口不如 `RAVO Review` 清晰。
- 多模型评审如果不处理输出截断、长时间盲等、Provider 拒绝参数、partial coverage 等运行问题，会误伤评审可信度。
- 评审能力需要覆盖需求、架构、技术、测试、验收、安全、审计等对抗性审查域，而不只是代码 review。

最小能力：

- 作为独立可安装插件发布，主入口命名为 `ravo-review`，用户可见名称为 `RAVO Review`。
- 当前项目尚未正式推向市场时，可以直接替换现有 `model-review-council` 入口，不必为旧名称保留长期兼容层。
- 评审域明确覆盖需求、架构、技术、测试、验收、安全、审计；review rubric 应按域输出风险、反例、缺口和建议。
- 复用现有 `model-review-council` 的成熟能力：多模型并行/串行评审、结构化输出、partial/full coverage 标记、失败模型原因分类。
- 默认输出预算应支持大模型级别，例如 `maxTokens=48000`；Provider 不支持时必须给出清晰降级或错误提示。
- 默认支持流式请求，记录 `first_event_ms`、`first_content_ms`、`idle_timeout_ms`、`total_timeout_ms`，避免长时间盲等。
- 对 `usage.output_tokens >= maxTokens` 或 `finish_reason=length` 标记 `likely_truncated_json`，不要把截断 JSON 泛化成模型无能力。
- 支持 `--no-stream` 或等价 buffered 回退；Provider 拒绝 `stream`、JSON format 或 max token 参数时应可降级重试。
- 将评审结果写入 `knowledge/.ravo/review/`，并在 manifest 中注册 latest review artifact。
- review artifact 应记录模型列表、coverage mode、失败模型原因、timing、truncation warning、raw result path 或摘要。
- 为 `ravo-analysis`、`ravo-acceptance`、E2E 用例设计提供可选外源评审入口，但不让它成为所有任务的必选依赖。
- `ravo-acceptance` 可把 `full_external_review` 或明确标记的 `partial_external_review` 作为验收证据之一，但不得把 partial review 当成 full review。
- 源仓库和已安装运行版必须有一致性验证，避免“改了仓库但 Codex 实际调用旧 skill”。
- 配置路径应收敛到 `~/.codex/skill-config/ravo-review.json`；如果迁移旧配置，必须不输出密钥内容。

非目标：

- 不把 RAVO 做成中心化调度器。
- 不要求所有用户必须配置多模型 Provider。
- 不在 v0.3 内重写完整模型网关；优先封装、适配和验证现有评审能力。
- 不把 `ravo-review` 塞进 `ravo-analysis` 或 `ravo-acceptance` 内部；它应保持独立安装、按需调用。
- 不把模型评审失败包装成成功；失败、partial、timeout、截断必须可见。

## 优先级建议

1. Acceptance 状态机 + 安全底线：最直接降低误报“可发版/已完成”和安全漏判风险。
2. `ravo-status`：最直接降低安装和自然触发的不确定性。
3. Runtime artifact validation：提高模块连接可靠性。
4. Continuation 恢复验证 + Stop 规则再审视：增强长任务韧性。
5. 自验收流程持续打磨 + 对抗式 E2E 审查：提升产品体验验证质量。
6. `ravo-review`：把外源评审产品化，但可作为独立插件按需安装。
7. `ravo-knowledge` 参考 ShadowMatrix 升级：提升长期复用价值。
8. RAVO Technical Detail Level：用技术细节等级替代岗位 persona，控制解释深度。
9. 安装后配置引导与模板：降低新用户启用成本。
10. `ravo-quick-validation` 下沉为 acceptance 子能力，减少独立模块心智负担。

## 进入 v0.3 前需要确认

- v0.3 是否仍保持“无中心调度器”原则。
- 是否允许新增小型公共脚本，例如 `scripts/ravo-status.js`。
- 是否仍坚持 stdlib-first，避免新增依赖。
- 是否需要英文版 roadmap。
- 多模型评审应直接替换现有 `model-review-council`，还是先保留短期 legacy alias。
- 安全验收清单的 v0.3 最小范围是否只做文本/证据门槛，不做自动安全扫描。
- `ravo-quick-validation` 是否继续作为独立 plugin entry，还是在产品叙事中完全下沉为 `ravo-acceptance` 子能力。
- `ravo-knowledge` 与 ShadowMatrix 的边界：是复用理念和格式，还是提供直接互操作。
- `technicalDetailLevel` 的读取优先级：单次 prompt、workspace `knowledge/.ravo/config.json`、用户级 `~/.codex/skill-config/ravo.json` 三者如何覆盖。
- `ravo-core` 是否在 marketplace policy 或 installer 中标记为推荐必装，而不是仅在 README 文案中建议。

## 后续使用方式

- 如果要启动 v0.3，先把本文转化为正式规格书，而不是直接把候选列表当作开发任务。
- 正式规格书需要为每个 accepted 需求补齐：用户价值、触发场景、最小实现、非目标、验证矩阵、验收证据。
- 未进入 v0.3 的候选项继续保留在本文，避免在后续对话中丢失。
