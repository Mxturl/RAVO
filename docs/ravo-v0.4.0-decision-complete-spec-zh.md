# RAVO v0.4.0 版本规格书

日期：2026-07-09

状态：decision-complete for development planning

来源：

- `docs/ravo-review-v0.4.0-multi-round-spec-zh.md`
- `docs/ravo-product-requirements-vs-implementation-zh.md`
- `docs/ravo-v0.3.1-completion-patch-spec.md`
- `docs/ravo-v0.3.1-e2e-results-zh.md`
- `docs/ravo-v0.3.2-requirements-alignment-zh.md`
- 2026-07-09 关于 PM 验收清单、根因分析多模型评审、自然语言标题、全局知识复用、需求共创、用户盲区判断、Review 增强、长程协作、完成后下一步建议、Goal Prompt 缺失规格策略、Spec 模板和 Spec 持续维护的讨论

## 产品定义

RAVO v0.4.0 要把 v0.3.1 的“最小治理闭环”升级为“可被 PM 验收、可被多轮评审挑战、可复用跨项目经验的真实工作流”。

v0.3.1 已经解决了 Review 能真实调用 provider、Knowledge 能沉淀 workspace-local 经验、Acceptance 能按证据约束交付状态的问题。v0.4.0 不再继续扩展泛化治理框架，而是补齐当前明确暴露的产品差距：

- RAVO Review 的 `rounds=1|2|3` 不能只是重复调用模型，必须形成真实多轮评审编排。
- RAVO Analysis 对中高复杂需求不能只做一次性结构化分析，必须支持需求共创。
- RAVO Root Cause 不能只在明确“根因”词出现时才深挖，复杂根因还应引入多模型评审。
- RAVO Acceptance 不能只给脚本结果和 artifact 路径，必须生成 PM 可验收的证据清单。
- RAVO Knowledge 不能只检索项目内经验，在用户授权边界内也应检索全局可迁移经验。
- RAVO 可见输出标题必须跟随 Codex 与用户对话语言，不能把内部英文语义字段直接暴露给中文用户。
- `technicalDetailLevel` 不能只停留在 analysis hook 的 advisory，必须成为跨 RAVO 可见输出的技术细节控制。
- Goal 模式不能以“代码写完”作为完成条件，必须完成规格书内全部内容的验收，除非某些功能有明确阻塞记录。
- Goal Prompt 检测到缺少 decision-complete spec 时，不能只有固定阻断行为，必须支持可配置处理策略。
- Goal Prompt 生成前如果发现对齐草稿、候选需求或最近讨论内容晚于正式 spec 且未合并，必须拒绝直接生成可执行 Prompt，先更新 spec 或产出 spec delta。
- 自动生成或人工生成的 spec 不能只有自由文本，必须符合明确模板，确保 Goal Prompt 有稳定的唯一需求源。
- Spec 在项目推进中必须持续维护；如果新发现会改变里程碑范围、完成证据或验收标准的信息，必须更新原 spec 或记录待确认 delta。
- Codex 完成一个明确需求或阶段交付后，不能默认暗示项目已经整体完成，必须给用户一条简短、基于当前状态的下一步建议。
- 规格可以分批实施，但版本交付时必须完成全部 required 功能需求；实施分期只代表顺序，不代表可以把部分功能当作 v0.4.0 完成交付。

## 真实消费者

主要消费者是使用 Codex/RAVO 交付实际产品、插件、架构方案和 Agent 工作流的用户。他们需要的是可信结论，而不是“看起来执行了某个流程”的应答。

次要消费者是产品经理。他们需要看到需求预期、当前实现效果、真实响应、截图/录屏、数据变化、缺口和边界，才能判断是否可验收。

维护消费者是 RAVO 开发者。他们需要清楚知道每个模块的实现契约、artifact schema、回归测试和不允许越界的状态语言。

## 当前基线

### 已开发且可作为基线保留

- Review runner 可以读取 provider 配置，调用模型，写 review artifact，并记录 `full/partial/none/failure/timeout/truncation`。
- Review runner 已有浅层 `rounds` 支持：配置/CLI 可设置 `1|2|3`，默认 `2`，artifact 能写 `roundCoverage` 和 `second_round_coverage`。
- Knowledge 可写 workspace-local Markdown/JSON/index，并支持显式 opt-in 的用户级知识写入。
- Knowledge hook 会在中高复杂任务前提示检索 workspace-local knowledge。
- Acceptance 会读取 analysis、workstream、quick-validation、review、knowledge evidence，并按 evidence level 约束状态。
- Analysis/Root Cause 已有结构化输出契约和 artifact writer。
- 中文 root-cause/requirement prompt 的可见标题已改为自然中文标签，英文 prompt 保留英文标签。
- `technicalDetailLevel` 已有基础实现：`ravo-status` 能读取并校验 `1..5`，analysis hook 会注入 `plain-language/balanced/engineering-detail` 提示；但它目前只影响 analysis 类 advisory，不是全 RAVO 输出风格开关。

### 已开发但明确有差距

| 模块 | 已有能力 | 明确差距 | v0.4.0 处理 |
|---|---|---|---|
| Review | 可真实调用 provider；有浅层 `rounds` 和 `roundCoverage` | 后续轮次主要复用上一轮文本摘要；没有 challenge brief、issue ledger、三轮收敛、逐轮输入证明和预算语义 | 必须升级为真实多轮编排 |
| Analysis | 能输出目标、消费者、约束、事实、方案、挑战、验证 | 缺少 grill-me 式需求共创；没有“继续澄清/直接进入方案”选择 | 必须增加需求共创模式 |
| Root Cause | 能输出现象、近因、备选假设、机制根因、追问链、验证 | 触发范围偏窄；复杂根因仍主要靠单模型自证 | 必须扩大触发并接入多模型评审 |
| Acceptance | 能做证据门禁并降级状态语言 | 不会自动形成 PM 验收清单；不要求真实响应、截图/录屏、数据变化等 PM 证据 | 必须输出 PM 验收包 |
| Knowledge | 默认 workspace-local；用户级写入有 opt-in | 默认复用只看项目内经验；全局经验检索没有进入默认复杂任务路径 | 必须支持授权后的全局检索 |
| Knowledge closeout | 能写有内容的 knowledge artifact | “无价值则静默”主要依赖 Agent 表达纪律 | 必须增加价值门槛 |
| Language | 中文根因/需求标题已可本地化 | 其它公开输出仍可能暴露内部英文语义字段 | 必须加入回归保护 |
| Technical Detail | `technicalDetailLevel` 已在 status 与 analysis hook 生效 | 还不能稳定控制 Review、Acceptance、Knowledge、Goal Prompt 和最终汇报的技术细节密度 | 必须补成跨模块配置 |
| Goal Prompt | 已有 missing-spec 阻断和短 Prompt 生成 | 不识别“新讨论/对齐草稿已晚于正式 spec”的陈旧规格风险 | 必须增加 stale-spec guard |
| Workstream | 可记录 milestone、nextStep、blocker、evidenceRefs | 缺少 Roadmap Audit、worker evidence contract 和执行中维护 spec 的硬规则 | 必须加入长程协作协议 |

