---
name: ravo-dashboard
description: Directly answer PM questions about next-version requirement candidates from the local Pool, or start and inspect the RAVO SoloDesk dashboard, configuration, Runtime health, and controlled updates.
---

# RAVO SoloDesk

Use this skill when the user wants a local cross-workspace RAVO dashboard, configuration management, Review Provider management, Runtime diagnostics, or a controlled RAVO plugin update.

## Workflow

When the PM asks “下一版本候选需求有哪些”, “what are the next version candidates”, or an equivalent question, run the read-only scenario without requiring the SoloDesk service:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-dashboard/scripts/ravo-pool.js" --scenario next_version_candidates --workspace <workspace> [--version vX.Y.Z]
```

Directly return the `pmBrief` and up to ten `chat.items` as a compact PM list. Show type, priority, version status, user value or impact, next step, and owner. Say once that candidates do not equal the Release Slice. Do not expose IDs, paths, revisions, source refs, tokens, or internal status codes unless the PM asks for technical evidence. If the version is ambiguous, ask only the single version question returned by the scenario.

If the PM omits a version, resolve it before invoking the scenario. First follow `knowledge/.ravo/manifest.json -> modules.workstream.latestArtifact -> specRef`. Use that Spec version as the caller's explicit `--version` only when the Workstream is `active`, `blocked`, or `ready_for_acceptance`; the referenced Spec has exact `Status: decision-complete`; its Release Slice matches non-inactive Work Items; and none of those items is `released`. This manifest pointer is current-work ownership, not a latest-file-time guess.

If there is no valid current Workstream, use the workspace's unique decision-complete, unreleased Spec version above the installed product version. If that is absent or ambiguous, run the scenario without `--version` and use its single version-choice result. Do not infer a version from file time, a `next-release` label, or a Roadmap heading, and do not ask the PM before checking the current Workstream source.

1. Use the stable SoloDesk controller for every lifecycle action:

```bash
node "$RAVO_PLUGIN_ROOT/modules/ravo-dashboard/scripts/ravo-solodesk.js" open
```

   The first `open` installs the user-level launcher if needed. Use `status`, `stop`, `restart`, `logs`, `foreground`, `install`, or `uninstall` with the same script; never start `ravo-dashboard.js` directly.
2. Use the printed loopback URL. Repeated `open` calls reuse the same PID and instanceId.
3. Keep workspace roots allowlisted. Never broaden discovery to the home directory implicitly.
4. Preview configuration, Review calls, and update plans before mutation.
5. Treat Runtime probe, Review, and acceptance status as evidence-backed states; do not infer them from UI availability.
6. For Runtime-owned delivery, use Runtime Delivery Preflight before a fresh-session claim. Safe, reversible local alignment is part of the default local delivery flow; use `--require-authorization` only when the operation is an explicit exception. Managed SoloDesk must resolve only an installed, versioned, fingerprint-verified cache; a development workspace or marketplace source is a blocker, not a fallback.
7. Use workspace shortcuts to preview bounded Continuation, analysis, root-cause, blocker, acceptance, Review, progress, knowledge, Goal, Runtime, or initialization prompts; SoloDesk never runs them automatically.
8. For Codex configuration drift, run Config Integrity check, create/select a snapshot, review the redacted repair preview, and confirm the one-time plan. Start a fresh Codex Task after repair before trusting Runtime health.

Set `RAVO_PLUGIN_ROOT` to the directory two levels above this `SKILL.md`.

## Product Manager Communication

- Use the authoritative `pmBrief` as facts, not as a field-by-field response template. Organize the result around the current PM scenario; a candidate comparison can use a list or table while a single answer can stay as prose.
- Legacy configuration never changes the underlying facts; Agent records remain complete and are never used as the default PM view.
- Keep execution lanes, source paths, internal status codes, provider details, and environment fingerprints under evidence or technical detail views.
- A healthy Dashboard does not mean the current feature is locally available. Prefer a matching Acceptance or Runtime Delivery brief, and use a conservative read-only projection for legacy artifacts.
- Do not ask the PM to authorize safe local source alignment or local environment refresh that is already inside the confirmed delivery scope.

## Rules

- Bind only to loopback.
- Prompt, CLI, and `~/.codex/ravo/SoloDesk.command` must use the same controller and user-level instance.
- Default to `on_demand`; enable `login` only through the canonical `dashboard.startupMode` setting.
- Treat `failed`, `restart_required`, `stale_state`, and `busy` as explicit service states with a recovery entry.
- Reject external Origin/Host and mutation requests without the startup CSRF token.
- Never expose secret values, Authorization headers, full endpoint query strings, or unrelated Codex configuration.
- Config writes use the declared contract, backup-before-write, atomic replacement, read-back verification, and the shared mutation lock.
- Keep current Provider, token, MCP, project, feature, Desktop, and unknown configuration authoritative during repair. Restore external registrations only when individually selected.
- Never generate or silently approve Hook trust. A missing or changed Hook identity must stop at `approval_required` with a fresh-Task recovery entry.
- Review output budget settings expose `auto` and `fixed`: changing modes must preserve existing numeric values, and auto fallback remains explicit and attempt-bounded.
- Update commands use the fixed RAVO marketplace and required plugin set; do not accept arbitrary command, URL, executable, marketplace, or plugin parameters.
- Dashboard status does not itself prove hooks are loaded in the current Session.
- Dashboard Knowledge retrieval must use `recordUse=false`, apply at most three explicitly applicable matches, and stay silent when none are valuable.
- Goal Prompt shortcuts must reuse the current/missing/stale Spec guard; blocked previews must not contain a runnable Goal Prompt.
