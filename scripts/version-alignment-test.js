#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const productVersion = "0.6.2";
const modules = [
  "ravo-core",
  "ravo-analysis",
  "ravo-workstream",
  "ravo-quick-validation",
  "ravo-acceptance",
  "ravo-knowledge",
  "ravo-review",
  "ravo-dashboard",
  "ravo-safety"
];

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(repo, relative), "utf8"));
}

function cliVersion(relative) {
  return execFileSync(process.execPath, [path.join(repo, relative), "--version"], {
    cwd: repo,
    encoding: "utf8"
  }).trim();
}

assert.equal(readJson("plugins/ravo/.codex-plugin/plugin.json").version, productVersion);
assert.equal(readJson("package.json").version, productVersion, "release metadata must use the current product version");
for (const moduleName of modules) {
  const manifest = readJson(`plugins/ravo/modules/${moduleName}/.codex-plugin/plugin.json`);
  assert.equal(manifest.version, productVersion, `${moduleName} manifest must use the current product version`);
}

const productCliScripts = [
  "plugins/ravo/modules/ravo-core/scripts/ravo-status.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-preflight.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity.js",
  "plugins/ravo/modules/ravo-analysis/scripts/write-analysis-artifact.js",
  "plugins/ravo/modules/ravo-quick-validation/scripts/write-smoke-artifact.js",
  "plugins/ravo/modules/ravo-acceptance/scripts/write-acceptance-artifact.js",
  "plugins/ravo/modules/ravo-acceptance/scripts/check-ravo-acceptance.js",
  "plugins/ravo/modules/ravo-acceptance/scripts/prepare-acceptance-baseline.js",
  "plugins/ravo/modules/ravo-review/scripts/run-review.js",
  "plugins/ravo/modules/ravo-review/scripts/review-config-cli.js",
  "plugins/ravo/modules/ravo-review/scripts/write-review-artifact.js",
  "plugins/ravo/modules/ravo-review/scripts/migrate-review-artifact.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-config.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-freshness.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-runtime-delivery.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-fresh-session-e2e.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-git-baseline.js"
];

for (const script of productCliScripts) {
  assert.equal(cliVersion(script), productVersion, `${script} must report the current product version`);
}

const reviewConfigTemplate = readJson("templates/ravo-review-config.example.json");
assert.equal(reviewConfigTemplate.schemaVersion, "0.5.0", "unchanged config schema compatibility must not be relabeled as product version 0.6.2");

const history = readJson("scripts/fixtures/ravo-v0.5.0-lineage-history.json");
assert.equal(history.targetSpecRef, "docs/ravo-v0.5.0-decision-complete-spec-zh.md", "the frozen v0.5.0 lineage fixture must remain historical");

const analysisWriter = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-analysis/scripts/write-analysis-artifact.js"), "utf8");
assert.match(analysisWriter, /const SCHEMA_VERSION = "0\.5\.0";/, "analysis artifact schema compatibility must remain explicit");
assert.match(analysisWriter, /const PRODUCT_VERSION = "0\.6\.2";/, "analysis CLI product version must be separate from artifact schema version");

const upgradeRunner = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade.js"), "utf8");
assert.match(upgradeRunner, /const PRODUCT_VERSION = "0\.6\.2";/, "upgrade CLI must expose the current product version");
assert.match(upgradeRunner, /schemaVersion: "0\.5\.0"/, "upgrade journal schema compatibility must remain unchanged until its contract changes");

const dashboardApp = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-dashboard/app/app.js"), "utf8");
assert.match(dashboardApp, />v0\.6\.2</, "SoloDesk must display the current product version");
assert.doesNotMatch(dashboardApp, />v0\.5\.5</, "SoloDesk must not display the legacy product version");

const acceptanceBaseline = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-acceptance/scripts/prepare-acceptance-baseline.js"), "utf8");
assert.match(acceptanceBaseline, /R602-001\.\.006/, "the current acceptance wrapper must default to the v0.6.2 requirement range");

console.log(JSON.stringify({
  status: "pass",
  productVersion,
  publicPluginCount: 1,
  moduleCount: modules.length,
  productCliCount: productCliScripts.length,
  compatibilityMarkers: [
    "review-config-schema:0.5.0",
    "analysis-artifact-schema:0.5.0",
    "upgrade-journal-schema:0.5.0",
    "historical-lineage:v0.5.0"
  ]
}, null, 2));
