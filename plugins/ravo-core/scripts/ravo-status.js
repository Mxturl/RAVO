#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CONFIG = {
  technicalDetailLevel: 3,
  globalKnowledge: {
    enabled: false,
    path: "~/.codex/ravo/knowledge",
    requireRedaction: true
  },
  acceptance: {
    securityBaseline: { enabled: true },
    requireRealE2EForRelease: true
  },
  hooks: {
    showTrustReminder: true
  }
};

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

function expandHome(value) {
  return String(value || "").replace(/^~(?=$|\/|\\)/, os.homedir());
}

function latestJson(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.join(dir, file))
      .sort()
      .at(-1) || "";
  } catch (_err) {
    return "";
  }
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readConfig(workspace) {
  const userConfigPath = path.join(os.homedir(), ".codex", "skill-config", "ravo.json");
  const workspaceConfigPath = path.join(workspace, "knowledge", ".ravo", "config.json");
  const warnings = [];
  const config = deepMerge(
    deepMerge(DEFAULT_CONFIG, readJson(userConfigPath) || {}),
    readJson(workspaceConfigPath) || {}
  );
  if (!Number.isInteger(config.technicalDetailLevel) || config.technicalDetailLevel < 1 || config.technicalDetailLevel > 5) {
    warnings.push("Invalid technicalDetailLevel; falling back to 3.");
    config.technicalDetailLevel = 3;
  }
  return {
    config,
    warnings,
    paths: {
      userConfigPath,
      workspaceConfigPath
    }
  };
}

function pluginStatus(repo, name) {
  const manifestPath = path.join(repo, "plugins", name, ".codex-plugin", "plugin.json");
  const manifest = readJson(manifestPath);
  return {
    name,
    present: Boolean(manifest),
    version: manifest?.version || "",
    displayName: manifest?.interface?.displayName || "",
    hasHooks: Boolean(manifest?.hooks),
    manifestPath: fs.existsSync(manifestPath) ? path.relative(repo, manifestPath) : ""
  };
}

function buildStatus(workspace, repo) {
  const ravoRoot = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(ravoRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const moduleDirs = ["analysis", "workstream", "quick-validation", "acceptance", "continuation", "knowledge", "review"];
  const config = readConfig(workspace);
  const plugins = [
    "ravo-core",
    "ravo-analysis",
    "ravo-workstream",
    "ravo-quick-validation",
    "ravo-acceptance",
    "ravo-knowledge",
    "ravo-review"
  ].map((name) => pluginStatus(repo, name));

  return {
    status: manifest ? "ok" : "missing_manifest",
    workspace,
    manifestPath,
    manifestExists: Boolean(manifest),
    schemaVersion: manifest?.schemaVersion || "",
    plugins,
    latestArtifacts: Object.fromEntries(moduleDirs.map((dir) => [dir, latestJson(path.join(ravoRoot, dir))])),
    config: config.config,
    configPaths: config.paths,
    warnings: config.warnings,
    reminders: [
      "Run ravo-core init if knowledge/.ravo/manifest.json is missing.",
      "After install or upgrade, approve RAVO hooks if Codex asks for trust.",
      "Start a fresh Codex thread after plugin changes before testing natural triggers.",
      "Preview global AGENTS.md changes before applying; never edit it silently."
    ]
  };
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const repo = path.resolve(argValue("--repo", path.join(__dirname, "..", "..", "..")));
  console.log(JSON.stringify(buildStatus(workspace, repo), null, 2));
}

if (require.main === module) main();

module.exports = { buildStatus, readConfig, DEFAULT_CONFIG, expandHome };
