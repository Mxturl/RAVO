#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");

const SERVICE_VERSION = "0.6.2";
const LABEL = "com.ravo.solodesk";
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const EXECUTABLE_MODE = 0o700;
const STARTUP_MODES = new Set(["on_demand", "login"]);
const ACTIVE_STATUSES = new Set(["starting", "healthy", "degraded", "restart_required", "draining", "restarting"]);
const MANAGED_ROOTS = [".codex-plugin", "app", "config", "scripts"];
const CRASH_DELAYS_MS = [1000, 5000, 15000];

class ControllerError extends Error {
  constructor(code, message, status = 1, details = undefined) {
    super(message);
    this.name = "ControllerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function pathsFor(home = os.homedir()) {
  const resolvedHome = path.resolve(home);
  const base = path.join(resolvedHome, ".codex", "ravo");
  const stateRoot = path.join(base, "solodesk");
  const bin = path.join(base, "bin");
  return {
    home: resolvedHome,
    base,
    bin,
    controller: path.join(bin, "ravo-solodesk.js"),
    launcher: path.join(bin, "ravo-solodesk"),
    command: path.join(base, "SoloDesk.command"),
    stateRoot,
    runtime: path.join(stateRoot, "runtime.json"),
    metadata: path.join(stateRoot, "launcher-metadata.json"),
    controlRequest: path.join(stateRoot, "control-request.json"),
    lock: path.join(stateRoot, "controller.lock"),
    installJournal: path.join(stateRoot, "install-journal.json"),
    installBackups: path.join(stateRoot, "install-backups"),
    activePlist: path.join(stateRoot, `${LABEL}.active.plist`),
    logs: path.join(stateRoot, "logs"),
    stdoutLog: path.join(stateRoot, "logs", "stdout.log"),
    stderrLog: path.join(stateRoot, "logs", "stderr.log"),
    plist: path.join(resolvedHome, "Library", "LaunchAgents", `${LABEL}.plist`),
    userConfig: path.join(resolvedHome, ".codex", "skill-config", "ravo.json")
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function ensureDir(dir, mode = PRIVATE_DIR_MODE) {
  fs.mkdirSync(dir, { recursive: true, mode });
  fs.chmodSync(dir, mode);
}

function ensureLogs(files) {
  ensureDir(files.logs);
  for (const file of [files.stdoutLog, files.stderrLog]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: PRIVATE_FILE_MODE });
    fs.chmodSync(file, PRIVATE_FILE_MODE);
  }
}

function atomicWrite(file, bytes, mode = PRIVATE_FILE_MODE) {
  ensureDir(path.dirname(file));
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
    fs.chmodSync(file, mode);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_error) { /* Best effort. */ }
  }
  return file;
}

