#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const modules = ["ravo-core", "ravo-analysis", "ravo-workstream", "ravo-quick-validation", "ravo-acceptance", "ravo-knowledge", "ravo-review", "ravo-dashboard", "ravo-safety"];
const version = "0.6.3";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertFile(file) {
  assert.ok(fs.existsSync(path.join(repo, file)), `missing ${file}`);
}

function parseFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, `${file} missing frontmatter`);
  const yaml = match[1].trim();
  const fields = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  assert.ok(fields.name, `${file} missing skill name`);
  assert.ok(fields.description, `${file} missing skill description`);
  assert.ok(!text.includes("node plugins/ravo-"), `${file} uses repo-relative plugin command`);
}

const marketplace = readJson(path.join(repo, ".agents/plugins/marketplace.json"));
const packageManifest = readJson(path.join(repo, "package.json"));
assert.equal(packageManifest.name, "ravo-codex-plugin");
assert.equal(packageManifest.version, version);
assert.equal(packageManifest.private, true);
assert.equal(packageManifest.scripts?.test, "node scripts/run-tracked-suite.js");
assert.equal(marketplace.name, "ravo");
assert.deepEqual(marketplace.plugins.map((entry) => entry.name), ["ravo"]);
const publicManifest = readJson(path.join(repo, "plugins", "ravo", ".codex-plugin", "plugin.json"));
assert.equal(publicManifest.name, "ravo");
assert.equal(publicManifest.version, version);
assert.equal(publicManifest.skills, "./skills/");
assert.equal(publicManifest.hooks, "./hooks/hooks.json");
assert.ok(publicManifest.interface?.displayName?.startsWith("RAVO"));
for (const moduleName of modules) {
  const manifest = readJson(path.join(repo, "plugins", "ravo", "modules", moduleName, ".codex-plugin", "plugin.json"));
  assert.equal(manifest.name, moduleName);
  assert.equal(manifest.version, version);
  assert.equal(manifest.skills, undefined, `${moduleName} must not expose nested skills`);
  assert.equal(manifest.hooks, undefined, `${moduleName} must not expose nested hooks`);
}
const hookManifest = readJson(path.join(repo, "plugins", "ravo", "hooks", "hooks.json"));
assert.deepEqual(Object.keys(hookManifest.hooks).sort(), ["Stop"]);

