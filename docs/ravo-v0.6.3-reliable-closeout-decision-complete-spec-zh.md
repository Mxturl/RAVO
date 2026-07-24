# RAVO v0.6.3 可靠收口 Decision-Complete Spec

Status: decision-complete

Date: 2026-07-23

Release Slice: `ravo-v0.6.3-reliable-closeout`

Requirement Set: `R603-001` 至 `R603-007`

Work Items: `WI-46ee8932cd90`、`WI-2daf80337be1`、`WI-6ef7ea48c7fb`、`WI-729172d00831`

Version Decision: `v0.6.3`，基于已发布 `v0.6.2` 的兼容性行为修正。

Base Dependency: Git Tag `v0.6.2`，commit `7de7f94e9c6edd320e4d7821b4416a283be8f253`。

Authorization Source: PM 已确认将 Stop Hook 并发隔离和 Knowledge 召回增强共同锁定为 `v0.6.3`；2026-07-23 PM 在本轮体验验收中进一步确认，PM 回复应由模型按沟通目标和原则自由组织，不使用固定回复模板。

Decision Update: 2026-07-23 的体验反馈属于 v0.6.3 验收修正。底层结构化状态继续作为事实来源，但不得把字段顺序、固定栏目、固定行数、必用表格或术语黑名单当作 PM 阅读体验的替代验收指标。该更新不新增 Hook、模块、外部调用、数据边界或发布授权。

Goal Decision Update: 2026-07-24 的真实会话反馈属于 v0.6.3 验收修正。实施型请求默认由 Codex 持续推进到可验证完成、真实阻塞或需要产品决策；用户无需额外说“一次性完成”或主动要求 Goal。RAVO 通过 Skill 与用户级 AGENTS 授权模型结合完整语义和语境自然选择 Goal，不实现关键词触发器、评分器、Hook 或新 Goal 引擎。步骤规模、跨轮推进和恢复价值只是帮助模型理解连续执行价值的语境信号，不是必须同时满足的条件、固定清单或评分项。Goal 只提供连续执行容器，不自动增加 Spec、Review、Acceptance 或证据要求。

Delivery Profile: `rapid`

Review Required: `false`。本 Slice 不新增外部调用、敏感数据、权限、不可逆动作、Hook 事件或发布授权；使用本 Spec 的对抗边界、定向回归和真实双任务验证。若实现需要读取完整会话、引入跨任务状态中心、新 Hook 或外部模型，本 Spec 立即 stale。

## 1. 产品定义

### 1.1 目标

让 RAVO 在任务收口时同时做到两件事：

1. 当前任务的完成、验收和发布结论只由当前任务绑定的 Acceptance 支撑，不受并发任务影响；
2. 复杂工作形成的稳定经验能够及时被识别和分类保存，但简单任务仍然直接结束。

产品原则：

> 机械边界使用窄检查，语义判断依赖模型和 Skills；可信度提高不能以每次收口都增加流程为代价。

### 1.2 真实消费者

在同一工作区并行使用 Codex/RAVO 的个人产品经理和开发者。Codex 是执行者；RAVO 不建立中央任务编排层。

### 1.3 必须结果

