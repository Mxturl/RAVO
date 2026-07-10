#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCHEMA_VERSION = "0.3.1";
const STATUSES = new Set(["in_progress", "code_complete", "pending_acceptance", "accepted", "release_ready", "not_ready"]);
const EVIDENCE_LEVELS = new Set(["none", "notes", "script", "api", "smoke", "real_e2e", "full_external_review", "partial_external_review"]);
const SECURITY_ITEMS = [
  "data_privacy",
  "credentials",
  "permissions",
  "destructive_actions",
  "external_calls",
  "dependencies",
  "logs_artifacts",
  "global_knowledge"
];

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function slug(value) {
  return String(value || "acceptance")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "acceptance";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return null;
  }
}

function readRavoConfig(workspace) {
  return {
    ...(readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json")) || {}),
    ...(readJson(path.join(workspace, "knowledge", ".ravo", "config.json")) || {})
  };
}

function technicalDetailLevel(workspace) {
  const level = readRavoConfig(workspace).technicalDetailLevel;
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : 3;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1] || "");
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function buildSecurityChecklist(passed) {
  const passedSet = new Set(passed);
  return SECURITY_ITEMS.map((id) => ({
    id,
    status: passedSet.has(id) ? "pass" : "unknown"
  }));
}

function pmDocFor(artifact) {
  const rows = artifact.acceptanceItems.length
    ? artifact.acceptanceItems.map((item) => {
        try { return JSON.parse(item); } catch (_err) { return { name: item, expected: "", implementation: "", effect: "", judgment: "待补证据" }; }
      })
    : [{ name: "整体验收", expected: artifact.summary, implementation: "见实现产物和证据引用。", effect: artifact.summary, judgment: artifact.status === "accepted" ? "基本满足" : "待补证据" }];
  const table = rows.map((item) => `| ${item.name || "验收项"} | ${item.expected || artifact.summary} | ${item.implementation || "见证据引用"} | ${item.effect || artifact.summary} | ${item.judgment || "待补证据"} |`).join("\n");
  return `# 面向产品经理的验收文档

## 验收结论摘要

${artifact.summary}

状态：${artifact.status}

证据等级：${artifact.evidenceLevel}

## 需求预期与实现效果

| 验收项 | 需求预期 | 当前实现方案 | 当前实现效果 | 验收判断 |
|---|---|---|---|---|
${table}

## PM 验收清单

${rows.map((item) => `- ${item.name || "整体验收"}：${item.judgment || "待补证据"}`).join("\n")}

## 真实响应证据

${artifact.realResponseRefs.length ? artifact.realResponseRefs.map((item) => `- ${item}`).join("\n") : "- 待补证据"}

## 截图/录屏或替代证据

${artifact.screenshotRefs.length ? artifact.screenshotRefs.map((item) => `- ${item}`).join("\n") : artifact.notApplicableEvidence.length ? artifact.notApplicableEvidence.map((item) => `- ${item}`).join("\n") : "- 待补证据"}

## 数据、CLI、日志或产物证据

${artifact.dataEvidenceRefs.length ? artifact.dataEvidenceRefs.map((item) => `- ${item}`).join("\n") : artifact.evidence.map((item) => `- ${item}`).join("\n") || "- 待补证据"}

## 未满足项与风险

${artifact.unmetItems.length ? artifact.unmetItems.map((item) => `- ${item}`).join("\n") : artifact.knownGaps.map((item) => `- ${item}`).join("\n") || "- 暂无明确未满足项；仍需按证据等级复核。"}
`;
}

function validateState(status, evidenceLevel, securityChecklist) {
  if (!STATUSES.has(status)) fail(`Unsupported acceptance status: ${status}`);
  if (!EVIDENCE_LEVELS.has(evidenceLevel)) fail(`Unsupported evidence level: ${evidenceLevel}`);
  const allSecurityPass = securityChecklist.every((item) => item.status === "pass");
  if (["accepted", "release_ready"].includes(status) && !allSecurityPass) {
    fail("accepted/release_ready requires all security baseline items via --security-pass.");
  }
  if (status === "release_ready" && evidenceLevel !== "real_e2e" && evidenceLevel !== "full_external_review") {
    fail("release_ready requires --evidence-level real_e2e or full_external_review.");
  }
  if (status === "accepted" && !["smoke", "real_e2e", "full_external_review"].includes(evidenceLevel)) {
    fail("accepted requires smoke, real_e2e, or full_external_review evidence.");
  }
}

function ensureManifest(workspace, latestArtifact) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: SCHEMA_VERSION,
    workspace: ".",
    modules: {}
  };
  manifest.modules = manifest.modules || {};
  manifest.modules.acceptance = {
    ...(manifest.modules.acceptance || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/acceptance"],
    latestArtifact: path.relative(workspace, latestArtifact),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "not_ready");
  const evidenceLevel = argValue("--evidence-level", "notes");
  const summary = argValue("--summary", "Acceptance artifact created.");
  const securityChecklist = buildSecurityChecklist(argValues("--security-pass"));
  validateState(status, evidenceLevel, securityChecklist);
  const now = new Date().toISOString();
  const id = `${now.replace(/[:.]/g, "-")}-${slug(summary)}`;
  const detailLevel = technicalDetailLevel(workspace);
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status,
    evidenceLevel,
    technicalDetailLevel: detailLevel,
    outputMode: detailLevel <= 2 ? "product" : detailLevel >= 4 ? "engineering" : "balanced",
    summary,
    createdAt: now,
    analysisArtifact: argValue("--analysis-artifact", ""),
    evidence: argValues("--evidence"),
    knownGaps: argValues("--known-gap"),
    pmChecklistRef: "",
    realResponseRefs: argValues("--real-response-ref"),
    screenshotRefs: argValues("--screenshot-ref"),
    dataEvidenceRefs: argValues("--data-evidence-ref"),
    acceptanceItems: argValues("--acceptance-item"),
    unmetItems: argValues("--unmet-item"),
    notApplicableEvidence: argValues("--not-applicable-evidence"),
    securityChecklist
  };

  const artifactPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${id}.json`);
  const pmDocPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${id}-pm-acceptance.md`);
  artifact.pmChecklistRef = path.relative(workspace, pmDocPath);
  fs.mkdirSync(path.dirname(pmDocPath), { recursive: true });
  fs.writeFileSync(pmDocPath, pmDocFor(artifact));
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, pmChecklistPath: pmDocPath, manifestPath }, null, 2));
}

if (require.main === module) main();