for (const file of [
  ".gitattributes",
  "README.md",
  "README_ZH.md",
  "LICENSE",
  "package.json",
  "scripts/run-tracked-suite.js",
  "docs/quick-test-cases.md",
  "docs/quick-test-cases-zh.md",
  "docs/runtime-flow-tests.md",
  "docs/runtime-flow-tests-zh.md",
  "docs/ravo-v0.2-decision-complete-spec.md",
  "docs/ravo-v0.3.1-e2e-results-zh.md",
  "schemas/manifest.schema.json",
  "schemas/analysis-artifact.schema.json",
  "schemas/workstream-artifact.schema.json",
  "schemas/smoke-artifact.schema.json",
  "schemas/acceptance-artifact.schema.json",
  "schemas/knowledge-artifact.schema.json",
  "schemas/review-artifact.schema.json",
  "schemas/ravo-work-item.schema.json",
  "schemas/ravo-knowledge-record.schema.json",
  "templates/agents-snippet.md",
  "templates/ravo-config.example.json",
  "templates/ravo-review-config.example.json",
  "docs/ravo-v0.3-decision-complete-spec.md",
  "plugins/ravo/modules/ravo-core/scripts/ravo-status.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-preflight.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-migrate.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-legacy-restore.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-goal-prompt.js",
  "plugins/ravo-core/scripts/ravo-goal-prompt.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-git-baseline.js",
  "plugins/ravo/modules/ravo-core/scripts/ravo-record-store.js",
  "plugins/ravo/modules/ravo-core/scripts/capture-pool-item.js",
  "plugins/ravo/modules/ravo-analysis/scripts/write-decision-spec.js",
  "plugins/ravo/modules/ravo-analysis/scripts/ravo-governance-route.js",
  "plugins/ravo/hooks/hooks.json",
  "plugins/ravo/modules/ravo-acceptance/hooks/ravo-acceptance-stop.js",
  "plugins/ravo/modules/ravo-acceptance/scripts/acceptance-model.js",
  "plugins/ravo/modules/ravo-acceptance/scripts/prepare-acceptance-baseline.js",
  "plugins/ravo/modules/ravo-knowledge/scripts/capture-knowledge.js",
  "plugins/ravo/modules/ravo-review/scripts/write-review-artifact.js",
  "plugins/ravo/modules/ravo-review/scripts/run-review.js",
  "plugins/ravo/modules/ravo-review/scripts/review-config.js",
  "plugins/ravo/modules/ravo-review/scripts/review-config-cli.js",
  "plugins/ravo/modules/ravo-review/scripts/review-response.js",
  "plugins/ravo/modules/ravo-review/scripts/review-trigger-gate.js",
  "plugins/ravo/modules/ravo-review/scripts/review-disposition.js",
  "plugins/ravo/modules/ravo-review/scripts/record-review-disposition.js",
  "plugins/ravo/modules/ravo-review/scripts/check-review-disposition.js",
  "plugins/ravo/modules/ravo-review/scripts/review-boundary.js",
  "plugins/ravo/modules/ravo-review/scripts/migrate-review-artifact.js",
  "plugins/ravo/modules/ravo-dashboard/config/ravo-config-contract.json",
  "plugins/ravo/modules/ravo-dashboard/app/index.html",
  "plugins/ravo/modules/ravo-dashboard/app/styles.css",
  "plugins/ravo/modules/ravo-dashboard/app/app.js",
  "plugins/ravo/modules/ravo-dashboard/app/assets/lucide.js",
  "plugins/ravo/modules/ravo-dashboard/app/assets/lucide-license.txt",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-config.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-data.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-runtime-delivery.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-fresh-session-e2e.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-upgrade.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-freshness.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-lineage.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-plugin-resolver.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-shortcuts.js",
  "plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool.js",
  "plugins/ravo/modules/ravo-workstream/scripts/workstream-model.js",
  "plugins/ravo/modules/ravo-workstream/scripts/ravo-execution-gate.js",
  "scripts/dashboard-config-test.js",
  "scripts/dashboard-data-test.js",
  "scripts/dashboard-api-test.js",
  "scripts/dashboard-ui-test.js",
  "scripts/dashboard-shortcut-test.js",
  "scripts/dashboard-upgrade-test.js",
  "scripts/dashboard-freshness-test.js",
  "scripts/dashboard-lineage-test.js",
  "scripts/ravo-pool-test.js",
  "scripts/ravo-governance-route-test.js",
  "scripts/ravo-pool-api-test.js",
  "scripts/ravo-pool-ui-test.js",
  "scripts/solodesk-controller-test.js",
  "scripts/solodesk-service-test.js",
  "scripts/config-integrity-test.js",
  "scripts/config-integrity-real-e2e.js",
  "scripts/workstream-governance-test.js",
  "scripts/acceptance-scope-test.js",
  "scripts/fixtures/ravo-v0.5.0-lineage-history.json",
  "scripts/fixtures/ravo-v0.5.1-execution-governance.json",
  "scripts/fixtures/review-v0.5.1-telemetry.js",
  "scripts/ravo-status-test.js",
  "scripts/runtime-probe-test.js",
  "scripts/plugin-resolver-test.js",
  "scripts/review-config-test.js",
  "scripts/review-config-migration-e2e.js",
  "scripts/review-resilience-e2e.js",
  "scripts/review-response-test.js",
  "scripts/review-trigger-gate-test.js",
  "scripts/review-disposition-test.js",
  "scripts/review-boundary-test.js",
  "scripts/review-runtime-test.js",
  "scripts/review-migration-test.js",
  "scripts/review-http-fixture.js",
  "scripts/version-alignment-test.js",
  "scripts/ravo-v0.6-architecture-test.js",
  "scripts/ravo-v0.6-hook-test.js",
  "scripts/ravo-v0.6-migration-test.js",
  "scripts/prompt-regression.js"
]) {
  assertFile(file);
}

