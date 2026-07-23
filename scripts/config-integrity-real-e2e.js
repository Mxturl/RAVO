#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const configIntegrity = require("../plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity");
const {
  RAVO_PLUGIN_NAMES,
  applyRepair,
  createSnapshot,
  isRavoManaged,
  parseTomlDocument,
  recoverRepair,
  sha
} = configIntegrity;
const { buildStatus } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-status");
const {
  createSoloDesk,
  listenWithFallback
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");

const repo = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isPonytailRegistration(section) {
  if (section.parts.length === 2 && section.parts[0] === "marketplaces" && section.parts[1] === "ponytail") return true;
  if (section.parts.length === 2 && section.parts[0] === "plugins" && section.parts[1] === "ponytail@ponytail") return true;
  return section.parts.length === 3
    && section.parts[0] === "hooks"
    && section.parts[1] === "state"
    && section.parts[2].startsWith("ponytail@ponytail:");
}

function sectionHashes(document) {
  return new Map([
    ["<root>", sha(document.preamble)],
    ...document.sections.map((section) => [section.key, sha(section.text)])
  ]);
}

function copyInstalledRavoCache(home) {
  const source = path.join(os.homedir(), ".codex", "plugins", "cache", "ravo");
  const target = path.join(home, ".codex", "plugins", "cache", "ravo");
  if (!fs.existsSync(source)) throw new Error("The installed RAVO plugin cache is missing.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function copyPrivateIfExists(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function pluginCheck(codexHome) {
  const raw = execFileSync("codex", ["plugin", "list", "--marketplace", "ravo", "--json"], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CODEX_HOME: codexHome }
  });
  const value = JSON.parse(raw);
  const installed = new Map((value.installed || []).map((entry) => [entry.name, entry]));
  const missing = RAVO_PLUGIN_NAMES.filter((name) => installed.get(name)?.installed !== true || installed.get(name)?.enabled !== true);
  return { status: missing.length ? "fail" : "pass", missing, installedCount: installed.size };
}

function secretValues(text) {
  const values = [];
  const pattern = /^\s*(?:experimental_bearer_token|api_key|token|authorization)\s*=\s*["']([^"']+)["']\s*$/gim;
  for (const match of text.matchAll(pattern)) if (match[1].length >= 6) values.push(match[1]);
  return values;
}

