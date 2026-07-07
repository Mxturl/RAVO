# RAVO Lifecycle Governance

RAVO is a modular lifecycle-governance plugin suite for AI coding agents. It keeps the product identity unified while letting users install only the capabilities they need.

```text
R = Reason      requirements, solutions, root causes
A = Act         workstream planning and execution handoff
V = Verify      acceptance evidence and status gates
O = Organize    durable knowledge capture and reuse
```

## v0.1 Scope

- `ravo-core`: shared schemas, templates, workspace manifest, and opt-in `AGENTS.md` integration.
- `ravo-analysis`: requirement-analysis and root-cause-analysis skills that should be triggered by prompt semantics, without requiring users to name the skill.
- `ravo-acceptance`: session-level proactive acceptance rules plus a fallback prompt-time gate that checks status claims against evidence.

`ravo-workstream` and `ravo-knowledge` are intentionally deferred. v0.1 only keeps protocol compatibility points for them.

## Interaction Goal

RAVO is designed for natural interaction. Users should not have to say "call RAVO" in normal use.

- Requirement, solution, architecture, and root-cause prompts should naturally activate `ravo-analysis` through skill descriptions and future advisory hooks.
- Delivery, acceptance, release, go-live, readiness, and completed/done conclusions should be guarded proactively by `ravo-acceptance`; direct user readiness prompts are a fallback hook path.
- Explicit skill names remain useful for testing and debugging, not for everyday workflow.

## Install From This Repo

This repository uses a repo-local marketplace at `.agents/plugins/marketplace.json`.

From the repository root:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add ravo-core@ravo
codex plugin add ravo-analysis@ravo
codex plugin add ravo-acceptance@ravo
```

Start a new Codex thread after installing so skills and hooks are picked up.

### Hook Trust

Codex may ask the user to approve newly installed plugin hooks before they run. Approval is per hook event, so approving `UserPromptSubmit` does not automatically approve later `SessionStart` or `SubagentStart` hooks added by an upgrade. This approval is required for hook-based natural triggering; without it, RAVO can appear installed while hooks remain inactive. If RAVO does not react to natural prompts, approve/trust all RAVO hooks, then start a fresh Codex thread.

## Shared Artifact Protocol

RAVO modules connect through workspace files, not through a central dispatcher:

```text
knowledge/.ravo/
├── manifest.json
├── analysis/
├── acceptance/
├── workstream/
└── knowledge/
```

Single modules work alone. When multiple RAVO modules are installed, they discover upstream artifacts from `knowledge/.ravo/manifest.json`.

## AGENTS.md Integration

RAVO never silently edits `AGENTS.md`.

If a user's Agent installs RAVO automatically, that Agent should proactively offer the `AGENTS.md` integration as part of installation, show the diff preview, explain the incremental change, and ask for explicit user approval before applying it. Do not silently modify the user's rules file.

Preview the snippet:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md
```

Apply only after reviewing the diff:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --apply
```

The apply path creates a timestamped backup and updates the same marked block idempotently.

Restore from a backup:

```bash
node plugins/ravo-core/scripts/ravo-agents.js --file AGENTS.md --restore AGENTS.md.ravo-bak-...
```

## Smoke Test

```bash
node scripts/smoke-test.js
```

The smoke test initializes a temporary workspace, writes an analysis artifact, writes an acceptance artifact, and verifies that acceptance discovers analysis through the shared manifest.

## Prompt Regression Test

```bash
node scripts/prompt-regression.js
```

This runs deterministic hook-level checks for natural requirement, root-cause, trivial, and acceptance prompts. It does not replace a fresh Codex thread runtime test.

Use this before asking users to manually test prompt behavior.

RAVO Acceptance uses `SessionStart`/`SubagentStart` to inject proactive acceptance rules for delivery/completed conclusions, and `UserPromptSubmit` as a fallback blocker for direct readiness prompts. Current Codex hooks do not provide a final-response interception point.

## Prompt Test Cases

Use these in a fresh Codex thread after installing RAVO:

```text
我们正在做一个 AI 穿搭小程序，用户上传衣服照片后，系统自动生成衣橱标签。现在我想新增“旅行场景穿搭推荐”：用户输入目的地、天数、天气和行李箱大小，系统推荐每天穿什么。这个需求先别开发，帮我判断真正的用户是谁、目标是什么、有哪些边界和风险，然后给出推荐方案。
```

```text
我们的验收插件现在能拦截“可以验收了吗”，但对“这个版本是不是能发”没有触发。我觉得这可能只是关键词覆盖问题，也可能是设计模式问题。请继续追问为什么，直到找到可验证、可防复发的机制根因。
```

```text
一个 Codex 插件在空 workspace 里偶发把 release 状态判断成 ready，但实际没有 screenshots、API evidence，也没有 acceptance artifact。这个 bug 先不要改代码，先分析 symptom、proximate cause、mechanism root cause。
```

```text
我刚完成了积分扣减功能：新人赠送 20 分，AI 入橱扣 1 分，AI 试穿扣 5 分，失败要退款。代码已经写完，跑了单元测试，但还没做真实小程序端到端验证。这个功能可以验收了吗？
```

```text
现在准备发布衣橱管理 v1.2.0：后端接口已部署，前端页面已打包，小程序开发者工具能打开首页，但还没有真机截图，也没有上传衣服到生成标签的完整链路记录。现在能不能说这个版本可发版？如果证据不够，请直接指出缺哪些证据。
```