| Requirement | Work Item | 必须结果 |
|---|---|---|
| `R603-001` | `WI-46ee8932cd90` | Stop Hook 对 Acceptance 使用当前响应显式引用或当前任务精确绑定，不再直接消费 workspace `latestArtifact`。 |
| `R603-002` | `WI-46ee8932cd90` | 无法唯一绑定时，无关 Acceptance 既不能否定也不能支持当前结论；高阶状态只纠正一次，简单完成不被强制升级为 Acceptance 流程。 |
| `R603-003` | `WI-2daf80337be1` | RCA、Review、Smoke 或 Acceptance 形成证据充分的稳定事实时，相关 Skill 执行一次 Knowledge 候选判断。 |
| `R603-004` | `WI-2daf80337be1` | Goal、阶段或用户显式收尾时，按 Knowledge、Requirement/Issue Pool、Goal/Workstream/Continuation、Spec Delta 或不保存进行一次轻量分类。 |
| `R603-005` | `WI-2daf80337be1` | 简单问答、一次性操作、无稳定新事实或无有效候选时静默结束，不生成空 Artifact，不新增或扩展 Stop Hook。 |
| `R603-006` | `WI-6ef7ea48c7fb` | 面向 PM 的回复把结构化记录作为事实输入，由模型围绕当前沟通目标自由选择自然语言、列表、表格或步骤；不强制固定栏目、字段顺序、行数或表格。机械检查只负责状态真实性、PM 行动一致性、安全与授权边界。 |
| `R603-007` | `WI-729172d00831` | 明确实施请求默认持续到验证完成；当模型结合完整语境判断 Goal 能实质改善连续执行时，可自然创建或复用一个 Codex Goal，无需用户使用特殊措辞。多个可靠步骤、跨轮推进和恢复价值是语境信号而非固定触发条件。简单工作继续直接完成，Goal 选择不自动升级治理强度。 |

## 2. 已确认事实、假设与挑战

### 2.1 已确认事实

- `v0.6.2` Stop Hook 调用 `check-ravo-acceptance.js` 时未传 `--acceptance-artifact`，checker 因而读取 manifest 中的 Acceptance `latestArtifact`；
- 同一 workspace 的 v0.6.2 发布任务和 AppWorld 任务在数秒内分别写入 Acceptance，后写入的 `not_ready` 工件错误否定了前一任务已经单独验证为 `release_ready` 的结论；
- checker 已支持 `--acceptance-artifact`，无需新增检查器或状态存储；
- RCA、Review 和真机 Smoke 已出现“事实证据充分但 Knowledge 沉淀遗漏”的真实案例；
- PM 已明确排除使用 Stop Hook 强制 Knowledge 收尾。
- v0.5.13 已建立 PM/Agent 读者边界，但把“5–8 行、最多三步、固定字段、术语黑名单”等代理指标做成了硬检查；v0.6.3 实际验收证明这些检查可以通过，同时回复仍然密集、术语化且不易行动。

### 2.2 合理假设

- Hook 输入可能提供 session/thread 标识，但不同宿主版本不保证字段恒定；实现必须兼容字段缺失；
- Acceptance 可通过 workspace-local 工件路径或 `conversation:<task>#<turn>` 来源与当前任务精确关联；
- Skills 与 AGENTS 无法保证 100% 召回，验收目标是覆盖已确认高价值场景并避免明显噪声，而不是建立强制工作流。
- `pmBrief`、Acceptance Items 和证据记录适合提供事实，不适合直接决定最终回复布局；模型可根据当前问题合理省略与本次判断无关的字段。
- 一次实际长程实施交互表明：长程实施语境可以被识别为 Workstream，却仍因 Goal 创建授权表达过于被动而降级为普通执行；PM 需要在后续交互中显式要求继续完成，说明“无需特殊 Goal Prompt”的体验尚未稳定成立。

### 2.3 最强挑战

软提示无法像 Stop Hook 一样保证每次执行，但把 Knowledge 盘点放进 Stop Hook 会让所有简单任务承担固定成本，并重新引入本轮改版要消除的照本宣科。结论是：Acceptance 只修可机械判断的任务隔离；Knowledge 只加强产生经验的 Skills 和阶段节点，不追求全会话强制覆盖。

PM 沟通同样不能用更完整的模板解决：固定栏目会把“简短”变成信息压缩，把“结构化”变成字段复述。结论是：结构化数据只约束事实一致性，最终表达交给模型；表格仅在比较关系确实更清楚时使用。

