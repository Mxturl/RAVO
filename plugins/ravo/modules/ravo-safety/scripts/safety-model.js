"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { evaluateAuthorization } = require("../../ravo-workstream/scripts/workstream-model");
const { compileNative, runNative } = require("./safety-native");

const SCOPE = "ravo-v0.5.8-data-safety";
const DATA_BOUNDARY = "local_only";
const SUPPORTED_ACTIONS = new Set(["truncate_file", "truncate_directory_files", "git_restore_file"]);
const KNOWN_UNSUPPORTED_ACTIONS = new Set([
  "delete", "move", "rename", "chmod", "git_clean", "git_reset_hard", "worktree_remove", "git_restore", "recursive_delete"
]);
const NOT_COVERED_ACTIONS = new Set(["direct_shell", "shell_command", "node_fs", "python_sdk", "third_party_sdk", "mcp_mutation"]);
const NOT_COVERED_PATHS = [
  "direct_shell",
  "unintegrated_node_python_or_sdk",
  "other_plugins_or_mcp",
  "remote_git_network_cloud_database",
  "credential_helpers",
  "same_trust_domain_tampering"
];

class SafetyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) ;
}

function fingerprint(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function typeFor(stat) {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  return "special";
}

function hashFile(file) {
  const descriptor = fs.openSync(file, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function identityFor(file, includeHash = true) {
  const stat = fs.lstatSync(file, { bigint: true });
  const type = typeFor(stat);
  const identity = {
    type,
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    nlink: stat.nlink.toString(),
    size: stat.size.toString(),
    mode: stat.mode.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    mtimeNs: stat.mtimeNs.toString()
  };
  if (type === "file" && includeHash) identity.sha256 = hashFile(file);
  return identity;
}

function sameIdentity(expected, actual) {
  if (!expected || !actual) return false;
  for (const key of ["type", "dev", "ino", "nlink", "size", "mode", "uid", "gid", "sha256"]) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) return false;
  }
  return true;
}

function safeRelative(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value)) return false;
  const parts = value.split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== "..");
}

function safeSnapshotName(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(value);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function errorResult(error) {
  if (error instanceof SafetyError) return coverageResult(error.status, error.message);
  return coverageResult("native_error", "Safety Executor 遇到未分类错误；未执行受控 mutation。", { error: error.message });
}

function coverageResult(status, reason, details = {}) {
  return {
    status,
    reason,
    guarantee: "ravo_guarded",
    notCovered: NOT_COVERED_PATHS,
    ...details
  };
}

function rootFor(request) {
  if (typeof request?.authorizedRoot !== "string" || !path.isAbsolute(request.authorizedRoot)) {
    throw new SafetyError("invalid_request", "authorizedRoot 必须是绝对路径。");
  }
  let physicalPath;
  try {
    physicalPath = fs.realpathSync.native(request.authorizedRoot);
  } catch (_error) {
    throw new SafetyError("target_missing", "授权根不存在。");
  }
  const identity = identityFor(physicalPath, false);
  if (identity.type !== "directory") throw new SafetyError("not_supported", "授权根必须是普通目录。");
  return { physicalPath, identity };
}

function quarantineFor(request, root) {
  const value = request?.recovery?.quarantineDir;
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new SafetyError("blocked", "受支持操作需要明确的绝对 quarantineDir。");
  }
  let physicalPath;
  try {
    physicalPath = fs.realpathSync.native(value);
  } catch (_error) {
    throw new SafetyError("blocked", "quarantineDir 不存在或不可解析。");
  }
  const identity = identityFor(physicalPath, false);
  if (identity.type !== "directory") throw new SafetyError("blocked", "quarantineDir 必须是普通目录。");
  if (identity.dev !== root.identity.dev) throw new SafetyError("blocked", "首版只支持与授权根同卷的 quarantineDir。");
  if (inside(root.physicalPath, physicalPath) || inside(physicalPath, root.physicalPath)) {
    throw new SafetyError("blocked", "首版 quarantineDir 必须与授权根相互独立，不能嵌套。");
  }
  return { physicalPath, identity };
}

function ancestorChain(root, relative, phase) {
  const parts = relative.split("/");
  const chain = [];
  let current = root.physicalPath;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    let identity;
    try {
      identity = identityFor(current, false);
    } catch (_error) {
      throw new SafetyError("target_missing", "目标祖先目录不存在。");
    }
    if (identity.type === "symlink" || identity.type !== "directory") {
      throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "目标祖先目录不是安全的普通目录。");
    }
    if (identity.dev !== root.identity.dev) {
      throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "目标祖先目录跨越了授权根设备。");
    }
    chain.push({ logicalPath: parts.slice(0, index + 1).join("/"), identity });
  }
  return chain;
}

