#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  deliverCard,
  handlePermissionRequest,
  readControl,
  writeControl
} = require("../plugins/ravo/modules/ravo-core/hooks/ravo-permission-notify-hook");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-permission-hook-"));
const stateDb = path.join(workspace, "state_5.sqlite");
const control = path.join(workspace, "permission-notify.json");
const database = new DatabaseSync(stateDb);
database.exec("CREATE TABLE threads (id TEXT, title TEXT)");
database.prepare("INSERT INTO threads (id, title) VALUES (?, ?)").run("session-live", "RAVO 自动提醒验证");
database.close();

const payload = {
  hook_event_name: "PermissionRequest",
  session_id: "session-live",
  tool_name: "Bash",
  cwd: "/private/tmp/RAVO"
};

writeControl({ mode: "disabled" }, { controlFile: control });
const disabled = handlePermissionRequest(payload, { stateDb, controlFile: control });
assert.equal(disabled.sent, false);
assert.equal(readControl({ controlFile: control }).mode, "disabled");

writeControl({ mode: "observe" }, { controlFile: control });
const observed = handlePermissionRequest(payload, {
  stateDb,
  controlFile: control,
  run() { throw new Error("observe mode must not call lark-cli"); }
});
assert.equal(observed.reason, "armed");
assert.deepEqual(readControl({ controlFile: control }).mode, "enabled");
const stored = fs.readFileSync(control, "utf8");
assert.equal(stored.includes("session-live"), false);
assert.equal(stored.includes("RAVO 自动提醒验证"), false);

const calls = [];
const delivered = handlePermissionRequest(payload, {
  stateDb,
  controlFile: control,
  run(args) {
    calls.push(args);
    if (args[0] === "contact") return { stdout: JSON.stringify({ data: { open_id: "ou_test" } }) };
    return { stdout: JSON.stringify({ data: {} }) };
  }
});
assert.equal(delivered.sent, true);
assert.equal(calls.length, 2);
assert.deepEqual(calls[0].slice(0, 3), ["contact", "+get-user", "--as"]);
assert.equal(calls[1][0], "im");
assert.equal(calls[1][1], "+messages-send");
assert.equal(calls[1].includes("--msg-type"), true);
assert.equal(calls[1].includes("interactive"), true);
const content = calls[1][calls[1].indexOf("--content") + 1];
assert.equal(content.includes("session-live"), false);
assert.equal(content.includes("/private/tmp"), false);
assert.equal(content.includes("button"), false);

writeControl({ mode: "observe" }, { controlFile: control });
const unmatched = handlePermissionRequest({ ...payload, session_id: "missing" }, { stateDb, controlFile: control });
assert.equal(unmatched.sent, false);
assert.equal(readControl({ controlFile: control }).mode, "observe");

const timeout = deliverCard({ schema: "2.0" }, {
  startedAt: Date.now() - 9000,
  run() { throw new Error("timeout must not run"); }
});
assert.deepEqual(timeout, { delivered: false, reason: "timeout" });

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugins", "ravo", "hooks", "hooks.json"), "utf8"));
assert.equal(manifest.hooks.PermissionRequest, undefined);

console.log(JSON.stringify({
  status: "pass",
  checks: ["disabled-by-default", "observe-without-send", "matched-arms-sending", "four-field-delivery", "unmatched-stays-observe", "eight-second-fail-open", "permission-request-hook-unregistered"]
}, null, 2));
