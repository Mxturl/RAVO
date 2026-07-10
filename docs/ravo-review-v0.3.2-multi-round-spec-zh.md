# RAVO Review v0.3.2 多轮编排一期迭代规格书

日期：2026-07-09

状态：decision-complete for development planning

来源：RAVO Review 超时与轮次能力回归排查；用户明确要求 `rounds` 支持 1 到 3 轮、默认 2 轮，并恢复旧版二轮评审的真实能力。

## 产品定义

RAVO Review v0.3.2 要把“可配置轮数”升级为“真实多轮评审编排”。

一期交付的核心不是让 runner 多调用几次模型，而是让每一轮承担不同职责：

- 第一轮：独立挑错，形成原始风险集合。
- 第二轮：基于一轮结果生成挑战 brief，让 reviewer 回应争议、补证据、收回或坚持判断。
- 第三轮：基于二轮结果做收敛/裁决检查，确认关键分歧、残余风险和最终建议是否站得住。

如果没有跨轮综合、挑战 brief、复审输入隔离、收敛规则和逐轮证据，`rounds=3` 只是参数变多，产品价值接近 0。v0.3.2 的成功标准是：用户配置 1、2、3 轮时，review 的行为、输入、产物和验收证据都能看出实质差异。

## 背景与根因

### 当前问题

当前插件化 runner 已支持 `rounds` 读取、默认 2、限制 1 到 3，但实现仍偏浅：

- 后续轮次主要复用上一轮文本摘要。
- 没有正式的 challenge brief 生成规则。
- 没有把旧版 `discussion-file` 的二轮追问机制迁成默认可用能力。
- 没有逐轮 issue 状态流转，比如 `open`、`accepted`、`rebutted`、`resolved`、`residual`。
- 没有三轮收敛/裁决语义。
- artifact 记录了 `roundCoverage`，但不足以证明每轮输入和职责真的不同。

### 为什么旧版二轮能力没有完整迁过来

根因不是单个 bug，而是迁移目标被收窄了。

v0.3.1 的插件化重点放在“从 artifact 记录升级到真实 provider 调用”和“让 review evidence 进入 acceptance”，因此 runner 被实现成一个轻量调用器。旧版 standalone skill 中更有产品价值的能力，也就是 `discussion-file` 触发的轻量二轮复审，没有被列成 v0.3.1 必须迁移的验收项。

旧版二轮能力的关键语义是：

- 二轮不是重发完整 proposal。
- 二轮输入包含必要 context、该 reviewer 自己的一轮 JSON、Codex 写的紧凑争议摘要。
- 二轮输出作为 rebuttal / revision 层保留，不静默覆盖一轮基线。
- 二轮覆盖状态独立记录。

当前插件 runner 只迁到了“可以有多轮调用”的外壳，没有迁到“Codex 挑战 reviewer 并收敛争议”的机制。

### 一期挑战

本迭代必须回答一个显式挑战：

> 配置成 3 轮时，第三轮到底改变了什么？

答案必须能从代码行为和 artifact 中验证，而不是只靠文档描述。

## 真实消费者

主要消费者是使用 Codex/RAVO 做重要需求、架构、测试、验收、安全和 Agent 工作流决策的人。他们需要知道评审意见是否经过独立挑错、复审反驳和最终收敛，而不是只看到“跑过若干模型”。

次要消费者是 RAVO 维护者。他们需要明确的 runner 合约、artifact schema 和回归测试，避免未来重构时再次把“多轮编排”退化成“重复调用”。

验收消费者是 RAVO Acceptance。它需要能区分：

- 单轮独立 review。
- 二轮复审 review。
- 三轮收敛 review。
- 部分失败、超时、截断和跳过的 degraded review。

## 一期目标

### 必须完成

- `rounds` 配置支持 `1 | 2 | 3`，默认 `2`。
- `rounds=1` 只做独立评审，并明确记录没有复审/收敛。
- `rounds=2` 做独立评审加挑战复审，恢复旧版二轮能力的核心价值。
- `rounds=3` 做独立评审、挑战复审、收敛裁决三段式编排。
- 每一轮的 prompt 输入必须不同，并在测试中可验证。
- 每一轮的职责、输入来源、覆盖状态、失败原因必须进入 artifact。
- 二轮默认能自动生成 challenge brief；同时保留手写 `--discussion-file` 作为更高质量输入。
- 三轮必须消费二轮后的 issue 状态和 Codex provisional decision，而不是再次重复原始 proposal。
- 超时、截断、provider 失败和部分轮次失败必须保留为证据，不得冒充 full coverage。
- 文档、配置模板、smoke test、prompt regression 和 installed plugin cache 行为保持一致。