### 未开发功能

- Review 多轮 issue ledger、challenge brief、convergence brief 和 Codex provisional decisions。
- Review `--discussion-file` 作为 Round 2 人工 challenge brief 覆盖输入的正式语义。
- Review round-level input refs/hash、purpose、stop reason、timeout type、budget 和安全边界检查。
- Root Cause 复杂分析接入 RAVO Review 的机制。
- Requirement co-creation 的多轮澄清状态、用户选择和 artifact 状态。
- PM acceptance package generator。
- 全局知识 opt-in 检索、适用性/过期风险说明和跨项目误用防护。
- “没有高价值知识就不提示、不写 artifact”的 closeout 价值判断。
- 多模型评审超时重试；当前只有流式失败转 buffered 的 fallback，不是 timeout retry。
- 跨模块 `technicalDetailLevel` 输出策略。
- Goal 模式完成条件检查器：确认所有规格项、验证矩阵、PM 验收文档和真实 Codex Session E2E 都完成或有明确阻塞。
- Goal Prompt missing-spec 策略配置；当前固定为提醒生成 spec，不支持自动生成 spec 或内联需求 Goal Prompt。
- Goal Prompt stale-spec guard：发现未合并需求或较新的 alignment draft 时阻断可执行 Prompt。
- Spec 规格书模板与 decision-complete 检查；当前只有“是否存在文件”的轻量判断，没有模板级内容要求。
- Spec alignment draft 策略：生成正式 spec 前默认先生成需求对齐文档。
- Spec delta / spec maintenance：项目推进中发现范围、里程碑或验收证据变化时更新 spec。
- Roadmap Audit 和 worker evidence contract。
- 完成后下一步建议：根据当前状态、证据缺口和用户视角给出简短衔接动作。

## 范围决策

### v0.4.0 必须完成

1. RAVO Review 真实多轮编排。
2. 需求共创模式。
3. 根因分析强化与多模型评审。
4. PM 验收包。
5. 授权边界内的全局经验复用。
6. 知识沉淀价值门槛。
7. 自然语言可见标题回归保护。
8. 跨模块 `technicalDetailLevel`。
9. Goal 模式完成条件与真实 Codex Session E2E。
10. Goal Prompt 缺失规格策略配置。
11. Spec 规格书模板。
12. Goal Prompt stale-spec guard。
13. Spec 前置对齐文档策略。
14. Spec 持续维护和 spec delta。
15. 用户盲区判断与建议。
16. Roadmap Audit 与 worker evidence contract。
17. 完成后下一步建议。
18. README、README_ZH、skill 文档、配置模板、smoke-test、prompt-regression 和 installed plugin cache 同步。

### v0.4.0 明确不做

- 不做无限轮 review 或开放式模型辩论。
- 不做 GUI dashboard。
- 不做中心调度器。
- 不做完整 DLP 或自动安全扫描器。
- 不默认静默写入或读取用户级全局知识。
- 不把 Review 结论等同于 release readiness。
- 不要求普通小任务进入需求共创、根因分析或多模型评审。
- 不把 `technicalDetailLevel=1` 解释为降低严谨性、跳过证据或省略验收。
- 不把实施阶段拆分出的 batch 或 milestone 当作缩小后的版本交付范围。

## 假设与非目标

假设：

- Codex 可以创建 fresh session 或 subagent，并能返回可引用的 session/thread id。
- PM 验收文档可以作为 Markdown 正文或文件链接发送到对话框；如果对话框长度受限，必须发送摘要、路径和关键清单。
- 有 UI 的项目可能需要 Playwright、浏览器、截图工具或用户提供截图；无 UI 项目必须提供等价可复核证据。
- 多模型 provider 可能超时、截断、限流或部分失败；重试只能提高成功率，不能保证 full coverage。

非目标：

- 不用 RAVO 自动绕过用户授权、外部 provider 限流或 Codex 宿主限制。
- 不要求所有 E2E 都创建真实外部用户数据；但必须创建真实 Codex Session 来验证 RAVO 自身运行时行为。

## 触发规则

- 交付、完成、验收、发版、ready、go-live、done、已完成等结论触发 Acceptance，并要求 PM 验收文档。
- 完成一个明确需求、阶段交付或验收结论时，最终回复必须给一条简短下一步建议；简单问答、一次性命令输出或用户明确要求只输出结果时可跳过。
- 重要方案、根因、架构、Agent workflow、验收规则和安全边界触发 Review；复杂根因应尝试多模型评审。
- 中高复杂需求触发需求共创；用户明确选择直接进入方案时，记录假设和风险。
- 当“简单任务”与安全、权限、数据边界、发布或验收规则冲突时，高影响边界优先于简单任务反例。
- 中高复杂任务触发 Knowledge 检索；用户级全局检索只在显式启用后参与。
- Goal Prompt 缺失规格时按配置处理：默认根据上下文按 Spec 模板生成 spec；也可配置为先询问用户，或直接生成带需求内容的 Goal Prompt。
- Goal Prompt 生成前必须检查正式 spec 是否陈旧；若存在晚于 spec 的 alignment draft、candidate requirements、spec delta、TODO 或最近明确需求尚未合并，必须先更新 spec 或提示阻断原因，不得直接输出可执行 Prompt。

## 模块契约 / 模块规格

### 1. RAVO Review 多轮编排

详细子规格以 `docs/ravo-review-v0.4.0-multi-round-spec-zh.md` 为准。本总规格只约束跨模块验收口径。

Review 能力范围：

- 需求/方案 Review：挑战目标、真实消费者、场景、痛点、非目标和验收口径。
- 根因 Review：对复杂 RCA 的证据、备选假设和机制根因做独立复核。
- 路线图 Review：检查里程碑顺序、范围变化、证据变化和下一步是否仍正确。
- 证据 Review：检查“声称完成”和“实际证据”是否匹配。
- 用户盲区 Review：检查用户前提、边界、优先级、消费者假设和验收假设。
- Clean-room Review：高风险任务可用 fresh session/subagent 复核，降低同一上下文自证风险。

必须实现：

