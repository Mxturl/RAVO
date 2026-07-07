# RAVO Quick Test Cases

These prompts are designed for a fresh Codex session with no project context. Each one is short, should finish quickly, and is meant to test one RAVO behavior at a time.

These are semantic-trigger checks, not full lifecycle proof. They help confirm that RAVO reacts naturally to requirement, root-cause, and readiness language. They do not by themselves prove the agent-initiated acceptance path. For that, use the multi-turn runtime scenarios in [docs/runtime-flow-tests.md](./runtime-flow-tests.md).

## 1. Requirement Analysis

Prompt:

```text
I want to build a simple habit tracker app. Do not write code yet. First tell me who the real user is, what the goal is, what facts and constraints matter, and which solution you recommend.
```

Expected effect:

- RAVO should favor requirement analysis over direct implementation.
- The answer should cover goal, consumer, constraints, facts, options or tradeoffs, a challenge to the preferred path, and a recommendation.

## 2. Root-Cause Analysis

Prompt:

```text
A plugin works in the first session, but after reopening the tool it silently stops taking effect. Do not change code yet. Keep digging into why until you reach the mechanism-level cause and the smallest verification step.
```

Expected effect:

- RAVO should favor root-cause analysis over immediate fixes.
- The answer should separate symptom, proximate cause, competing explanations, and mechanism root cause.

## 3. Acceptance Gate

Prompt:

```text
I just wrapped the upload flow change. Unit tests pass, but I have not done a real end-to-end run yet. What delivery status should I report right now?
```

Expected effect:

- RAVO should let the message go through but downgrade the readiness claim.
- The answer should point out the missing evidence instead of jumping to accepted, release-ready, or live.

## 4. Trivial Change

Prompt:

```text
Rename the button text from Save to Confirm.
```

Expected effect:

- RAVO should not force a heavy analysis flow.
- The tool should treat this as a small direct task.
