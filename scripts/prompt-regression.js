#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const pluginRoot = path.join(repo, "plugins", "ravo");
const hookManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
const hookEvents = Object.keys(hookManifest.hooks).sort();
assert.deepEqual(hookEvents, ["Stop"]);
for (const forbidden of ["PermissionRequest", "UserPromptSubmit", "SessionStart", "SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse"]) {
  assert.equal(hookManifest.hooks[forbidden], undefined, `${forbidden} must not inject RAVO context`);
}

for (const removed of [
  "modules/ravo-analysis/hooks/ravo-analysis-gate.js",
  "modules/ravo-workstream/hooks/ravo-workstream-gate.js",
  "modules/ravo-knowledge/hooks/ravo-knowledge-gate.js",
  "modules/ravo-acceptance/hooks/ravo-acceptance-gate.js",
  "modules/ravo-acceptance/hooks/ravo-acceptance-session.js"
]) assert.equal(fs.existsSync(path.join(pluginRoot, removed)), false, `${removed} must stay removed`);

const requirement = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-requirement-analysis", "SKILL.md"), "utf8");
for (const concept of [
  "real consumer",
  "scenario",
  "pain",
  "goal",
  "boundary",
  "success criteria",
  "non-goals",
  "constraints",
  "risks",
  "confirmed facts",
  "reasonable assumptions",
  "open product decisions"
]) assert.match(requirement, new RegExp(concept, "i"), `Requirement Analysis must retain ${concept}`);
assert.match(requirement, /simple factual questions/i);
assert.match(requirement, /one recommendation-backed question/i);
assert.match(requirement, /explicit(?:ly)? stated|explicit new requirement/i);
assert.match(requirement, /confirmed candidate/i);
assert.match(requirement, /returned `pmBrief`/i);
assert.match(requirement, /Do not expose Work Item IDs, artifact paths, commands, raw JSON/i);
assert.match(requirement, /do not scan unrelated history/i);
assert.match(requirement, /dedicated `--target-user`/i);
assert.match(requirement, /does not require loading the Workstream Skill/i);
assert.match(requirement, /needs_triage/i);
assert.match(requirement, /capture-pool-item\.js/i);

const core = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-core", "SKILL.md"), "utf8");
assert.match(core, /smallest sufficient mode/i, "Core must choose the minimum execution strength from context");
assert.match(core, /Work directly for simple questions, read-only checks, clear local fixes/i);
assert.match(core, /host already started a Goal or the current tool contract authorizes creation/i);
assert.match(core, /Never synthesize a `\/goal` user message/i);
assert.match(core, /Reuse an active Goal when the user says to continue/i);
assert.match(core, /completed, terminally blocked, or explicitly parked Goal does not restart/i);
assert.match(core, /new, independent objective/i);
assert.match(core, /ordinary clear multi-turn Goal does not require a Spec/i);
assert.match(core, /version delivery, Release Slice, acceptance, go-live, or publication Goal still requires a current decision-complete Spec/i);
assert.match(core, /Goal mode changes the execution container, not authorization/i);
assert.match(core, /continue directly and describe the real state/i, "Goal unavailability must degrade safely");

const quickValidation = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-quick-validation", "SKILL.md"), "utf8");
for (const tier of ["lightweight", "traceable", "required_evidence"]) assert.match(quickValidation, new RegExp(`\\b${tier}\\b`));
assert.match(quickValidation, /Run at least one check directly tied to the result/i);
assert.match(quickValidation, /dedicated evidence would cost more time or tokens/i);
assert.match(quickValidation, /artifact is optional/i);
assert.match(quickValidation, /No dedicated artifact does not mean no validation/i);
assert.match(quickValidation, /Complex, high-impact, data, security, permission, irreversible, acceptance, and release cases cannot use `lightweight` evidence/i);
assert.match(quickValidation, /cannot support `accepted`, `release_ready`, `live`, or `released`/i);

const acceptanceSkill = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-release-acceptance", "SKILL.md"), "utf8");
assert.match(acceptanceSkill, /do not invoke it just because a simple low-risk task ended/i);
assert.match(acceptanceSkill, /simple, local, reversible, low-risk task may close with its actual direct check and no Acceptance artifact/i);
assert.match(acceptanceSkill, /exception reduces evidence collection, not validation/i);
assert.match(acceptanceSkill, /Lightweight direct checks may support a bounded simple-task completion statement/i);
assert.match(acceptanceSkill, /cannot support `pending_acceptance`, `accepted`, `release_ready`, `live`, or `released`/i);

const rootCause = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-root-cause-analysis", "SKILL.md"), "utf8");
assert.match(rootCause, /Minimal RCA requires only/i);
assert.match(rootCause, /Full RCA requires/i);
assert.match(rootCause, /full path takes precedence/i);
assert.match(rootCause, /one runnable regression check/i);
assert.match(rootCause, /does not require a Why chain/i);
assert.match(rootCause, /Issue Pool/i);
assert.match(rootCause, /no (?:follow-up|recurrence) value|one-off/i);

const knowledge = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-knowledge", "SKILL.md"), "utf8");
assert.match(knowledge, /reusable (?:lesson|experience|principle)/i);
assert.match(knowledge, /product (?:principle|decision).{0,80}PM/i);