function inspectFile(root, relative, phase = "preview") {
  if (!safeRelative(relative)) throw new SafetyError("invalid_request", "目标必须是无 NUL 的授权根内相对路径。");
  const absolutePath = path.resolve(root.physicalPath, relative);
  if (!inside(root.physicalPath, absolutePath)) throw new SafetyError("target_drift", "目标逃出授权根。");
  const chain = ancestorChain(root, relative, phase);
  let identity;
  try {
    identity = identityFor(absolutePath, true);
  } catch (_error) {
    throw new SafetyError("target_missing", "目标不存在。");
  }
  if (identity.type === "symlink" || identity.type !== "file") {
    throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "首版只支持普通文件，拒绝符号链接和特殊文件。");
  }
  if (identity.dev !== root.identity.dev) {
    throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "目标跨越了授权根设备。");
  }
  if (identity.nlink !== "1") {
    throw new SafetyError("not_supported", "无法证明唯一 hardlink 的文件不可写入或截断。");
  }
  return { logicalPath: relative, absolutePath, targetIdentity: identity, ancestorChain: chain };
}

function inspectDirectory(root, relative, phase = "preview") {
  if (!safeRelative(relative)) throw new SafetyError("invalid_request", "目录必须是无 NUL 的授权根内相对路径。");
  const absolutePath = path.resolve(root.physicalPath, relative);
  if (!inside(root.physicalPath, absolutePath)) throw new SafetyError("target_drift", "目录逃出授权根。");
  const chain = ancestorChain(root, `${relative}/placeholder`, phase);
  let identity;
  try {
    identity = identityFor(absolutePath, false);
  } catch (_error) {
    throw new SafetyError("target_missing", "目标目录不存在。");
  }
  if (identity.type === "symlink" || identity.type !== "directory" || identity.dev !== root.identity.dev) {
    throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "目录不是授权根内的普通目录。");
  }
  return { logicalPath: relative, absolutePath, identity, ancestorChain: chain };
}

function runGit(root, args, options = {}) {
  const environment = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null"
  };
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: null,
    input: options.input,
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
    env: environment
  });
  return {
    status: result.status ?? 1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ""),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || "")
  };
}

function gitText(root, args) {
  const result = runGit(root, args);
  return result.status === 0 ? result.stdout.toString("utf8").trim() : "";
}

function resolveGitPath(base, value) {
  if (!value) return "";
  const candidate = path.isAbsolute(value) ? value : path.resolve(base, value);
  try { return fs.realpathSync.native(candidate); } catch (_error) { return candidate; }
}

