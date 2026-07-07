#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const BEGIN = "<!-- RAVO:BEGIN -->";
const END = "<!-- RAVO:END -->";
const SNIPPET = `${BEGIN}
- Use RAVO for medium/high-complexity AI-agent lifecycle work: analysis, acceptance, workstream handoff, and knowledge reuse.
- Prefer ravo-analysis for important requirement, solution, architecture, and root-cause analysis; conclusions must derive from goal, constraints, facts, and mechanism-level cause.
- Proactively run ravo-acceptance before asking the user to accept work or before claiming pending acceptance, accepted, release ready, or live. User-prompt acceptance hooks are fallback only; status language must match evidence.
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
  const file = path.resolve(argValue("--file", path.join(process.cwd(), "AGENTS.md")));
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
