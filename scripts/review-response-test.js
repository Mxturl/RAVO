#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  buildIssueLedger,
  extractFinalText,
  parseReviewResponse,
  parseReviewerJson
} = require("../plugins/ravo/modules/ravo-review/scripts/review-response");

const finding = {
  title: "Coverage is overstated",
  severity: "high",
  evidence: "A responded model is counted as usable before schema validation.",
  mechanismRisk: "Acceptance can consume an invalid review artifact.",
  recommendation: "Gate usable models on final text, truncation, and schema validation."
};
const reviewer = { summary: "One evidence-integrity issue found.", findings: [finding] };
const reviewerText = JSON.stringify(reviewer);
const context = { providerModelKey: "openai/gpt-5", round: 2, rawResponseRef: "raw/run-1.json" };

function responsesPayload(overrides = {}) {
  return {
    status: "completed",
    usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125, output_tokens_details: { reasoning_tokens: 5 }, ignored: "not-numeric" },
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "private chain of thought" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: reviewerText }] }
    ],
    ...overrides
  };
}

function testResponsesJson() {
  const result = parseReviewResponse(responsesPayload(), context);
  assert.equal(result.usable, true);
  assert.equal(result.finalText, reviewerText);
  assert.equal(result.finalText.includes("private chain of thought"), false);
  assert.equal(result.parserStatus, "pass");
  assert.equal(result.providerBehavior.status, "completed");
  assert.equal(result.providerBehavior.usage.output_tokens, 25);
  assert.equal(result.providerBehavior.usage.output_tokens_details.reasoning_tokens, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(result.providerBehavior.usage, "ignored"), false);
  assert.equal(result.issueLedger[0].providerModelKey, context.providerModelKey);
  assert.equal(result.issueLedger[0].round, context.round);
  assert.equal(result.issueLedger[0].rawResponseRef, context.rawResponseRef);
}

function testReasoningOnlyFails() {
  const result = parseReviewResponse({ status: "completed", output: [{ type: "reasoning", content: [{ type: "output_text", text: reviewerText }] }] }, context);
  assert.equal(result.usable, false);
  assert.equal(result.finalText, "");
  assert.deepEqual(result.issueLedger, []);
  assert.ok(result.parserErrors.includes("response.empty_final_text"));
}

function testResponsesIncompleteFails() {
  const result = parseReviewResponse(responsesPayload({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), context);
  assert.equal(result.usable, false);
  assert.equal(result.incomplete, true);
  assert.equal(result.providerBehavior.status, "incomplete");
  assert.equal(result.providerBehavior.incompleteReason, "max_output_tokens");
  assert.ok(result.parserErrors.includes("response.truncated:max_output_tokens"));
  assert.deepEqual(result.issueLedger, []);
}

function testResponsesSse() {
  const first = reviewerText.slice(0, 30);
  const second = reviewerText.slice(30);
  const sse = [
    `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "ignore me" })}`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: first })}`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: second })}`,
    `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", text: reviewerText })}`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: responsesPayload() })}`,
    "data: [DONE]"
  ].join("\n\n");
  const result = parseReviewResponse(sse, context);
  assert.equal(result.usable, true);
  assert.equal(result.finalText, reviewerText);
  assert.equal(result.finalText.includes("ignore me"), false);
  assert.equal(result.providerBehavior.status, "completed");
  assert.equal(result.providerBehavior.usage.output_tokens, 25);
}

function testResponsesIncompleteSse() {
  const sse = `event: response.incomplete\ndata: ${JSON.stringify({
    type: "response.incomplete",
    response: responsesPayload({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })
  })}\n\ndata: [DONE]\n\n`;
  const result = parseReviewResponse(sse, context);
  assert.equal(result.usable, false);
  assert.equal(result.incomplete, true);
}

function testChatCompletionsJson() {
  const result = parseReviewResponse({
    choices: [{ message: { content: reviewerText, reasoning_content: "ignore me" }, finish_reason: "stop" }]
  }, context);
  assert.equal(result.usable, true);
  assert.equal(result.finalText, reviewerText);
  assert.equal(result.providerBehavior.status, "completed");
  assert.equal(result.providerBehavior.finishReason, "stop");
}

function testChatLengthFails() {
  const result = parseReviewResponse({ choices: [{ message: { content: reviewerText }, finish_reason: "length" }] }, context);
  assert.equal(result.usable, false);
  assert.equal(result.truncationReason, "length");
  assert.equal(result.providerBehavior.status, "incomplete");
  assert.equal(result.providerBehavior.incompleteReason, "length");
}

function testChatSse() {
  const chunks = [reviewerText.slice(0, 40), reviewerText.slice(40)];
  const sse = chunks.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`)
    .concat(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]")
    .join("\n\n");
  const result = parseReviewResponse(sse, context);
  assert.equal(result.usable, true);
  assert.equal(result.finalText, reviewerText);
}