- `rounds` 支持 `1|2|3`，默认 `2`。
- `rounds=1`：只做独立评审。
- `rounds=2`：Round 1 独立评审，Round 2 基于 challenge brief 做挑战复审。
- `rounds=3`：Round 3 基于二轮 issue transitions 和 Codex provisional decisions 做收敛裁决。
- 自动生成 Round 2 challenge brief；`--discussion-file` 仅作为人工覆盖 brief，且只允许 `rounds>=2`。
- 建立 issue ledger，字段至少包含 id、title、category、severity、evidence、recommendation、sourceModelsByRound、status、codexDecision、codexDecisionReason、proposalChange、residualRisk。
- issue `status` 合法值：`open | challenged | accepted | partially_accepted | rejected | rebutted | resolved | residual | deferred`。
- `codexDecision` 合法值：`accept | partial | reject | defer | none`。
- 状态流转必须可测：Round 1 新 issue 默认为 `open`；Round 2 可转为 `challenged/rebutted/residual`；Codex provisional decision 写入 `codexDecision`；Round 3 后必须转为 `accepted/partially_accepted/rejected/resolved/residual/deferred` 之一。
- Codex provisional decision 必须由确定性 decision helper 生成：输入为 issue severity、evidence、reviewer recommendation、现有实现变更和用户约束；输出必须包含 decision、reason、confidence，不得只靠自由文本总结。
- artifact 增加 `roundsRequested`、`roundsExecuted`、`roundStopReason`、`roundPolicy=fixed`、`orchestrationVersion=multi-round-v1`、`roundCoverage[*].purpose`、`roundCoverage[*].inputHash`、`briefs`、`issueLedgerRef`、`issueStatusCounts`、`convergenceStatus`。
- 顶层 `coverage=full` 只能在所有请求轮次、请求模型都完成且无截断/超时/解析降级时出现。
- `roundsRequested=3` 但只执行 2 轮时，顶层 coverage 不能为 `full`。
- raw sidecar、命令输出和 artifact 不得泄漏 API key 或完整 provider header。
- 超时必须有 retry 机制：默认 `retry.maxAttempts=2`，只重试 timeout、429、502、503、504 和连接中断；不重试 400/401/403、数据边界阻断、解析成功但结论为 partial 的情况。
- 每次重试必须记录 `attempt`、`round`、`model`、`reason`、`delayMs`、`timeoutMs` 和最终结果。
- stream 失败转 buffered 只能算 fallback attempt，不等同于 timeout retry；artifact 要区分 `fallbackAttempt` 与 `retryAttempt`。

验收：

- fake provider 覆盖 `rounds=1/2/3`。
- prompt-capture 证明三轮输入不同。
- Round 2 prompt 包含 challenge brief 和该模型自己的 Round 1 结果，不包含其它模型完整 Round 1 原文。
- Round 3 prompt 包含 convergence brief、provisional decisions 和未解决 issue，不把原始 subject 当主要输入重放。

### 2. RAVO Analysis 需求共创

触发条件：

- 用户提出中高复杂需求、方案、架构、产品流、Agent workflow 或语义模型。
- 目标、消费者、场景、痛点、约束、验收方式不清楚。
- 用户明确说“先别开发”“先分析”“帮我想清楚”“不确定是否值得做”。

中高复杂度启发式：

- 跨模块、跨角色、跨数据边界或跨系统集成。
- 会影响验收口径、权限、安全、发布、长期维护或用户核心流程。
- 需求中存在未知消费者、未知约束、多个可行路径或明显取舍。
- 用户明确要求先分析、先判断、先做方案、先做规划。
- 自动触发的最低门槛：命中任一硬边界（安全、权限、数据、发布、验收）即触发；否则至少命中两个复杂度信号才触发共创。
- prompt-regression 必须覆盖“只命中一个弱信号不触发”和“安全/数据边界小改也触发”的反例/正例。

反例：

- 简单概念解释。
- 文案改写、重命名、单字段小修。
- 用户已经给出明确实现边界的小任务。
- 只要求执行一个确定命令。

用户体验：

- Agent 不直接进入方案或实现。
- Agent 先输出“需求共创”视图，至少包括：
  - 已知背景
  - 当前现状
  - 目标用户/真实消费者
  - 关键场景
  - 痛点或失败模式
  - 参考对象或对标方式
  - 约束与非目标
  - 待确认问题
  - 下一步选项：继续澄清 / 直接进入方案
- 待确认问题最多 3 个，必须是会改变方案判断的问题。
- 如果用户选择直接进入方案，Agent 可以继续，但必须显式列出假设和由此产生的验收风险。

Artifact：

- analysis artifact 增加或复用字段记录：
  - `analysisMode=requirement_co_creation`
  - `clarificationStatus=needs_user_input|assumptions_accepted|decision_ready`
  - `openQuestions`
  - `assumptions`
  - `coCreationDecision=continue_clarifying|direct_to_solution`

验收：

- 复杂需求 prompt 触发需求共创，而不是直接输出完整方案。
- 用户说“直接进入方案”后，回答包含假设和风险。
- 简单概念解释和小改动不触发共创。

### 2.1 用户盲区判断与建议

产品目标：

中高复杂需求分析不能只“挑战用户”或提示可能盲区，还要给出判断和建议，帮助用户决定是继续澄清、作为假设推进、降级为非目标，还是进入 Review。

触发条件：

- 需求共创、方案分析、路线图分析、PM 验收、根因分析或重要取舍中发现用户可能遗漏消费者、场景、风险、成本、证据、权限、安全、验收或优先级。
- 用户明确要求“挑战我”“grill me”“找盲区”“从 PM 角度看问题”。

输出要求：

- 每条盲区必须包含：盲区是什么、依据类型、影响判断、建议动作、是否需要更新 spec。
- `basis` 合法值：`fact | inference | assumption | needs_validation`。
- `impact` 合法值：`high | medium | low`。
- `suggestedAction` 合法值：`clarify | proceed_as_assumption | mark_out_of_scope | split_milestone | run_review | update_spec`。
- 不能用攻击性表达；目标是补齐判断，不是证明用户错。
- 如果盲区会改变范围、里程碑或完成证据，必须进入 spec delta 或直接更新 spec。

Artifact：

- analysis artifact 增加或复用 `blindSpotFindings`。
- 每条 finding 至少包含 `title`、`basis`、`impact`、`affectedArea`、`suggestedAction`、`specUpdateRequired`。

验收：

- 中高复杂需求分析输出至少一个“可能盲区 / 判断 / 建议动作”结构，除非明确无明显盲区并说明原因。
- 用户要求直接进入方案时，盲区可作为假设风险保留，但不能静默丢弃。
- 简单问答不强制输出盲区分析。

### 3. RAVO Root Cause 强化

触发条件：

- 明确根因、原因、为什么、反复、复发、防复发、事故、失败、挑战、不可解释现象。
- 用户描述“这可能只是表层原因”“继续追问为什么”“自证难度较大”。
- 验收、评审、实现或流程出现阻塞，且原因会影响后续决策。

输出要求：

- 可见标题跟随对话语言。中文使用：现象、近因、备选假设、机制根因、追问链、边界、最小修复、验证。
- 不能停在“提示词问题”“用户要求”“实现失误”“缺少检查”。
- 至少检验一个合理备选假设。
- 根因结论必须落到可验证、可防复发的机制。

复杂根因的多模型评审：

