#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TOTAL_TIMEOUT_MS = 15_000;
const MAX_METADATA_BYTES = 512 * 1024;
const VERSION_PATTERN = /\bv(\d+)[.-](\d+)[.-](\d+)\b/gi;

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function versionList(value) {
  const versions = [];
  const text = String(value || "");
  for (const match of text.matchAll(VERSION_PATTERN)) versions.push(`v${match[1]}.${match[2]}.${match[3]}`);
  return unique(versions);
}

function requirementIds(value) {
  return unique([...String(value || "").matchAll(/\b(R\d{3,}-\d{3,})\b/g)].map((match) => match[1])).sort();
}

function lineValue(text, labels) {
  const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = String(text || "").match(new RegExp(`^\\s*(?:${alternatives})\\s*[：:]\\s*(.+?)\\s*$`, "mi"));
  return match ? match[1].trim().replace(/[`]/g, "") : "";
}

function worktreeRef(file) {
  return `worktree:${crypto.createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 12)}`;
}

function inside(root, file) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(file);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function relativeRef(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function remaining(deadline) {
  return Math.max(0, deadline - Date.now());
}

function git(cwd, args, deadline) {
  const timeout = remaining(deadline);
  if (!timeout) return { ok: false, error: "timeout", stdout: "" };
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024
  });
  if (result.error) return { ok: false, error: result.error.code === "ETIMEDOUT" ? "timeout" : result.error.message, stdout: "" };
  if (result.status !== 0) return { ok: false, error: String(result.stderr || result.stdout || "git_failed").trim(), stdout: "" };
  return { ok: true, stdout: String(result.stdout || "") };
}

function gitText(cwd, args, deadline) {
  const result = git(cwd, args, deadline);
  return result.ok ? result.stdout.trim() : "";
}

function parseWorktreeList(text) {
  const entries = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current = { path: value, head: "", branch: "", detached: false };
    else if (current && key === "HEAD") current.head = value;
    else if (current && key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (current && key === "detached") current.detached = true;
  }
  if (current?.path) entries.push(current);
  return entries;
}

function listWorktrees(workspace, deadline, options) {
  if (Array.isArray(options.worktrees)) return { entries: options.worktrees, errors: [] };
  const result = git(workspace, ["worktree", "list", "--porcelain"], deadline);
  if (!result.ok) return { entries: [], errors: [`worktree_list:${result.error}`] };
  return { entries: parseWorktreeList(result.stdout), errors: [] };
}

function readJson(file, deadline, errors, ref) {
  if (!remaining(deadline)) {
    errors.push(`${ref}:timeout`);
    return null;
  }
  try {
    if (fs.statSync(file).size > MAX_METADATA_BYTES) {
      errors.push(`${ref}:metadata_too_large`);
      return null;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${ref}:${error.code || "read_failed"}`);
    return null;
  }
}

function versionDocumentKind(file) {
  const name = path.basename(file).toLowerCase();
  if (/alignment|requirements/.test(name)) return "alignment";
  if (/spec/.test(name)) return "spec";
  if (/goal/.test(name)) return "goal";
  return "document";
}

function documentMetadata(root, file, deadline, errors) {
  const ref = relativeRef(root, file);
  if (!remaining(deadline)) {
    errors.push(`${ref}:timeout`);
    return null;
  }
  try {
    if (fs.statSync(file).size > MAX_METADATA_BYTES) {
      errors.push(`${ref}:metadata_too_large`);
      return null;
    }
    const text = fs.readFileSync(file, "utf8");
    const heading = text.split(/\r?\n/, 1)[0] || "";
    const versions = unique([...versionList(path.basename(file)), ...versionList(heading)]);
    if (versions.length !== 1) return null;
    return {
      ref,
      version: versions[0],
      kind: versionDocumentKind(file),
      status: lineValue(text, ["Status", "状态"]),
      releaseSlice: lineValue(text, ["Release Slice", "候选 Release Slice"]),
      requirements: requirementIds(lineValue(text, ["Requirement Set", "需求集合"]) || text)
    };
  } catch (error) {
    errors.push(`${ref}:${error.code || "read_failed"}`);
    return null;
  }
}

