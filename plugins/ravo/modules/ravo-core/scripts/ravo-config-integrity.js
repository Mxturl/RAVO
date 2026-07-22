#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCHEMA_VERSION = "0.5.1";
const PRODUCT_VERSION = "0.6.2";
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const RAVO_PLUGIN_NAMES = Object.freeze(["ravo"]);
const RAVO_PLUGIN_IDS = new Set(RAVO_PLUGIN_NAMES.map((name) => `${name}@ravo`));
const REPAIR_STATUSES = new Set(["planned", "applying", "succeeded", "partial", "failed", "recovered", "manual_recovery_required"]);
const HOOK_TRUST_RECOVERY = "In ChatGPT Desktop, open Settings > Hooks and trust the pending RAVO Stop hook; in Codex CLI, run /hooks.";

class ConfigIntegrityError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "ConfigIntegrityError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
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
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(stableValue(value)));
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function nowIso(options = {}) {
  const value = typeof options.now === "function" ? options.now() : options.now;
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function safeId(prefix, options = {}) {
  return `${prefix}-${nowIso(options).replace(/[:.]/g, "-")}-${crypto.randomBytes(5).toString("hex")}`;
}

function pathsFor(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const root = path.join(home, ".codex", "ravo", "config-integrity");
  return {
    home,
    config: path.join(home, ".codex", "config.toml"),
    root,
    snapshots: path.join(root, "snapshots"),
    latest: path.join(root, "latest.json"),
    repairs: path.join(root, "repairs"),
    journals: path.join(root, "journals"),
    epoch: path.join(root, "runtime-epoch.json"),
    lock: path.join(home, ".codex", "ravo", "mutation.lock")
  };
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.chmodSync(dir, PRIVATE_DIR_MODE);
}

function makePrivateTempDir(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(root, PRIVATE_DIR_MODE);
  return root;
}

function writePrivate(file, bytes) {
  ensurePrivateDir(path.dirname(file));
  fs.writeFileSync(file, bytes, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(file, PRIVATE_FILE_MODE);
  const readBack = fs.readFileSync(file);
  if (readBack.length !== Buffer.byteLength(bytes) || sha(readBack) !== sha(Buffer.from(bytes))) {
    throw new ConfigIntegrityError("private_write_readback_failed", "Private file read-back did not match the bytes written.", 500);
  }
}

function atomicJson(file, value) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(tmp, PRIVATE_FILE_MODE);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, PRIVATE_FILE_MODE);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function currentEpochId(options = {}) {
  return readJson(pathsFor(options).epoch)?.epochId || "initial";
}

function runtimeProbeCurrent(runtimeStatus = {}, options = {}) {
  return (runtimeStatus.runtimeProbeStatus === "pass"
      || runtimeStatus.coreRuntimeStatus === "verified"
      || (runtimeStatus.runtimeProbeStatus === "partial" && runtimeStatus.terminalTelemetryStatus === "observed"))
    && (runtimeStatus.configMutationEpoch || "initial") === currentEpochId(options);
}

function readConfigState(options = {}) {
  const files = pathsFor(options);
  if (!fs.existsSync(files.config)) throw new ConfigIntegrityError("codex_config_missing", "Codex config.toml is missing.", 404);
  const lstat = fs.lstatSync(files.config);
  if (!lstat.isFile() || lstat.isSymbolicLink()) throw new ConfigIntegrityError("codex_config_unsafe_type", "Codex config.toml must be a regular non-symlink file.", 409);
  if (typeof process.getuid === "function" && lstat.uid !== process.getuid()) throw new ConfigIntegrityError("codex_config_owner_mismatch", "Codex config.toml is not owned by the current user.", 409);
  const bytes = fs.readFileSync(files.config);
  const mode = lstat.mode & 0o777;
  if (mode & 0o077) throw new ConfigIntegrityError("codex_config_mode_insecure", "Codex config.toml must not be readable or writable by group or other users.", 409);
  return {
    path: files.config,
    bytes,
    text: bytes.toString("utf8"),
    hash: sha(bytes),
    size: bytes.length,
    mode,
    uid: lstat.uid,
    gid: lstat.gid,
    mtimeMs: lstat.mtimeMs
  };
}

function parseQuotedKey(source, index, quote) {
  let cursor = index + 1;
  let escaped = false;
  let raw = quote;
  while (cursor < source.length) {
    const char = source[cursor];
    raw += char;
    cursor += 1;
    if (quote === '"' && escaped) { escaped = false; continue; }
    if (quote === '"' && char === "\\") { escaped = true; continue; }
    if (char === quote) {
      if (quote === "'") return { value: raw.slice(1, -1), next: cursor };
      try { return { value: JSON.parse(raw), next: cursor }; } catch (_error) {
        throw new ConfigIntegrityError("toml_header_invalid", "A quoted TOML table key is invalid.", 409);
      }
    }
  }
  throw new ConfigIntegrityError("toml_header_invalid", "A quoted TOML table key is unterminated.", 409);
}

function parseTablePath(source) {
  const parts = [];
  let index = 0;
  const skipSpace = () => { while (/\s/.test(source[index] || "")) index += 1; };
  while (index < source.length) {
    skipSpace();
    if (index >= source.length) break;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const parsed = parseQuotedKey(source, index, quote);
      parts.push(parsed.value);
      index = parsed.next;
    } else {
      const start = index;
      while (index < source.length && !/[.\s]/.test(source[index])) index += 1;
      const value = source.slice(start, index);
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ConfigIntegrityError("toml_header_invalid", "A TOML table key uses unsupported syntax.", 409);
      parts.push(value);
    }
    skipSpace();
    if (index >= source.length) break;
    if (source[index] !== ".") throw new ConfigIntegrityError("toml_header_invalid", "A TOML table path is invalid.", 409);
    index += 1;
  }
  if (!parts.length) throw new ConfigIntegrityError("toml_header_invalid", "An empty TOML table path is invalid.", 409);
  return parts;
}

function tableKey(parts) {
  return JSON.stringify(parts);
}

function displayTable(parts) {
  return parts.map((part) => /^[A-Za-z0-9_-]+$/.test(part) ? part : JSON.stringify(part)).join(".");
}

