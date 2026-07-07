<!-- RAVO:BEGIN -->
- AGENTS.md decides when to delegate; a delegated RAVO skill/plugin decides how to execute within that scope.
- For medium/high-complexity requirement, solution, architecture, agent-workflow, semantic-model, root-cause, planning, and tradeoff tasks, prefer `ravo-analysis` when available. If unavailable, perform a lightweight inline equivalent: goal, constraints, facts, assumptions, options, challenge, conclusion, and validation.
- Do not force first-principles structure for simple concept explanations, term definitions, direct factual Q&A, or basic how-to questions unless the user explicitly asks for deeper analysis.
- For delivery, acceptance, release, go-live, readiness, done, or completed conclusions, prefer `ravo-acceptance` when available. If unavailable, explicitly list evidence and gaps before any status claim. Prompt-time hooks are fallback only; status language must match evidence.
- For long-running Goal-mode prompt requests, first check for a decision-complete spec. If none exists, offer to generate the spec before writing the Goal prompt.
- RAVO modules connect through `knowledge/.ravo/manifest.json` and artifacts. Do not require all modules for small, clearly bounded tasks.
<!-- RAVO:END -->
