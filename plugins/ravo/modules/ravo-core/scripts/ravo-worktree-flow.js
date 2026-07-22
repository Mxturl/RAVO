#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { captureGitBaseline, finalizeGitBaseline, fingerprint, gitRoot } = require("./ravo-git-baseline");

const INTEGRATION_ORDER = ["contract", "shared_module", "upstream", "downstream", "orchestration", "tests"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(file) {
  try { return fs.realpathSync(file); } catch (_error) { return path.resolve(file); }
}

function jsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_error) { return null; }
}

function git(cwd, args, options = {}) {
  const result = spawnSync(options.gitPath || "git", args, {
    cwd,
    encoding: "utf8",
    env: options.env || process.env,
    timeout: options.timeoutMs || 30000,
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const value = { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
  if (value.status !== 0 && !options.allowFailure) {
    const error = new Error(`git ${args.join(" ")} failed: ${(value.stderr || value.stdout).trim().replace(/[\r\n]+/g, " ")}`);
    error.status = value.status;
    throw error;
  }
  return value;
}

function gitText(cwd, args, options = {}) {
  return git(cwd, args, options).stdout.trim();
}

function fullCommit(root, ref) {
  const value = gitText(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("baseCommit must resolve to a full commit SHA.");
  return value;
}

function branchExists(root, branch) {
  return git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true }).status === 0;
}

function validBranch(root, branch) {
  if (!branch || git(root, ["check-ref-format", "--branch", branch], { allowFailure: true }).status !== 0) throw new Error(`Invalid branch name: ${branch || "(empty)"}`);
  return branch;
}

function isDirty(snapshot) {
  return Boolean(snapshot?.staged?.length || snapshot?.unstaged?.length || snapshot?.untracked?.length);
}

function normalizePath(value, field) {
  const output = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!output || output.startsWith("/") || output.split("/").includes("..")) throw new Error(`${field} must be a workspace-relative path.`);
  return output.replace(/\/+$/, "");
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function normalizeOwnership(value) {
  if (!isObject(value)) throw new Error("ownership must be an object.");
  const list = (name) => {
    if (!Array.isArray(value[name])) throw new Error(`ownership.${name} must be an array.`);
    return [...new Set(value[name].map((item) => normalizePath(item, `ownership.${name}`)))];
  };
  const shared = Array.isArray(value.shared) ? value.shared.map((entry) => {
    if (!isObject(entry) || !entry.path || !entry.owner) throw new Error("ownership.shared entries require path and owner.");
    const owner = String(entry.owner).trim();
    if (!owner) throw new Error("ownership.shared entries require a non-empty owner.");
    return { path: normalizePath(entry.path, "ownership.shared.path"), owner };
  }) : (() => { throw new Error("ownership.shared must be an array."); })();
  for (let index = 0; index < shared.length; index += 1) {
    for (let other = 0; other < index; other += 1) {
      if (pathsOverlap(shared[index].path, shared[other].path) && shared[index].owner !== shared[other].owner) {
        throw new Error(`Shared path has multiple owners: ${shared[index].path}`);
      }
    }
  }
  if (typeof value.stop !== "string" || !value.stop.trim()) throw new Error("ownership.stop is required.");
  return {
    write: list("write"),
    readOnly: list("readOnly"),
    shared,
    upstream: list("upstream"),
    output: list("output"),
    stop: value.stop.trim()
  };
}

function normalizeIgnoredInputs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("ignoredInputs must be an array.");
  return value.map((entry) => {
    if (!isObject(entry) || typeof entry.source !== "string" || !entry.source.trim()) throw new Error("ignoredInputs entries require source.");
    if (typeof entry.required !== "boolean") throw new Error("ignoredInputs entries require boolean required.");
    if (typeof entry.regenerable !== "boolean") throw new Error("ignoredInputs entries require boolean regenerable.");
    if (typeof entry.ownership !== "string" || !entry.ownership.trim()) throw new Error("ignoredInputs entries require ownership.");
    if (typeof entry.fallback !== "string" || !entry.fallback.trim()) throw new Error("ignoredInputs entries require fallback.");
    return {
      source: entry.source.trim(),
      required: entry.required,
      regenerable: entry.regenerable,
      ownership: entry.ownership.trim(),
      fallback: entry.fallback.trim()
    };
  });
}

function captureIgnoredState(root) {
  const output = git(root, ["status", "--ignored", "--porcelain=v1", "-z"]).stdout;
  const entries = output.split("\0").filter((entry) => entry.startsWith("!! ")).map((entry) => entry.slice(3)).sort();
  return { entries, fingerprint: fingerprint(entries) };
}

function captureSourceSnapshot(root) {
  const source = captureGitBaseline(root);
  const ignored = captureIgnoredState(root);
  return { ...source, ignored: ignored.entries, ignoredFingerprint: ignored.fingerprint };
}

function inspectIgnoredInputs(root, inputs) {
  return inputs.map((entry) => {
    const absolute = path.isAbsolute(entry.source) ? entry.source : path.resolve(root, entry.source);
    const available = fs.existsSync(absolute);
    return {
      ...entry,
      status: available ? "available" : entry.required ? "blocked" : "fallback"
    };
  });
}

function classifyGoal(goal = {}) {
  if (goal.productImplementation === false) return { status: "not_required", reason: "non_product_task" };
  const missing = [
    ["confirmed", "confirmed Alignment"],
    ["specCurrent", "current Spec"],
    ["poolCurrent", "current Pool"],
    ["productImplementation", "product implementation intent"]
  ].filter(([field]) => goal[field] !== true).map(([, label]) => label);
  if (missing.length) return { status: "blocked", reason: "goal_preconditions_missing", missing };
  const signals = ["longRunning", "crossSession", "handoff", "parallel", "sharedContract", "multiModule", "integrationTests", "protectDirtySource"];
  return signals.some((field) => goal[field] === true)
    ? { status: "worktree_required", reason: "long_running_product_goal", signals: signals.filter((field) => goal[field] === true) }
    : { status: "not_required", reason: "local_product_change" };
}

function worktreeAt(root, target) {
  const expected = canonical(target);
  return captureGitBaseline(root).worktrees.find((entry) => canonical(entry.path) === expected) || null;
}

function branchFor(worktree) {
  return gitText(worktree, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFailure: true }) || null;
}