- 当根因分析影响架构、发布、验收、权限、数据安全、Agent 工作流或长期治理时，必须尝试 RAVO Review。
- “多模型评审”的目标下限是至少 2 个独立模型完成；如果可用完成模型少于 2 个，review evidence 只能记为 `partial` 或 `unavailable`。
- Review domain 使用 `root-cause` 或更具体 domain。
- Review subject 应是脱敏后的根因摘要、备选假设、证据和最小修复，不默认发送完整项目上下文。
- 如果 provider 未配置、超时、截断或 partial，必须标为降级证据，不能当作完整外部复核。
- Root Cause artifact 应引用 review artifact 路径或明确写 `reviewEvidence=unavailable|partial|full`。
- 当 RCA 只拿到 partial review evidence 时，Agent 可以给机制根因结论，但必须标明外部复核不足、剩余备选假设和最小补证路径。

验收：

- 普通“问题/挑战/失败”类 prompt 能自然进入 RCA。
- 高影响 RCA 会尝试 review 或明确说明未执行多模型评审及原因。
- prompt regression 覆盖中文自然标题。

### 4. RAVO Acceptance PM 验收包

产品目标：

Codex 发起交付、验收、完成、发版或 readiness 结论时，必须能给 PM 一份可操作验收包，而不是只列脚本通过。

用户可见提交要求：

- “面向产品经理的验收文档”是必须提交的产物，不能只写到 artifact。
- 最终对话框必须发送 PM 验收文档正文，或在长度受限时发送文档路径、验收结论摘要、完整 PM 验收清单和缺口清单。
- PM 验收文档必须面向产品经理，不得退化为开发者自测报告。

PM 验收包结构：

- 验收结论摘要。
- 需求预期与当前实现效果对比表。
- PM 验收清单。
- 真实响应证据。
- 截图/录屏证据；如果目标没有 UI，必须标注不适用并给出替代证据。
- API/CLI/数据变化/日志/产物路径等可复核证据。
- 未满足/部分满足项。
- 产品边界与后续建议。

每个验收项必须包含：

- 验收项名称。
- 需求预期。
- 当前实现方案。
- 当前实现效果。
- PM 验收方式。
- 必需证据。
- 验收判断：满足 / 基本满足 / 部分满足 / 不满足 / 待补证据。
- 产品边界与风险。

状态规则：

- 缺少真实运行证据时，不得写“已通过”。
- 只有脚本通过时，最多是 `code_complete` 或 `pending_acceptance`。
- `release_ready` 仍需要真实 E2E 或 full external review，加安全基线。

Artifact：

- acceptance artifact 增加或关联：
  - `pmChecklistRef`
  - `realResponseRefs`
  - `screenshotRefs`
  - `dataEvidenceRefs`
  - `acceptanceItems`
  - `unmetItems`
  - `notApplicableEvidence`

PM 验收文档文件：

- 默认写入 `docs/*pm-acceptance*.md` 或 `knowledge/.ravo/acceptance/*.md`。
- acceptance artifact 必须引用该文档路径。
- 对话最终回复必须引用同一路径，并发送核心清单。

截图/录屏来源契约：

- 如果 Codex 当前环境能运行 UI/E2E 工具，Agent 应主动生成截图/录屏并引用路径。
- 如果当前环境没有 UI 能力，Agent 不得卡死验收；应把截图标为 `not_applicable` 或 `user_provided_required`，并列出替代证据。
- 如果截图需要用户或外部系统提供，验收包必须把它标为输入型证据，而不是声称已经采集。
- UI/E2E 能力必须通过可记录的探测动作判断，例如检查 Playwright/浏览器可用性、尝试启动无头浏览器或读取目标运行地址；探测失败必须写入 artifact，不能静默降级。

验收：

- 对一个有 UI 的示例任务，输出包含真实响应和截图/录屏路径。
- 对一个无 UI 的 CLI 任务，截图标注不适用，并提供 CLI 输出/文件产物/JSON artifact 作为替代证据。
- 如果证据不足，验收判断必须是“待补证据”或更低状态。

### 5. RAVO Knowledge 全局经验复用与价值门槛

检索规则：

- 中高复杂任务默认检索 workspace-local knowledge。
- 如果用户级全局知识已显式启用，且任务不涉及敏感边界，额外检索用户级全局知识。
- 全局知识检索必须输出 scope、source、sensitivity、applicability、lastUsedAt 或等价时间信息。
- Agent 必须说明哪些知识被应用、哪些不适用、是否可能过期。

全局知识边界：

- 默认不读取、不写入用户级全局知识。
- 读取全局知识需要显式 opt-in 或配置启用。
- 写入全局知识仍需要 source、sensitivity、applicability、redaction/canary 检查。
- 跨项目经验只能作为参考，不能覆盖当前项目事实。
- v0.4.0 的脱敏实现级别是敏感词/路径/API key/canary 规则检查加 Agent 明示边界，不宣称完整 DLP。
- 全局知识写入 artifact 必须记录 redaction check 结果、canary check 结果和被移除/拒绝的敏感类别摘要。
- canary check 的最小定义：写入/外发前向待检查内容或测试样本中植入伪路径、伪 API key、伪客户标识等不可泄漏标记，并验证最终内容不包含这些标记。
- 默认回复不需要显式提醒“未写入用户级全局知识”。
- 只有实际写入或准备写入用户级全局知识时，才必须显式提醒“已写入用户级全局知识”或“将写入用户级全局知识”，并列出路径、source、sensitivity、applicability、opt-in 状态和脱敏结果。
- 如果用户明确询问全局知识状态，才回答是否未写入。

价值门槛：

- 只有出现可复用判断、原则、边界、失败机制、验收经验或产品决策时才写 knowledge。
- 如果没有实际复用价值，不写 artifact，也不必专门提示“没有知识沉淀”。
- 用户明确要求总结知识时，可以说明“未发现值得沉淀的可迁移经验”，但不应把它作为默认 closeout 文案。

验收：

- workspace knowledge 检索仍可用。
- 用户未启用全局知识时，不读取用户级目录。
- 用户启用全局知识时，检索结果区分 workspace 与 user scope。
- closeout 无价值时不写空 knowledge artifact。

### 6. 自然语言输出与标题

规则：

- RAVO hook/skill 注入的是语义字段，用户可见标题必须跟随对话语言。
- 中文对话不应出现 `Symptom`、`Proximate Cause`、`Goal`、`Consumer` 这类英文标题，除非用户明确要求英文或字段名本身是协议/代码。
- 英文对话仍可使用英文标题。
- 中英混合时，以用户主要表达语言为准；不确定时用用户最新消息语言。

验收：

- 中文 root-cause prompt 输出中文标题契约。
- 英文 root-cause prompt 输出英文标题契约。
- 中文 requirement prompt 输出中文标题契约。
- 简单问答不触发结构化标题。

### 7. Technical Detail Level

当前状态：

- `ravo-status` 已能读取 `technicalDetailLevel`，默认 `3`，非法值回退 `3` 并产生 warning。
- `ravo-analysis-gate` 已读取该配置并注入 `plain-language/balanced/engineering-detail`。
- 当前实现不足以保证 `technicalDetailLevel=1` 对 Review、Acceptance、Knowledge、Goal Prompt 和最终汇报都达到“少技术细节、更多产品语义”的预期。

