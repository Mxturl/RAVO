# RAVO 与全局 AGENTS 边界调整

日期：2026-07-07

## 结论

本次调整把 RAVO 与 Codex 全局 `AGENTS.md` 的职责拆开：

- `AGENTS.md` 负责决定何时委派：全局优先级、安全边界、交互风格、数据边界、fallback 行为。
- RAVO 负责委派后的执行：分析结构、验收证据、scripts、schemas、hooks、artifacts。

这避免了两个问题：全局规则把简单解释误判成必须走第一性原理分析，以及 RAVO 文档把未实现模块描述成已经完整接管。

## First-Principles Analysis

- goal：让默认 Codex 治理与 RAVO 插件能力互补，而不是互相覆盖或重复。
- constraints：
  - 不同用户的全局 `AGENTS.md` 结构差异很大，不能机械幂等插入固定大段文本。
  - RAVO v0.1 完整实现的是 `analysis` 和 `acceptance`，`workstream` 与 `knowledge` 只是协议兼容点。
  - 当前宿主的 prompt-time hooks 不能替代 Agent 主动验收。
- facts：
  - 全局 `AGENTS.md` 之前存在较强第一性原理规则，可能把概念解释类问题过度结构化。
  - `ravo-agents.js` 之前的 snippet 没有明确 `when/how` 边界。
  - README 已说明 hooks 需要信任，但需要更明确提醒安装 Agent 在自然触发失效时检查 hook 授权。
  - Windows CRLF 反馈说明仓库校验必须兼容不同 checkout 行尾。
- root cause：治理规则、插件能力和安装说明都在描述“生命周期治理”，但没有明确分层，导致默认规则可能抢占 RAVO，RAVO 安装说明也可能诱导机械插入。
- derived conclusion：把全局 `AGENTS.md` 压缩为委派规则，把具体执行契约下沉到 RAVO skill/plugin，并在 README 中要求 Agent 安装模式必须先读全局 `AGENTS.md`、提出选择性合并、展示 diff、等用户批准。

## 实施内容

- 更新本机 Codex 全局 `AGENTS.md`：
  - 新增 `RAVO Delegation` 与 `Governance Fallbacks` 分层。
  - 保留全局优先级、安全、语言、用户价值等非 RAVO 规则。
  - 保留外部发送前的数据边界检查，避免外部评审或其它外发场景泄露敏感信息。
  - 明确简单概念解释、术语定义、直接事实问答、基础 how-to 不强制套第一性原理结构。
- 更新 RAVO：
  - `templates/agents-snippet.md` 与 `ravo-agents.js` 改为 `AGENTS.md decides when / RAVO decides how`。
  - README/README_ZH 增加手动安装与 Agent 安装两种 AGENTS 接入引导。
  - README/README_ZH 明确默认目标是 Codex 全局 `AGENTS.md`，不是项目级 `AGENTS.md`。
  - README/README_ZH 强调 hooks 授权可能不明显，安装后自然触发异常时应主动检查。
  - prompt regression 增加简单概念解释不触发重型分析、AGENTS 预览包含委派边界。

## 验证

- `node scripts/validate-repo.js`：通过。
- `node scripts/prompt-regression.js`：通过。
- `node scripts/smoke-test.js`：通过。
- 本地重新安装 `ravo-core@ravo`、`ravo-analysis@ravo`、`ravo-acceptance@ravo` 后，缓存侧 `ravo-agents.js` 已包含最新 snippet。

## 对抗式评审回应

- `model-review-council` 首次全模型运行超时，`glm-5.2,kimi-k2.7-code` 重试返回上游 502；随后用 `deepseek-v4-pro`、`qwen3.7-max`、`MiniMax-M2.5` 单模型重试取得外部反馈。
- 采纳：增加复杂架构/多步骤任务仍触发 `ravo-analysis` 的正向回归测试，避免简单问题豁免误伤复杂任务。
- 修复：复杂架构用例暴露 `先不要实现` 没被识别为“先分析、不开发”语义，已补入 `ravo-analysis-gate` 召回规则。
- 采纳：增加 `ravo-agents.js --apply` 对已有 `AGENTS.md` 的保留、备份、幂等测试，覆盖 Agent 安装模式的基础安全边界。
- 采纳：新增 `.gitattributes`，固定主要文本文件 LF 行尾，并纳入 `validate-repo.js`，降低 Windows checkout 差异导致的误报风险。
- 部分采纳：真实 Codex 运行时是否加载新全局 `AGENTS.md` 无法由仓库脚本完全证明；保留为需要新会话验证的运行时边界。

## 残余边界

- 当前调整不能让旧会话自动重新加载新 plugin skill/hook；安装后仍需要新开 Codex thread。
- RAVO 的自然治理依赖 skill 召回、hook trust 与 Agent 遵守交付前验收规则；没有宿主 final-response hook 时，仍不能做真正出口硬门禁。
- Agent 安装模式无法安全自动判断所有用户自定义规则含义，因此 README 只能要求“读取、判断、展示 diff、等待批准”，不能承诺完全自动融合。
