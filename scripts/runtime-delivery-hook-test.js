#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "plugins/ravo/hooks/hooks.json"), "utf8"));
assert.deepEqual(Object.keys(manifest.hooks).sort(), ["Stop"]);
assert.equal(manifest.hooks.PermissionRequest, undefined);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-runtime-hook-"));
const stop = path.join(repo, "plugins/ravo/modules/ravo-acceptance/hooks/ravo-acceptance-stop.js");
const result = spawnSync(process.execPath, [stop], {
  input: JSON.stringify({ cwd: workspace, last_assistant_message: "The local setting is off." }),
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"]
});
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(JSON.parse(result.stdout), {});
assert.equal(fs.existsSync(path.join(workspace, "knowledge/.ravo")), false);

assert.equal(fs.existsSync(path.join(workspace, ".codex/ravo/permission-notify.json")), false);
fs.rmSync(workspace, { recursive: true, force: true });

console.log(JSON.stringify({
  status: "pass",
  scriptEvidence: { promptInjection: "no", artifact: "no", permissionNotification: "not_registered" },
  checks: ["only-stop-hook", "bounded-read-only-stop-empty", "permission-hook-unregistered", "zero-placeholder-artifacts"]
}, null, 2));