function atomicJson(file, value, mode = PRIVATE_FILE_MODE) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`, mode);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function safeMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function executableCandidate(file) {
  if (!file) return "";
  try {
    const resolved = fs.realpathSync(file);
    if (!fs.statSync(resolved).isFile()) return "";
    fs.accessSync(resolved, fs.constants.X_OK);
    return resolved;
  } catch (_error) {
    return "";
  }
}

function locateExecutable(name, options = {}) {
  const explicit = executableCandidate(options[`${name}Path`] || "");
  if (explicit) return explicit;
  const metadata = readJson(pathsFor(options.home).metadata);
  const known = executableCandidate(metadata?.[`${name}Path`] || "");
  if (known) return known;
  for (const dir of String(options.env?.PATH || process.env.PATH || "").split(path.delimiter)) {
    const candidate = executableCandidate(path.join(dir, name));
    if (candidate) return candidate;
  }
  throw new ControllerError(`${name}_executable_missing`, `${name} executable could not be resolved.`);
}

function executeCodex(args, options = {}) {
  if (options.executeCodex) return options.executeCodex(args.slice());
  const codexPath = locateExecutable("codex", options);
  return JSON.parse(execFileSync(codexPath, args, {
    encoding: "utf8",
    timeout: options.commandTimeoutMs || 15000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, HOME: pathsFor(options.home).home, ...(options.env || {}) }
  }));
}

function inside(root, file) {
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function dashboardCacheRoot(home = os.homedir()) {
  return path.join(pathsFor(home).home, ".codex", "plugins", "cache", "ravo", "ravo");
}

function verifiedCacheRoot(home, candidate) {
  const cacheRoot = canonicalPath(dashboardCacheRoot(home));
  const root = canonicalPath(candidate);
  if (!root || !cacheRoot || !inside(cacheRoot, root) || root === cacheRoot) return false;
  const parts = path.relative(cacheRoot, root).split(path.sep);
  return parts.length === 3
    && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(parts[0])
    && parts[1] === "modules"
    && parts[2] === "ravo-dashboard";
}

function canonicalPath(candidate) {
  try { return fs.realpathSync(path.resolve(candidate)); } catch (_error) { return path.resolve(candidate || ""); }
}

function walkManaged(root) {
  const files = [];
  for (const relativeRoot of MANAGED_ROOTS) {
    const start = path.join(root, relativeRoot);
    if (!fs.existsSync(start)) continue;
    const visit = (file, relative) => {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new ControllerError("plugin_symlink_rejected", `Managed plugin path is a symlink: ${relative}`);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), path.join(relative, name));
      } else if (stat.isFile()) files.push({ file, relative: relative.split(path.sep).join("/"), size: stat.size });
    };
    visit(start, relativeRoot);
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function inspectPluginRoot(candidate, options = {}) {
  let root;
  try { root = fs.realpathSync(path.resolve(candidate)); } catch (_error) {
    throw new ControllerError("plugin_root_missing", `Plugin root does not exist: ${candidate}`);
  }
  const manifestFile = path.join(root, ".codex-plugin", "plugin.json");
  const serverFile = path.join(root, "scripts", "ravo-dashboard.js");
  const manifest = readJson(manifestFile);
  if (manifest?.name !== "ravo-dashboard" || !manifest.version) throw new ControllerError("plugin_manifest_invalid", "ravo-dashboard plugin manifest is missing or invalid.");
  if (!fs.existsSync(serverFile) || !fs.statSync(serverFile).isFile()) throw new ControllerError("plugin_server_missing", "ravo-dashboard server entry is missing.");
  const allowedRoots = (options.allowedRoots || []).map((item) => {
    try { return fs.realpathSync(path.resolve(item)); } catch (_error) { return path.resolve(item); }
  });
  if (allowedRoots.length && !allowedRoots.some((allowed) => inside(allowed, root))) {
    throw new ControllerError("plugin_root_untrusted", "Resolved plugin root is outside the verified marketplace/cache roots.");
  }
  const entries = walkManaged(root).map((entry) => ({
    path: entry.relative,
    size: entry.size,
    sha256: sha(fs.readFileSync(entry.file))
  }));
  const fingerprint = sha(Buffer.from(JSON.stringify(stableValue({ version: manifest.version, entries }))));
  return { root, serverFile, installedRoot: root, actualEntrypoint: serverFile, version: manifest.version, fingerprint, entries };
}

function resolvePlugin(options = {}) {
  if (options.pluginRoot) return { ...inspectPluginRoot(options.pluginRoot), resolutionSource: "development_override", degraded: true, developmentOverride: true };
  const home = pathsFor(options.home).home;
  let primaryError = null;
  try {
    const plugins = executeCodex(["plugin", "list", "--marketplace", "ravo", "--json"], options);
    const entry = (plugins?.installed || []).find((item) => item?.pluginId === "ravo@ravo" || item?.name === "ravo");
    if (!entry?.enabled) throw new ControllerError("plugin_disabled", "ravo@ravo is not enabled.");
    const marketplaces = executeCodex(["plugin", "marketplace", "list", "--json"], options);
    const marketplace = (marketplaces?.marketplaces || []).find((item) => item?.name === "ravo");
    const marketplaceRoot = marketplace?.root || marketplace?.marketplaceSource?.source || "";
    const cacheRoot = dashboardCacheRoot(home);
    const sourcePath = entry?.version ? path.join(cacheRoot, entry.version, "modules", "ravo-dashboard") : "";
    if (!sourcePath || !verifiedCacheRoot(home, sourcePath)) throw new ControllerError("cache_plugin_missing", "Managed SoloDesk requires an installed versioned Dashboard cache; marketplace/development source is not a runtime entrypoint.");
    const plugin = inspectPluginRoot(sourcePath, { allowedRoots: [cacheRoot] });
    if (entry?.version && plugin.version !== entry.version) throw new ControllerError("cache_plugin_version_mismatch", "Installed Dashboard cache version does not match the Codex installed record.");
    return { ...plugin, resolutionSource: "installed_cache", degraded: false, developmentOverride: false };
  } catch (error) {
    primaryError = error;
  }
  const metadata = readJson(pathsFor(home).metadata);
  const lastKnown = metadata?.lastKnownPlugin;
  if (lastKnown?.root && lastKnown?.fingerprint && verifiedCacheRoot(home, lastKnown.root)) {
    const plugin = inspectPluginRoot(lastKnown.root, { allowedRoots: [dashboardCacheRoot(home)] });
    if (plugin.fingerprint === lastKnown.fingerprint && plugin.version === lastKnown.version) {
      return { ...plugin, resolutionSource: "last_known_verified_cache", degraded: true, resolverWarning: safeMessage(primaryError), developmentOverride: false };
    }
  }
  throw new ControllerError("cache_runtime_blocked", `Managed SoloDesk could not resolve a verified installed cache and will not execute development or marketplace source: ${safeMessage(primaryError)}`);
}

function startupMode(options = {}) {
  if (STARTUP_MODES.has(options.startupMode)) return options.startupMode;
  const files = pathsFor(options.home);
  const config = readJson(files.userConfig);
  if (STARTUP_MODES.has(config?.dashboard?.startupMode)) return config.dashboard.startupMode;
  const metadata = readJson(files.metadata);
  return STARTUP_MODES.has(metadata?.startupMode) ? metadata.startupMode : "on_demand";
}

function persistStartupMode(files, mode) {
  const existing = fs.existsSync(files.userConfig) ? readJson(files.userConfig) : {};
  if (fs.existsSync(files.userConfig) && !existing) throw new ControllerError("user_config_invalid", "RAVO user config is invalid JSON; startupMode was not changed.");
  atomicJson(files.userConfig, {
    ...existing,
    schemaVersion: existing.schemaVersion || SERVICE_VERSION,
    dashboard: { ...(existing.dashboard || {}), startupMode: mode }
  });
}

function plistFor(files, mode, options = {}) {
  const keepAlive = mode === "active" || mode === "login";
  const runAtLoad = mode === "login";
  const args = [files.launcher, "__service"];
  const array = args.map((item) => `      <string>${xmlEscape(item)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${array}
  </array>
  <key>RunAtLoad</key>
  <${runAtLoad ? "true" : "false"}/>
${keepAlive ? "  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ThrottleInterval</key>\n  <integer>1</integer>\n" : ""}  <key>WorkingDirectory</key>
  <string>${xmlEscape(files.home)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(files.stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(files.stderrLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xmlEscape(files.home)}</string>
  </dict>
</dict>
</plist>
`;
}

function writeProfile(files, mode, target = files.plist) {
  atomicWrite(target, plistFor(files, mode), PRIVATE_FILE_MODE);
  return target;
}

function backupTargets(files, targets) {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join(files.installBackups, id);
  const records = [];
  ensureDir(root);
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      records.push({ target, existed: false });
      continue;
    }
    const lstat = fs.lstatSync(target);
    if (lstat.isSymbolicLink() || !lstat.isFile()) throw new ControllerError("install_target_unsafe", `Managed install target must be a regular file: ${target}`);
    if (typeof process.getuid === "function" && lstat.uid !== process.getuid()) throw new ControllerError("install_target_owner_mismatch", `Managed install target is owned by another user: ${target}`);
    const stat = fs.statSync(target);
    const backup = path.join(root, crypto.createHash("sha256").update(target).digest("hex"));
    fs.copyFileSync(target, backup);
    fs.chmodSync(backup, PRIVATE_FILE_MODE);
    if (sha(fs.readFileSync(backup)) !== sha(fs.readFileSync(target))) throw new ControllerError("install_backup_mismatch", `Managed install target backup failed verification: ${target}`);
    records.push({ target, existed: true, backup, mode: stat.mode & 0o777 });
  }
  return { root, records };
}

function restoreTargets(snapshot) {
  for (const record of snapshot.records) {
    if (!record.existed) {
      try { fs.unlinkSync(record.target); } catch (_error) { /* Best effort. */ }
      continue;
    }
    ensureDir(path.dirname(record.target));
    fs.copyFileSync(record.backup, record.target);
    fs.chmodSync(record.target, record.mode);
  }
}

function install(options = {}) {
  const files = pathsFor(options.home);
  if (options.startupMode && !STARTUP_MODES.has(options.startupMode)) throw new ControllerError("startup_mode_invalid", "startupMode must be on_demand or login.");
  const mode = startupMode(options);
  const plugin = resolvePlugin(options);
  const codexPath = options.codexPath ? executableCandidate(options.codexPath) : locateExecutable("codex", options);
  const nodePath = executableCandidate(options.nodePath || process.execPath);
  if (!nodePath) throw new ControllerError("node_executable_missing", "The current Node executable is not reusable by LaunchAgent.");
  ensureDir(files.base);
  ensureDir(files.bin);
  ensureDir(files.stateRoot);
  ensureLogs(files);
  const targets = [files.controller, files.launcher, files.command, files.plist, files.metadata, ...(options.startupMode ? [files.userConfig] : [])];
  const snapshot = backupTargets(files, targets);
  const previous = readJson(files.metadata) || {};
  const journal = {
    schemaVersion: SERVICE_VERSION,
    operation: "install",
    status: "applying",
    startedAt: new Date().toISOString(),
    targets,
    backupRoot: snapshot.root,
    recoveryEntry: "Run ravo-solodesk install again or restore files from backupRoot."
  };
  atomicJson(files.installJournal, journal);
  try {
    const controllerSource = options.controllerSource || fs.readFileSync(__filename);
    atomicWrite(files.controller, controllerSource, EXECUTABLE_MODE);
    atomicWrite(files.launcher, `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(files.controller)} "$@"\n`, EXECUTABLE_MODE);
    atomicWrite(files.command, `#!/bin/sh\nexec ${shellQuote(files.launcher)} open\n`, EXECUTABLE_MODE);
    writeProfile(files, mode === "login" ? "login" : "dormant");
    if (options.startupMode) persistStartupMode(files, mode);
    const metadata = {
      schemaVersion: SERVICE_VERSION,
      controllerVersion: SERVICE_VERSION,
      installedAt: previous.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startupMode: mode,
      codexPath,
      nodePath,
      lastKnownPlugin: {
        root: plugin.root,
        installedRoot: plugin.installedRoot,
        actualEntrypoint: plugin.actualEntrypoint,
        version: plugin.version,
        fingerprint: plugin.fingerprint,
        resolutionSource: plugin.resolutionSource,
        verifiedAt: new Date().toISOString()
      }
    };
    atomicJson(files.metadata, metadata);
    journal.status = "succeeded";
    journal.completedAt = new Date().toISOString();
    journal.startupMode = mode;
    atomicJson(files.installJournal, journal);
    return { status: "installed", startupMode: mode, paths: { launcher: files.launcher, controller: files.controller, command: files.command, plist: files.plist }, plugin: { version: plugin.version, fingerprint: plugin.fingerprint, installedRoot: plugin.installedRoot, actualEntrypoint: plugin.actualEntrypoint, resolutionSource: plugin.resolutionSource }, backupRoot: snapshot.root };
  } catch (error) {
    restoreTargets(snapshot);
    journal.status = "recovered";
    journal.errorCode = error.code || "install_failed";
    journal.message = safeMessage(error);
    journal.completedAt = new Date().toISOString();
    atomicJson(files.installJournal, journal);
    throw error;
  }
}

