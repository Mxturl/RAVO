#!/usr/bin/env node

const path = require("node:path");
const event = process.argv[2] || "SessionStart";
const pluginRoot = path.resolve(__dirname, "..");

const context = [
  "RAVO_ACCEPTANCE_ACTIVE:",
  "Before giving delivery, acceptance, release, go-live, readiness, completed, done, or 已完成 conclusions for work you performed, proactively run ravo-release-acceptance or equivalent RAVO acceptance evidence checks.",
  `Minimum command option: node "${pluginRoot}/scripts/write-acceptance-artifact.js" --status pending_acceptance --evidence-level smoke --summary "<summary>" && node "${pluginRoot}/scripts/check-ravo-acceptance.js"`,
  "Do not wait for the user to ask whether work can be accepted or released.",
  "If evidence is incomplete, report not_ready, in_progress, or code_complete; do not claim accepted, release_ready, live, 可发版, 验收通过, 已上线, or 已发布.",
  "Do not say 已完成, completed, or done after changing files or running requested work unless the acceptance check has run or you explicitly state code_complete/not_ready with the evidence gap.",
  "UserPromptSubmit acceptance hooks are fallback only and must not be treated as the primary agent-initiated gate."
].join("\n");

process.stdout.write(JSON.stringify({
  systemMessage: "RAVO_ACCEPTANCE_ACTIVE",
  hookSpecificOutput: {
    hookEventName: event,
    additionalContext: context
  }
}));
