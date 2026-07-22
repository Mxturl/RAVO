#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BEGIN = "<!-- RAVO:BEGIN -->";
const END = "<!-- RAVO:END -->";
const SNIPPET = `${BEGIN}
- Keep simple questions, read-only checks, and clear bounded low-risk work direct. Use an existing Codex Goal for clear multi-turn work only when the host starts or authorizes it; reuse an active Goal, and do not recreate a terminal or parked Goal because the user only says “continue”.
- Use RAVO Analysis to systematically shape important or ambiguous requirements. For bugs, find the actual cause with minimal RCA; use full RCA when recurring, uncertain, shared, high-impact, data, security, or permission related.
- Use Workstream only for long-running work, Knowledge when relevant history may change a non-trivial result, and RAVO Review for real high-risk proposals. Validate every change, but allow simple low-risk work to omit a dedicated evidence artifact when its cost is disproportionate; complex and high-order status claims require traceable evidence and RAVO Acceptance.
- Ordinary clear Codex Goals do not require a Spec. A RAVO version-delivery, Release Slice, acceptance, go-live, or publication Goal Prompt requires a current decision-complete Spec and commits only that Slice. Explicit new requirements, follow-up issues, and reusable lessons are visibly recorded in the Pool or Knowledge before phase closeout; scope-changing content uses Spec Delta.
- When a PM asks for next-version candidates, resolve a valid active Workstream's decision-complete \`specRef\` as the explicit version, then use the SoloDesk \`next_version_candidates\` projection and return the PM list directly; candidates never become the Release Slice automatically.
- Status language must match evidence. Never bypass data, credentials, permissions, destructive-action, external-call, or release authorization boundaries.
- For non-trivial work, end a phase with one concrete, owner-assigned next step. When a decision is settled and the remaining work is safe and in scope, Codex owns that step; do not ask the user to reconfirm it. Omit this for simple answers.
${END}`;

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function targetText(current) {
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) {
    return `${current.slice(0, start)}${SNIPPET}${current.slice(end + END.length)}`;
  }
  return `${current.replace(/\s*$/, "")}\n\n${SNIPPET}\n`;
}

function diffPreview(before, after) {
  if (before === after) return "No changes.";
  return [
    "--- before",
    "+++ after",
    `@@ ${before.length} -> ${after.length} chars @@`,
    after.slice(Math.max(0, after.indexOf(BEGIN) - 120), after.indexOf(END) + END.length + 120)
  ].join("\n");
}

function main() {
  const file = path.resolve(argValue("--file", path.join(os.homedir(), ".codex", "AGENTS.md")));
  const restore = argValue("--restore", "");
  if (restore) {
    const backup = path.resolve(restore);
    if (!fs.existsSync(backup)) throw new Error(`Backup not found: ${backup}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, fs.readFileSync(backup, "utf8"));
    console.log(`restored=${file}`);
    return;
  }

  const apply = process.argv.includes("--apply");
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const after = targetText(before);

  if (!apply) {
    console.log(`target=${file}`);
    console.log(diffPreview(before, after));
    console.log("\nPreview only. Re-run with --apply to write.");
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const backup = `${file}.ravo-bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    console.log(`backup=${backup}`);
  }
  writeAtomic(file, after);
  console.log(`updated=${file}`);
}

if (require.main === module) main();
