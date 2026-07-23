#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  FIELD_NAMES,
  CARD_TITLE,
  HOOK_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  TITLE_FALLBACK,
  buildNotification,
  classifyTool,
  projectName,
  resolveStateDatabase
} = require("../plugins/ravo/modules/ravo-core/scripts/ravo-permission-notify");

const repo = path.resolve(__dirname, "..");
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-permission-notify-")));
const stateDb = path.join(workspace, "state_5.sqlite");
const database = new DatabaseSync(stateDb);
database.exec("CREATE TABLE threads (id TEXT, title TEXT)");

const threads = [
  ["session-a", "修复支付回调"],
  ["session-b", "核对数据导入"],
  ["session-c", "更新用户权限"],
  ["session-d", "检查构建失败"]
];
const insert = database.prepare("INSERT INTO threads (id, title) VALUES (?, ?)");
for (const thread of threads) insert.run(...thread);
const fixturePath = ["", "Users", "alice", "secret.txt"].join("/");
const fixtureToken = ["sk", "abcdefghijklmnop"].join("-");
insert.run("session-unsafe", `查看 ${fixturePath}`);
insert.run("session-token", `排查 ${fixtureToken}`);
insert.run("session-assignment", `参数=${fixturePath}`);
insert.run("session-plain-text", "核对 [显示文本](target)");
database.close();

const expected = [
  ["session-a", "Bash", "修复支付回调", "需要确认执行命令", "命令执行"],
  ["session-b", "apply_patch", "核对数据导入", "需要确认修改文件", "文件修改"],
  ["session-c", "mcp__server__tool", "更新用户权限", "需要确认调用工具", "MCP 调用"],
  ["session-d", "other", "检查构建失败", "需要确认操作", "其他"]
];

for (const [sessionId, toolName, title, reason, authorizationType] of expected) {
  const result = buildNotification({
    hook_event_name: "PermissionRequest",
    session_id: sessionId,
    tool_name: toolName,
    cwd: "/private/tmp/project-alpha",
    tool_input: { description: "rm -rf /private/tmp/project-alpha --token=secret" }
  }, { stateDb });
  assert.equal(result.deliveryEligible, true, sessionId);
  assert.equal(result.reason, "ready", sessionId);
  assert.equal(result.fields["任务标题"], title, sessionId);
  assert.equal(result.fields["项目"], "project-alpha", sessionId);
  assert.equal(result.fields["介入原因"], reason, sessionId);
  assert.equal(result.fields["授权类型"], authorizationType, sessionId);
  assert.deepEqual(Object.keys(result.fields), FIELD_NAMES, sessionId);
  assert.ok(result.elapsedMs <= HOOK_TIMEOUT_MS, sessionId);
  assert.equal(JSON.stringify(result.fields).includes("/private/tmp"), false, sessionId);
  assert.equal(JSON.stringify(result.fields).includes("rm -rf"), false, sessionId);
  assert.equal(JSON.stringify(result.fields).includes(sessionId), false, sessionId);
  assert.equal(result.card.schema, "2.0", sessionId);
  assert.equal(result.card.config.width_mode, "default", sessionId);
  assert.equal(result.card.header.title.content, CARD_TITLE, sessionId);
  assert.equal(result.card.header.template, "orange", sessionId);
  assert.deepEqual(result.card.header.icon, { tag: "standard_icon", token: "warning_outlined", color: "orange" }, sessionId);
  assert.equal(result.card.body.elements.length, 2, sessionId);
  const [taskBlock, interventionBlock] = result.card.body.elements;
  assert.equal(taskBlock.tag, "div", sessionId);
  assert.equal(taskBlock.text.tag, "plain_text", sessionId);
  assert.ok(taskBlock.text.content.startsWith("任务标题："), sessionId);
  assert.equal(taskBlock.text.text_size, "heading-4", sessionId);
  assert.equal(taskBlock.text.lines, 2, sessionId);
  assert.equal(taskBlock.fields.length, 1, sessionId);
  assert.equal(taskBlock.fields[0].text.tag, "plain_text", sessionId);
  assert.ok(taskBlock.fields[0].text.content.startsWith("项目\n"), sessionId);
  assert.equal(interventionBlock.tag, "div", sessionId);
  assert.equal(interventionBlock.text.tag, "plain_text", sessionId);
  assert.ok(interventionBlock.text.content.startsWith("介入原因："), sessionId);
  assert.equal(interventionBlock.text.text_size, "normal", sessionId);
  assert.equal(interventionBlock.text.lines, 2, sessionId);
  assert.equal(interventionBlock.fields.length, 1, sessionId);
  assert.equal(interventionBlock.fields[0].text.tag, "plain_text", sessionId);
  assert.ok(interventionBlock.fields[0].text.content.startsWith("授权类型\n"), sessionId);
  const cardText = [
    taskBlock.text.content,
    taskBlock.fields[0].text.content,
    interventionBlock.text.content,
    interventionBlock.fields[0].text.content
  ].join("\n");
  for (const field of FIELD_NAMES) assert.ok(cardText.includes(field), sessionId);
  assert.equal(cardText.includes("/private/tmp"), false, sessionId);
  assert.equal(cardText.includes("rm -rf"), false, sessionId);
  assert.equal(cardText.includes(sessionId), false, sessionId);
  assert.doesNotMatch(JSON.stringify(result.card), /button|behaviors|open_url|callback|action/i, sessionId);
}