function gitIdentityFor(root, items = []) {
  const top = gitText(root.physicalPath, ["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  const worktreeRoot = resolveGitPath(root.physicalPath, top);
  const gitDir = resolveGitPath(worktreeRoot, gitText(root.physicalPath, ["rev-parse", "--git-dir"]));
  const commonDir = resolveGitPath(worktreeRoot, gitText(root.physicalPath, ["rev-parse", "--git-common-dir"]));
  const headCommit = gitText(root.physicalPath, ["rev-parse", "HEAD"]);
  if (!headCommit) return null;
  const headRef = gitText(root.physicalPath, ["symbolic-ref", "-q", "HEAD"]) || "DETACHED";
  const status = runGit(root.physicalPath, ["status", "--porcelain=v2", "-z", "--ignored"]);
  const index = runGit(root.physicalPath, ["ls-files", "-s", "-z"]);
  if (status.status !== 0 || index.status !== 0) throw new SafetyError("target_drift", "Git 身份无法读取。");
  const classifications = {};
  for (const item of items) {
    const gitRelative = path.relative(worktreeRoot, item.absolutePath).split(path.sep).join("/");
    if (!safeRelative(gitRelative)) throw new SafetyError("not_supported", "目标不在 Git Worktree 内。");
    const tracked = runGit(root.physicalPath, ["ls-files", "--error-unmatch", "--", gitRelative]);
    if (tracked.status === 0) classifications[item.logicalPath] = { classification: "tracked", gitRelative };
    else {
      const ignored = runGit(root.physicalPath, ["check-ignore", "-q", "--", gitRelative]);
      classifications[item.logicalPath] = { classification: ignored.status === 0 ? "ignored" : "untracked", gitRelative };
    }
  }
  return {
    worktreeRoot,
    gitDir,
    commonDir,
    headCommit,
    headRef,
    statusHash: sha256(status.stdout),
    indexHash: sha256(index.stdout),
    sparseCheckout: gitText(root.physicalPath, ["config", "--bool", "core.sparseCheckout"]) === "true",
    classifications
  };
}

function sameGitIdentity(expected, actual) {
  return JSON.stringify(canonical(expected)) === JSON.stringify(canonical(actual));
}

function normalizeBudgets(request, items) {
  const raw = request?.budgets || {};
  const sumBytes = items.reduce((total, item) => {
    const current = BigInt(item.targetIdentity.size);
    const incoming = BigInt(item.gitSource?.size || "0");
    return total + (incoming > current ? incoming : current);
  }, 0n);
  const maxItems = Number.isInteger(raw.maxItems) ? raw.maxItems : items.length;
  const maxBytes = raw.maxBytes === undefined ? sumBytes.toString() : String(raw.maxBytes);
  const maxDepth = Number.isInteger(raw.maxDepth) ? raw.maxDepth : Math.max(...items.map((item) => item.logicalPath.split("/").length));
  const allowedTypes = Array.isArray(raw.allowedTypes) && raw.allowedTypes.length ? [...new Set(raw.allowedTypes)] : ["file"];
  const budgets = {
    maxRoots: Number.isInteger(raw.maxRoots) ? raw.maxRoots : 1,
    maxItems,
    maxBytes,
    maxDepth,
    maxUntracked: Number.isInteger(raw.maxUntracked) ? raw.maxUntracked : items.length,
    maxIgnored: Number.isInteger(raw.maxIgnored) ? raw.maxIgnored : items.length,
    allowedTypes,
    allowCrossDevice: raw.allowCrossDevice === true
  };
  if (budgets.maxRoots < 1 || budgets.maxItems < 1 || BigInt(budgets.maxBytes) < 0n || budgets.maxDepth < 1 || !budgets.allowedTypes.includes("file")) {
    throw new SafetyError("invalid_request", "破坏半径预算必须允许受支持普通文件且数值非负。");
  }
  return budgets;
}

function enforceBudgets(items, budgets) {
  const byteCount = items.reduce((total, item) => {
    const current = BigInt(item.targetIdentity.size);
    const incoming = BigInt(item.gitSource?.size || "0");
    return total + (incoming > current ? incoming : current);
  }, 0n);
  if (items.length > budgets.maxItems || byteCount > BigInt(budgets.maxBytes)) {
    throw new SafetyError("safety_violation", "preview affected set 超出条目或字节预算。");
  }
  if (items.some((item) => item.logicalPath.split("/").length > budgets.maxDepth)) {
    throw new SafetyError("safety_violation", "preview affected set 超出目录深度预算。");
  }
  const untracked = items.filter((item) => item.classification === "untracked").length;
  const ignored = items.filter((item) => item.classification === "ignored").length;
  if (untracked > budgets.maxUntracked || ignored > budgets.maxIgnored) {
    throw new SafetyError("safety_violation", "preview affected set 超出 untracked 或 ignored 预算。");
  }
  return { itemCount: items.length, byteCount: byteCount.toString(), untracked, ignored };
}

function enumerateDirectory(root, directory, phase) {
  const collection = inspectDirectory(root, directory, phase);
  let entries;
  try {
    entries = fs.readdirSync(collection.absolutePath, { withFileTypes: true });
  } catch (_error) {
    throw new SafetyError("target_drift", "无法重新枚举受控目录。");
  }
  if (!entries.length) throw new SafetyError("target_missing", "受控目录没有可操作的普通文件。");
  const items = entries.sort((left, right) => left.name.localeCompare(right.name)).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new SafetyError(phase === "preview" ? "not_supported" : "target_drift", "目录批量操作只支持直接子级普通文件。");
    }
    return inspectFile(root, `${directory}/${entry.name}`, phase);
  });
  return {
    collection: {
      logicalPath: directory,
      identity: collection.identity,
      ancestorChain: collection.ancestorChain,
      entryFingerprint: fingerprint(items.map((item) => ({ logicalPath: item.logicalPath, targetIdentity: item.targetIdentity })))
    },
    items
  };
}

function actionClassification(request) {
  const action = request?.action;
  if (typeof action !== "string" || !action) return coverageResult("invalid_request", "action 必须是受支持的语义 action，不能是 shell 字符串。");
  if (NOT_COVERED_ACTIONS.has(action) || request?.command) {
    return coverageResult("not_covered", "direct shell 或未接入执行路径不受 Safety Executor 覆盖。");
  }
  if (KNOWN_UNSUPPORTED_ACTIONS.has(action)) {
    return coverageResult("not_supported", "该破坏性语义已分类，但首版没有可证明安全的执行原语。");
  }
  if (!SUPPORTED_ACTIONS.has(action)) return coverageResult("not_supported", "未知或未受支持的语义 action 被拒绝。");
  return null;
}

function gitBlobForIdentity(gitIdentity, gitRelative) {
  const result = runGit(gitIdentity.worktreeRoot, ["show", "--no-ext-diff", "--format=", `${gitIdentity.headCommit}:${gitRelative}`]);
  if (result.status !== 0) throw new SafetyError("target_drift", "Git object 在 preview 或 execute 时不可读取。");
  return result.stdout;
}

