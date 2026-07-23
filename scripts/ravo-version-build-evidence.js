#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateVersionBuildEvidence } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-version-policy");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-version-build-evidence.js --evidence <project-evidence.json> [--require-built]");
    return;
  }
  const file = path.resolve(argValue("--evidence", "ravo-version-build-evidence.json"));
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.log(JSON.stringify({ status: "build_version_unverified", errors: [`Cannot read version build evidence: ${error.message}`] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const result = validateVersionBuildEvidence(evidence);
  console.log(JSON.stringify({ ...result, evidencePath: file }, null, 2));
  if (result.status === "build_version_unverified" || (process.argv.includes("--require-built") && result.status !== "verified")) process.exitCode = 2;
}

if (require.main === module) main();