function safeWorktreePath(root, target) {
  const resolved = path.resolve(target);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error("taskWorktree must be outside the source worktree.");
  return resolved;
}

function defaultRescueRef(taskId) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  return `rescue/${taskId}-${stamp}`;
}

function activeRavoContexts(root) {
  const contexts = [];
  for (const entry of captureGitBaseline(root).worktrees) {
    const worktree = canonical(entry.path);
    const marker = readJson(path.join(worktree, "knowledge", ".ravo", "worktree", "worktree-owner.json"));
    if (marker?.owner !== "ravo") continue;
    const directory = path.join(worktree, "knowledge", ".ravo", "worktree");
    let files = [];
    try { files = fs.readdirSync(directory); } catch (_error) { continue; }
    for (const name of files) {
      if (!name.endsWith(".json") || name === "worktree-owner.json") continue;
      const context = readJson(path.join(directory, name));
      if (!context || context.schemaVersion !== "0.5.7" || context.status === "complete" || context.status === "stopped" || !isObject(context.ownership)) continue;
      contexts.push({ worktree, contextPath: path.join(directory, name), context });
    }
  }
  return contexts;
}

function contextTaskOwner(context) {
  return String(context.taskOwner || context.taskId || "").trim();
}

function ownedPaths(value, field) {
  return Array.isArray(value?.[field]) ? value[field].filter((entry) => typeof entry === "string" && entry) : [];
}

