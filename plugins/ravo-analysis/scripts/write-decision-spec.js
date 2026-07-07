#!/usr/bin/env node

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

function slug(value) {
  return String(value || "decision-complete-spec")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "decision-complete-spec";
}

function sectionList(items, fallback) {
  const values = items.length ? items : [fallback];
  return values.map((item) => `- ${item}`).join("\n");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const title = argValue("--title", "Decision Complete Spec").trim();
  const goal = argValue("--goal", "").trim();
  const consumer = argValue("--consumer", "").trim();
  if (!goal) fail("Decision-complete spec requires --goal.");
  if (!consumer) fail("Decision-complete spec requires --consumer.");

  const now = new Date().toISOString();
  const fileName = `${slug(title)}-decision-complete-spec.md`;
  const specPath = path.join(workspace, "docs", fileName);
  const text = `# ${title} Decision-Complete Spec

Status: ${argValue("--status", "draft")}
Created: ${now}

## Product Definition

Goal: ${goal}

Consumer: ${consumer}

## Scope

In scope:

${sectionList(argValues("--in-scope"), "Define the smallest scope that satisfies the goal.")}

Out of scope:

${sectionList(argValues("--out-of-scope"), "List explicit non-goals before implementation.")}

## Module Contracts

${sectionList(argValues("--contract"), "Define inputs, outputs, ownership, and artifact/API shape for each module or feature.")}

## Inputs And Outputs

Inputs:

${sectionList(argValues("--input"), "List user inputs, existing files, APIs, or artifacts required.")}

Outputs:

${sectionList(argValues("--output"), "List expected files, APIs, artifacts, UI states, or user-visible results.")}

## Trigger Rules

${sectionList(argValues("--trigger"), "Define when this behavior should and should not activate.")}

## Validation Matrix

${sectionList(argValues("--validation"), "Add at least one mechanically checkable validation scenario.")}

## Failure And Fallback Behavior

${sectionList(argValues("--fallback"), "Define what happens when evidence, inputs, permissions, or dependencies are missing.")}

## Assumptions

${sectionList(argValues("--assumption"), "Record assumptions that should be verified or challenged.")}
`;

  writeAtomic(specPath, text);
  console.log(JSON.stringify({
    status: "ok",
    specPath
  }, null, 2));
}

if (require.main === module) main();