function controllerIsCurrent(files, options = {}) {
  try {
    const source = options.controllerSource || fs.readFileSync(__filename);
    return fs.existsSync(files.controller) && sha(fs.readFileSync(files.controller)) === sha(source);
  } catch (_error) {
    return false;
  }
}

function launchctl(args, options = {}, tolerateMissing = false) {
  if (options.executeLaunchctl) {
    try { return options.executeLaunchctl(args.slice()); } catch (error) {
      if (tolerateMissing) return { status: "missing", message: safeMessage(error) };
      throw error;
    }
  }
  try {
    return execFileSync("/bin/launchctl", args, { encoding: "utf8", timeout: options.launchctlTimeoutMs || 15000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (tolerateMissing) return { status: "missing", message: safeMessage(error.stderr || error) };
    throw new ControllerError("launchctl_failed", safeMessage(error.stderr || error));
  }
}

function serviceTarget(options = {}) {
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (!Number.isInteger(uid)) throw new ControllerError("uid_unavailable", "A user launchd domain requires a numeric uid.");
  return `gui/${uid}`;
}

function bootout(options = {}) {
  return launchctl(["bootout", `${serviceTarget(options)}/${LABEL}`], options, true);
}

function waitForBootout(options = {}) {
  if (options.executeLaunchctl && options.waitForLaunchctlUnload !== true) return;
  const deadline = Date.now() + (options.bootoutTimeoutMs || 5000);
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    const result = launchctl(["print", `${serviceTarget(options)}/${LABEL}`], options, true);
    if (result?.status === "missing") return;
    Atomics.wait(signal, 0, 0, 50);
  }
  throw new ControllerError("launchctl_unload_timeout", "The previous SoloDesk LaunchAgent did not unload before the timeout.");
}

async function waitForProcessExit(pid, options = {}) {
  const deadline = Date.now() + (options.stopTimeoutMs || 10000);
  while (processAlive(pid, options) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, options.pollMs || 100));
  if (processAlive(pid, options)) throw new ControllerError("process_stop_timeout", `SoloDesk process ${pid} did not stop before the timeout.`);
}

