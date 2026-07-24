#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_VERSION = "0.6.3";

function resolveGitBaselineModulePath(scriptDir = __dirname, productVersion = PRODUCT_VERSION) {
  const workspaceModule = path.resolve(scriptDir, "../../ravo-core/scripts/ravo-git-baseline.js");
  if (fs.existsSync(workspaceModule)) return workspaceModule;
  return process.env.RAVO_PLUGIN_ROOT
    ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-git-baseline.js")
    : "";
}

const { captureGitBaseline, cleanWorktrees, finalizeGitBaseline, writeArtifact } = require(resolveGitBaselineModulePath());

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: prepare-acceptance-baseline.js --workspace <path> --start | --finalize --startup-ref <path> --task-path <path>");
    return;
  }
  if (process.argv.includes("--version")) { console.log(PRODUCT_VERSION); return; }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  if (process.argv.includes("--start")) {
    const baseline = captureGitBaseline(workspace);
    const file = writeArtifact(workspace, baseline, argValue("--output", "knowledge/.ravo/acceptance/git-startup-baseline.json"));
    console.log(JSON.stringify({ status: "started", artifactPath: file, baseline }, null, 2));
    return;
  }
  if (process.argv.includes("--finalize")) {
    const startupRef = path.resolve(workspace, argValue("--startup-ref", ""));
    const startup = JSON.parse(fs.readFileSync(startupRef, "utf8"));
    const baseline = finalizeGitBaseline(startup, {
      taskOwnedPaths: argValues("--task-path"),
      releaseSlice: argValue("--release-slice", "ravo-v0.6.3-reliable-closeout"),
      requirementRange: argValue("--requirement-range", "R603-001..005"),
      commitMessage: argValue("--commit-message", "")
    });
    const cleanup = cleanWorktrees(captureGitBaseline(workspace), { ownedWorktrees: argValues("--owned-worktree") });
    const result = { ...baseline, cleanup, artifactType: "acceptance_git_baseline" };
    const file = writeArtifact(workspace, result, argValue("--output", "knowledge/.ravo/acceptance/git-baseline.json"));
    console.log(JSON.stringify({ ...result, artifactPath: file }, null, 2));
    return;
  }
  throw new Error("Choose --start or --finalize.");
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "error", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PRODUCT_VERSION, resolveGitBaselineModulePath };