function planPayload(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    action: plan.action,
    scope: plan.scope,
    dataBoundary: plan.dataBoundary,
    authorizedRoot: plan.authorizedRoot,
    rootIdentity: plan.rootIdentity,
    quarantine: plan.quarantine,
    affectedSet: plan.affectedSet,
    collection: plan.collection,
    budgets: plan.budgets,
    previewStats: plan.previewStats,
    gitIdentity: plan.gitIdentity,
    guarantee: plan.guarantee,
    notCovered: plan.notCovered
  };
}

function verifyPlanIntegrity(plan) {
  return plan && plan.planFingerprint === fingerprint(planPayload(plan));
}

function preview(request = {}) {
  const classified = actionClassification(request);
  if (classified) return classified;
  try {
    const root = rootFor(request);
    const quarantine = quarantineFor(request, root);
    const planId = `safety-${crypto.randomUUID()}`;
    let discovered;
    let collection = null;
    if (request.action === "truncate_directory_files") {
      if (!safeRelative(request.targetDirectory)) throw new SafetyError("invalid_request", "truncate_directory_files 需要 targetDirectory。");
      discovered = enumerateDirectory(root, request.targetDirectory, "preview");
      collection = discovered.collection;
    } else {
      const targets = Array.isArray(request.targets) ? request.targets : (request.target ? [request.target] : []);
      if (targets.length !== 1 || !safeRelative(targets[0])) throw new SafetyError("invalid_request", "首版单文件 action 需要恰好一个 target。");
      discovered = { items: [inspectFile(root, targets[0], "preview")] };
    }
    const gitIdentity = gitIdentityFor(root, discovered.items);
    const items = discovered.items.map((item, index) => {
      const git = gitIdentity?.classifications?.[item.logicalPath];
      return {
        id: `item-${String(index + 1).padStart(4, "0")}`,
        logicalPath: item.logicalPath,
        targetIdentity: item.targetIdentity,
        ancestorChain: item.ancestorChain,
        classification: git?.classification || "unknown",
        gitRelative: git?.gitRelative || "",
        recovery: { kind: "quarantine", snapshotName: `${planId}-${String(index + 1).padStart(4, "0")}.snapshot` }
      };
    });
    if (request.action === "git_restore_file" && (!gitIdentity || items[0].classification !== "tracked")) {
      throw new SafetyError("not_supported", "git_restore_file 只支持已验证 Worktree 中的单个 tracked 普通文件。");
    }
    if (request.action === "git_restore_file") {
      const blob = gitBlobForIdentity(gitIdentity, items[0].gitRelative);
      items[0].gitSource = {
        ref: gitIdentity.headCommit,
        size: String(blob.length),
        sha256: sha256(blob)
      };
    }
    const budgets = normalizeBudgets(request, items);
    const previewStats = enforceBudgets(items, budgets);
    const plan = {
      schemaVersion: "0.5.8",
      kind: "mutation",
      planId,
      action: request.action,
      scope: request.scope || SCOPE,
      dataBoundary: request.dataBoundary || DATA_BOUNDARY,
      account: request.account || "local",
      authorizedRoot: root.physicalPath,
      rootIdentity: root.identity,
      quarantine,
      affectedSet: items,
      collection,
      budgets,
      previewStats,
      gitIdentity,
      createdAt: new Date().toISOString(),
      expiresAt: request.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      guarantee: "ravo_guarded",
      notCovered: NOT_COVERED_PATHS
    };
    plan.planFingerprint = fingerprint(planPayload(plan));
    return coverageResult("preview", "已生成不可变 SafetyPlan；执行前仍需独立确认。", { plan });
  } catch (error) {
    return errorResult(error);
  }
}

function authorizationRequestFor(plan) {
  const target = plan.collection ? `directory:${plan.collection.logicalPath}` : plan.affectedSet.map((item) => item.logicalPath).join(",");
  return {
    action: plan.action,
    target,
    account: plan.account,
    scope: plan.scope,
    dataBoundary: plan.dataBoundary,
    planFingerprint: plan.planFingerprint
  };
}

function confirmPlan(plan, envelope, now = new Date().toISOString()) {
  if (!verifyPlanIntegrity(plan)) return coverageResult("safety_violation", "SafetyPlan 指纹不匹配，拒绝确认。");
  if (!plan.expiresAt || Date.parse(now) > Date.parse(plan.expiresAt)) return coverageResult("expired", "SafetyPlan 已过期，必须重新 preview。");
  if (!envelope?.confirmedBy || !envelope?.sourceRef) return coverageResult("missing_authorization", "执行需要外部签发的确认来源和 sourceRef。");
  const authorization = evaluateAuthorization(envelope, authorizationRequestFor(plan), now);
  if (!authorization.valid) return coverageResult(authorization.reason, "Authorization Envelope 未绑定当前 SafetyPlan。", { authorization });
  return coverageResult("confirmed", "SafetyPlan 已由外部 Authorization Envelope 绑定。", {
    confirmedPlan: {
      plan: clone(plan),
      authorizationEnvelope: clone(envelope),
      confirmation: { envelopeId: authorization.envelopeId, confirmedAt: now }
    }
  });
}