自动 Goal 同样不能用“出现某句话就触发”解决：关键词会误伤简单任务，也无法理解既有范围、剩余承诺和连续执行价值。结论是：用户级 AGENTS 提供一次性的 Goal 语义裁量授权，模型在每次任务中理解完整上下文；宿主不支持时诚实降级，但默认交付责任不随之消失。

## 3. 范围与非目标

### 3.1 必须交付

- 为 Stop Hook 增加任务本地 Acceptance 选择规则，并复用 checker 的显式工件参数；
- 增加显式工件、精确任务绑定、并发 latest 污染、缺失/歧义绑定和单次纠正回归；
- 在 AGENTS 模板/生成器及相关 RCA、Review、Quick Validation、Acceptance、Knowledge/Workstream Skills 中加入最短的候选检查与分类规则；
- 在 AGENTS 与现有生产 Skills 中明确 `pmBrief` 是事实来源而非回复模板，模型按当前 PM 问题自由组织表达；
- 在 Core Skill、AGENTS 模板/生成器和 README 中明确默认实施承诺、自然 Goal 选择、一次性用户授权和 Goal/治理解耦；
- 删除 Acceptance PM 文档的固定栏目、固定行数和固定步骤数门禁，保留状态、行动、安全和发布边界检查；
- 增加稳定事实、阶段收尾、简单问答和无候选的正负向回归；
- 统一源码、插件、CLI、SoloDesk、本机安装态和公开版本元数据到 `0.6.3`；
- 完成自动验证、本机刷新、Fresh Session 双路径体验和 PM 验收材料。

### 3.2 明确排除

- 新增 Hook 事件，或让 Stop Hook 执行 Knowledge 候选盘点；
- 自动读取、总结或保存完整会话和 transcript；
- 强制生成 `knowledgeCandidates`、Closeout Inventory 或空 Artifact；
- 新增统一回复模板、强制表格、固定字段顺序、模型评分服务或新的沟通 Hook；
- 新增 Goal 关键词表、数值触发矩阵、模型分类服务或任务路由 Hook；
- 把未完成待办、拒绝记录或临时观察统一写入 Knowledge；
- 新增中央路由器、任务状态中心、数据库、后台服务、模型分类器或配置 DSL；
- 降低 `accepted`、`release_ready`、`live`、`released` 的证据门槛；
- AppWorld benchmark、其它版本候选、Push、Tag、Release、部署或远端 mutation。

## 4. 模块契约

### 4.1 Stop Hook：任务本地 Acceptance 绑定

输入：Hook payload、最后一条 Assistant 响应、当前 workspace。

绑定优先级：

1. 响应中显式引用且位于当前 workspace `knowledge/.ravo/acceptance/` 下的 JSON 工件；
2. Hook payload 中可用的 session/thread 标识，与 Acceptance 的 `sourceRefs`、`realResponseRefs` 或 PM 决策来源做精确任务匹配；
3. 无唯一结果时返回“未绑定”或“绑定歧义”，不得回退到 manifest `latestArtifact` 或按文件时间猜测。

行为：

- 唯一绑定后，以 `--acceptance-artifact` 调用现有 checker；
- `accepted`、版本完成、可发布或已发布等高阶结论无唯一绑定时，只纠正一次并要求绑定当前任务证据；
- 普通低风险代码/功能完成可以由响应中的实际直接检查支撑，不因缺少 Acceptance Artifact 被 Stop Hook 强制升级；
- Pool 强信号检查保持独立，仍遵守现有单次纠正规则；
- 错误信息只描述当前任务缺少或存在歧义，不泄露、引用或借用其它任务状态。

### 4.2 Knowledge：稳定事实与轻量收尾

即时触发：RCA、Review、Smoke 或 Acceptance 得到证据充分、可复用且边界明确的事实或经验。

收尾触发：Goal 终态、明确阶段收口或用户显式要求收尾。普通问答和无新增稳定事实的短任务不触发。

分类结果：

