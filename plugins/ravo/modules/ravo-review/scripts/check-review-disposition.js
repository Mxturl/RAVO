#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { checkLedger } = require("./review-disposition");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: check-review-disposition.js --workspace <path> --issue-ledger-ref <path>");
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const reference = argValue("--issue-ledger-ref", "").trim();
  const file = path.resolve(workspace, reference);
  if (!reference || !file.startsWith(`${workspace}${path.sep}`) || !fs.existsSync(file)) throw new Error("--issue-ledger-ref must reference a readable workspace file.");
  const result = { ...checkLedger(JSON.parse(fs.readFileSync(file, "utf8"))), issueLedgerRef: path.relative(workspace, file) };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "pass") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { checkLedger };