function walkVersionDocuments(root, deadline, errors) {
  const docs = path.join(root, "docs");
  const output = [];
  const visit = (directory) => {
    if (!remaining(deadline)) {
      errors.push("docs:timeout");
      return;
    }
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) {
      if (directory === docs && error.code === "ENOENT") return;
      errors.push(`${relativeRef(root, directory)}:${error.code || "read_failed"}`);
      return;
    }
    for (const entry of entries) {
      if (!remaining(deadline)) {
        errors.push("docs:timeout");
        return;
      }
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(md|txt)$/i.test(entry.name) && /v\d+[.-]\d+[.-]\d+/i.test(entry.name)) {
        const metadata = documentMetadata(root, file, deadline, errors);
        if (metadata) output.push(metadata);
      }
    }
  };
  visit(docs);
  return output;
}

function recordVersions(record) {
  return unique([
    ...versionList(record.committedVersion),
    ...versionList(record.actualReleaseVersion),
    ...versionList(record.releaseVersion),
    ...(Array.isArray(record.candidateVersions) ? record.candidateVersions.flatMap(versionList) : []),
    ...versionList(record.subjectRef),
    ...versionList(record.releaseRef),
    ...versionList(record.specRef)
  ]);
}

function poolRecords(root, deadline, errors) {
  const directory = path.join(root, "knowledge", ".ravo", "pool", "items");
  let names;
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); } catch (error) {
    if (error.code === "ENOENT") return [];
    errors.push("pool_items:read_failed");
    return [];
  }
  const output = [];
  for (const name of names) {
    const ref = `knowledge/.ravo/pool/items/${name}`;
    const value = readJson(path.join(directory, name), deadline, errors, ref);
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    output.push({
      ref,
      id: String(value.id || ""),
      versions: recordVersions(value),
      releaseSlice: String(value.releaseSlice || ""),
      requirements: unique([...(Array.isArray(value.legacyIds) ? value.legacyIds : []), ...requirementIds(value.requirementSet || "")]).sort(),
      pmAcceptanceStatus: String(value.pmAcceptanceStatus || ""),
      pmAcceptedAt: String(value.pmAcceptedAt || ""),
      pmFeedback: String(value.pmFeedback || ""),
      deliveryStatus: String(value.deliveryStatus || ""),
      blockerStatus: String(value.blockerStatus || ""),
      releaseStatus: String(value.releaseStatus || ""),
      releaseCommit: String(value.releaseCommit || ""),
      gitBaseline: String(value.gitBaseline || ""),
      runtimeStatus: String(value.runtimeStatus || ""),
      updatedAt: String(value.updatedAt || "")
    });
  }
  return output;
}

function acceptanceScope(root, value, deadline, errors, ref) {
  const specRef = String(value.specRef || "");
  const specPath = specRef && inside(root, path.resolve(root, specRef)) ? path.resolve(root, specRef) : "";
  const spec = specPath && fs.existsSync(specPath) ? documentMetadata(root, specPath, deadline, errors) : null;
  return {
    releaseSlice: String(value.releaseRef || spec?.releaseSlice || value.milestoneRef || value.subjectRef || ""),
    requirements: unique([...requirementIds(value.requirementSet || ""), ...(spec?.requirements || [])]).sort(),
    specRef: specRef || ref
  };
}

function acceptanceRecords(root, deadline, errors) {
  const directory = path.join(root, "knowledge", ".ravo", "acceptance");
  let names;
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); } catch (error) {
    if (error.code === "ENOENT") return [];
    errors.push("acceptance:read_failed");
    return [];
  }
  const output = [];
  for (const name of names) {
    const ref = `knowledge/.ravo/acceptance/${name}`;
    const value = readJson(path.join(directory, name), deadline, errors, ref);
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const decision = value.pmDecision && typeof value.pmDecision === "object" ? value.pmDecision : null;
    const scope = acceptanceScope(root, value, deadline, errors, ref);
    output.push({
      ref,
      versions: recordVersions(value),
      status: String(value.status || ""),
      releaseSlice: scope.releaseSlice,
      requirements: scope.requirements,
      baselineRef: String(value.baselineRef || ""),
      gitBaselineStatus: String(value.gitBaselineStatus || ""),
      supersededBy: String(value.supersededBy || ""),
      supersedes: Array.isArray(value.supersedes) ? value.supersedes.map(String) : [],
      pmDecision: decision ? {
        actor: String(decision.actor || ""),
        status: String(decision.status || decision.decision || decision.result || value.status || ""),
        decidedAt: String(decision.decidedAt || value.createdAt || "")
      } : null,
      createdAt: String(value.createdAt || ""),
      runtimeStatus: String(value.runtimeStatus || "")
    });
  }
  return output;
}