| 内容 | 归属 |
|---|---|
| 可复用事实、经验、原则 | Knowledge；技术事实证据充分即可记录，产品决定仍需 PM 确认 |
| 新需求、问题、拒绝或延期理由 | Requirement/Issue Pool |
| 未完成事项、blocker、恢复入口、下一步 | Goal、Workstream 或 Continuation |
| 改变当前范围、验收语义或完成证据 | Spec Delta |
| 临时、重复、低价值或无后续用途 | 不保存 |

无有效候选时保持静默，不生成记录来证明“检查过”。

### 4.3 Core：默认交付与自然 Goal

- 对明确的实施、修改或修复请求，默认完成当前授权范围内的实现、验证和可恢复本地集成；讨论、解释、分析和规划请求不因此自动进入实现。
- 用户级 RAVO AGENTS 规则显式授权 Codex：无需每个任务再次提及 Goal，可结合当前意图、既有范围、剩余承诺和操作边界，判断连续执行容器是否能实质帮助完成任务，并自然创建或复用一个 Goal。
- 步骤规模、跨轮推进和恢复价值只是语境信号，不是关键词、评分项、固定清单或必须同时满足的条件；一句“一次性完成”既不是必要条件，也不单独证明 Goal 有价值。
- Goal 只改善连续执行和状态恢复，不扩张授权，也不自动要求 Spec、Review、Acceptance、Evidence Artifact 或其它 RAVO 流程。
- 宿主无 Goal 能力或工具契约仍不允许创建时，Codex 继续承担默认交付责任；对明显长程任务只需一次说明真实降级和恢复边界。

## 5. 验证矩阵

| ID | 场景 | 必须结果 | 证据类型 |
|---|---|---|---|
| V1 | 响应显式引用当前 Acceptance | Hook 使用该工件，checker 结果与显式运行一致 | 单元回归 |
| V2 | 当前任务工件后写入无关 `not_ready` 工件 | 当前 `release_ready` 结论不被否定 | 并发 fixture |
| V3 | 无关工件为 `release_ready`，当前任务无证据 | 无关工件不能帮助当前任务通过 | 负向 fixture |
| V4 | session/thread 精确匹配且只有一个工件 | 自动绑定当前任务工件 | 单元回归 |
| V5 | 任务标识缺失或匹配多个工件 | 不读取 latest；高阶结论只提示补充/明确绑定一次 | 单元回归 |
| V6 | 简单局部任务有实际直接检查、无 Acceptance | 正常结束，不新增 Acceptance 仪式 | prompt regression + Fresh Session |
| V7 | RCA 形成稳定、可复用且有证据的事实 | 执行 Knowledge 候选判断并正确记录或说明证据不足 | Skill contract + 场景回归 |
| V8 | Goal/阶段显式收口含需求、经验和待办 | 三类内容分别进入正确归属，不把待办写入 Knowledge | 场景回归 |
| V9 | 简单问答或无有效候选 | 无盘点话术、无空 Artifact、无 Pool/Knowledge 写入 | 负向回归 + Fresh Session |
| V10 | 架构边界 | Hook manifest 仍只有一个 Stop；无 Knowledge 分支和新状态层 | architecture regression |
| V11 | 仓库与版本 | 定向测试、tracked 全量回归、版本一致性和 preflight 通过 | 自动验证 |
| V12 | 本机实际体验 | 两个并发任务不串证据；复杂排障有召回、简单任务无噪声 | Fresh Session evidence |
| V13 | 状态表达 | 实现、自动验证、本机可用、PM 接受、发布条件、已发布分别说明 | Acceptance checker |
| V14 | PM 自由表达 | 简单说明保持直接；存在比较关系时模型可选表格；验收回复清楚说明当前结果和具体行动，但不逐字段复述 `pmBrief`，也不暴露无助于判断的内部术语 | prompt regression + Fresh Session + PM 体验 |
| V15 | 普通长程实施请求，未提及 Goal 或“一次性完成” | 模型结合既有范围、剩余工作和连续执行价值自然创建或复用一个 Goal，不把语境信号当作固定清单，并持续到完成、真实阻塞或产品决策 | prompt regression + Fresh Session |
| V16 | 简单局部实施请求或纯讨论请求 | 直接完成或回答，不建 Goal；进入 Goal 也不自动增加 Spec、Review、Acceptance 或专门 Evidence | 负向 prompt regression + Fresh Session |

