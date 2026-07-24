# Changelog

All notable public changes to RAVO are documented here.

## [0.6.3] - 2026-07-24

Repository: https://github.com/Mxturl/RAVO

License: MIT

Install: `codex plugin add ravo@ravo`

### Changed

- Acceptance conclusions now bind to the current task's explicit or uniquely matched evidence instead of the workspace's latest artifact, so concurrent tasks cannot overwrite each other's status.
- RCA, Review, smoke, and Acceptance guidance now checks for reusable Knowledge when stable facts emerge; phase closeout classifies lessons, Pool items, unfinished work, and Spec changes without adding a Stop Hook ceremony to simple work.
- PM-facing replies use structured state as factual input while leaving prose, lists, tables, and steps to the model's judgment for the current question.
- Clear implementation requests now default to continuing through validation and reversible local integration. The model may create or reuse the host Codex Goal from full context when continuity is useful, without keywords, scoring, or a new router.

### Compatibility

- The unified `ravo@ravo` plugin, nine Skills, one read-only Stop Hook, workspace artifacts, legacy `0.5.5` migration, and `0.6.2` installation path remain compatible.
- Goal remains a host-provided continuity container. It does not add a Spec, Review, Acceptance, or evidence requirement and does not expand authorization.

### Known Limitations

- Natural Goal choice and Knowledge recall are semantic model judgments, so behavior may vary by host, model, and context. RAVO intentionally does not replace them with keyword triggers or a routing Hook.
- When a host does not expose a unique task identifier, high-order acceptance or release claims must reference the matching workspace-local Acceptance explicitly.

### Validation

- All 49 tracked checks pass on the v0.6.3 candidate, including repository validation, prompt regression, version alignment, architecture, Stop Hook isolation, migration, runtime delivery, and acceptance contracts.
- The locally installed `0.6.3` plugin passed fresh-session checks for concurrent Acceptance isolation, complex Knowledge recall, simple-task silence, PM-readable responses, and natural Goal behavior. The PM accepted the scoped product experience before release preparation.

### Rollback

- Check out the audited `v0.6.2` tag and reinstall `ravo@ravo` from that checkout. Preserve `knowledge/.ravo/` and user Review configuration.
- Do not delete successful GitHub objects automatically; diagnose a partial publication and resume only from a newly audited release plan.

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
