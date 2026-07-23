#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SERVICE_VERSION,
  atomicJson,
  crashState,
  install,
  logs,
  open,
  pathsFor,
  plistFor,
  prepareProfile,
  resolvePlugin,
  status,
  stop,
  uninstall
} = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-solodesk");

function write(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode });
}

function fixture(name) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-home-`)));
  const marketplace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-marketplace-`)));
  const pluginRoot = path.join(marketplace, "plugins", "ravo", "modules", "ravo-dashboard");
  write(path.join(pluginRoot, ".codex-plugin", "plugin.json"), `${JSON.stringify({ name: "ravo-dashboard", version: SERVICE_VERSION })}\n`);
  write(path.join(pluginRoot, "scripts", "ravo-dashboard.js"), "console.log('service');\n");
  write(path.join(pluginRoot, "app", "index.html"), "<!doctype html><title>SoloDesk</title>\n");
  write(path.join(pluginRoot, "config", "ravo-config-contract.json"), "{}\n");
  const cachePluginRoot = path.join(home, ".codex", "plugins", "cache", "ravo", "ravo", SERVICE_VERSION, "modules", "ravo-dashboard");
  fs.cpSync(pluginRoot, cachePluginRoot, { recursive: true });
  const launchCalls = [];
  const executeLaunchctl = (args) => { launchCalls.push(args); return { status: "ok" }; };
  const executeCodex = (args) => {
    if (args.join(" ") === "plugin list --marketplace ravo --json") return { installed: [{ pluginId: "ravo@ravo", name: "ravo", enabled: true, version: SERVICE_VERSION, source: { path: path.resolve(pluginRoot, "..", "..") } }] };
    if (args.join(" ") === "plugin marketplace list --json") return { marketplaces: [{ name: "ravo", root: marketplace }] };
    throw new Error(`unexpected codex command: ${args.join(" ")}`);
  };
  return { home, marketplace, pluginRoot, cachePluginRoot, launchCalls, executeLaunchctl, executeCodex };
}

