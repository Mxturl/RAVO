#!/usr/bin/env node

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const files = execFileSync("git", ["ls-files", "scripts/*test*.js"], {
  cwd: repo,
  encoding: "utf8"
}).trim().split(/\r?\n/).filter(Boolean);

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [file], {
    cwd: repo,
    encoding: "utf8",
    env: process.env,
    timeout: 15 * 60 * 1000
  });
  if (result.status !== 0) {
    failures.push({ file, status: result.status, signal: result.signal || "", stderr: String(result.stderr || "").slice(-4000) });
  }
}

const summary = { status: failures.length ? "fail" : "pass", total: files.length, passed: files.length - failures.length, failures };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) process.exit(1);
