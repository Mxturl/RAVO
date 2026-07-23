"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SOURCE = path.resolve(__dirname, "..", "native", "ravo-safety-native.c");

function sourceFingerprint() {
  return crypto.createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex").slice(0, 16);
}

function binaryPath() {
  return path.join(os.tmpdir(), `ravo-safety-native-${process.platform}-${process.arch}-${sourceFingerprint()}`);
}

function parseResult(result) {
  const stdout = String(result.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : null;
  return {
    exitCode: result.status ?? 1,
    payload,
    stderr: String(result.stderr || "").trim()
  };
}

function compileNative() {
  if (process.platform !== "darwin") return { available: false, reason: "not_supported_platform" };
  const binary = binaryPath();
  if (!fs.existsSync(binary)) {
    const result = spawnSync("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", SOURCE, "-o", binary], { encoding: "utf8" });
    if (result.status !== 0) return { available: false, reason: "native_compile_failed", stderr: String(result.stderr || "").trim() };
    fs.chmodSync(binary, 0o700);
  }
  const probe = parseResult(spawnSync(binary, ["--probe"], { encoding: "utf8" }));
  if (probe.exitCode !== 0 || probe.payload?.status !== "ok") return { available: false, reason: "native_probe_failed", stderr: probe.stderr, payload: probe.payload };
  return { available: true, binary, probe: probe.payload };
}

function argsFor(operation, options = {}) {
  const rawDigest = (value) => String(value || "").replace(/^sha256:/, "");
  const required = [
    ["--root", options.root], ["--relative", options.relative], ["--quarantine", options.quarantine],
    ["--snapshot-name", options.snapshotName], ["--root-dev", options.rootIdentity?.dev],
    ["--root-ino", options.rootIdentity?.ino], ["--target-dev", options.targetIdentity?.dev],
    ["--target-ino", options.targetIdentity?.ino], ["--target-size", options.targetIdentity?.size],
    ["--target-mode", options.targetIdentity?.mode], ["--target-uid", options.targetIdentity?.uid],
    ["--target-gid", options.targetIdentity?.gid], ["--target-sha", rawDigest(options.targetIdentity?.sha256)], ["--quarantine-dev", options.quarantineIdentity?.dev],
    ["--quarantine-ino", options.quarantineIdentity?.ino]
  ];
  if (operation === "restore") {
    required.push(["--source-name", options.sourceName], ["--backup-name", options.backupName]);
    required.push(["--source-dev", options.sourceIdentity?.dev], ["--source-ino", options.sourceIdentity?.ino]);
    required.push(["--source-size", options.sourceIdentity?.size], ["--source-mode", options.sourceIdentity?.mode], ["--source-uid", options.sourceIdentity?.uid], ["--source-gid", options.sourceIdentity?.gid], ["--source-sha", rawDigest(options.sourceIdentity?.sha256)]);
  }
  const args = [operation];
  for (const [key, value] of required) {
    if (value === undefined || value === null || value === "") throw new Error(`Missing native safety option ${key}`);
    args.push(key, String(value));
  }
  return args;
}

function runNative(operation, options = {}, input = undefined) {
  const compiled = compileNative();
  if (!compiled.available) return { status: "not_supported", reason: compiled.reason, details: compiled };
  const result = parseResult(spawnSync(compiled.binary, argsFor(operation, options), { encoding: "utf8", input, maxBuffer: 16 * 1024 * 1024 }));
  if (result.payload) return { ...result.payload, exitCode: result.exitCode, stderr: result.stderr, probe: compiled.probe };
  return { status: "native_error", exitCode: result.exitCode, stderr: result.stderr, probe: compiled.probe };
}

module.exports = { binaryPath, compileNative, runNative };
