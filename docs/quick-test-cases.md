# RAVO Quick Test Cases

These prompts are designed for a fresh Codex session with no project context. Each one is short, should finish quickly, and is meant to test one RAVO behavior at a time.

## 1. Requirement Analysis

Prompt:

```text
I want to build a simple habit tracker app. Do not write code yet. First tell me who the real user is, what the goal is, what constraints matter, and which solution you recommend.
```

Expected effect:

- RAVO should favor requirement analysis over direct implementation.
- The answer should cover goal, consumer, constraints, options or tradeoffs, and a recommendation.

## 2. Root-Cause Analysis

Prompt:

```text
A plugin works in the first session, but after reopening the tool it stops taking effect. Do not change code yet. Keep asking why until you reach a mechanism-level root cause and a smallest verification step.
```

Expected effect:

- RAVO should favor root-cause analysis over immediate fixes.
- The answer should separate symptom, proximate cause, and mechanism root cause.

## 3. Acceptance Gate

Prompt:

```text
I finished a file upload feature. The code is written and unit tests pass, but I have not done a real end-to-end test yet. Can I call this release-ready?
```

Expected effect:

- RAVO should block or downgrade the readiness claim.
- The answer should point out the missing evidence instead of saying it is release-ready.

## 4. Trivial Change

Prompt:

```text
Rename the button text from Save to Confirm.
```

Expected effect:

- RAVO should not force a heavy analysis flow.
- The tool should treat this as a small direct task.
