#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildPmBrief } = require("./ravo-pm-brief");
const { versionGovernanceGate } = require("./ravo-version-policy");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_err) { return null; }
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}

function readConfig(workspace) {
  const defaults = {
    deliveryProfile: "rapid",
    goalPrompt: { missingSpecPolicy: "auto_spec" },
    spec: { alignmentDraftPolicy: "required" }
  };
  const config = deepMerge(
    deepMerge(defaults, readJson(path.join(os.homedir(), ".codex", "skill-config", "ravo.json")) || {}),
    readJson(path.join(workspace, "knowledge", ".ravo", "config.json")) || {}
  );
  delete config.technicalDetailLevel;
  delete config.audience;
  return config;
}

function walk(dir, pattern, out = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, pattern, out);
      else if (pattern.test(file)) out.push(file);
    }
  } catch (_err) {
    // ponytail: absent docs/knowledge directories just mean no spec candidate.
  }
  return out;
}

function isDecisionComplete(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (/^Status:\s*(draft|candidate|wip|todo)\b/im.test(text)) return false;
    const required = [
      /Product Definition|产品定义/i,
      /Module Contracts|模块契约/i,
      /Validation Matrix|验证矩阵/i,
      /Trigger Rules|触发规则/i,
      /Assumptions|假设|Non-Goals|非目标/i
    ];
    return required.every((pattern) => pattern.test(text)) || /accepted|reviewed|已确认|已评审/i.test(text);
  } catch (_err) {
    return false;
  }
}

function isStaleInput(file) {
  return /alignment|candidate|spec-delta|todo|requirements?[-_ ]?pool/i.test(path.basename(file))
    || file.replace(/\\/g, "/").endsWith("knowledge/.ravo/pool/index.json");
}

function isDerivedWorkspacePoolExport(file, workspace) {
  return path.relative(workspace, file).replace(/\\/g, "/") === "knowledge/.ravo/pool/requirement-pool.md";
}

function documentVersion(file) {
  const nameMatch = path.basename(file).match(/(?:^|[-_])v(\d+\.\d+\.\d+)(?:[-_.]|$)/i);
  if (nameMatch) return `v${nameMatch[1]}`;
  try { return releaseVersion(fs.readFileSync(file, "utf8")); } catch (_err) { return ""; }
}

