#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch (_err) {
    return "";
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const summary = argValue("--summary", "").trim();
  const stdin = readStdin().trim();
  const content = argValue("--content", stdin).trim();
  if (!summary) fail("Knowledge capture requires --summary.");
  if (!content) fail("Knowledge capture requires --content or stdin.");
  if (argValue("--skip-if-low-value", "false") === "true" && !/(复用|lesson|经验|原则|边界|机制|验收|防复发|decision|evidence|risk)/i.test(`${summary}\n${content}`)) {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "low_value"
    }, null, 2));
    return;
  }

  const args = [
    path.join(__dirname, "write-knowledge-artifact.js"),
    "--workspace", workspace,
    "--kind", argValue("--kind", "lesson"),
    "--status", argValue("--status", "candidate"),
    "--title", argValue("--title", summary),
    "--summary", summary,
    "--content", content,
    "--source", argValue("--source", "agent-closeout")
  ];
  for (const value of argValues("--applicability")) args.push("--applicability", value);
  for (const value of argValues("--source-ref")) args.push("--source-ref", value);
  for (const value of argValues("--tag")) args.push("--tag", value);
  for (const value of argValues("--related-artifact")) args.push("--related-artifact", value);
  for (const value of argValues("--canary")) args.push("--canary", value);
  for (const name of ["--scope", "--opt-in", "--sensitivity"]) {
    const value = argValue(name, "");
    if (value) args.push(name, value);
  }

  const child = spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (child.status !== 0) {
    process.stderr.write(child.stderr || "Knowledge capture failed.\n");
    process.exit(child.status || 1);
  }
  const parsed = JSON.parse(child.stdout);
  console.log(JSON.stringify({
    ...parsed,
    captureNotice: parsed.globalWriteNotice
      ? parsed.globalWriteNotice
      : `Workspace-local RAVO knowledge written to ${parsed.markdownPath}.`
  }, null, 2));
}

if (require.main === module) main();
