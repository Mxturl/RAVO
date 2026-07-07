<!-- RAVO:BEGIN -->
- Use RAVO for medium/high-complexity AI-agent lifecycle work: analysis, acceptance, workstream handoff, and knowledge reuse.
- Prefer `ravo-analysis` for important requirement, solution, architecture, and root-cause analysis; conclusions must derive from goal, constraints, facts, and mechanism-level cause.
- Proactively run `ravo-acceptance` before asking the user to accept work or before claiming `pending acceptance`, `accepted`, `release ready`, or `live`. User-prompt acceptance hooks are fallback only; status language must match evidence.
- RAVO modules connect through `knowledge/.ravo/manifest.json` and artifacts. Do not require all modules for small, clearly bounded tasks.
<!-- RAVO:END -->
