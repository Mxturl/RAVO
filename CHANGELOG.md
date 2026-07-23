# Changelog

All notable public changes to RAVO are documented here.

## [0.6.2] - 2026-07-22

Repository: https://github.com/Mxturl/RAVO

License: MIT

Install: `codex plugin add ravo@ravo`

### Added

- One complete RAVO plugin with nine on-demand Skills, one local SoloDesk, workspace-local Pool and Knowledge data, and one Stop Hook.
- Context-driven use of the host Codex Goal: direct work stays direct, clear multi-turn work may reuse Goal, and governed paths remain limited to real risk.
- Explicit Requirement and Issue Pool capture with retained approvals, rejections, reasons, candidate versions, and a chat-ready next-version candidate projection.
- Risk-proportional validation: lightweight local changes still receive a direct check, while complex, acceptance, security, and release claims require traceable evidence.
- PM-focused status projection that separates implementation, automated verification, local availability, PM acceptance, release eligibility, and publication.

### Changed

- Installation is centralized as `ravo@ravo`; internal modules remain implementation boundaries and are no longer installed independently.
- Hooks are reduced to one read-only Stop check. Skill descriptions and a short `AGENTS.md` block provide contextual recall instead of routing every prompt through hooks.
- Requirement analysis remains systematic, while simple deterministic bugs use a minimal RCA and simple low-risk work avoids dedicated evidence artifacts when their cost is disproportionate.
- RAVO now relies on the existing Codex Goal lifecycle rather than implementing a separate goal engine or central workflow router.

### Migration

- Users of the eight legacy `0.5.5` plugins should install `ravo@ravo`, run `ravo-migrate.js --preview`, then `ravo-migrate.js --apply`, and start a fresh Codex task.
- Existing workspace artifacts and Review Provider configuration are preserved. Migration creates an offline recovery snapshot before legacy plugin removal.

### Known Limitations

- Goal creation and lifecycle behavior depend on the current Codex host and model; RAVO provides guidance and boundaries, not a deterministic router.
- After RCA, Review, or smoke validation establishes a reusable fact, Codex may not always proactively capture it in RAVO Knowledge. Explicitly request Knowledge capture for important lessons until the follow-up improvement lands; unverified solutions must remain candidates.
- Fresh Session evidence confirms the tested local installation and model behavior, not every future host or model version.

### Validation

- The tracked Node test suite, repository validation, smoke test, prompt regression, version alignment, architecture, Hook, migration, and acceptance checks pass on the release candidate.
- The locally installed `0.6.2` plugin completed Runtime Delivery alignment and fresh-session verification, and the PM accepted the scoped product experience.

### Rollback

- Check out an earlier audited tag or commit and reinstall the plugin from that checkout. Preserve `knowledge/.ravo/` and user Review configuration.
- Legacy migration recovery uses the offline snapshot reported by `ravo-migrate.js`; no successful public object is deleted automatically.

## [0.2.0] - 2026-07-07

- Published the original modular RAVO lifecycle-governance plugins and evidence protocol.
