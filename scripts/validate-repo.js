#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const plugins = ["ravo-core", "ravo-analysis", "ravo-acceptance"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertFile(file) {
  assert.ok(fs.existsSync(path.join(repo, file)), `missing ${file}`);
}

function parseFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.startsWith("---\n"), `${file} missing frontmatter`);
  const end = text.indexOf("\n---", 4);
  assert.ok(end > 0, `${file} unclosed frontmatter`);
  const yaml = text.slice(4, end).trim();
  const fields = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  assert.ok(fields.name, `${file} missing skill name`);
  assert.ok(fields.description, `${file} missing skill description`);
}

const marketplace = readJson(path.join(repo, ".agents/plugins/marketplace.json"));
assert.equal(marketplace.name, "ravo");
for (const plugin of plugins) {
  assert.ok(marketplace.plugins.some((entry) => entry.name === plugin), `marketplace missing ${plugin}`);
  const manifest = readJson(path.join(repo, "plugins", plugin, ".codex-plugin", "plugin.json"));
  assert.equal(manifest.name, plugin);
  assert.equal(manifest.version, "0.1.0");
  assert.ok(manifest.skills, `${plugin} missing skills path`);
  assert.ok(manifest.interface?.displayName?.startsWith("RAVO"), `${plugin} displayName should use RAVO`);
}

for (const file of [
  "README.md",
  "LICENSE",
  "schemas/manifest.schema.json",
  "schemas/analysis-artifact.schema.json",
  "schemas/acceptance-artifact.schema.json",
  "templates/agents-snippet.md",
  "plugins/ravo-acceptance/hooks/claude-codex-hooks.json"
]) {
  assertFile(file);
}

for (const dir of [
  "plugins/ravo-core/skills",
  "plugins/ravo-analysis/skills",
  "plugins/ravo-acceptance/skills"
]) {
  for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) parseFrontmatter(path.join(repo, dir, entry.name, "SKILL.md"));
  }
}

console.log("repo validation passed");