## 6. 失败与降级

| 条件 | 行为 | 恢复入口 |
|---|---|---|
| Hook payload 没有任务标识 | 只接受显式 workspace-local Acceptance 引用；不猜测 latest | 在当前响应引用对应 Acceptance 后重试 |
| 同一任务匹配多个工件 | 判定绑定歧义，不按时间选取 | 显式引用目标工件 |
| 显式路径越界、缺失或不是 JSON | 拒绝该绑定，不读取其它任务工件 | 修正为当前 workspace 内有效工件 |
| 高阶状态没有任务本地证据 | 状态保持未证实，只纠正一次 | 创建/验证并显式绑定当前 Acceptance |
| Knowledge 证据不足或适用边界不清 | 保持候选或不保存，不写成已确认结论 | 补证后重新判断 |
| Skills 仍在真实复杂场景漏召回 | 记录具体场景并收窄补充对应生产 Skill | 用同类场景回归后重验 |
| 宿主无 Goal 能力或当前工具契约拒绝创建 | 普通交付继续；长程任务一次说明未进入 Goal 和恢复边界，不伪装已生效 | 在支持语义授权的 Fresh Session 中重验 |
| 实现需要新 Hook、会话扫描或状态中心 | 当前 Spec stale，停止扩张 | 生成 Spec Delta 并重新取得 PM 决定 |
| 本机插件未刷新 | 不声称本机可用 | Runtime Delivery Preflight、升级、Fresh Session |

相同 blocker fingerprint 不重复尝试；rapid 档位达到预算后停放并继续独立工作。

## 7. 数据、安全与权限

- 只读取当前 workspace 的 RAVO Artifact 和 Hook 已提供的最小任务标识；
- 所有显式工件路径必须规范化并限制在当前 workspace Acceptance 目录；
- 不读取完整 transcript，不保存新会话正文，不外发 Review 内容；
- 不读取或写入凭据、客户数据、生产数据和用户级全局 Knowledge；
- 本机升级可恢复；全局 AGENTS 更新继续使用现有 preview、backup、apply 契约；
- 本 Spec 不授权 Push、Tag、Release、部署、共享服务或远端 mutation。

## 8. 实现所有权与允许路径

核心路径：

- `plugins/ravo/modules/ravo-acceptance/hooks/ravo-acceptance-stop.js`
- `scripts/ravo-v0.6-hook-test.js`
- `plugins/ravo/skills/ravo-root-cause-analysis/SKILL.md`
- `plugins/ravo/skills/ravo-review/SKILL.md`
- `plugins/ravo/skills/ravo-quick-validation/SKILL.md`
- `plugins/ravo/skills/ravo-release-acceptance/SKILL.md`
- `plugins/ravo/skills/ravo-knowledge/SKILL.md`
- `plugins/ravo/skills/ravo-workstream/SKILL.md`
- `plugins/ravo/skills/ravo-core/SKILL.md`
- `plugins/ravo/modules/ravo-core/scripts/ravo-pm-brief.js`
- `plugins/ravo/modules/ravo-acceptance/scripts/write-acceptance-artifact.js`
- `plugins/ravo/modules/ravo-acceptance/scripts/check-ravo-acceptance.js`
- `plugins/ravo/modules/ravo-dashboard/scripts/ravo-fresh-session-e2e.js`
- `templates/agents-snippet.md`
- `plugins/ravo/modules/ravo-core/scripts/ravo-agents.js`
- `scripts/prompt-regression.js`
- 直接覆盖 V1-V16 的最小现有测试文件
- 公共插件、内部模块、CLI、SoloDesk、README 和安装/升级所需版本元数据
- v0.6.3 Spec、Pool、Evidence、Acceptance 与 PM 验收材料

