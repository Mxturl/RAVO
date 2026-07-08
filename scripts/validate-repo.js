#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const plugins = ["ravo-core", "ravo-analysis", "ravo-workstream", "ravo-quick-validation", "ravo-acceptance", "ravo-knowledge", "ravo-review"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertFile(file) {
  assert.ok(fs.existsSync(path.join(repo, file)), `missing ${file}`);
}

function parseFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, `${file} missing frontmatter`);
  const yaml = match[1].trim();
  const fields = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  assert.ok(fields.name, `${file} missing skill name`);
  assert.ok(fields.description, `${file} missing skill description`);
  assert.ok(!text.includes("node plugins/ravo-"), `${file} uses repo-relative plugin command`);
}

const marketplace = readJson(path.join(repo, ".agents/plugins/marketplace.json"));
assert.equal(marketplace.name, "ravo");
for (const plugin of plugins) {
  assert.ok(marketplace.plugins.some((entry) => entry.name === plugin), `marketplace missing ${plugin}`);
  const manifest = readJson(path.join(repo, "plugins", plugin, ".codex-plugin", "plugin.json"));
  assert.equal(manifest.name, plugin);
  assert.equal(manifest.version, "0.3.0");
  assert.ok(manifest.skills, `${plugin} missing skills path`);
  assert.ok(manifest.interface?.displayName?.startsWith("RAVO"), `${plugin} displayName should use RAVO`);
  if (!["ravo-core", "ravo-quick-validation", "ravo-review"].includes(plugin)) assert.ok(manifest.hooks, `${plugin} missing hooks path`);
}

for (const file of [
  ".gitattributes",
  "README.md",
  "README_ZH.md",
  "LICENSE",
  "docs/quick-test-cases.md",
  "docs/quick-test-cases-zh.md",
  "docs/runtime-flow-tests.md",
  "docs/runtime-flow-tests-zh.md",
  "docs/ravo-v0.2-decision-complete-spec.md",
  "schemas/manifest.schema.json",
  "schemas/analysis-artifact.schema.json",
  "schemas/workstream-artifact.schema.json",
  "schemas/smoke-artifact.schema.json",
  "schemas/acceptance-artifact.schema.json",
  "schemas/knowledge-artifact.schema.json",
  "schemas/review-artifact.schema.json",
  "templates/agents-snippet.md",
  "templates/ravo-config.example.json",
  "templates/ravo-review-config.example.json",
  "docs/ravo-v0.3-decision-complete-spec.md",
  "plugins/ravo-core/scripts/ravo-status.js",
  "plugins/ravo-core/scripts/ravo-goal-prompt.js",
  "plugins/ravo-analysis/scripts/write-decision-spec.js",
  "plugins/ravo-analysis/hooks/claude-codex-hooks.json",
  "plugins/ravo-workstream/hooks/claude-codex-hooks.json",
  "plugins/ravo-acceptance/hooks/claude-codex-hooks.json",
  "plugins/ravo-acceptance/hooks/ravo-acceptance-stop.js",
  "plugins/ravo-knowledge/hooks/claude-codex-hooks.json",
  "plugins/ravo-review/scripts/write-review-artifact.js",
  "scripts/prompt-regression.js"
]) {
  assertFile(file);
}

for (const dir of [
  "plugins/ravo-core/skills",
  "plugins/ravo-analysis/skills",
  "plugins/ravo-workstream/skills",
  "plugins/ravo-quick-validation/skills",
  "plugins/ravo-acceptance/skills",
  "plugins/ravo-knowledge/skills",
  "plugins/ravo-review/skills"
]) {
  for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) parseFrontmatter(path.join(repo, dir, entry.name, "SKILL.md"));
  }
}

console.log("repo validation passed");
