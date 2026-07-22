#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { attemptFingerprint, normalizeTiming, normalizeWorkstream, validateWorkstream } = require("./workstream-model");

function loadPmBriefModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-pm-brief.js"),
    process.env.RAVO_PLUGIN_ROOT ? path.resolve(process.env.RAVO_PLUGIN_ROOT, "modules/ravo-core/scripts/ravo-pm-brief.js") : "",
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-pm-brief.js") : "",
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO PM Brief module is unavailable.");
  return require(file);
}

const { buildPmBrief } = loadPmBriefModule();

const SCHEMA_VERSION = "0.5.1";
const STATUSES = new Set(["planned", "active", "blocked", "ready_for_acceptance", "closed"]);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name) values.push(process.argv[i + 1] || "");
  return values.map((value) => value.trim()).filter(Boolean);
}

function slug(value) {
  return String(value || "workstream").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workstream";
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseObject(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch (_error) {
    fail(`${label} must be a valid JSON object.`);
  }
}

function resolveWorkspaceRef(workspace, ref) {
  if (!ref) return "";
  const file = path.resolve(workspace, ref);
  return file === workspace || file.startsWith(`${workspace}${path.sep}`) ? file : "";
}

function mergeById(previous, current) {
  const values = new Map();
  for (const item of [...(previous || []), ...(current || [])]) values.set(item.id || JSON.stringify(item), item);
  return [...values.values()];
}

function ensureManifest(workspace, artifactPath) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || { schemaVersion: SCHEMA_VERSION, workspace: ".", modules: {} };
  manifest.schemaVersion = manifest.schemaVersion || SCHEMA_VERSION;
  manifest.modules = manifest.modules || {};
  manifest.modules.workstream = {
    ...(manifest.modules.workstream || {}),
    enabled: true,
    artifacts: ["knowledge/.ravo/workstream"],
    latestArtifact: path.relative(workspace, artifactPath),
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "active");
  if (!STATUSES.has(status)) fail(`Unsupported workstream status: ${status}`);
  const goal = argValue("--goal", "Long-running RAVO work").trim();
  const nextStep = argValue("--next-step", "").trim();
  const blockers = argValues("--blocker");
  const recovery = argValue("--recovery", "").trim();
  if (status === "active" && !nextStep) fail("Active workstream requires --next-step.");

  const previousRef = argValue("--previous-artifact", "").trim();
  const previousFile = resolveWorkspaceRef(workspace, previousRef);
  if (previousRef && (!previousFile || !fs.existsSync(previousFile))) fail("--previous-artifact must resolve to an existing workspace JSON file.");
  const previous = previousFile ? normalizeWorkstream(readJson(previousFile) || {}) : null;
  const now = new Date().toISOString();
  const structuredBlockers = argValues("--blocker-json").map((value) => parseObject(value, "--blocker-json"));
  const explicitRecovery = Boolean(recovery)
    || structuredBlockers.some((blocker) => typeof blocker.recoveryEntry === "string" && blocker.recoveryEntry.trim())
    || (previous?.blockerLedger || []).some((blocker) => typeof blocker.recoveryEntry === "string" && blocker.recoveryEntry.trim());
  const legacyBlockers = normalizeWorkstream({ blockers, recovery }).blockerLedger;
  const blockerLedger = mergeById(previous?.blockerLedger, [...legacyBlockers, ...structuredBlockers]).map((blocker) => ({
    ...blocker,
    attempts: (blocker.attempts || []).map((attempt) => ({ ...attempt, fingerprint: attempt.fingerprint || attemptFingerprint(attempt) }))
  }));
  const executionLanesValue = argValue("--execution-lanes-json", "").trim();
  const executionLanes = executionLanesValue ? parseObject(executionLanesValue, "--execution-lanes-json") : previous?.executionLanes || {
    development: { milestoneRef: argValue("--current-milestone", ""), status: status === "active" ? "active" : "inactive" },
    acceptance: { status: "inactive" },
    recovery: { status: blockerLedger.some((blocker) => ["parked", "blocked_external", "blocked_terminal"].includes(blocker.executionStatus)) ? "parked" : "inactive" }
  };
  const executionDecisions = mergeById(previous?.executionDecisions, argValues("--execution-decision-json").map((value) => parseObject(value, "--execution-decision-json")));
  const authorizationEnvelopes = mergeById(previous?.authorizationEnvelopes, argValues("--authorization-envelope-json").map((value) => parseObject(value, "--authorization-envelope-json")));
  const effectiveProfileValue = argValue("--effective-profile-json", "").trim();
  const effectiveDeliveryProfile = effectiveProfileValue ? parseObject(effectiveProfileValue, "--effective-profile-json") : previous?.effectiveDeliveryProfile || {};
  const timingValue = argValue("--timing-json", "").trim();
  const timingInput = timingValue ? parseObject(timingValue, "--timing-json") : previous?.timing || {};
  const timing = normalizeTiming({
    ...timingInput,
    startedAt: timingInput.startedAt || effectiveDeliveryProfile.startedAt || previous?.timing?.startedAt || now
  });
  const capabilityRoutes = [...(previous?.capabilityRoutes || []), ...argValues("--capability-route-json").map((value) => parseObject(value, "--capability-route-json"))].slice(-20);
  const worktreeContextValue = argValue("--worktree-context-json", "").trim();
  const worktreeContext = worktreeContextValue ? parseObject(worktreeContextValue, "--worktree-context-json") : previous?.worktreeContext || {};
  if (status === "blocked" && blockerLedger.length === 0) fail("Blocked workstream requires at least one --blocker or --blocker-json.");
  if (status === "blocked" && !explicitRecovery) fail("Blocked workstream requires --recovery or a blocker-json recoveryEntry.");

  const id = `${now.replace(/[:.]/g, "-")}-${slug(goal)}`;
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status,
    goal,
    subjectRef: argValue("--subject-ref", ""),
    releaseRef: argValue("--release-ref", ""),
    specRef: argValue("--spec-ref", ""),
    milestones: argValues("--milestone"),
    currentMilestone: argValue("--current-milestone", ""),
    nextStep,
    blockers: blockerLedger.map((blocker) => blocker.title),
    recovery: blockerLedger.find((blocker) => blocker.recoveryEntry)?.recoveryEntry || recovery,
    blockerLedger,
    executionLanes,
    executionDecisions,
    authorizationEnvelopes,
    effectiveDeliveryProfile,
    timing,
    capabilityRoutes,
    worktreeContext,
    decisions: argValues("--decision"),
    supersedes: argValues("--supersedes"),
    evidenceRefs: argValues("--evidence-ref"),
    roadmapAudit: argValues("--roadmap-audit"),
    specDeltas: argValues("--spec-delta"),
    workerEvidence: argValues("--worker-evidence").map((item) => {
      try { return JSON.parse(item); } catch (_err) { return { summary: item }; }
    }),
    createdAt: now,
    updatedAt: now
  };
  const pmAction = argValue("--pm-action", "none").trim();
  const statusState = {
    planned: "planned",
    active: "in_progress",
    blocked: "blocked",
    ready_for_acceptance: "validated",
    closed: "validated"
  }[status] || "unknown";
  const productState = pmAction === "none" ? statusState : status === "blocked" ? "blocked" : "awaiting_pm";
  const stage = /integrat|merge|environment|delivery|集成|环境|交付/i.test(artifact.currentMilestone) ? "integrate" : "build";
  const headline = {
    planned: "本轮工作已经规划",
    active: "本轮工作正在推进",
    blocked: "本轮工作暂时停下",
    ready_for_acceptance: "实现和自动检查已经完成",
    closed: "本轮工作已经收口"
  }[status] || "本轮状态正在核对";
  artifact.pmBrief = buildPmBrief({
    headline: argValue("--pm-headline", headline),
    stage,
    productState,
    userImpact: argValue("--pm-user-impact", status === "blocked"
      ? "当前进展暂时停下，现有产品和使用环境不会因此改变。"
      : status === "ready_for_acceptance"
        ? "实现已经通过当前自动检查，但是否进入实际使用环境仍取决于后续本地交付验证。"
        : "当前工作按既定范围推进，现有产品和使用环境保持不变。"),
    actionRequired: pmAction,
    nextStep: argValue("--pm-next-step", pmAction === "none"
      ? status === "blocked" ? "Codex 将按已记录的恢复路径继续处理，并在条件变化后重新验证。" : "Codex 将继续完成已确认范围内的下一步。"
      : "请查看决策卡并选择下一步。"),
    decisionCard: argValue("--pm-decision-card-json", "") ? parseObject(argValue("--pm-decision-card-json", ""), "--pm-decision-card-json") : null,
    evidenceBoundary: {
      proves: argValues("--pm-evidence-proves").length ? argValues("--pm-evidence-proves") : ["已记录当前进展、影响和下一步"],
      doesNotProve: argValues("--pm-evidence-does-not-prove").length ? argValues("--pm-evidence-does-not-prove") : [productState === "validated" ? "尚不代表本机实际使用路径已经验证" : "尚不代表本轮交付已经完成"]
    },
    sourceRefs: artifact.evidenceRefs.length ? artifact.evidenceRefs : artifact.specRef ? [artifact.specRef] : [`workstream:${artifact.id}`]
  });
  const validationErrors = validateWorkstream(artifact);
  if (validationErrors.length) fail(validationErrors.join("\n"));
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "workstream", `${id}.json`);
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({ status: "ok", artifactPath, manifestPath }, null, 2));
}

if (require.main === module) main();