function currentGitIdentity(plan, root, items) {
  if (!plan.gitIdentity) return null;
  const actual = gitIdentityFor(root, items.map((item) => ({ logicalPath: item.logicalPath, absolutePath: path.join(root.physicalPath, item.logicalPath) })));
  if (!actual || !sameGitIdentity(plan.gitIdentity, actual)) throw new SafetyError("target_drift", "Git 或 Worktree 身份在 preview 后发生漂移。");
  return actual;
}

function revalidateCollection(plan, root) {
  if (!plan.collection) return null;
  const current = enumerateDirectory(root, plan.collection.logicalPath, "execute");
  if (!sameIdentity(plan.collection.identity, current.collection.identity) || plan.collection.entryFingerprint !== current.collection.entryFingerprint) {
    throw new SafetyError("safety_violation", "execute 前 affected set 与冻结计划不一致。");
  }
  return current.collection;
}

function revalidatePlan(plan) {
  if (!verifyPlanIntegrity(plan)) throw new SafetyError("safety_violation", "SafetyPlan 在执行前被改写。");
  const rootRequest = { authorizedRoot: plan.authorizedRoot };
  const root = rootFor(rootRequest);
  if (!sameIdentity(plan.rootIdentity, root.identity) || root.physicalPath !== plan.authorizedRoot) {
    throw new SafetyError("target_drift", "授权根身份在 preview 后发生漂移。");
  }
  const quarantine = quarantineFor({ recovery: { quarantineDir: plan.quarantine.physicalPath } }, root);
  if (!sameIdentity(plan.quarantine.identity, quarantine.identity) || quarantine.physicalPath !== plan.quarantine.physicalPath) {
    throw new SafetyError("recovery_failed", "quarantine 身份在执行前发生漂移。");
  }
  revalidateCollection(plan, root);
  const actualItems = [];
  for (const item of plan.affectedSet) {
    const actual = inspectFile(root, item.logicalPath, "execute");
    if (!sameIdentity(item.targetIdentity, actual.targetIdentity) || JSON.stringify(canonical(item.ancestorChain)) !== JSON.stringify(canonical(actual.ancestorChain))) {
      throw new SafetyError("target_drift", "目标对象或祖先链在 preview 后发生漂移。");
    }
    if (plan.kind === "restore") {
      const sourcePath = path.join(quarantine.physicalPath, item.recovery.sourceName);
      if (!safeSnapshotName(item.recovery.sourceName) || !inside(quarantine.physicalPath, sourcePath)) {
        throw new SafetyError("recovery_failed", "恢复源路径无效。");
      }
      let sourceIdentity;
      try { sourceIdentity = identityFor(sourcePath, true); } catch (_error) { throw new SafetyError("recovery_failed", "恢复源不存在。"); }
      if (!sameIdentity(item.recovery.sourceIdentity, sourceIdentity)) throw new SafetyError("recovery_failed", "恢复源身份在执行前发生漂移。");
    }
    actualItems.push(actual);
  }
  if (plan.kind === "restore") {
    const restoreBytes = plan.affectedSet.reduce((total, item) => total + BigInt(item.recovery.sourceIdentity.size), 0n);
    if (restoreBytes > BigInt(plan.budgets.maxBytes)) {
      throw new SafetyError("safety_violation", "恢复源字节数超出冻结恢复预算。");
    }
  }
  const git = currentGitIdentity(plan, root, actualItems);
  return { root, quarantine, git };
}

function ledgerPathFor(plan, quarantinePath) {
  const directory = path.join(quarantinePath, ".ravo-safety-executions");
  const name = `${crypto.createHash("sha256").update(plan.planFingerprint).digest("hex")}.json`;
  return { directory, file: path.join(directory, name) };
}

function hasExecutionLedger(plan) {
  const quarantinePath = plan?.quarantine?.physicalPath;
  if (typeof quarantinePath !== "string" || !path.isAbsolute(quarantinePath)) return false;
  return fs.existsSync(ledgerPathFor(plan, quarantinePath).file);
}

