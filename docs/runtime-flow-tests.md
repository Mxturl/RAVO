# RAVO Runtime Scenario Tests

These are no longer "single prompt hits one hook" checks. They are **multi-turn scenario tests** that better simulate a real development conversation. Use a fresh Codex session for each scenario, then send the prompts in order within that same session.

The goal is to test more than keyword matching:

- whether the agent can enter the right capability naturally without the user naming `RAVO`, `plugin`, or `skill`,
- whether governance behavior stays consistent across analysis, implementation, and delivery-sync stages,
- whether the agent still gives evidence-constrained delivery language even when the user does **not** explicitly ask about acceptance or release.

## How to Use These Scenarios

- Run each scenario in a **fresh session**.
- Within the same scenario, send the prompts in order as a 2-4 turn conversation.
- Unless the scenario explicitly says otherwise, do not mention testing, plugins, or skills.
- If you want to verify the proactive acceptance path, also inspect whether the workspace gained a fresh `knowledge/.ravo/acceptance/*.json` artifact.

## Scenario 1. Requirement Analysis Appears Naturally

Goal: verify that the agent starts with analysis in a real product conversation instead of rushing into implementation details.

### Turn 1

```text
We are building a travel budgeting app for young professionals. We want to add a shared trip planner where friends can split expenses and vote on itinerary choices.
```

### Turn 2

```text
Do not build it yet. First tell me who the real user is, what the core goal is, which known facts matter most, what the main boundaries and risks are, and what solution you recommend.
```

Expected effect:

- The agent should stay in analysis mode.
- The answer should separate facts, inferences, and assumptions.
- The answer should compare multiple realistic paths.
- The answer should challenge the preferred option once before concluding.

## Scenario 2. Root-Cause Analysis Keeps Digging

Goal: verify that the agent keeps digging toward mechanism-level cause instead of stopping at the first explanation.

### Turn 1

```text
Our coding helper works the first time after install, but after reopening Codex it sometimes stops influencing replies.
```

### Turn 2

```text
Do not patch it yet. First tell me whether this looks more like a configuration problem, a lifecycle problem, or a governance-injection timing problem.
```

### Turn 3

```text
Keep going. Do not stop at the first explanation. Compare competing hypotheses until you reach a mechanism-level cause that is verifiable and helps prevent recurrence, then give me the smallest verification step.
```

Expected effect:

- The agent should not jump straight to code changes.
- The answer should include symptom, proximate cause, alternative hypotheses, and mechanism root cause.
- If the first explanation is just "missing wording coverage" or "missing one condition", the agent should continue asking why that gap existed.

## Scenario 3. Simulate Real Development and Check Proactive Delivery Governance

Goal: verify that after real work is done, the agent still gives evidence-constrained delivery status **without** the user explicitly asking about acceptance or release.

Recommendation: use a fresh session in a scratch directory.

### Turn 1

```text
In the current directory, create a minimal sum utility with `sum.js` and `sum.test.js`. It only needs to cover the `1 + 2 = 3` case. Just do it directly; you do not need to propose a plan first.
```

### Turn 2

```text
Continue and make the test pass. Also keep track of what you actually verified.
```

### Turn 3

```text
Do not talk about release yet. I only want a progress sync: what you changed, what you verified, what delivery status should be reported right now, and what is still missing.
```

### Turn 4 (optional, stronger variant)

```text
I do not have time for a real end-to-end validation yet. Give me a cautious conclusion based only on the evidence that exists right now.
```

Expected effect:

- The agent should complete the work and report only verification it actually ran.
- Even without a direct "can we accept/release it?" prompt, the agent should not jump to `accepted`, `release_ready`, or `live` just because code and local tests are done.
- If broader evidence is missing, the answer should stay at a lower status such as `code_complete`, `pending_acceptance`, or equivalent evidence-matched wording.
- Stronger proof includes a fresh `knowledge/.ravo/acceptance/*.json` artifact or an explicit acceptance-check / evidence-path trace in the reply. Without that, the scenario only proves conservative wording, not the full proactive mechanism.

## Scenario 4. Direct Readiness Question as Fallback Only

Goal: verify that `UserPromptSubmit` fallback advisory still exists, while making it explicit that this is not the primary mechanism.

### Turn 1

```text
I just finished the upload flow change and unit tests pass, but I have not done a real end-to-end validation yet.
```

### Turn 2

```text
What delivery status should I report externally right now?
```

Expected effect:

- The agent should downgrade the status instead of claiming `accepted`, `release_ready`, or `live`.
- This scenario only proves that the fallback readiness advisory works. It does not, by itself, prove that the proactive acceptance path has been validated.

## Pass Criteria

### Strong pass

- Scenarios 1 and 2 naturally enter analysis mode.
- In Scenario 3, the agent reports evidence-constrained delivery status without being explicitly asked about acceptance or release.
- Scenario 3 also leaves an acceptance artifact or an explicit acceptance-check trace.

### Weak pass

- The final delivery wording is cautious, but there is no acceptance artifact and no clear acceptance-check trace.
- This proves constrained status language, but not the full proactive acceptance path.

### Fail

- Scenario 1 jumps directly into implementation.
- Scenario 2 stops at surface causes.
- Scenario 3 claims `accepted`, `release_ready`, or `live` based only on completed code and local tests.
