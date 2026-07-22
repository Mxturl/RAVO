#!/usr/bin/env node

const fs = require("node:fs");
const {
  evaluateAttempt,
  evaluateAuthorization,
  evaluateFastTrack,
  evaluateRecoveryWorkers,
  evaluateRules
} = require("./workstream-model");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readInput() {
  const file = argValue("--input", "");
  const raw = file ? fs.readFileSync(file, "utf8") : argValue("--input-json", "{}");
  return JSON.parse(raw);
}

function evaluate(input) {
  if (input.kind === "authorization") return evaluateAuthorization(input.envelope, input.request, input.now);
  if (input.kind === "attempt") return evaluateAttempt(input.blocker, input.attempt, input.options);
  if (input.kind === "recovery") return evaluateRecoveryWorkers(input.request);
  if (input.kind === "fast_track") return evaluateFastTrack(input.request);
  if (input.kind === "rules") return evaluateRules(input.rules, input.context);
  throw new Error("kind must be authorization, attempt, recovery, fast_track, or rules");
}

function main() {
  try {
    const result = evaluate(readInput());
    console.log(JSON.stringify(result, null, 2));
    if (result.allowed === false || result.valid === false || ["must_confirm", "prohibited"].includes(result.mode)) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { evaluate };