function ownershipConflicts(root, plan) {
  const conflicts = [];
  for (const existing of activeRavoContexts(root)) {
    const context = existing.context;
    if (canonical(existing.worktree) === canonical(plan.taskWorktree) || context.taskId === plan.taskId) continue;
    const owner = contextTaskOwner(context);
    const existingWrites = ownedPaths(context.ownership, "write");
    const existingShared = Array.isArray(context.ownership.shared) ? context.ownership.shared.filter(isObject) : [];
    for (const desired of plan.ownership.write) {
      for (const written of existingWrites) {
        if (pathsOverlap(desired, written)) conflicts.push({ type: "write_path_owner_conflict", path: desired, existingPath: written, existingTaskId: context.taskId, existingOwner: owner, recoveryEntry: context.ownership.stop || "Ask the existing owner to finish or transfer the path." });
      }
      for (const shared of existingShared) {
        if (typeof shared.path === "string" && typeof shared.owner === "string" && shared.owner !== plan.taskOwner && pathsOverlap(desired, shared.path)) {
          conflicts.push({ type: "shared_contract_owner_conflict", path: desired, existingPath: shared.path, existingTaskId: context.taskId, existingOwner: shared.owner, recoveryEntry: context.ownership.stop || "Ask the shared-contract owner for a milestone." });
        }
      }
    }
    for (const shared of plan.ownership.shared) {
      for (const prior of existingShared) {
        if (typeof prior.path === "string" && typeof prior.owner === "string" && prior.owner !== shared.owner && pathsOverlap(shared.path, prior.path)) {
          conflicts.push({ type: "shared_contract_owner_conflict", path: shared.path, existingPath: prior.path, existingTaskId: context.taskId, existingOwner: prior.owner, recoveryEntry: context.ownership.stop || "Ask the shared-contract owner for a milestone." });
        }
      }
    }
    if (context.releaseSlice === plan.releaseSlice && context.integrationBranch === plan.integrationBranch && context.integrationOwner !== plan.integrationOwner) {
      conflicts.push({ type: "integration_owner_conflict", path: plan.integrationBranch, existingTaskId: context.taskId, existingOwner: context.integrationOwner, recoveryEntry: "Use the existing integration owner or create a Spec Delta with a new Release Slice." });
    }
  }
  return conflicts;
}

function integrationBranchState(root, plan) {
  if (!branchExists(root, plan.integrationBranch)) return { exists: false, head: "", knownOwner: false, contexts: [] };
  const contexts = activeRavoContexts(root)
    .filter((entry) => entry.context.integrationBranch === plan.integrationBranch)
    .map((entry) => ({
      taskId: entry.context.taskId,
      releaseSlice: entry.context.releaseSlice,
      integrationOwner: entry.context.integrationOwner,
      contextPath: entry.contextPath
    }));
  return {
    exists: true,
    head: fullCommit(root, plan.integrationBranch),
    knownOwner: contexts.some((entry) => entry.releaseSlice === plan.releaseSlice && entry.integrationOwner === plan.integrationOwner),
    contexts
  };
}