const acceptanceSchema = readJson(path.join(repo, "schemas/acceptance-artifact.schema.json"));
const acceptanceItemSchema = acceptanceSchema.$defs?.acceptanceItem;
const verificationTaskSchema = acceptanceSchema.$defs?.verificationTask;
for (const field of ["fulfillmentStatus", "verificationStatus", "verificationOwner", "verificationTasks", "blockingReason", "blockerImpact", "temporaryFallback", "recoveryEntry"]) {
  assert.ok(acceptanceItemSchema?.required?.includes(field), `acceptance item schema missing required ${field}`);
}
assert.ok(acceptanceItemSchema?.properties?.dependencyImpact, "acceptance item schema missing dependencyImpact");
assert.ok(acceptanceSchema.properties?.acceptanceScope, "acceptance schema missing acceptanceScope");
assert.ok(acceptanceSchema.properties?.baselineRef, "acceptance schema missing baselineRef");

const workstreamSchema = readJson(path.join(repo, "schemas/workstream-artifact.schema.json"));
for (const field of ["blockerLedger", "executionLanes", "executionDecisions", "authorizationEnvelopes"]) {
  assert.ok(workstreamSchema.properties?.[field], `workstream schema missing ${field}`);
}

const reviewSchema = readJson(path.join(repo, "schemas/review-artifact.schema.json"));
for (const field of ["timeoutType", "phaseTiming", "partialResponseRef", "partialBytes", "requestedTimeoutProfile", "effectiveTimeoutProfile", "remainingAttemptBudget", "attemptBudget", "retryParameterDelta", "jitterPolicy", "jitterRangeMs"]) {
  assert.ok(reviewSchema.$defs?.attempt051?.allOf?.[1]?.required?.includes(field), `review v0.5.1 attempt schema missing required ${field}`);
}
for (const field of ["requestedPairs", "runClass", "formalEvidenceEligible", "formalTimeoutProfile", "requestedTimeoutProfile", "timeoutProfiles", "maxAttempts", "retryPolicy", "maximumRequests", "maximumRunMs"]) {
  assert.ok(reviewSchema.$defs?.callPlan051?.required?.includes(field), `review v0.5.1 callPlan schema missing required ${field}`);
}
for (const field of ["reviewTriggerGate", "findingDispositionVersion"]) {
  assert.ok(reviewSchema.properties?.[field], `review schema missing ${field}`);
}
for (const field of ["accounts", "authorizedCeilings", "planFingerprint", "dependentTaskRefs"]) {
  assert.ok(workstreamSchema.$defs?.authorizationEnvelope?.properties?.[field], `authorization envelope schema missing ${field}`);
}
for (const field of ["preconditions", "steps", "expectedResult", "evidenceRequired", "failureAction"]) {
  assert.ok(verificationTaskSchema?.required?.includes(field), `verification task schema missing required ${field}`);
}

