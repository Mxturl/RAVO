#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { HOOK_TIMEOUT_MS, buildNotification } = require("../scripts/ravo-permission-notify");

const CONTROL_FILE_NAME = "permission-notify.json";
const CONTROL_SCHEMA_VERSION = 1;
const MODES = new Set(["disabled", "observe", "enabled"]);

function controlFile(options = {}) {
  return options.controlFile || path.join(options.home || os.homedir(), ".codex", "ravo", CONTROL_FILE_NAME);
}

function readControl(options = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(controlFile(options), "utf8"));
    return {
      mode: MODES.has(value.mode) ? value.mode : "disabled",
      lastVerification: String(value.lastVerification || ""),
      lastDelivery: String(value.lastDelivery || "")
    };
  } catch (_error) {
    return { mode: "disabled", lastVerification: "", lastDelivery: "" };
  }
}

function writeControl(state, options = {}) {
  const file = controlFile(options);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const value = {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    mode: MODES.has(state.mode) ? state.mode : "disabled",
    lastVerification: String(state.lastVerification || ""),
    lastDelivery: String(state.lastDelivery || ""),
    updatedAt: new Date().toISOString()
  };
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
  return value;
}

function parseJson(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch (_error) {
    return null;
  }
}

function findOpenId(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.open_id === "string" && value.open_id) return value.open_id;
  for (const child of Object.values(value)) {
    const openId = findOpenId(child);
    if (openId) return openId;
  }
  return "";
}

function defaultRun(args, timeoutMs) {
  try {
    const result = spawnSync("lark-cli", args, {
      encoding: "utf8",
      timeout: Math.max(1, timeoutMs),
      maxBuffer: 1024 * 1024
    });
    return result.error || result.status !== 0 ? null : { stdout: String(result.stdout || "") };
  } catch (_error) {
    return null;
  }
}

function deliverCard(card, options = {}) {
  const startedAt = options.startedAt || Date.now();
  const deadline = startedAt + (options.timeoutMs || HOOK_TIMEOUT_MS);
  const run = options.run || defaultRun;
  const remaining = () => deadline - Date.now();

  let timeLeft = remaining();
  if (timeLeft <= 0) return { delivered: false, reason: "timeout" };
  const self = run(["contact", "+get-user", "--as", "user"], timeLeft);
  const userId = findOpenId(parseJson(self?.stdout));
  if (!userId) return { delivered: false, reason: "recipient_unavailable" };

  timeLeft = remaining();
  if (timeLeft <= 0) return { delivered: false, reason: "timeout" };
  const sent = run([
    "im", "+messages-send",
    "--user-id", userId,
    "--as", "bot",
    "--msg-type", "interactive",
    "--content", JSON.stringify(card),
    "--idempotency-key", crypto.randomUUID()
  ], timeLeft);
  return sent ? { delivered: true, reason: "accepted" } : { delivered: false, reason: "delivery_failed" };
}

function handlePermissionRequest(payload, options = {}) {
  const current = readControl(options);
  if (current.mode === "disabled") return { mode: "disabled", sent: false };

  try {
    const notification = buildNotification(payload, options);
    if (!notification.deliveryEligible) {
      if (current.mode === "observe") {
        writeControl({ ...current, lastVerification: notification.reason || "unmatched" }, options);
      }
      return { mode: current.mode, sent: false, reason: notification.reason || "unmatched" };
    }

    if (current.mode === "observe") {
      writeControl({ mode: "enabled", lastVerification: "matched", lastDelivery: "" }, options);
      return { mode: "enabled", sent: false, reason: "armed" };
    }

    const delivery = deliverCard(notification.card, options);
    writeControl({ ...current, lastDelivery: delivery.reason }, options);
    return { mode: "enabled", sent: delivery.delivered, reason: delivery.reason };
  } catch (_error) {
    try { writeControl({ ...current, lastDelivery: "failed" }, options); } catch (_writeError) { /* fail open */ }
    return { mode: current.mode, sent: false, reason: "failed" };
  }
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
  } catch (_error) {
    return {};
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--arm")) {
    const state = writeControl({ mode: "observe", lastVerification: "", lastDelivery: "" });
    process.stdout.write(`${JSON.stringify({ mode: state.mode })}\n`);
    return;
  }
  if (args.includes("--disable")) {
    const state = writeControl({ mode: "disabled", lastVerification: "", lastDelivery: "" });
    process.stdout.write(`${JSON.stringify({ mode: state.mode })}\n`);
    return;
  }
  if (args.includes("--status")) {
    const state = readControl();
    process.stdout.write(`${JSON.stringify(state)}\n`);
    return;
  }
  handlePermissionRequest(readPayload());
}

if (require.main === module) main();

module.exports = {
  CONTROL_FILE_NAME,
  CONTROL_SCHEMA_VERSION,
  controlFile,
  deliverCard,
  findOpenId,
  handlePermissionRequest,
  readControl,
  writeControl
};