function executionLedger(plan, quarantine) {
  const { directory, file } = ledgerPathFor(plan, quarantine.physicalPath);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryIdentity = identityFor(directory, false);
    if (directoryIdentity.type !== "directory") throw new Error("ledger is not a directory");
    const descriptor = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ planFingerprint: plan.planFingerprint, claimedAt: new Date().toISOString() }));
    } finally {
      fs.closeSync(descriptor);
    }
    return { allowed: true, ref: path.relative(quarantine.physicalPath, file) };
  } catch (error) {
    if (error.code === "EEXIST") return { allowed: false, status: "retry_denied", reason: "同一计划指纹已经执行或尝试，禁止自动重试。" };
    return { allowed: false, status: "blocked", reason: "无法建立执行去重记录。", details: error.message };
  }
}

function nativeIdentity(value) {
  return {
    type: "file",
    dev: String(value.dev),
    ino: String(value.ino),
    nlink: "1",
    size: String(value.size),
    mode: String(value.mode),
    uid: String(value.uid),
    gid: String(value.gid),
    sha256: `sha256:${value.sha256}`
  };
}

function gitBlob(plan, item) {
  const blob = gitBlobForIdentity(plan.gitIdentity, item.gitRelative);
  if (!item.gitSource || item.gitSource.ref !== plan.gitIdentity.headCommit || item.gitSource.size !== String(blob.length) || item.gitSource.sha256 !== sha256(blob)) {
    throw new SafetyError("target_drift", "Git 恢复对象在 preview 后发生漂移。");
  }
  if (BigInt(blob.length) > BigInt(plan.budgets.maxBytes)) throw new SafetyError("safety_violation", "Git 恢复内容超出冻结字节预算。");
  return blob;
}

function runMutationItem(plan, item, root, quarantine, input = undefined) {
  const options = {
    root: root.physicalPath,
    relative: item.logicalPath,
    quarantine: quarantine.physicalPath,
    snapshotName: item.recovery.snapshotName,
    rootIdentity: root.identity,
    targetIdentity: item.targetIdentity,
    quarantineIdentity: quarantine.identity
  };
  if (plan.action === "git_restore_file") return runNative("replace", options, input);
  return runNative("truncate", options);
}

function mutationInputs(plan) {
  if (plan.action !== "git_restore_file") return new Map();
  return new Map(plan.affectedSet.map((item) => [item.id, gitBlob(plan, item)]));
}

function reconcile(plan, receipt) {
  const planned = plan.affectedSet.map((item) => item.id).sort();
  const attempted = receipt.items.filter((item) => item.attempted).map((item) => item.id).sort();
  const completed = receipt.items.filter((item) => item.result === "succeeded" || item.result === "failed").map((item) => item.id).sort();
  const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  if (!equal(planned, attempted) || !equal(planned, completed)) {
    return { status: "safety_violation", reason: "planned、attempted 与完成结果集合不一致。", planned, attempted, completed };
  }
  if (receipt.items.some((item) => item.result !== "succeeded")) {
    return { status: "safety_violation", reason: "存在失败 mutation，禁止自动重试或扩大计划。", planned, attempted, completed };
  }
  return { status: "ok", planned, attempted, completed };
}