const missing = buildNotification({ hook_event_name: "PermissionRequest", session_id: "missing", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
assert.equal(missing.deliveryEligible, false);
assert.equal(missing.reason, "title_unavailable");
assert.equal(missing.fields["任务标题"], TITLE_FALLBACK);

const unsafe = buildNotification({ hook_event_name: "PermissionRequest", session_id: "session-unsafe", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
assert.equal(unsafe.deliveryEligible, false);
assert.equal(unsafe.fields["任务标题"], TITLE_FALLBACK);

const tokenTitle = buildNotification({ hook_event_name: "PermissionRequest", session_id: "session-token", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
assert.equal(tokenTitle.deliveryEligible, false);
assert.equal(tokenTitle.fields["任务标题"], TITLE_FALLBACK);

const assignmentTitle = buildNotification({ hook_event_name: "PermissionRequest", session_id: "session-assignment", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
assert.equal(assignmentTitle.deliveryEligible, false);
assert.equal(assignmentTitle.fields["任务标题"], TITLE_FALLBACK);

const plainTextTitle = buildNotification({ hook_event_name: "PermissionRequest", session_id: "session-plain-text", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
assert.equal(plainTextTitle.deliveryEligible, true);
assert.ok(plainTextTitle.card.body.elements[0].text.content.includes("核对 [显示文本](target)"));
assert.equal(projectName("C:\\Users\\alice\\project-beta"), "project-beta");

const lock = new DatabaseSync(stateDb);
lock.exec("BEGIN EXCLUSIVE");
const lockStartedAt = Date.now();
const locked = buildNotification({ hook_event_name: "PermissionRequest", session_id: "session-a", tool_name: "Bash", cwd: "/tmp/demo" }, { stateDb });
const lockElapsedMs = Date.now() - lockStartedAt;
lock.exec("ROLLBACK");
lock.close();
assert.equal(locked.deliveryEligible, false);
assert.equal(locked.reason, "title_unavailable");
assert.ok(lockElapsedMs <= HOOK_TIMEOUT_MS, `locked read took ${lockElapsedMs}ms`);

const home = path.join(workspace, "home");
const codexDir = path.join(home, ".codex");
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(path.join(codexDir, "state_1.sqlite"), "");
fs.writeFileSync(path.join(codexDir, "state_2.sqlite"), "");
assert.equal(resolveStateDatabase({ home }), "");
fs.unlinkSync(path.join(codexDir, "state_2.sqlite"));
assert.equal(resolveStateDatabase({ home }), path.join(codexDir, "state_1.sqlite"));

const nonPermission = buildNotification({ hook_event_name: "Stop" }, { stateDb });
assert.equal(nonPermission.reason, "not_permission_request");
assert.equal(nonPermission.card, null);
assert.deepEqual(classifyTool("mcp__server__tool"), { reason: "需要确认调用工具", authorizationType: "MCP 调用" });
assert.equal(QUERY_TIMEOUT_MS, 1000);

const script = path.join(repo, "plugins/ravo/modules/ravo-core/scripts/ravo-permission-notify.js");
const hookResult = spawnSync(process.execPath, [script], {
  input: JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "session-a", tool_name: "Bash", cwd: "/tmp/demo" }),
  encoding: "utf8"
});
assert.equal(hookResult.status, 0, hookResult.stderr);
assert.equal(hookResult.stdout, "", "default hook path must stay silent and fail-open");

const dryRun = spawnSync(process.execPath, [script, "--dry-run", "--state-db", stateDb], {
  input: JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "session-a", tool_name: "Bash", cwd: "/tmp/demo" }),
  encoding: "utf8"
});
assert.equal(dryRun.status, 0, dryRun.stderr);
const dryRunOutput = JSON.parse(dryRun.stdout);
assert.equal(dryRunOutput.deliveryEligible, true);
assert.deepEqual(Object.keys(dryRunOutput.fields), FIELD_NAMES);
assert.equal(dryRunOutput.card.header.title.content, CARD_TITLE);
assert.doesNotMatch(JSON.stringify(dryRunOutput.card), /button|behaviors|open_url|callback|action/i);

const source = fs.readFileSync(script, "utf8");
assert.doesNotMatch(source, /child_process|lark-cli/);

console.log(JSON.stringify({
  status: "pass",
  checks: ["exact-title-mapping", "four-field-allowlist", "static-card-rendering", "plain-text-card-content", "no-card-actions", "tool-classification", "unsafe-title-fallback", "locked-state-fail-open", "ambiguous-state-db-fail-closed", "silent-fail-open-hook", "dry-run-only", "no-delivery-subprocess"]
}, null, 2));