function preparePlan(workspace, input = {}) {
  const root = gitRoot(workspace);
  const trigger = classifyGoal(input.goal);
  if (trigger.status !== "worktree_required") return { ...trigger, root };
  const taskId = String(input.taskId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(taskId)) throw new Error("taskId must contain lowercase letters, digits, and hyphens.");
  const releaseSlice = String(input.releaseSlice || "").trim();
  if (!releaseSlice) throw new Error("releaseSlice is required.");
  const source = captureSourceSnapshot(root);
  const baseCommit = fullCommit(root, input.baseCommit || source.head);
  const taskBranch = validBranch(root, input.taskBranch || `task/ravo-v0.5.7-${taskId}`);
  const integrationBranch = validBranch(root, input.integrationBranch || `integration/${releaseSlice}`);
  const taskWorktree = safeWorktreePath(root, input.taskWorktree);
  const ownership = normalizeOwnership(input.ownership);
  const taskOwner = String(input.taskOwner || taskId).trim();
  if (!taskOwner) throw new Error("taskOwner is required.");
  const integrationOwner = String(input.integrationOwner || "").trim();
  if (!integrationOwner) throw new Error("integrationOwner is required.");
  const ignoredInputs = normalizeIgnoredInputs(input.ignoredInputs);
  const ignoredInputStates = inspectIgnoredInputs(root, ignoredInputs);
  const missingRequiredInputs = ignoredInputStates.filter((entry) => entry.status === "blocked");
  if (missingRequiredInputs.length) {
    return { status: "blocked", reason: "required_ignored_input_missing", root, missingRequiredInputs };
  }
  const sourceDirty = isDirty(source);
  const rescueRef = sourceDirty && !source.branch ? validBranch(root, input.rescueRef || defaultRescueRef(taskId)) : "";
  const plan = {
    status: "changes_ready",
    root,
    source,
    sourceDirty,
    taskId,
    releaseSlice,
    baseCommit,
    baseBranch: source.branch,
    taskBranch,
    integrationBranch,
    taskWorktree,
    taskOwner,
    integrationOwner,
    ownership,
    ignoredInputs: ignoredInputStates,
    rescueRef,
    changes: []
  };
  plan.integrationBranchState = integrationBranchState(root, plan);
  const conflicts = ownershipConflicts(root, plan);
  if (conflicts.length) {
    return {
      status: "blocked",
      reason: "ownership_conflict",
      root,
      taskId,
      releaseSlice,
      taskBranch,
      integrationBranch,
      taskWorktree,
      taskOwner,
      integrationOwner,
      conflicts
    };
  }
  if (plan.integrationBranchState.exists && input.adoptExisting !== true && !plan.integrationBranchState.knownOwner) {
    return {
      status: "blocked",
      reason: "integration_owner_unknown",
      root,
      taskId,
      releaseSlice,
      integrationBranch,
      integrationBranchState: plan.integrationBranchState,
      recoveryEntry: "Keep the existing integration branch unchanged and verify its owner/context before re-running prepare."
    };
  }
  plan.changes = [
    ...(rescueRef ? [{ action: "create_rescue_ref", ref: rescueRef, target: source.head, protects: "existing commits only" }] : []),
    plan.integrationBranchState.exists
      ? { action: "reuse_integration_branch", branch: integrationBranch, head: plan.integrationBranchState.head, owner: integrationOwner }
      : { action: "create_integration_branch", branch: integrationBranch, baseCommit },
    { action: "create_task_worktree", branch: taskBranch, path: taskWorktree, baseCommit },
    { action: "write_local_ignored_context", path: "knowledge/.ravo/worktree" }
  ];
  return plan;
}

function contextPaths(taskWorktree, taskId) {
  const root = path.join(taskWorktree, "knowledge", ".ravo", "worktree");
  return {
    marker: path.join(root, "worktree-owner.json"),
    context: path.join(root, `${taskId}.json`)
  };
}

function preserveSource(plan) {
  const current = captureSourceSnapshot(plan.root);
  if (current.head !== plan.source.head || current.branch !== plan.source.branch || current.worktreeFingerprint !== plan.source.worktreeFingerprint || current.ignoredFingerprint !== plan.source.ignoredFingerprint) {
    throw new Error("Source worktree changed while preparing the task; no task context was recorded.");
  }
  return current;
}

function blankTaskStartup(snapshot) {
  const blank = { ...snapshot, staged: [], unstaged: [], untracked: [] };
  blank.worktreeFingerprint = fingerprint({ staged: blank.staged, unstaged: blank.unstaged, untracked: blank.untracked });
  blank.fingerprint = fingerprint({
    branch: blank.branch,
    head: blank.head,
    indexFingerprint: blank.indexFingerprint,
    worktreeFingerprint: blank.worktreeFingerprint,
    staged: blank.staged,
    unstaged: blank.unstaged,
    untracked: blank.untracked,
    worktrees: blank.worktrees
  });
  return blank;
}