function execute(confirmed, now = new Date().toISOString()) {
  const plan = confirmed?.plan;
  if (!plan || !confirmed?.authorizationEnvelope) return coverageResult("missing_authorization", "execute 需要经确认的 SafetyPlan。");
  if (!verifyPlanIntegrity(plan)) return coverageResult("safety_violation", "SafetyPlan 指纹不匹配，拒绝 execute。");
  if (!plan.expiresAt || Date.parse(now) > Date.parse(plan.expiresAt)) return coverageResult("expired", "SafetyPlan 已过期，必须重新 preview。");
  const authorization = evaluateAuthorization(confirmed.authorizationEnvelope, authorizationRequestFor(plan), now);
  if (!authorization.valid) return coverageResult(authorization.reason, "Authorization Envelope 在 execute 前不再匹配计划。", { authorization });
  if (hasExecutionLedger(plan)) return coverageResult("retry_denied", "同一计划指纹已经执行或尝试，禁止自动重试。");
  let validated;
  try {
    validated = revalidatePlan(plan);
  } catch (error) {
    const result = errorResult(error);
    result.receipt = {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      status: result.status,
      attemptedSet: [],
      actualAffectedSet: [],
      items: [],
      reconciliation: { status: "not_run", reason: "首个 mutation 前复核失败。" }
    };
    return result;
  }
  let inputs;
  try {
    inputs = mutationInputs(plan);
  } catch (error) {
    const result = errorResult(error);
    result.receipt = {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      status: result.status,
      attemptedSet: [],
      actualAffectedSet: [],
      items: [],
      reconciliation: { status: "not_run", reason: "首个 mutation 前的 Git 对象复核失败。" }
    };
    return result;
  }
  const ledger = executionLedger(plan, validated.quarantine);
  if (!ledger.allowed) return coverageResult(ledger.status, ledger.reason, { details: ledger.details });
  const receipt = {
    schemaVersion: "0.5.8",
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    action: plan.action,
    guarantee: "ravo_guarded",
    attemptedSet: [],
    actualAffectedSet: [],
    items: [],
    executionLedgerRef: ledger.ref,
    startedAt: new Date().toISOString()
  };
  for (const item of plan.affectedSet) {
    const output = runMutationItem(plan, item, validated.root, validated.quarantine, inputs.get(item.id));
    if (output.status !== "ok") {
      receipt.items.push({
        id: item.id,
        attempted: true,
        result: "failed",
        code: output.status,
        error: output.message || output.reason || "native mutation failed",
        ...(output.snapshot ? { recovery: { kind: "quarantine", snapshotName: output.snapshot.name, sourceIdentity: nativeIdentity(output.snapshot) } } : {})
      });
      receipt.attemptedSet.push(item.id);
      break;
    }
    const actualIdentity = nativeIdentity(output.after);
    const snapshotIdentity = nativeIdentity(output.snapshot);
    receipt.items.push({
      id: item.id,
      attempted: true,
      result: "succeeded",
      actualIdentity,
      recovery: { kind: "quarantine", snapshotName: output.snapshot.name, sourceIdentity: snapshotIdentity }
    });
    receipt.attemptedSet.push(item.id);
    receipt.actualAffectedSet.push(item.id);
  }
  receipt.completedAt = new Date().toISOString();
  try {
    receipt.afterGitIdentity = plan.gitIdentity ? gitIdentityFor(validated.root, plan.affectedSet.map((item) => ({ logicalPath: item.logicalPath, absolutePath: path.join(validated.root.physicalPath, item.logicalPath) }))) : null;
    receipt.reconciliation = reconcile(plan, receipt);
  } catch (error) {
    receipt.afterGitIdentity = null;
    receipt.reconciliation = { status: "safety_violation", reason: error instanceof SafetyError ? error.message : "执行后 Git 身份无法记录。" };
  }
  receipt.status = receipt.reconciliation.status === "ok" ? "executed" : "safety_violation";
  return coverageResult(receipt.status, receipt.status === "executed" ? "受控 mutation 已完成并与冻结计划核对。" : receipt.reconciliation.reason, { receipt, plan: clone(plan) });
}

function previewRestore(execution) {
  const plan = execution?.plan;
  const receipt = execution?.receipt;
  if (!plan || !receipt || receipt.status !== "executed") return coverageResult("invalid_request", "恢复 drill 需要一份成功且已核对的 Mutation Receipt。");
  try {
    const root = rootFor({ authorizedRoot: plan.authorizedRoot });
    const quarantine = quarantineFor({ recovery: { quarantineDir: plan.quarantine.physicalPath } }, root);
    const planId = `restore-${crypto.randomUUID()}`;
    const priorById = new Map(plan.affectedSet.map((item) => [item.id, item]));
    const restoredItems = receipt.items.map((entry, index) => {
      const prior = priorById.get(entry.id);
      if (!prior || entry.result !== "succeeded" || !entry.recovery?.snapshotName) throw new SafetyError("invalid_request", "Mutation Receipt 缺少可恢复计划项。");
      const current = inspectFile(root, prior.logicalPath, "preview");
      if (!sameIdentity(entry.actualIdentity, current.targetIdentity)) throw new SafetyError("target_drift", "恢复前目标已被后续修改，默认拒绝覆盖。");
      const sourcePath = path.join(quarantine.physicalPath, entry.recovery.snapshotName);
      if (!safeSnapshotName(entry.recovery.snapshotName) || !inside(quarantine.physicalPath, sourcePath)) throw new SafetyError("recovery_failed", "quarantine 恢复引用无效。");
      const sourceIdentity = identityFor(sourcePath, true);
      if (!sameIdentity(entry.recovery.sourceIdentity, sourceIdentity)) throw new SafetyError("recovery_failed", "quarantine 恢复对象已漂移。");
      return {
        id: `restore-${String(index + 1).padStart(4, "0")}`,
        logicalPath: prior.logicalPath,
        targetIdentity: current.targetIdentity,
        ancestorChain: current.ancestorChain,
        classification: prior.classification,
        gitRelative: prior.gitRelative,
        recovery: {
          kind: "quarantine",
          sourceName: entry.recovery.snapshotName,
          sourceIdentity,
          snapshotName: `${planId}-${String(index + 1).padStart(4, "0")}.backup`,
          backupName: `${planId}-${String(index + 1).padStart(4, "0")}.backup`
        }
      };
    });
    const restoreByteCount = restoredItems.reduce((total, item) => total + BigInt(item.recovery.sourceIdentity.size), 0n);
    const restoreMaxBytes = BigInt(plan.budgets.maxBytes) > restoreByteCount ? BigInt(plan.budgets.maxBytes) : restoreByteCount;
    const restorePlan = {
      schemaVersion: "0.5.8",
      kind: "restore",
      planId,
      action: "restore_file",
      scope: plan.scope,
      dataBoundary: plan.dataBoundary,
      account: plan.account,
      authorizedRoot: root.physicalPath,
      rootIdentity: root.identity,
      quarantine,
      affectedSet: restoredItems,
      collection: null,
      budgets: { ...plan.budgets, maxItems: restoredItems.length, maxBytes: restoreMaxBytes.toString() },
      previewStats: { itemCount: restoredItems.length, byteCount: restoreByteCount.toString(), untracked: 0, ignored: 0 },
      gitIdentity: gitIdentityFor(root, restoredItems.map((item) => ({ logicalPath: item.logicalPath, absolutePath: path.join(root.physicalPath, item.logicalPath) }))),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      guarantee: "ravo_guarded",
      notCovered: NOT_COVERED_PATHS
    };
    restorePlan.planFingerprint = fingerprint(planPayload(restorePlan));
    return coverageResult("preview", "已生成选择性恢复 SafetyPlan；恢复也需要独立确认。", { plan: restorePlan });
  } catch (error) {
    return errorResult(error);
  }
}

