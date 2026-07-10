# RAVO v0.3.2 需求对齐草稿

日期：2026-07-09

状态：alignment draft，非正式 Spec

## 目的

这份文档只用于重新对齐最近讨论过的需求，不作为 decision-complete Spec，也不作为 Goal Prompt 的唯一需求源。

当前方向：RAVO v0.3.2 不只是补功能，而是把 Codex 长程协作从“能执行”推进到“能持续不跑偏、能被 PM 验收、能被 Review 挑战、能维护规格和证据”。

## 明确边界

- Dashboard 不纳入 RAVO v0.3.2，相关规划归外部 `Wanted` 项目。
- RAVO Review 需要明显加强。它不只是代码评审，而是重要需求、路线图、根因、证据、验收和用户盲区的对抗性评审能力。
- 本文档不替代现有 `docs/ravo-v0.3.2-decision-complete-spec-zh.md` 和 `docs/ravo-review-v0.3.2-multi-round-spec-zh.md`。

## Spec 前置对齐文档策略

对齐文档可以作为生成正式 Spec 前的可选步骤，帮助用户先确认需求方向、边界、优先级和待确认问题，避免直接生成过重或跑偏的 Spec。

建议配置项：

- `spec.alignmentDraftPolicy`
- 合法值：`required | skip | auto`
- 默认值：`required`

策略语义：

- `required`：生成正式 Spec 前必须先生成对齐文档。对齐文档不是 decision-complete Spec，也不能作为 Goal Prompt 的唯一需求源。
- `skip`：不生成对齐文档，直接进入 Spec 生成或更新。适用于用户已明确给出完整需求边界，或任务很小。
- `auto`：根据复杂度决定。中高复杂、跨模块、发布/验收敏感、用户需求仍在收敛时生成；简单修复、明确小改、用户已指定完整 Spec 时跳过。

对齐文档至少包含：

- 当前目标和真实消费者。
- 已确认需求。
- 待确认问题。
- 明确不做。
- 关键风险和用户可能盲区。
- Review、Acceptance、Knowledge、Goal/Spec 的相关要求。
- 初步优先级建议。
- 是否建议进入正式 Spec。

进入正式 Spec 的条件：

- 用户确认对齐方向，或配置允许自动继续。
- 对齐文档中的待确认问题不阻塞 Spec 生成，或已标注为假设。
- 文档明确哪些内容进入 Spec、哪些保留为后续候选。

## 需求分组

### 1. PM 验收与证据

Codex 发起验收、交付、完成或 readiness 结论时，必须给用户一份面向产品经理的验收文档，不能只给脚本结果或 artifact 路径。

验收文档要包含：

- 需求预期与实现效果对比。
- 当前实现方案的简短说明。
- PM 验收清单。
- 真实响应证据。
- 截图/录屏证据；无 UI 时给替代证据。
- API/CLI/数据变化/日志/产物路径。
- 未满足项、待补证据和产品边界。

状态语言必须跟证据一致。只有脚本通过时，最多是 `code_complete` 或 `pending_acceptance`，不能说验收通过或可发版。

### 2. RAVO Review 加强

Review 是 v0.3.2 最有潜力的方向之一，应该从“模型给意见”升级成“可追踪、可挑战、可收敛的对抗性评审”。

已明确需要：

- 支持 1 到 3 轮真实编排，默认 2 轮。
- Round 2 使用 challenge brief，不只是重复上一轮。
- Round 3 做收敛检查，消费 Codex provisional decisions。
- 建立 issue ledger，记录 issue 状态、证据、建议、Codex 判断、残余风险。
- timeout、429、5xx、连接中断要支持 retry，并记录 attempts。
- Review artifact 保留 coverage、partial、timeout、truncation、provider-error 等降级状态。
- Review 不等于 release readiness，只能作为 acceptance 的证据输入。

Review 还应扩展几个方向：

- 需求/方案 Review：挑战目标、消费者、场景和验收口径。
- 根因 Review：复杂 RCA 使用多模型或独立上下文复核。
- 路线图 Review：检查里程碑顺序、范围变化、证据变化和下一步是否仍正确。
- 证据 Review：检查“声称完成”和“实际证据”是否匹配。
- 用户盲区 Review：检查用户的前提、边界、优先级和消费者假设。
- Clean-room Review：高风险任务可用 fresh session/subagent 复核，降低自证风险。

### 3. 需求分析与用户盲区

中高复杂需求不能直接进入方案，应先做需求共创；用户也可以选择“直接进入方案阶段”。

需求共创需要覆盖：

- 背景。
- 现状。
- 场景。
- 真实消费者。
- 痛点。
- 参考对象。
- 验收方式。
- 约束和非目标。

用户盲区不能只提示，还要给判断和建议。每条盲区建议包含：

- 盲区是什么。
- 依据来自事实、推断还是待验证。
- 影响判断：高 / 中 / 低。
- 可能影响范围、优先级、验收、消费者理解、技术路线中的哪一类。
- 建议动作：继续澄清、作为假设继续、降级为非目标、拆成后续里程碑、进入 Review。
- 是否需要更新 Spec。

### 4. 根因分析

遇到任何有实际影响的问题、挑战、失败或异常，都应完成一整套根因分析，而不只是在“反复问题”时触发。

复杂或高影响 RCA 应接入多模型 Review，因为根因分析自证难度高。

RCA 输出应至少包含：

