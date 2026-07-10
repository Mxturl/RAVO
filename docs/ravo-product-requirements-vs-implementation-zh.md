# RAVO 产品经理验收对比文档

日期：2026-07-09

版本口径：`main` 分支 `b26dfcf Complete RAVO v0.3.1 review and knowledge runtime`，插件版本 `0.3.1`。

本文面向产品经理验收，重点回答：原始需求想解决什么用户问题，当前实现给用户带来了什么实际效果，哪些地方可以验收，哪些边界需要产品确认。脚本、artifact、E2E 记录只作为证据来源，不作为正文主线。

## 验收结论

RAVO v0.3.1 已达到当前最小闭环：让 Codex Agent 在复杂任务中自然进入“先分析、再执行、交付前看证据、事后沉淀经验”的工作方式，同时避免对简单问答过度治理。

从产品效果看，v0.3.1 补齐了 v0.3 的三个关键缺口：

- RAVO Review 从“只能记录评审结果”升级为“能调用已配置模型做真实评审，并记录 full/partial/none/failure/timeout/truncation 状态”。
- RAVO Knowledge 从“用户明确要求才写知识”升级为“可在任务收尾时沉淀经验，并在中高复杂度任务前提示复用项目知识”。
- RAVO Acceptance 从“只看功能/验收 artifact”升级为“同时看到 review evidence 和 knowledge evidence，但不会把知识证据误当成功能验证”。

需要产品确认的边界：

- Hook trust 和新会话加载仍依赖 Codex 宿主，RAVO 只能提醒和诊断，不能替用户自动完成授权。
- 需求共创、任何问题强制根因分析、PM 验收材料包和全局经验复用还没有完整产品化。
- Review provider 的真实输出可能是 `partial`，这代表“有降级证据”，不是“完整外部评审”。
- 用户级全局知识默认不写；如果产品希望更主动的跨项目记忆，需要另做显式授权和更强脱敏机制。

## 验收口径

本文采用产品验收口径，不以“测试是否跑过”为主。

验收判断分三类：

- 满足：用户预期已被当前体验覆盖，可以作为本版本验收项。
- 基本满足：主流程可用，但存在产品边界、宿主依赖或降级状态，需要在说明中讲清楚。
- 部分满足：已有基础能力，但还不足以兑现完整产品预期，应进入后续版本。

## 需求预期与实现效果

