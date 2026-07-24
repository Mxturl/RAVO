---
name: ravo-review
description: Run or record RAVO adversarial review for requirements, architecture, technical design, tests, acceptance, security, auditability, Agent workflows, and long-running plans.
---

# RAVO Review

Use this skill when important work needs external or adversarial review.

## Workflow

1. Check data boundaries before sending anything to external models.
2. Preview the exact provider/model/round/retry/fallback call plan before live Review:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-review/scripts/run-review.js" --preview --domain architecture --subject-ref "<stable-id>" --subject-version "<commit-or-baseline>" --governance-path governed_change --trigger-reason spec_required --trigger-source-ref "docs/<decision-complete-spec>.md#<requirement-id>" --decision-impact "<high-risk decision affected>" --subject "<sanitized proposal>"
```

3. Run the live RAVO Review runner when provider config and data-boundary authorization are available:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-review/scripts/run-review.js" --domain architecture --subject-ref "<stable-id>" --subject-version "<commit-or-baseline>" --governance-path governed_change --trigger-reason spec_required --trigger-source-ref "docs/<decision-complete-spec>.md#<requirement-id>" --decision-impact "<high-risk decision affected>" --data-boundary safe_sanitized --authorization-source policy_safe_sanitized --subject "<sanitized proposal>"
```

The runner uses `rounds` from `~/.codex/skill-config/ravo-review.json`, defaults to `2`, and accepts only `1`, `2`, or `3`. Round 1 is independent review, Round 2 is challenge response, and Round 3 is convergence adjudication.

Formal Review uses one root-level timeout profile for every requested Provider/model pair: total `900000ms`, first event `120000ms`, first content `300000ms`, idle `180000ms`, and streaming enabled. A formal run may increase these values globally, but cannot shorten them, disable streaming, or create Provider/model-specific timeout exceptions.

For bounded exploratory checks, pass one configured model:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-review/scripts/run-review.js" --run-class diagnostic --diagnostic-reason implementation_debug --domain architecture --model "<model-id>" --rounds 1 --timeout-ms 60000 --data-boundary safe_sanitized --authorization-source policy_safe_sanitized --subject "<sanitized proposal>" --no-stream
```

Diagnostic runs always have `coverage=none`. They retain timeout/attempt telemetry, but cannot drive formal Review, Acceptance, release evidence, or a proceed decision.

4. Use `--provider-test <provider/model>` only for a minimal connectivity check. Provider-test artifacts never become formal Review evidence.

5. If providers are unavailable or authorization is missing, record only `coverage=none` so the evidence gap is visible:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-review/scripts/write-review-artifact.js" --domain architecture --coverage none --subject-ref "<stable-id>" --blocking-reason "<reason>" --blocker-impact "<impact>" --temporary-fallback "<fallback>" --recovery-entry "<recovery>"
```

Manual records cannot claim `partial` or `full`. Those states must come from the live runner or a derived migration that re-parses readable raw responses:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-review/scripts/migrate-review-artifact.js" --workspace "<workspace>" --source "<legacy-review.json>"
```

When usable Review evidence establishes a stable reusable fact with a clear boundary, run one Knowledge candidate check. Findings that remain uncertain stay in the Review or Issue Pool rather than becoming confirmed Knowledge.

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Product Manager Communication

- Report which product assumption or user outcome is at risk, the recommended response, the remaining risk, and what Codex will do next before provider, parser, coverage, or retry details.
- Legacy configuration never changes the underlying facts or complete Review artifact; the visible PM response may be organized naturally for the current question.
- Missing or partial external review is an evidence boundary, not automatically a PM decision. Ask the PM only when accepting the residual risk or changing scope is genuinely a product choice.
- External review never substitutes for actual local usability, product acceptance, or release evidence.

## Rules

- Do not send secrets, credentials, customer data, or confidential project facts externally without explicit authorization.
- Record full, partial, failure, timeout, and truncation states visibly.
- Record challenge brief, convergence brief, issue ledger, round input hashes, attempts, and retry/fallback states when multi-round review runs.
- Use the shared config validator for legacy flat and provider-array configs, including fallback pairs and required model count.
- Enforce total, first-event, optional first-content, and idle stream timeouts. Transport and semantic retries share one bounded attempt budget and preserve real backoff timing.
- Apply the same formal timeout profile to every Provider/model pair. Short timeout or no-stream experiments must be explicitly diagnostic and cannot be promoted into formal evidence.
- Default to `maxTokensMode=auto`, which omits `max_output_tokens`/`max_tokens` on the first Provider attempt. A numeric legacy/global/provider value remains `fixed`, and `--max-tokens auto` explicitly selects auto for the current run.
- If auto returns `length`/`incomplete` or the Provider explicitly requires a token field, use `autoFallbackMaxTokens` within the same attempt budget and record `attemptType=output_budget_fallback`. For fixed mode, compensation is available only when `autoFallbackMaxTokens` is greater than the attempted fixed budget; otherwise the exhausted budget is reported without inventing an unknown Provider maximum. A value of `0` disables compensation with a visible warning.
- Preserve Provider status, finish/incomplete reason, numeric usage, and aggregate `validResults`; a later round failure must not erase earlier usable evidence.
- Keep all raw finding counts and recovered parser errors auditable even when a later semantic retry succeeds.
- Keep round coverage visible; top-level `coverage` represents the whole requested multi-round run.
- `partial_external_review` is not equivalent to `full_external_review`.
- Review is optional for routine tasks but recommended for high-impact plans, self-confirming E2E design, security-sensitive changes, and release claims.
- Provider config lives at `~/.codex/skill-config/ravo-review.json`; never print API keys.
- Store artifacts under `knowledge/.ravo/review/`.