- 现象。
- 近因。
- 备选假设。
- 机制根因。
- 追问链。
- 边界。
- 最小修复。
- 验证方式。
- 需要 Review 的原因或未执行 Review 的原因。

### 5. Knowledge 与经验复用

中高复杂任务应先检索项目内 knowledge。用户显式授权或配置启用后，再检索用户级全局知识。

经验复用要求：

- 区分 workspace scope 和 user scope。
- 说明 source、sensitivity、applicability、过期风险。
- 跨项目经验只能作为参考，不能覆盖当前项目事实。
- 没有实际价值的知识不写 artifact，也不默认提示“没有知识沉淀”。
- 默认不提示“未写入用户级全局知识”。
- 只有真实写入或准备写入用户级全局知识时，才显式提醒写入路径、source、sensitivity、applicability、opt-in 和脱敏结果。

### 6. Technical Detail Level

`technicalDetailLevel=1` 当前只在 `ravo-status` 和 analysis advisory 层面生效，不足以满足“全 RAVO 输出更偏产品语言”的预期。

需要补成跨模块配置：

- level 1：面向产品/PM，少内部实现细节，保留必要证据。
- level 3：产品解释和工程证据平衡。
- level 5：面向工程维护，包含 artifact、schema、脚本和边界细节。

任何 level 都不能降低严谨性、安全边界、验收标准或证据要求。

### 7. Goal Prompt 与 Spec

Goal Prompt 应始终短，默认引用 Spec，不重复需求细节。

缺少 decision-complete Spec 时，处理策略应可配置：

- `auto_spec`：默认，根据上下文生成 Spec，检查通过后输出短 Goal Prompt。
- `ask_to_generate_spec`：提醒用户是否生成 Spec，不输出可运行 Goal Prompt。
- `inline_goal_prompt`：直接生成带需求内容的 Goal Prompt，并标注风险。

Spec 需要明确模板，不能是散文。模板应包含：

- 产品定义。
- 当前基线。
- 范围决策。
- 假设与非目标。
- 触发规则。
- 模块契约。
- 数据边界。
- 验证矩阵。
- 实施计划。
- 发布口径。
- PM 验收要求。
- 下一步建议规则。

Goal Prompt 还应要求 Codex 持续维护 Spec。执行中发现范围、里程碑、完成证据、验收标准、数据边界、阻塞条件或发布口径变化时，应先产出 Spec delta 或更新 Spec，再继续推进。

### 8. Goal 模式完成条件

Goal 模式不能以“代码写完”或“三条脚本通过”作为完成条件。

完成必须满足：

- 规格书中的 required 内容全部完成。
- 验证矩阵全部通过，或逐项记录明确阻塞。
- PM 验收文档已生成并发送核心内容。
- RAVO Review / Knowledge / Acceptance evidence 与实际状态一致。
- E2E 必须真实创建 Codex Session/subagent，并记录 session/thread id、prompt、实际响应摘要、artifact 路径和 pass/fail。
- 证据不足时只能报告 `code_complete`、`pending_acceptance` 或 `not_ready`。

### 9. 长程协作与里程碑

从 Gabriel Chua 的长程 Codex 协作经验中，适合吸收的是操作方式，不是 dashboard 本身。

可吸收：

- 用里程碑路线图组织长项目。
- 一次只激活一个 Goal。
- 主线程负责协调，worker/subagent 负责实现或调查。
- worker 返回 evidence contract，不倾倒完整上下文。
- 每个里程碑后做 Roadmap Audit，再决定是否进入下一里程碑。
- 本机测试必须本机做，远程 worker 不能冒充本机 E2E。
- 进度汇报使用 `What’s done / What’s next / Any blockers`。

worker evidence contract 建议包含：

- 做了什么。
- 改了什么。
- 学到了什么。
- 证据是什么。
- 阻塞是什么。
- 下一步建议是什么。

### 10. 完成后的下一步建议

完成明确需求、阶段交付或验收发起后，最终回复要给一条简短下一步建议。

要求：

- 基于当前状态、证据缺口和用户视角。
- 不暗示整个项目已经完成。
- 证据不足时，建议指向补证据、真实 E2E、PM 验收、实现剩余项或阻塞处理。
- 简单问答、一次性命令输出、用户明确要求只输出结果时可跳过。

## 当前优先级建议

第一优先级：

- RAVO Review 多轮真实编排。
- PM 验收包。
- Goal completion + 真实 Codex Session E2E。
- Spec template + Spec delta。

第二优先级：

- 用户盲区判断与建议。
- Roadmap Audit。
- Worker evidence contract。
- technicalDetailLevel 跨模块。

第三优先级：

- 全局知识检索增强。
- closeout challenge。
- 进度汇报格式统一。

## 明确不进入 RAVO v0.3.2 的内容

- Dashboard。它归外部 `Wanted` 项目。
- 无限轮 Review。
- 完整 DLP。
- GUI 管理后台。
- 把 Review 结果等同于验收通过或可发版。

## 待确认问题

1. Review 加强是否作为 v0.3.2 的主线，而不是多个平行小功能之一？
2. Roadmap Audit 是否并入 Review，还是作为 Workstream closeout 的一部分？
3. Spec delta 是直接修改原 Spec，还是先产出 delta artifact 等用户确认？
4. worker evidence contract 是否要求所有 subagent 都遵守，还是只约束长程 Goal？
5. Wanted dashboard 与 RAVO 的接口边界是什么：读取 RAVO artifacts，还是 RAVO 主动输出 dashboard 数据？