禁止新增模块、公共 Skill、Hook 事件、状态数据库或专用 closeout 脚本。若现有文件的更小改动已覆盖契约，不为对称性修改其它模块。

## 9. 版本、安装与发布边界

- 产品版本统一为 `0.6.3`；历史 Artifact/config/schema 版本不机械改写；
- 本机从已发布 `v0.6.2` 升级到 `v0.6.3`，保留现有迁移兼容；
- 源码验证通过不等于本机已经刷新；Fresh Session 通过不等于 PM 已接受；
- PM 接受不自动构成发布授权；发布需要单独 Spec Delta 和不可变远端计划。

## 10. 实现顺序

1. 绑定四个 Work Item、Release Slice 和本 Spec；
2. 先增加 Stop Hook 并发正负回归，再实现最小绑定逻辑；
3. 增加 Knowledge 召回正负回归，再更新 AGENTS 和相关生产 Skills；
4. 增加默认实施承诺与自然 Goal 的正反回归，更新 Core、AGENTS 和 README；
5. 统一版本元数据，运行定向测试与 tracked 全量回归；
6. 执行 Runtime Delivery Preflight，刷新本机插件并新建 Session；
7. 完成双任务并发、复杂排障、简单问答和自然 Goal 四类实际体验；
8. 生成 PM 验收文档与 Acceptance，运行 checker 后停止在真实状态。

步骤是推荐顺序，不要求额外编排器；等价实现必须满足相同结果、边界和验证矩阵。

## 11. PM 体验验收

PM 只需判断五个产品现象：

1. 两个任务同时工作时，一个任务的完成或发布状态不再被另一个任务覆盖；
2. 复杂排障形成稳定经验后，Codex 能及时提出并正确分类保存；
3. 普通简单问题仍然直接结束，没有 Knowledge 盘点或证据仪式。
4. 面向 PM 的验收回复能直接看懂结果和下一步，表达形式由当前内容决定，而不是逐项套用固定模板。
5. 不提 Goal 或“一次性完成”时，明确的长程实施请求仍能自然连续推进；简单任务不会因此 Goal 化或增加治理流程。

PM 无需查看 JSON、Hook 日志、内部状态码、Work Item ID 或测试命令。

## 12. 状态语言与完成标准

- 当前状态只能说“v0.6.3 范围已确认并形成 Spec”，不能说已经实现或可用；
- 源码和自动验证完成后可说“实现与自动验证完成”，不能说本机已生效；
- 本机升级和 Fresh Session 通过后可说“本机可体验”，不能说 PM 已接受；
- PM 明确接受后可说“PM 已接受当前体验”，仍不等于具备发布条件；
- 未执行远端发布前不得说“已发布”或“已上线”。

当前 Slice 达成以下条件后停止活跃循环：

1. `R603-001` 至 `R603-007` 全部实现，或 blocker 具有原因、影响、降级和恢复入口；
2. V1 至 V16 具备与风险相称的验证；
3. 定向测试、tracked 全量回归、版本一致性和 preflight 通过；
4. 本机安装态为 `0.6.3`，Fresh Session 完成并发、复杂、简单和自然 Goal 四类体验；
5. PM 验收文档分别说明实现、自动验证、本机可用、PM 接受、发布条件和发布状态；
6. Acceptance 绑定本 Spec、当前任务证据和真实响应，checker 结论与最终语言一致；
7. 未修改并发 AppWorld Workstream 的所有权和 latest 指针，未执行任何远端或发布动作。

达到“实现与自动验证完成”“等待外部条件”或“等待 PM 体验判断”之一后停止，不因其它候选扩大当前 Slice。
