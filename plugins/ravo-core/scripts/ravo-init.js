#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "0.2.0";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function ravoRoot(workspace) {
  return path.join(workspace, "knowledge", ".ravo");
}

function ensureManifest(workspace, moduleName = "core") {
  const root = ravoRoot(workspace);
  for (const dir of ["analysis", "workstream", "quick-validation", "acceptance", "continuation", "knowledge"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }

  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: SCHEMA_VERSION,
    workspace: ".",
    modules: {}
  };

  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
  manifest.workspace = manifest.workspace || ".";
  manifest.modules = manifest.modules || {};
  manifest.modules[moduleName] = {
    ...(manifest.modules[moduleName] || {}),
    enabled: true,
    artifacts: [path.posix.join("knowledge", ".ravo", moduleName === "core" ? "" : moduleName).replace(/\/$/, "")],
    updatedAt: new Date().toISOString()
  };

  writeJson(manifestPath, manifest);
  return { manifestPath, manifest };
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const moduleName = argValue("--module", "core");
  const result = ensureManifest(workspace, moduleName);
  console.log(JSON.stringify({
    status: "ok",
    manifestPath: result.manifestPath,
    module: moduleName
  }, null, 2));
}

if (require.main === module) main();

module.exports = { ensureManifest, ravoRoot, readJson, writeJson };