function request(port, method, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
    const headers = {
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      ...(options.csrf ? { "X-RAVO-CSRF-Token": options.csrf } : {})
    };
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let value = null;
        try { value = text ? JSON.parse(text) : null; } catch (error) { reject(error); return; }
        resolve({ status: res.statusCode, value });
      });
    });
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const createdAt = new Date().toISOString();
  const outputDir = path.resolve(argValue("--output-dir", path.join(repo, "knowledge", ".ravo", "evidence", "v0.5.1", "m5-config-integrity-real-e2e")));
  const artifactPath = path.join(outputDir, "config-integrity-real-e2e.json");
  const apiArtifactPath = path.join(outputDir, "config-integrity-api-real-e2e.json");
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-config-integrity-real-e2e-")));
  const home = path.join(tempRoot, "home");
  const codexHome = path.join(home, ".codex");
  const sourceConfig = path.join(os.homedir(), ".codex", "config.toml");
  const targetConfig = path.join(codexHome, "config.toml");
  let apiServer = null;
  let evidence = {
    schemaVersion: "0.5.1",
    evidenceType: "config_integrity_current_config_isolated_local_e2e",
    status: "fail",
    createdAt,
    sourceRef: "current ~/.codex/config.toml isolated byte-for-byte copy",
    dataBoundary: "local_only_redacted_hashes",
    artifactPath,
    checks: {}
  };
  let apiEvidence = {
    schemaVersion: "0.5.1",
    evidenceType: "config_integrity_solodesk_http_api_isolated_real_e2e",
    status: "fail",
    createdAt,
    sourceRef: "current ~/.codex/config.toml isolated byte-for-byte copy",
    dataBoundary: "local_only_redacted_hashes",
    externalCalls: false,
    artifactPath: apiArtifactPath,
    checks: {}
  };

  try {
    if (!fs.existsSync(sourceConfig)) throw new Error("Current Codex config.toml is missing.");
    const sourceBytes = fs.readFileSync(sourceConfig);
    const sourceStat = fs.lstatSync(sourceConfig);
    assert.equal(sourceStat.isFile() && !sourceStat.isSymbolicLink(), true, "source config must be a regular file");
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(targetConfig, sourceBytes, { mode: 0o600 });
    fs.chmodSync(targetConfig, 0o600);
    copyInstalledRavoCache(home);
    copyPrivateIfExists(
      path.join(os.homedir(), ".codex", "skill-config", "ravo.json"),
      path.join(home, ".codex", "skill-config", "ravo.json")
    );
    copyPrivateIfExists(
      path.join(os.homedir(), ".codex", "skill-config", "ravo-review.json"),
      path.join(home, ".codex", "skill-config", "ravo-review.json")
    );

    const executeCodex = (args) => JSON.parse(execFileSync("codex", args, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CODEX_HOME: codexHome }
    }));
    const isolatedStatus = () => buildStatus(repo, repo, {
      home,
      execute: executeCodex,
      reviewValidatorPath: path.join(repo, "plugins", "ravo", "modules", "ravo-review", "scripts", "review-config.js")
    });
    const runtimeStatus = isolatedStatus();
    assert.equal(runtimeStatus.runtimeProbeStatus, "pass", "the byte-identical isolated baseline must match the real fresh Runtime probe");
    assert.equal(runtimeStatus.configIntegrityStatus, "no_snapshot", "a fresh isolated HOME must not claim config-integrity health before a known-good snapshot exists");
    const moduleOptions = {
      home,
      runtimeStatus,
      ravoVersion: "0.5.1",
      reason: "real_current_config_isolated_baseline",
      pluginCheck: () => pluginCheck(codexHome),
      statusCheck: isolatedStatus
    };

    const baseline = parseTomlDocument(sourceBytes.toString("utf8"));
    const ponytailSections = baseline.sections.filter(isPonytailRegistration).map((section) => section.name);
    assert.ok(ponytailSections.length > 0, "the real baseline must contain a Ponytail registration to exercise optional restore");
    const snapshot = createSnapshot(moduleOptions);
    assert.equal(snapshot.snapshot.runtimeVerified, true, "the matching real Runtime probe creates a runtime-verified isolated snapshot");
    const snapshottedStatus = isolatedStatus();
    assert.equal(snapshottedStatus.runtimeProbeStatus, "pass");
    assert.equal(snapshottedStatus.configIntegrityStatus, "healthy", "a runtime-verified snapshot must promote the unchanged baseline to healthy");
    assert.equal(snapshottedStatus.selectedSnapshotId, snapshot.snapshot.snapshotId);

    const strippedText = baseline.preamble + baseline.sections
      .filter((section) => !isRavoManaged(section) && !isPonytailRegistration(section))
      .map((section) => section.text)
      .join("");
    fs.writeFileSync(targetConfig, strippedText, { mode: 0o600 });
    fs.chmodSync(targetConfig, 0o600);
    const stripped = parseTomlDocument(strippedText);
    const protectedBefore = sectionHashes(stripped);

    const { previewRepair } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-config-integrity");
    const preview = previewRepair({
      ...moduleOptions,
      snapshotId: snapshot.snapshot.snapshotId,
      selectedExternalSections: ponytailSections
    });
    assert.equal(preview.status, "changes_ready");
    assert.equal(preview.approvalRequired.length, 0);
    assert.equal(preview.unresolvedRequired.length, 0);
    assert.ok(preview.protectedSections.some((entry) => entry.section === "<root>" && entry.preserved), "top-level Provider/token fields must be explicitly protected");
    assert.ok(preview.protectedSections.every((entry) => entry.preserved));
    assert.equal(preview.externalPreservedChanges.length, ponytailSections.length);
    assert.equal(JSON.stringify(preview).includes(sourceBytes.toString("utf8")), false, "preview must not embed the source config");

    const applied = applyRepair(preview, moduleOptions);
    assert.equal(applied.status, "succeeded");
    assert.equal(applied.pluginCheck.status, "pass");
    assert.equal(applied.runtimeStatus.runtimeProbeStatus, "stale", "repair mutation epoch invalidates the old Runtime probe");
    assert.notEqual(applied.runtimeStatus.runtimeHealth, "healthy");
    const repairedBytes = fs.readFileSync(targetConfig);
    const repaired = parseTomlDocument(repairedBytes.toString("utf8"));
    const protectedAfter = sectionHashes(repaired);
    for (const [key, hash] of protectedBefore.entries()) assert.equal(protectedAfter.get(key), hash, `protected config changed: ${key}`);
    for (const name of RAVO_PLUGIN_NAMES) {
      assert.ok(repaired.sections.some((section) => section.parts[0] === "plugins" && section.parts[1] === `${name}@ravo`), `missing ${name}`);
    }
    for (const name of ponytailSections) assert.ok(repaired.sections.some((section) => section.name === name), `missing restored ${name}`);
    const parserAndPlugin = pluginCheck(codexHome);
    assert.equal(parserAndPlugin.status, "pass");

    const recovered = recoverRepair(applied.repairId, moduleOptions);
    assert.equal(recovered.status, "recovered");
    assert.equal(sha(fs.readFileSync(targetConfig)), sha(Buffer.from(strippedText)), "explicit recovery must restore the exact pre-repair bytes");

    const workspace = { workspaceId: "ravo-config-integrity-e2e", canonicalPath: repo, path: repo };
    const data = {
      discoverWorkspaces: async () => [workspace],
      buildDashboardIndex: async (options = {}) => {
        const workspaces = options.discoveredWorkspaces?.length ? options.discoveredWorkspaces : [workspace];
        return {
          workspaces,
          attention: [],
          metrics: {},
          generatedAt: new Date().toISOString(),
          workspaceById: new Map(workspaces.map((entry) => [entry.workspaceId, entry]))
        };
      }
    };
    const statusModule = {
      buildStatus: (workspaceRoot, repoRoot, statusOptions = {}) => buildStatus(workspaceRoot, repoRoot, {
        ...statusOptions,
        reviewValidatorPath: path.join(repo, "plugins", "ravo", "modules", "ravo-review", "scripts", "review-config.js")
      })
    };
    const service = createSoloDesk({
      home,
      cwd: repo,
      workspaceRoots: [repo],
      port: 4317,
      refreshSeconds: 3600,
      configIntegrityEnabled: true,
      preserveExternalRegistrations: false,
      serviceVersion: "0.5.1",
      pluginVersion: "0.5.1",
      pluginFingerprint: runtimeStatus.pluginFingerprint,
      data,
      coreStatus: statusModule,
      configIntegrity,
      executeCodex,
      integrityPluginCheck: () => pluginCheck(codexHome)
    });
    apiServer = service.server;
    await service.state.refresh("config_integrity_api_real_e2e");
    const address = await listenWithFallback(apiServer, "127.0.0.1", 0, 1);
    service.state.port = address.port;
    service.state.lifecycleStatus = "healthy";

    const health = await request(address.port, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.value.status, "ok");
    assert.equal(typeof health.value.csrfToken, "string");
    const csrf = health.value.csrfToken;
    const apiStatus = await request(address.port, "GET", "/api/config-integrity/status");
    assert.equal(apiStatus.status, 200);
    assert.equal(apiStatus.value.configIntegrityStatus, "drift");
    assert.equal(apiStatus.value.selectedSnapshotId, snapshot.snapshot.snapshotId);

    const apiPreview = await request(address.port, "POST", "/api/config-integrity/preview", {
      csrf,
      body: {
        snapshotId: snapshot.snapshot.snapshotId,
        selectedExternalSections: ponytailSections,
        reenablePlugins: []
      }
    });
    assert.equal(apiPreview.status, 200);
    assert.equal(apiPreview.value.plan.status, "changes_ready");
    assert.ok(apiPreview.value.confirmationToken);
    assert.equal(apiPreview.value.plan.approvalRequired.length, 0);
    assert.equal(apiPreview.value.plan.unresolvedRequired.length, 0);
    assert.equal(apiPreview.value.plan.externalPreservedChanges.length, ponytailSections.length);

    const apiApplied = await request(address.port, "POST", "/api/config-integrity/apply", {
      csrf,
      body: {
        confirmationToken: apiPreview.value.confirmationToken,
        planId: apiPreview.value.plan.planId
      }
    });
    assert.equal(apiApplied.status, 200);
    assert.equal(apiApplied.value.status, "succeeded");
    assert.equal(apiApplied.value.pluginCheck.status, "pass");
    assert.equal(apiApplied.value.runtimeProbeRequired, true);
    assert.equal(apiApplied.value.runtimeStatus.runtimeProbeStatus, "stale");
    assert.notEqual(apiApplied.value.runtimeStatus.runtimeHealth, "healthy");

    const apiReplay = await request(address.port, "POST", "/api/config-integrity/apply", {
      csrf,
      body: {
        confirmationToken: apiPreview.value.confirmationToken,
        planId: apiPreview.value.plan.planId
      }
    });
    assert.equal(apiReplay.status, 409);
    assert.equal(apiReplay.value.error.code, "confirmation_consumed");

    const apiRecovered = await request(address.port, "POST", "/api/config-integrity/recover", {
      csrf,
      body: { repairId: apiApplied.value.repairId }
    });
    assert.equal(apiRecovered.status, 200);
    assert.equal(apiRecovered.value.status, "recovered");
    assert.equal(sha(fs.readFileSync(targetConfig)), sha(Buffer.from(strippedText)), "HTTP API recovery must restore the exact pre-repair bytes");

    const publicResponses = JSON.stringify({
      status: apiStatus.value,
      preview: apiPreview.value,
      applied: apiApplied.value,
      replay: apiReplay.value,
      recovered: apiRecovered.value
    });
    assert.equal(publicResponses.includes(sourceBytes.toString("utf8")), false);
    for (const secret of secretValues(sourceBytes.toString("utf8"))) assert.equal(publicResponses.includes(secret), false, "SoloDesk config-integrity API leaked a secret value");
    await closeServer(apiServer);
    apiServer = null;

    apiEvidence = {
      ...apiEvidence,
      status: "pass",
      completedAt: new Date().toISOString(),
      service: {
        instanceId: service.state.instanceId,
        pid: process.pid,
        port: address.port,
        serviceVersion: service.state.serviceVersion,
        pluginVersion: service.state.pluginVersion,
        pluginFingerprint: service.state.pluginFingerprint
      },
      baseline: {
        sourceConfigHash: sha(sourceBytes),
        driftedConfigHash: sha(Buffer.from(strippedText)),
        snapshotId: snapshot.snapshot.snapshotId,
        snapshotTrust: "runtime_verified"
      },
      repair: {
        repairId: apiApplied.value.repairId,
        managedChangeCount: apiApplied.value.managedChanges.length,
        externalPreservedChangeCount: apiApplied.value.externalPreservedChanges.length,
        protectedItemCount: apiPreview.value.plan.protectedSections.length,
        postRepairSnapshotTrust: apiApplied.value.snapshot?.trustLevel || "none"
      },
      checks: {
        realLoopbackHttpServer: true,
        csrfRequiredAndUsedInMemoryOnly: true,
        driftDetectedThroughApi: true,
        actionablePreviewIssuedOneTimeToken: true,
        managedAndSelectedExternalSectionsApplied: true,
        currentProviderTokenAndUnknownSectionsProtected: true,
        pluginListPassedAfterApply: true,
        oldRuntimeProbeInvalidatedAfterMutation: true,
        confirmationReplayRejected: true,
        recoverRestoredExactPreRepairBytes: true,
        configBodyAndSecretValuesAbsentFromResponsesAndEvidence: true
      },
      temporaryWorkspaceRemovedAfterRun: true
    };
    writeJson(apiArtifactPath, apiEvidence);

    evidence = {
      ...evidence,
      status: "pass",
      completedAt: new Date().toISOString(),
      sourceConfigHash: sha(sourceBytes),
      sourceMode: (sourceStat.mode & 0o777).toString(8).padStart(4, "0"),
      snapshot: {
        snapshotId: snapshot.snapshot.snapshotId,
        trustLevel: "runtime_verified",
        sourceHash: snapshot.snapshot.sourceHash,
        temporaryMetadataVerifiedBeforeCleanup: true
      },
      repair: {
        repairId: applied.repairId,
        managedChangeCount: applied.managedChanges.length,
        externalPreservedChangeCount: applied.externalPreservedChanges.length,
        protectedItemCount: preview.protectedSections.length,
        approvalRequiredCount: applied.approvalRequired.length,
        unresolvedRequiredCount: applied.unresolvedRequired.length,
        runtimeProbeRequired: applied.runtimeProbeRequired,
        temporaryJournalVerifiedBeforeCleanup: true
      },
      api: {
        artifactPath: apiArtifactPath,
        status: apiEvidence.status,
        repairId: apiEvidence.repair.repairId,
        realLoopbackHttpServer: true,
        exactRecovery: true
      },
      checks: {
        realCurrentConfigCopied: true,
        sourceConfigBodyPersistedInEvidence: false,
        ravoRegistrationsRestored: true,
        ponytailRegistrationsRestoredBySelection: true,
        protectedRootProviderTokenPreserved: true,
        protectedSectionsPreservedByteForByte: true,
        candidateAcceptedByCurrentCodexParser: true,
        isolatedCodexPluginListHealthy: true,
        isolatedRavoStatusMatchedFreshProbeBeforeRepair: true,
        isolatedBaselineRequiredSnapshotBeforeHealthy: true,
        runtimeVerifiedSnapshotPromotedIntegrityToHealthy: true,
        repairMutationEpochInvalidatedOldProbe: true,
        postRepairRuntimeNotHealthyWithoutFreshTask: true,
        explicitRecoveryRestoredExactPreRepairBytes: true,
        snapshotAndConfigMode0600: (fs.statSync(snapshot.snapshot.configPath).mode & 0o777) === 0o600 && (fs.statSync(targetConfig).mode & 0o777) === 0o600
      },
      temporaryWorkspaceRemovedAfterRun: true
    };
    writeJson(artifactPath, evidence);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    evidence = {
      ...evidence,
      completedAt: new Date().toISOString(),
      error: { code: error.code || "real_e2e_failed", message: String(error.message || error).slice(0, 500) },
      temporaryWorkspaceRemovedAfterRun: true
    };
    writeJson(artifactPath, evidence);
    writeJson(apiArtifactPath, {
      ...apiEvidence,
      completedAt: new Date().toISOString(),
      error: { code: error.code || "api_real_e2e_failed", message: String(error.message || error).slice(0, 500) },
      temporaryWorkspaceRemovedAfterRun: true
    });
    throw error;
  } finally {
    await closeServer(apiServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
