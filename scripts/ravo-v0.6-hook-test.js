#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { handle } = require("../plugins/ravo/modules/ravo-acceptance/hooks/ravo-acceptance-stop");

function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true }).sort();
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ravo-v060-stop-"));
fs.mkdirSync(path.join(workspace, "knowledge", ".ravo"), { recursive: true });
const before = files(workspace);

const unsupported = () => ({
  status: "not_ready",
  acceptanceStatus: "not_ready",
  acceptanceScope: "delivery",
  releaseEligible: false,
  gate: { decision: "block", reason: "Required evidence is incomplete." }
});
const supported = () => ({
  status: "code_complete",
  acceptanceStatus: "code_complete",
  acceptanceScope: "delivery",
  releaseEligible: false,
  gate: { decision: "pass", reason: "" }
});

assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "I changed the parser." }, { runChecker: unsupported }), {});
assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "完成状态仍会被复查，避免任务被误判为已完成。" }, { runChecker: unsupported }), {});
assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "代码已完成。" }, { runChecker: supported }), {});

const missingPoolDisposition = handle({
  cwd: workspace,
  last_assistant_message: "这是一项新需求：让 PM 可以直接查看下一版本候选。"
}, { runChecker: unsupported });
assert.equal(missingPoolDisposition.decision, "block");
assert.match(missingPoolDisposition.reason, /Pool|入池|记录|处置/i);

for (const message of [
  "这是一项新需求，已记录为 confirmed candidate；当前任务范围不变。",
  "没有发现新的需求或范围外问题。",
  "没有发现新需求，也没有形成可复用经验。",
  "上面的‘这是一项新需求’只是用户引文，不代表本轮形成了候选。",
  "例如可以脑暴一个新需求，但当前还没有形成问题或目标。",
  "Stop Hook 的规则会检查‘新需求’等强信号，本段只是机制说明。",
  "v0.6.2 Spec 已生成，功能尚未开始实现。",
  "下一版本候选需求如下：当前 0 项，查询结果为空。",
  "这个本地拼写问题已经修复且无复发价值，无需入池。"
]) assert.deepEqual(handle({ cwd: workspace, last_assistant_message: message }, { runChecker: unsupported }), {}, message);

const firstStop = handle({
  cwd: workspace,
  stop_hook_active: false,
  last_assistant_message: "这个功能已完成。"
}, { runChecker: unsupported });
assert.equal(firstStop.decision, "block");
assert.match(firstStop.reason, /evidence|证据/i);
assert.match(firstStop.reason, /lower|降低|correct|修正/i);

let checkerCalls = 0;
const secondStop = handle({
  cwd: workspace,
  stop_hook_active: true,
  last_assistant_message: "这个功能已完成。"
}, { runChecker: () => { checkerCalls += 1; return unsupported(); } });
assert.deepEqual(secondStop, {});
assert.equal(checkerCalls, 0, "active loop guard must stop before another checker invocation");

const releaseStop = handle({
  cwd: workspace,
  stop_hook_active: false,
  last_assistant_message: "v0.6.0 已发布。"
}, { runChecker: supported });
assert.equal(releaseStop.decision, "block", "delivery evidence cannot support a release claim");

const combinedStop = handle({
  cwd: workspace,
  stop_hook_active: false,
  last_assistant_message: "功能已完成。另外发现一项范围外问题，需要后续处理。"
}, { runChecker: unsupported });
assert.equal(combinedStop.decision, "block");
assert.match(combinedStop.reason, /evidence|证据/i);
assert.match(combinedStop.reason, /Pool|入池|记录|处置/i);

assert.deepEqual(files(workspace), before, "Stop hook must not write telemetry, artifacts, or manifests");
fs.rmSync(workspace, { recursive: true, force: true });

console.log(JSON.stringify({
  status: "pass",
  scenarios: [
    "no-claim-empty",
    "misclassification-language-empty",
    "supported-claim-empty",
    "unsupported-first-stop-blocks-once",
    "active-second-stop-does-not-loop",
    "scope-mismatch-blocks",
    "pool-strong-signal-blocks-once",
    "pool-disposition-passes",
    "pool-negative-quote-brainstorm-mechanism-examples-pass",
    "acceptance-and-pool-audit-share-one-decision",
    "zero-writes"
  ]
}, null, 2));