### 明确不做

- 不做无限轮或开放式模型辩论。
- 不做 reviewer 之间互相看到完整对话的群聊式 debate。
- 不做 GUI。
- 不引入中心调度器。
- 不把 RAVO Review 变成发布 readiness 的替代品。
- 不默认发送敏感数据到外部模型。
- 不要求所有普通任务都跑三轮。

## 关键产品决策

### D1：`rounds` 表示目标编排轮数，不只是最大尝试次数

默认语义：

- `rounds=1`：执行 Round 1。
- `rounds=2`：执行 Round 1 和 Round 2。
- `rounds=3`：执行 Round 1、Round 2 和 Round 3。

只有在数据边界阻断、无任何可用 reviewer、上一轮没有可用于下一轮的结果、用户中断或总超时触发时，才允许提前停止。提前停止必须写入 `stopReason`。

一期不默认做 adaptive early stop。原因是 adaptive stop 会让“配置 3 轮是否真的跑了”变得含糊。后续可以作为 `roundPolicy=adaptive` 增量设计。

### D2：默认 2 轮

默认 2 轮是产品平衡点：

- 比单轮多一个“挑战和复核”闭环。
- 成本和时延仍可控。
- 与旧版二轮能力的产品意图一致。

### D3：三轮是高风险场景的显式选择

三轮适合：

- 架构、权限、数据迁移、Agent workflow、验收规则等高影响决策。
- 一轮和二轮出现强分歧。
- Codex 接受/拒绝 reviewer 意见后，需要外部模型再检查裁决是否自洽。

三轮不应成为所有 review 的默认值。

### D4：二轮和三轮都必须有中间产物

多轮能力的可验收中间产物包括：

- Round 1 normalized findings。
- Round 2 challenge brief。
- Round 2 rebuttal findings。
- Codex provisional decisions。
- Round 3 convergence brief。
- Final issue ledger。

没有这些中间产物，就不能宣称实现了多轮编排。

## 用户可见行为

### 配置

配置文件：`~/.codex/skill-config/ravo-review.json`

新增/明确字段：

```json
{
  "rounds": 2,
  "roundsEnabled": true,
  "roundTimeoutMs": 300000,
  "overallTimeoutMs": 900000,
  "retry": {
    "maxAttempts": 2,
    "baseDelayMs": 1000,
    "maxDelayMs": 8000,
    "retryableStatusCodes": [429, 502, 503, 504]
  },
  "challengeBriefMaxChars": 12000,
  "convergenceBriefMaxChars": 12000
}
```

字段语义：

| 字段 | 类型 | 默认值 | 说明 |
|---|---:|---:|---|
| `rounds` | `1 | 2 | 3` | `2` | 目标编排轮数 |
| `roundsEnabled` | boolean | `true` | 兼容开关；关闭时等价于 `rounds=1` 并记录原因 |
| `roundTimeoutMs` | number | `300000` | 单轮整体预算 |
| `overallTimeoutMs` | number | `900000` | 整次 review 总预算 |
| `retry.maxAttempts` | number | `2` | 单个模型每轮最大尝试次数，含首次请求 |
| `retry.baseDelayMs` | number | `1000` | retry 初始等待 |
| `retry.maxDelayMs` | number | `8000` | retry 最大等待 |
| `retry.retryableStatusCodes` | number[] | `[429,502,503,504]` | 可重试 HTTP 状态 |
| `challengeBriefMaxChars` | number | `12000` | 二轮挑战 brief 上限 |
| `convergenceBriefMaxChars` | number | `12000` | 三轮收敛 brief 上限 |

配置校验：

- `rounds` 不是整数时失败。
- `rounds < 1` 或 `rounds > 3` 时失败。
- `rounds=2/3` 但 provider 全部不可用时，artifact 写 `coverage=none` 和 `executionState=unavailable`。
- `rounds=3` 但 Round 2 无可用结果时，Round 3 跳过，artifact 写 `stopReason=round2_no_completed_models`。

