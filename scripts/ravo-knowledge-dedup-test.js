#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { retrieveKnowledge } = require("../plugins/ravo/modules/ravo-knowledge/scripts/retrieve-knowledge");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function snapshot(files) {
  return files.map((file) => ({
    file,
    content: fs.readFileSync(file, "utf8"),
    mtimeMs: fs.statSync(file).mtimeMs
  }));
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-knowledge-dedup-")));
const workspace = path.join(root, "workspace");
const alias = path.join(root, "workspace-alias");
const knowledge = path.join(workspace, "knowledge", ".ravo", "knowledge");
fs.mkdirSync(knowledge, { recursive: true });
fs.symlinkSync(workspace, alias, "dir");

const stableFile = path.join(knowledge, "stable.json");
const legacyFile = path.join(knowledge, "legacy.json");
writeJson(stableFile, {
  id: "KN-stable-001",
  kind: "lesson",
  scope: "workspace",
  status: "active",
  title: "稳定 ID 知识",
  summary: "JSON 原始记录优先",
  content: "source truth",
  applicability: ["别名路径测试"],
  useCount: 0
});
writeJson(legacyFile, {
  kind: "lesson",
  scope: "workspace",
  status: "active",
  title: "Legacy 知识",
  summary: "没有稳定 ID 时按真实路径去重",
  content: "legacy source",
  applicability: ["legacy 测试"],
  useCount: 0
});
const indexFile = path.join(knowledge, "index.json");
writeJson(indexFile, {
  entries: [
    {
      id: "KN-stable-001",
      kind: "lesson",
      scope: "workspace",
      status: "active",
      title: "稳定 ID 知识",
      summary: "过期索引投影",
      content: "stale projection",
      artifactPath: stableFile,
      applicability: ["别名路径测试"]
    },
    {
      kind: "lesson",
      scope: "workspace",
      status: "active",
      title: "Legacy 知识",
      summary: "旧索引投影",
      content: "legacy projection",
      artifactPath: legacyFile,
      applicability: ["legacy 测试"]
    }
  ]
});

const before = snapshot([stableFile, legacyFile, indexFile]);
const result = retrieveKnowledge({
  workspace: alias,
  query: "知识",
  recordUse: false,
  includeUser: false,
  now: "2026-07-21T00:00:00.000Z"
});

assert.equal(result.matches.length, 2);
assert.equal(result.matches.filter((item) => item.title === "稳定 ID 知识").length, 1);
assert.equal(result.matches.find((item) => item.title === "稳定 ID 知识").content, "source truth");
assert.equal(result.matches.filter((item) => item.title === "Legacy 知识").length, 1);
assert.equal(result.matches.find((item) => item.title === "Legacy 知识").content, "legacy source");
assert.ok(result.diagnostics.some((item) => item.code === "knowledge_identity_conflict" && item.id === "KN-stable-001"));
assert.deepEqual(snapshot([stableFile, legacyFile, indexFile]), before, "recordUse=false must preserve content and mtimes");

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({
  status: "pass",
  checks: [
    "stable ID deduplicates real and alias paths",
    "legacy records fall back to canonical realpath",
    "JSON source wins over index projection",
    "identity conflict is diagnosed once",
    "recordUse=false is strictly read-only"
  ]
}, null, 2));