| 产品需求 | 用户预期 | 当前实现方案 | 当前实现效果 | 验收判断 | 产品边界 |
|---|---|---|---|---|---|
| 自然触发治理 | 用户不用记插件名；正常描述复杂需求、根因、验收或发版问题，Agent 就应该进入更严谨的工作方式 | 通过 Codex skills、`UserPromptSubmit`/`SessionStart` hooks 和 AGENTS.md 委托规则识别场景，再给 Agent 注入对应工作契约 | RAVO 能对需求分析、根因、长任务、验收、知识复用等场景给出 advisory；简单任务不强行套模板 | 基本满足 | 前提是 Codex 已加载并信任 hooks；无 hook 时仍可手动调用 skills/scripts |
| 简单问题不过度治理 | 用户问“RAVO Review 是什么？”这类简单问题时，应直接解释，不要进入完整分析/评审流程 | 触发器排除简单 FAQ/术语解释；回归用例覆盖“简单概念解释”和“小改动” | v0.3.1 修复了 delegated prompt 包裹导致的误触发；简单 FAQ 不触发 heavy governance | 满足 | 仍需保留负向回归，避免后续扩展触发词时反弹 |
| 需求与方案分析 | 中等以上复杂需求应先进入需求共创：补齐背景、现状、场景、消费者、痛点、参考对象和约束；也应允许用户选择“直接进入方案阶段” | 当前通过 RAVO Analysis 触发一次性结构化分析，要求输出 Goal、Consumer、Constraints、Facts、Options、Challenge、Derived Conclusion、Validation，并可写入 analysis artifact/decision spec | 能阻止 Agent 直接开写，并给出目标、消费者、约束、方案和验证；但还没有专门的 grill-me 式多轮澄清流程，也没有固定的“继续澄清/直接进入方案”选项 | 部分满足 | v0.3.1 满足“先分析再执行”的底线；完整需求共创体验应作为后续增强 |
| 根因分析 | 遇到任何问题、异常、挑战或失败时，Agent 都应完成一整套根因分析，不只是在“反复问题”时才做；不能停在“提示词问题/用户要求/没检查”这类表层解释 | RAVO Root Cause skill 要求区分 symptom、proximate cause、alternative hypotheses、mechanism root cause、why chain、verification；hook 主要按“根因/root cause/反复/防复发”等语义触发 | 明确提出根因、故障、复发或防复发时，能进入机制级根因分析；但普通“挑战/问题”是否强制进入 RCA 仍取决于 Agent 判断和触发词覆盖 | 部分满足 | 结构校验不能自动证明推理深度；“任何问题或挑战都强制 RCA”还需要更强触发策略和反例保护 |
| Goal Prompt 方法论 | 长程 Goal Prompt 不应变成大段需求堆砌；没有稳定规格书时不能给可执行 Prompt | `ravo-goal-prompt` 扫描 docs/knowledge 中的 decision-complete spec；缺 spec 返回 `missing_spec`，有 spec 才生成短执行契约 | 缺少稳定规格书时不会输出 runnable prompt；有 spec 时输出以 spec 为唯一需求源的短 Prompt | 满足 | spec 判定是轻量文本规则，不是完整规格语义审计 |
| 长任务连续性 | 长任务中断后，应能知道当前里程碑、下一步、阻塞和证据，不靠聊天记忆猜 | RAVO Workstream 写入结构化 workstream artifact，并挂到 `knowledge/.ravo/manifest.json` | 可记录 goal、specRef、milestone、nextStep、blocker、recovery、decision、evidenceRefs | 满足 | 它不是调度器，不负责后台执行或自动推进任务 |
| 快速证据沉淀 | 阶段性脚本、smoke、风险验证应被记录，但不能被误当最终验收 | RAVO Evidence/quick-validation 写阶段性 artifact；Acceptance checker 可读取但不把它等同于最终验收 | 阶段结果能以 `pass/warn/fail/not_run` 留痕，并可进入验收证据视图 | 满足 | 内部目录仍叫 `quick-validation`，产品文案应继续强调它只是 evidence，不是最终验收 |
| Codex 发起验收 | Agent 发起验收时，应附真实响应、必要的界面截图/录屏、实际用户路径证据和 PM 验收清单，而不只是说测试脚本通过 | 当前 Acceptance artifact 支持 status、evidence level、evidence 列表、known gaps 和安全基线；checker 校验证据等级、review/knowledge evidence 和 release_ready 门槛 | 能约束“代码写完/脚本过了”不能直接说可发版；但不会自动捕获真实响应、截图界面，也不会自动生成 PM 验收清单 | 部分满足 | v0.3.1 是证据门禁，不是完整 PM 验收包生成器；截图、真实响应和验收清单应进入后续验收增强 |
| 交付/发版状态不越界 | Agent 不能因为“代码写完/脚本过了”就说可发版；必须说明证据和缺口 | Acceptance checker 根据 status、evidence level、安全基线、release evidence 判定 `ready/not_ready`；不满足时要求降级表述 | 证据不足时会降级为 code_complete/not_ready/pending_acceptance 等表述 | 满足 | 安全基线是 checklist，不是自动安全扫描；release_ready 仍需要真实 E2E 或 full external review |
| RAVO Review 真实评审 | 重要方案应能调用配置好的模型做对抗式评审；评审失败、超时、截断、部分完成都要可见 | `run-review.js` 读取 provider 配置，执行 bounded review，写 review artifact，并可保存 raw sidecar | 支持 full/partial/none/failure/timeout/truncation；没有 provider 时不会假装评审成功 | 满足 | 产品上要明确：partial review 是降级证据，不等于 full external review |
| 知识沉淀 | 有价值的经验不能只留在对话里；没有实际复用价值时，不应专门提示“没有产生知识沉淀”；也不能把项目事实静默写进全局记忆 | `capture-knowledge.js` 只有在 Agent 提供 summary/content 时才写；workspace-local 是默认；用户级知识必须 opt-in、source、applicability、sensitivity、redaction | 能把有价值经验写成 Markdown/JSON/index；不会自动写空知识，但“无价值则静默”的表达约束主要依赖 Agent 执行 | 基本满足 | 脱敏是启发式，不是完整 DLP；还缺少自动判断“这条经验是否值得沉淀”的价值门槛 |
| 经验复用 | 中高复杂度任务开始前，Agent 应同时检索项目内经验和用户授权的全局知识，因为其它项目可能有可迁移方案 | `retrieve-knowledge.js` 默认检索 workspace-local；支持 `--include-user true` 读取用户级知识目录；hook 当前只强制提示 workspace 检索，用户级知识需显式 opt-in | 项目内复用已可用；跨项目经验复用具备脚本基础，但默认流程还没有自动纳入全局检索 | 部分满足 | 需要在隐私、脱敏、过期判断和适用性说明上补产品规则，避免跨项目误用 |
| 安装与配置引导 | 新用户安装后应知道装哪些模块、配置在哪里、为什么要新开会话、怎么检查 Review/Knowledge | README/README_ZH 用安装命令、配置路径、hook trust、新会话提醒和常用命令串起首用流程 | 用户能按文档完成安装和基础诊断 | 满足 | provider key 必须用户本地配置，不能放入仓库 |
| AGENTS.md 接入 | RAVO 不应静默改用户全局规则；应该预览 diff、备份、幂等写入 | `ravo-agents.js` 支持 preview/apply/restore；snippet 说明何时委托给 analysis/review/acceptance/knowledge | 可让用户确认后再接入全局规则，并支持恢复 | 满足 | 是否写入全局 AGENTS.md 必须由用户批准 |

