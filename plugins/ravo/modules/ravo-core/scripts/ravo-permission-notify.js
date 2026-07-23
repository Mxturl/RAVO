#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const QUERY_TIMEOUT_MS = 1000;
const HOOK_TIMEOUT_MS = 8000;
const TITLE_FALLBACK = "任务标题不可用";
const PROJECT_FALLBACK = "项目不可用";
const FIELD_NAMES = Object.freeze(["任务标题", "项目", "介入原因", "授权类型"]);
const CARD_TITLE = "需要人工介入";

function buildCard(fields) {
  return {
    schema: "2.0",
    config: {
      width_mode: "default"
    },
    header: {
      title: { tag: "plain_text", content: CARD_TITLE },
      template: "orange",
      icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" }
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "medium",
      elements: [
        {
          tag: "div",
          icon: { tag: "standard_icon", token: "chat_outlined", color: "orange" },
          text: {
            tag: "plain_text",
            content: `任务标题：${fields["任务标题"]}`,
            text_align: "left",
            text_size: "heading-4",
            text_color: "orange",
            lines: 2
          },
          fields: [
            {
              is_short: true,
              text: {
                tag: "plain_text",
                content: `项目\n${fields["项目"]}`
              }
            }
          ],
          margin: "0px 0px 12px 0px"
        },
        {
          tag: "div",
          icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" },
          text: {
            tag: "plain_text",
            content: `介入原因：${fields["介入原因"]}`,
            text_align: "left",
            text_size: "normal",
            text_color: "default",
            lines: 2
          },
          fields: [
            {
              is_short: true,
              text: {
                tag: "plain_text",
                content: `授权类型\n${fields["授权类型"]}`
              }
            }
          ]
        }
      ]
    }
  };
}

function displayText(value, fallback, maxLength) {
  const text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function safeTitle(value) {
  // ponytail: common path/secret patterns only; require a stable safe-title source before real delivery.
  const title = displayText(value, "", 120);
  if (!title) return "";
  if (/(?:^|[\s"'(=:])(?:\/|~\/|[A-Za-z]:[\\/])/.test(title)) return "";
  if (/(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|(?:api[_ -]?key|token|secret|password)\s*[:=]|(?:bearer\s+|xox[baprs]-|gh[pous]_)[A-Za-z0-9._-]{10,})/i.test(title)) return "";
  return title;
}

function projectName(cwd) {
  const raw = String(cwd || "").replace(/[\\/]+$/, "");
  const posixBase = path.basename(raw);
  const base = posixBase === raw ? path.win32.basename(raw) : posixBase;
  if (!base || base === "." || base === "..") return PROJECT_FALLBACK;
  return displayText(base, PROJECT_FALLBACK, 80);
}

function classifyTool(toolName) {
  if (toolName === "Bash") return { reason: "需要确认执行命令", authorizationType: "命令执行" };
  if (toolName === "apply_patch") return { reason: "需要确认修改文件", authorizationType: "文件修改" };
  if (String(toolName || "").startsWith("mcp__")) return { reason: "需要确认调用工具", authorizationType: "MCP 调用" };
  return { reason: "需要确认操作", authorizationType: "其他" };
}

function resolveStateDatabase(options = {}) {
  if (options.stateDb) return String(options.stateDb);
  const codexDir = path.join(options.home || os.homedir(), ".codex");
  try {
    const matches = fs.readdirSync(codexDir)
      .filter((name) => /^state_\d+\.sqlite$/.test(name))
      .sort();
    return matches.length === 1 ? path.join(codexDir, matches[0]) : "";
  } catch (_error) {
    return "";
  }
}

function lookupTitle(sessionId, stateDb) {
  if (!sessionId || !stateDb) return { matched: false, title: "" };
  let database;
  try {
    database = new DatabaseSync(stateDb, { readOnly: true });
    database.exec(`PRAGMA busy_timeout = ${QUERY_TIMEOUT_MS}`);
    const rows = database.prepare("SELECT title FROM threads WHERE id = ? LIMIT 2").all(sessionId);
    const title = rows.length === 1 ? safeTitle(rows[0].title) : "";
    return { matched: Boolean(title), title };
  } catch (_error) {
    return { matched: false, title: "" };
  } finally {
    database?.close();
  }
}

function buildNotification(payload, options = {}) {
  const startedAt = Date.now();
  const eventName = String(payload?.hook_event_name || "");
  if (eventName && eventName !== "PermissionRequest") {
    return { deliveryEligible: false, reason: "not_permission_request", fields: null, card: null, elapsedMs: 0 };
  }

  const sessionId = String(payload?.session_id || "").trim();
  const state = lookupTitle(sessionId, resolveStateDatabase(options));
  const classification = classifyTool(payload?.tool_name);
  const elapsedMs = Date.now() - startedAt;
  const fields = {
    "任务标题": state.title || TITLE_FALLBACK,
    "项目": projectName(payload?.cwd),
    "介入原因": classification.reason,
    "授权类型": classification.authorizationType
  };
  const card = buildCard(fields);

  return {
    deliveryEligible: state.matched && elapsedMs <= HOOK_TIMEOUT_MS,
    reason: state.matched ? (elapsedMs <= HOOK_TIMEOUT_MS ? "ready" : "timeout") : "title_unavailable",
    fields,
    card,
    elapsedMs
  };
}

function readJsonStdin() {
  try {
    const input = fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(input);
  } catch (_error) {
    return {};
  }
}

function parseArgs(args) {
  const options = { dryRun: false, stateDb: "", help: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dry-run") options.dryRun = true;
    else if (args[index] === "--state-db") options.stateDb = args[index + 1] || "";
    else if (args[index] === "--help" || args[index] === "-h") options.help = true;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: ravo-permission-notify.js [--dry-run] [--state-db <sqlite>]\n");
    return;
  }

  const result = buildNotification(readJsonStdin(), options);
  if (options.dryRun) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = {
  FIELD_NAMES,
  CARD_TITLE,
  HOOK_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  TITLE_FALLBACK,
  buildCard,
  buildNotification,
  classifyTool,
  lookupTitle,
  projectName,
  resolveStateDatabase,
  safeTitle
};