function lexicalStateForLine(line, state) {
  let quote = state.quote || "";
  let triple = state.triple || "";
  let escaped = false;
  let square = state.square || 0;
  let curly = state.curly || 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const three = line.slice(index, index + 3);
    if (triple) {
      if (three === triple && !(triple === '"""' && escaped)) { triple = ""; index += 2; escaped = false; continue; }
      escaped = triple === '"""' && char === "\\" ? !escaped : false;
      continue;
    }
    if (quote) {
      if (quote === '"' && escaped) { escaped = false; continue; }
      if (quote === '"' && char === "\\") { escaped = true; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (three === '"""' || three === "'''") { triple = three; index += 2; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "#") break;
    if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (char === "{") curly += 1;
    else if (char === "}") curly = Math.max(0, curly - 1);
  }
  return { quote, triple, square, curly };
}

function parseTomlDocument(text) {
  if (text.includes("\0")) throw new ConfigIntegrityError("toml_nul_rejected", "Codex config.toml contains a NUL byte.", 409);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.match(/[^\n]*(?:\n|$)/g).filter((line) => line.length > 0);
  const headers = [];
  let offset = 0;
  let lexical = { quote: "", triple: "", square: 0, curly: 0 };
  for (const line of lines) {
    const plain = line.replace(/\r?\n$/, "");
    if (!lexical.triple && lexical.square === 0 && lexical.curly === 0) {
      const match = plain.match(/^\s*(\[\[?)(.*?)(\]\]?)\s*(?:#.*)?$/);
      if (match && ((match[1] === "[" && match[3] === "]") || (match[1] === "[[" && match[3] === "]]"))) {
        const arrayTable = match[1] === "[[";
        const parts = parseTablePath(match[2]);
        headers.push({ offset, parts, key: tableKey(parts), arrayTable, header: plain.trim() });
        offset += line.length;
        continue;
      }
    }
    lexical = lexicalStateForLine(plain, lexical);
    if (lexical.quote) throw new ConfigIntegrityError("toml_string_unterminated", "Codex config.toml contains an unterminated single-line string.", 409);
    offset += line.length;
  }
  if (lexical.quote || lexical.triple || lexical.square || lexical.curly) throw new ConfigIntegrityError("toml_structure_incomplete", "Codex config.toml contains an unterminated value.", 409);
  const arrayOccurrences = new Map();
  const sections = headers.map((header, index) => {
    const lookupKey = tableKey(header.parts);
    const occurrence = header.arrayTable ? (arrayOccurrences.get(lookupKey) || 0) : 0;
    if (header.arrayTable) arrayOccurrences.set(lookupKey, occurrence + 1);
    return {
      ...header,
      lookupKey,
      key: header.arrayTable ? `${lookupKey}#${occurrence}` : lookupKey,
      start: header.offset,
      end: headers[index + 1]?.offset ?? text.length,
      text: text.slice(header.offset, headers[index + 1]?.offset ?? text.length),
      name: displayTable(header.parts)
    };
  });
  const byKey = new Map();
  const duplicates = [];
  for (const section of sections) {
    if (!section.arrayTable && byKey.has(section.lookupKey)) duplicates.push(section.name);
    else byKey.set(section.key, section);
  }
  return {
    text,
    newline,
    preamble: text.slice(0, headers[0]?.offset ?? text.length),
    sections,
    byKey,
    duplicates
  };
}

function isRavoMarketplace(section) {
  return section.parts.length === 2 && section.parts[0] === "marketplaces" && section.parts[1] === "ravo";
}

function isRavoPlugin(section) {
  return section.parts.length === 2 && section.parts[0] === "plugins" && RAVO_PLUGIN_IDS.has(section.parts[1]);
}

function isRavoHook(section) {
  return section.parts.length === 3
    && section.parts[0] === "hooks"
    && section.parts[1] === "state"
    && RAVO_PLUGIN_IDS.has(hookPluginId(section.parts[2]));
}

function isRavoManaged(section) {
  return isRavoMarketplace(section) || isRavoPlugin(section) || isRavoHook(section);
}

function isExternalRegistration(section) {
  if (section.parts.length === 2 && section.parts[0] === "marketplaces" && section.parts[1] !== "ravo") return true;
  if (section.parts.length === 2 && section.parts[0] === "plugins" && !section.parts[1].endsWith("@ravo")) return true;
  return section.parts.length === 3 && section.parts[0] === "hooks" && section.parts[1] === "state" && !/^(?:ravo@ravo|ravo-[^:]+@ravo):/.test(section.parts[2]);
}

function assignmentValue(section, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*([^#\\r\\n]+)`, "m"));
  if (!match) return undefined;
  const raw = match[1].trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch (_error) { return undefined; }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return raw;
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function managedContext(runtimeStatus = {}) {
  const sourceValue = runtimeStatus.sourceRoot || runtimeStatus.marketplace?.root || "";
  if (!sourceValue) throw new ConfigIntegrityError("ravo_source_unresolved", "The current RAVO marketplace source could not be resolved.", 409);
  const sourceRoot = path.resolve(sourceValue);
  const runtimePlugins = new Map((runtimeStatus.plugins || []).map((plugin) => [plugin.name, plugin]));
  const pluginNames = RAVO_PLUGIN_NAMES.filter((name) => runtimePlugins.size === 0 || runtimePlugins.has(name));
  const hooks = (runtimeStatus.hookTrust?.expected || []).map((entry) => ({ ...entry }));
  const hookDefinitionErrors = Array.isArray(runtimeStatus.hookTrust?.errors) ? runtimeStatus.hookTrust.errors.map(String) : [];
  const manifests = Object.fromEntries((runtimeStatus.hookManifests || []).map((entry) => [entry.pluginId, entry.hash]));
  const sections = new Map();
  const marketplaceParts = ["marketplaces", "ravo"];
  sections.set(tableKey(marketplaceParts), {
    parts: marketplaceParts,
    name: displayTable(marketplaceParts),
    text: `[marketplaces.ravo]\nsource_type = "local"\nsource = ${tomlString(sourceRoot)}\n`
  });
  for (const name of pluginNames) {
    const parts = ["plugins", `${name}@ravo`];
    sections.set(tableKey(parts), {
      parts,
      name: displayTable(parts),
      text: `[plugins.${tomlString(`${name}@ravo`)}]\nenabled = true\n`
    });
  }
  return {
    sourceRoot,
    pluginNames,
    hooks,
    hookDefinitionErrors,
    hookManifests: manifests,
    sections,
    pluginFingerprint: runtimeStatus.pluginFingerprint || sha({ sourceRoot, pluginNames, hooks, manifests })
  };
}

function normalizeBlock(text, newline) {
  const value = String(text || "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return `${value.replace(/\n/g, newline)}${newline}${newline}`;
}

function mergeDocument(document, replacements, removals, additions) {
  let result = document.preamble;
  for (const section of document.sections) {
    if (removals.has(section.key)) continue;
    result += replacements.has(section.key) ? normalizeBlock(replacements.get(section.key), document.newline) : section.text;
  }
  const appended = additions.filter((entry) => !document.byKey.has(entry.key) && !replacements.has(entry.key));
  if (appended.length) {
    if (result && !result.endsWith(document.newline)) result += document.newline;
    result += appended.map((entry) => normalizeBlock(entry.text, document.newline)).join("");
  }
  return result;
}

function hookPluginId(key) {
  return String(key || "").split(":")[0];
}

function snapshotFiles(snapshotRoot) {
  return {
    root: snapshotRoot,
    config: path.join(snapshotRoot, "config.toml"),
    metadata: path.join(snapshotRoot, "metadata.json")
  };
}

function listSnapshots(options = {}) {
  const files = pathsFor(options);
  let ids = [];
  try { ids = fs.readdirSync(files.snapshots).filter((id) => /^[A-Za-z0-9-]+$/.test(id)); } catch (_error) { return []; }
  return ids.map((id) => ({ id, entry: readJson(snapshotFiles(path.join(files.snapshots, id)).metadata) }))
    .filter(({ id, entry }) => entry?.snapshotId === id)
    .map(({ entry }) => entry)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .map((entry) => ({
      snapshotId: entry.snapshotId,
      createdAt: entry.createdAt,
      sourceHash: entry.sourceHash,
      ravoVersion: entry.ravoVersion,
      pluginFingerprint: entry.pluginFingerprint,
      runtimeVerified: entry.runtimeVerified === true,
      trustLevel: entry.runtimeVerified === true ? "runtime_verified" : "configured_unverified",
      reason: entry.reason,
      managedSections: entry.managedSections || [],
      preservedExternalSections: entry.preservedExternalSections || []
    }));
}

function validateTomlWithCodex(text, options = {}) {
  if (typeof options.validateToml === "function") {
    try { return options.validateToml(text); }
    catch (_error) { throw new ConfigIntegrityError("candidate_toml_invalid", "The repaired Codex config is not accepted by the current Codex parser.", 409); }
  }
  const root = makePrivateTempDir("ravo-config-integrity-");
  try {
    fs.writeFileSync(path.join(root, "config.toml"), text, { mode: PRIVATE_FILE_MODE });
    execFileSync(options.codexPath || "codex", ["plugin", "list", "--json"], {
      encoding: "utf8",
      timeout: options.commandTimeoutMs || 15000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CODEX_HOME: root }
    });
    return { status: "pass" };
  } catch (error) {
    throw new ConfigIntegrityError("candidate_toml_invalid", "The repaired Codex config is not accepted by the current Codex parser.", 409);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runtimeCanSnapshot(runtimeStatus) {
  return runtimeStatus?.marketplaceStatus === "present"
    && runtimeStatus?.pluginStatus === "healthy"
    && runtimeStatus?.versionStatus === "aligned"
    && runtimeStatus?.hookTrustEvidence === "recorded";
}

function createSnapshotUnlocked(options = {}) {
  const files = pathsFor(options);
  const current = readConfigState(options);
  const document = parseTomlDocument(current.text);
  if (document.duplicates.length) throw new ConfigIntegrityError("toml_duplicate_tables", "Codex config contains duplicate tables.", 409, { sections: document.duplicates });
  validateTomlWithCodex(current.text, options);
  const runtimeStatus = options.runtimeStatus || {};
  if (!runtimeCanSnapshot(runtimeStatus)) throw new ConfigIntegrityError("snapshot_runtime_not_known_good", "RAVO registrations and Hook trust must be aligned before creating a known-good snapshot.", 409);
  const managed = managedContext(runtimeStatus);
  const managedSections = document.sections.filter(isRavoManaged).map((section) => section.name);
  const missing = [...managed.sections.values()].filter((expected) => !document.byKey.has(tableKey(expected.parts))).map((entry) => entry.name);
  const missingHooks = managed.hooks.filter((entry) => !document.byKey.has(tableKey(["hooks", "state", entry.key]))).map((entry) => entry.key);
  if (missing.length || missingHooks.length) throw new ConfigIntegrityError("snapshot_managed_sections_missing", "The current config is not complete enough to become known-good.", 409, { missing: [...missing, ...missingHooks] });
  const snapshotId = safeId("snapshot", options);
  const target = snapshotFiles(path.join(files.snapshots, snapshotId));
  ensurePrivateDir(target.root);
  writePrivate(target.config, current.bytes);
  const runtimeVerified = runtimeProbeCurrent(runtimeStatus, options);
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId,
    createdAt: nowIso(options),
    sourceHash: current.hash,
    sourceMode: current.mode.toString(8).padStart(4, "0"),
    ravoVersion: options.ravoVersion || SCHEMA_VERSION,
    pluginFingerprint: managed.pluginFingerprint,
    hookManifests: managed.hookManifests,
    managedSections,
    preservedExternalSections: document.sections.filter(isExternalRegistration).map((section) => section.name),
    secretFieldsRedactedInMetadata: true,
    runtimeProbeRef: runtimeStatus.runtimeProbe?.artifactPath || "",
    configMutationEpoch: currentEpochId(options),
    runtimeVerified,
    reason: options.reason || (runtimeVerified ? "post_probe_known_good" : "configured_unverified")
  };
  writePrivate(target.metadata, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
  const previous = readJson(files.latest) || { schemaVersion: SCHEMA_VERSION, snapshots: [] };
  const summaries = [
    ...(previous.snapshots || []).filter((entry) => entry.snapshotId !== snapshotId),
    { snapshotId, createdAt: metadata.createdAt, runtimeVerified, sourceHash: metadata.sourceHash }
  ].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const maxSnapshots = Math.max(1, Math.min(20, Number(options.maxSnapshots) || 5));
  const kept = summaries.slice(0, maxSnapshots);
  for (const entry of summaries.slice(maxSnapshots)) fs.rmSync(path.join(files.snapshots, entry.snapshotId), { recursive: true, force: true });
  const previousRecommended = kept.find((entry) => entry.snapshotId === previous.recommendedSnapshotId && entry.runtimeVerified)?.snapshotId || "";
  const recommendedSnapshotId = runtimeVerified ? snapshotId : previousRecommended;
  atomicJson(files.latest, {
    schemaVersion: SCHEMA_VERSION,
    latestSnapshotId: snapshotId,
    recommendedSnapshotId,
    snapshots: kept,
    updatedAt: metadata.createdAt
  });
  return { status: "created", snapshot: { ...metadata, configPath: target.config, metadataPath: target.metadata }, recommended: recommendedSnapshotId === snapshotId };
}

function loadSnapshot(id, options = {}) {
  if (!/^[A-Za-z0-9-]+$/.test(String(id || ""))) throw new ConfigIntegrityError("snapshot_id_invalid", "Snapshot id is invalid.");
  const target = snapshotFiles(path.join(pathsFor(options).snapshots, id));
  const metadata = readJson(target.metadata);
  if (!metadata || metadata.snapshotId !== id || !fs.existsSync(target.config)) throw new ConfigIntegrityError("snapshot_not_found", "The selected config-integrity snapshot was not found.", 404);
  const bytes = fs.readFileSync(target.config);
  if (sha(bytes) !== metadata.sourceHash) throw new ConfigIntegrityError("snapshot_hash_mismatch", "The selected snapshot failed its hash check.", 409);
  const stat = fs.statSync(target.config);
  if ((stat.mode & 0o777) !== PRIVATE_FILE_MODE) throw new ConfigIntegrityError("snapshot_permission_mismatch", "The selected snapshot does not have 0600 permissions.", 409);
  return { id, ...target, metadata, bytes, text: bytes.toString("utf8"), document: parseTomlDocument(bytes.toString("utf8")) };
}

function buildRepair(options = {}) {
  const current = readConfigState(options);
  const currentDocument = parseTomlDocument(current.text);
  if (currentDocument.duplicates.length) throw new ConfigIntegrityError("toml_duplicate_tables", "Codex config contains duplicate tables.", 409, { sections: currentDocument.duplicates });
  const runtimeStatus = options.runtimeStatus || {};
  const managed = managedContext(runtimeStatus);
  const latest = readJson(pathsFor(options).latest) || {};
  const snapshotId = options.snapshotId || latest.recommendedSnapshotId || latest.latestSnapshotId || "";
  const snapshot = snapshotId ? loadSnapshot(snapshotId, options) : null;
  const selectedExternal = [...new Set((options.selectedExternalSections || []).map(String))].sort();
  const reenablePlugins = new Set((options.reenablePlugins || []).map(String));
  const replacements = new Map();
  const removals = new Set();
  const additions = [];
  const managedChanges = [];
  const externalPreservedChanges = [];
  const conflicts = [];
  const approvalRequired = [];
  const unresolvedRequired = [];
  const expectedKeys = new Set(managed.sections.keys());

  for (const [key, expected] of managed.sections.entries()) {
    const currentSection = currentDocument.byKey.get(key);
    if (expected.parts[0] === "marketplaces") {
      const valid = currentSection
        && assignmentValue(currentSection, "source_type") === "local"
        && path.resolve(String(assignmentValue(currentSection, "source") || "")) === managed.sourceRoot;
      if (!currentSection) {
        additions.push({ key, text: expected.text });
        managedChanges.push({ section: expected.name, action: "add", reason: "missing_ravo_marketplace" });
      } else if (!valid) {
        replacements.set(key, expected.text);
        managedChanges.push({ section: expected.name, action: "replace", reason: "ravo_marketplace_drift" });
      }
      continue;
    }
    const pluginId = expected.parts[1];
    if (!currentSection) {
      additions.push({ key, text: expected.text });
      managedChanges.push({ section: expected.name, action: "add", reason: "missing_required_plugin" });
      continue;
    }
    const enabled = assignmentValue(currentSection, "enabled");
    if (enabled === false && !reenablePlugins.has(pluginId)) {
      unresolvedRequired.push({ section: expected.name, reason: "explicitly_disabled", recoveryEntry: `Select ${pluginId} in the repair preview to re-enable it.` });
    } else if (enabled !== true || reenablePlugins.has(pluginId)) {
      replacements.set(key, expected.text);
      managedChanges.push({ section: expected.name, action: "replace", reason: enabled === false ? "user_confirmed_reenable" : "invalid_plugin_registration" });
    }
  }

  const expectedHookKeys = new Set();
  if (managed.hookDefinitionErrors.length) {
    for (const section of currentDocument.sections.filter(isRavoHook)) {
      approvalRequired.push({
        section: section.name,
        reason: "hook_definition_unavailable",
        recoveryEntry: `Repair the installed Hook manifest. ${HOOK_TRUST_RECOVERY} Then start a fresh task.`
      });
    }
  } else {
    for (const hook of managed.hooks) {
      const parts = ["hooks", "state", hook.key];
      const key = tableKey(parts);
      expectedHookKeys.add(key);
      const currentSection = currentDocument.byKey.get(key);
      const snapshotSection = snapshot?.document.byKey.get(key);
      const pluginId = hookPluginId(hook.key);
      const sameManifest = Boolean(snapshot?.metadata.runtimeVerified
        && snapshotSection
        && snapshot.metadata.hookManifests?.[pluginId]
        && snapshot.metadata.hookManifests[pluginId] === managed.hookManifests[pluginId]);
      if (currentSection) {
        if (runtimeProbeCurrent(runtimeStatus, options)) continue;
        const matchesVerifiedSnapshot = sameManifest && sha(currentSection.text) === sha(snapshotSection.text);
        if (!matchesVerifiedSnapshot) {
          approvalRequired.push({
            section: displayTable(parts),
            reason: !snapshot?.metadata.runtimeVerified
              ? "hook_identity_not_runtime_verified"
              : !sameManifest ? "hook_manifest_changed" : "hook_trust_differs_from_verified_snapshot",
            recoveryEntry: `${HOOK_TRUST_RECOVERY} Then start a fresh task and create a runtime-verified snapshot.`
          });
        }
        continue;
      }
      if (sameManifest) {
        additions.push({ key, text: snapshotSection.text });
        managedChanges.push({ section: displayTable(parts), action: "restore", reason: "runtime_verified_hook_identity_unchanged" });
      } else {
        approvalRequired.push({
          section: displayTable(parts),
          reason: snapshotSection ? "hook_manifest_changed_or_snapshot_unverified" : "trusted_hash_not_available",
          recoveryEntry: `${HOOK_TRUST_RECOVERY} Then start a fresh task and create a runtime-verified snapshot.`
        });
      }
    }
  }

  for (const section of currentDocument.sections.filter(isRavoManaged)) {
    if (isRavoPlugin(section) && !expectedKeys.has(section.key)) {
      removals.add(section.key);
      managedChanges.push({ section: section.name, action: "remove", reason: "stale_ravo_plugin_registration" });
    }
    if (!managed.hookDefinitionErrors.length && isRavoHook(section) && !expectedHookKeys.has(section.key)) {
      removals.add(section.key);
      managedChanges.push({ section: section.name, action: "remove", reason: "stale_ravo_hook_registration" });
    }
  }

  const externalCandidates = snapshot ? snapshot.document.sections.filter(isExternalRegistration) : [];
  const allowedExternal = new Map(externalCandidates.map((section) => [section.name, section]));
  for (const name of selectedExternal) {
    const fromSnapshot = allowedExternal.get(name);
    if (!fromSnapshot) throw new ConfigIntegrityError("external_section_not_in_snapshot", `External section ${name} is not available in the selected snapshot.`, 409);
    const currentSection = currentDocument.byKey.get(fromSnapshot.key);
    if (!currentSection) {
      additions.push({ key: fromSnapshot.key, text: fromSnapshot.text });
      externalPreservedChanges.push({ section: name, action: "restore", reason: "user_selected_missing_external_registration" });
    } else if (sha(currentSection.text) !== sha(fromSnapshot.text)) {
      conflicts.push({ section: name, resolution: "keep_current", reason: "current_external_registration_differs_from_snapshot" });
    }
  }

  if (additions.some((entry) => JSON.parse(entry.key)[0] === "hooks") && !currentDocument.byKey.has(tableKey(["hooks", "state"]))) {
    additions.unshift({ key: tableKey(["hooks", "state"]), text: "[hooks.state]\n" });
  }
  const candidate = mergeDocument(currentDocument, replacements, removals, additions);
  const candidateDocument = parseTomlDocument(candidate);
  const protectedSections = [{
    section: "<root>",
    beforeHash: sha(currentDocument.preamble),
    afterHash: sha(candidateDocument.preamble),
    preserved: sha(currentDocument.preamble) === sha(candidateDocument.preamble)
  }, ...currentDocument.sections.filter((section) => !isRavoManaged(section)).map((section) => ({
    section: section.name,
    beforeHash: sha(section.text),
    afterHash: sha(candidateDocument.byKey.get(section.key)?.text || ""),
    preserved: candidateDocument.byKey.has(section.key) && sha(section.text) === sha(candidateDocument.byKey.get(section.key).text)
  }))];
  const protectedFailures = protectedSections.filter((entry) => !entry.preserved);
  if (protectedFailures.length) throw new ConfigIntegrityError("protected_section_changed", "Repair planning changed a protected current section.", 500, { sections: protectedFailures.map((entry) => entry.section) });
  const planInput = {
    currentHash: current.hash,
    snapshotId: snapshot?.id || "",
    snapshotHash: snapshot?.metadata.sourceHash || "",
    pluginFingerprint: managed.pluginFingerprint,
    selectedExternalSections: selectedExternal,
    reenablePlugins: [...reenablePlugins].sort(),
    managedChanges,
    externalPreservedChanges,
    conflicts,
    approvalRequired,
    unresolvedRequired,
    candidateHash: sha(candidate)
  };
  const planFingerprint = sha(planInput);
  return {
    current,
    currentDocument,
    snapshot,
    candidate,
    candidateDocument,
    plan: {
      schemaVersion: SCHEMA_VERSION,
      planId: planFingerprint.replace(/^sha256:/, "plan-"),
      planFingerprint,
      status: approvalRequired.length || unresolvedRequired.length ? "attention_required" : managedChanges.length || externalPreservedChanges.length ? "changes_ready" : "no_changes",
      currentHash: current.hash,
      currentMtimeMs: current.mtimeMs,
      snapshotId: snapshot?.id || "",
      snapshotTrust: snapshot ? (snapshot.metadata.runtimeVerified ? "runtime_verified" : "configured_unverified") : "none",
      snapshotHash: snapshot?.metadata.sourceHash || "",
      pluginFingerprint: managed.pluginFingerprint,
      candidateHash: sha(candidate),
      managedChanges,
      externalPreservedChanges,
      externalCandidates: externalCandidates.map((section) => section.name),
      selectedExternalSections: selectedExternal,
      reenablePlugins: [...reenablePlugins].sort(),
      conflicts,
      approvalRequired,
      unresolvedRequired,
      protectedSections,
      protectedSectionCount: protectedSections.length,
      backupPath: path.join(pathsFor(options).repairs, "<repair-id>", "pre-repair-config.toml"),
      runtimeProbeRequired: true,
      expiresOn: ["current_hash_change", "snapshot_change", "plugin_fingerprint_change", "selection_change"],
      risks: [
        "The current config remains authoritative for Provider, token, MCP, project, feature and unknown sections.",
        "Changed or previously untrusted Hook identities require explicit Codex approval and a fresh Task."
      ]
    }
  };
}

function previewRepair(options = {}) {
  return buildRepair(options).plan;
}

function getIntegrityStatus(options = {}) {
  const files = pathsFor(options);
  const latest = readJson(files.latest) || {};
  const snapshots = listSnapshots(options);
  const selectedSnapshotId = latest.recommendedSnapshotId || latest.latestSnapshotId || "";
  let plan;
  try { plan = buildRepair({ ...options, snapshotId: selectedSnapshotId }); } catch (error) {
    if (error.code === "snapshot_not_found") plan = buildRepair({ ...options, snapshotId: "" });
    else throw error;
  }
  const needsRepair = plan.plan.managedChanges.length > 0 || plan.plan.unresolvedRequired.length > 0;
  const approval = plan.plan.approvalRequired.length > 0;
  const status = approval ? "approval_required"
    : needsRepair ? "drift"
      : !snapshots.length ? "no_snapshot"
        : runtimeProbeCurrent(options.runtimeStatus, options) ? "healthy" : "configured_unverified";
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    configIntegrityStatus: status,
    currentHash: plan.plan.currentHash,
    selectedSnapshotId,
    selectedSnapshotTrust: plan.plan.snapshotTrust,
    driftSections: plan.plan.managedChanges.map((entry) => entry.section),
    repairRequired: needsRepair,
    approvalRequired: plan.plan.approvalRequired,
    unresolvedRequired: plan.plan.unresolvedRequired,
    externalCandidates: plan.plan.externalCandidates,
    preserveExternalRegistrationsDefault: options.preserveExternalRegistrations === true,
    protectedSectionCount: plan.plan.protectedSectionCount,
    snapshots,
    recoveryEntry: approval
      ? "Approve current Hook identities in Codex, start a fresh Task, then create a new snapshot."
      : needsRepair ? "Generate a repair preview, review protected/external sections, and confirm the one-time plan." : ""
  };
}

function withMutationLock(options, operation) {
  const file = pathsFor(options).lock;
  ensurePrivateDir(path.dirname(file));
  let fd;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(file, "wx", PRIVATE_FILE_MODE);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let lock = null;
      let stat = null;
      try { lock = readJson(file); stat = fs.statSync(file); } catch (_readError) { /* Re-evaluate below. */ }
      const ageMs = stat ? Date.now() - stat.mtimeMs : Number.POSITIVE_INFINITY;
      const pid = Number(lock?.pid || 0);
      let alive = false;
      if (pid > 1) {
        try { process.kill(pid, 0); alive = true; } catch (_pidError) { alive = false; }
      }
      const stale = !alive || ageMs > (options.lockStaleMs || 30 * 60 * 1000);
      if (!stale || attempt > 0) throw new ConfigIntegrityError("operation_in_progress", "Another RAVO config or upgrade mutation is in progress.", 409);
      try { fs.unlinkSync(file); } catch (_unlinkError) {
        throw new ConfigIntegrityError("operation_in_progress", "Another RAVO config or upgrade mutation is in progress.", 409);
      }
    }
  }
  if (fd === undefined) throw new ConfigIntegrityError("operation_in_progress", "Another RAVO config or upgrade mutation is in progress.", 409);
  try {
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, operation: options.lockOperation || "config_integrity_repair", startedAt: nowIso(options) })}\n`);
    fs.fsyncSync(fd);
    return operation();
  } finally {
    try { fs.closeSync(fd); } catch (_error) { /* Already closed. */ }
    try { fs.unlinkSync(file); } catch (_error) { /* Best effort after completion. */ }
  }
}

function createSnapshot(options = {}) {
  return withMutationLock({ ...options, lockOperation: "config_integrity_snapshot" }, () => createSnapshotUnlocked(options));
}

function atomicReplaceConfig(file, bytes, state, options = {}) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", PRIVATE_FILE_MODE);
  let renamed = false;
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    fs.chmodSync(tmp, PRIVATE_FILE_MODE);
    if (typeof options.beforeRename === "function") options.beforeRename({ tmp, file });
    fs.chmodSync(tmp, state.mode || PRIVATE_FILE_MODE);
    if (typeof process.getuid === "function" && (state.uid !== process.getuid() || state.gid !== process.getgid())) fs.chownSync(tmp, state.uid, state.gid);
    // Best-effort CAS for external writers; Node cannot make this hash check and rename one transaction.
    if (options.expectedHash && sha(fs.readFileSync(file)) !== options.expectedHash) {
      throw new ConfigIntegrityError("stale_plan", "Codex config.toml changed after the repair plan was confirmed.", 409);
    }
    fs.renameSync(tmp, file);
    renamed = true;
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_error) { /* Directory fsync is unavailable on some filesystems. */ }
    if (typeof options.afterRename === "function") options.afterRename({ file });
  } catch (error) {
    if (renamed) error.configReplaced = true;
    throw error;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch (_error) { /* Private temp cleanup is best effort. */ }
    }
  }
}

function writeRuntimeEpoch(reason, currentHash, options = {}) {
  const file = pathsFor(options).epoch;
  const previous = readJson(file) || {};
  const epoch = {
    schemaVersion: SCHEMA_VERSION,
    epochId: safeId("config-epoch", options),
    previousEpochId: previous.epochId || "",
    reason,
    currentHash,
    updatedAt: nowIso(options)
  };
  atomicJson(file, epoch);
  return { epochId: epoch.epochId, previousEpochId: epoch.previousEpochId, reason: epoch.reason, updatedAt: epoch.updatedAt };
}

function writeJournal(journal, options = {}) {
  if (!REPAIR_STATUSES.has(journal.status)) throw new ConfigIntegrityError("repair_status_invalid", "Repair journal status is invalid.", 500);
  const file = path.join(pathsFor(options).journals, `${journal.repairId}.json`);
  atomicJson(file, { ...journal, updatedAt: nowIso(options) });
  return file;
}

function defaultPluginCheck(options = {}) {
  if (typeof options.pluginCheck === "function") return options.pluginCheck();
  try {
    const value = JSON.parse(execFileSync(options.codexPath || "codex", ["plugin", "list", "--marketplace", "ravo", "--json"], {
      encoding: "utf8",
      timeout: options.commandTimeoutMs || 15000,
      maxBuffer: 8 * 1024 * 1024
    }));
    const installed = new Map((value.installed || []).map((entry) => [entry.name, entry]));
    const missing = RAVO_PLUGIN_NAMES.filter((name) => installed.get(name)?.installed !== true || installed.get(name)?.enabled !== true);
    return { status: missing.length ? "fail" : "pass", missing };
  } catch (_error) {
    return { status: "error", errorCode: "plugin_check_failed" };
  }
}

function applyRepair(confirmedPlan, options = {}) {
  if (!confirmedPlan?.planFingerprint) throw new ConfigIntegrityError("repair_plan_missing", "A confirmed repair plan is required.", 400);
  return withMutationLock(options, () => {
    const rebuilt = buildRepair({
      ...options,
      snapshotId: confirmedPlan.snapshotId,
      selectedExternalSections: confirmedPlan.selectedExternalSections,
      reenablePlugins: confirmedPlan.reenablePlugins
    });
    if (rebuilt.plan.planFingerprint !== confirmedPlan.planFingerprint || rebuilt.plan.currentHash !== confirmedPlan.currentHash) {
      throw new ConfigIntegrityError("stale_plan", "The Codex config, snapshot, plugin fingerprint, or repair selections changed after preview.", 409);
    }
    const files = pathsFor(options);
    const repairId = safeId("repair", options);
    const repairRoot = path.join(files.repairs, repairId);
    ensurePrivateDir(repairRoot);
    const backupPath = path.join(repairRoot, "pre-repair-config.toml");
    const backupMetadataPath = path.join(repairRoot, "pre-repair-metadata.json");
    writePrivate(backupPath, rebuilt.current.bytes);
    writePrivate(backupMetadataPath, Buffer.from(`${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      repairId,
      originalPath: rebuilt.current.path,
      hash: rebuilt.current.hash,
      size: rebuilt.current.size,
      mode: rebuilt.current.mode.toString(8).padStart(4, "0"),
      uid: rebuilt.current.uid,
      gid: rebuilt.current.gid,
      createdAt: nowIso(options)
    }, null, 2)}\n`));
    const journal = {
      schemaVersion: SCHEMA_VERSION,
      repairId,
      status: "planned",
      planFingerprint: rebuilt.plan.planFingerprint,
      currentHashBefore: rebuilt.current.hash,
      currentHashAfter: "",
      snapshotId: rebuilt.plan.snapshotId,
      managedChanges: rebuilt.plan.managedChanges,
      externalPreservedChanges: rebuilt.plan.externalPreservedChanges,
      conflicts: rebuilt.plan.conflicts,
      approvalRequired: rebuilt.plan.approvalRequired,
      unresolvedRequired: rebuilt.plan.unresolvedRequired,
      protectedChecks: rebuilt.plan.protectedSections.map((entry) => ({ section: entry.section, beforeHash: entry.beforeHash, preserved: entry.preserved })),
      backup: { path: backupPath, metadataPath: backupMetadataPath, hash: rebuilt.current.hash },
      pluginCheck: { status: "pending" },
      runtimeStatusAfter: { status: "pending" },
      mutationEpoch: null,
      runtimeProbeRequired: true,
      recoveryEntry: `Use POST /api/config-integrity/recover with repairId=${repairId}.`,
      createdAt: nowIso(options)
    };
    writeJournal(journal, options);
    let configMutated = false;
    try {
      journal.status = "applying";
      writeJournal(journal, options);
      validateTomlWithCodex(rebuilt.candidate, options);
      atomicReplaceConfig(rebuilt.current.path, Buffer.from(rebuilt.candidate), rebuilt.current, {
        ...options,
        expectedHash: rebuilt.current.hash
      });
      configMutated = true;
      const after = readConfigState(options);
      if (after.hash !== rebuilt.plan.candidateHash) throw new ConfigIntegrityError("repair_readback_mismatch", "Repair read-back hash did not match the planned candidate.", 500);
      const afterDocument = parseTomlDocument(after.text);
      const protectedFailures = rebuilt.plan.protectedSections.filter((entry) => {
        const readBack = entry.section === "<root>"
          ? afterDocument.preamble
          : afterDocument.byKey.get(tableKey(parseTablePath(entry.section)))?.text || "";
        return sha(readBack) !== entry.beforeHash;
      });
      if (protectedFailures.length) throw new ConfigIntegrityError("protected_section_readback_failed", "A protected section changed after repair.", 500, { sections: protectedFailures.map((entry) => entry.section) });
      journal.currentHashAfter = after.hash;
      journal.mutationEpoch = writeRuntimeEpoch("repair_apply", after.hash, options);
      journal.pluginCheck = defaultPluginCheck(options);
      const runtimeStatusAfter = typeof options.statusCheck === "function" ? options.statusCheck() : options.runtimeStatusAfter || {};
      journal.runtimeStatusAfter = {
        marketplaceStatus: runtimeStatusAfter.marketplaceStatus || "unknown",
        pluginStatus: runtimeStatusAfter.pluginStatus || "unknown",
        versionStatus: runtimeStatusAfter.versionStatus || "unknown",
        hookTrustEvidence: runtimeStatusAfter.hookTrustEvidence || "unknown",
        runtimeProbeStatus: runtimeStatusAfter.runtimeProbeStatus || "missing",
        runtimeHealth: runtimeStatusAfter.runtimeHealth || "configured_unverified"
      };
      const statusAligned = journal.runtimeStatusAfter.marketplaceStatus === "present"
        && journal.runtimeStatusAfter.pluginStatus === "healthy"
        && ["aligned", "unknown"].includes(journal.runtimeStatusAfter.versionStatus)
        && journal.runtimeStatusAfter.hookTrustEvidence === "recorded"
        && !["error", "missing"].includes(journal.runtimeStatusAfter.runtimeHealth)
        && journal.runtimeStatusAfter.runtimeProbeStatus !== "pass";
      if (!statusAligned) journal.runtimeStatusAfter.errorCode = journal.runtimeStatusAfter.runtimeProbeStatus === "pass"
        ? "runtime_probe_not_invalidated"
        : "runtime_status_not_aligned";
      journal.status = rebuilt.plan.approvalRequired.length
        || rebuilt.plan.unresolvedRequired.length
        || journal.pluginCheck.status !== "pass"
        || !statusAligned ? "partial" : "succeeded";
      writeJournal(journal, options);
      return {
        status: journal.status,
        repairId,
        currentHashBefore: journal.currentHashBefore,
        currentHashAfter: journal.currentHashAfter,
        managedChanges: journal.managedChanges,
        externalPreservedChanges: journal.externalPreservedChanges,
        conflicts: journal.conflicts,
        approvalRequired: journal.approvalRequired,
        unresolvedRequired: journal.unresolvedRequired,
        pluginCheck: journal.pluginCheck,
        runtimeStatus: journal.runtimeStatusAfter,
        mutationEpoch: journal.mutationEpoch,
        runtimeProbeRequired: true,
        journalPath: path.join(files.journals, `${repairId}.json`),
        recoveryEntry: journal.recoveryEntry
      };
    } catch (error) {
      configMutated = configMutated || error.configReplaced === true;
      journal.failure = { code: error.code || "repair_failed", message: "Repair did not complete; use errorCode and the recovery entry." };
      if (!configMutated) {
        journal.status = "failed";
        journal.recoveryEntry = error.code === "stale_plan"
          ? "The config changed before rename. Review the current file and create a new repair preview."
          : journal.recoveryEntry;
        writeJournal(journal, options);
        if (error instanceof ConfigIntegrityError) throw error;
        throw new ConfigIntegrityError("repair_failed", "Repair failed before config replacement; the current config was not overwritten.", 500, { repairId, journalPath: path.join(files.journals, `${repairId}.json`), recoveryEntry: journal.recoveryEntry });
      }
      try {
        const backupBytes = fs.readFileSync(backupPath);
        if (sha(backupBytes) !== rebuilt.current.hash) throw new ConfigIntegrityError("repair_backup_hash_mismatch", "The pre-repair backup failed its hash check.", 500);
        atomicReplaceConfig(rebuilt.current.path, backupBytes, rebuilt.current, {
          ...options,
          beforeRename: undefined,
          afterRename: undefined,
          expectedHash: rebuilt.plan.candidateHash
        });
        const rolledBack = readConfigState(options);
        if (rolledBack.hash !== rebuilt.current.hash) throw new ConfigIntegrityError("repair_rollback_readback_failed", "Rollback read-back did not match the pre-repair config.", 500);
        journal.status = "recovered";
        journal.currentHashAfter = rolledBack.hash;
        journal.mutationEpoch = writeRuntimeEpoch("repair_rollback", rolledBack.hash, options);
      } catch (rollbackError) {
        journal.status = "manual_recovery_required";
        journal.rollbackFailure = { code: rollbackError.code || "rollback_failed", message: "Automatic rollback did not complete; preserve the current file and use the verified backup recovery entry." };
      }
      writeJournal(journal, options);
      throw new ConfigIntegrityError(journal.status === "recovered" ? "repair_failed_recovered" : "manual_recovery_required", journal.status === "recovered" ? "Repair failed and the verified pre-repair config was restored." : "Repair and automatic rollback failed; manual recovery is required.", 500, { repairId, journalPath: path.join(files.journals, `${repairId}.json`), recoveryEntry: journal.recoveryEntry });
    }
  });
}

function listRepairJournals(options = {}) {
  const root = pathsFor(options).journals;
  let files = [];
  try { files = fs.readdirSync(root).filter((file) => file.endsWith(".json")).sort().reverse(); } catch (_error) { return []; }
  return files.map((file) => readJson(path.join(root, file))).filter(Boolean).map((journal) => ({
    repairId: journal.repairId,
    status: journal.status,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    currentHashBefore: journal.currentHashBefore,
    currentHashAfter: journal.currentHashAfter,
    managedChangeCount: journal.managedChanges?.length || 0,
    approvalRequiredCount: journal.approvalRequired?.length || 0,
    runtimeProbeRequired: journal.runtimeProbeRequired === true,
    recoveryEntry: journal.recoveryEntry
  }));
}

function recoverRepair(repairId, options = {}) {
  if (!/^[A-Za-z0-9-]+$/.test(String(repairId || ""))) throw new ConfigIntegrityError("repair_id_invalid", "Repair id is invalid.");
  return withMutationLock(options, () => {
    const files = pathsFor(options);
    const journalFile = path.join(files.journals, `${repairId}.json`);
    const journal = readJson(journalFile);
    if (!journal || journal.repairId !== repairId) throw new ConfigIntegrityError("repair_journal_not_found", "Repair journal was not found.", 404);
    const metadata = readJson(journal.backup?.metadataPath || "");
    const backupPath = journal.backup?.path || "";
    if (!metadata || metadata.repairId !== repairId || metadata.originalPath !== files.config || !fs.existsSync(backupPath)) throw new ConfigIntegrityError("repair_backup_scope_mismatch", "Repair backup does not match the fixed Codex config target.", 409);
    const backupBytes = fs.readFileSync(backupPath);
    if (sha(backupBytes) !== metadata.hash || metadata.hash !== journal.currentHashBefore) throw new ConfigIntegrityError("repair_backup_hash_mismatch", "Repair backup failed its hash check.", 409);
    const current = readConfigState(options);
    if (!journal.currentHashAfter || current.hash !== journal.currentHashAfter) {
      throw new ConfigIntegrityError("stale_recovery", "Codex config.toml changed after this repair; create a new preview instead of overwriting newer changes.", 409);
    }
    const recoveryRoot = path.join(files.repairs, repairId);
    const currentBackupPath = path.join(recoveryRoot, `pre-explicit-recovery-${Date.now()}.toml`);
    writePrivate(currentBackupPath, current.bytes);
    atomicReplaceConfig(files.config, backupBytes, { ...current, mode: Number.parseInt(metadata.mode, 8), uid: metadata.uid, gid: metadata.gid }, { ...options, expectedHash: current.hash });
    const after = readConfigState(options);
    if (after.hash !== metadata.hash) throw new ConfigIntegrityError("explicit_recovery_readback_failed", "Explicit recovery read-back failed.", 500);
    journal.status = "recovered";
    journal.currentHashAfter = after.hash;
    journal.explicitRecoveryAt = nowIso(options);
    journal.explicitRecoveryBackup = { path: currentBackupPath, hash: current.hash };
    journal.mutationEpoch = writeRuntimeEpoch("explicit_recovery", after.hash, options);
    writeJournal(journal, options);
    return {
      status: "recovered",
      repairId,
      currentHash: after.hash,
      preRecoveryBackupPath: currentBackupPath,
      mutationEpoch: journal.mutationEpoch,
      runtimeProbeRequired: true,
      recoveryEntry: "Run plugin/status checks and a fresh Codex Task before trusting Runtime health."
    };
  });
}

function main() {
  if (process.argv.includes("--version")) { process.stdout.write(`${PRODUCT_VERSION}\n`); return; }
  process.stdout.write("Use this module through RAVO Core or SoloDesk config-integrity APIs.\n");
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || "config_integrity_error", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ConfigIntegrityError,
  RAVO_PLUGIN_NAMES,
  applyRepair,
  buildRepair,
  createSnapshot,
  displayTable,
  getIntegrityStatus,
  isExternalRegistration,
  isRavoManaged,
  listRepairJournals,
  listSnapshots,
  loadSnapshot,
  makePrivateTempDir,
  parseTablePath,
  parseTomlDocument,
  pathsFor,
  previewRepair,
  recoverRepair,
  sha,
  tableKey,
  validateTomlWithCodex
};