### CLI

保留并明确：

```bash
node plugins/ravo-review/scripts/run-review.js \
  --workspace . \
  --domain architecture \
  --file proposal.md \
  --rounds 2
```

新增/明确：

```bash
node plugins/ravo-review/scripts/run-review.js \
  --domain architecture \
  --file proposal.md \
  --rounds 3 \
  --discussion-file round2-challenge.md
```

`--discussion-file` 语义：

- 仅在 `rounds >= 2` 时允许。
- 作为 Round 2 challenge brief 的人工覆盖输入。
- 不再代表“是否启用二轮”，因为二轮由 `rounds` 控制。
- 如果未传入，runner 自动生成 Round 2 challenge brief。

## 多轮工作流

### Round 1：独立评审

目的：独立发现风险、证据缺口和建议。

输入：

- 原始 subject。
- 可选 context。
- review domain。
- 统一 rubric。

不输入：

- 其他 reviewer 的意见。
- Codex 的判断。
- 后续轮次的综合。

输出：

- 每个 reviewer 的原始结果。
- normalized findings。
- 初始 issue ledger。
- Round 1 coverage。

Round 1 artifact 必须记录：

- `purpose=independent_review`
- `inputRefs.subject`
- `inputRefs.context`
- `inputHash`
- `modelsRequested`
- `modelsCompleted`
- `modelsFailed`
- `coverage`

### Round 2：挑战复审

目的：让 reviewer 回应一轮中的争议、证据不足和 Codex 质疑。

输入：

- 必要 context。
- 该 reviewer 自己的 Round 1 结果。
- Round 2 challenge brief。
- 可选 subject 摘录，只能包含和争议点相关的片段。

不输入：

- 完整原始 subject，除非 subject 很短并且不会造成成本/噪音问题。
- 其他 reviewer 的完整原始输出。
- 未经过滤的敏感数据。

challenge brief 生成规则：

- 合并重复 issue。
- 标记高/中风险 issue。
- 标记 reviewer 之间结论冲突的 issue。
- 标记缺少证据但影响结论的 issue。
- 标记 Codex 初步不同意的 issue，并要求 reviewer 给出更强证据或降级。
- 对每个 issue 给出明确问题：坚持、修正、撤回、补证据、转为残余风险。

输出：

- reviewer 对一轮意见的坚持/修正/撤回。
- 新增或降级风险。
- Round 2 issue 状态变更。
- Round 2 coverage。

Round 2 artifact 必须记录：

- `purpose=challenge_response`
- `challengeBriefRef`
- `challengeBriefHash`
- `perReviewerInput=true`
- `usesReviewerOwnRound1Only=true`
- `subjectReplayMode=none | excerpt | full_short_subject`
- `issueTransitions`

### Round 3：收敛裁决

目的：检查 Codex 对评审意见的最终处理是否自洽，确认仍未解决的关键风险。

输入：

- Round 1 issue ledger。
- Round 2 issue transitions。
- Codex provisional decisions：`accept | partial | reject | defer`。
- residual risk list。
- Round 3 convergence brief。

不输入：

- 原始 subject 全量重放。
- 所有 reviewer 原文堆叠。
- 与最终裁决无关的长上下文。

convergence brief 生成规则：

- 只包含仍为 `open`、`contested`、`residual`、`deferred` 的 issue。
- 包含 Codex 对每个 issue 的临时裁决和理由。
- 要求 reviewer 检查：裁决是否误解证据、是否遗漏高风险、是否把 partial 误写成 accepted、是否需要升级验收要求。

Codex provisional decision 生成规则：

- 必须由确定性 helper 生成，而不是只靠自由文本总结。
- 输入至少包含 issue severity、evidence、reviewer recommendation、已做/计划做的实现变更、用户约束和已知证据缺口。
- 输出必须包含 `codexDecision`、`codexDecisionReason`、`confidence`。
- `critical/high` 且无反证的 issue 不得自动 `reject`。
- 证据不足时只能 `partial` 或 `defer`，不得 `accept`。

输出：

- final objections。
- convergence status：`converged | converged_with_residuals | unresolved`.
- 最终 issue ledger。
- final recommendations。
- Round 3 coverage。

