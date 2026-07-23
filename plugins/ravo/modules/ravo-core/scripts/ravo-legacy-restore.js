#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runCodex(args) {
  const child = spawnSync("codex", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (child.error || child.status !== 0) throw new Error(String(child.stderr || child.error?.message || `codex exited ${child.status}`).trim());
  const output = String(child.stdout || "").trim();
  return output ? JSON.parse(output) : {};
}

function listInstalled(executeCodex) {
  const result = executeCodex(["plugin", "list", "--marketplace", "ravo", "--json"]);
  return Array.isArray(result?.installed) ? result.installed : [];
}

function restoreLegacy(snapshotPath, options = {}) {
  const snapshot = path.resolve(snapshotPath);
  const state = JSON.parse(fs.readFileSync(path.join(snapshot, "state.json"), "utf8"));
  const marketplaceRoot = path.join(snapshot, "legacy-marketplace");
  const executeCodex = options.executeCodex || runCodex;
  const before = listInstalled(executeCodex);
  if (before.some((entry) => entry.pluginId === "ravo@ravo")) executeCodex(["plugin", "remove", "ravo@ravo", "--json"]);
  executeCodex(["plugin", "marketplace", "remove", "ravo", "--json"]);
  executeCodex(["plugin", "marketplace", "add", marketplaceRoot, "--json"]);
  for (const plugin of state.plugins) executeCodex(["plugin", "add", plugin.pluginId, "--json"]);
  const after = listInstalled(executeCodex);
  const expected = state.plugins.map((entry) => entry.pluginId).sort();
  const observed = after.filter((entry) => entry.installed !== false && entry.enabled !== false).map((entry) => entry.pluginId).sort();
  if (after.some((entry) => entry.pluginId === "ravo@ravo") || JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`legacy_restore_verification_failed:${JSON.stringify(observed)}`);
  }
  return { status: "restored", snapshotPath: snapshot, installed: observed, freshSessionRequired: true };
}

function main() {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ status: "preview", snapshotPath: __dirname, command: `node ${JSON.stringify(__filename)} --apply` }, null, 2));
    return;
  }
  console.log(JSON.stringify(restoreLegacy(__dirname), null, 2));
}

if (require.main === module) main();

module.exports = { listInstalled, restoreLegacy, runCodex };
