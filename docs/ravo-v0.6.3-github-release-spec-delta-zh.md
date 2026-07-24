# RAVO v0.6.3 GitHub 发布 Spec Delta

Status: decision-complete

Date: 2026-07-24

Parent Spec: `docs/ravo-v0.6.3-reliable-closeout-decision-complete-spec-zh.md`

Release Slice: `ravo-v0.6.3-github-release`

Release Profile: `open-source` / `versioned-release`

Base: `v0.6.2`，远端 `main` commit `7de7f94e9c6edd320e4d7821b4416a283be8f253`

Authorization Source: PM 于 2026-07-24 明确要求“验收 0.6.3，并发布 GITHUB”。该表述确认当前 v0.6.3 产品体验，并授权进入 GitHub 发布流程；首次远端写入仍需绑定具体账户、仓库、分支、Commit、Tag、Release 和恢复路径的不可变发布计划。

## 1. 目标

把已经完成实现、本机验证并获得 PM 接受的 RAVO v0.6.3，作为 `Mxturl/RAVO` 的公开版本发布，同时确保当前工作区中的内部证据、并行 AppWorld 工作和其它未锁定内容不进入候选。

## 2. 必须交付

- 基于远端 `main` 创建 `release/v0.6.3` 候选，只纳入父 Spec 的实现、测试、v0.6.3 公开 Spec 和版本发布材料；
- 公开 README、`CHANGELOG.md`、`package.json`、插件版本和 `docs/launch/index.html` 统一为 `0.6.3`；
- 运行候选树的项目测试、版本一致性、插件预检、发布边界、凭据与隐私审计；
- 记录 PM 接受，并以当前发布任务绑定的 RAVO Acceptance 检查状态语言；
- 使用不可变 GitHub 发布计划，依次完成发布分支、Pull Request、用户管理的合并、annotated Tag、GitHub Release 和公开结果验证；
- 远端 `main`、Tag 与 Release 必须绑定同一经审计的实际合并 commit。

## 3. 发布边界

允许公开：维护中的插件源码、测试、模板、README、Changelog、v0.6.3 产品 Spec、发布 Delta 和既有发布页资产。

禁止公开：`knowledge/.ravo/`、原始 Acceptance/Review/会话证据、本机路径、凭据、日志、发布计划文件，以及 AppWorld benchmark、远端 Provider 和其它并行 Workstream 的文件。

本 Delta 不授权自动合并、强推、移动或删除 Tag、删除 Release、修改仓库可见性、修改 Pages 来源、部署、包注册表发布或其它远端资源操作。

## 4. 验证与状态

- PM 接受只证明当前产品体验通过，不等于发布条件满足或已经发布；
- `release_ready` 需要候选树自动验证、真实本机体验、完整安全基线、公开边界审计和发布前 RAVO Acceptance 同时通过；
- 创建 Pull Request 后必须等待用户在 GitHub 合并；实际 merge commit 成为后续 Tag 与 Release 的唯一目标；
- 只有远端 Tag、GitHub Release、默认分支内容和公开发布页均完成查询验证后，才能声称 v0.6.3 已发布。

## 5. 失败与恢复

| 条件 | 影响 | 降级 | 恢复入口 |
|---|---|---|---|
| 候选树测试或安全审计失败 | 不具备发布条件 | 保留本机可用的 v0.6.3，不执行远端写入 | 修复候选并重新绑定测试与审计 |
| 远端状态与发布计划漂移 | 当前授权失效 | 停止后续动作，不覆盖远端 | 重新读取状态并生成新计划 |
| PR 尚未合并 | 不能创建最终 Tag 与 Release | 保留已推送分支和 PR | 用户完成合并后绑定实际 merge commit |
| Tag 或 Release 部分成功 | 发布处于部分完成 | 保留已成功对象，不自动删除 | 核对远端并生成新的恢复计划 |

## 6. 完成标准

1. v0.6.3 候选只包含允许公开的当前版本内容；
2. 自动验证、RAVO Review、RAVO Acceptance、安全基线和公开边界审计与状态语言一致；
3. PR 合并后的远端默认分支、annotated `v0.6.3` Tag 和 GitHub Release 指向同一实际 commit；
4. GitHub Release 可查询，README 安装路径和公开发布页可用；
5. 最终报告分别说明实现、自动验证、本机可用、PM 接受、发布条件和已发布状态。