function bootstrap(plist, options = {}) {
  return launchctl(["bootstrap", serviceTarget(options), plist], options, false);
}

function processAlive(pid, options = {}) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 1) return false;
  if (options.processAlive) return options.processAlive(Number(pid));
  try { process.kill(Number(pid), 0); return true; } catch (_error) { return false; }
}

function processCommand(pid, options = {}) {
  if (options.processCommand) return options.processCommand(Number(pid));
  try { return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 2000 }).trim(); } catch (_error) { return ""; }
}

function ownedRuntimeProcess(runtime, options = {}) {
  if (!processAlive(runtime?.pid, options)) return false;
  const command = processCommand(runtime.pid, options);
  return Boolean(runtime?.instanceId && command.includes("ravo-dashboard.js") && command.includes(runtime.instanceId));
}

function probeHealth(url, options = {}) {
  if (options.probeHealth) return Promise.resolve(options.probeHealth(url));
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch (_error) { resolve(null); return; }
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) { resolve(null); return; }
    const request = http.get(parsed, { timeout: options.healthTimeoutMs || 1000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(response.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null); } catch (_error) { resolve(null); }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

function publicHealth(health) {
  if (!health || typeof health !== "object") return health;
  const value = { ...health };
  delete value.csrfToken;
  return value;
}

async function status(options = {}) {
  const files = pathsFor(options.home);
  const runtime = readJson(files.runtime);
  const metadata = readJson(files.metadata) || {};
  const installedMetadata = metadata.lastKnownPlugin ? {
    version: metadata.lastKnownPlugin.version || "",
    fingerprint: metadata.lastKnownPlugin.fingerprint || "",
    installedRoot: metadata.lastKnownPlugin.installedRoot || metadata.lastKnownPlugin.root || "",
    actualEntrypoint: metadata.lastKnownPlugin.actualEntrypoint || "",
    resolutionSource: metadata.lastKnownPlugin.resolutionSource || "unknown",
    controllerVersion: metadata.controllerVersion || SERVICE_VERSION
  } : null;
  if (!runtime) return { status: "stopped", installed: fs.existsSync(files.controller), installedPlugin: installedMetadata, paths: { runtime: files.runtime, logs: files.logs } };
  const health = runtime.url ? await probeHealth(new URL("/api/health", runtime.url).toString(), options) : null;
  if (health) {
    const matches = health.instanceId === runtime.instanceId && Number(health.pid) === Number(runtime.pid);
    if (!matches) return { status: "stale_state", installed: true, runtime, health: publicHealth(health), pidOwned: ownedRuntimeProcess(runtime, options), recoveryEntry: `${files.launcher} status` };
    let installed = null;
    try { installed = resolvePlugin(options); } catch (error) {
      return { status: "degraded", installed: true, runtime, health: publicHealth(health), resolverError: { code: error.code || "resolver_error", message: safeMessage(error) }, paths: { logs: files.logs } };
    }
    const restartRequired = health.restartRequired === true || runtime.restartRequired === true || installed.fingerprint !== health.pluginFingerprint || installed.version !== health.pluginVersion;
    if (restartRequired) {
      atomicJson(files.runtime, { ...runtime, status: "restart_required", restartRequired: true, installedPluginVersion: installed.version, installedPluginFingerprint: installed.fingerprint, updatedAt: new Date().toISOString() });
    }
    return {
      status: restartRequired ? "restart_required" : runtime.startupMode === "foreground" ? "foreground" : (health.status === "ok" ? "healthy" : "starting"),
      installed: true,
      runtime: {
        ...runtime,
        ...(restartRequired ? {
          status: "restart_required",
          restartRequired: true,
          installedPluginVersion: installed.version,
          installedPluginFingerprint: installed.fingerprint
        } : {}),
        installedRoot: installed.installedRoot,
        actualEntrypoint: installed.actualEntrypoint,
        resolutionSource: installed.resolutionSource,
        controllerVersion: SERVICE_VERSION
      },
      health: publicHealth(health),
      currentPlugin: { version: installed.version, fingerprint: installed.fingerprint, installedRoot: installed.installedRoot, actualEntrypoint: installed.actualEntrypoint, resolutionSource: installed.resolutionSource, controllerVersion: SERVICE_VERSION },
      busy: health.mutation?.busy === true,
      paths: { logs: files.logs, runtime: files.runtime }
    };
  }
  if (runtime.status === "failed") return { status: "failed", installed: true, installedPlugin: installedMetadata, runtime, paths: { logs: files.logs }, recoveryEntry: `${files.launcher} foreground` };
  if (runtime.status === "stopped") return { status: "stopped", installed: true, installedPlugin: installedMetadata, runtime, paths: { logs: files.logs } };
  return { status: "stale_state", installed: true, runtime, pidOwned: ownedRuntimeProcess(runtime, options), pidAlive: processAlive(runtime.pid, options), paths: { logs: files.logs }, recoveryEntry: `${files.launcher} status` };
}

function acquireLock(files, options = {}) {
  ensureDir(files.stateRoot);
  try {
    const fd = fs.openSync(files.lock, "wx", PRIVATE_FILE_MODE);
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return () => {
      try { fs.closeSync(fd); } catch (_error) { /* Best effort. */ }
      try { fs.unlinkSync(files.lock); } catch (_error) { /* Best effort. */ }
    };
  } catch (error) {
    const lock = readJson(files.lock);
    if (error.code === "EEXIST" && lock && !processAlive(lock.pid, options)) {
      fs.unlinkSync(files.lock);
      return acquireLock(files, options);
    }
    throw new ControllerError("controller_busy", "Another SoloDesk controller operation is in progress.", 2);
  }
}

function activateProfile(mode, options = {}) {
  const files = pathsFor(options.home);
  ensureLogs(files);
  if (mode === "login") {
    writeProfile(files, "login", files.plist);
    bootstrap(files.plist, options);
    return files.plist;
  }
  writeProfile(files, "active", files.activePlist);
  bootstrap(files.activePlist, options);
  return files.activePlist;
}

function prepareProfile(mode, options = {}) {
  if (process.platform !== "darwin" && !options.allowNonDarwin) throw new ControllerError("managed_mode_unsupported", "Managed SoloDesk requires macOS launchd; use foreground mode on this platform.");
  bootout(options);
  waitForBootout(options);
  return activateProfile(mode, options);
}

async function waitForHealthy(options = {}) {
  const deadline = Date.now() + (options.startTimeoutMs || 30000);
  while (Date.now() < deadline) {
    const current = await status(options);
    if (["healthy", "foreground", "restart_required", "failed"].includes(current.status)) return current;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs || 200));
  }
  throw new ControllerError("health_timeout", "SoloDesk did not become healthy before the startup timeout.");
}