const analysisSchema = readJson(path.join(repo, "schemas/analysis-artifact.schema.json"));
for (const field of ["impactLevel", "reviewRequired", "reviewEvidence", "reviewBlocker"]) {
  assert.ok(analysisSchema.required.includes(field), `analysis schema missing required ${field}`);
}
const acceptanceWriter = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-acceptance/scripts/write-acceptance-artifact.js"), "utf8");
assert.ok(acceptanceWriter.includes('require("./acceptance-model")'), "acceptance writer must use shared acceptance model");
assert.ok(!acceptanceWriter.includes("基本满足"), "acceptance writer must not emit legacy basic-satisfaction judgment");
const acceptanceChecker = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-acceptance/scripts/check-ravo-acceptance.js"), "utf8");
assert.ok(acceptanceChecker.includes('require("./acceptance-model")'), "acceptance checker must use shared acceptance model");
assert.ok(acceptanceChecker.includes("--acceptance-artifact"), "acceptance checker must support explicit artifact selection");
const workstreamWriter = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-workstream/scripts/write-workstream-artifact.js"), "utf8");
assert.ok(workstreamWriter.includes('require("./workstream-model")'), "workstream writer must use the shared execution governance model");
const dashboardFreshness = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-dashboard/scripts/ravo-freshness.js"), "utf8");
assert.ok(!dashboardFreshness.includes('../../ravo-core/'), "dashboard freshness must resolve RAVO Core without a fixed cache/source-relative path");
const dashboardServer = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard.js"), "utf8");
assert.ok(dashboardServer.includes('host: "127.0.0.1"'), "SoloDesk must default to loopback");
assert.ok(dashboardServer.includes('x-ravo-csrf-token'), "SoloDesk mutations must use a CSRF token");
assert.ok(dashboardServer.includes("instanceId") && dashboardServer.includes("pluginFingerprint") && dashboardServer.includes("restartRequired"), "SoloDesk health must expose managed lifecycle identity");
const solodeskController = fs.readFileSync(path.join(repo, "plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk.js"), "utf8");
assert.ok(solodeskController.includes('const LABEL = "com.ravo.solodesk"'), "SoloDesk controller must use the stable user LaunchAgent label");
assert.ok(solodeskController.includes("last_known_verified"), "SoloDesk controller must retain a verified break-glass resolver");
const reviewSkill = fs.readFileSync(path.join(repo, "plugins/ravo/skills/ravo-review/SKILL.md"), "utf8");
assert.ok(reviewSkill.includes("--run-class diagnostic"), "short Review examples must be explicitly diagnostic");
assert.ok(reviewSkill.includes("900000ms") && reviewSkill.includes("120000ms") && reviewSkill.includes("300000ms") && reviewSkill.includes("180000ms"), "Review skill must document the formal timeout profile");
const reviewMigrationE2e = fs.readFileSync(path.join(repo, "scripts/review-config-migration-e2e.js"), "utf8");
assert.ok(reviewMigrationE2e.includes('saveConfig("review"'), "Review config migration E2E must use the config center mutation path");
assert.ok(reviewMigrationE2e.includes("FORMAL_TIMEOUT_PROFILE"), "Review config migration E2E must verify the canonical timeout profile");
assert.ok(reviewMigrationE2e.includes("0o600"), "Review config migration E2E must verify secret file permissions");
const currentRequirementPool = fs.readFileSync(path.join(repo, "docs/ravo-requirement-pool-zh.md"), "utf8");
assert.ok(!currentRequirementPool.includes("Wanted"), "current requirement pool must use SoloDesk terminology, not the retired Wanted definition");
assert.ok(currentRequirementPool.includes("RAVO 向 SoloDesk 输出 Pool、Slice、验证和状态数据"), "current requirement pool must retain the SoloDesk product boundary");

function markdownFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(target, files);
    else if (/\.(md|txt)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

const retiredDeskReferences = markdownFiles(path.join(repo, "docs"))
  .filter((file) => /\bWanted\b/i.test(fs.readFileSync(file, "utf8")))
  .map((file) => path.relative(repo, file));
assert.deepEqual(retiredDeskReferences, [], "product documentation must use SoloDesk terminology consistently");

const skillsDir = path.join(repo, "plugins/ravo/skills");
for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) parseFrontmatter(path.join(skillsDir, entry.name, "SKILL.md"));
}

for (const file of [
  "README.md",
  "README_ZH.md",
  "templates/agents-snippet.md",
  "plugins/ravo/skills/ravo-review/SKILL.md",
  "plugins/ravo/skills/ravo-knowledge/SKILL.md",
  "docs/ravo-v0.2-decision-complete-spec.md",
  "docs/ravo-v0.3-decision-complete-spec.md",
  "docs/ravo-v0.3-candidate-requirements-zh.md",
  "docs/ravo-v0.3.1-completion-patch-spec.md"
]) {
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  assert.ok(!text.includes("model-review-council"), `${file} contains legacy review skill name`);
}

console.log("repo validation passed");
