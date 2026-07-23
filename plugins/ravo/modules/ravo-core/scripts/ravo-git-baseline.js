#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PRODUCT_VERSION = "0.6.2";
const CLASSIFICATIONS = new Set(["task_owned", "pre_existing", "mixed_or_unknown"]);

function sha(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function fingerprint(value) {
  return sha(JSON.stringify(stable(value)));
}

function canonical(file) {
  try { return fs.realpathSync(file); } catch (_error) { return path.resolve(file); }
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function git(cwd, args, options = {}) {
  try {
    return execFileSync(options.gitPath || "git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeoutMs || 30000,
      maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (options.allowFailure) return "";
    const detail = String(error.stderr || error.stdout || error.message || error).trim().replace(/[\r\n]+/g, " ");
    const wrapped = new Error(`git ${args.join(" ")} failed: ${detail}`);
    wrapped.code = error.code || "git_failed";
    wrapped.cause = error;
    throw wrapped;
  }
}

function gitRoot(workspace, options = {}) {
  return canonical(git(workspace, ["rev-parse", "--show-toplevel"], options).trim());
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function nameStatus(cwd, args, options = {}) {
  const tokens = splitNul(git(cwd, [...args, "--name-status", "--no-renames", "-z"], options));
  const records = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const status = tokens[index] || "";
    const file = tokens[index + 1] || "";
    if (file) records.push({ status, path: file.split(path.sep).join("/") });
  }
  return records;
}

function pathFingerprint(root, file) {
  const absolute = path.join(root, file);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { type: "symlink", target: fs.readlinkSync(absolute), size: 0, sha256: "" };
    if (stat.isFile()) return { type: "file", size: stat.size, sha256: sha(fs.readFileSync(absolute)) };
    return { type: stat.isDirectory() ? "directory" : "other", size: stat.size, sha256: "" };
  } catch (_error) {
    return { type: "missing", size: 0, sha256: "" };
  }
}

function enrich(root, entries) {
  return entries.map((entry) => ({ ...entry, ...pathFingerprint(root, entry.path) })).sort((left, right) => left.path.localeCompare(right.path));
}

function parseWorktrees(value) {
  const records = [];
  let current = null;
  for (const line of String(value || "").split("\n")) {
    if (!line.trim()) {
      if (current) records.push(current);
      current = null;
      continue;
    }
    const match = line.match(/^([^ ]+) (.*)$/);
    if (!match) continue;
    if (match[1] === "worktree") {
      if (current) records.push(current);
      current = { path: canonical(match[2]) };
    } else if (current && match[1] === "HEAD") current.head = match[2];
    else if (current && match[1] === "branch") current.branch = match[2].replace(/^refs\/heads\//, "");
    else if (current && match[1] === "detached") current.detached = true;
    else if (current && match[1] === "prunable") current.prunable = match[2];
  }
  if (current) records.push(current);
  return records;
}

function captureGitBaseline(workspace, options = {}) {
  const root = gitRoot(workspace, options);
  const branch = git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { ...options, allowFailure: true }).trim() || null;
  const head = git(root, ["rev-parse", "HEAD"], { ...options, allowFailure: true }).trim() || null;
  const staged = enrich(root, nameStatus(root, ["diff", "--cached"], options));
  const unstaged = enrich(root, nameStatus(root, ["diff"], options));
  const untracked = enrich(root, splitNul(git(root, ["ls-files", "--others", "--exclude-standard", "-z"], options)).map((file) => ({ status: "??", path: file })));
  const indexBytes = git(root, ["ls-files", "-s", "-z"], options);
  const worktrees = parseWorktrees(git(root, ["worktree", "list", "--porcelain"], options));
  const value = {
    root,
    branch,
    head,
    indexFingerprint: sha(indexBytes),
    worktreeFingerprint: fingerprint({ staged, unstaged, untracked }),
    staged,
    unstaged,
    untracked,
    worktrees,
    capturedAt: new Date().toISOString()
  };
  value.fingerprint = fingerprint({
    branch: value.branch,
    head: value.head,
    indexFingerprint: value.indexFingerprint,
    worktreeFingerprint: value.worktreeFingerprint,
    staged: value.staged,
    unstaged: value.unstaged,
    untracked: value.untracked,
    worktrees: value.worktrees
  });
  return value;
}

function recordsByPath(snapshot) {
  const map = new Map();
  for (const listName of ["staged", "unstaged", "untracked"]) {
    for (const entry of snapshot?.[listName] || []) map.set(entry.path, { ...entry, listName });
  }
  return map;
}

function sameRecord(left, right) {
  return Boolean(left && right)
    && left.status === right.status
    && left.type === right.type
    && left.size === right.size
    && left.sha256 === right.sha256
    && left.target === right.target;
}

function classifyChanges(startup, current, options = {}) {
  const owned = new Set([...(options.taskOwnedPaths || []), ...(options.writtenPaths || [])].map((file) => String(file).replace(/^\.\//, "")));
  const before = recordsByPath(startup);
  const after = recordsByPath(current);
  const changes = [];
  for (const [file, entry] of after.entries()) {
    const prior = before.get(file);
    let classification = "mixed_or_unknown";
    let reason = "Current change is not explicitly attributable to this task.";
    if (prior && sameRecord(prior, entry)) {
      classification = "pre_existing";
      reason = "The path is unchanged from the Goal startup snapshot.";
    } else if (owned.has(file) && !(startup.staged || []).some((item) => item.path === file)) {
      classification = "task_owned";
      reason = "The current task explicitly recorded ownership of this path.";
    } else if (!prior && owned.has(file)) {
      classification = "task_owned";
      reason = "The current task explicitly created this path after the startup snapshot.";
    } else if (prior) {
      reason = "The path changed after startup but no safe file-level ownership proof was provided.";
    }
    changes.push({ path: file, classification, reason, startup: prior || null, current: entry });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function sensitiveFindings(root, paths) {
  const findings = [];
  const patterns = [
    { code: "private_key", pattern: /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/ },
    { code: "api_secret_token", pattern: /\b(?:sk|sess|pat)-[A-Za-z0-9_-]{12,}\b/ },
    { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
    // Require a literal or a token-like value; identifiers such as `apiKey = applySecretAction` are not credentials.
    { code: "credential_assignment", pattern: /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*(?:"[^"\r\n]{16,}"|'[^'\r\n]{16,}'|(?=[A-Za-z0-9_./+=-]{16,})(?=[A-Za-z0-9_./+=-]*[0-9_./+=-])[A-Za-z0-9_./+=-]+)/i }
  ];
  for (const file of paths) {
    const absolute = path.join(root, file);
    try {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      const text = fs.readFileSync(absolute, "utf8");
      for (const entry of patterns) if (entry.pattern.test(text)) findings.push({ path: file, code: entry.code });
    } catch (_error) { /* The Git operation will report missing files separately. */ }
  }
  return findings;
}

function currentStagedPaths(root, options = {}) {
  return nameStatus(root, ["diff", "--cached"], options).map((entry) => entry.path);
}

function commitMessage(options = {}) {
  return options.commitMessage || `RAVO v${options.productVersion || PRODUCT_VERSION} ${options.releaseSlice || "release-slice"} (${options.requirementRange || "required"})`;
}

function finalizeGitBaseline(startup, options = {}) {
  if (!startup || !startup.root) throw new Error("A Git startup snapshot is required.");
  const root = canonical(startup.root);
  const current = captureGitBaseline(root, options);
  const changes = classifyChanges(startup, current, options);
  const taskOwned = changes.filter((entry) => entry.classification === "task_owned").map((entry) => entry.path);
  const mixed = changes.filter((entry) => entry.classification === "mixed_or_unknown");
  const preExistingStaged = startup.staged || [];
  const security = sensitiveFindings(root, taskOwned);
  const base = {
    schemaVersion: "0.5.5",
    root,
    startupFingerprint: startup.fingerprint || fingerprint(startup),
    currentFingerprint: current.fingerprint,
    changes,
    taskOwned,
    preExisting: changes.filter((entry) => entry.classification === "pre_existing").map((entry) => entry.path),
    mixedOrUnknown: mixed.map((entry) => entry.path),
    securityFindings: security,
    remoteMutation: { push: false, tag: false, release: false, deploy: false },
    capturedAt: current.capturedAt
  };
  if (preExistingStaged.length || mixed.length || security.length) {
    return {
      ...base,
      status: "commit_blocked",
      baselineRef: null,
      commit: null,
      impact: preExistingStaged.length
        ? "The startup index already contained staged changes; committing safely would include pre-existing work."
        : mixed.length
          ? "At least one current path has mixed or unknown ownership; the tool will not stage it."
          : "A task-owned file contains a possible credential or secret pattern.",
      recoveryEntry: preExistingStaged.length
        ? "Review or commit the pre-existing index separately, then start a new RAVO baseline."
        : mixed.length
          ? "Provide explicit ownership or split the file outside this bounded automation."
          : "Remove or redact the sensitive value, then start a new baseline.",
      nextStep: "No automatic retry is performed for the same startup/current fingerprint."
    };
  }
  if (taskOwned.length === 0) {
    const tree = git(root, ["rev-parse", "HEAD^{tree}"], options).trim() || null;
    return { ...base, status: "unchanged", baselineRef: tree ? `git-tree:${tree}` : null, commit: null, tree, recoveryEntry: "No task-owned change was found; no commit was created." };
  }
  git(root, ["add", "--", ...taskOwned], options);
  const stagedAfter = currentStagedPaths(root, options);
  const unexpected = stagedAfter.filter((file) => !taskOwned.includes(file));
  if (unexpected.length) {
    return { ...base, status: "commit_blocked", baselineRef: null, commit: null, impact: "Git staging contains paths outside task-owned changes.", unexpectedStaged: unexpected, recoveryEntry: "Do not reset or stash automatically; review the index and start a new bounded baseline." };
  }
  if (stagedAfter.length === 0) {
    const tree = git(root, ["rev-parse", "HEAD^{tree}"], options).trim() || null;
    return { ...base, status: "unchanged", baselineRef: tree ? `git-tree:${tree}` : null, commit: null, tree, recoveryEntry: "Task-owned paths produced no staged content; no commit was created." };
  }
  try {
    git(root, ["commit", "-m", commitMessage(options)], options);
  } catch (error) {
    return { ...base, status: "commit_blocked", baselineRef: null, commit: null, impact: error.message, recoveryEntry: "Inspect the local Git commit failure and retry only after the repository state changes." };
  }
  const commit = git(root, ["rev-parse", "HEAD"], options).trim() || null;
  const tree = git(root, ["rev-parse", "HEAD^{tree}"], options).trim() || null;
  return { ...base, status: "committed", baselineRef: commit ? `git-commit:${commit}` : tree ? `git-tree:${tree}` : null, commit, tree, stagedAfter, recoveryEntry: "The commit is local only; no remote mutation was performed." };
}

function worktreeMarker(worktreePath) {
  for (const file of [path.join(worktreePath, ".ravo-worktree.json"), path.join(worktreePath, "knowledge", ".ravo", "worktree-owner.json")]) {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && typeof value === "object") return value;
    } catch (_error) { /* Unknown ownership remains unsafe. */ }
  }
  return null;
}

function cleanWorktrees(snapshot, options = {}) {
  const root = canonical(snapshot.root);
  const allowed = new Set((options.ownedWorktrees || []).map((file) => canonical(file)));
  const results = [];
  git(root, ["worktree", "prune"], options);
  for (const entry of captureGitBaseline(root, options).worktrees) {
    const worktree = canonical(entry.path);
    if (worktree === root) continue;
    const marker = worktreeMarker(worktree);
    const owner = marker?.owner === "ravo" || allowed.has(worktree);
    const dirty = Boolean(git(worktree, ["status", "--porcelain"], { ...options, allowFailure: true }).trim());
    const active = Boolean((options.activeWorktrees || []).map((file) => canonical(file)).includes(worktree) || fs.existsSync(path.join(worktree, ".ravo-session-active")));
    const recoverable = Boolean(marker?.recoveryRef || entry.branch || entry.head);
    const eligible = owner && !dirty && !active && recoverable;
    if (!eligible) {
      results.push({ path: worktree, action: "kept", owner, dirty, active, recoverable, reason: !owner ? "ownership_unknown" : dirty ? "dirty" : active ? "active_session" : "not_recoverable" });
      continue;
    }
    try {
      git(root, ["worktree", "remove", "--", worktree], options);
      results.push({ path: worktree, action: "removed", owner, dirty, active, recoverable, recoveryRef: marker?.recoveryRef || `git:${entry.head}` });
    } catch (error) {
      results.push({ path: worktree, action: "kept", owner, dirty, active, recoverable, reason: "remove_failed", recoveryEntry: error.message });
    }
  }
  return { pruned: true, results };
}

function writeArtifact(workspace, artifact, output = "") {
  const file = output ? path.resolve(workspace, output) : path.join(workspace, "knowledge", ".ravo", "acceptance", `git-baseline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  return values;
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-git-baseline.js --capture | --finalize --startup-ref <path> [--task-path <path>] | --cleanup");
    return;
  }
  if (process.argv.includes("--version")) { console.log(PRODUCT_VERSION); return; }
  if (process.argv.includes("--capture")) {
    const artifact = captureGitBaseline(workspace);
    const file = writeArtifact(workspace, artifact, argValue("--output", ""));
    console.log(JSON.stringify({ status: "ok", artifactPath: file, baseline: artifact }, null, 2));
    return;
  }
  if (process.argv.includes("--finalize")) {
    const startupFile = path.resolve(workspace, argValue("--startup-ref", ""));
    const startup = JSON.parse(fs.readFileSync(startupFile, "utf8"));
    const result = finalizeGitBaseline(startup, {
      taskOwnedPaths: argValues("--task-path"),
      releaseSlice: argValue("--release-slice", "ravo-v0.5.5-trusted-acceptance-baseline"),
      requirementRange: argValue("--requirement-range", "R054-001..025"),
      commitMessage: argValue("--commit-message", "")
    });
    const file = writeArtifact(workspace, result, argValue("--output", ""));
    console.log(JSON.stringify({ ...result, artifactPath: file }, null, 2));
    return;
  }
  if (process.argv.includes("--cleanup")) {
    const baseline = captureGitBaseline(workspace);
    const result = cleanWorktrees(baseline, { ownedWorktrees: argValues("--owned-worktree") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error("Choose --capture, --finalize, or --cleanup.");
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "error", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PRODUCT_VERSION,
  captureGitBaseline,
  classifyChanges,
  cleanWorktrees,
  finalizeGitBaseline,
  fingerprint,
  gitRoot,
  sensitiveFindings,
  writeArtifact
};