function taskStartup(plan, taskWorktree, input) {
  const snapshot = captureGitBaseline(taskWorktree);
  if (input.adoptExisting !== true || !isDirty(snapshot)) return snapshot;
  if (snapshot.staged.length) throw new Error("adoptExisting refuses staged changes because their ownership is ambiguous.");
  const declared = Array.isArray(input.initialTaskOwnedPaths)
    ? input.initialTaskOwnedPaths.map((item) => normalizePath(item, "initialTaskOwnedPaths"))
    : [];
  if (!declared.length) throw new Error("adoptExisting with existing changes requires initialTaskOwnedPaths.");
  const changed = [...snapshot.unstaged, ...snapshot.untracked].map((entry) => entry.path);
  if (changed.some((entry) => !declared.some((allowed) => entry === allowed || entry.startsWith(`${allowed}/`)) || !plan.ownership.write.some((allowed) => entry === allowed || entry.startsWith(`${allowed}/`)))) {
    throw new Error("adoptExisting found a change outside declared task ownership.");
  }
  return blankTaskStartup(snapshot);
}

function prepareTask(workspace, input = {}, options = {}) {
  const plan = preparePlan(workspace, input);
  if (plan.status !== "changes_ready") return plan;
  const apply = options.apply === true || input.apply === true;
  if (!apply) return plan;
  const adopting = input.adoptExisting === true;
  if (!adopting) {
    if (fs.existsSync(plan.taskWorktree) || branchExists(plan.root, plan.taskBranch)) throw new Error("Task branch or worktree already exists; use adoptExisting only after verifying its identity.");
    if (plan.rescueRef) gitText(plan.root, ["branch", plan.rescueRef, plan.source.head]);
    if (branchExists(plan.root, plan.integrationBranch)) {
      if (!plan.integrationBranchState?.knownOwner) throw new Error("Existing integration branch has no verified RAVO owner context.");
    } else {
      gitText(plan.root, ["branch", plan.integrationBranch, plan.baseCommit]);
    }
    gitText(plan.root, ["worktree", "add", "-b", plan.taskBranch, plan.taskWorktree, plan.baseCommit]);
  } else {
    const entry = worktreeAt(plan.root, plan.taskWorktree);
    if (!entry || branchFor(plan.taskWorktree) !== plan.taskBranch || fullCommit(plan.root, plan.taskBranch) !== plan.baseCommit || fullCommit(plan.root, plan.integrationBranch) !== plan.baseCommit) {
      throw new Error("Existing task/integration identity does not match the frozen plan.");
    }
    if (plan.rescueRef) {
      if (branchExists(plan.root, plan.rescueRef)) {
        if (fullCommit(plan.root, plan.rescueRef) !== plan.source.head) throw new Error("Existing rescue ref does not match the source HEAD.");
      } else {
        gitText(plan.root, ["branch", plan.rescueRef, plan.source.head]);
      }
    }
  }
  const taskWorktree = canonical(plan.taskWorktree);
  const paths = contextPaths(taskWorktree, plan.taskId);
  const marker = {
    schemaVersion: "0.5.7",
    owner: "ravo",
    taskId: plan.taskId,
    releaseSlice: plan.releaseSlice,
    baseCommit: plan.baseCommit,
    taskBranch: plan.taskBranch,
    integrationBranch: plan.integrationBranch,
    taskOwner: plan.taskOwner,
    integrationOwner: plan.integrationOwner,
    recoveryRef: `git:${plan.taskBranch}`
  };
  jsonFile(paths.marker, marker);
  const context = {
    schemaVersion: "0.5.7",
    status: "active",
    ...plan,
    taskWorktree,
    sourceSnapshot: plan.source,
    sourceAfterPrepare: preserveSource(plan),
    taskStartup: taskStartup(plan, taskWorktree, input),
    markerPath: path.relative(taskWorktree, paths.marker).split(path.sep).join("/"),
    milestones: [],
    mergePreflights: [],
    integrationPlans: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jsonFile(paths.context, context);
  return { status: "prepared", contextPath: paths.context, markerPath: paths.marker, context };
}

function readContext(workspace, input = {}) {
  const root = canonical(workspace);
  const file = canonical(path.resolve(root, input.contextPath || ""));
  if (!input.contextPath || !(file === root || file.startsWith(`${root}${path.sep}`))) throw new Error("contextPath must resolve inside the task worktree.");
  const context = readJson(file);
  if (!context || context.schemaVersion !== "0.5.7") throw new Error("Worktree context is missing or invalid.");
  return { file, context, root };
}

function ownedPath(context, value) {
  const file = normalizePath(value, "taskOwnedPaths");
  if (!context.ownership.write.some((allowed) => file === allowed || file.startsWith(`${allowed}/`))) return false;
  const owner = contextTaskOwner(context);
  return !(context.ownership.shared || []).some((shared) => isObject(shared)
    && typeof shared.path === "string"
    && typeof shared.owner === "string"
    && shared.owner !== owner
    && pathsOverlap(file, shared.path));
}

function milestone(workspace, input = {}, options = {}) {
  const { file, context, root } = readContext(workspace, input);
  const taskOwnedPaths = Array.isArray(input.taskOwnedPaths) ? input.taskOwnedPaths.map((item) => normalizePath(item, "taskOwnedPaths")) : [];
  if (!taskOwnedPaths.length) throw new Error("milestone requires taskOwnedPaths.");
  if (taskOwnedPaths.some((item) => !ownedPath(context, item))) throw new Error("milestone includes a path outside ownership.write.");
  if (!(options.apply === true || input.apply === true)) return { status: "changes_ready", taskOwnedPaths, contextPath: file };
  const result = finalizeGitBaseline(context.taskStartup, {
    taskOwnedPaths,
    releaseSlice: context.releaseSlice,
    requirementRange: "R057-001",
    commitMessage: input.commitMessage || ""
  });
  const entry = { at: new Date().toISOString(), taskOwnedPaths, result };
  context.milestones.push(entry);
  if (result.status === "committed" || result.status === "unchanged") context.taskStartup = captureGitBaseline(root);
  context.updatedAt = entry.at;
  jsonFile(file, context);
  return { ...result, contextPath: file, milestone: entry };
}

function conflictPaths(text) {
  const paths = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const conflict = line.match(/^CONFLICT \(.+?\): .*? in (.+)$/);
    const stage = line.match(/^\d{6} \d+ [0-9a-f]{40}\t(.+)$/i);
    if (conflict) paths.add(conflict[1]);
    else if (stage) paths.add(stage[1]);
  }
  return [...paths].sort();
}