Round 3 artifact 必须记录：

- `purpose=convergence_adjudication`
- `convergenceBriefRef`
- `convergenceBriefHash`
- `provisionalDecisionCount`
- `finalIssueStatusCounts`
- `convergenceStatus`

## Issue Ledger 合约

多轮 review 必须围绕 issue ledger 流转，而不是围绕大段文本摘要流转。

最小 issue 字段：

```json
{
  "id": "RR-001",
  "title": "string",
  "category": "requirements|architecture|implementation|testing|acceptance|security|operations|other",
  "severity": "critical|high|medium|low",
  "evidence": "string",
  "recommendation": "string",
  "sourceModelsByRound": {
    "1": ["provider/model"],
    "2": ["provider/model"],
    "3": ["provider/model"]
  },
  "status": "open|accepted|partially_accepted|rejected|rebutted|resolved|residual|deferred",
  "codexDecision": "accept|partial|reject|defer|none",
  "codexDecisionReason": "string",
  "proposalChange": "string",
  "residualRisk": "string"
}
```

Issue 合并规则：

- 按底层风险合并，而不是按措辞合并。
- 保留强少数意见。
- reviewer 新增高风险 issue 时必须新增 issue id，不得塞进 summary。
- 被撤回的 issue 不删除，状态改为 `rebutted` 或 `resolved`。

## Artifact Schema 变更

现有字段保留：

- `schemaVersion`
- `id`
- `domain`
- `coverage`
- `modelsRequested`
- `modelsCompleted`
- `modelsFailed`
- `failedModelReasons`
- `timing`
- `truncationWarnings`
- `summary`
- `risks`
- `recommendations`
- `rawResultRef`
- `createdAt`

新增/强化字段：

```json
{
  "roundsRequested": 2,
  "roundsExecuted": 2,
  "roundStopReason": "",
  "roundPolicy": "fixed",
  "orchestrationVersion": "multi-round-v1",
  "roundCoverage": [
    {
      "round": 1,
      "purpose": "independent_review",
      "coverage": "full",
      "modelsRequested": [],
      "modelsCompleted": [],
      "modelsFailed": [],
      "inputRef": "knowledge/.ravo/review/inputs/...",
      "inputHash": "sha256:..."
    }
  ],
  "briefs": {
    "challengeBriefRef": "knowledge/.ravo/review/briefs/...",
    "convergenceBriefRef": "knowledge/.ravo/review/briefs/..."
  },
  "issueLedgerRef": "knowledge/.ravo/review/issues/...",
  "issueStatusCounts": {
    "open": 0,
    "accepted": 0,
    "partially_accepted": 0,
    "rejected": 0,
    "residual": 0,
    "deferred": 0
  },
  "convergenceStatus": "not_requested|converged|converged_with_residuals|unresolved"
}
```

Coverage 规则：

- `coverage=full`：所有请求轮次都完成，所有请求模型在每轮都有可用输出，且无截断/超时警告。
- `coverage=partial`：至少一个模型产生可用输出，但任一请求轮次、模型、解析或截断存在降级。
- `coverage=none`：没有外部 review 输出可用。

`roundsRequested=3` 但只执行 2 轮时，顶层 coverage 不能是 `full`。

## 超时、成本与并发

多轮会放大时延和成本，一期必须把预算显式化。

要求：

- 每个模型调用有 `perModelTimeoutMs`。
- 每轮有 `roundTimeoutMs`。
- 整次 review 有 `overallTimeoutMs`。
- 到达总预算时停止后续轮次，写入 `roundStopReason=overall_timeout`。
- 每个模型每轮必须支持 retry；默认最多 2 次 attempt。
- 只重试 timeout、连接中断、429、502、503、504；不重试 400/401/403、数据边界阻断和非临时解析失败。
- stream 失败转 buffered 是 fallback attempt，不等同于 timeout retry；artifact 必须区分 `fallbackAttempt` 与 `retryAttempt`。
- retry 不得突破 `roundTimeoutMs` 和 `overallTimeoutMs`；预算不足时跳过 retry 并记录 `retrySkipped=budget_exhausted`。
- provider 默认按 `providerConcurrency=1` 顺序执行，避免并发触发 429。
- 允许后续配置并发，但必须按 provider 维度限制。
- Round 2 只复审 Round 1 完成的 reviewer。
- Round 3 只对 Round 2 完成的 reviewer 发起收敛检查。

