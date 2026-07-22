#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  SECURITY_ITEMS,
  artifactMatchesSubject,
  externalBlockerState,
  needsExternalBlockerPmDecision,
  parseAcceptanceItems,
  requiresGitBaseline,
  requiresPmDecision,
  validateAcceptanceItems,
  validateOverallStatus
} = require("./acceptance-model");

const SCHEMA_VERSION = "0.5.1";
const PRODUCT_VERSION = "0.6.2";

function loadPmBriefModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-pm-brief.js"),
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-pm-brief.js") : "",
    path.resolve(__dirname, "../../../ravo-core", PRODUCT_VERSION, "scripts/ravo-pm-brief.js")
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO PM Brief module is unavailable.");
  return require(file);
}

const { buildPmBrief, validatePmMarkdown } = loadPmBriefModule();

function loadVersionPolicyModule() {
  const candidates = [
    path.resolve(__dirname, "../../ravo-core/scripts/ravo-version-policy.js"),
    process.env.RAVO_CORE_PLUGIN_ROOT ? path.resolve(process.env.RAVO_CORE_PLUGIN_ROOT, "scripts/ravo-version-policy.js") : "",
    path.resolve(__dirname, "../../../ravo-core", PRODUCT_VERSION, "scripts/ravo-version-policy.js")
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("RAVO version policy module is unavailable.");
  return require(file);
}

const { validateReleaseRecord, validateVersionBuildEvidence } = loadVersionPolicyModule();

function hasArg(name) {
  return process.argv.includes(name);
}

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

function argJson(name, fallback = null) {
  const raw = argValue(name, "").trim();
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch (_error) {
    fail(`${name} must be valid JSON.`);
  }
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

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, value, "utf8");
  fs.renameSync(tmp, file);
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveWorkspaceFile(workspace, ref) {
  if (!ref) return "";
  const root = path.resolve(workspace);
  const file = path.resolve(root, ref);
  return file.startsWith(`${root}${path.sep}`) ? file : "";
}

function requiresVersionGovernance(specText) {
  return /R512-\d{3}|v0\.5\.12-product-version-governance/i.test(String(specText || ""));
}

function versionStatusMarkdown(artifact) {
  const build = artifact.versionBuildEvidence || {};
  const release = artifact.releaseRecord || {};
  return [
    "## 产品版本、构建与发布状态",
    "",
    `- 目标产品版本：${build.targetProductVersion || build.productVersion || "未记录"}`,
    `- 当前实际构建：${build.verificationStatus === "not_built" ? "尚未构建" : `${build.observedVersion || build.productVersion || "未验证"} (${build.observedBuildNumber ?? build.buildNumber ?? "未验证"})`}`,
    `- 构建验证：${build.verificationStatus || "未记录"}`,
    `- PM 验收状态：${artifact.status}`,
    `- 发布准备状态：${artifact.status === "release_ready" ? "已具备发布条件" : "尚未具备发布条件"}`,
    `- 实际发布：${release.releaseStatus === "released" ? `${release.actualReleaseVersion} / ${release.releaseChannel} / ${release.actualReleaseAt}` : "尚未发布"}`,
    ""
  ].join("\n");
}

function validateSourceBindings(workspace, artifact, specText = null) {
  const errors = [];
  if (requiresVersionGovernance(specText)) {
    if (!artifact.versionBuildEvidence) {
      errors.push("v0.5.12 acceptance requires versionBuildEvidence.");
    } else {
      const build = validateVersionBuildEvidence(artifact.versionBuildEvidence);
      if (build.errors.length) errors.push(...build.errors.map((error) => `versionBuildEvidence: ${error}`));
      if (artifact.status === "release_ready" && build.status !== "verified") errors.push("release_ready requires verified versionBuildEvidence.");
    }
    if (!artifact.releaseRecord) {
      errors.push("v0.5.12 acceptance requires releaseRecord.");
    } else {
      const release = validateReleaseRecord(artifact.releaseRecord);
      if (!release.valid) errors.push(...release.errors.map((error) => `releaseRecord: ${error}`));
    }
  }
  const acceptanceFacing = ["pending_acceptance", "accepted", "release_ready"].includes(artifact.status);
  if (!acceptanceFacing) return errors;
  if (artifact.acceptanceScope === "release" && artifact.releaseRef && artifact.releaseRef !== artifact.subjectRef) {
    errors.push("releaseRef must equal subjectRef for an acceptance-facing release object.");
  }
  if (artifact.specRef) {
    const specPath = resolveWorkspaceFile(workspace, artifact.specRef);
    if (!specPath || !fs.existsSync(specPath) || !fs.statSync(specPath).isFile()) errors.push("specRef must resolve to an existing workspace file.");
  }
  for (const field of ["analysisArtifact", "workstreamArtifact", "quickValidationArtifact", "reviewArtifact"]) {
    const ref = artifact[field];
    if (!ref) continue;
    const file = resolveWorkspaceFile(workspace, ref);
    const source = file ? readJson(file) : null;
    if (!source) errors.push(`${field} must resolve to a readable workspace JSON artifact.`);
    else if (!artifactMatchesSubject(source, artifact.subjectRef)) errors.push(`${field} does not match subjectRef=${artifact.subjectRef}.`);
  }
  if (artifact.knowledgeArtifact) {
    const file = resolveWorkspaceFile(workspace, artifact.knowledgeArtifact);
    if (!file || !fs.existsSync(file)) errors.push("knowledgeArtifact must resolve to an existing workspace artifact.");
  }
  if (requiresGitBaseline(artifact, specText)) {
    if (!artifact.gitBaselineArtifact) errors.push("v0.5.5 acceptance requires gitBaselineArtifact.");
    if (!artifact.baselineRef) errors.push("v0.5.5 acceptance requires baselineRef bound to a commit or tree.");
    if (artifact.gitBaselineStatus === "commit_blocked") errors.push("git baseline is commit_blocked; acceptance cannot be submitted as ready.");
  }
  return errors;
}

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  process.stderr.write(`${list.join("\n")}\n`);
  process.exit(1);
}