function runRestoreItem(plan, item, root, quarantine) {
  return runNative("restore", {
    root: root.physicalPath,
    relative: item.logicalPath,
    quarantine: quarantine.physicalPath,
    snapshotName: item.recovery.backupName,
    sourceName: item.recovery.sourceName,
    backupName: item.recovery.backupName,
    rootIdentity: root.identity,
    targetIdentity: item.targetIdentity,
    quarantineIdentity: quarantine.identity,
    sourceIdentity: item.recovery.sourceIdentity
  });
}

function executeRestore(confirmed, now = new Date().toISOString()) {
  const plan = confirmed?.plan;
  if (!plan || plan.kind !== "restore") return coverageResult("invalid_request", "executeRestore 需要恢复 SafetyPlan。");
  if (!verifyPlanIntegrity(plan)) return coverageResult("safety_violation", "恢复计划指纹不匹配。");
  if (!plan.expiresAt || Date.parse(now) > Date.parse(plan.expiresAt)) return coverageResult("expired", "恢复 SafetyPlan 已过期，必须重新 preview。");
  const authorization = evaluateAuthorization(confirmed.authorizationEnvelope, authorizationRequestFor(plan), now);
  if (!authorization.valid) return coverageResult(authorization.reason, "恢复 Authorization Envelope 不匹配。", { authorization });
  if (hasExecutionLedger(plan)) return coverageResult("retry_denied", "同一恢复计划指纹已经执行或尝试，禁止自动重试。");
  let validated;
  try {
    validated = revalidatePlan(plan);
  } catch (error) {
    return errorResult(error);
  }
  const ledger = executionLedger(plan, validated.quarantine);
  if (!ledger.allowed) return coverageResult(ledger.status, ledger.reason, { details: ledger.details });
  const receipt = {
    schemaVersion: "0.5.8",
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    action: "restore_file",
    guarantee: "ravo_guarded",
    attemptedSet: [],
    actualAffectedSet: [],
    items: [],
    executionLedgerRef: ledger.ref,
    startedAt: new Date().toISOString()
  };
  for (const item of plan.affectedSet) {
    const output = runRestoreItem(plan, item, validated.root, validated.quarantine);
    if (output.status !== "ok") {
      receipt.items.push({ id: item.id, attempted: true, result: "failed", code: output.status });
      receipt.attemptedSet.push(item.id);
      break;
    }
    receipt.items.push({
      id: item.id,
      attempted: true,
      result: "succeeded",
      actualIdentity: nativeIdentity(output.after),
      recovery: { kind: "quarantine", snapshotName: output.snapshot.name, sourceIdentity: nativeIdentity(output.snapshot) }
    });
    receipt.attemptedSet.push(item.id);
    receipt.actualAffectedSet.push(item.id);
  }
  receipt.completedAt = new Date().toISOString();
  receipt.reconciliation = reconcile(plan, receipt);
  receipt.status = receipt.reconciliation.status === "ok" ? "restored" : "safety_violation";
  return coverageResult(receipt.status, receipt.status === "restored" ? "恢复 drill 已完成并与恢复计划核对。" : receipt.reconciliation.reason, { receipt, plan: clone(plan) });
}

module.exports = {
  DATA_BOUNDARY,
  NOT_COVERED_PATHS,
  SCOPE,
  authorizationRequestFor,
  compileNative,
  confirmPlan,
  execute,
  executeRestore,
  fingerprint,
  identityFor,
  preview,
  previewRestore,
  reconcile,
  verifyPlanIntegrity
};