超时用户体验：

- 输出必须说明卡在哪一轮、哪个模型、哪个 timeout。
- artifact 不能只写“review timeout”，必须写 `round`、`model`、`timeoutType`。
- artifact 必须写 `attempts[]`，包含 `attempt`、`round`、`model`、`reason`、`delayMs`、`timeoutMs`、`result`。
- acceptance 只能把它视为 `partial_external_review` 或 `none`，不能视为完整 review。

## 数据边界与安全

外部 review 前必须检查：

- 原始 subject。
- context。
- 自动生成的 challenge brief。
- 人工传入的 `discussion-file`。
- convergence brief。
- raw reviewer 输出中是否包含不应再次发送的敏感内容。

规则：

- credentials、secret、customer data、private personal data 默认阻断外发。
- brief 生成必须尽量引用 issue 摘要，不复制大段敏感原文。
- raw sidecar 不得包含 API key。
- 命令输出不得打印 API key。
- artifact 中 provider config 只能记录 provider id / model id /失败类型，不能记录密钥或完整 header。

## 兼容与迁移

### 对旧版 standalone 能力的迁移

必须迁移的旧版语义：

- `--discussion-file` 作为 Round 2 的紧凑挑战 brief。
- 二轮只让 reviewer 看自己的 Round 1 结果。
- 二轮覆盖状态独立可见。
- 二轮结果不覆盖一轮基线。

需要调整的语义：

- 旧版“不传 `--discussion-file` 就不启用二轮”改为“`rounds` 决定轮数，`--discussion-file` 只是人工覆盖 challenge brief”。
- 旧版默认单轮改为插件默认二轮。

### 对当前插件 runner 的迁移

必须移除或替换的浅层行为：

- 后续轮次只拼接 `Prior round findings` 的 prompt。
- 后续轮次重复包含原始 subject excerpt 作为主要输入。
- 没有 issue ledger 的纯文本 summary 流转。
- `second_round_coverage` 作为单独遗留字段但没有通用 round abstraction。

保留：

- `roundCoverage` 概念。
- fake provider 验证路径。
- full/partial/none coverage。
- truncation/timeout/provider-error 的显式记录。
- manifest 更新。

## 验收标准

### 功能验收

- 配置缺省时，runner 使用 `rounds=2`。
- `--rounds 1` 只执行 Round 1，artifact 写 `roundsRequested=1`、`roundsExecuted=1`、`convergenceStatus=not_requested`。
- `--rounds 2` 执行 Round 1 和 Round 2，artifact 含 `challengeBriefRef` 和 Round 2 `purpose=challenge_response`。
- `--rounds 3` 执行三轮，artifact 含 `convergenceBriefRef`、Round 3 `purpose=convergence_adjudication`、`convergenceStatus`。
- `--discussion-file` 在 `rounds=2/3` 时覆盖自动 challenge brief。
- `--discussion-file` 在 `rounds=1` 时失败并提示需要 `rounds>=2`。
- provider 全不可用时写 `coverage=none`，不伪造二轮或三轮成功。
- Round 2 某模型失败时保留 Round 1 结果，顶层 coverage 为 `partial`。
- Round 3 失败时保留前两轮结果，顶层 coverage 为 `partial`，并写 `roundStopReason` 或 failed reasons。

### Prompt 回归验收

fake provider 或 prompt-capture 测试必须证明：

- Round 1 prompt 包含原始 subject，不包含 prior findings。
- Round 2 prompt 包含 challenge brief 和该模型 Round 1 结果。
- Round 2 prompt 不包含其他模型完整 Round 1 原文。
- Round 3 prompt 包含 convergence brief、provisional decisions 和未解决 issue。
- Round 3 prompt 不把原始 subject 当作主要输入重放。
- 三轮 prompt 的 `purpose` 和关键输入 hash 不同。

### Artifact 验收

- `roundCoverage.length === roundsExecuted`。
- `roundCoverage[*].purpose` 非空。
- `roundCoverage[*].inputHash` 非空。
- `roundsRequested=3` 且 `roundsExecuted<3` 时，顶层 coverage 不能为 `full`。
- issue ledger 文件存在且能被 JSON parse。
- brief 文件存在且不超过配置大小上限。
- raw sidecar 不包含 API key。
- manifest 指向最新 review artifact。