function openBrowser(url, options = {}) {
  if (options.noBrowser || !url) return;
  if (options.openBrowser) { options.openBrowser(url); return; }
  execFile("/usr/bin/open", [url], () => {});
}

async function open(options = {}) {
  const files = pathsFor(options.home);
  if (!controllerIsCurrent(files, options) || !readJson(files.metadata)) install(options);
  let release;
  try { release = acquireLock(files, options); } catch (error) {
    if (error.code !== "controller_busy") throw error;
    const current = await waitForHealthy(options);
    if (["healthy", "foreground"].includes(current.status)) {
      openBrowser(current.runtime.url, options);
      return { status: current.status, reused: true, waitedForController: true, instanceId: current.runtime.instanceId, pid: current.runtime.pid, url: current.runtime.url };
    }
    return current;
  }
  try {
    let current = await status(options);
    if (["healthy", "foreground"].includes(current.status)) {
      openBrowser(current.runtime.url, options);
      return { status: current.status, reused: true, instanceId: current.runtime.instanceId, pid: current.runtime.pid, url: current.runtime.url };
    }
    if (current.status === "failed") return current;
    if (current.status === "stale_state") {
      if (current.pidAlive && !current.pidOwned) throw new ControllerError("stale_pid_unowned", "Runtime PID belongs to another process; state was not removed.");
      try { fs.unlinkSync(files.runtime); } catch (_error) { /* Safe stale cleanup. */ }
    }
    if (current.status === "restart_required") return restart({ ...options, lockHeld: true });
    const mode = startupMode(options);
    prepareProfile(mode, options);
    current = await waitForHealthy(options);
    if (current.status !== "healthy") return current;
    openBrowser(current.runtime.url, options);
    return { status: "healthy", reused: false, instanceId: current.runtime.instanceId, pid: current.runtime.pid, url: current.runtime.url, startupMode: mode };
  } finally {
    release?.();
  }
}