## 关键验收场景

### 场景 1：PM 提出一个复杂需求

需求预期：

用户说“我们想做一个复杂功能，先别开发，帮我判断怎么做”，Agent 应先进入需求共创：追问或补齐背景、现状、核心场景、消费者、痛点、参考对象、约束和验收口径；如果用户赶时间，也应提供“直接进入方案阶段”的选项。

当前效果：

RAVO Analysis 会要求 Agent 输出目标、真实消费者、约束、事实、方案、挑战、推导结论和验证方式。它能防止 Agent 跳过分析直接写代码，但当前更像一次性结构化分析，还不是稳定的 grill-me 式多轮需求共创。

验收判断：部分满足。

### 场景 2：遇到问题或挑战

需求预期：

用户只要在任务中遇到问题、异常、失败、挑战或不可解释现象，Agent 就应完成完整根因分析，而不是只在“反复问题”时才做。

当前效果：

RAVO Root Cause 对明确的根因、故障、复发、防复发类表达会要求输出 symptom、proximate cause、alternative hypotheses、mechanism root cause、why chain、verification。当前还不能保证所有普通“问题/挑战”都会自动进入完整 RCA。

验收判断：部分满足。

### 场景 3：用户要求写长程 Goal Prompt

需求预期：

没有稳定规格书时，Agent 不应该为了迎合用户直接给一段可执行 Goal Prompt。

当前效果：

RAVO 会先检查 decision-complete spec。缺 spec 时只说明需要先补规格，不输出临时版、短版或草稿版可执行 Prompt；有 spec 时输出短执行契约，并引用 spec 作为唯一需求来源。

验收判断：满足。

### 场景 4：代码写完后问能不能发版

需求预期：

用户说“代码写完、脚本过了，现在能不能发版”，Agent 不能只看开发完成状态，必须看真实验收证据。面向 PM 的验收包应包含真实响应、必要的界面截图/录屏、实际路径证据和验收清单。

当前效果：

RAVO Acceptance 会检查当前 acceptance artifact、证据等级、安全基线、review evidence、knowledge evidence。证据不足时，Agent 应说明“代码完成/待验收/不可发版”，并列出缺口。当前 artifact 能记录 evidence 和 known gaps，但不会自动生成截图、真实响应摘录或 PM 验收清单。

验收判断：部分满足。

### 场景 5：需要对重要方案做评审

需求预期：

重要方案应能被模型评审挑战；如果评审失败、超时或只完成一部分，产品也要看得见。

当前效果：

RAVO Review 可以读取 `~/.codex/skill-config/ravo-review.json`，调用配置模型，写入 review artifact。结果覆盖状态包括 `full`、`partial`、`none`，并记录失败原因、超时和截断提示。没有 provider 时不会假装评审成功。

验收判断：满足。

### 场景 6：任务结束后沉淀经验

需求预期：

有复用价值的判断应沉淀为人能读的项目知识；如果没有实际复用价值，不需要专门提示“没有产生知识沉淀”。项目事实不应静默写进用户全局知识库。

当前效果：

RAVO Knowledge 写 workspace-local Markdown + JSON index。任务 closeout 可以通过 Agent 提供的 summary/content 写入；没有 content 不会写空 artifact。用户级全局知识只有在显式 opt-in 且带 source、sensitivity、applicability、redaction 时才写。

验收判断：基本满足。

### 场景 7：开始新任务前复用经验

需求预期：

中高复杂度任务开始前，Agent 应先查项目内经验，也应在用户授权边界内查全局知识，避免其它项目里已有的可迁移经验被浪费。