v0.4.0 目标：

- `technicalDetailLevel` 成为跨 RAVO 可见输出配置，范围 `1..5`，默认 `3`。
- 配置优先级：单次 prompt override > workspace `knowledge/.ravo/config.json` > user `~/.codex/skill-config/ravo.json` > 默认值。
- level 1：面向非技术用户，优先讲产品效果、用户路径、验收方式和风险；隐藏内部脚本/字段名，除非它们是证据必要部分。
- level 3：平衡产品解释和工程证据。
- level 5：面向工程维护者，包含 artifact schema、脚本、配置、边界条件和失败机制。
- 任意 level 都不能降低事实准确性、安全边界、证据要求、验收标准或数据保护。

模块要求：

- Analysis/Root Cause：控制解释深度和标题语言，不改变推理完整性。
- Review：控制评审摘要的技术密度，但 artifact 仍保留完整机器可读字段。
- Acceptance：PM 文档默认按 level 1 到 3 的产品语言输出；证据附录可保留技术细节。
- Knowledge：默认不输出“未写入全局知识”；level 5 可在调试/用户询问时显示更完整的 scope/source 细节。
- Goal Prompt：默认始终短，技术细节留在规格书；只有 `missingSpecPolicy=inline_goal_prompt` 时允许把需求内容放进 Prompt。
- level 1 仍必须保留硬证据白名单：artifact 路径、退出码、fail/warn/pass 状态、缺失证据、阻塞原因、真实 Codex Session id、PM 验收文档路径。

验收：

- 设置 workspace `technicalDetailLevel=1` 后，中高复杂 analysis、PM 验收文档和最终汇报均显著减少内部实现细节。
- 设置 `technicalDetailLevel=5` 后，同一任务的证据附录包含更多 artifact/schema/script 信息。
- 非法值回退为 `3` 并提示 warning。
- level 1 下仍保留证据缺口和状态降级，不得把不确定结论说得更确定。

### 8. Goal 模式完成条件

Goal 模式执行 v0.4.0 时，完成条件不是“代码写完”或“三条脚本通过”。

实施分期规则：

- Spec 可以把实现拆成阶段、batch 或 milestone，便于长程执行和风险控制。
- 分期只代表执行顺序，不改变 v0.4.0 的版本验收范围。
- 因为写 spec 前已经完成了产品范围取舍，交付时必须完成本 spec 定义的全部 required 功能需求。
- 只有某个 required 功能存在明确阻塞，且记录了阻塞原因、影响范围、临时降级、恢复入口和 PM 可见风险时，才允许从“完成”口径中排除。
- 阶段完成只能说“阶段完成 / code_complete / pending_acceptance”，不得说 v0.4.0 已完成。

必须全部满足：

- `docs/ravo-v0.4.0-decision-complete-spec-zh.md` 中所有 required 内容完成。
- `docs/ravo-review-v0.4.0-multi-round-spec-zh.md` 中所有 required Review 内容完成。
- 验证矩阵全部通过，或逐项记录明确阻塞原因、影响范围、恢复入口和临时降级状态。
- RAVO acceptance artifact 指向 PM 验收文档。
- 最终对话框发送面向产品经理的验收文档核心内容。
- 最终对话框包含一条简短的下一步建议。
- 真实 Codex Session E2E 全部完成并记录 session/thread id。
- RAVO Review evidence、Knowledge evidence、Acceptance evidence 的状态与实际证据一致。

禁止：

- 只因代码实现、单元测试、smoke-test 或 prompt-regression 通过就声称完成。
- 只因某个实施阶段或 milestone 完成就声称 v0.4.0 完成。
- 把 fake provider E2E 当作真实多模型评审。
- 把未创建真实 Codex Session 的脚本测试当作运行时 E2E。
- 证据不足时说“已完成”“验收通过”“可发版”“已发布”。

### 9. Spec 规格书模板

产品目标：

Spec 是 Goal Prompt 的唯一需求源，必须让后续 Codex 能按同一套边界执行、验证和验收，而不是依赖上下文记忆或自由文本解释。

适用范围：

- `goalPrompt.missingSpecPolicy=auto_spec` 自动生成的 spec。
- 用户要求创建/补齐 decision-complete spec。
- 用于长程 Goal、复杂需求、架构、Agent workflow、验收或发布敏感任务的规格书。

模板章节：

1. 标题、日期、状态、来源。
2. 产品定义：目标、真实消费者、核心问题、成功结果。
3. 当前基线：已实现能力、已开发但有差距、未开发功能。
4. 范围决策：必须完成、明确不做。
5. 假设与非目标：事实、假设、外部依赖、不可自动完成的事项。
6. 触发规则：何时启用该能力，何时不启用。
7. 模块契约 / 功能规格：每个模块或功能单独成节。
8. 数据边界与安全：外发、凭据、隐私、权限、日志、全局知识边界。
9. 验证矩阵：领域、场景、期望结果。
10. 实施计划：阶段、最小闭环、回归点。
11. 发布口径：允许说什么、禁止说什么。
12. PM 验收要求：PM 如何验收、必须证据、缺口处理。
13. 下一步建议规则：完成阶段后的用户衔接动作。

每个模块 / 功能规格必须包含：

- 产品目标。
- 触发条件。
- 需求预期。
- 当前实现或当前基线。
- 目标实现方案。
- 必须实现。
- 明确不做。
- artifact / 配置 / schema 变化；无变化时写“不涉及”。
- 验收方式。
- 回归测试。
- 风险与降级状态。

decision-complete 判定：

- 必须章节齐全；不适用章节要写“不适用”和原因。
- 必须区分事实、假设、推断和待确认项。
- 必须包含验证矩阵和 PM 验收要求。
- 必须能作为 Goal Prompt 的唯一需求源，Prompt 中不需要重复需求细节。
- 缺少消费者、范围、验收方式、数据边界或阻塞处理时，不得标为 decision-complete。

验收：

- `auto_spec` 生成的 spec 符合模板章节。
- 缺少必填章节时，Goal Prompt checker 返回缺失字段，不输出引用该 spec 的可运行 Goal Prompt。
- 复杂需求的 spec 至少包含一个模块契约和验证矩阵。
- 简单任务不强制生成完整 spec。

### 9.1 Spec 前置对齐文档策略

产品目标：

正式 Spec 前可以先生成需求对齐文档，帮助用户确认方向、边界、优先级和待确认问题。对齐文档不是 decision-complete Spec，也不能作为 Goal Prompt 的唯一需求源。

配置项：

- `spec.alignmentDraftPolicy`
- 合法值：`required | skip | auto`
- 默认值：`required`

策略语义：

