#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BEGIN = "<!-- RAVO:BEGIN -->";
const END = "<!-- RAVO:END -->";
const SNIPPET = `${BEGIN}
- AGENTS.md decides when to delegate; a delegated RAVO skill/plugin decides how to execute within that scope.
- For medium/high-complexity requirement, solution, architecture, agent-workflow, semantic-model, root-cause, planning, and tradeoff tasks, prefer ravo-analysis when available. If unavailable, perform a lightweight inline equivalent: goal, constraints, facts, assumptions, options, challenge, conclusion, and validation.
- Do not force first-principles structure for simple concept explanations, term definitions, direct factual Q&A, or basic how-to questions unless the user explicitly asks for deeper analysis.
- For delivery, acceptance, release, go-live, readiness, done, or completed conclusions, prefer ravo-acceptance when available. If unavailable, explicitly list evidence and gaps before any status claim. Prompt-time hooks are fallback only; status language must match evidence.
- RAVO modules connect through knowledge/.ravo/manifest.json and artifacts. Do not require all modules for small, clearly bounded tasks.
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
