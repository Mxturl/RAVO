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
const acceptanceDir = path.join(workspace, "knowledge", ".ravo", "acceptance");
fs.mkdirSync(acceptanceDir, { recursive: true });
const writeAcceptance = (name, value) => fs.writeFileSync(path.join(acceptanceDir, name), `${JSON.stringify(value)}\n`);
writeAcceptance("current.json", { sourceRefs: ["conversation:thread-current#release"] });
writeAcceptance("unrelated-latest.json", { sourceRefs: ["conversation:thread-other#release"] });
writeAcceptance("ambiguous-a.json", { sourceRefs: ["conversation:thread-ambiguous#first"] });
writeAcceptance("ambiguous-b.json", { realResponseRefs: ["conversation:thread-ambiguous#second"] });
fs.writeFileSync(path.join(workspace, "knowledge", "outside.json"), "{}\n");
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
const releaseReady = () => ({
  status: "release_ready",
  acceptanceStatus: "release_ready",
  acceptanceScope: "release",
  releaseEligible: true,
  gate: { decision: "pass", reason: "" }
});

assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "I changed the parser." }, { runChecker: unsupported }), {});
assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "完成状态仍会被复查，避免任务被误判为已完成。" }, { runChecker: unsupported }), {});
assert.deepEqual(handle({ cwd: workspace, last_assistant_message: "代码已完成。" }, { runChecker: supported }), {});

let explicitRef = "";
const explicitEvidence = handle({
  cwd: workspace,
  last_assistant_message: `v0.6.3 已发布。证据：[Acceptance](${path.join(acceptanceDir, "current.json")})`
}, { runChecker: (_cwd, ref) => { explicitRef = ref; return releaseReady(); } });
assert.deepEqual(explicitEvidence, {});
assert.equal(explicitRef, "knowledge/.ravo/acceptance/current.json");

let sessionRef = "";
const sessionEvidence = handle({
  cwd: workspace,
  session_id: "thread-current",
  last_assistant_message: "v0.6.3 已发布。"
}, { runChecker: (_cwd, ref) => { sessionRef = ref; return releaseReady(); } });
assert.deepEqual(sessionEvidence, {});
assert.equal(sessionRef, "knowledge/.ravo/acceptance/current.json", "unrelated latest evidence must not replace the current task artifact");

let unrelatedCheckerCalls = 0;
const unrelatedEvidence = handle({
  cwd: workspace,
  session_id: "thread-without-evidence",
  last_assistant_message: "v0.6.3 已发布。"
}, { runChecker: () => { unrelatedCheckerCalls += 1; return releaseReady(); } });
assert.equal(unrelatedEvidence.decision, "block", "unrelated release-ready evidence must not support the current task");
assert.match(unrelatedEvidence.reason, /task-local|current task|当前任务|绑定/i);
assert.equal(unrelatedCheckerCalls, 0);

let ambiguousCheckerCalls = 0;
const ambiguousEvidence = handle({
  cwd: workspace,
  session_id: "thread-ambiguous",
  last_assistant_message: "v0.6.3 已发布。"
}, { runChecker: () => { ambiguousCheckerCalls += 1; return releaseReady(); } });
assert.equal(ambiguousEvidence.decision, "block");
assert.match(ambiguousEvidence.reason, /ambiguous|multiple|歧义|多个/i);
assert.equal(ambiguousCheckerCalls, 0);

let invalidCheckerCalls = 0;
const invalidExplicitEvidence = handle({
  cwd: workspace,
  last_assistant_message: "v0.6.3 已发布。证据：knowledge/.ravo/acceptance/../../outside.json"
}, { runChecker: () => { invalidCheckerCalls += 1; return releaseReady(); } });
assert.equal(invalidExplicitEvidence.decision, "block");
assert.match(invalidExplicitEvidence.reason, /invalid|outside|无效|越界/i);
assert.equal(invalidCheckerCalls, 0);

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
  "v0.6.3 Spec 已生成，功能尚未开始实现。",
  "下一版本候选需求如下：当前 0 项，查询结果为空。",
  "这个本地拼写问题已经修复且无复发价值，无需入池。"
]) assert.deepEqual(handle({ cwd: workspace, last_assistant_message: message }, { runChecker: unsupported }), {}, message);

let directCheckerCalls = 0;
const firstStop = handle({
  cwd: workspace,
  stop_hook_active: false,
  last_assistant_message: "这个功能已完成。"
}, { runChecker: () => { directCheckerCalls += 1; return unsupported(); } });
assert.deepEqual(firstStop, {}, "a bounded completion claim must not require an Acceptance artifact");
assert.equal(directCheckerCalls, 0);

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
assert.match(releaseStop.reason, /task-local|current task|当前任务|绑定/i);

const combinedStop = handle({
  cwd: workspace,
  stop_hook_active: false,
  last_assistant_message: "版本已完成。另外发现一项范围外问题，需要后续处理。"
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
    "bounded-completion-without-acceptance-empty",
    "explicit-acceptance-binding",
    "session-bound-acceptance-ignores-unrelated-latest",
    "unrelated-acceptance-cannot-support-current-task",
    "ambiguous-task-binding-blocks-once",
    "invalid-explicit-reference-blocks-once",
    "active-second-stop-does-not-loop",
    "scope-mismatch-blocks",
    "pool-strong-signal-blocks-once",
    "pool-disposition-passes",
    "pool-negative-quote-brainstorm-mechanism-examples-pass",
    "acceptance-and-pool-audit-share-one-decision",
    "zero-writes"
  ]
}, null, 2));
