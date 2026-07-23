#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  SERVICE_VERSION,
  createSoloDesk,
  gracefulShutdown,
  listenWithFallback,
  writeServiceState
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: { Host: `127.0.0.1:${port}`, ...(options.headers || {}) }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (_error) { /* Keep empty. */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    if (options.body) req.end(JSON.stringify(options.body));
    else req.end();
  });
}

(async () => {
  const occupied = http.createServer((_req, res) => res.end("occupied"));
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const occupiedPort = occupied.address().port;
  const fallbackServer = http.createServer((_req, res) => res.end("fallback"));
  const fallbackAddress = await listenWithFallback(fallbackServer, "127.0.0.1", occupiedPort, 2);
  assert.notEqual(fallbackAddress.port, occupiedPort);
  await new Promise((resolve) => fallbackServer.close(resolve));
  await new Promise((resolve) => occupied.close(resolve));

  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-solodesk-service-home-")));
  const runtimeState = path.join(home, ".codex", "ravo", "solodesk", "runtime.json");
  const controlRequest = path.join(home, ".codex", "ravo", "solodesk", "control-request.json");
  const data = {
    discoverWorkspaces: async () => [],
    buildDashboardIndex: async () => ({ workspaces: [], attention: [], metrics: {}, generatedAt: new Date().toISOString(), workspaceById: new Map() })
  };
  const { state, server } = createSoloDesk({
    home,
    cwd: home,
    workspaceRoots: [],
    data,
    coreStatus: { buildStatus: () => ({ runtimeHealth: "healthy" }) },
    runtimeState,
    controlRequest,
    instanceId: "service-instance",
    startupMode: "on_demand",
    serviceVersion: SERVICE_VERSION,
    pluginVersion: SERVICE_VERSION,
    pluginFingerprint: "sha256:service-plugin",
    refreshSeconds: 3600
  });
  await state.refresh("test");
  const address = await listenWithFallback(server, "127.0.0.1", 0, 1);
  state.port = address.port;
  state.lifecycleStatus = "healthy";
  writeServiceState(state);
  const timer = setInterval(() => {}, 3600000);
  timer.unref();

  const health = await request(state.port, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.instanceId, "service-instance");
  assert.equal(health.body.pid, process.pid);
  assert.equal(health.body.serviceVersion, SERVICE_VERSION);
  assert.equal(health.body.pluginVersion, SERVICE_VERSION);
  assert.equal(health.body.pluginFingerprint, "sha256:service-plugin");
  assert.equal(health.body.restartRequired, false);
  assert.equal(health.body.startupMode, "on_demand");
  assert.equal(health.body.mutation.busy, false);
  const runtimeText = fs.readFileSync(runtimeState, "utf8");
  const runtimeArtifact = JSON.parse(runtimeText);
  assert.equal(runtimeArtifact.installedPluginVersion, SERVICE_VERSION);
  assert.equal(runtimeArtifact.installedPluginFingerprint, "sha256:service-plugin");
  assert.equal(fs.statSync(runtimeState).mode & 0o777, 0o600);
  assert.doesNotMatch(runtimeText, /csrf|authorization|apiKey|secret/i);

  state.acceptingMutations = false;
  const draining = await request(state.port, "/api/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RAVO-CSRF-Token": state.csrfToken },
    body: {}
  });
  assert.equal(draining.status, 503);
  assert.equal(draining.body.error.code, "service_draining");
  state.acceptingMutations = true;

  state.reviewRuns.set("review-running", { reviewRunId: "review-running", status: "running" });
  let staleRestartFired = false;
  state.restartScheduledAt = new Date().toISOString();
  state.restartTimer = setTimeout(() => { staleRestartFired = true; }, 60);
  const busyHealth = await request(state.port, "/api/health");
  assert.equal(busyHealth.body.mutation.busy, true);
  assert.deepEqual(busyHealth.body.mutation.reviewRunIds, ["review-running"]);
  setTimeout(() => state.reviewRuns.set("review-running", { reviewRunId: "review-running", status: "completed" }), 30);
  fs.writeFileSync(controlRequest, `${JSON.stringify({ action: "restart", userRequestedStop: false })}\n`, { mode: 0o600 });
  const shutdown = await gracefulShutdown(state, server, timer, { shutdownTimeoutMs: 1000 });
  assert.equal(shutdown.status, "restarting");
  const finalState = JSON.parse(fs.readFileSync(runtimeState, "utf8"));
  assert.equal(finalState.status, "restarting");
  assert.equal(finalState.userRequestedStop, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(staleRestartFired, false, "graceful shutdown cancels a pending detached controller restart");
  assert.equal(state.restartTimer, null);

  const retryRuntime = path.join(home, ".codex", "ravo", "solodesk-retry", "runtime.json");
  const retryControl = path.join(home, ".codex", "ravo", "solodesk-retry", "control-request.json");
  const retryService = createSoloDesk({ home, cwd: home, workspaceRoots: [], data, coreStatus: { buildStatus: () => ({ runtimeHealth: "healthy" }) }, runtimeState: retryRuntime, controlRequest: retryControl, instanceId: "retry-instance", startupMode: "on_demand", serviceVersion: SERVICE_VERSION, pluginVersion: SERVICE_VERSION, pluginFingerprint: "sha256:retry-plugin", refreshSeconds: 3600 });
  await retryService.state.refresh("test");
  const retryAddress = await listenWithFallback(retryService.server, "127.0.0.1", 0, 1);
  retryService.state.port = retryAddress.port;
  retryService.state.lifecycleStatus = "healthy";
  writeServiceState(retryService.state);
  const retryTimer = setInterval(() => {}, 3600000);
  retryTimer.unref();
  retryService.state.reviewRuns.set("busy-review", { reviewRunId: "busy-review", status: "running" });
  await assert.rejects(gracefulShutdown(retryService.state, retryService.server, retryTimer, { shutdownTimeoutMs: 10 }), (error) => error.code === "shutdown_busy_timeout");
  assert.equal(retryService.state.acceptingMutations, true);
  assert.equal(retryService.state.lifecycleStatus, "degraded");
  retryService.state.reviewRuns.set("busy-review", { reviewRunId: "busy-review", status: "completed" });
  fs.writeFileSync(retryControl, `${JSON.stringify({ action: "stop", userRequestedStop: true })}\n`, { mode: 0o600 });
  const retriedShutdown = await gracefulShutdown(retryService.state, retryService.server, retryTimer, { shutdownTimeoutMs: 1000 });
  assert.equal(retriedShutdown.status, "stopped");

  console.log(JSON.stringify({
    status: "pass",
    checks: [
      "health-instance-version-fingerprint",
      "unknown-process-port-fallback",
      "runtime-private-and-secret-free",
      "draining-rejects-new-mutations",
      "active-review-reported-busy",
      "pending-controller-restart-cancelled-on-shutdown",
      "graceful-drain-and-restart-state",
      "busy-shutdown-can-retry"
    ]
  }, null, 2));
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