async function stop(options = {}) {
  const files = pathsFor(options.home);
  const current = await status(options);
  if (current.status === "foreground") return { ...current, recoveryEntry: "Stop the foreground terminal with Ctrl-C." };
  if (current.busy && !options.force) return { status: "busy", mutation: current.health?.mutation, recoveryEntry: `${files.launcher} stop` };
  atomicJson(files.controlRequest, { action: "stop", requestedAt: new Date().toISOString(), userRequestedStop: true });
  bootout(options);
  waitForBootout(options);
  if (current.runtime?.pid) await waitForProcessExit(current.runtime.pid, options);
  try { fs.unlinkSync(files.activePlist); } catch (_error) { /* On-demand active profile is temporary. */ }
  const runtime = readJson(files.runtime) || current.runtime || {};
  atomicJson(files.runtime, { ...runtime, status: "stopped", restartRequired: false, userRequestedStop: true, updatedAt: new Date().toISOString() });
  return { status: "stopped", pid: runtime.pid || null, runtime: files.runtime };
}

async function restart(options = {}) {
  const files = pathsFor(options.home);
  const release = options.lockHeld ? () => {} : acquireLock(files, options);
  try {
    const current = await status(options);
    if (current.status === "foreground") throw new ControllerError("foreground_instance_running", "Stop the foreground SoloDesk before starting a managed instance.");
    if (current.busy && !options.force) return { status: "busy", mutation: current.health?.mutation, recoveryEntry: `${files.launcher} restart` };
    if (current.status === "failed") {
      atomicJson(files.runtime, { ...current.runtime, status: "stopped", restartCount: 0, crashHistory: [], lastErrorCode: "", restartRequired: false, updatedAt: new Date().toISOString() });
    }
    atomicJson(files.controlRequest, { action: "restart", requestedAt: new Date().toISOString(), userRequestedStop: false, reason: options.reason || "controller_restart" });
    bootout(options);
    waitForBootout(options);
    if (current.runtime?.pid) await waitForProcessExit(current.runtime.pid, options);
    try { fs.unlinkSync(files.activePlist); } catch (_error) { /* Best effort. */ }
    activateProfile(startupMode(options), options);
    const ready = await waitForHealthy(options);
    if (ready.status === "healthy") openBrowser(ready.runtime.url, options);
    return { ...ready, restarted: ready.status === "healthy" };
  } finally {
    release();
  }
}

