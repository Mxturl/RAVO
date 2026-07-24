#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolvePluginRoot, resolvePluginScript } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-plugin-resolver");

const repo = path.resolve(__dirname, "..");
const sourceRoot = resolvePluginRoot("ravo-review", {
  fromDir: path.join(repo, "plugins", "ravo", "modules", "ravo-dashboard", "scripts"),
  execute: () => { throw new Error("source sibling resolution should not call Codex"); }
});
assert.equal(sourceRoot, path.join(repo, "plugins", "ravo", "modules", "ravo-review"));
assert.equal(resolvePluginScript("ravo-review", "scripts/review-config.js", { fromDir: path.join(repo, "plugins", "ravo", "modules", "ravo-dashboard", "scripts") }), path.join(repo, "plugins", "ravo", "modules", "ravo-review", "scripts", "review-config.js"));

function manifest(root, name, version) {
  const file = path.join(root, ".codex-plugin", "plugin.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ name, version }), "utf8");
}

const cache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-plugin-resolver-cache-")));
const dashboardRoot = path.join(cache, "ravo", "ravo", "0.6.3", "modules", "ravo-dashboard");
const reviewRoot = path.join(cache, "ravo", "ravo", "0.6.3", "modules", "ravo-review");
manifest(dashboardRoot, "ravo-dashboard", "0.6.3");
manifest(reviewRoot, "ravo-review", "0.6.3");
fs.mkdirSync(path.join(dashboardRoot, "scripts"), { recursive: true });
fs.mkdirSync(path.join(reviewRoot, "scripts"), { recursive: true });
fs.writeFileSync(path.join(reviewRoot, "scripts", "review-config.js"), "module.exports = {};\n", "utf8");
const cacheResolved = resolvePluginRoot("ravo-review", {
  fromDir: path.join(dashboardRoot, "scripts"),
  execute: () => { throw new Error("aligned cache resolution should not call Codex"); }
});
assert.equal(cacheResolved, reviewRoot, "installed cache resolution uses the current plugin version without a hardcoded version path");

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-plugin-resolver-home-")));
const oldRoot = path.join(home, ".codex", "plugins", "cache", "ravo", "ravo", "0.5.5", "modules", "ravo-review");
const latestRoot = path.join(home, ".codex", "plugins", "cache", "ravo", "ravo", "0.6.3", "modules", "ravo-review");
manifest(oldRoot, "ravo-review", "0.5.5");
manifest(latestRoot, "ravo-review", "0.6.3");
const latest = resolvePluginRoot("ravo-review", {
  fromDir: path.join(home, "no-plugin-root"),
  home,
  execute: () => ({ marketplaces: [], installed: [] })
});
assert.equal(latest, latestRoot, "cache fallback chooses the latest available version");
assert.equal(resolvePluginScript("ravo-review", "../../escape.js", { fromDir: path.join(home, "no-plugin-root"), home, execute: () => ({}) }), "", "script resolution cannot escape the plugin root");

console.log(JSON.stringify({
  status: "pass",
  checks: ["source-sibling", "aligned-cache-version", "latest-cache-fallback", "path-containment"]
}, null, 2));