function buildSecurityChecklist(passed) {
  const passedSet = new Set(passed);
  return SECURITY_ITEMS.map((id) => ({
    id,
    status: passedSet.has(id) ? "pass" : "unknown"
  }));
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function fulfillmentLabel(value) {
  return {
    met: "已满足",
    partial: "部分满足",
    not_met: "未满足",
    not_applicable: "不适用",
    unknown: "待判断"
  }[value] || "待判断";
}

function verificationLabel(value) {
  return {
    verified: "已验证",
    pending_codex: "Codex 待验证",
    pending_pm: "PM 待验收",
    blocked: "已阻塞",
    pending_classification: "待重新分类"
  }[value] || "待重新分类";
}

const GENERIC_EVIDENCE_RISK = "当前结论必须与真实证据一致。";
const GENERIC_EVIDENCE_BOUNDARY = "不以旧 cache、脚本或口头确认替代真实证据。";

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function meaningfulRiskItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const risk = String(item.risk || "").trim();
    const boundary = String(item.boundary || "").trim();
    if ((!risk && !boundary) || (risk === GENERIC_EVIDENCE_RISK && boundary === GENERIC_EVIDENCE_BOUNDARY)) return false;
    const key = JSON.stringify([risk, boundary]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function productGap(value) {
  const text = String(value || "");
  if (/runtimeProbeStatus=stale|coreRuntimeStatus=unknown|runtimeHealth=degraded/.test(text)) {
    return "状态页仍显示“运行验证待刷新”。已确认当前版本已切换；该提示不会影响已验证的运行结果。";
  }
  if (/不可观测|unknown/.test(text)) {
    return "部分内部运行记录暂时无法自动确认；这不会改变已经确认的产品结果。";
  }
  if (/截图/.test(text)) {
    return "本次未单独保存界面截图，已保留可复核记录；PM 仍应以实际界面体验为准。";
  }
  return "Codex 仍有一项内部验证限制，完整技术说明已保留在附录。";
}

function productGaps(artifact) {
  const provided = Array.isArray(artifact.pmGaps) ? artifact.pmGaps : [];
  return uniqueStrings(provided.length ? provided : (artifact.knownGaps || []).map(productGap));
}

function productStatus(status) {
  return {
    pending_acceptance: "等待你确认产品体验",
    code_complete: "功能已完成，Codex 正在补齐验证",
    in_progress: "正在处理中",
    accepted: "已收到产品验收通过",
    release_ready: "已具备发布条件",
    not_ready: "暂不适合验收"
  }[status] || "状态待确认";
}

function productStateLabel(status) {
  return {
    in_progress: "正在推进",
    validated: "已通过当前验证",
    locally_available: "本机已经可以使用",
    awaiting_pm: "等待你的体验判断",
    accepted: "你已接受当前体验",
    release_ready: "已经具备发布条件",
    released: "已经发布",
    blocked: "暂时受阻"
  }[status] || "状态正在核对";
}

function decisionCardMarkdown(card) {
  if (!card) return "";
  return [
    "## 需要你决定",
    "",
    card.question,
    "",
    `- 为什么现在需要：${card.whyNow}`,
    `- 推荐：${card.recommendation}`,
    ...card.options.map((option) => `- ${option.label}：${option.outcome}`),
    `- 暂不决定的影响：${card.waitingImpact}`,
    ""
  ].join("\n");
}

function taskMarkdown(item, task) {
  const preconditions = task.preconditions.length ? task.preconditions.map((item) => `  - ${item}`).join("\n") : "  - 无额外前置条件";
  return [
    `### ${item.name}`,
    "",
    `验收任务：${task.claim}`,
    "",
    `- 验收目标：${task.reason}`,
    "- 前置条件：",
    preconditions,
    "- 操作步骤：",
    task.steps.map((item, index) => `  ${index + 1}. ${item}`).join("\n"),
    `- 预期结果：${task.expectedResult}`,
    "- 需要提供的证据：",
    task.evidenceRequired.map((item) => `  - ${item}`).join("\n"),
    `- 失败处理：${task.failureAction}`
  ].join("\n");
}

function itemTasks(items) {
  return items.flatMap((item) => item.verificationTasks.map((task) => ({ item, task })));
}

function statusBoundary(artifact) {
  const required = artifact.acceptanceItems.filter((item) => item.required);
  const implementationComplete = required.every((item) => ["met", "not_applicable"].includes(item.fulfillmentStatus));
  const automaticComplete = required.every((item) => ["verified", "pending_pm"].includes(item.verificationStatus));
  const locallyAvailable = automaticComplete && ["pending_acceptance", "accepted", "release_ready"].includes(artifact.status);
  return `实现${implementationComplete ? "已完成" : "未完成"}；自动验证${automaticComplete ? "已通过" : "未完成"}；本机体验${locallyAvailable ? "已可用" : "未确认"}；PM 已接受${["accepted", "release_ready"].includes(artifact.status) ? "是" : "否"}；发布条件${artifact.status === "release_ready" ? "已具备" : "未具备"}；已发布否`;
}

function pmRisk(artifact) {
  const blocked = artifact.acceptanceItems.some((item) => item.verificationStatus === "blocked");
  if (blocked) return "仍有外部条件未满足；当前降级和恢复方向已保留在验收记录中。";
  if ((artifact.knownGaps || []).length || (artifact.pmGaps || []).length) return "仍有证据或体验限制；Codex 会按已记录的恢复方向继续处理。";
  return "当前未发现会改变本次体验判断的已知风险。";
}

function pmExperienceSteps(artifact) {
  const steps = artifact.acceptanceItems
    .filter((item) => item.verificationStatus === "pending_pm")
    .flatMap((item) => item.verificationTasks || [])
    .flatMap((task) => task.steps || [])
    .map((step) => String(step || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (steps.length) return steps;
  return ["查看当前产品结果和影响。", "确认当前效果符合本轮目标，或记录需要继续优化的地方。"];
}

function pmDocFor(artifact) {
  const pm = artifact.pmBrief;
  const lines = [
    `# ${pm.actionRequired === "none" ? "PM 验收结论" : "PM 体验验收"}`,
    `- 结论：${pm.headline}`,
    `- 当前可用：${productStateLabel(pm.productState)}`,
    `- 影响：${pm.userImpact}`,
    `- PM 行动：${pm.actionRequired === "none" ? "无需行动，Codex 会继续。" : "需要完成下面的体验并给出一个结论。"}`,
    `- 状态边界：${statusBoundary(artifact)}`,
    `- 下一步：${pm.nextStep}`,
    `- 风险：${pmRisk(artifact)}`
  ];
  if (pm.actionRequired !== "none") {
    const card = pm.decisionCard;
    lines.push("## 体验步骤", ...pmExperienceSteps(artifact).map((step, index) => `${index + 1}. ${step}`));
    if (card) lines.push("## 需要你决定", card.question, `- 推荐：${card.recommendation}`, `- 暂不决定的影响：${card.waitingImpact}`);
  }
  const markdown = `${lines.join("\n")}\n`;
  const errors = validatePmMarkdown(markdown, { kind: "acceptance", actionRequired: pm.actionRequired });
  if (errors.length) fail(errors);
  return markdown;
}

function defaultNextStep(items, status, specRef = "") {
  const codex = items.filter((item) => item.required && item.verificationStatus === "pending_codex");
  if (codex.length) return `Codex 继续完成 ${codex.length} 个待验证项并补齐真实响应、截图、日志或数据证据。`;
  const classification = items.filter((item) => item.required && item.verificationStatus === "pending_classification");
  if (classification.length) return `先重新分类 ${classification.length} 个旧验收项，再决定由 Codex、PM 或外部条件完成验证。`;
  const externalDecisions = items.filter((item) => item.required && needsExternalBlockerPmDecision(item, specRef));
  if (externalDecisions.length) return `请评估 ${externalDecisions.length} 个已确认范围允许的外部条件影响，并明确接受当前降级方案或退回补证。`;
  const blocked = items.filter((item) => {
    if (!item.required || item.verificationStatus !== "blocked") return false;
    const state = externalBlockerState(item, specRef);
    return !state.allowed || state.decision !== "accepted";
  });
  if (blocked.length) return `按恢复入口解除 ${blocked.length} 个阻塞项，并执行对应补验步骤。`;
  const gaps = items.filter((item) => item.required && ["partial", "not_met"].includes(item.fulfillmentStatus));
  if (gaps.length) return `先补齐 ${gaps.length} 个实现缺口，再重新生成验收包。`;
  const pm = items.filter((item) => item.required && item.verificationStatus === "pending_pm");
  if (pm.length) return `PM 按清单完成 ${pm.length} 个产品或体验验收项，并回传实际结果和证据。`;
  if (status === "release_ready") return "按发布计划执行，并继续监控运行状态和回退条件。";
  if (status === "accepted") return "Codex 将根据目标发布范围补齐发布前证据；在此之前不会改变远端或其他用户的环境。";
  return "根据当前证据选择下一个可执行验证或实现动作。";
}

function productPmDocFor(artifact, details) {
  const attention = uniqueStrings([
    ...productGaps(artifact),
    ...details.blockerItems.map((item) => item.name + "：" + (item.blockerImpact || item.blockingReason || "需要先处理后再验收。")),
    ...details.riskItems.map((item) => item.name + "：" + [item.risk, item.boundary].filter(Boolean).join("；"))
  ]);
  const pmSection = details.pmSection === "当前没有需要 PM 执行的验收项。"
    ? "当前没有需要你额外验证的产品问题。"
    : details.pmSection;
  const pmDecision = artifact.pmDecision
    ? "已记录：" + (artifact.pmDecision.decisionText || "验收结论已记录。")
    : "尚未收到你对本次验收的明确结论。";
  const gitSection = [
    "- 基线证据：" + (artifact.gitBaselineArtifact || "未提供"),
    "- 基线状态：" + (artifact.gitBaselineStatus || "未提供"),
    "- 本任务已纳入：" + ((artifact.gitBaselineSummary?.taskOwned || []).length ? artifact.gitBaselineSummary.taskOwned.join(", ") : "无"),
    "- 启动前已有或未纳入：" + ([...(artifact.gitBaselineSummary?.preExisting || []), ...(artifact.gitBaselineSummary?.mixedOrUnknown || [])].length
      ? [...(artifact.gitBaselineSummary?.preExisting || []), ...(artifact.gitBaselineSummary?.mixedOrUnknown || [])].join(", ")
      : "无"),
    "- 远端操作：未执行 push、Tag、Release 或部署。"
  ].join("\n");
  const detailGaps = details.gapSection.length ? details.gapSection.join("\n") : "- 当前没有已识别的未满足或部分满足项。";
  const technicalNotes = uniqueStrings(artifact.knownGaps || []).map((item) => `- ${item}`);
  const technicalAttention = [
    ...details.blockerSection,
    ...technicalNotes
  ];
  const technicalAppendix = technicalAttention.length
    ? technicalAttention.join("\n")
    : "- 当前没有需要额外展开的技术风险、阻塞或证据限制。";

  return [
    "# 面向产品经理的验收文档",
    "",
    "## 验收结论摘要",
    "",
    artifact.pmBrief.headline,
    "",
    "- 当前状态：" + productStateLabel(artifact.pmBrief.productState),
    "- 对你的影响：" + artifact.pmBrief.userImpact,
    "- 是否需要你参与：" + (artifact.pmBrief.actionRequired === "none" ? "不需要，Codex 会继续处理" : "需要，请查看下面的决策项"),
    "- 下一步：" + artifact.pmBrief.nextStep,
    "- 验收范围：" + (artifact.acceptanceScope === "milestone" ? "当前里程碑" : "当前版本"),
    "- PM 验收结论：" + pmDecision,
    "",
    decisionCardMarkdown(artifact.pmBrief.decisionCard),
    "## PM 验收清单",
    "",
    pmSection,
    "",
    "## 需要关注的事项",
    "",
    attention.length ? attention.map((item) => "- " + item).join("\n") : "- 当前没有会影响你判断产品效果的事项。",
    "",
    "## 下一步建议",
    "",
    artifact.nextStep,
    "",
    artifact.versionGovernanceRequired === true ? versionStatusMarkdown(artifact) : "",
    "## 需求预期、当前方案与实现效果",
    "",
    "以下为实现和证据详情，按需查看。",
    "",
    "| 验收项 | 必需 | 需求预期 | 当前实现方案 | 当前实现效果 | 满足程度 | 验证状态 | 责任人 | 依赖影响 |",
    "|---|---|---|---|---|---|---|---|---|",
    details.rows.join("\n"),
    "",
    "## Codex 尚需完成的验证",
    "",
    details.codexSection,
    "",
    "## Git 验收基线",
    "",
    gitSection,
    "",
    "## 已验证证据",
    "",
    details.verifiedRefs.length ? details.verifiedRefs.map((item) => "- " + item).join("\n") : "- 当前没有可支持终态判断的已验证证据。",
    "",
    "## 未满足或部分满足项",
    "",
    detailGaps,
    "",
    "## 技术证据附录",
    "",
    technicalAppendix
  ].join("\n") + "\n";
}

function legacyPmDocFor(artifact) {
  const rows = artifact.acceptanceItems.map((item) => `| ${mdCell(item.name)} | ${item.required ? "是" : "否"} | ${mdCell(item.expected)} | ${mdCell(item.implementation)} | ${mdCell(item.effect)} | ${fulfillmentLabel(item.fulfillmentStatus)} | ${verificationLabel(item.verificationStatus)} | ${mdCell(item.verificationOwner)} | ${mdCell(item.dependencyImpact)} |`);
  const codexItems = artifact.acceptanceItems.filter((item) => item.verificationStatus === "pending_codex");
  const pmItems = artifact.acceptanceItems.filter((item) => item.verificationStatus === "pending_pm");
  const externalDecisionItems = artifact.acceptanceItems.filter((item) => needsExternalBlockerPmDecision(item, artifact.specRef));
  const verifiedRefs = [...new Set([
    ...artifact.sourceRefs,
    ...artifact.evidence,
    ...artifact.realResponseRefs,
    ...artifact.screenshotRefs,
    ...artifact.dataEvidenceRefs,
    ...artifact.notApplicableEvidence,
    ...artifact.acceptanceItems.filter((item) => item.verificationStatus === "verified").flatMap((item) => item.sourceRefs)
  ])];
  const gapItems = artifact.acceptanceItems.filter((item) => ["partial", "not_met"].includes(item.fulfillmentStatus));
  const blockerItems = artifact.acceptanceItems.filter((item) => item.verificationStatus === "blocked");
  const riskItems = meaningfulRiskItems(artifact.acceptanceItems);

  const codexSection = codexItems.length
    ? itemTasks(codexItems).map(({ item, task }) => taskMarkdown(item, task)).join("\n\n")
    : "当前没有需要 Codex 继续补证的验收项。";
  const externalDecisionMarkdown = (item) => [
    `### ${item.name}：外部阻塞降级决策`,
    "",
    `- 验收目标：判断是否接受当前外部条件缺失造成的降级。`,
    `- 阻塞影响：${item.blockerImpact}`,
    `- 临时降级：${item.temporaryFallback}`,
    `- 恢复入口：${item.recoveryEntry}`,
    "- 操作步骤：",
    "  1. 核对当前功能实现与已完成的同 Provider 真实证据。",
    "  2. 评估缺少跨 Provider 真实证据对本阶段或版本决策的影响。",
    "  3. 明确记录接受临时降级或退回补证，并附决策证据。",
    "- 预期结果：PM 给出可追溯的接受或拒绝结论。",
    "- 需要提供的证据：PM 决策、影响确认和后续恢复责任。",
    "- 失败处理：保持 pending_acceptance 或 not_ready，不得把外部阻塞视为已解除。"
  ].join("\n");
  const pmEntries = [
    ...itemTasks(pmItems).map(({ item, task }) => taskMarkdown(item, task)),
    ...externalDecisionItems.map(externalDecisionMarkdown)
  ];
  const pmSection = pmEntries.length
    ? pmEntries.join("\n\n")
    : "当前没有需要 PM 执行的验收项。";
  const gapSection = [
    ...gapItems.map((item) => `- ${item.name}：${fulfillmentLabel(item.fulfillmentStatus)}。缺口：${item.verificationReason || item.risk || "未说明"}`),
    ...artifact.unmetItems.map((item) => `- ${item}`)
  ];
  const blockerSection = [
    ...blockerItems.map((item) => [
      `### ${item.name}`,
      "",
      `- 阻塞原因：${item.blockingReason}`,
      `- 影响：${item.blockerImpact}`,
      `- 临时降级：${item.temporaryFallback}`,
      `- 恢复入口：${item.recoveryEntry}`,
      `- 调度状态：${item.blockerExecutionStatus || "未分类"}`,
      `- Spec 允许依据：${item.externalBlockerSpecRef || "未提供"}`,
      `- Spec 允许条款：${item.externalBlockerSpecAnchor || "未提供"}`,
      `- PM 降级决策：${{ pending_pm: "待 PM 决策", accepted: "已接受", rejected: "已拒绝" }[item.externalBlockerDecision] || "不适用"}`,
      `- 决策证据：${item.externalBlockerDecisionRef || "待补充"}`,
      "",
      item.verificationTasks.map((task) => taskMarkdown(item, task)).join("\n\n")
    ].join("\n")),
    ...riskItems.map((item) => `- ${item.name}：风险=${item.risk || "无"}；产品边界=${item.boundary || "未补充"}`)
  ];

  return `# 面向产品经理的验收文档

## 验收结论摘要

${artifact.summary}

- 当前状态：${artifact.status}
- 验收范围：${artifact.acceptanceScope}${artifact.milestoneRef ? ` (${artifact.milestoneRef})` : ""}
- Baseline：${artifact.baselineRef || "版本级来源绑定"}
- Item 证据允许的最高状态：${artifact.statusCeiling}
- 证据等级：${artifact.evidenceLevel}
${artifact.pmDecision ? `- PM 决定：${artifact.pmDecision.verdict || "未分类"}；来源：${artifact.pmDecision.sourceRef || "未提供"}；时间：${artifact.pmDecision.decidedAt || "未提供"}` : "- PM 决定：当前未记录明确的 PM 验收决定。"}

## Git 验收基线

- 基线证据：${artifact.gitBaselineArtifact || "未提供"}
- 基线状态：${artifact.gitBaselineStatus || "未提供"}
- 本任务已纳入：${(artifact.gitBaselineSummary?.taskOwned || []).length ? artifact.gitBaselineSummary.taskOwned.join(", ") : "无"}
- 启动前已有或未纳入：${[...(artifact.gitBaselineSummary?.preExisting || []), ...(artifact.gitBaselineSummary?.mixedOrUnknown || [])].length ? [...(artifact.gitBaselineSummary?.preExisting || []), ...(artifact.gitBaselineSummary?.mixedOrUnknown || [])].join(", ") : "无"}
- 远端操作：未执行 push、Tag、Release 或部署。

## 需求预期、当前方案与实现效果

| 验收项 | 必需 | 需求预期 | 当前实现方案 | 当前实现效果 | 满足程度 | 验证状态 | 责任人 | 依赖影响 |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Codex 尚需完成的验证

${codexSection}

## PM 验收清单

${pmSection}

## 已验证证据

${verifiedRefs.length ? verifiedRefs.map((item) => `- ${item}`).join("\n") : "- 当前没有可支持终态判断的已验证证据。"}

## 未满足或部分满足项

${gapSection.length ? gapSection.join("\n") : "- 当前没有已识别的未满足或部分满足项。"}

## 阻塞、风险和产品边界

${blockerSection.length ? blockerSection.join("\n") : "- 当前没有已识别的阻塞；风险和产品边界以各项 source refs 为准。"}

## 下一步建议

${artifact.nextStep}
`;
}

function ensureManifest(workspace, latestArtifact) {
  const root = path.join(workspace, "knowledge", ".ravo");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath) || {
    schemaVersion: "0.3.1",
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

function printHelp() {
  process.stdout.write([
    "Usage: write-acceptance-artifact.js [options]",
    "  --status <status>",
    "  --evidence-level <level>",
    "  --summary <text>",
    "  --pm-summary <text>",
    "  --pm-gap <text> (repeatable)",
    "  --acceptance-item <json> (repeatable)",
    "  --source-ref <ref> (repeatable)",
    "  --next-step <text>",
    "  --pm-decision-json <json> (required for v0.5.5 accepted/release_ready)"
  ].join("\n") + "\n");
}

function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printHelp();
    return;
  }
  if (hasArg("--version")) {
    process.stdout.write(`${PRODUCT_VERSION}\n`);
    return;
  }

  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const status = argValue("--status", "not_ready").trim();
  const evidenceLevel = argValue("--evidence-level", "notes").trim();
  const summary = argValue("--summary", "Acceptance artifact created.").trim();
  const parsed = parseAcceptanceItems(argValues("--acceptance-item"), summary);
  const itemErrors = validateAcceptanceItems(parsed.items);
  if (itemErrors.length) fail(itemErrors);

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    id: "",
    status,
    statusCeiling: "not_ready",
    evidenceLevel,
    summary,
    pmSummary: argValue("--pm-summary", "").trim(),
    createdAt: "",
    subjectRef: argValue("--subject-ref", "").trim(),
    acceptanceScope: argValue("--acceptance-scope", argValue("--milestone-ref", "") ? "milestone" : "release").trim(),
    milestoneRef: argValue("--milestone-ref", "").trim(),
    baselineRef: argValue("--baseline-ref", "").trim(),
    specRef: argValue("--spec-ref", "").trim(),
    releaseRef: argValue("--release-ref", "").trim(),
    analysisArtifact: argValue("--analysis-artifact", "").trim(),
    workstreamArtifact: argValue("--workstream-artifact", "").trim(),
    quickValidationArtifact: argValue("--quick-validation-artifact", "").trim(),
    reviewArtifact: argValue("--review-artifact", "").trim(),
    knowledgeArtifact: argValue("--knowledge-artifact", "").trim(),
    gitBaselineArtifact: argValue("--git-baseline-artifact", "").trim(),
    gitBaselineStatus: argValue("--git-baseline-status", "").trim(),
    pmDecision: argJson("--pm-decision-json"),
    sourceRefs: argValues("--source-ref"),
    evidence: argValues("--evidence"),
    knownGaps: argValues("--known-gap"),
    pmGaps: argValues("--pm-gap"),
    pmChecklistRef: "",
    realResponseRefs: argValues("--real-response-ref"),
    screenshotRefs: argValues("--screenshot-ref"),
    dataEvidenceRefs: argValues("--data-evidence-ref"),
    versionBuildEvidence: argJson("--version-build-evidence"),
    releaseRecord: argJson("--release-record"),
    acceptanceItems: parsed.items,
    codexVerificationItemIds: parsed.items.filter((item) => item.verificationStatus === "pending_codex").map((item) => item.id),
    pmChecklistItemIds: parsed.items.filter((item) => item.verificationStatus === "pending_pm" || needsExternalBlockerPmDecision(item, argValue("--spec-ref", "").trim())).map((item) => item.id),
    unmetItems: argValues("--unmet-item"),
    notApplicableEvidence: argValues("--not-applicable-evidence"),
    securityChecklist: buildSecurityChecklist(argValues("--security-pass")),
    normalization: {
      legacyItems: parsed.legacyItems,
      generatedItems: parsed.generatedItems
    },
    nextStep: ""
  };

  const specFile = resolveWorkspaceFile(workspace, artifact.specRef);
  const specText = specFile && fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : null;
  artifact.versionGovernanceRequired = requiresVersionGovernance(specText);
  artifact.gitBaselineRequired = requiresGitBaseline(artifact, specText);
  if (artifact.gitBaselineArtifact) {
    const baselineFile = resolveWorkspaceFile(workspace, artifact.gitBaselineArtifact);
    const baseline = baselineFile ? readJson(baselineFile) : null;
    if (baseline) {
      artifact.gitBaselineStatus = artifact.gitBaselineStatus || baseline.status || "";
      artifact.gitBaselineSummary = {
        taskOwned: baseline.taskOwned || [],
        preExisting: baseline.preExisting || [],
        mixedOrUnknown: baseline.mixedOrUnknown || [],
        worktrees: baseline.worktrees || baseline.cleanup?.results || []
      };
    }
  }
  artifact.pmDecisionRequired = requiresPmDecision(artifact, specText);
  const overall = validateOverallStatus(artifact, { specText });
  artifact.statusCeiling = overall.statusCeiling;
  const sourceErrors = validateSourceBindings(workspace, artifact, specText);
  if (overall.errors.length || sourceErrors.length) fail([...overall.errors, ...sourceErrors]);
  artifact.nextStep = argValue("--next-step", "").trim() || defaultNextStep(artifact.acceptanceItems, status, artifact.specRef);

  const now = new Date().toISOString();
  artifact.createdAt = now;
  artifact.id = `${now.replace(/[:.]/g, "-")}-${slug(summary)}`;
  const codexWorkPending = artifact.codexVerificationItemIds.length > 0;
  const pmActionRequired = !codexWorkPending && artifact.pmChecklistItemIds.length > 0;
  const productState = status === "release_ready" ? "release_ready"
    : status === "accepted" ? "accepted"
      : pmActionRequired ? "awaiting_pm"
        : status === "not_ready" ? "blocked"
          : status === "code_complete" ? "validated" : "in_progress";
  const defaultDecisionCard = pmActionRequired ? {
    question: "是否接受当前产品体验并进入下一步？",
    whyNow: "Codex 已完成可自动验证的事项，剩余内容需要你的产品体验判断。",
    recommendation: "先按验收清单体验核心路径，再选择接受或继续优化。",
    options: [
      { id: "accept", label: "接受", outcome: "记录本轮体验通过，并进入下一步。" },
      { id: "revise", label: "继续优化", outcome: "保留当前成果，并把体验问题带入下一轮。" }
    ],
    waitingImpact: "暂不决定不会改变现有环境，但下一轮不会开始。"
  } : null;
  artifact.pmBrief = buildPmBrief({
    headline: argValue("--pm-headline", artifact.pmSummary || (codexWorkPending ? "Codex 仍在完成验收前验证"
      : status === "release_ready" ? "当前版本已经具备发布条件"
      : status === "accepted" ? "你已接受当前产品体验"
        : pmActionRequired ? "当前成果已经可以由你体验" : status === "not_ready" ? "当前成果暂不适合体验验收" : "验收准备正在推进")),
    stage: status === "release_ready" ? "release" : "experience",
    productState,
    userImpact: argValue("--pm-user-impact", codexWorkPending ? "仍有 Codex 可以自动完成的验证，你暂时不用行动。"
      : status === "release_ready"
      ? "当前证据支持进入发布计划，但尚未实际发布给其他用户。"
      : status === "accepted" ? "本轮体验结论已记录，现有环境不会自动扩展到远端或其他用户。"
        : pmActionRequired ? "本机成果和验收步骤已经准备好，你的体验结论将决定下一轮方向。" : "Codex 仍在处理验收准备，你暂时无需行动。"),
    actionRequired: pmActionRequired ? "experience_acceptance" : "none",
    nextStep: argValue("--pm-next-step", pmActionRequired
      ? "请按验收清单体验核心路径，然后选择接受或继续优化。"
      : status === "release_ready" ? "Codex 将保持当前成果，等待明确的发布安排；不会自动发布。"
        : status === "accepted" ? "Codex 将根据目标发布范围补齐发布前证据，并准备下一步。"
          : codexWorkPending ? "Codex 将先完成仍可自动执行的验证，再请你体验。"
            : "Codex 将继续补齐当前验收缺口并更新结论。"),
    decisionCard: argJson("--pm-decision-card-json", defaultDecisionCard),
    evidenceBoundary: {
      proves: argValues("--pm-evidence-proves").length ? argValues("--pm-evidence-proves") : ["验收包汇总了当前实现效果和已完成验证"],
      doesNotProve: argValues("--pm-evidence-does-not-prove").length ? argValues("--pm-evidence-does-not-prove") : [codexWorkPending ? "尚未完成发给产品经理前的全部验证" : status === "release_ready" ? "尚不代表已经实际发布" : status === "accepted" ? "产品验收不等于已经发布" : "尚未获得最终产品体验结论"]
    },
    sourceRefs: artifact.sourceRefs.length ? artifact.sourceRefs : [`acceptance:${artifact.id}`]
  });
  const artifactPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${artifact.id}.json`);
  const pmDocPath = path.join(workspace, "knowledge", ".ravo", "acceptance", `${artifact.id}-pm-acceptance.md`);
  artifact.pmChecklistRef = path.relative(workspace, pmDocPath);
  writeText(pmDocPath, pmDocFor(artifact));
  writeJson(artifactPath, artifact);
  const manifestPath = ensureManifest(workspace, artifactPath);
  console.log(JSON.stringify({
    status: "ok",
    acceptanceStatus: artifact.status,
    acceptanceScope: artifact.acceptanceScope,
    statusCeiling: artifact.statusCeiling,
    artifactPath,
    pmChecklistPath: pmDocPath,
    manifestPath
  }, null, 2));
}

if (require.main === module) main();

module.exports = { defaultNextStep, pmDocFor };