function testMarkdownFence() {
  const result = parseReviewerJson(`Final answer:\n\n\`\`\`json\n${reviewerText}\n\`\`\``);
  assert.equal(result.valid, true);
  assert.equal(result.reviewer.summary, reviewer.summary);
  assert.equal(result.reviewer.findings[0].verificationStatus, "missing");
  assert.equal(result.reviewer.findings[0].decisionEligibility, "advisory_only");
}

function testHighFindingVerificationEligibility() {
  const complete = {
    ...finding,
    verification: {
      kind: "script",
      steps: ["Run the parser fixture."],
      command: "node scripts/review-response-test.js",
      expected: "The structured finding is parsed.",
      environment: "RAVO fixture",
      safety: "read_only",
      commandNotApplicableReason: ""
    }
  };
  const ready = parseReviewerJson(JSON.stringify({ summary: "verified", findings: [complete] }));
  assert.equal(ready.valid, true);
  assert.equal(ready.reviewer.findings[0].verificationStatus, "ready");
  assert.equal(ready.reviewer.findings[0].decisionEligibility, "pending_local_verification");

  const mediumInvalid = parseReviewerJson(JSON.stringify({
    summary: "bad medium verification",
    findings: [{ ...finding, severity: "medium", verification: { kind: "script", steps: [] } }]
  }));
  assert.equal(mediumInvalid.valid, false);
  assert.ok(mediumInvalid.parserErrors.some((error) => /verification/.test(error)));
}

function testInvalidSchemaFailsWithoutPlaceholder() {
  for (const body of [
    JSON.stringify({ summary: "No findings", findings: [] }),
    JSON.stringify({ summary: "Bad finding", findings: [{ title: "x", severity: "urgent" }] }),
    "风险：数据库可能丢数据。\n建议：增加备份。"
  ]) {
    const result = parseReviewResponse(body, context);
    assert.equal(result.usable, false);
    assert.deepEqual(result.issueLedger, []);
    assert.equal(result.ledgerFindingCount, 0);
  }
  const invalidFinding = parseReviewResponse(JSON.stringify({ summary: "Bad finding", findings: [{ title: "x", severity: "urgent" }] }), context);
  assert.equal(invalidFinding.rawFindingCount, 1);
  assert.equal(invalidFinding.deduplicatedCount, 0);
}

function testMalformedSseFailsClosed() {
  const sse = [
    "data: provider-noise",
    `data: ${JSON.stringify({ type: "response.output_text.done", text: reviewerText })}`,
    "data: [DONE]"
  ].join("\n\n");
  const result = parseReviewResponse(sse, context);
  assert.equal(result.usable, false);
  assert.ok(result.parserErrors.includes("response.sse_event_invalid"));
  assert.deepEqual(result.issueLedger, []);
}

function testStableDeduplicatedLedger() {
  const records = [
    { providerModelKey: "b/model", round: 1, rawResponseRef: "raw/b.json", reviewer },
    { providerModelKey: "a/model", round: 2, rawResponseRef: "raw/a.json", reviewer }
  ];
  const forward = buildIssueLedger(records);
  const reverse = buildIssueLedger([...records].reverse());
  assert.equal(forward.parserStatus, "pass");
  assert.equal(forward.rawFindingCount, 2);
  assert.equal(forward.ledgerFindingCount, 1);
  assert.equal(forward.deduplicatedCount, 1);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.issues[0].sources, [
    { providerModelKey: "a/model", round: 2, rawResponseRef: "raw/a.json" },
    { providerModelKey: "b/model", round: 1, rawResponseRef: "raw/b.json" }
  ]);
}

function testPartialLedgerStatus() {
  const result = buildIssueLedger([
    { providerModelKey: "a/model", round: 1, rawResponseRef: "raw/a.json", reviewer },
    { providerModelKey: "b/model", round: 1, rawResponseRef: "raw/b.json", reviewer: { summary: "bad", findings: [] } }
  ]);
  assert.equal(result.parserStatus, "partial");
  assert.equal(result.ledgerFindingCount, 1);
  assert.ok(result.parserErrors.includes("records[1].review.findings_empty"));
}

function testTopLevelOutputText() {
  assert.equal(extractFinalText({ output_text: reviewerText, status: "completed" }).finalText, reviewerText);
}

for (const test of [
  testResponsesJson,
  testReasoningOnlyFails,
  testResponsesIncompleteFails,
  testResponsesSse,
  testResponsesIncompleteSse,
  testChatCompletionsJson,
  testChatLengthFails,
  testChatSse,
  testMarkdownFence,
  testHighFindingVerificationEligibility,
  testInvalidSchemaFailsWithoutPlaceholder,
  testMalformedSseFailsClosed,
  testStableDeduplicatedLedger,
  testPartialLedgerStatus,
  testTopLevelOutputText
]) test();

console.log("review response tests passed");
