# GitHub Publication Policy

RAVO publishes maintained source, schemas, tests, templates, public usage documentation, release notes, and intentionally prepared launch assets.

The following stay private by default and must not enter a public commit: `knowledge/.ravo/`, `knowledge/internal/`, raw Codex tasks or session exports, Acceptance and Review raw evidence, screenshots created only for internal acceptance, logs, backups, local configuration, credentials, personal absolute paths, and immutable release-plan files.

Reusable decisions may be published only after they are rewritten as stable, redacted documents under `docs/decisions/` or `docs/releases/`. Test fixtures must preserve the behavior under test without containing credential-shaped literals or personal paths in source text.

Every version release runs the repository publication-boundary and secret/privacy audit against the exact candidate tree. Findings are release blockers unless the material is removed, parameterized, or rewritten as public documentation.