function remoteState(root, branch, deadline) {
  if (!branch) return { tracking: "none", ahead: null, behind: null };
  const upstream = gitText(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], deadline);
  if (!upstream) return { tracking: "none", ahead: null, behind: null };
  const counts = gitText(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], deadline).split(/\s+/).map(Number);
  return { tracking: upstream, ahead: Number.isFinite(counts[0]) ? counts[0] : null, behind: Number.isFinite(counts[1]) ? counts[1] : null };
}

function scanWorktree(entry, deadline) {
  const root = path.resolve(entry.path || "");
  const errors = [];
  const worktree = {
    ref: worktreeRef(root),
    path: root,
    head: String(entry.head || ""),
    branch: String(entry.branch || ""),
    detached: Boolean(entry.detached),
    dirty: { tracked: 0, untracked: 0, changed: false },
    remote: { tracking: "none", ahead: null, behind: null },
    readErrors: errors
  };
  if (!entry.path || !fs.existsSync(root)) {
    errors.push("worktree_unreadable");
    return { worktree, documents: [], pool: [], acceptance: [] };
  }
  if (!remaining(deadline)) {
    errors.push("timeout");
    return { worktree, documents: [], pool: [], acceptance: [] };
  }
  const head = git(root, ["rev-parse", "HEAD"], deadline);
  if (head.ok) worktree.head = head.stdout.trim(); else errors.push(`head:${head.error}`);
  const branch = gitText(root, ["symbolic-ref", "--short", "-q", "HEAD"], deadline);
  if (branch) worktree.branch = branch;
  worktree.detached = Boolean(entry.detached || !worktree.branch);
  const status = git(root, ["status", "--porcelain=v1"], deadline);
  if (status.ok) {
    for (const line of status.stdout.split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith("??")) worktree.dirty.untracked += 1;
      else worktree.dirty.tracked += 1;
    }
    worktree.dirty.changed = Boolean(worktree.dirty.tracked || worktree.dirty.untracked);
  } else errors.push(`status:${status.error}`);
  worktree.remote = remoteState(root, worktree.branch, deadline);
  const documents = walkVersionDocuments(root, deadline, errors).map((document) => ({ ...document, worktreeRef: worktree.ref }));
  const pool = poolRecords(root, deadline, errors).map((record) => ({ ...record, worktreeRef: worktree.ref }));
  const acceptance = acceptanceRecords(root, deadline, errors).map((record) => ({ ...record, worktreeRef: worktree.ref }));
  return { worktree, documents, pool, acceptance };
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function scopeOf(record) {
  return { releaseSlice: String(record.releaseSlice || ""), requirements: unique(record.requirements || []).sort() };
}

function scopesConflict(left, right) {
  if (left.releaseSlice && right.releaseSlice && left.releaseSlice !== right.releaseSlice) return true;
  return Boolean(left.requirements.length && right.requirements.length && !left.requirements.some((id) => right.requirements.includes(id)));
}

