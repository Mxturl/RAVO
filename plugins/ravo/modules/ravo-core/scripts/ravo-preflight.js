#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_VERSION = "0.6.2";
const SKILLS = [
  "ravo-core",
  "ravo-dashboard",
  "ravo-knowledge",
  "ravo-quick-validation",
  "ravo-release-acceptance",
  "ravo-requirement-analysis",
  "ravo-review",
  "ravo-root-cause-analysis",
  "ravo-workstream"
];
const MODULE_ENTRIES = {
  "ravo-acceptance": ["scripts/check-ravo-acceptance.js", "scripts/write-acceptance-artifact.js"],
  "ravo-analysis": ["scripts/write-analysis-artifact.js", "scripts/write-decision-spec.js"],
  "ravo-core": ["scripts/ravo-init.js", "scripts/ravo-status.js", "scripts/ravo-migrate.js"],
  "ravo-dashboard": ["scripts/ravo-dashboard.js", "scripts/ravo-plugin-resolver.js"],
  "ravo-knowledge": ["scripts/retrieve-knowledge.js", "scripts/write-knowledge-artifact.js"],
  "ravo-quick-validation": ["scripts/check-smoke-artifact.js", "scripts/write-smoke-artifact.js"],
  "ravo-review": ["scripts/run-review.js", "scripts/check-review-disposition.js"],
  "ravo-safety": ["scripts/ravo-safety.js"],
  "ravo-workstream": ["scripts/ravo-execution-gate.js", "scripts/write-workstream-artifact.js"]
};

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: "" };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

function skillMetadata(file) {
  try {
    const source = fs.readFileSync(file, "utf8");
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatter) return { name: "", description: "", error: "frontmatter_missing" };
    return {
      name: frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || "",
      description: frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || "",
      error: ""
    };
  } catch (error) {
    return { name: "", description: "", error: error.message };
  }
}

function inspectPluginRoot(root) {
  const pluginRoot = path.resolve(root);
  const blocking = [];
  const manifestFile = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifestResult = readJson(manifestFile);
  const manifest = manifestResult.value;
  if (!manifest || manifest.name !== "ravo" || manifest.version !== PRODUCT_VERSION
    || manifest.skills !== "./skills/" || manifest.hooks !== "./hooks/hooks.json") {
    blocking.push({ area: "manifest", reason: manifestResult.error || "public_manifest_contract_mismatch" });
  }

  const hooksFile = path.join(pluginRoot, "hooks", "hooks.json");
  const hooksResult = readJson(hooksFile);
  const hookEvents = Object.keys(hooksResult.value?.hooks || {}).sort();
  if (JSON.stringify(hookEvents) !== JSON.stringify(["Stop"])) {
    blocking.push({ area: "hooks", reason: hooksResult.error || "hook_event_contract_mismatch", observed: hookEvents });
  }

  const skills = SKILLS.map((name) => {
    const file = path.join(pluginRoot, "skills", name, "SKILL.md");
    const metadata = skillMetadata(file);
    const healthy = metadata.name === name && metadata.description.length >= 20;
    if (!healthy) blocking.push({ area: "skill", name, reason: metadata.error || "skill_metadata_invalid" });
    return { name, status: healthy ? "healthy" : "blocked", file: path.relative(pluginRoot, file) };
  });

  const modules = Object.entries(MODULE_ENTRIES).map(([name, entries]) => {
    const moduleRoot = path.join(pluginRoot, "modules", name);
    const moduleManifest = readJson(path.join(moduleRoot, ".codex-plugin", "plugin.json"));
    const missing = entries.filter((entry) => !fs.existsSync(path.join(moduleRoot, entry)));
    if (!moduleManifest.value || moduleManifest.value.version !== PRODUCT_VERSION) missing.unshift(".codex-plugin/plugin.json@0.6.2");
    return { name, status: missing.length ? "degraded" : "healthy", missing };
  });

  return {
    status: blocking.length ? "blocked" : modules.some((entry) => entry.status === "degraded") ? "degraded" : "healthy",
    productVersion: PRODUCT_VERSION,
    pluginRoot,
    manifest: { status: manifest && !blocking.some((entry) => entry.area === "manifest") ? "healthy" : "blocked", file: path.relative(pluginRoot, manifestFile) },
    hooks: { status: hooksResult.value && !blocking.some((entry) => entry.area === "hooks") ? "healthy" : "blocked", events: hookEvents, file: path.relative(pluginRoot, hooksFile) },
    skills,
    modules,
    blocking
  };
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  if (process.argv.includes("--version")) {
    console.log(PRODUCT_VERSION);
    return;
  }
  const defaultRoot = path.resolve(__dirname, "..", "..", "..");
  const result = inspectPluginRoot(argValue("--plugin-root", defaultRoot));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 2;
  else if (result.status === "degraded") process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { MODULE_ENTRIES, PRODUCT_VERSION, SKILLS, inspectPluginRoot, skillMetadata };