当前效果：

RAVO Knowledge 默认检索 workspace-local knowledge；脚本支持 `--include-user true` 检索用户级知识目录，但当前 hook 还没有把全局检索作为默认流程。

验收判断：部分满足。

### 场景 8：简单问答

需求预期：

用户只是问概念时，RAVO 不应该让回答变复杂。

当前效果：

“RAVO Review 是什么？”这类简单问题会直接解释，不触发完整分析、评审或知识治理。v0.3.1 还修复了 delegated XML 包裹导致的误触发。

验收判断：满足。

## 仍需产品确认的边界

| 边界 | 当前产品处理 | 是否阻塞 v0.3.1 验收 |
|---|---|---|
| Hook trust | 文档和 status 提醒用户确认授权并新开会话；RAVO 本身不控制宿主授权 | 不阻塞，但安装引导必须讲清楚 |
| 需求共创 | 当前能做结构化分析，但没有稳定的多轮 grill-me 式澄清体验，也没有固定“继续澄清/直接进入方案”选项 | 不阻塞当前版本；应进入后续产品增强 |
| 根因触发范围 | 当前对明确根因/故障/复发类提示覆盖较好，对普通“问题/挑战”强制 RCA 覆盖不足 | 不阻塞当前版本；应补触发策略和负向回归 |
| PM 验收材料 | Acceptance 能约束状态和证据等级，但不会自动产出真实响应、截图/录屏和 PM 验收清单 | 不阻塞当前版本；应作为下一阶段验收体验增强 |
| Review partial | partial 是可见降级状态，可用于说明“有部分外部评审证据”，不能当 full review | 不阻塞，但发版判断必须区分 partial/full |
| 安全基线 | 当前是 checklist 和证据门禁，不是完整安全扫描器 | 不阻塞；完整扫描是后续产品 |
| 知识脱敏 | 当前用 opt-in、source、sensitivity、applicability、canary 和敏感词启发式保护 | 不阻塞；完整 DLP 是后续产品 |
| Knowledge 自动复用 | 当前默认检索项目知识；全局知识检索有脚本基础但未进入默认流程 | 不阻塞当前版本；跨项目复用需要授权、脱敏和适用性规则 |
| 无价值知识沉淀 | 当前不会自动写空 artifact，但“没价值就不专门提示”仍依赖 Agent 表达纪律 | 不阻塞；需要产品文案和 hook 规则收敛 |
| 中心调度器 | RAVO 明确不做中心 dispatcher 或后台调度 | 不阻塞；这是产品非目标 |

## 产品验收清单

PM 验收时建议按用户效果检查，而不是按脚本名检查：

- 用户能按 README 安装完整模块，并知道需要确认 hook trust、新开会话。
- 用户提出复杂需求时，Agent 先补齐背景、现状、场景、消费者、痛点、参考对象和约束；如果用户选择直接进入方案，也能明确跳过澄清的风险。
- 用户遇到问题、异常、挑战或失败时，Agent 不停在表层解释，而是完成 symptom、近因、备选假设、机制根因、why chain 和验证方式。
- 用户缺少 decision-complete spec 却要求 Goal Prompt 时，Agent 不输出可执行 Prompt。
- 用户说“代码写完、脚本过了，能不能发版”时，Agent 不越界说可发版，而是列出证据和缺口；如果是 PM 验收，应附真实响应、截图/录屏和验收清单。
- 用户要求重要方案评审时，RAVO Review 能给出 coverage 状态；失败、超时、截断或 provider 缺失都可见。
- 用户要求沉淀经验时，RAVO 只沉淀有复用价值的经验；没有价值时不需要专门提示“没有沉淀”。
- 用户开始中高复杂度任务时，RAVO 复用项目内知识；后续版本还应在授权边界内纳入用户级全局知识。
- 用户问简单概念时，Agent 直接解释，不强行套 RAVO 分析结构。

## 验收建议

从产品经理验收角度，RAVO v0.3.1 可以作为当前版本的验收基线，但不应把“部分满足”的条目包装成已经完整产品化。

建议把后续产品增强放在三条线上：

- 需求共创：为中高复杂度需求增加多轮澄清流程，并提供“继续澄清/直接进入方案”选择。
- 验收材料：Codex 发起验收时同时产出真实响应、截图/录屏、实际路径证据和 PM 验收清单。
- 经验复用：在明确授权和脱敏边界下，把用户级全局知识纳入检索，并要求说明适用性与过期风险。