function mergePreflight(workspace, input = {}) {
  const { file, context, root } = readContext(workspace, input);
  const candidateBranch = validBranch(root, input.candidateBranch || context.taskBranch);
  const integrationBranch = validBranch(root, input.integrationBranch || context.integrationBranch);
  const integrationHead = fullCommit(root, integrationBranch);
  const candidateHead = fullCommit(root, candidateBranch);
  const commonBase = gitText(root, ["merge-base", integrationBranch, candidateBranch]);
  const result = git(root, ["merge-tree", "--write-tree", integrationBranch, candidateBranch], { allowFailure: true });
  const entry = {
    at: new Date().toISOString(),
    integrationBranch,
    candidateBranch,
    integrationHead,
    candidateHead,
    commonBase,
    exitCode: result.status,
    conflictPaths: conflictPaths(`${result.stdout}\n${result.stderr}`),
    output: `${result.stdout}${result.stderr}`.trim(),
    status: result.status === 0 ? "ready_for_integration" : "pending_codex",
    semanticValidationRequired: true
  };
  context.mergePreflights.push(entry);
  context.updatedAt = entry.at;
  jsonFile(file, context);
  return { ...entry, contextPath: file };
}

function integrationPlan(workspace, input = {}) {
  const { file, context, root } = readContext(workspace, input);
  const stage = String(input.stage || "");
  const stageIndex = INTEGRATION_ORDER.indexOf(stage);
  if (stageIndex < 0) throw new Error(`stage must be one of: ${INTEGRATION_ORDER.join(", ")}`);
  if (String(input.integrationOwner || "") !== context.integrationOwner) return { status: "blocked", reason: "integration_owner_mismatch", contextPath: file };
  const last = context.integrationPlans.reduce((index, entry) => Math.max(index, INTEGRATION_ORDER.indexOf(entry.stage)), -1);
  if (stageIndex < last) return { status: "blocked", reason: "integration_order_regression", contextPath: file };
  const candidateBranch = validBranch(root, input.candidateBranch || context.taskBranch);
  const latest = [...context.mergePreflights].reverse().find((entry) => entry.integrationBranch === context.integrationBranch && entry.candidateBranch === candidateBranch);
  if (!latest || latest.status !== "ready_for_integration") return { status: "pending_codex", reason: "merge_preflight_required", contextPath: file };
  if (fullCommit(root, latest.integrationBranch) !== latest.integrationHead || fullCommit(root, latest.candidateBranch) !== latest.candidateHead) {
    return { status: "pending_codex", reason: "merge_preflight_stale", contextPath: file, recoveryEntry: "Re-run merge_preflight after the candidate and integration branch heads are stable." };
  }
  const plan = {
    at: new Date().toISOString(),
    stage,
    integrationBranch: context.integrationBranch,
    candidateBranch,
    integrationOwner: context.integrationOwner,
    recoveryRef: `git:${context.integrationBranch}`,
    preflightAt: latest.at,
    integrationHead: latest.integrationHead,
    candidateHead: latest.candidateHead,
    semanticValidationRequired: true,
    status: "ready_for_owner"
  };
  context.integrationPlans.push(plan);
  context.updatedAt = plan.at;
  jsonFile(file, context);
  return { ...plan, contextPath: file };
}

