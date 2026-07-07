# RAVO 自然治理缺口分析

日期：2026-07-07

## 结论

当前 RAVO v0.1 的主要缺口不是“完全没有自然治理”，而是三件事情仍然混在一起：

1. `UserPromptSubmit` fallback 的触发测试，被误当成了主动验收主机制的证明。
2. `ravo-analysis` 已有第一性原理骨架，但“方案必须有依据”和 Grill-me 式反向挑战还没有写成强契约。
3. 手工测试文档主要是单条 prompt，用来测语义召回可以，但不足以证明“真实开发过程中的最终交付语言”被治理住了。

## First-Principles Analysis

- goal：让 RAVO 的产品定义、skill 契约、测试方法三者对齐，减少“测试通过但产品体验不自然”的假阳性。
- constraints：
  - 当前宿主没有可靠 final-response interception hook。
  - `UserPromptSubmit` 只能是 fallback advisory，不应再承担主治理角色。
  - 不能把 skill 契约写得过重，导致每次普通分析都被模板拖慢。
- facts：
  - `ravo-acceptance` 已经从 `block` 调整为 `advisory`，但现有测试样例仍偏向“用户主动问 readiness”。
  - `ravo-requirement-analysis` 只要求 `Goal/Consumer/Constraints/Options/Derived Conclusion/Validation`，没有强制区分事实与假设，也没有要求挑战首选方案。
  - `ravo-root-cause-analysis` 要求 Why-chain，但没有显式要求比较竞争性假设。
  - README 中虽然强调自然交互与证据匹配，但测试文档没有把“快速触发测试”和“真实流程测试”拆开。
- root cause：产品定义强调“自然治理”，但工程落地主要集中在触发层和门禁层，分析质量约束与测试分层还不够产品化。
- derived conclusion：
  - 把“依据约束 + 反向挑战”写进 `ravo-analysis` skill 契约。
  - 把“快速语义触发测试”和“真实短流程测试”拆成两套文档。
  - 明确说明：单条 readiness prompt 只能验证 fallback，不代表主动验收主机制已被证明。

## 落地修改

- `ravo-requirement-analysis` 新增 `Facts` 和 `Challenge` 契约，并要求区分事实/推断/假设。
- `ravo-root-cause-analysis` 新增 `Alternative Hypotheses` 契约，并要求对主假设做一次竞争性验证。
- `ravo-analysis` advisory 文案与回归测试同步更新。
- 新增 `docs/runtime-flow-tests.md` 与 `docs/runtime-flow-tests-zh.md`，专门覆盖真实短流程测试。
- `docs/quick-test-cases*.md` 改为显式标注“这只是语义触发测试”。

## 边界

- 这些修改仍不能把 v0.1 变成宿主级 final-response 硬门禁。
- Agent 主动验收仍依赖 `SessionStart`/`SubagentStart` 注入的规则、hook trust，以及模型遵守约束。
- 如果未来宿主提供 assistant pre-send / final-response hook，验收主机制还应继续下沉为真正出口 gate。