function inspectCommit(root, ref, mainHead, deadline) {
  const full = gitText(root, ["rev-parse", "--verify", `${ref}^{commit}`], deadline);
  if (!full) return null;
  const ancestor = git(root, ["merge-base", "--is-ancestor", full, mainHead], deadline).ok;
  const changed = gitText(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", full], deadline)
    .split(/\r?\n/).filter(Boolean);
  return { ref: full, integrated: ancestor, runtimeChanged: changed.some((file) => file.startsWith("plugins/")) };
}

function decisionEvidence(group) {
  const output = [];
  for (const record of group.pool) {
    if (!["accepted", "rejected"].includes(record.pmAcceptanceStatus)) continue;
    output.push({
      ref: record.ref,
      source: "pool_pm_decision",
      status: record.pmAcceptanceStatus,
      at: timestamp(record.pmAcceptedAt || record.updatedAt),
      scope: scopeOf(record),
      commitRefs: [record.releaseCommit, record.gitBaseline]
    });
  }
  for (const record of group.acceptance) {
    const decisionStatus = record.pmDecision?.status;
    if (record.pmDecision?.actor === "pm" && ["accepted", "rejected"].includes(decisionStatus)) {
      output.push({
        ref: record.ref,
        source: "acceptance_pm_decision",
        status: decisionStatus,
        at: timestamp(record.pmDecision.decidedAt),
        scope: scopeOf(record),
        commitRefs: [record.baselineRef]
      });
    }
  }
  return output.sort((left, right) => right.at - left.at || left.ref.localeCompare(right.ref));
}

function stateFor(group, root, mainHead, scans, deadline) {
  const decisions = decisionEvidence(group);
  const conflicts = [];
  for (let index = 0; index < decisions.length; index += 1) {
    for (let other = index + 1; other < decisions.length; other += 1) {
      if (scopesConflict(decisions[index].scope, decisions[other].scope)) {
        conflicts.push({ type: "status_conflict", version: group.version, evidenceRefs: [decisions[index].ref, decisions[other].ref], reason: "pm_scope_mismatch" });
      }
    }
  }
  const currentAcceptance = group.acceptance
    .filter((record) => !record.supersededBy)
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || left.ref.localeCompare(right.ref));
  const selected = decisions[0] || null;
  const supersededEvidenceRefs = selected
    ? currentAcceptance.filter((record) => timestamp(record.createdAt) <= selected.at && !scopesConflict(scopeOf(record), selected.scope)).map((record) => record.ref)
    : [];
  // The current conclusion owns its bound commit; stale evidence cannot upgrade integration state.
  const refs = unique((selected?.commitRefs || []).flatMap((value) => [...String(value || "").matchAll(/\b[0-9a-f]{7,40}\b/gi)].map((match) => match[0])));
  const commits = refs.map((ref) => inspectCommit(root, ref, mainHead, deadline)).filter(Boolean);
  const versionWorktrees = new Map(scans.map((scan) => [scan.worktree.ref, scan.worktree]));
  const dirtyDetached = group.documents.some((document) => {
    const worktree = versionWorktrees.get(document.worktreeRef);
    return worktree?.detached && worktree.dirty.changed;
  });
  const commitBlocked = group.pool.some((record) => record.blockerStatus === "commit_blocked") || group.acceptance.some((record) => record.gitBaselineStatus === "commit_blocked");
  let productState = "unknown";
  let currentEvidenceRef = "";
  if (conflicts.length) {
    currentEvidenceRef = selected?.ref || currentAcceptance[0]?.ref || "";
  } else if (selected) {
    productState = selected.status;
    currentEvidenceRef = selected.ref;
  } else if (currentAcceptance.some((record) => ["accepted", "rejected"].includes(record.status))) {
    const record = currentAcceptance.find((item) => ["accepted", "rejected"].includes(item.status));
    productState = record.status;
    currentEvidenceRef = record.ref;
  } else if (commits.length) {
    productState = "implemented";
    currentEvidenceRef = `git:${commits[0].ref}`;
  } else if (group.documents.length || group.pool.length) {
    productState = "planned";
    currentEvidenceRef = group.documents[0]?.ref || group.pool[0]?.ref || "";
  }
  const engineeringState = commitBlocked ? "commit_blocked"
    : commits.some((commit) => commit.integrated) ? "integrated"
      : commits.length ? "committed"
        : dirtyDetached ? "dirty_detached"
          : productState === "accepted" ? "not_integrated"
            : "unknown";
  const statuses = unique([...group.pool.map((record) => record.releaseStatus), ...group.acceptance.map((record) => record.status)]);
  const releaseState = statuses.includes("released") ? "released"
    : statuses.includes("planned") || productState === "accepted" ? "planned"
      : "not_planned";
  return {
    productState,
    engineeringState,
    releaseState,
    currentEvidenceRef,
    supersededEvidenceRefs: unique(supersededEvidenceRefs),
    conflicts,
    commits,
    currentScope: selected?.scope || scopeOf(currentAcceptance[0] || {})
  };
}

