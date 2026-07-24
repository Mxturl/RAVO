#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-knowledge-installed-")));
const knowledgeRoot = path.join(root, "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-knowledge");
const coreScripts = path.join(root, "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-core", "scripts");
const workspace = path.join(root, "workspace");

fs.mkdirSync(path.join(knowledgeRoot, "scripts"), { recursive: true });
fs.mkdirSync(coreScripts, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.copyFileSync(
  path.join(repo, "plugins", "ravo", "modules", "ravo-knowledge", "scripts", "retrieve-knowledge.js"),
  path.join(knowledgeRoot, "scripts", "retrieve-knowledge.js")
);
fs.writeFileSync(
  path.join(coreScripts, "ravo-record-store.js"),
  'module.exports = { rebuildKnowledgeIndex() { throw new Error("unexpected rebuild"); } };\n'
);

const result = spawnSync(process.execPath, [
  path.join(knowledgeRoot, "scripts", "retrieve-knowledge.js"),
  "--query", "installed layout",
  "--record-use", "false"
], { cwd: workspace, encoding: "utf8" });

assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).status, "ok");

console.log(JSON.stringify({ status: "pass", checks: ["installed-cache-core-resolution"] }, null, 2));
