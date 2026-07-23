#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function compareVersions(left, right) {
  const a = String(left).split(/[.-]/);
  const b = String(right).split(/[.-]/);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const leftPart = a[index] ?? "0";
    const rightPart = b[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
    const compared = leftPart.localeCompare(rightPart);
    if (compared) return compared;
  }
  return 0;
}

function pluginRootFrom(start) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(current, ".codex-plugin", "plugin.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function validPluginRoot(root, pluginName) {
  if (!root) return false;
  const manifest = readJson(path.join(root, ".codex-plugin", "plugin.json"));
  return manifest?.name === pluginName;
}

function cacheCandidates(home, pluginName, preferredVersion = "") {
  const base = path.join(home, ".codex", "plugins", "cache", "ravo", "ravo");
  let versions = [];
  try { versions = fs.readdirSync(base).sort((left, right) => compareVersions(right, left)); } catch (_error) { return []; }
  if (preferredVersion && versions.includes(preferredVersion)) versions = [preferredVersion, ...versions.filter((version) => version !== preferredVersion)];
  return versions.map((version) => path.join(base, version, "modules", pluginName));
}

function codexCandidates(pluginName, options = {}) {
  const execute = options.execute || ((args) => JSON.parse(execFileSync(options.codexPath || "codex", args, {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024
  })));
  const candidates = [];
  try {
    const marketplaces = execute(["plugin", "marketplace", "list", "--json"]);
    const ravo = marketplaces?.marketplaces?.find((entry) => entry?.name === "ravo");
    const root = ravo?.root || ravo?.marketplaceSource?.source;
    if (root) candidates.push(path.join(root, "plugins", "ravo", "modules", pluginName));
  } catch (_error) { /* Cache and sibling resolution remain available. */ }
  try {
    const plugins = execute(["plugin", "list", "--marketplace", "ravo", "--json"]);
    const entry = plugins?.installed?.find((plugin) => plugin?.name === "ravo" || plugin?.pluginId === "ravo@ravo");
    if (entry?.source?.path) candidates.push(path.join(entry.source.path, "modules", pluginName));
  } catch (_error) { /* Cache and sibling resolution remain available. */ }
  return candidates;
}

function resolvePluginRoot(pluginName, options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const currentRoot = pluginRootFrom(options.fromDir || __dirname);
  const currentManifest = currentRoot ? readJson(path.join(currentRoot, ".codex-plugin", "plugin.json")) : null;
  const preferredVersion = currentManifest?.version || "";
  const localCandidates = [
    options.explicitRoot,
    options.envRoot,
    currentManifest?.name === pluginName ? currentRoot : "",
    currentRoot ? path.join(path.dirname(currentRoot), pluginName) : "",
    ...(currentRoot ? [path.join(path.resolve(currentRoot, "..", ".."), pluginName, preferredVersion)] : [])
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  const local = [...new Set(localCandidates)].find((candidate) => validPluginRoot(candidate, pluginName));
  if (local) return local;
  const fallbackCandidates = [
    ...codexCandidates(pluginName, options),
    ...cacheCandidates(home, pluginName, preferredVersion)
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return [...new Set(fallbackCandidates)].find((candidate) => validPluginRoot(candidate, pluginName)) || "";
}

function resolvePluginScript(pluginName, relativeScript, options = {}) {
  const root = resolvePluginRoot(pluginName, options);
  if (!root) return "";
  const script = path.resolve(root, relativeScript);
  return script.startsWith(`${root}${path.sep}`) && fs.existsSync(script) ? script : "";
}

module.exports = { pluginRootFrom, resolvePluginRoot, resolvePluginScript };