function readInput() {
  const index = process.argv.indexOf("--input");
  if (index >= 0) return JSON.parse(fs.readFileSync(process.argv[index + 1] || "", "utf8"));
  const json = process.argv.indexOf("--input-json");
  return JSON.parse(json >= 0 ? process.argv[json + 1] || "{}" : "{}");
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-worktree-flow.js --input <json-file>|--input-json <json> [--apply]");
    return;
  }
  const input = readInput();
  const workspace = path.resolve(input.workspace || process.cwd());
  const apply = process.argv.includes("--apply") || input.apply === true;
  let result;
  if (input.action === "classify") result = classifyGoal(input.goal);
  else if (input.action === "prepare") result = prepareTask(workspace, input, { apply });
  else if (input.action === "milestone") result = milestone(workspace, input, { apply });
  else if (input.action === "merge_preflight") result = mergePreflight(workspace, input);
  else if (input.action === "integration_plan") result = integrationPlan(workspace, input);
  else throw new Error("action must be classify, prepare, milestone, merge_preflight, or integration_plan");
  console.log(JSON.stringify(result, null, 2));
  if (["blocked", "pending_codex"].includes(result.status)) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${JSON.stringify({ status: "error", message: error.message })}\n`); process.exitCode = 1; }
}

module.exports = { INTEGRATION_ORDER, classifyGoal, conflictPaths, integrationPlan, mergePreflight, milestone, normalizeIgnoredInputs, normalizeOwnership, preparePlan, prepareTask };