- `required`：生成正式 Spec 前必须先生成对齐文档；用户确认或配置允许自动继续后，再生成正式 Spec。
- `skip`：不生成对齐文档，直接生成或更新 Spec。适用于用户已给出完整边界、任务很小或用户明确要求跳过。
- `auto`：中高复杂、跨模块、发布/验收敏感、需求仍在收敛时生成；简单修复或已有完整 Spec 时跳过。

对齐文档至少包含：

- 当前目标和真实消费者。
- 已确认需求。
- 待确认问题。
- 明确不做。
- 关键风险和用户可能盲区。
- Review、Acceptance、Knowledge、Goal/Spec 相关要求。
- 初步优先级建议。
- 是否建议进入正式 Spec。

验收：

- 默认配置下，中高复杂需求在正式 Spec 前生成 alignment draft。
- alignment draft 晚于正式 Spec 且存在未合并需求时，Goal Prompt stale-spec guard 必须阻断可执行 Prompt。
- 用户明确要求跳过时，系统可直接生成 Spec，但必须记录跳过原因。

### 9.2 Spec 持续维护与 Delta

产品目标：

Spec 不是一次性文档。Codex 在实现、评审、验收和长程 Goal 执行中发现范围、里程碑、完成证据、验收标准、数据边界或发布口径变化时，必须维护原 Spec，避免后续执行仍引用过期需求。

必须维护的变化类型：

- 新发现会改变 required 功能范围。
- 某个里程碑需要拆分、合并、前置或后置。
- 完成所需证据从脚本证据升级为真实响应、截图、数据变化或真实 Codex Session E2E。
- PM 验收清单、release readiness、数据边界、安全基线发生变化。
- Review、RCA 或 E2E 发现必须新增的阻塞项、风险项或非目标。

处理规则：

- 小的确定性修正可以直接更新 Spec，并在最终回复说明变更。
- 会改变范围、成本、交付时间或验收口径的变化，应先产出 `spec delta`，说明原因、影响、建议和是否需要用户确认。
- 未确认的 delta 不能偷偷进入 Goal Prompt 作为新需求。
- 如果 delta 未合并，Goal Prompt 只能引用旧 Spec 并明确排除 delta，或阻断并要求先合并。

Artifact / 文件：

- 推荐写入 `docs/*spec-delta*.md` 或 `knowledge/.ravo/analysis/*spec-delta*.json`。
- delta 至少包含 `source`、`affectedSpec`、`changeType`、`impact`、`recommendedAction`、`requiresUserConfirmation`。

验收：

- 实现中发现验收证据变化时，Spec 或 delta 被更新。
- 未合并 delta 存在时，不输出包含 delta 内容的可执行 Goal Prompt。
- PM 验收文档能引用最终 Spec 版本和未合并 delta 状态。

### 10. Goal Prompt 缺失规格策略

产品目标：

用户要求生成 Goal Prompt 但当前没有 decision-complete spec 时，RAVO 应能按用户偏好继续推进，而不是只有固定的“请先生成 spec”阻断。

配置项：

- `goalPrompt.missingSpecPolicy`
- 合法值：`auto_spec | ask_to_generate_spec | inline_goal_prompt`
- 默认值：`auto_spec`

策略语义：

- `auto_spec`：默认策略。根据当前对话和仓库上下文按 Spec 模板直接生成 decision-complete spec；生成后重新检查 spec。如果检查通过，再输出引用该 spec 的短 Goal Prompt；如果上下文仍不足以形成 decision-complete spec，则返回 spec 草稿路径、缺失字段和下一步建议，不输出可运行 Goal Prompt。
- `ask_to_generate_spec`：保留当前保守行为。检测到缺 spec 时提醒用户是否生成 spec，不输出可运行 Goal Prompt。
- `inline_goal_prompt`：直接生成带需求内容的 Goal Prompt，不依赖 spec。该模式必须在输出中标注 `specMode=inline_prompt`，并提示它不适合高风险、长周期、发版敏感或需要验收证据的任务。

边界：

- `auto_spec` 生成的 spec 必须区分事实、假设、缺口和验收条件。
- `auto_spec` 生成的 spec 必须符合 Spec 模板和 decision-complete 判定。
- `auto_spec` 不得把缺失事实伪装成已确认需求。
- `inline_goal_prompt` 是显式配置的降级/快捷模式，不得作为默认。
- 高风险、权限、安全、数据边界、发布或验收敏感任务即使配置为 `inline_goal_prompt`，也必须提示建议改用 spec。

验收：

- 无 spec 且默认配置时，系统生成 spec，并在通过检查后输出引用 spec 的短 Goal Prompt。
- 无 spec 且配置为 `ask_to_generate_spec` 时，只询问是否生成 spec，不输出可运行 Goal Prompt。
- 无 spec 且配置为 `inline_goal_prompt` 时，输出带需求内容的 Goal Prompt，并明确标注 `specMode=inline_prompt` 和适用风险。
- 上下文不足时，`auto_spec` 不得输出可运行 Goal Prompt，只返回 spec 草稿、缺失字段和下一步建议。

### 10.1 Goal Prompt Stale-Spec Guard

产品目标：

Goal Prompt 不能只检查“有没有 spec”，还必须检查“spec 是否仍是最新需求源”。如果用户最近讨论了新需求、对齐文档或 delta，但尚未合并到正式 spec，Codex 应拒绝直接生成可执行 Goal Prompt。

触发条件：

- 用户要求“给我 Goal Prompt / 生成执行 Prompt / 启动 Goal 模式”。
- 当前存在 decision-complete spec，但同时存在更新的 alignment draft、candidate requirements、spec delta、TODO、最近对话明确需求或 review 结论，且这些内容可能改变范围、里程碑、完成证据、验收标准、数据边界或发布口径。

判断规则：

- 优先使用用户显式指定的 spec 路径。
- 如果有多个 spec，优先目标版本匹配、状态为 decision-complete、最近明确被用户确认的 spec。
- 对齐草稿、候选需求、会议记录、TODO、review 结论只能作为新输入，不能替代正式 spec。
- 发现未合并输入时，必须输出阻断原因和建议动作：更新 spec、生成 spec delta、确认忽略该输入，或在极低风险场景下显式使用 `inline_goal_prompt`。

禁止：

- 为了满足用户“给我 Goal Prompt”的直接请求，绕过陈旧规格检查。
- 把新讨论内容塞进 Goal Prompt，同时仍声称 spec 是唯一需求源。
- 把 alignment draft 当作正式 spec。

验收：

- 存在比正式 spec 更新的 alignment draft 且含未合并需求时，不输出可执行 Goal Prompt。
- 用户确认把新需求合并入 spec 后，重新检查通过才输出短 Goal Prompt。
- 用户明确要求忽略某个候选需求时，Goal Prompt 可以生成，但必须在输出中说明该候选需求不在本次执行范围。

### 11. 完成后的下一步建议

产品目标：

用户在多个项目之间切换时，Codex 完成一个需求后应帮助用户快速衔接下一步，但不能把子需求完成包装成项目整体完成。

必须实现：