### 文档与迁移验收

- README/README_ZH 解释 1、2、3 轮差异。
- 配置模板包含 `rounds` 默认 2。
- skill 文档不再暗示 `rounds` 只是重复调用。
- smoke test 覆盖 1、2、3 轮 fake provider。
- prompt regression 覆盖默认二轮和三轮收敛。
- installed plugin cache 与源码行为一致。
- 用户可见文档不出现旧入口名，除非在历史迁移说明中必要提及。

## 一期实施计划

### 阶段 1：编排模型与 schema

- 定义 `RoundPurpose`、`IssueLedger`、`BriefRef`、`RoundCoverage`。
- 给现有 artifact writer 增加兼容字段。
- 写 JSON fixture 和 schema-level tests。

### 阶段 2：Round 2 恢复

- 实现 Round 1 finding normalization。
- 实现自动 challenge brief。
- 实现 `--discussion-file` 覆盖逻辑。
- 确保 Round 2 只看本 reviewer 的 Round 1 结果。
- 补 fake provider prompt-capture 测试。

### 阶段 3：Round 3 收敛

- 实现 provisional decision ledger。
- 实现 convergence brief。
- 实现 Round 3 prompt 和 artifact 字段。
- 补三轮 fake provider 测试。

### 阶段 4：超时、失败与安全

- 加总预算和逐轮预算。
- 按 round/model 记录 timeout。
- 增加 retry policy、attempts artifact 和预算耗尽时的 retry skip 记录。
- 加 brief 数据边界检查。
- 检查 raw/output/API key 泄漏。

### 阶段 5：文档、安装缓存与验收

- 更新 README、README_ZH、skill、config template。
- 更新 smoke-test、prompt-regression、validate-repo。
- 同步 installed plugin cache。
- 运行 `validate-repo`、`smoke-test`、`prompt-regression`。
- 写 RAVO Acceptance artifact，并明确是否达到 release-ready。

## 发布口径

v0.3.2 完成后可以说：

> RAVO Review 支持 1 到 3 轮真实编排，默认 2 轮。二轮会基于一轮结果生成挑战 brief 并让 reviewer 复审；三轮会基于二轮结果和 Codex 临时裁决做收敛检查。每轮覆盖、失败、超时、截断和 issue 状态都会进入 artifact。

不能说：

> RAVO Review 三轮后一定能给出正确结论。

也不能把：

> fake provider 三轮通过

说成：

> 外部 review 已完整验收。

## 验证矩阵

| 场景 | 期望 |
|---|---|
| 默认配置 | `roundsRequested=2`，执行二轮 |
| `--rounds 1` | 只执行独立评审 |
| `--rounds 2` | 生成或读取 challenge brief，执行挑战复审 |
| `--rounds 3` | 生成 convergence brief，执行收敛裁决 |
| `--rounds 0/4/foo` | 失败并提示 1 到 3 |
| `--discussion-file` + `--rounds 1` | 失败并提示需要二轮以上 |
| Round 1 部分失败 | Round 2 只复审成功模型，顶层 partial |
| Round 2 部分失败 | Round 3 只裁决成功模型，顶层 partial |
| Round 3 失败 | 保留前两轮，顶层 partial |
| provider 未配置 | `coverage=none`，不伪造 review |
| 模型输出截断 | `truncationWarnings` 指明 round/model |
| timeout retry | timeout/429/5xx 按策略重试，`attempts[]` 可见 |
| 总超时 | `roundStopReason=overall_timeout` |
| raw sidecar 检查 | 不包含 API key |

## 推导结论

一期正式迭代应以“恢复并产品化旧版二轮复审语义”为主线，而不是继续扩展浅层 `rounds` 参数。

最小正确方案是：

- 默认二轮。
- 三轮显式可选。
- 每轮职责不同。
- 中间 brief 和 issue ledger 可追踪。
- coverage 与失败状态逐轮记录。
- 旧版 `discussion-file` 语义迁入新 runner，但由 `rounds` 统一控制轮数。

只有做到这些，`rounds=3` 才有实际产品效果。
