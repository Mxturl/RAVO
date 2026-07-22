#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "1.0";
const STAGES = new Set(["capture", "align", "specify", "build", "verify", "integrate", "experience", "release", "operate", "learn"]);
const PRODUCT_STATES = new Set([
  "needs_alignment",
  "planned",
  "in_progress",
  "validated",
  "locally_available",
  "awaiting_pm",
  "accepted",
  "release_ready",
  "released",
  "blocked",
  "degraded",
  "unknown"
]);
const ACTIONS = new Set([
  "none",
  "clarify_scope",
  "approve_scope",
  "choose_option",
  "experience_acceptance",
  "authorize_exception",
  "acknowledge_risk"
]);

const INTERNAL_TERMS = [
  ["artifact", /\bartifact\b/i],
  ["worktree", /\bworktree\b/i],
  ["merge-tree", /\bmerge-tree\b/i],
  ["detached", /\bdetached\b/i],
  ["HEAD", /\bHEAD\b/],
  ["commit", /\bcommit\b/i],
  ["branch", /\bbranch\b/i],
  ["Runtime", /\bruntime\b/i],
  ["integration owner", /\bintegration\s+owner\b/i],
  ["pending_pm", /\bpending_pm\b/i],
  ["candidate_ready", /\bcandidate_ready\b/i],
  ["release_ready", /\brelease_ready\b/i],
  ["blocked_external", /\bblocked_external\b/i],
  ["sourceRef", /\bsource\s*refs?\b/i],
  ["Spec ref", /\bspec\s+refs?\b/i]
];

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(string).filter(Boolean))];
}

function normalizeDecisionCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    question: string(value.question),
    whyNow: string(value.whyNow),
    recommendation: string(value.recommendation),
    options: (Array.isArray(value.options) ? value.options : []).map((option) => ({
      id: string(option?.id),
      label: string(option?.label),
      outcome: string(option?.outcome)
    })),
    waitingImpact: string(value.waitingImpact)
  };
}

function buildPmBrief(input = {}) {
  const brief = {
    schemaVersion: SCHEMA_VERSION,
    headline: string(input.headline),
    stage: string(input.stage),
    productState: string(input.productState),
    userImpact: string(input.userImpact),
    actionRequired: string(input.actionRequired || "none"),
    nextStep: string(input.nextStep),
    decisionCard: normalizeDecisionCard(input.decisionCard),
    evidenceBoundary: {
      proves: strings(input.evidenceBoundary?.proves),
      doesNotProve: strings(input.evidenceBoundary?.doesNotProve)
    },
    sourceRefs: strings(input.sourceRefs)
  };
  const errors = validatePmBrief(brief);
  if (errors.length) {
    const error = new Error(`Invalid PM Brief:\n${errors.join("\n")}`);
    error.code = "INVALID_PM_BRIEF";
    error.validationErrors = errors;
    throw error;
  }
  return brief;
}

function plainLanguageFindings(value) {
  const text = string(value);
  return INTERNAL_TERMS.filter(([, pattern]) => pattern.test(text)).map(([term]) => term);
}

function decisionTextEntries(card) {
  if (!card) return [];
  return [
    ["decisionCard.question", card.question],
    ["decisionCard.whyNow", card.whyNow],
    ["decisionCard.recommendation", card.recommendation],
    ["decisionCard.waitingImpact", card.waitingImpact],
    ...card.options.flatMap((option, index) => [
      [`decisionCard.options[${index}].label`, option.label],
      [`decisionCard.options[${index}].outcome`, option.outcome]
    ])
  ];
}

function validateDecisionCard(card) {
  const errors = [];
  if (!card || typeof card !== "object" || Array.isArray(card)) return ["decisionCard is required when PM action is required."];
  for (const field of ["question", "whyNow", "recommendation", "waitingImpact"]) {
    if (!string(card[field])) errors.push(`decisionCard.${field} is required.`);
  }
  if (!Array.isArray(card.options) || card.options.length < 2) {
    errors.push("decisionCard.options requires at least two mutually exclusive options.");
  } else {
    const ids = new Set();
    card.options.forEach((option, index) => {
      for (const field of ["id", "label", "outcome"]) {
        if (!string(option?.[field])) errors.push(`decisionCard.options[${index}].${field} is required.`);
      }
      if (string(option?.id)) ids.add(string(option.id));
    });
    if (ids.size !== card.options.length) errors.push("decisionCard option ids must be unique.");
  }
  if ((card.question.match(/[?？]/g) || []).length > 1) {
    errors.push("decisionCard.question must contain only one product question.");
  }
  return errors;
}

function markdownLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function validatePmMarkdown(markdown, options = {}) {
  const errors = [];
  const lines = markdownLines(markdown);
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line));
  const content = lines.filter((line) => !/^#{1,6}\s+/.test(line));
  const normalized = content.map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, "").trim()).filter(Boolean);
  const seen = new Set();
  for (const line of normalized) {
    if (seen.has(line)) errors.push("PM document contains a repeated paragraph.");
    seen.add(line);
  }
  for (const [index, heading] of headings.entries()) {
    const lineIndex = lines.indexOf(heading);
    const next = lines[lineIndex + 1] || "";
    if (!next || /^#{1,6}\s+/.test(next)) errors.push(`PM document contains an empty section: ${heading}`);
  }
  for (const line of lines) {
    if (/^(?:[-*]\s*)?(?:source refs?|路径|命令|状态码|git\s+baseline|baseline)\s*[:：]/i.test(line)) {
      errors.push("PM document exposes implementation evidence in the primary projection.");
    }
    const terms = plainLanguageFindings(line);
    if (terms.length && !/^#{1,6}\s+/.test(line)) errors.push(`PM document contains unexplained internal term(s): ${terms.join(", ")}.`);
  }
  if (options.kind === "acceptance") {
    if (options.actionRequired === "none" && (lines.length < 5 || lines.length > 8)) {
      errors.push("No-action PM acceptance document must contain 5 to 8 non-empty lines.");
    }
    const steps = lines.filter((line) => /^\d+\.\s+/.test(line));
    if (steps.length > 3) errors.push("PM experience acceptance must contain at most three steps.");
  }
  return [...new Set(errors)];
}

function validatePmBrief(brief, options = {}) {
  const errors = [];
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return ["pmBrief must be an object."];
  if (brief.schemaVersion !== SCHEMA_VERSION) errors.push(`pmBrief.schemaVersion must be ${SCHEMA_VERSION}.`);
  for (const field of ["headline", "userImpact", "nextStep"]) if (!string(brief[field])) errors.push(`pmBrief.${field} is required.`);
  if (!STAGES.has(brief.stage)) errors.push("pmBrief.stage is invalid.");
  if (!PRODUCT_STATES.has(brief.productState)) errors.push("pmBrief.productState is invalid.");
  if (!ACTIONS.has(brief.actionRequired)) errors.push("pmBrief.actionRequired is invalid.");

  if (brief.actionRequired === "none") {
    if (brief.decisionCard !== null) errors.push("pmBrief.decisionCard must be null when no PM action is required.");
    if (brief.productState === "awaiting_pm") errors.push("pmBrief.productState=awaiting_pm requires PM action.");
    if (/(?:请确认|请决定|是否继续|请批准)/.test(brief.nextStep)) errors.push("pmBrief.actionRequired=none cannot request PM confirmation.");
  } else {
    errors.push(...validateDecisionCard(brief.decisionCard).map((item) => `pmBrief.${item}`));
    if (!["awaiting_pm", "blocked"].includes(brief.productState)) {
      errors.push("PM action requires pmBrief.productState awaiting_pm or blocked.");
    }
  }

  for (const field of ["proves", "doesNotProve"]) {
    if (!Array.isArray(brief.evidenceBoundary?.[field]) || !brief.evidenceBoundary[field].length || brief.evidenceBoundary[field].some((item) => !string(item))) {
      errors.push(`pmBrief.evidenceBoundary.${field} requires at least one non-empty entry.`);
    }
  }
  if (!Array.isArray(brief.sourceRefs) || !brief.sourceRefs.length || brief.sourceRefs.some((item) => !string(item))) {
    errors.push("pmBrief.sourceRefs requires at least one non-empty reference.");
  }

  if (options.plainLanguage !== false) {
    const entries = [
      ["headline", brief.headline],
      ["userImpact", brief.userImpact],
      ["nextStep", brief.nextStep],
      ...decisionTextEntries(brief.decisionCard)
    ];
    for (const [field, value] of entries) {
      const terms = plainLanguageFindings(value);
      if (terms.length) errors.push(`pmBrief.${field} contains unexplained internal term(s): ${terms.join(", ")}.`);
    }
  }
  return errors;
}

function checkFile(file) {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!artifact.pmBrief) return { file, errors: ["Artifact does not contain pmBrief."] };
  return { file, errors: validatePmBrief(artifact.pmBrief) };
}

function jsonFiles(root) {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(file);
    }
  };
  visit(root);
  return files;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: ravo-pm-brief.js --check <artifact.json> | --workspace <path>");
    return;
  }
  if (process.argv.includes("--version")) {
    console.log(SCHEMA_VERSION);
    return;
  }
  const checkIndex = process.argv.indexOf("--check");
  const workspaceIndex = process.argv.indexOf("--workspace");
  let results = [];
  if (checkIndex >= 0) {
    const file = path.resolve(process.argv[checkIndex + 1] || "");
    results = [checkFile(file)];
  } else if (workspaceIndex >= 0) {
    const workspace = path.resolve(process.argv[workspaceIndex + 1] || process.cwd());
    results = jsonFiles(path.join(workspace, "knowledge", ".ravo"))
      .map((file) => ({ file, artifact: JSON.parse(fs.readFileSync(file, "utf8")) }))
      .filter((entry) => entry.artifact.pmBrief)
      .map((entry) => ({ file: entry.file, errors: validatePmBrief(entry.artifact.pmBrief) }));
  } else {
    process.stderr.write("Provide --check or --workspace.\n");
    process.exit(1);
  }
  const failures = results.filter((entry) => entry.errors.length);
  console.log(JSON.stringify({ status: failures.length ? "fail" : "pass", checked: results.length, failures }, null, 2));
  if (failures.length) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  ACTIONS,
  PRODUCT_STATES,
  SCHEMA_VERSION,
  STAGES,
  buildPmBrief,
  plainLanguageFindings,
  validatePmMarkdown,
  validatePmBrief
};