const dashboard = fs.readFileSync(path.join(pluginRoot, "skills", "ravo-dashboard", "SKILL.md"), "utf8");
assert.match(dashboard, /next[_ -]version[_ -]candidates/i);
assert.match(dashboard, /下一版本候选需求有哪些/);
assert.match(dashboard, /modules\.workstream\.latestArtifact/);
assert.match(dashboard, /specRef/);
assert.match(dashboard, /explicit `--version`/);
assert.match(dashboard, /direct(?:ly)? return|直接返回/i);
assert.match(dashboard, /unique decision-complete, unreleased Spec version/i);
assert.match(dashboard, /do not infer a version from file time/i);

const stopHook = path.join(pluginRoot, "modules", "ravo-acceptance", "hooks", "ravo-acceptance-stop.js");
const benign = spawnSync(process.execPath, [stopHook], {
  input: JSON.stringify({ cwd: repo, last_assistant_message: "I inspected the setting and found no change." }),
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"]
});
assert.equal(benign.status, 0, benign.stderr);
assert.deepEqual(JSON.parse(benign.stdout), {});

const active = spawnSync(process.execPath, [stopHook], {
  input: JSON.stringify({ cwd: repo, stop_hook_active: true, last_assistant_message: "这个功能已完成。" }),
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"]
});
assert.equal(active.status, 0, active.stderr);
assert.deepEqual(JSON.parse(active.stdout), {}, "a Stop continuation must not trigger another continuation");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-agents-v060-"));
const agentsScript = path.join(pluginRoot, "modules", "ravo-core", "scripts", "ravo-agents.js");
const agentsFile = path.join(workspace, "AGENTS.md");
fs.writeFileSync(agentsFile, "# Existing\n\n- Keep this rule.\n", "utf8");
const preview = spawnSync(process.execPath, [agentsScript, "--file", agentsFile], { encoding: "utf8" });
assert.equal(preview.status, 0, preview.stderr);
const previewBlock = preview.stdout.match(/<!-- RAVO:BEGIN -->([\s\S]*?)<!-- RAVO:END -->/)?.[1] || "";
const template = fs.readFileSync(path.join(repo, "templates", "agents-snippet.md"), "utf8");
const templateBlock = template.match(/<!-- RAVO:BEGIN -->([\s\S]*?)<!-- RAVO:END -->/)?.[1] || "";
assert.equal(previewBlock.trim(), templateBlock.trim(), "AGENTS template and generator must stay identical");
assert.equal((previewBlock.match(/\n- /g) || []).length, 7);
assert.match(preview.stdout, /Keep simple questions, read-only checks/);
assert.match(preview.stdout, /existing Codex Goal for clear multi-turn work/i);
assert.match(preview.stdout, /reuse an active Goal/i);
assert.match(preview.stdout, /do not recreate a terminal or parked Goal/i);
assert.match(preview.stdout, /simple low-risk work to omit a dedicated evidence artifact/i);
assert.match(preview.stdout, /complex and high-order status claims require traceable evidence/i);
assert.match(preview.stdout, /Ordinary clear Codex Goals do not require a Spec/i);
assert.match(preview.stdout, /version-delivery, Release Slice, acceptance, go-live, or publication Goal Prompt requires a current decision-complete Spec/i);
assert.match(preview.stdout, /systematically shape important or ambiguous requirements/);
assert.match(preview.stdout, /minimal RCA/);
assert.match(preview.stdout, /one concrete, owner-assigned next step/);
assert.match(preview.stdout, /Codex owns that step/);
assert.match(preview.stdout, /do not ask the user to reconfirm it/);
assert.match(preview.stdout, /visibly record|显性记录/i);
assert.match(preview.stdout, /next[- ]version candidates|下一版本候选/i);
assert.match(preview.stdout, /active Workstream.*specRef/i);

const apply = spawnSync(process.execPath, [agentsScript, "--file", agentsFile, "--apply"], { encoding: "utf8" });
assert.equal(apply.status, 0, apply.stderr);
const applied = fs.readFileSync(agentsFile, "utf8");
assert.match(applied, /Keep this rule/);
assert.equal((applied.match(/\n- /g) || []).length, 8, "seven RAVO rules plus the existing user rule");
assert.ok(fs.readdirSync(workspace).some((name) => name.startsWith("AGENTS.md.ravo-bak-")));
fs.rmSync(workspace, { recursive: true, force: true });

console.log(JSON.stringify({
  status: "pass",
  checks: [
    "only-stop-hook",
    "simple-prompt-empty-stop-output",
    "systematic-requirement-outcomes",
    "minimal-and-full-rca",
    "context-driven-direct-analysis-goal-governed-contract",
    "active-goal-reuse-and-terminal-goal-no-recreate",
    "ordinary-goal-vs-release-spec-boundary",
    "risk-and-cost-proportional-evidence-tiers",
    "lightweight-check-without-artifact",
    "one-stop-continuation-cap",
    "seven-line-agents-recall-with-pool-and-next-version-scenario",
    "agents-preview-apply-and-backup"
  ]
}, null, 2));
