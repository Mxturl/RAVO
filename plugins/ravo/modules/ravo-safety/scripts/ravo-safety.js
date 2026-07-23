#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  confirmPlan,
  execute,
  executeRestore,
  preview,
  previewRestore
} = require("./safety-model");

function valueFor(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function readInput() {
  const file = valueFor("--input");
  if (!file) throw new Error("--input <json-file> is required.");
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function printHelp() {
  process.stdout.write([
    "Usage: ravosafety.js --mode preview|confirm|execute|preview-restore|execute-restore --input <json-file>",
    "preview input: SafetyRequest",
    "confirm input: { plan, envelope, now? }",
    "execute input: { confirmedPlan, now? }",
    "preview-restore input: { execution }",
    "execute-restore input: { confirmedPlan, now? }"
  ].join("\n") + "\n");
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const mode = valueFor("--mode");
  const input = readInput();
  let result;
  if (mode === "preview") result = preview(input);
  else if (mode === "confirm") result = confirmPlan(input.plan, input.envelope, input.now);
  else if (mode === "execute") result = execute(input.confirmedPlan, input.now);
  else if (mode === "preview-restore") result = previewRestore(input.execution);
  else if (mode === "execute-restore") result = executeRestore(input.confirmedPlan, input.now);
  else throw new Error("--mode must be preview, confirm, execute, preview-restore, or execute-restore.");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ravo-safety failed: ${error.message}\n`);
  process.exitCode = 1;
}
