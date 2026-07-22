#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { captureGitBaseline, cleanWorktrees, finalizeGitBaseline } = require("../plugins/ravo/modules/ravo-core/scripts/ravo-git-baseline");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-git-baseline-")));
const env = { ...process.env, GIT_AUTHOR_NAME: "RAVO Test", GIT_AUTHOR_EMAIL: "ravo@example.invalid", GIT_COMMITTER_NAME: "RAVO Test", GIT_COMMITTER_EMAIL: "ravo@example.invalid" };
const git = (args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });

git(["init", "-q"]);
fs.writeFileSync(path.join(root, "pre-existing.txt"), "existing\n");
git(["add", "pre-existing.txt"]);
git(["commit", "-qm", "initial"]);

const startup = captureGitBaseline(root, { env });
assert.ok(startup.branch, "startup snapshot records the current branch");
fs.writeFileSync(path.join(root, "task-owned.txt"), "owned\n");
const committed = finalizeGitBaseline(startup, { env, taskOwnedPaths: ["task-owned.txt"], releaseSlice: "test-slice", requirementRange: "R054-001..012" });
assert.equal(committed.status, "committed");
assert.match(committed.baselineRef, /^git-commit:/);
assert.equal(committed.preExisting.length, 0);
assert.equal(committed.remoteMutation.push, false);
assert.equal(git(["status", "--porcelain"]), "");

const mixedStartup = captureGitBaseline(root, { env });
fs.appendFileSync(path.join(root, "task-owned.txt"), "mixed\n");
const mixed = finalizeGitBaseline(mixedStartup, { env });
assert.equal(mixed.status, "commit_blocked");
assert.ok(mixed.mixedOrUnknown.includes("task-owned.txt"));

const secretStartup = captureGitBaseline(root, { env });
const fakeApiSecret = ["sk", "abcdefghijklmnop"].join("-");
fs.writeFileSync(path.join(root, "secret.txt"), `api_key=${fakeApiSecret}\n`);
const secret = finalizeGitBaseline(secretStartup, { env, taskOwnedPaths: ["secret.txt"] });
assert.equal(secret.status, "commit_blocked");
assert.equal(secret.securityFindings[0].code, "api_secret_token");

const worktreeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-git-worktree-")));
git(["worktree", "add", "-q", "-b", "ravo-test-clean", worktreeRoot, "HEAD"]);
fs.writeFileSync(path.join(worktreeRoot, ".ravo-worktree.json"), JSON.stringify({ owner: "ravo", recoveryRef: "git:test" }));
git(["-C", worktreeRoot, "add", ".ravo-worktree.json"]);
git(["-C", worktreeRoot, "commit", "-qm", "worktree marker"]);
const cleanup = cleanWorktrees(captureGitBaseline(root, { env }), { env, ownedWorktrees: [worktreeRoot] });
assert.equal(cleanup.results.find((entry) => entry.path === worktreeRoot).action, "removed");
assert.equal(fs.existsSync(worktreeRoot), false);

console.log(JSON.stringify({ status: "pass", checks: ["startup-snapshot", "task-owned-local-commit", "mixed-change-block", "secret-scan-block", "bounded-worktree-cleanup", "no-remote-mutation"] }, null, 2));