- 最终回复在完成明确需求、阶段交付、验收发起或 Goal closeout 时包含一条 `下一步建议：...`。
- 下一步建议必须基于当前状态、证据缺口、用户视角和规格边界推断。
- 证据不足时，建议应指向补证据、真实 E2E、PM 验收、实现剩余项或阻塞处理，而不是发版。
- 规格补完但实现未开始时，建议应指向启动实现或创建执行 session。
- 功能实现但缺真实 E2E 时，建议应指向补真实 Codex Session E2E 或 PM 验收证据。
- 简单问答、一次性命令输出、用户明确要求不要扩展或只输出结果时，可以跳过下一步建议。

禁止：

- 使用“如需继续请告诉我”这类无项目状态信息的空泛建议。
- 暗示整个项目已经完成，除非所有规格、验证矩阵、验收和阻塞记录都满足完成条件。
- 把下一步建议变成新的需求、长规划或默认追加工作范围。

验收：

- 规格补完但实现未开始时，最终回复给出启动实现/验收 session 的建议。
- 功能实现但缺真实 E2E 时，最终回复给出补真实 E2E/PM 验收证据的建议。
- 简单问答或用户明确要求只回答时，不强制追加下一步建议。

### 12. 长程协作、Roadmap Audit 与 Worker Evidence Contract

产品目标：

RAVO v0.4.0 要支持 Codex 连续推进较大项目时不丢失方向：一次只激活一个 Goal，主线程负责协调和验收，worker/subagent 负责具体实现或调查，每个里程碑后重新审视路线图和 Spec。

长程协作规则：

- 一次只激活一个 Goal；并行任务必须有清晰边界、输入、输出和证据要求。
- 主线程不把 worker 返回当作验收结论；worker evidence 只是证据输入。
- 本机测试必须在本机执行并记录；远程 worker 或 subagent 不能冒充本机 E2E。
- 进度汇报优先使用：`已完成 / 下一步 / 阻塞`，避免长篇上下文倾倒。
- Dashboard 不属于 RAVO v0.4.0；相关规划归外部 `Wanted` 项目。

Roadmap Audit：

- 每个 milestone 结束后必须检查当前路线图是否仍正确。
- 检查项至少包括：已完成范围、剩余 required 项、阻塞、风险、证据缺口、Spec delta、是否继续下一 milestone。
- 如果审计发现范围或证据变化，必须更新 Spec 或产出 delta，不能只在对话里说明。

Worker evidence contract：

- 做了什么。
- 改了什么。
- 学到了什么。
- 证据是什么。
- 阻塞是什么。
- 下一步建议是什么。

验收：

- 长程 Goal 的每个 milestone 后都有 Roadmap Audit 记录或 PM 可见摘要。
- worker/subagent 返回内容符合 evidence contract，并可被 Acceptance 或 PM 验收文档引用。
- 真实 Codex Session E2E 记录 session/thread id、prompt、真实响应摘要、artifact 路径和 pass/fail。

## 数据边界

所有涉及外部模型、多模型评审或全局知识的路径必须先做数据边界检查：

- credentials、secret、API key、customer data、private personal data 默认不得外发。
- review subject、challenge brief、convergence brief、root-cause summary 都必须尽量摘要化，不默认复制完整敏感上下文。
- raw sidecar 不得包含密钥。
- 命令输出不得打印密钥。
- 用户级全局知识不得包含项目私有路径、客户事实、秘密、canary 或未脱敏原文。

## 验证矩阵

| 领域 | 场景 | 期望 |
|---|---|---|
| Review | 默认配置 | `roundsRequested=2`，有 challenge brief 和 Round 2 purpose |
| Review | `--rounds 1` | 只执行独立评审，`convergenceStatus=not_requested` |
| Review | `--rounds 2` | 生成或读取 challenge brief，Round 2 为挑战复审 |
| Review | `--rounds 3` | 生成 convergence brief，Round 3 为收敛裁决 |
| Review | `--discussion-file` + `--rounds 1` | 失败并提示需要 `rounds>=2` |
| Review | provider 未配置 | `coverage=none`，不伪造 review |
| Review | Round 2/3 部分失败 | 顶层 `coverage=partial`，保留已完成轮次 |
| Review | timeout retry | timeout/429/5xx 至少按策略重试，attempts 写入 artifact |
| Review | raw sidecar | 不包含 API key |
| Analysis | 中高复杂需求 | 进入需求共创，最多 3 个关键问题，提供继续澄清/直接进入方案 |
| Analysis | 用户直接进入方案 | 输出假设和验收风险 |
| Analysis | 用户盲区 | 输出盲区、依据、影响判断、建议动作和是否更新 spec |
| RCA | 普通问题/挑战 | 进入完整 RCA，而不是只给建议 |
| RCA | 高影响根因 | 尝试多模型评审或明确标注未执行 |
| RCA | 中文 prompt | 可见标题为自然中文 |
| Acceptance | 有 UI 任务 | PM 验收包包含真实响应和截图/录屏证据 |
| Acceptance | 无 UI 任务 | 截图标注不适用，提供替代可复核证据 |
| Acceptance | 证据不足 | 标记待补证据，不写验收通过或 release_ready |
| Acceptance | 最终对话 | 必须发送 PM 验收文档核心内容，不能只给 artifact 路径 |
| Knowledge | 未启用全局知识 | 只检索 workspace-local |
| Knowledge | 启用全局知识 | 检索 workspace + user scope，并说明适用性/过期风险 |
| Knowledge | 无价值 closeout | 不写空 artifact，不默认提示“没有沉淀” |
| Knowledge | 未写用户级全局知识 | 默认不提示“未写入”；只有用户询问时说明 |
| Knowledge | 写入用户级全局知识 | 必须显式提示写入路径、source、sensitivity、applicability、opt-in 和脱敏结果 |
| Technical detail | `technicalDetailLevel=1` | Analysis/Review/Acceptance/Knowledge/Goal 可见输出更偏产品语言，证据严谨性不变 |
| Technical detail | `technicalDetailLevel=5` | 证据附录包含更多 schema/script/artifact 细节 |
| Goal | 完成条件 | 所有规格项和验证矩阵完成验收，或逐项明确阻塞 |
| Goal | 分阶段实施 | 阶段完成不等于版本完成；交付时必须完成全部 required 功能需求 |
| Spec | 模板完整性 | decision-complete spec 必须包含模板必填章节，不适用项需说明原因 |
| Spec | 前置对齐 | 默认先生成 alignment draft；它不能作为 Goal Prompt 唯一需求源 |
| Spec | 持续维护 | 范围、里程碑或完成证据变化时更新 Spec 或产出 spec delta |
| Spec | 缺少必填章节 | Goal Prompt checker 返回缺失字段，不输出引用该 spec 的可运行 Goal Prompt |
| Goal Prompt | 无 spec + 默认配置 | 直接根据上下文生成 spec，检查通过后输出引用 spec 的短 Goal Prompt |
| Goal Prompt | 无 spec + `ask_to_generate_spec` | 询问是否生成 spec，不输出可运行 Goal Prompt |
| Goal Prompt | 无 spec + `inline_goal_prompt` | 输出带需求内容的 Goal Prompt，并标注 `specMode=inline_prompt` 与风险 |
| Goal Prompt | auto spec 上下文不足 | 返回 spec 草稿、缺失字段和下一步建议，不输出可运行 Goal Prompt |
| Goal Prompt | stale spec | 有更新的 alignment draft/spec delta/新需求未合并时，阻断可执行 Goal Prompt |
| Roadmap | milestone closeout | 生成 Roadmap Audit，确认是否继续下一里程碑和是否更新 spec |
| Worker | evidence contract | worker/subagent 返回做了什么、改了什么、学到了什么、证据、阻塞、下一步 |
| Closeout | 需求完成/阶段交付 | 最终回复含简短下一步建议，且不暗示项目整体完成 |
| E2E | 真实 Codex Session | 至少创建 fresh Codex Session/subagent 执行真实语气 E2E，并记录 id |
| Regression | 简单问答 | 不触发重治理 |