function staleSpecInputs(workspace, spec) {
  const specTime = fs.statSync(spec).mtimeMs;
  const specVersion = documentVersion(spec);
  return [
    ...walk(path.join(workspace, "docs"), /\.(md|txt)$/i),
    ...walk(path.join(workspace, "knowledge", ".ravo"), /\.(md|json|txt)$/i)
  ]
    .filter((file) => file !== spec && isStaleInput(file))
    // A current Release Slice must not be blocked by later edits to a different, archived version.
    .filter((file) => !specVersion || !documentVersion(file) || documentVersion(file) === specVersion)
    .filter((file) => !isDerivedWorkspacePoolExport(file, workspace))
    .filter((file) => {
      if (file.replace(/\\/g, "/").endsWith("knowledge/.ravo/pool/index.json")) {
        const index = readJson(file);
        const entries = Array.isArray(index?.entries) ? index.entries : [];
        const sourcePool = path.join(workspace, "docs", "ravo-requirement-pool-zh.md");
        const sourceMtime = fs.existsSync(sourcePool) ? fs.statSync(sourcePool).mtimeMs : 0;
        const hasNewCapturedItem = entries.some((entry) => entry.captureMode !== "migrated" && Date.parse(entry.updatedAt || "") * 1 > specTime);
        return sourceMtime > specTime || hasNewCapturedItem;
      }
      try { return fs.statSync(file).mtimeMs > specTime; } catch (_err) { return false; }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map((file) => path.relative(workspace, file));
}

function lineValue(text, labels) {
  const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = String(text || "").match(new RegExp(`^\\s*(?:${alternatives})\\s*[：:]\\s*(.+?)\\s*$`, "mi"));
  return match ? match[1].trim() : "";
}

function cleanReference(value) {
  const markdown = String(value || "").match(/\]\(([^)]+)\)/);
  return (markdown ? markdown[1] : String(value || ""))
    .replace(/[`"'“”]/g, "")
    .replace(/\s*[（(][^（）()]*[）)]\s*$/, "")
    .trim();
}

function resolveWorkspaceFile(workspace, reference) {
  const clean = cleanReference(reference);
  if (!clean) return "";
  const resolved = path.resolve(workspace, clean);
  return resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`) ? resolved : "";
}

function releaseVersion(text) {
  const match = String(text || "").match(/^#.*?\b(v\d+\.\d+\.\d+)\b/im)
    || String(text || "").match(/\b(v\d+\.\d+\.\d+)\b/i);
  return match ? match[1] : "";
}

function expandRequirementRange(matches, source) {
  const values = new Set(matches.map((match) => `${match[1]}-${match[2]}`));
  for (let index = 0; index + 1 < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const between = source.slice(current.index + current[0].length, next.index);
    if (current[1] !== next[1] || !/(?:至|to|[-–—])/i.test(between)) continue;
    const start = Number(current[2]);
    const end = Number(next[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 200) continue;
    const width = Math.max(current[2].length, next[2].length);
    for (let value = start; value <= end; value += 1) values.add(`${current[1]}-${String(value).padStart(width, "0")}`);
  }
  return [...values].sort();
}

function requirementIds(value) {
  const text = String(value || "");
  return expandRequirementRange([...text.matchAll(/\b(R\d{3,})-(\d{3,})\b/g)], text);
}

function releaseMetadata(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_error) { return null; }
  return {
    path: file,
    text,
    status: lineValue(text, ["状态", "Status"]),
    alignmentRef: cleanReference(lineValue(text, ["AlignmentRef", "Alignment Ref"])),
    releaseSlice: cleanReference(lineValue(text, ["候选 Release Slice", "Release Slice", "ReleaseSlice"])),
    requirementIds: requirementIds(lineValue(text, ["需求集合", "Requirement Set", "Requirements"])),
    version: releaseVersion(text)
  };
}

function equalSets(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scopeSelectionErrors(alignment) {
  const text = String(alignment?.text || "");
  const errors = [];
  const needs = [
    [/版本选择方法/i, "版本选择方法"],
    [/候选需求聚类.{0,12}成本判断|候选.*聚类.{0,12}成本/i, "候选需求聚类与成本判断"],
    [/单一(?:产品)?方向/i, "单一产品方向"],
    [/候选.*(?:逐项)?去向|逐项去向/i, "候选条目逐项去向"],
    [/PM\s*确认/i, "PM 确认项"]
  ];
  for (const [pattern, label] of needs) if (!pattern.test(text)) errors.push(`Alignment 缺少 ${label}。`);

  const hotfixSkip = /(?:本次|当前|该(?:版本|任务)).{0,36}(?:单一明确\s*(?:hotfix|bugfix)|单一.*(?:热修|缺陷修复)).{0,120}(?:跳过理由|简短理由)/i.test(text);
  const multipleGoals = hotfixSkip && /(?:本次|当前|该(?:版本|任务)).{0,36}多个.{0,12}(?:独立)?(?:产品目标|功能|需求)/i.test(text);
  if (hotfixSkip && multipleGoals) errors.push("多个独立产品目标不能按单一 hotfix 跳过范围选择矩阵。");
  if (!hotfixSkip) {
    const fields = ["优先级", "用户价值", "关键依赖", "Agent 活跃", "日历时长", "PM 投入", "Token", "不确定性", "处置"];
    for (const field of fields) if (!text.includes(field)) errors.push(`候选成本判断缺少 ${field} 字段。`);
  }
  return errors;
}

function semanticSpecGate(workspace, spec) {
  const metadata = releaseMetadata(spec);
  if (!metadata?.releaseSlice) return { applicable: false, status: "current", staleInputs: [], pairing: null, unresolvedItems: [], error: "" };

  const staleInputs = new Set();
  const errors = [];
  const unresolvedItems = [];
  let versionGovernance = null;
  const relative = (file) => path.relative(workspace, file).split(path.sep).join("/");
  const addError = (message, reference = "") => {
    errors.push(message);
    if (reference) staleInputs.add(reference);
  };

  if (!/^decision-complete$/i.test(metadata.status)) addError("Spec 状态必须为 decision-complete。", relative(spec));
  if (!metadata.alignmentRef) addError("Spec 缺少 AlignmentRef。", relative(spec));
  if (!metadata.version) addError("无法从 Spec 解析 committedVersion。", relative(spec));
  if (!metadata.requirementIds.length) addError("无法从 Spec 解析需求集合。", relative(spec));

  const alignmentPath = resolveWorkspaceFile(workspace, metadata.alignmentRef);
  const alignment = alignmentPath && fs.existsSync(alignmentPath) ? releaseMetadata(alignmentPath) : null;
  if (!alignment) {
    addError("AlignmentRef 未指向 workspace 内可读取的文档。", metadata.alignmentRef || relative(spec));
  } else {
    if (!/PM\s*已确认/i.test(alignment.status)) addError("Alignment 尚未标记为 PM 已确认。", relative(alignmentPath));
    if (alignment.releaseSlice !== metadata.releaseSlice) addError("Alignment 与 Spec 的 Release Slice 不一致。", relative(alignmentPath));
    if (!equalSets(alignment.requirementIds, metadata.requirementIds)) addError("Alignment 与 Spec 的需求集合不一致。", relative(alignmentPath));
    if (metadata.requirementIds.includes("R056-011")) {
      for (const error of scopeSelectionErrors(alignment)) addError(error, relative(alignmentPath));
    }
  }

  const poolPath = path.join(workspace, "knowledge", ".ravo", "pool", "index.json");
  const pool = readJson(poolPath);
  const entries = Array.isArray(pool?.entries) ? pool.entries : null;
  if (!entries) {
    addError("当前 Slice 缺少结构化 Requirement Pool。", relative(poolPath));
  } else {
    const requiredIds = new Set(metadata.requirementIds);
    const entryRef = (entry) => entry.detailRef || relative(poolPath);
    const currentEntries = entries.filter((entry) => entry?.releaseSlice === metadata.releaseSlice
      || entry?.committedVersion === metadata.version
      || (Array.isArray(entry?.candidateVersions) && entry.candidateVersions.includes(metadata.version)));
    for (const requiredId of metadata.requirementIds) {
      const matching = currentEntries.filter((entry) => Array.isArray(entry?.legacyIds) && entry.legacyIds.includes(requiredId));
      if (!matching.length) {
        addError(`Pool 缺少 ${requiredId} 的当前 Slice 条目。`, relative(poolPath));
        continue;
      }
      for (const entry of matching) {
        if (entry.confirmationStatus !== "confirmed" || entry.decisionStatus !== "approved") {
          unresolvedItems.push({ id: entry.id || requiredId, reason: "当前 Slice 条目尚未 confirmed/approved", detailRef: entryRef(entry) });
          addError(`${requiredId} 尚未 confirmed/approved。`, entryRef(entry));
        }
        if (entry.committedVersion !== metadata.version || entry.releaseSlice !== metadata.releaseSlice) {
          unresolvedItems.push({ id: entry.id || requiredId, reason: "committedVersion 或 releaseSlice 与 Spec 不一致", detailRef: entryRef(entry) });
          addError(`${requiredId} 的版本归属与 Spec 不一致。`, entryRef(entry));
        }
      }
    }
    for (const entry of currentEntries) {
      const entryIds = Array.isArray(entry?.legacyIds) ? entry.legacyIds : [];
      const belongsToSpec = entryIds.some((id) => requiredIds.has(id));
      const explicitlyCurrent = entry?.releaseSlice === metadata.releaseSlice || entry?.committedVersion === metadata.version;
      const capturedAfterSpec = entry?.captureMode !== "migrated"
        && Date.parse(entry?.updatedAt || "") > fs.statSync(spec).mtimeMs;
      const unassignedCandidate = Array.isArray(entry?.candidateVersions) && entry.candidateVersions.includes(metadata.version)
        && (!entry?.committedVersion || !entry?.releaseSlice)
        && (capturedAfterSpec || entry?.decisionStatus === "approved" || entry?.scopeClass === "must_ship");
      if ((explicitlyCurrent && !belongsToSpec && entry?.scopeClass === "must_ship") || unassignedCandidate) {
        unresolvedItems.push({ id: entry.id || "unassigned", reason: "存在未被当前 Spec 消费的当前 Slice 条目", detailRef: entryRef(entry) });
        addError(`Pool 条目 ${entry.id || "unassigned"} 未被当前 Spec 明确处理。`, entryRef(entry));
      }
    }
    versionGovernance = versionGovernanceGate(workspace, {
      version: metadata.version,
      releaseSlice: metadata.releaseSlice,
      requirementIds: metadata.requirementIds,
      entries
    });
    if (versionGovernance.applicable && versionGovernance.status !== "current") {
      const reason = (versionGovernance.errors || []).join(" ") || "Version governance gate did not pass.";
      addError(`版本治理状态为 ${versionGovernance.status}。${reason}`, "ravo-version-policy.json");
    }
  }

  return {
    applicable: true,
    status: versionGovernance?.applicable && versionGovernance.status !== "current"
      ? versionGovernance.status
      : errors.length ? "stale" : "current",
    staleInputs: [...staleInputs].sort(),
    pairing: {
      alignmentRef: alignmentPath ? relative(alignmentPath) : metadata.alignmentRef,
      releaseSlice: metadata.releaseSlice,
      requirementIds: metadata.requirementIds,
      committedVersion: metadata.version
    },
    unresolvedItems,
    versionGovernance,
    error: errors.join(" ")
  };
}

function findSpec(workspace, explicit) {
  if (explicit) {
    const file = path.resolve(workspace, explicit);
    return isDecisionComplete(file) ? file : "";
  }
  const candidates = [
    ...walk(path.join(workspace, "docs"), /decision-complete-spec.*\.md$/i),
    ...walk(path.join(workspace, "docs"), /spec.*\.md$/i),
    ...walk(path.join(workspace, "knowledge"), /spec.*\.md$/i)
  ]
    .filter(isDecisionComplete)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function checkSpecHealth(workspace, explicit = "") {
  const checkedAt = new Date().toISOString();
  try {
    if (explicit) {
      const file = path.resolve(workspace, explicit);
      if (!fs.existsSync(file)) return { status: "missing", specPath: file, staleInputs: [], checkedAt, error: "Explicit Spec does not exist." };
      if (!isDecisionComplete(file)) return { status: "draft", specPath: file, staleInputs: [], checkedAt, error: "Explicit Spec is not decision-complete." };
      const semantic = semanticSpecGate(workspace, file);
      if (semantic.applicable) return { status: semantic.status, specPath: file, staleInputs: semantic.staleInputs, checkedAt, error: semantic.error, pairing: semantic.pairing, unresolvedItems: semantic.unresolvedItems, versionGovernance: semantic.versionGovernance };
      const staleInputs = staleSpecInputs(workspace, file);
      return { status: staleInputs.length ? "stale" : "current", specPath: file, staleInputs, checkedAt, error: "" };
    }
    const spec = findSpec(workspace, "");
    if (spec) {
      const semantic = semanticSpecGate(workspace, spec);
      if (semantic.applicable) return { status: semantic.status, specPath: spec, staleInputs: semantic.staleInputs, checkedAt, error: semantic.error, pairing: semantic.pairing, unresolvedItems: semantic.unresolvedItems, versionGovernance: semantic.versionGovernance };
      const staleInputs = staleSpecInputs(workspace, spec);
      return { status: staleInputs.length ? "stale" : "current", specPath: spec, staleInputs, checkedAt, error: "" };
    }
    const drafts = [
      ...walk(path.join(workspace, "docs"), /spec.*\.md$/i),
      ...walk(path.join(workspace, "knowledge"), /spec.*\.md$/i)
    ].filter((file) => fs.existsSync(file)).sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    return drafts.length
      ? { status: "draft", specPath: drafts[0], staleInputs: [], checkedAt, error: "No decision-complete Spec exists." }
      : { status: "missing", specPath: "", staleInputs: [], checkedAt, error: "" };
  } catch (error) {
    return { status: "error", specPath: "", staleInputs: [], checkedAt, error: error.message };
  }
}

function goalPrompt(workspace, spec, options = {}) {
  const releaseSlice = options.releaseSlice || "当前 Release Slice";
  const deliveryProfile = ["rapid", "balanced", "strict"].includes(options.deliveryProfile) ? options.deliveryProfile : "rapid";
  const trustedAcceptanceBaseline = /0\.5\.5|R054-/.test(`${spec} ${releaseSlice}`);
  const trustedAcceptanceRules = trustedAcceptanceBaseline ? `
- v0.5.5 先记录 Goal 启动 Git 基线；发起验收前只提交 task-owned 变化，mixed_or_unknown 或 commit_blocked 必须停放并具体说明，不得使用 git add -A、reset、stash 或强制删除。
- 如果当前 Slice 改动涉及 RAVO 插件、Hook、manifest、CLI、安装/升级脚本或 Runtime，Fresh Session 前运行 Runtime Delivery Preflight；发现 drift 先返回 pending_runtime_upgrade，未授权不得启动 Fresh Session。
- Runtime 预检不自动启动正式多模型 Review；只按 Spec 明确要求、安全/发布风险门槛或用户明确要求启动 Review。
- v0.5.5 的 accepted/release_ready 必须绑定明确的 PM 验收文字、conversation:<thread>#<turn> 来源、当前 subjectRef 和 baselineRef；“确认/同意/可以”单独出现不算验收通过。
` : "";
  return `目标：
工作区：${workspace}
严格按照唯一 Spec 执行：${spec}
Release Slice：${releaseSlice}
交付档位：${deliveryProfile}

执行要求：
- 以规格书为唯一需求来源；当前 Goal 只承诺该 Spec 的 Release Slice，Roadmap 或其它版本未完成不阻止当前 Slice 收口。
- 按 Spec 定义的 ${deliveryProfile} 档位执行；新需求、问题、决策和真实使用反馈进入 Requirement/Issue Pool 或 Spec Delta，不静默扩大当前 Slice。
- 范围、数据边界、完成证据或验收标准变化时，先维护 Spec 或生成 delta；相同 blocker fingerprint 不重复尝试，达到预算后停放并继续独立工作。
- 只在边界清晰、状态可隔离且预计缩短时间时使用子 Agent；主 Agent 保留范围、依赖、接口与验收判断。
- 证据不足时不得声称验收通过、release_ready、可发版、已上线或已发布。
${trustedAcceptanceRules}

本地连续交付与 PM 沟通：
- 已确认范围内的实现通过自动验证后，只要后续动作仅影响本机、可恢复，不涉及用户数据、凭据、远端、生产、活跃共享服务、未知归属或破坏性操作，就继续完成本地集成、更新本机实际使用环境和真实体验验证；这些步骤属于同一次交付，不拆成多次 PM 授权。
- 只有范围扩大、测试失败且需要产品取舍、产品语义冲突，或涉及数据、权限、凭据、远端、生产、共享服务和不可恢复操作时，才请求 PM 决策。
- 面向 PM 的更新先说明产品结果、当前是否能用、对用户的影响、是否需要 PM 参与和下一步。技术状态码、Git 细节和内部证据字段仅放在按需查看的详情中。
- 需要 PM 参与时一次只问一个产品问题，并说明为什么现在要决定、推荐选择、每个选项的结果和暂不决定的影响；不得把安全的本地工程步骤包装成 PM 选择。
- 最终结论分别说明：实现是否完成、自动验证是否通过、本机是否已经可用、PM 是否已接受、是否具备发布条件、是否已经发布，不得互相替代。

完成标准：
1. 当前 Slice 的全部 required 实现，验证类型以 Spec 为准；外部 blocker 记录原因、影响、降级和恢复入口。
2. 提交面向 PM 的验收文档，说明产品效果、验证状态、待决策事项、风险、补证和验收清单。
3. 运行 RAVO acceptance evidence check，状态语言与证据一致。
4. 达到 Spec 定义的“实现与自动验证完成”“等待外部条件”或“等待 PM 体验判断”后停止活跃循环；最终报告给出简短下一步建议。`;
}

function goalPmBrief(status, workspace, specPath = "") {
  const needsScopeDecision = ["missing", "missing_spec", "stale", "stale_spec", "spec_draft"].includes(status);
  const blocked = ["base_dependency_pending", "base_version_unknown", "version_anomaly", "version_classification_pending", "version_conflict", "version_policy_missing"].includes(status);
  const error = status === "error";
  return buildPmBrief({
    headline: needsScopeDecision ? "本轮范围还不能直接执行" : blocked ? "当前版本条件尚未满足" : error ? "当前执行准备无法完成" : "本轮执行范围已经确认",
    stage: "specify",
    productState: needsScopeDecision ? "awaiting_pm" : blocked || error ? "blocked" : "planned",
    userImpact: needsScopeDecision
      ? "目标、范围或验收方式仍有缺口；现在开始会增加返工风险，现有产品不会变化。"
      : blocked || error ? "当前版本条件尚未满足，Codex 不会生成可执行 Goal 或修改产品版本来源。" : "Codex 可以按已确认范围开始工作，并在安全条件下完成本地体验闭环。",
    actionRequired: needsScopeDecision ? "clarify_scope" : "none",
    nextStep: needsScopeDecision ? "请确认先补齐本轮目标、范围和验收方式，或暂不启动。" : blocked || error ? "Codex 将按恢复入口补齐版本策略、前序基线或版本决定后重新检查。" : "Codex 将按已确认范围开始执行。",
    decisionCard: needsScopeDecision ? {
      question: "是否先补齐本轮目标、范围和验收方式？",
      whyNow: "当前信息不足以保证执行结果符合你的产品预期。",
      recommendation: "先补齐关键决策，再开始实现。",
      options: [
        { id: "complete", label: "补齐后执行", outcome: "先完成需求对齐，再启动可执行工作。" },
        { id: "pause", label: "暂不启动", outcome: "保持现状，不产生产品或环境变化。" }
      ],
      waitingImpact: "暂不决定不会影响现有产品，但本轮工作不会开始。"
    } : null,
    evidenceBoundary: {
      proves: [needsScopeDecision ? "已识别阻止安全执行的范围缺口" : blocked || error ? "已记录当前版本门禁的阻塞原因" : "已找到当前且决策完整的执行依据"],
      doesNotProve: ["执行准备完成不代表功能已经实现或可以使用"]
    },
    sourceRefs: [specPath || `goal-prompt:${workspace}`]
  });
}

function inlinePrompt(workspace) {
  return `目标：
在仓库 ${workspace} 中，根据当前对话上下文完成用户指定任务。

specMode=inline_prompt

执行要求：
- 当前没有可用 decision-complete spec；本模式只适合低风险、短周期任务。
- 如任务涉及安全、权限、数据边界、发版、验收或长程执行，先创建 spec。
- 低风险本机变更通过验证后，继续完成本地集成和实际体验核对，不为同一交付重复请求 PM 授权。
- 面向 PM 先说明结果、是否可用、影响和下一步；内部实现细节按需展开。
- 用户明确追问当前技术问题时，只解释该问题；下一次普通产品沟通恢复上述表达。
- 证据不足时不得声称验收通过、可发版、已完成或已发布。`;
}

function writeDraftSpec(workspace) {
  const specPath = path.join(workspace, "docs", "ravo-auto-generated-draft-spec.md");
  const text = `# Auto-Generated Draft Spec

Status: draft

## Product Definition

Goal: 待补充。

Consumer: 待补充。

Core problem:

- 待补充。

Success result:

- 待补充。

## Current Baseline

Implemented:

- 待补充。

Known gaps:

- 待补充。

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Module Contracts

- 待补充。

## Inputs And Outputs

Inputs:

- 待补充。

Outputs:

- 待补充。

## Trigger Rules

- 待补充。

## Validation Matrix

- 待补充。

## Failure And Fallback Behavior

- 待补充。

## Assumptions

- 待补充。

## Data Boundary And Security

- 待补充。

## Implementation Plan

- 待补充。分期只代表执行顺序，交付必须满足全部 required 功能。

## Release Wording

Allowed:

- 待补充。

Forbidden:

- 证据不足时不得声称验收通过、可发版、已完成或已发布。

## PM Acceptance Requirements

- 待补充。

## Next Step Advice Rule

- 完成阶段性交付后给出基于证据缺口的简短下一步建议。
`;
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, text);
  return specPath;
}

function writeAlignmentDraft(workspace) {
  const draftPath = path.join(workspace, "docs", "ravo-auto-generated-requirements-alignment.md");
  const text = `# RAVO 需求对齐文档

状态：需求对齐草案

## 30 秒结论

- 结论：当前信息不足以进入实现，现有产品不会变化。
- 用户变化：待补充需要改善的真实场景和结果。
- 当前范围：待确认本轮纳入与明确不做的内容。
- 主要风险：范围或验收方式不清会增加返工风险。
- PM 行动：需要补齐下方唯一待决定项。
- 下一步：确认目标、范围和验收方式后再生成正式 Spec。

## 待决定项

- 需要确认什么产品结果、范围和验收方式？
- 推荐：先确认最小可感知变化，再补充版本归属和延期项。
- 暂不决定的影响：无法安全生成可执行 Goal Prompt。

## 已知内容

- 背景、使用场景、痛点、期望结果、范围和下一步均待补充。

## 支持证据

内部来源、实现分解和机器记录仅在正式 Spec 与 Agent 记录中保存，不放入本正文。
`;
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, text);
  return draftPath;
}

function main() {
  const workspace = path.resolve(argValue("--workspace", process.cwd()));
  const config = readConfig(workspace);
  const explicitPolicy = argValue("--missing-spec-policy", "");
  const missingSpecPolicy = explicitPolicy || config.goalPrompt?.missingSpecPolicy || "auto_spec";
  const explicitSpec = argValue("--spec", "");
  const health = checkSpecHealth(workspace, explicitSpec);
  if (process.argv.includes("--check-only")) {
    console.log(JSON.stringify({
      ...health,
      pmBrief: goalPmBrief(health.status, workspace, health.specPath),
      canGenerateGoalPrompt: health.status === "current"
    }, null, 2));
    return;
  }
  if (health.status === "error") {
    console.log(JSON.stringify({ ...health, pmBrief: goalPmBrief("error", workspace), canGenerateGoalPrompt: false }, null, 2));
    return;
  }
  const versionBlocked = ["base_dependency_pending", "base_version_unknown", "version_anomaly", "version_classification_pending", "version_conflict", "version_policy_missing"].includes(health.status);
  if (versionBlocked) {
    console.log(JSON.stringify({
      ...health,
      pmBrief: goalPmBrief(health.status, workspace, health.specPath),
      canGenerateGoalPrompt: false,
      message: health.error || "当前版本门禁尚未通过；请按恢复入口补齐缺口后重试。"
    }, null, 2));
    return;
  }
  const spec = ["current", "stale"].includes(health.status) ? health.specPath : "";
  if (!spec) {
    if (missingSpecPolicy === "inline_goal_prompt") {
      console.log(JSON.stringify({
      status: "ok",
      specMode: "inline_prompt",
        warning: "inline_goal_prompt is a shortcut mode and is not suitable for high-risk, long-running, release-sensitive, or acceptance-sensitive work.",
        pmBrief: goalPmBrief("current", workspace),
        goalPrompt: inlinePrompt(workspace)
      }, null, 2));
      return;
    }
    if (missingSpecPolicy === "auto_spec") {
      const alignmentDraftPath = config.spec?.alignmentDraftPolicy === "required" ? writeAlignmentDraft(workspace) : "";
      const draftSpecPath = writeDraftSpec(workspace);
      console.log(JSON.stringify({
        status: "spec_draft",
        pmBrief: goalPmBrief("spec_draft", workspace, draftSpecPath),
        canGenerateGoalPrompt: false,
        missingSpecPolicy,
        alignmentDraftPolicy: config.spec?.alignmentDraftPolicy || "required",
        alignmentDraftPath,
        draftSpecPath,
        missingFields: ["goal", "consumer", "scope", "module contracts", "validation matrix", "data boundary", "PM acceptance requirements"],
        forbiddenOutputs: ["short_goal_prompt", "temporary_goal_prompt", "draft_goal_prompt"],
        nextStep: "补齐 draft spec 并将 Status 改为 decision-complete 后，重新运行 ravo-goal-prompt。",
        message: "已按 auto_spec 策略生成草稿 Spec，但上下文不足以形成 decision-complete Spec，因此不输出可运行 Goal Prompt。"
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      status: "missing_spec",
      pmBrief: goalPmBrief("missing_spec", workspace),
      canGenerateGoalPrompt: false,
      missingSpecPolicy,
      forbiddenOutputs: ["short_goal_prompt", "temporary_goal_prompt", "draft_goal_prompt"],
      message: missingSpecPolicy === "ask_to_generate_spec"
        ? "当前还没有 decision-complete 的需求规格文档。请先确认是否生成 Spec；确认前不能输出可运行 Goal Prompt。"
        : "当前还没有 decision-complete 的需求规格文档。默认策略是先根据上下文生成 Spec；如果上下文不足，只返回缺失字段和下一步建议，不能先输出临时或短版 Goal Prompt。"
    }, null, 2));
    return;
  }
  const staleInputs = health.staleInputs;
  if (staleInputs.length) {
    console.log(JSON.stringify({
      status: "stale_spec",
      pmBrief: goalPmBrief("stale_spec", workspace, spec),
      canGenerateGoalPrompt: false,
      specPath: spec,
      staleInputs,
      unresolvedItems: health.unresolvedItems || [],
      message: health.error || "发现与当前 Release Slice 语义不一致的 Alignment、Spec 或 Requirement Pool 条目。请先更新 Spec、生成 spec delta，或明确排除这些输入后再生成 Goal Prompt。"
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    status: "ok",
    pmBrief: goalPmBrief("current", workspace, spec),
    specPath: spec,
    pairing: health.pairing || null,
    goalPrompt: goalPrompt(workspace, spec, {
      releaseSlice: health.pairing?.releaseSlice,
      deliveryProfile: config.deliveryProfile
    })
  }, null, 2));
}

if (require.main === module) main();

module.exports = { checkSpecHealth, findSpec, goalPrompt, isDecisionComplete, main, releaseMetadata, scopeSelectionErrors, semanticSpecGate, staleSpecInputs };