(async () => {
  const base = fixture("ravo-solodesk");
  const files = pathsFor(base.home);
  const source = fs.readFileSync(path.join(__dirname, "..", "plugins", "ravo", "modules", "ravo-dashboard", "scripts", "ravo-solodesk.js"));
  const first = install({ home: base.home, pluginRoot: base.pluginRoot, codexPath: process.execPath, controllerSource: source });
  assert.equal(first.status, "installed");
  assert.equal(first.startupMode, "on_demand");
  assert.equal(fs.statSync(files.controller).mode & 0o777, 0o700);
  assert.equal(fs.statSync(files.launcher).mode & 0o777, 0o700);
  assert.equal(fs.statSync(files.command).mode & 0o777, 0o700);
  assert.equal(fs.statSync(files.plist).mode & 0o777, 0o600);
  assert.equal(fs.statSync(files.stdoutLog).mode & 0o777, 0o600);
  assert.equal(fs.statSync(files.stderrLog).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(files.runtime), false);
  const dormant = fs.readFileSync(files.plist, "utf8");
  assert.match(dormant, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.doesNotMatch(dormant, /<key>KeepAlive<\/key>/);
  assert.doesNotMatch(dormant, /secret|api[_-]?key|authorization/i);

  const second = install({ home: base.home, pluginRoot: base.pluginRoot, codexPath: process.execPath, controllerSource: source });
  assert.equal(second.status, "installed");
  assert.equal(fs.readFileSync(files.controller).compare(source), 0, "idempotent install keeps the current shim source");
  write(files.userConfig, `${JSON.stringify({ schemaVersion: SERVICE_VERSION, dashboard: { startupMode: "login", workspaceRoots: ["/tmp/example"] }, unknown: "keep", token: "preserve-me" }, null, 2)}\n`);
  const beforeConfig = fs.readFileSync(files.userConfig);
  const loginInstall = install({ home: base.home, pluginRoot: base.pluginRoot, codexPath: process.execPath, controllerSource: source });
  assert.equal(loginInstall.startupMode, "login");
  assert.match(fs.readFileSync(files.plist, "utf8"), /<key>KeepAlive<\/key>/);
  assert.match(fs.readFileSync(files.plist, "utf8"), /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.deepEqual(fs.readFileSync(files.userConfig), beforeConfig, "install preserves user configuration byte-for-byte");
  const onDemandInstall = install({ home: base.home, pluginRoot: base.pluginRoot, codexPath: process.execPath, controllerSource: source, startupMode: "on_demand" });
  assert.equal(onDemandInstall.startupMode, "on_demand");
  const changedModeConfig = JSON.parse(fs.readFileSync(files.userConfig, "utf8"));
  assert.equal(changedModeConfig.dashboard.startupMode, "on_demand");
  assert.deepEqual(changedModeConfig.dashboard.workspaceRoots, ["/tmp/example"]);
  assert.equal(changedModeConfig.unknown, "keep");
  assert.equal(changedModeConfig.token, "preserve-me");
  assert.doesNotMatch(fs.readFileSync(files.plist, "utf8"), /<key>KeepAlive<\/key>/);

  const resolved = resolvePlugin({ home: base.home, executeCodex: base.executeCodex });
  assert.equal(resolved.root, fs.realpathSync(base.cachePluginRoot));
  assert.equal(resolved.resolutionSource, "installed_cache");
  atomicJson(files.metadata, {
    schemaVersion: SERVICE_VERSION,
    startupMode: "login",
    codexPath: process.execPath,
    nodePath: process.execPath,
    lastKnownPlugin: { root: resolved.root, version: resolved.version, fingerprint: resolved.fingerprint }
  });
  const fallback = resolvePlugin({ home: base.home, executeCodex: () => { throw new Error("codex unavailable"); } });
  assert.equal(fallback.resolutionSource, "last_known_verified_cache");
  assert.equal(fallback.degraded, true);
  fs.appendFileSync(path.join(base.cachePluginRoot, "app", "index.html"), "changed\n");
  assert.throws(() => resolvePlugin({ home: base.home, executeCodex: () => { throw new Error("codex unavailable"); } }), (error) => error.code === "cache_runtime_blocked");
  fs.writeFileSync(path.join(base.cachePluginRoot, "app", "index.html"), "<!doctype html><title>SoloDesk</title>\n");

  base.launchCalls.length = 0;
  const activeProfile = prepareProfile("on_demand", { home: base.home, executeLaunchctl: base.executeLaunchctl, uid: 501, allowNonDarwin: true });
  assert.equal(activeProfile, files.activePlist);
  assert.match(fs.readFileSync(files.activePlist, "utf8"), /<key>KeepAlive<\/key>/);
  assert.match(fs.readFileSync(files.activePlist, "utf8"), /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.deepEqual(base.launchCalls.map((args) => args[0]), ["bootout", "bootstrap"]);
  assert.match(plistFor(files, "login"), /<key>RunAtLoad<\/key>\s*<true\/>/);

  atomicJson(files.runtime, {
    schemaVersion: SERVICE_VERSION,
    instanceId: "crash-instance",
    pid: 999999,
    status: "healthy",
    startupMode: "on_demand",
    crashHistory: []
  });
  const crash1 = crashState({ home: base.home, processAlive: () => false });
  const crash2 = crashState({ home: base.home, processAlive: () => false });
  const crash3 = crashState({ home: base.home, processAlive: () => false });
  const crash4 = crashState({ home: base.home, processAlive: () => false });
  assert.deepEqual([crash1.delayMs, crash2.delayMs, crash3.delayMs], [1000, 5000, 15000]);
  assert.equal(crash4.blocked, true);
  assert.equal(readJson(files.runtime).status, "failed");

  const currentPlugin = resolvePlugin({ home: base.home, pluginRoot: base.pluginRoot });
  atomicJson(files.runtime, {
    schemaVersion: SERVICE_VERSION,
    instanceId: "healthy-instance",
    pid: 1234,
    host: "127.0.0.1",
    port: 4317,
    url: "http://127.0.0.1:4317/",
    status: "healthy",
    startupMode: "on_demand",
    pluginVersion: currentPlugin.version,
    pluginFingerprint: currentPlugin.fingerprint,
    restartRequired: false
  });
  const health = { status: "ok", instanceId: "healthy-instance", pid: 1234, pluginVersion: currentPlugin.version, pluginFingerprint: currentPlugin.fingerprint, restartRequired: false, mutation: { busy: false }, csrfToken: "must-not-leave-status" };
  const healthy = await status({ home: base.home, pluginRoot: base.pluginRoot, probeHealth: () => health });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.health.csrfToken, undefined);
  const busy = await stop({ home: base.home, pluginRoot: base.pluginRoot, probeHealth: () => ({ ...health, mutation: { busy: true, active: ["POST /api/updates/apply"] } }), executeLaunchctl: base.executeLaunchctl });
  assert.equal(busy.status, "busy");
  assert.match(busy.recoveryEntry, /stop$/);
  await assert.rejects(
    stop({ home: base.home, pluginRoot: base.pluginRoot, probeHealth: () => health, executeLaunchctl: base.executeLaunchctl, processAlive: () => true, stopTimeoutMs: 5, pollMs: 1 }),
    (error) => error.code === "process_stop_timeout"
  );
  const drifted = await status({ home: base.home, pluginRoot: base.pluginRoot, probeHealth: () => ({ ...health, pluginFingerprint: "sha256:old" }) });
  assert.equal(drifted.status, "restart_required");
  assert.equal(drifted.runtime.installedPluginVersion, currentPlugin.version);
  assert.equal(drifted.runtime.installedPluginFingerprint, currentPlugin.fingerprint);
  const versionDrifted = await status({ home: base.home, pluginRoot: base.pluginRoot, probeHealth: () => ({ ...health, pluginVersion: "0.5.0" }) });
  assert.equal(versionDrifted.status, "restart_required");

  atomicJson(files.runtime, {
    ...readJson(files.runtime),
    status: "healthy",
    restartRequired: false,
    pluginVersion: currentPlugin.version,
    pluginFingerprint: currentPlugin.fingerprint
  });
  write(files.controller, "#!/usr/bin/env node\n// stale controller\n", 0o700);
  const reopened = await open({
    home: base.home,
    pluginRoot: base.pluginRoot,
    codexPath: process.execPath,
    controllerSource: source,
    probeHealth: () => health,
    openBrowser: () => {}
  });
  assert.equal(reopened.status, "healthy");
  assert.equal(reopened.reused, true);
  assert.equal(fs.readFileSync(files.controller).compare(source), 0, "open refreshes a stale controller before reusing the service");

  atomicJson(files.runtime, { ...readJson(files.runtime), status: "restart_required", restartRequired: true });
  let restartBrowserCount = 0;
  const restartedFromOpen = await open({
    home: base.home,
    pluginRoot: base.pluginRoot,
    codexPath: process.execPath,
    controllerSource: source,
    executeLaunchctl: (args) => {
      const result = base.executeLaunchctl(args);
      if (args[0] === "bootstrap") atomicJson(files.runtime, { ...readJson(files.runtime), status: "healthy", restartRequired: false });
      return result;
    },
    uid: 501,
    processAlive: () => false,
    probeHealth: () => health,
    openBrowser: () => { restartBrowserCount += 1; }
  });
  assert.equal(restartedFromOpen.status, "healthy");
  assert.equal(restartedFromOpen.restarted, true);
  assert.equal(restartBrowserCount, 1, "restart_required open reopens the browser exactly once after recovery");

  const fakeApiSecret = ["sk", "abcdefghijklmnop"].join("-");
  const fakeSessionToken = ["sess", "abcdefghijklmnop"].join("-");
  write(files.stdoutLog, `ok\nauthorization=Bearer secret-value\napiKey=${fakeApiSecret}\n{\"apiKey\":\"json-secret-value\"}\n`);
  write(files.stderrLog, `token: ${fakeSessionToken}\n`);
  const logView = logs({ home: base.home });
  assert.doesNotMatch(JSON.stringify(logView.summary), new RegExp(`secret-value|json-secret-value|${fakeApiSecret}|${fakeSessionToken}`));
  assert.match(JSON.stringify(logView.summary), /REDACTED/);

  const preserveBackup = path.join(files.base, "backups", "keep.txt");
  write(preserveBackup, "keep\n");
  const uninstallResult = await uninstall({ home: base.home, pluginRoot: base.pluginRoot, executeLaunchctl: base.executeLaunchctl, probeHealth: () => null, processAlive: () => false });
  assert.equal(uninstallResult.status, "uninstalled");
  assert.ok(fs.existsSync(files.userConfig));
  assert.ok(fs.existsSync(preserveBackup));
  assert.equal(fs.existsSync(files.controller), false);
  assert.equal(fs.existsSync(files.plist), false);

  const broken = fixture("ravo-solodesk-rollback");
  const brokenFiles = pathsFor(broken.home);
  write(path.join(broken.home, "Library", "LaunchAgents"), "not-a-directory\n");
  assert.throws(() => install({ home: broken.home, pluginRoot: broken.pluginRoot, codexPath: process.execPath, controllerSource: source }));
  assert.equal(fs.existsSync(brokenFiles.controller), false);
  assert.equal(fs.existsSync(brokenFiles.launcher), false);
  assert.equal(fs.existsSync(brokenFiles.command), false);

  const symlinked = fixture("ravo-solodesk-symlink");
  const symlinkedFiles = pathsFor(symlinked.home);
  write(path.join(symlinked.home, "owned-target"), "keep\n");
  fs.mkdirSync(path.dirname(symlinkedFiles.controller), { recursive: true });
  fs.symlinkSync(path.join(symlinked.home, "owned-target"), symlinkedFiles.controller);
  assert.throws(
    () => install({ home: symlinked.home, pluginRoot: symlinked.pluginRoot, codexPath: process.execPath, controllerSource: source }),
    (error) => error.code === "install_target_unsafe"
  );
  assert.equal(fs.readFileSync(path.join(symlinked.home, "owned-target"), "utf8"), "keep\n");

  const foregroundFixture = fixture("ravo-solodesk-foreground-uninstall");
  const foregroundFiles = pathsFor(foregroundFixture.home);
  install({ home: foregroundFixture.home, pluginRoot: foregroundFixture.pluginRoot, codexPath: process.execPath, controllerSource: source });
  const foregroundPlugin = resolvePlugin({ home: foregroundFixture.home, pluginRoot: foregroundFixture.pluginRoot });
  atomicJson(foregroundFiles.runtime, { schemaVersion: SERVICE_VERSION, instanceId: "foreground-instance", pid: 4321, host: "127.0.0.1", port: 4317, url: "http://127.0.0.1:4317/", status: "healthy", startupMode: "foreground", pluginVersion: foregroundPlugin.version, pluginFingerprint: foregroundPlugin.fingerprint });
  await assert.rejects(
    uninstall({ home: foregroundFixture.home, pluginRoot: foregroundFixture.pluginRoot, probeHealth: () => ({ status: "ok", instanceId: "foreground-instance", pid: 4321, pluginVersion: foregroundPlugin.version, pluginFingerprint: foregroundPlugin.fingerprint, mutation: { busy: false } }) }),
    (error) => error.code === "foreground_instance_running"
  );
  assert.ok(fs.existsSync(foregroundFiles.controller));

  console.log(JSON.stringify({
    status: "pass",
    checks: [
      "idempotent-install-and-config-preservation",
      "private-modes-and-secret-free-plist",
      "install-target-owner-symlink-integrity",
      "dormant-active-login-profiles",
      "codex-resolution-and-verified-break-glass",
      "plugin-fingerprint-drift",
      "crash-backoff-and-loop-limit",
      "health-instance-and-restart-required",
      "open-refreshes-stale-controller",
      "restart-required-open-recovers-once",
      "busy-stop",
      "stop-timeout-does-not-lie",
      "bounded-log-redaction",
      "foreground-uninstall-refused",
      "uninstall-preserves-config-and-backups",
      "partial-install-rollback"
    ]
  }, null, 2));
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