## 实施计划

实施计划可以分批推进，但 v0.4.0 交付口径必须覆盖本规格全部 required 功能需求。除非某项有明确阻塞记录，任何阶段完成都不能被表述为版本完成。

### 阶段 1：Review 多轮编排成型

- 在现有浅层 `rounds` 基础上增加 round purpose、input refs/hash、brief 文件、issue ledger 和 stop reason。
- 增加 timeout/429/5xx retry policy 和 attempts artifact。
- 实现 Round 2 challenge brief 和 `--discussion-file` 语义。
- 实现 Round 3 convergence brief、Codex provisional decisions 和 convergence status。
- 更新 fake provider/prompt-capture 测试。

### 阶段 2：需求共创、用户盲区与 RCA

- 更新 analysis hook/skill，使中高复杂需求进入需求共创模式。
- 增加用户盲区判断与建议输出，不只提示风险。
- 扩大 RCA 触发范围，但保留简单任务反例。
- 给高影响 RCA 接入 RAVO Review，记录 review evidence。
- 增加中文自然标题回归。

### 阶段 3：PM 验收包

- 扩展 acceptance artifact 或生成旁路 PM checklist artifact。
- 生成面向产品经理的验收 Markdown，并在最终对话框发送核心内容。
- 定义 evidence refs：真实响应、截图/录屏、API/CLI 输出、数据变化、日志/产物路径。
- 在 acceptance checker 中识别 PM 验收包存在性和缺口。
- 增加有 UI/无 UI 两类样例验收。

### 阶段 4：Knowledge 复用与价值门槛

- 给 retrieval 增加授权后的 `includeUser` 默认路径。
- 输出 scope/source/sensitivity/applicability/staleness。
- closeout 增加价值门槛，避免空沉淀和无意义提示。
- 保持用户级写入显式 opt-in。
- 修改用户可见文案：默认不再提示“未写入用户级全局知识”；只有写入或计划写入时显式提醒。

### 阶段 4.5：Technical Detail Level

- 抽出共享配置读取和 output guidance helper。
- 让 Analysis、Review、Acceptance、Knowledge、Goal Prompt 统一消费 `technicalDetailLevel`。
- 补 `level=1/3/5/invalid` 回归测试。

### 阶段 4.6：Spec 模板与检查

- 定义 decision-complete spec 模板。
- 增加 `spec.alignmentDraftPolicy`，默认 `required`。
- 生成正式 Spec 前默认产出 alignment draft；用户明确跳过时记录原因。
- 让 `auto_spec` 按模板生成 spec。
- 扩展 Goal Prompt checker，检查必填章节和缺失字段。

### 阶段 4.7：Goal Prompt 缺失规格策略与陈旧规格防护

- 增加 `goalPrompt.missingSpecPolicy`，默认 `auto_spec`。
- 增加 stale-spec guard，检查 alignment draft、candidate requirements、spec delta 和最近明确需求是否已合并。
- 复用现有 spec writer 和 goal prompt checker，不新增中心调度器。
- 补 `auto_spec`、`ask_to_generate_spec`、`inline_goal_prompt`、stale spec 和上下文不足降级回归测试。

### 阶段 4.8：Spec 持续维护、Roadmap Audit 和完成后下一步建议

- 增加 spec delta 产物或 Spec 更新流程。
- 在 milestone closeout 后生成 Roadmap Audit。
- 定义 worker/subagent evidence contract。
- 在交付、验收、Goal closeout 和阶段完成回复中生成一条简短下一步建议。
- 下一步建议基于当前状态和证据缺口，不扩展为新需求。
- 补“规格补完未实现”“实现完成但缺 E2E”“简单问答不追加”的回归测试。

### 阶段 5：文档、安装缓存和总验收

- 更新 README、README_ZH、skills、template config。
- 更新 `validate-repo`、`smoke-test`、`prompt-regression`。
- 同步 installed plugin cache。
- 写 RAVO Analysis、Review、Acceptance artifacts。
- 新开真实 Codex session/subagent 做至少 5 条真实语气 E2E：需求共创、复杂 RCA、Review 三轮、PM 验收包、technicalDetailLevel=1。
- 每条 E2E 必须记录 Codex session/thread id、prompt、实际响应摘要、artifact 路径和 pass/fail。

## 发布口径

v0.4.0 完成后可以说：

> RAVO v0.4.0 支持 Review 1 到 3 轮真实编排，默认二轮；复杂需求会先进入需求共创并提示盲区判断与建议；复杂根因可引入多模型评审；Codex 发起验收时会给出 PM 可验收的清单和证据；Goal Prompt 会以最新 Spec 为唯一需求源，并在发现未合并需求时先维护 Spec；中高复杂任务可在授权边界内复用项目与全局经验。

不能说：

> RAVO 能自动证明所有根因都是正确的。

也不能说：

> 多轮 review 或 PM 验收包等同于 release_ready。

还不能说：

> `technicalDetailLevel=1` 会降低证据要求，或让 Agent 可以省略验收细节。

还不能说：

> 某个阶段完成就代表 v0.4.0 全部完成。

## Decision-Complete 检查

- 目标消费者明确。
- 当前已开发能力、明确差距和未开发功能已拆分。
- Review 子规格已有详细 implementation contract。
- 跨模块需求有验收标准。
- 数据边界和全局知识 opt-in 规则明确。
- 简单任务不过度治理仍是硬约束。
- 证据不足时不得声称验收通过、可发版或 release_ready。
- Goal 模式完成条件绑定到全部规格项和真实 Codex Session E2E。
- `technicalDetailLevel` 的当前不足和补全目标已明确。
- Spec 前置对齐、持续维护、stale-spec guard 和 spec delta 规则已明确。
- 实施阶段与版本交付口径已分离：可以分批实施，交付必须覆盖全部 required 功能。
- Roadmap Audit、worker evidence contract 和下一步建议规则已明确。
