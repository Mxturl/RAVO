#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.join(__dirname, "..");
const pluginRoot = path.join(repo, "plugins", "ravo");
const expectedSkills = [
  "ravo-core",
  "ravo-dashboard",
  "ravo-knowledge",
  "ravo-quick-validation",
  "ravo-release-acceptance",
  "ravo-requirement-analysis",
  "ravo-review",
  "ravo-root-cause-analysis",
  "ravo-workstream"
];
const expectedModules = [
  "ravo-acceptance",
  "ravo-analysis",
  "ravo-core",
  "ravo-dashboard",
  "ravo-knowledge",
  "ravo-quick-validation",
  "ravo-review",
  "ravo-safety",
  "ravo-workstream"
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function frontmatter(file) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} must have YAML frontmatter`);
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

const marketplace = readJson(path.join(repo, ".agents", "plugins", "marketplace.json"));
assert.equal(marketplace.name, "ravo");
assert.deepEqual(marketplace.plugins.map((entry) => entry.name), ["ravo"]);
assert.equal(marketplace.plugins[0].source.path, "./plugins/ravo");

const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
assert.equal(manifest.name, "ravo");
assert.equal(manifest.version, "0.6.2");
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.hooks, "./hooks/hooks.json");

const skills = fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(skills, expectedSkills);
for (const skill of skills) {
  const metadata = frontmatter(path.join(pluginRoot, "skills", skill, "SKILL.md"));
  assert.equal(metadata.name, skill);
  assert.ok(metadata.description && metadata.description.length >= 20, `${skill} needs selective recall metadata`);
}

const hooks = readJson(path.join(pluginRoot, "hooks", "hooks.json"));
assert.deepEqual(Object.keys(hooks.hooks).sort(), ["Stop"]);
for (const forbidden of ["PermissionRequest", "UserPromptSubmit", "SessionStart", "SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse"]) {
  assert.equal(hooks.hooks[forbidden], undefined);
}

const modulesRoot = path.join(pluginRoot, "modules");
const modules = fs.readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(modules, expectedModules);
for (const moduleName of modules) {
  const moduleManifest = readJson(path.join(modulesRoot, moduleName, ".codex-plugin", "plugin.json"));
  assert.equal(moduleManifest.version, "0.6.2", `${moduleName} product version`);
  assert.equal(moduleManifest.skills, undefined, `${moduleName} must not expose nested Skills`);
  assert.equal(moduleManifest.hooks, undefined, `${moduleName} must not register nested Hooks`);
}

const { inspectPluginRoot } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-preflight");
const healthy = inspectPluginRoot(pluginRoot);
assert.equal(healthy.status, "healthy");
assert.equal(healthy.skills.filter((entry) => entry.status === "healthy").length, 9);
assert.equal(healthy.modules.filter((entry) => entry.status === "healthy").length, 9);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-v060-preflight-"));
fs.cpSync(pluginRoot, fixture, { recursive: true });
fs.rmSync(path.join(fixture, "modules", "ravo-knowledge", "scripts", "retrieve-knowledge.js"));
const degraded = inspectPluginRoot(fixture);
assert.equal(degraded.status, "degraded");
assert.equal(degraded.modules.find((entry) => entry.name === "ravo-knowledge").status, "degraded");
assert.equal(degraded.modules.find((entry) => entry.name === "ravo-analysis").status, "healthy");

fs.writeFileSync(path.join(fixture, "hooks", "hooks.json"), "not-json\n");
const blocked = inspectPluginRoot(fixture);
assert.equal(blocked.status, "blocked");
fs.rmSync(fixture, { recursive: true, force: true });

for (const legacy of expectedModules.filter((name) => name !== "ravo-safety")) {
  const legacyRoot = path.join(repo, "plugins", legacy);
  if (legacy === "ravo-core") {
    assert.deepEqual(fs.readdirSync(legacyRoot).sort(), ["scripts"]);
    assert.deepEqual(fs.readdirSync(path.join(legacyRoot, "scripts")).sort(), ["ravo-goal-prompt.js"]);
  } else {
    assert.equal(fs.existsSync(legacyRoot), false, `${legacy} must not remain a public plugin root`);
  }
}

const compatibility = require("../plugins/ravo-core/scripts/ravo-goal-prompt");
assert.equal(typeof compatibility.checkSpecHealth, "function");

console.log(JSON.stringify({
  status: "pass",
  scenarios: [
    "single-public-plugin",
    "nine-selective-skills",
    "stop-only-hook-manifest",
    "nine-internal-modules",
    "module-level-degradation",
    "manifest-blocking-preflight",
    "benchmark-compatibility-wrapper"
  ]
}, null, 2));
