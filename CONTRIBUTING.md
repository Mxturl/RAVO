# Contributing

RAVO accepts focused fixes and product changes that preserve the lightweight execution model and evidence boundaries.

Before opening a pull request:

1. Describe the user problem, expected outcome, scope, and known tradeoffs.
2. Keep simple work direct; do not add a Hook or workflow gate when a Skill or deterministic check is sufficient.
3. Run `npm test` and the relevant focused scripts from `README.md`.
4. Keep credentials, personal paths, raw sessions, and `knowledge/.ravo/` out of commits.
5. Update public documentation for user-visible behavior and state evidence limits precisely.

Contributions are accepted under the repository's MIT License.