function redactLog(value) {
  return String(value)
    .replace(/((?:["']?authorization["']?)\s*[:=]\s*["']?)(?:Bearer\s+)?([^"',}\s]+)/ig, "$1[REDACTED]")
    .replace(/((?:["']?(?:api[_-]?key|token|password|secret)["']?)\s*[:=]\s*["']?)([^"',}\s]+)/ig, "$1[REDACTED]")
    .replace(/\b(?:sk|sess|pat)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function tail(file, lines = 40) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 64 * 1024);
    const fd = fs.openSync(file, "r");
    const bytes = Buffer.alloc(size);
    fs.readSync(fd, bytes, 0, size, stat.size - size);
    fs.closeSync(fd);
    return redactLog(bytes.toString("utf8").split(/\r?\n/).slice(-lines).join("\n"));
  } catch (_error) { return ""; }
}

function logs(options = {}) {
  const files = pathsFor(options.home);
  return { status: "ok", paths: { stdout: files.stdoutLog, stderr: files.stderrLog }, summary: { stdout: tail(files.stdoutLog, options.logLines), stderr: tail(files.stderrLog, options.logLines) } };
}

function crashState(options = {}) {
  const files = pathsFor(options.home);
  const runtime = readJson(files.runtime) || {};
  const request = readJson(files.controlRequest);
  try { fs.unlinkSync(files.controlRequest); } catch (_error) { /* Best effort. */ }
  const now = Date.now();
  let history = Array.isArray(runtime.crashHistory) ? runtime.crashHistory.map((value) => new Date(value).getTime()).filter(Number.isFinite) : [];
  history = history.filter((value) => now - value <= 5 * 60 * 1000);
  const unclean = !request && ACTIVE_STATUSES.has(runtime.status) && runtime.pid && !processAlive(runtime.pid, options);
  if (unclean) history.push(now);
  const restartCount = history.length;
  if (restartCount > CRASH_DELAYS_MS.length) {
    atomicJson(files.runtime, { ...runtime, status: "failed", restartRequired: false, restartCount, crashHistory: history.map((value) => new Date(value).toISOString()), lastErrorCode: "crash_loop_limit", updatedAt: new Date().toISOString() });
    return { blocked: true, restartCount, delayMs: 0 };
  }
  const delayMs = unclean ? CRASH_DELAYS_MS[restartCount - 1] || 0 : 0;
  if (unclean) atomicJson(files.runtime, { ...runtime, status: "restarting", restartCount, crashHistory: history.map((value) => new Date(value).toISOString()), lastErrorCode: "unexpected_exit", updatedAt: new Date().toISOString() });
  return { blocked: false, restartCount, delayMs };
}

async function service(options = {}) {
  const files = pathsFor(options.home);
  ensureLogs(files);
  const crash = crashState(options);
  if (crash.blocked) return { status: "failed", exitCode: 0, reason: "crash_loop_limit" };
  if (crash.delayMs) await new Promise((resolve) => setTimeout(resolve, options.skipDelay ? 0 : crash.delayMs));
  const metadata = readJson(files.metadata) || {};
  const trustedPath = [...new Set([
    path.dirname(metadata.nodePath || process.execPath),
    metadata.codexPath ? path.dirname(metadata.codexPath) : "",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].filter(Boolean))].join(path.delimiter);
  const serviceEnv = { ...process.env, HOME: files.home, PATH: trustedPath, RAVO_SOLODESK_MANAGED: "1" };
  const plugin = resolvePlugin({ ...options, codexPath: options.codexPath || metadata.codexPath, env: serviceEnv });
  if (!plugin.degraded) atomicJson(files.metadata, { ...metadata, updatedAt: new Date().toISOString(), lastKnownPlugin: { root: plugin.root, installedRoot: plugin.installedRoot, actualEntrypoint: plugin.actualEntrypoint, version: plugin.version, fingerprint: plugin.fingerprint, resolutionSource: plugin.resolutionSource, verifiedAt: new Date().toISOString() } });
  const instanceId = crypto.randomUUID();
  const args = [
    plugin.serverFile,
    "--managed-service",
    "--runtime-state", files.runtime,
    "--control-request", files.controlRequest,
    "--controller-path", files.controller,
    "--instance-id", instanceId,
    "--startup-mode", startupMode(options),
    "--service-version", SERVICE_VERSION,
    "--plugin-version", plugin.version,
    "--plugin-fingerprint", plugin.fingerprint,
    "--installed-root", plugin.installedRoot,
    "--actual-entrypoint", plugin.actualEntrypoint,
    "--resolution-source", plugin.resolutionSource,
    "--controller-version", SERVICE_VERSION,
    "--restart-count", String(crash.restartCount)
  ];
  if (metadata.codexPath) args.push("--codex-path", metadata.codexPath);
  const previousRuntime = readJson(files.runtime);
  if (Number.isInteger(Number(previousRuntime?.port)) && Number(previousRuntime.port) >= 1024 && Number(previousRuntime.port) <= 65535) args.push("--port", String(previousRuntime.port));
  const nodePath = executableCandidate(metadata.nodePath || process.execPath);
  if (!nodePath) throw new ControllerError("node_executable_missing", "Recorded Node executable is unavailable.");
  const spawnChild = options.spawnChild || ((file, argv, settings) => spawn(file, argv, settings));
  const child = spawnChild(nodePath, args, { stdio: "inherit", env: serviceEnv });
  if (!child || typeof child.on !== "function") throw new ControllerError("service_spawn_failed", "SoloDesk service child could not be started.");
  const forward = (signal) => { try { child.kill(signal); } catch (_error) { /* Best effort. */ } };
  process.once("SIGTERM", forward);
  process.once("SIGINT", forward);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    process.removeListener("SIGTERM", forward);
    process.removeListener("SIGINT", forward);
  });
  return { status: exit.code === 0 ? "stopped" : "crashed", exitCode: exit.code === 0 ? 0 : 1, signal: exit.signal || "" };
}

async function foreground(options = {}) {
  const files = pathsFor(options.home);
  const current = await status(options);
  if (["healthy", "restart_required"].includes(current.status)) throw new ControllerError("managed_instance_running", `Managed SoloDesk is already running at ${current.runtime.url}.`);
  const plugin = resolvePlugin(options);
  try { fs.unlinkSync(files.controlRequest); } catch (_error) { /* Foreground starts with no managed stop/restart request. */ }
  const args = [plugin.serverFile, "--foreground", "--runtime-state", files.runtime, "--control-request", files.controlRequest, "--controller-path", files.controller, "--instance-id", crypto.randomUUID(), "--startup-mode", "foreground", "--service-version", SERVICE_VERSION, "--plugin-version", plugin.version, "--plugin-fingerprint", plugin.fingerprint, "--installed-root", plugin.installedRoot, "--actual-entrypoint", plugin.actualEntrypoint, "--resolution-source", plugin.resolutionSource, "--controller-version", SERVICE_VERSION];
  const child = (options.spawnForeground || spawn)(process.execPath, args, { stdio: "inherit", env: { ...process.env, HOME: files.home } });
  const forwardTerm = () => { try { child.kill("SIGTERM"); } catch (_error) { /* Best effort. */ } };
  const forwardInt = () => { try { child.kill("SIGINT"); } catch (_error) { /* Best effort. */ } };
  process.on("SIGTERM", forwardTerm);
  process.on("SIGINT", forwardInt);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    process.removeListener("SIGTERM", forwardTerm);
    process.removeListener("SIGINT", forwardInt);
  });
  const stopped = result.code === 0 || ["SIGINT", "SIGTERM"].includes(result.signal);
  return { status: stopped ? "stopped" : "failed", exitCode: stopped ? 0 : (result.code || 1) };
}

async function uninstall(options = {}) {
  const files = pathsFor(options.home);
  const current = await status(options);
  if (current.status === "foreground") throw new ControllerError("foreground_instance_running", "Stop the foreground SoloDesk with Ctrl-C before uninstalling.");
  await stop({ ...options, force: true }).catch(() => {});
  bootout(options);
  for (const file of [files.controller, files.launcher, files.command, files.plist]) try { fs.unlinkSync(file); } catch (_error) { /* Best effort. */ }
  fs.rmSync(files.stateRoot, { recursive: true, force: true });
  try { if (!fs.readdirSync(files.bin).length) fs.rmdirSync(files.bin); } catch (_error) { /* Preserve shared directories. */ }
  return { status: "uninstalled", preserved: [files.userConfig, path.join(files.base, "backups"), path.join(files.base, "knowledge")] };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function main() {
  const command = process.argv[2] || "status";
  if (["--help", "-h", "help"].includes(command)) {
    process.stdout.write("Usage: ravo-solodesk install|open|status|stop|restart|logs|foreground|uninstall\n");
    return;
  }
  if (command === "--version") { process.stdout.write(`${SERVICE_VERSION}\n`); return; }
  const options = {
    home: process.env.HOME,
    startupMode: argValue("--startup-mode", ""),
    pluginRoot: command === "foreground" ? argValue("--plugin-root", "") : "",
    noBrowser: process.argv.includes("--no-browser"),
    force: process.argv.includes("--force"),
    reason: argValue("--reason", "")
  };
  if (command === "install") print(install(options));
  else if (command === "open") print(await open(options));
  else if (command === "status") print(await status(options));
  else if (command === "stop") print(await stop(options));
  else if (command === "restart") print(await restart(options));
  else if (command === "logs") print(logs(options));
  else if (command === "foreground") print(await foreground(options));
  else if (command === "uninstall") print(await uninstall(options));
  else if (command === "__service") {
    const result = await service(options);
    if (result.exitCode) process.exitCode = result.exitCode;
  } else throw new ControllerError("unknown_command", `Unknown SoloDesk command: ${command}`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error.code || "solodesk_controller_error", message: safeMessage(error), ...(error.details === undefined ? {} : { details: error.details }) })}\n`);
    process.exitCode = Number(error.status) || 1;
  });
}

module.exports = {
  ControllerError,
  dashboardCacheRoot,
  LABEL,
  SERVICE_VERSION,
  atomicJson,
  crashState,
  foreground,
  inspectPluginRoot,
  install,
  logs,
  open,
  pathsFor,
  plistFor,
  prepareProfile,
  probeHealth,
  resolvePlugin,
  restart,
  service,
  startupMode,
  status,
  stop,
  uninstall,
  verifiedCacheRoot
};