function compareVersions(left, right) {
  const parse = (value) => versionList(value)[0]?.slice(1).split(".").map(Number) || [0, 0, 0];
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function nextVersion(version) {
  const values = versionList(version)[0]?.slice(1).split(".").map(Number);
  return values ? `v${values[0]}.${values[1]}.${values[2] + 1}` : null;
}

function pmBrief(inventory) {
  if (inventory.scanStatus !== "complete") {
    return {
      productResult: "Version inventory is incomplete.",
      currentAvailability: "Existing accepted product state is unchanged.",
      userImpact: "A new version must not be planned until the missing worktree is readable.",
      actionRequired: "none",
      nextStep: "Codex should restore the listed local worktree and scan once again."
    };
  }
  const accepted = inventory.latestAcceptedVersion || "none";
  return {
    productResult: `Latest accepted version: ${accepted}.`,
    currentAvailability: inventory.latestAcceptedVersion ? "Product acceptance is tracked separately from local integration and remote release." : "No accepted version was found in current structured evidence.",
    userImpact: inventory.nextVersionCandidate ? `The next version candidate is ${inventory.nextVersionCandidate}.` : "Version planning is blocked by unresolved evidence.",
    actionRequired: inventory.conflicts.length ? "pm_scope_confirmation" : "none",
    nextStep: inventory.conflicts.length ? "Confirm which explicitly bound scope is current." : "Codex can use the shared inventory before creating a new Alignment."
  };
}

function releaseCandidates(inventory, options = {}) {
  const versions = options.versions || ["v0.5.6", "v0.5.7", "v0.5.8", "v0.5.9", "v0.5.10"];
  const rows = versions.map((version) => {
    const record = inventory.versions.find((item) => item.version === version);
    const runtimeState = record?.runtimeState || "blocked";
    const productState = record?.productState || "unknown";
    const engineeringState = record?.engineeringState || "unknown";
    const releaseState = record?.releaseState || "not_planned";
    const include = productState === "accepted" && ["committed", "integrated"].includes(engineeringState);
    return {
      version,
      productState,
      engineeringState,
      runtimeState,
      releaseState,
      releaseDestination: include ? "include" : "blocked",
      reason: include ? "local_candidate_only" : "missing_product_or_engineering_evidence",
      externalAction: "Push, Tag, Release, and deployment require separate PM authorization."
    };
  });
  const hotfix = inventory.hotfixes.find((item) => item.commit.startsWith("d7b436f"));
  rows.push({
    version: "d7b436f",
    productState: hotfix?.pmAcceptanceStatus === "accepted" ? "accepted" : "unknown",
    engineeringState: hotfix?.integrated ? "integrated" : "unknown",
    runtimeState: hotfix?.runtimeState || "blocked",
    releaseState: hotfix?.releaseStatus || "not_planned",
    releaseDestination: hotfix?.pmAcceptanceStatus === "accepted" && hotfix.integrated ? "include" : "blocked",
    reason: hotfix ? "tracked_hotfix" : "hotfix_evidence_missing",
    externalAction: "Push, Tag, Release, and deployment require separate PM authorization."
  });
  return rows;
}

function scanVersionInventory(workspace, options = {}) {
  const root = path.resolve(workspace);
  const deadline = Date.now() + Math.max(1, Number(options.timeoutMs) || TOTAL_TIMEOUT_MS);
  const listed = listWorktrees(root, deadline, options);
  const scans = listed.entries.map((entry) => scanWorktree(entry, deadline));
  const groups = new Map();
  const groupFor = (version) => {
    if (!groups.has(version)) groups.set(version, { version, documents: [], pool: [], acceptance: [], requirements: new Set(), releaseSlices: new Set() });
    return groups.get(version);
  };
  for (const scan of scans) {
    for (const document of scan.documents) {
      const group = groupFor(document.version);
      group.documents.push(document);
      document.requirements.forEach((id) => group.requirements.add(id));
      if (document.releaseSlice) group.releaseSlices.add(document.releaseSlice);
    }
    for (const record of scan.pool) {
      for (const version of record.versions) {
        const group = groupFor(version);
        group.pool.push(record);
        record.requirements.forEach((id) => group.requirements.add(id));
        if (record.releaseSlice) group.releaseSlices.add(record.releaseSlice);
      }
    }
    for (const record of scan.acceptance) {
      for (const version of record.versions) {
        const group = groupFor(version);
        group.acceptance.push(record);
        record.requirements.forEach((id) => group.requirements.add(id));
        if (record.releaseSlice) group.releaseSlices.add(record.releaseSlice);
      }
    }
  }
  const rootScan = scans.find((scan) => path.resolve(scan.worktree.path) === root);
  const mainScan = scans.find((scan) => scan.worktree.branch === "main") || rootScan;
  const mainHead = mainScan?.worktree.head || gitText(root, ["rev-parse", "HEAD"], deadline);
  const versions = [...groups.values()].map((group) => {
    const state = stateFor(group, root, mainHead, scans, deadline);
    const runtimeState = group.pool.map((record) => record.runtimeStatus).concat(group.acceptance.map((record) => record.runtimeStatus)).find((value) => ["not_required", "aligned", "pending_runtime_upgrade"].includes(value))
      || (state.commits.some((commit) => commit.runtimeChanged) ? "pending_runtime_upgrade" : state.commits.length ? "not_required" : "blocked");
    return {
      version: group.version,
      releaseSlice: state.currentScope.releaseSlice || [...group.releaseSlices].sort()[0] || "",
      requirements: [...group.requirements].sort(),
      documents: group.documents.map((document) => ({ ref: document.ref, kind: document.kind, status: document.status, worktreeRef: document.worktreeRef })),
      sourceWorktrees: unique(group.documents.map((document) => document.worktreeRef)),
      productState: state.productState,
      engineeringState: state.engineeringState,
      releaseState: state.releaseState,
      runtimeState,
      currentEvidenceRef: state.currentEvidenceRef,
      supersededEvidenceRefs: state.supersededEvidenceRefs,
      conflicts: state.conflicts,
      gaps: [
        ...(state.productState === "unknown" ? ["product_evidence_missing_or_conflicting"] : []),
        ...(["committed", "integrated"].includes(state.engineeringState) ? [] : ["engineering_baseline_incomplete"]),
        ...(state.releaseState === "released" ? [] : ["remote_release_not_verified"])
      ]
    };
  }).sort((left, right) => compareVersions(left.version, right.version));
  const scanErrors = [...listed.errors, ...scans.flatMap((scan) => scan.worktree.readErrors.map((error) => `${scan.worktree.ref}:${error}`))];
  const scanStatus = scanErrors.length || !remaining(deadline) ? "incomplete" : "complete";
  const accepted = scanStatus === "complete" ? versions.filter((version) => version.productState === "accepted").sort((left, right) => compareVersions(left.version, right.version)).at(-1) : null;
  const inventory = {
    scanStatus,
    scanErrors: unique(scanErrors),
    worktrees: scans.map((scan) => scan.worktree),
    versions,
    latestAcceptedVersion: accepted?.version || null,
    nextVersionCandidate: accepted ? nextVersion(accepted.version) : null,
    conflicts: versions.flatMap((version) => version.conflicts),
    pmActionRequired: versions.some((version) => version.conflicts.length),
    hotfixes: []
  };
  const pool = scans.flatMap((scan) => scan.pool);
  const hotfixes = new Map();
  for (const record of pool) {
    if (!record.releaseCommit || record.versions.length) continue;
    const commit = inspectCommit(root, record.releaseCommit, mainHead, deadline);
    const current = hotfixes.get(record.releaseCommit);
    if (current?.pmAcceptanceStatus === "accepted") continue;
    hotfixes.set(record.releaseCommit, {
      commit: record.releaseCommit,
      pmAcceptanceStatus: record.pmAcceptanceStatus,
      releaseStatus: record.releaseStatus,
      integrated: Boolean(commit?.integrated),
      runtimeState: commit?.runtimeChanged ? "pending_runtime_upgrade" : commit ? "not_required" : "blocked"
    });
  }
  inventory.hotfixes = [...hotfixes.values()];
  inventory.releaseCandidates = releaseCandidates(inventory);
  inventory.pmBrief = pmBrief(inventory);
  return inventory;
}

function planningGate(inventory, targetVersion) {
  if (inventory.scanStatus !== "complete") {
    return { status: "version_inventory_incomplete", canCreate: false, missingWorktrees: inventory.scanErrors, recoveryEntry: "Restore the listed worktree and run the same scan once." };
  }
  const existing = inventory.versions.find((version) => version.version === targetVersion);
  if (existing) return { status: "version_exists", canCreate: false, version: existing };
  return { status: "available", canCreate: true, version: targetVersion };
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-version-reconciliation.js --workspace <path> [--target-version v0.5.11]");
    return;
  }
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const inventory = scanVersionInventory(workspace);
  const targetVersion = argValue("--target-version", "");
  if (targetVersion) inventory.planningGate = planningGate(inventory, targetVersion);
  console.log(JSON.stringify(inventory, null, 2));
  if (inventory.planningGate && inventory.planningGate.status !== "available") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { TOTAL_TIMEOUT_MS, parseWorktreeList, planningGate, releaseCandidates, scanVersionInventory, versionList };
