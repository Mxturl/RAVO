# RAVO v0.2 Goal Prompt

Use only after accepting:

- `/Users/apple/Developer/AICODING/RAVO/docs/ravo-v0.2-decision-complete-spec.md`

```text
目标：
在仓库 /Users/apple/Developer/AICODING/RAVO 中，严格按照 /Users/apple/Developer/AICODING/RAVO/docs/ravo-v0.2-decision-complete-spec.md 完成 RAVO v0.2 的全部开发、验证、文档、评审、验收、提交和推送工作。

完成标准：
1. 规格书中标记为 required 的能力全部实现。
2. 规格书中的验证矩阵全部通过，或明确记录阻塞原因和恢复入口。
3. 完成真实 Codex session/subagent E2E 验证，不得仅用脚本测试替代。
4. 最终运行 RAVO acceptance evidence check，状态和证据一致。
5. 提交并推送到 GitHub，最终报告包含 commit、验证证据、剩余风险。

执行要求：
- 以规格书为唯一需求来源；不要把本 Prompt 当作需求补充。
- 如果规格书与本 Prompt 冲突，以规格书为准。
- 如果上下文变长，重新读取规格书和 RAVO artifacts 后继续。
- 证据不足时不得声称验收通过、可发版、已完成或已发布。
```
