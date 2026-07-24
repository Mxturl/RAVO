(function () {
  "use strict";

  const app = document.getElementById("app");
  const dialog = document.getElementById("solodesk-dialog");
  const toastRegion = document.getElementById("toast-region");
  const icon = (name, className = "", label = "") => {
    if (!window.solodeskIcon) return "";
    const value = window.solodeskIcon(name, className, label);
    return typeof value === "string" ? value : value?.outerHTML || "";
  };

  const state = {
    csrfToken: "",
    health: null,
    runtime: null,
    workspaces: [],
    metrics: {},
    attention: [],
    view: "overview",
    loading: true,
    error: "",
    refreshing: false,
    sidebarOpen: false,
    search: "",
    lifecycle: "default",
    priority: "all",
    lane: "",
    workspaceId: "",
    workspace: null,
    detailTab: "summary",
    configModules: [],
    configModuleId: "core",
    configScope: "user",
    configWorkspaceId: "",
    configView: null,
    configInitial: {},
    configLoading: false,
    configIntegrity: null,
    integrityLoading: false,
    providersDraft: null,
    providersDirty: false,
    reviewConfig: null,
    reviewRun: null,
    reviewPolling: null,
    updateView: null,
    updateLoading: false,
    pendingConfirmation: null,
    poolKind: "requirements",
    poolWorkspaceId: "",
    pool: null,
    poolRecord: null,
    poolLoading: false,
    poolQuery: "",
    poolStatus: "",
    poolPriority: "",
    poolItemType: ""
  };

  const NAV_ITEMS = [
    ["overview", "activity", "总览"],
    ["attention", "triangle-alert", "需要关注"],
    ["workspaces", "folder-open", "工作区"],
    ["requirements", "list-todo", "需求与问题"],
    ["knowledge", "book-open", "精华知识"],
    ["config", "sliders-horizontal", "配置"],
    ["review", "shield-check", "独立复核"],
    ["updates", "download", "更新"]
  ];

  const STATUS_LABELS = {
    healthy: "健康",
    core_verified: "本机核心能力已验证",
    configured_unverified: "已配置，待验证",
    configured: "已配置",
    degraded: "降级",
    missing: "缺失",
    error: "错误",
    unknown: "未知",
    current: "当前",
    stale: "已过期",
    draft: "草稿",
    active: "活跃",
    paused: "暂停",
    archived: "归档",
    dormant: "休眠",
    in_progress: "进行中",
    code_complete: "代码完成",
    pending_acceptance: "待验收",
    pending_runtime_upgrade: "待升级 Runtime",
    not_required: "无需预检",
    commit_blocked: "Git 收口阻塞",
    blocked: "阻塞",
    accepted: "已接受",
    not_ready: "未就绪",
    no_data: "无数据",
    no_ravo_data: "无 RAVO 数据",
    complete: "完整",
    partial: "部分",
    clear: "清晰",
    attention: "需关注",
    not_applicable: "不适用",
    needed: "需要 Review",
    unavailable: "不可用",
    pass: "通过",
    fail: "失败",
    running: "运行中",
    completed: "已完成",
    succeeded: "成功",
    recovered: "已恢复",
    present: "存在",
    aligned: "一致",
    drift: "漂移",
    recorded: "已记录",
    update_or_repair_available: "可更新或修复",
    source_missing: "源码缺失",
    disabled: "已停用",
    usable: "可用",
    retrying: "重试中",
    responded_unusable: "已响应但不可用",
    failed: "失败",
    inactive: "未启用",
    parked: "已停放",
    resumed: "已恢复执行",
    blocked_external: "外部阻塞",
    blocked_terminal: "自主尝试已耗尽",
    attempting: "尝试中",
    matched: "已匹配",
    matched_no_artifact: "当前无需验收包",
    unmatched: "未匹配",
    ambiguous: "关系冲突",
    unscoped: "未限定",
    no_snapshot: "尚无快照",
    approval_required: "需要批准",
    changes_ready: "可修复",
    no_changes: "无需变更",
    runtime_verified: "Runtime 已验证",
    observed: "已观测",
    unsupported: "当前宿主不支持",
    attention_required: "需要处理",
    candidate: "候选",
    needs_triage: "待梳理",
    clarifying: "需求澄清中",
    approved: "已确认",
    deferred: "已延期",
    rejected: "已拒绝",
    duplicate: "重复",
    closed: "已关闭",
    not_started: "未开始",
    stopped: "已停止",
    not_requested: "未发起",
    pending_pm: "待 PM 验收",
    not_planned: "未计划",
    planned: "已计划",
    release_ready: "可发布",
    released: "已发布",
    rolled_back: "已回滚",
    needs_review: "待审核",
    superseded: "已替代",
    rejected: "已拒绝",
    archived: "已归档",
    needs_alignment: "需要先对齐",
    validated: "已通过当前验证",
    locally_available: "本机可以使用",
    awaiting_pm: "等待你的判断",
    authorize_exception: "需要例外授权",
    experience_acceptance: "需要体验验收",
    clarify_scope: "需要确认范围",
    approve_scope: "需要批准范围",
    choose_option: "需要选择方案",
    acknowledge_risk: "需要确认风险",
    none: "不需要你行动"
  };

  const INTEGRITY_REASON_LABELS = {
    missing_ravo_marketplace: "RAVO Marketplace 缺失",
    ravo_marketplace_drift: "RAVO Marketplace 来源漂移",
    missing_required_plugin: "必需插件缺失",
    invalid_plugin_registration: "插件注册无效",
    user_confirmed_reenable: "用户确认重新启用",
    known_good_hook_identity_unchanged: "Hook 身份未变化，可从已知良好快照恢复",
    stale_ravo_plugin_registration: "旧 RAVO 插件注册",
    stale_ravo_hook_registration: "旧 RAVO Hook 注册",
    user_selected_missing_external_registration: "用户选择恢复的第三方注册",
    hook_manifest_changed: "Hook 内容已变化",
    trusted_hash_not_available: "没有可验证的既有信任记录",
    explicitly_disabled: "用户已明确停用",
    current_external_registration_differs_from_snapshot: "当前第三方注册与快照冲突，保留当前值"
  };

  const SELECTION_REASON_LABELS = {
    acceptance_explicit_workstream_ref: "验收包显式绑定",
    target_lineage_latest: "目标 lineage 最新事实",
    workstream_artifact_exact: "工作流精确匹配",
    release_ref_exact: "Release 精确匹配",
    subject_ref_exact: "Subject 精确匹配",
    unique_spec_ref: "唯一 Spec 匹配",
    acceptance_explicit_review_ref: "验收包显式绑定",
    no_acceptance_artifact: "当前阶段尚未生成",
    no_related_acceptance: "没有关联验收包",
    no_release_review: "尚无版本 Review",
    no_analysis_review: "尚无分析 Review",
    broken_explicit_workstream_ref: "显式工作流引用损坏",
    conflicting_explicit_workstream_refs: "显式工作流引用冲突",
    multiple_spec_acceptances: "多个 Spec 验收候选",
    multiple_target_lineages: "多个目标 lineage"
  };

  const LANE_LABELS = {
    Reason: ["R", "需求判断"],
    Act: ["A", "推进执行"],
    Verify: ["V", "验证验收"],
    Organize: ["O", "知识沉淀"],
    Runtime: ["RT", "运行环境"]
  };

  const SHORTCUTS = [
    ["continue", "play", "继续这个工作区"],
    ["requirement-analysis", "lightbulb", "分析新需求"],
    ["root-cause", "search-code", "分析问题根因"],
    ["find-blockers", "octagon-alert", "找堵点"],
    ["acceptance-gaps", "circle-check", "检查验收缺口"],
    ["review", "shield-check", "独立检查高风险结论"],
    ["recent-progress", "history", "总结最近进展"],
    ["capture-knowledge", "book-open", "沉淀可复用经验"],
    ["goal-prompt", "target", "启动已确认工作"],
    ["runtime-status", "server", "检查本机环境"],
    ["initialize-ravo", "package-plus", "为工作区启用 RAVO"]
  ];

  const ATTENTION_COPY = {
    runtime: ["本机实际环境尚未验证", "当前证据不足以确认本机能力稳定可用。", "Codex 将刷新环境证据并通过真实任务验证。"],
    runtime_terminal: ["本机结束状态需要诊断", "核心能力已经出现，但任务结束时记录到异常。", "Codex 将查看诊断记录，不重复执行无信息增益的操作。"],
    review: ["独立复核覆盖不完整", "高影响结论缺少当前且可用的独立质疑证据。", "Codex 将恢复或重新发起与当前结论匹配的复核。"],
    analysis_review: ["高影响分析缺少独立复核", "当前分析还没有足够的独立质疑证据。", "Codex 将补齐或恢复独立复核。"],
    analysis: ["需求分析仍有未决项", "最新分析仍有草稿、开放问题或待处理盲区。", "先完善分析结论，再进入后续实现或验收。"],
    acceptance_unmatched: ["当前工作没有匹配的验收证据", "已有验收记录无法确认属于当前产品工作。", "实现证据就绪后，生成与当前工作明确关联的验收包。"],
    acceptance_stale: ["验收证据已过期", "验收之后关联来源发生了变化。", "基于当前来源重新生成或补充验收证据。"],
    pending_codex: ["Codex 仍需补证", "验收项仍包含 Codex 可完成的验证任务。", "执行真实 E2E 或补证任务并附上产物。"],
    pending_pm: ["等待 PM 验收", "剩余事项需要产品判断或体验确认。", "打开 PM 验收清单并记录结论。"],
    blocker: ["工作流存在阻塞", "当前工作流记录了明确阻塞。", "按恢复入口处理阻塞后再继续。"],
    spec: ["本轮范围需要维护", "目标、范围或验收方式缺失、仍是草稿或已经过期。", "先补齐当前且可执行的产品范围。"],
    data: ["RAVO 记录不完整", "当前产品记录缺失或无法读取。", "Codex 将修复数据来源并刷新索引。"],
    quick_validation: ["快速验证发现问题", "最新验证没有通过。", "Codex 将修复问题并写入新的验证证据。"],
    stale_workstream: ["当前工作已经停滞", "进展超过预期时间没有更新。", "Codex 将基于当前成果和缺口恢复工作。"],
    not_ready: ["验收仍未就绪", "必需结果或证据尚未满足。", "先处理未满足项，再发起验收。"]
  };

  function localizeText(value) {
    const text = String(value || "");
    if (text.includes(";")) {
      return text.split(";")
        .map((part) => localizeText(part.trim()).replace(/[。.]$/, ""))
        .filter(Boolean)
        .join("；") + "。";
    }
    const exact = {
      "Install and enable ravo@ravo.": "安装并启用 ravo@ravo。",
      "Start a fresh Codex task and run the generated RAVO Runtime verification prompt.": "新建 Codex 任务并运行 RAVO Runtime 验证 Prompt。",
      "Spec is current.": "Spec 当前有效。",
      "Analysis has draft, open-question, or blind-spot work.": "需求分析存在草稿、开放问题或待处理盲区。",
      "Recent Codex Session metadata is available.": "已读取最近的 Codex Session 元数据。",
      "Relevant workspace knowledge is available.": "已发现可复用的工作区知识。",
      "No visible high-priority issue.": "当前没有可见的高优先级事项。",
      "No acceptance artifact matches the active workstream or release.": "没有 Acceptance 与当前工作流或 release 匹配。"
    };
    if (exact[text]) return exact[text];
    return text
      .replace(/^Runtime health: ([a-z_]+)\.$/, (_m, status) => `本机环境状态：${statusLabel(status)}。`)
      .replace(/^Runtime health is ([a-z_]+)\.$/, (_m, status) => `本机环境状态为${statusLabel(status)}。`)
      .replace(/^Workstream status: ([a-z_]+)\.$/, (_m, status) => `工作流状态：${statusLabel(status)}。`)
      .replace(/^Quick validation status: ([a-z_]+)\.$/, (_m, status) => `快速验证：${statusLabel(status)}。`)
      .replace(/^Review status: ([a-z_]+)\.$/, (_m, status) => `Review 状态：${statusLabel(status)}。`)
      .replace(/^Analysis Review status: ([a-z_]+)\.$/, (_m, status) => `分析 Review 状态：${statusLabel(status)}。`)
      .replace(/^Spec status: ([a-z_]+)\.$/, (_m, status) => `Spec 状态：${statusLabel(status)}。`)
      .replace(/^Acceptance status: ([a-z_]+); pending Codex (\d+); pending PM (\d+)\.$/, (_m, status, codex, pm) => `Acceptance：${statusLabel(status)}；待 Codex 补证 ${codex}；待 PM 验收 ${pm}。`)
      .replace(/^Refresh cached Codex Runtime evidence and run the required fresh-session probe\.$/, "刷新 Codex Runtime 证据并完成 fresh-session probe。")
      .replace(/^Subsequent governance conclusions use current Runtime evidence\.$/, "后续治理结论将使用当前 Runtime 证据。")
      .replace(/^Keep delivery status on the active workstream and create a bound acceptance package when implementation evidence is ready\.$/, "保持当前工作流交付状态，并在实现证据就绪后生成绑定验收包。")
      .replace(/^Acceptance status can no longer be borrowed from an unrelated task\.$/, "验收状态不再借用其它任务的证据。")
      .replace(/^Run or recover RAVO Review for the referenced high-impact object\.$/, "为当前高影响对象发起或恢复 RAVO Review。")
      .replace(/^The high-impact decision has current usable adversarial coverage\.$/, "高影响结论获得当前可用的对抗式评审证据。")
      .replace(/^Resolve the open analysis items before treating the requirement as decision-complete\.$/, "先解决分析中的未决项，再将需求视为 decision-complete。")
      .replace(/^Reason evidence becomes explicit enough to support implementation and verification\.$/, "需求判断证据足以支持实现与验证。")
      .replace(/^Newer acceptance files exist, but none is explicitly bound to the active workstream, Spec, or release\.$/, "存在更新的 Acceptance，但没有一项明确绑定当前工作流、Spec 或 release。")
      .replace(/^The latest analysis is draft or contains open questions or blind spots\.$/, "最新分析仍为草稿，或包含开放问题与盲区。")
      .replace(/^Review status is needed\.$/, "当前对象需要 RAVO Review。")
      .replace(/^Runtime status was not injected for this refresh\.$/, "本次刷新未取得本机环境状态。")
      .replace(/^No reliable ([A-Za-z]+) evidence is available\.$/, "暂无可靠证据。")
      .replace(/^No active workstream or Session metadata is available\.$/, "暂无活跃工作流或 Session 元数据。")
      .replace(/^No verification evidence is available\.$/, "暂无验证证据。")
      .replace(/^Runtime status is unknown\.$/, "本机环境状态未知。")
      .replace(/^Spec current\.$/, "Spec 当前有效。")
      .replace(/^Runtime ([a-z_]+)\.$/, (_m, status) => `Runtime ${statusLabel(status)}。`);
  }

  function attentionCopy(item) {
    const copy = ATTENTION_COPY[item?.category] || [];
    return {
      title: copy[0] || localizeText(item?.title),
      reason: copy[1] || localizeText(item?.reason),
      action: copy[2] || localizeText(item?.suggestedAction)
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function statusLabel(value) {
    return STATUS_LABELS[value] || String(value || "未知");
  }

  function statusClass(value) {
    return `status-${String(value || "unknown").replace(/[^a-z0-9_-]/gi, "-")}`;
  }

  function terminalTelemetryText(status) {
    return {
      observed: "任务结束状态已经记录。",
      unknown: "任务结束状态未单独记录，不影响当前版本收口。",
      unsupported: "当前环境无法单独记录任务结束状态，不影响当前版本收口。",
      failed: "任务结束时记录到异常，需要查看诊断。"
    }[status] || "任务结束状态尚不明确。";
  }

  function runtimePresentation(runtime = {}, fallback = "") {
    const core = runtime.coreRuntimeStatus || runtime.runtimeProbe?.coreRuntimeStatus || "unknown";
    const terminal = runtime.terminalTelemetryStatus || runtime.terminalTelemetry?.status || runtime.runtimeProbe?.terminalTelemetry?.status || "unknown";
    if (core === "verified") return { title: "本机核心能力已验证", detail: terminalTelemetryText(terminal) };
    return { title: "本机核心能力尚未验证", detail: fallback || "需要通过新的真实任务验证本机环境。" };
  }

  function sourceLabel(value) {
    const labels = {
      default: "内置默认",
      user: "用户级",
      workspace: "工作区",
      override: "单次覆盖",
      local: "本地",
      git: "Git"
    };
    return labels[value] || String(value || "未知");
  }

  function chip(value, label) {
    return `<span class="status-chip ${statusClass(value)}">${escapeHtml(label || statusLabel(value))}</span>`;
  }

  function priorityChip(value) {
    const labels = { high: "高", normal: "普通", low: "低" };
    return `<span class="priority-chip priority-${escapeHtml(value || "normal")}">${labels[value] || "普通"}</span>`;
  }

  function formatDate(value, compact = false) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return new Intl.DateTimeFormat("zh-CN", compact
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
      : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function metricValue(metric) {
    if (metric && typeof metric === "object" && Object.prototype.hasOwnProperty.call(metric, "value")) return metric.value;
    return metric == null ? 0 : metric;
  }

  function truncate(value, length = 90) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function toJson(value) {
    try { return JSON.stringify(value, null, 2); } catch (_error) { return "{}"; }
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  async function api(pathname, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET") headers["X-RAVO-CSRF-Token"] = state.csrfToken;
    let response;
    try {
      response = await fetch(pathname, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store"
      });
    } catch (_error) {
      throw new Error("SoloDesk 服务已停止或地址已变化，请重新运行 ravo-solodesk open。");
    }
    let value;
    try { value = await response.json(); } catch (_error) { value = {}; }
    if (!response.ok) {
      const error = new Error(value?.error?.message || `请求失败 (${response.status})`);
      error.code = value?.error?.code || "request_failed";
      error.status = response.status;
      error.fieldErrors = value?.error?.fieldErrors || [];
      throw error;
    }
    return value;
  }

  function toast(message, type = "info") {
    if (!toastRegion) return;
    const item = document.createElement("div");
    item.className = `toast toast-${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.innerHTML = `${icon(type === "error" ? "circle-x" : type === "success" ? "circle-check" : "info", "toast-icon")}<span>${escapeHtml(message)}</span>`;
    toastRegion.appendChild(item);
    setTimeout(() => item.classList.add("is-visible"), 20);
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 180);
    }, 3600);
  }

  function showDialog(title, body, actions = []) {
    if (!dialog) return;
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="icon-button" type="button" data-action="dialog-close" title="关闭">${icon("x", "icon", "关闭")}</button>
        </div>
        <div class="dialog-body">${body}</div>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-action="dialog-close">取消</button>
          ${actions.map((action) => `<button class="${action.className || "primary-button"}" type="button" data-action="${escapeHtml(action.action)}"${action.disabled ? " disabled" : ""}>${action.icon ? icon(action.icon, "button-icon") : ""}${escapeHtml(action.label)}</button>`).join("")}
        </div>
      </div>`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog() {
    state.pendingConfirmation = null;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
  }

  async function copyText(value, success = "已复制") {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast(success, "success");
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = String(value || "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      toast(success, "success");
    }
  }

  function currentNavView() {
    return state.view === "workspace-detail" ? "workspaces" : state.view;
  }

  function renderShell(content) {
    const navView = currentNavView();
    const runtimeHealth = state.runtime?.runtimeHealth || state.runtime?.workspaces?.[0]?.runtimeHealth || "unknown";
    app.innerHTML = `
      <div class="app-shell ${state.sidebarOpen ? "is-open" : ""}">
        <aside class="sidebar ${state.sidebarOpen ? "is-open" : ""}" aria-label="主导航">
          <div class="sidebar-brand">
            <div class="brand-mark sidebar-brand-mark" aria-hidden="true"><span>R</span><span>V</span></div>
            <div class="sidebar-brand-copy"><strong>SoloDesk</strong><span>RAVO 本地工作台</span></div>
          </div>
          <nav class="sidebar-nav">
            ${NAV_ITEMS.map(([view, iconName, label]) => `
              <button type="button" class="nav-item ${navView === view ? "is-active" : ""}" data-action="navigate" data-view="${view}">
                ${icon(iconName, "nav-icon")}<span>${label}</span>
                ${view === "attention" && state.attention.length ? `<b>${Math.min(state.attention.length, 99)}</b>` : ""}
              </button>`).join("")}
          </nav>
          <div class="sidebar-foot sidebar-footer">
            <div class="runtime-mini"><span class="runtime-dot ${statusClass(runtimeHealth)}"></span><div><small>本机环境</small><strong>${escapeHtml(statusLabel(runtimeHealth))}</strong></div></div>
            <span>v0.6.3</span>
          </div>
        </aside>
        <button class="sidebar-scrim ${state.sidebarOpen ? "is-open" : ""}" type="button" data-action="toggle-sidebar" aria-label="关闭导航"></button>
        <div class="main-shell">
          ${renderTopbar()}
          <main class="content" id="main-content">${content}</main>
        </div>
      </div>`;
  }

  function renderTopbar() {
    const showSearch = ["overview", "workspaces", "attention"].includes(state.view);
    return `
      <header class="topbar">
        <button class="icon-button mobile-menu-button" type="button" data-action="toggle-sidebar" title="打开导航">${icon("menu", "icon", "打开导航")}</button>
        ${showSearch ? `
          <label class="search-box">
            ${icon("search", "search-icon")}
            <span class="visually-hidden">搜索工作区</span>
            <input type="search" data-role="workspace-search" value="${escapeHtml(state.search)}" placeholder="搜索工作区" autocomplete="off">
          </label>
          <div class="toolbar-filters desktop-only">
            <label><span class="visually-hidden">生命周期</span><select data-role="lifecycle-filter">
              <option value="default" ${state.lifecycle === "default" ? "selected" : ""}>当前工作区</option>
              <option value="active" ${state.lifecycle === "active" ? "selected" : ""}>活跃</option>
              <option value="paused" ${state.lifecycle === "paused" ? "selected" : ""}>暂停</option>
              <option value="archived" ${state.lifecycle === "archived" ? "selected" : ""}>归档</option>
              <option value="all" ${state.lifecycle === "all" ? "selected" : ""}>全部</option>
            </select></label>
            <label><span class="visually-hidden">优先级</span><select data-role="priority-filter">
              <option value="all" ${state.priority === "all" ? "selected" : ""}>全部优先级</option>
              <option value="high" ${state.priority === "high" ? "selected" : ""}>高优先级</option>
              <option value="normal" ${state.priority === "normal" ? "selected" : ""}>普通</option>
              <option value="low" ${state.priority === "low" ? "selected" : ""}>低优先级</option>
            </select></label>
          </div>` : `<div class="topbar-context">${escapeHtml(pageTitle())}</div>`}
        <div class="toolbar-actions">
          <button class="icon-button ${state.refreshing ? "is-spinning" : ""}" type="button" data-action="refresh" title="刷新">${icon("refresh-cw", "icon", "刷新")}</button>
          <button class="icon-button" type="button" data-action="navigate" data-view="config" title="设置">${icon("settings", "icon", "设置")}</button>
        </div>
      </header>`;
  }

  function pageTitle() {
    const labels = Object.fromEntries(NAV_ITEMS.map(([view, _icon, label]) => [view, label]));
    if (state.view === "workspace-detail") return state.workspace?.displayName || "工作区详情";
    return labels[state.view] || "SoloDesk";
  }

  function renderLoading(message = "正在读取本地证据") {
    return `<div class="loading-state" role="status"><span class="loading-bar"></span><strong>${escapeHtml(message)}</strong></div>`;
  }

  function renderError(message) {
    return `<div class="error-state"><div>${icon("circle-x", "state-icon")}</div><strong>无法完成当前读取</strong><p>${escapeHtml(message)}</p><button class="secondary-button" type="button" data-action="refresh">${icon("refresh-cw", "button-icon")}重试</button></div>`;
  }

  function renderEmpty(title, detail = "") {
    return `<div class="empty-state"><div>${icon("folder-open", "state-icon")}</div><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div>`;
  }

  function renderRuntimeBanner() {
    const runtime = state.runtime || {};
    const runtimeHealth = runtime.runtimeHealth || runtime.workspaces?.[0]?.runtimeHealth || "unknown";
    if (["healthy", "core_verified"].includes(runtimeHealth)) return "";
    const workspaceRuntime = runtime.workspaces?.[0] || {};
    const steps = workspaceRuntime.recoverySteps || [];
    const presentation = runtimePresentation(workspaceRuntime, localizeText(steps[0] || "当前运行证据不足，后续状态按低置信度显示。"));
    return `
      <section class="runtime-banner ${statusClass(runtimeHealth)}" aria-label="本机环境状态">
        <div class="runtime-banner-icon">${icon("server", "icon")}</div>
        <div class="runtime-banner-copy">
          <strong>${escapeHtml(presentation.title)}</strong>
          <span>${escapeHtml(presentation.detail)}</span>
        </div>
        <button type="button" class="secondary-button" data-action="navigate" data-view="updates">查看运行状态</button>
      </section>`;
  }

  function renderMetrics() {
    const metrics = state.metrics || {};
    const values = [
      ["activeWorkspaces", "活跃工作区", "activity"],
      ["pendingCodexVerification", "待 Codex 补证", "terminal"],
      ["pendingPmAcceptance", "待你体验", "circle-check"],
      ["blockers", "阻塞", "triangle-alert"],
      ["staleWorkspaces", "停滞", "clock-3"],
      ["runtimeDegradedOrMissing", "本机环境异常", "server"]
    ];
    return `<section class="metrics-strip" aria-label="工作量与状态信号">
      ${values.map(([key, label, iconName]) => `<div class="metric-item"><span>${icon(iconName, "metric-icon")}${label}</span><strong>${escapeHtml(metricValue(metrics[key]))}</strong></div>`).join("")}
    </section>`;
  }

  function renderAttentionRows(items, limit = 10) {
    const visible = (items || []).slice(0, limit);
    if (!visible.length) return renderEmpty("当前没有需要处理的事项");
    return `<div class="attention-list">${visible.map((item) => {
      const copy = attentionCopy(item);
      return `
      <button type="button" class="attention-row severity-${escapeHtml(item.severity)}" data-action="open-workspace" data-workspace-id="${escapeHtml(item.workspaceId)}">
        <span class="attention-severity">${escapeHtml(item.severity || "low")}</span>
        <span class="attention-main"><strong>${escapeHtml(copy.title)}</strong><small>${escapeHtml(truncate(copy.reason, 130))}</small></span>
        <span class="attention-lane">${escapeHtml(LANE_LABELS[item.lane]?.[1] || item.lane || "")}</span>
        <span class="attention-action">${escapeHtml(truncate(copy.action, 54))}</span>
        ${icon("chevron-right", "row-chevron")}
      </button>`;
    }).join("")}</div>`;
  }

  function renderWorkspaceRows(workspaces) {
    if (!workspaces.length) return renderEmpty("没有匹配的工作区", state.lifecycle === "default" ? "可在配置中添加 workspace roots。" : "调整筛选条件后重试。");
    return `
      <div class="workspace-table" role="table" aria-label="Workspace 列表">
        <div class="workspace-table-head desktop-only" role="row">
          <span>工作区</span><span>优先级</span><span>当前状态</span><span>是否需要你</span><span>本机环境</span><span>当前结论</span><span></span>
        </div>
        ${workspaces.map((workspace) => `
          <button class="workspace-row" type="button" role="row" data-action="open-workspace" data-workspace-id="${escapeHtml(workspace.workspaceId)}">
            <span class="workspace-name"><strong>${escapeHtml(workspace.displayName || workspace.name)}</strong><small>${escapeHtml(truncate(workspace.currentGoal || "本轮目标待记录", 54))}</small></span>
            <span>${priorityChip(workspace.priority)}</span>
            <span>${chip(workspace.pmBrief?.productState || "unknown")}</span>
            <span>${chip(workspace.pmBrief?.actionRequired === "none" ? "clear" : "attention", workspace.pmBrief?.actionRequired === "none" ? "不需要" : "需要")}</span>
            <span>${chip(workspace.states?.runtime?.status || "unknown", ["healthy", "core_verified"].includes(workspace.states?.runtime?.status) ? "可以使用" : "仍待确认")}</span>
            <span class="workspace-attention"><b>${escapeHtml(workspace.pmBrief?.headline || "当前状态正在核对")}</b><small>${escapeHtml(truncate(workspace.pmBrief?.nextStep || "Codex 将继续核对。", 60))}</small></span>
            <span>${icon("chevron-right", "row-chevron")}</span>
          </button>`).join("")}
      </div>`;
  }

  function renderOverview() {
    return `
      ${renderRuntimeBanner()}
      ${renderMetrics()}
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">待处理</span><h1>需要处理</h1></div><button class="text-button" type="button" data-action="navigate" data-view="attention">查看全部 ${icon("chevron-right", "button-icon")}</button></div>
        ${renderAttentionRows(state.attention, 6)}
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">工作区</span><h2>当前工作区</h2></div><span class="section-meta">${state.workspaces.length} 个</span></div>
        ${renderWorkspaceRows(state.workspaces)}
      </section>`;
  }

  function renderAttentionPage() {
    return `
      <div class="page-header"><div><span class="section-kicker">关注队列</span><h1>需要关注</h1><p>${state.attention.length} 项，按阻塞、Runtime、证据和优先级排序</p></div></div>
      <section class="section-band">${renderAttentionRows(state.attention, state.attention.length || 10)}</section>`;
  }

  function renderWorkspacesPage() {
    return `
      <div class="page-header"><div><span class="section-kicker">工作区组合</span><h1>工作区</h1><p>${state.workspaces.length} 个当前筛选结果</p></div></div>
      <section class="section-band">${renderWorkspaceRows(state.workspaces)}</section>`;
  }

  function poolWorkspaceOptions() {
    return state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.workspaceId)}" ${state.poolWorkspaceId === workspace.workspaceId ? "selected" : ""}>${escapeHtml(workspace.displayName || workspace.name)}</option>`).join("");
  }

  function poolStatusSummary(item) {
    if (state.poolKind === "knowledge") return item.status || "unknown";
    return item.pmAcceptanceStatus === "pending_pm" ? "pending_pm" : item.deliveryStatus || item.decisionStatus || "unknown";
  }

  function renderPoolPage(kind) {
    const pool = state.pool || { entries: [], total: 0 };
    const title = kind === "knowledge" ? "精华知识" : "需求与问题";
    const description = kind === "knowledge" ? "只展示经过整理的工作区知识，不把 Review 或原始日志当作知识。" : "先看用户价值、版本归属和下一步；原始执行记录仍保留给 Agent。";
    if (state.poolLoading && !state.pool) return renderLoading(`正在读取${title}`);
    return `
      <div class="page-header pool-page-header"><div><span class="section-kicker">工作区管理</span><h1>${title}</h1><p>${description}</p></div><button class="primary-button" type="button" data-action="pool-create" data-pool-kind="${kind}">${icon("plus", "button-icon")}新建</button></div>
      <section class="section-band pool-toolbar">
        <label>工作区<select data-role="pool-workspace">${poolWorkspaceOptions()}</select></label>
        <label class="pool-search">搜索<input type="search" data-role="pool-search" value="${escapeHtml(state.poolQuery)}" placeholder="标题、来源、标签"></label>
        ${kind === "requirements" ? `<label>类型<select data-role="pool-item-type">${[["", "全部类型"], ["feature", "需求"], ["improvement", "改进"], ["bug", "问题"], ["hotfix", "热修"], ["environment", "环境"], ["technical_debt", "技术债"], ["governance", "治理"]].map(([value, label]) => `<option value="${value}" ${state.poolItemType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}
        <label>状态<select data-role="pool-status"><option value="">全部状态</option>${(kind === "knowledge" ? ["candidate", "needs_review", "active", "stale", "superseded", "archived", "rejected"] : ["needs_triage", "candidate", "approved", "deferred", "rejected", "duplicate", "closed", "out_of_scope"]).map((value) => `<option value="${value}" ${state.poolStatus === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select></label>
        ${kind === "requirements" ? `<label>优先级<select data-role="pool-priority"><option value="">全部优先级</option>${["P0", "P1", "P2", "P3"].map((value) => `<option value="${value}" ${state.poolPriority === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>` : ""}
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">结构化记录</span><h2>${pool.total || 0} 条</h2></div><button class="icon-button ${state.poolLoading ? "is-spinning" : ""}" type="button" data-action="pool-refresh" title="刷新">${icon("refresh-cw", "icon", "刷新")}</button></div>
        ${pool.entries?.length ? `<div class="data-table pool-table">${kind === "knowledge" ? `<div class="data-table-head"><span>知识</span><span>类型</span><span>状态</span><span>可信度</span><span>适用场景</span></div>` : `<div class="data-table-head"><span>问题/标题</span><span>用户价值或影响</span><span>优先级</span><span>版本归属</span><span>下一步</span></div>`}${pool.entries.map((item) => `<button class="data-table-row pool-row" type="button" data-action="pool-open" data-pool-kind="${kind}" data-record-id="${escapeHtml(item.id)}">${kind === "knowledge" ? `<span><strong>${escapeHtml(item.title || item.id)}</strong><small>${escapeHtml(item.summary || item.sourceType || "")}</small></span><span data-label="类型">${escapeHtml(item.kind)}</span><span data-label="状态">${chip(poolStatusSummary(item))}</span><span data-label="可信度">${item.confidence == null ? "unknown" : `${Math.round(Number(item.confidence) * 100)}%`}</span><span data-label="适用场景">${escapeHtml((item.applicability || []).slice(0, 2).join("；") || "待补充")}</span>` : `<span><strong>${escapeHtml(item.title || "待补充标题")}</strong></span><span data-label="用户价值或影响">${escapeHtml(item.userImpact || "待补充")}</span><span data-label="优先级">${escapeHtml(item.priority || "P2")}</span><span data-label="版本归属">${escapeHtml(item.version || "未排期")}</span><span data-label="下一步">${escapeHtml(item.nextStep || "待补充")}</span>`}</button>`).join("")}</div>` : renderEmpty(kind === "knowledge" ? "暂无精华知识" : "暂无需求或问题", "可从当前 Session 捕获候选，或手动新建一条记录。")}
      </section>`;
  }

  function poolFormField(label, name, value, type = "text", extra = "") {
    const safe = value == null ? "" : value;
    if (type === "textarea") return `<label class="pool-form-field pool-form-field-wide">${escapeHtml(label)}<textarea data-pool-field="${name}" rows="${extra || 4}">${escapeHtml(safe)}</textarea></label>`;
    return `<label class="pool-form-field">${escapeHtml(label)}<input data-pool-field="${name}" type="${type}" value="${escapeHtml(safe)}" ${extra || ""}></label>`;
  }

  function poolSelect(label, name, value, values) {
    return `<label class="pool-form-field">${escapeHtml(label)}<select data-pool-field="${name}">${values.map((option) => `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(statusLabel(option))}</option>`).join("")}</select></label>`;
  }

  function poolFormBody(kind, record = {}, creating = false) {
    const lineList = (value) => Array.isArray(value) ? value.join("\n") : "";
    if (kind === "knowledge") {
      return `<form class="pool-form" data-role="pool-form">${poolFormField("标题", "title", record.title)}${poolSelect("类型", "kind", record.kind || "lesson", ["fact", "decision", "lesson", "principle", "boundary", "terminology", "procedure", "warning"])}${poolSelect("状态", "status", record.status || "candidate", ["candidate", "needs_review", "active", "stale", "superseded", "archived", "rejected"])}${poolFormField("可信度", "confidence", record.confidence ?? 0.5, "number", 'min="0" max="1" step="0.05"')}${poolFormField("摘要", "summary", record.summary, "textarea", 3)}${poolFormField("内容", "content", record.content, "textarea", 7)}${poolFormField("适用场景（每行一项）", "applicability", lineList(record.applicability), "textarea", 4)}${poolFormField("不适用场景（每行一项）", "nonApplicability", lineList(record.nonApplicability), "textarea", 3)}${poolFormField("来源", "source", record.source)}${poolFormField("来源引用（每行一项）", "sourceRefs", lineList(record.sourceRefs), "textarea", 3)}${poolSelect("确认状态", "confirmationStatus", record.confirmationStatus || "needs_review", ["needs_review", "confirmed"])}${poolFormField("确认人", "confirmedBy", record.confirmedBy)}${poolFormField("过时原因", "stalenessReason", record.stalenessReason, "textarea", 3)}${poolFormField("替代知识 ID", "supersededBy", record.supersededBy)}<input type="hidden" data-pool-field="expectedRevision" value="${escapeHtml(record.revision || "")}"></form>`;
    }
    return `<form class="pool-form" data-role="pool-form">${poolFormField("标题", "title", record.title)}${poolFormField("背景", "background", record.background, "textarea", 3)}${poolFormField("使用场景", "scenario", record.scenario, "textarea", 3)}${poolFormField("用户痛点", "painPoint", record.painPoint, "textarea", 3)}${poolFormField("期望结果", "expectedOutcome", record.expectedOutcome, "textarea", 3)}${poolFormField("本轮范围", "scopeBoundary", record.scope || record.scopeBoundary, "textarea", 3)}${poolSelect("优先级", "priority", record.priority || "P2", ["P0", "P1", "P2", "P3"])}${poolFormField("版本归属", "committedVersion", record.version || record.committedVersion)}${poolFormField("下一步", "nextAction", record.nextStep || record.nextAction, "textarea", 3)}<input type="hidden" data-pool-field="expectedRevision" value="${escapeHtml(record.revision || "")}"></form>`;
  }

  function openPoolCreate(kind) {
    state.pendingConfirmation = { type: "pool-create", kind };
    showDialog(kind === "knowledge" ? "新建精华知识候选" : "新建需求或问题", poolFormBody(kind, { status: kind === "knowledge" ? "candidate" : "candidate" }, true), [{ action: "pool-create-confirm", label: "创建", icon: "plus" }]);
  }

  async function openPoolRecord(kind, id) {
    try {
      const result = await api(`/api/workspaces/${encodeURIComponent(state.poolWorkspaceId)}/pool/${kind}/${encodeURIComponent(id)}`);
      state.poolRecord = result;
      state.pendingConfirmation = { type: "pool-edit", kind, id };
      showDialog(kind === "knowledge" ? "编辑精华知识" : "编辑需求或问题", poolFormBody(kind, result.record), [{ action: "pool-save-confirm", label: "保存", icon: "save" }]);
    } catch (error) { toast(error.message, "error"); }
  }

  function renderLanePanel(name, lane) {
    const [code, label] = LANE_LABELS[name] || [name, name];
    const items = lane?.items || [];
    return `<section class="lane-panel ${statusClass(lane?.status)}">
      <header><span class="lane-code">${escapeHtml(code)}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(localizeText(lane?.summary || "暂无可靠证据"))}</small></div>${chip(lane?.status || "unknown")}</header>
      ${items.length ? `<ul>${items.slice(0, 4).map((item) => `<li><span>${escapeHtml(localizeText(item.summary))}</span><small>${escapeHtml(statusLabel(item.status))}</small></li>`).join("")}</ul>` : ""}
    </section>`;
  }

  function renderWorkspaceDetail() {
    const workspace = state.workspace;
    if (!workspace) return renderLoading("正在读取工作区");
    const tabs = [["summary", "概览"], ["evidence", "证据"], ["timeline", "时间线"], ["actions", "下一步"]];
    return `
      <div class="page-header workspace-detail-header">
        <button class="icon-button" type="button" data-action="navigate" data-view="workspaces" title="返回">${icon("arrow-left", "icon", "返回")}</button>
        <div class="workspace-title"><span class="section-kicker">工作区</span><h1>${escapeHtml(workspace.displayName || workspace.name)}</h1><div class="workspace-goal-line"><p>${escapeHtml(workspace.currentGoal || "本轮目标待记录")}</p><button class="icon-button" type="button" data-action="copy" data-copy="${escapeHtml(workspace.canonicalPath)}" title="复制工作区路径">${icon("copy", "icon", "复制工作区路径")}</button></div></div>
        <div class="workspace-header-status">${priorityChip(workspace.priority)}${chip(workspace.pmBrief?.productState || "unknown")}${chip(workspace.pmBrief?.actionRequired === "none" ? "clear" : "attention", workspace.pmBrief?.actionRequired === "none" ? "无需你行动" : "需要你参与")}</div>
      </div>
      ${renderPmBrief(workspace)}
      ${!["healthy", "core_verified"].includes(workspace.states?.runtime?.status) ? renderWorkspaceRuntime(workspace) : ""}
      <div class="detail-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="tab-button ${state.detailTab === id ? "is-active" : ""}" type="button" role="tab" data-action="detail-tab" data-tab="${id}">${label}</button>`).join("")}</div>
      ${renderDetailTab(workspace)}`;
  }

  function stageLabel(value) {
    return { capture: "需求记录", align: "需求对齐", specify: "范围确认", build: "开发", verify: "验证", integrate: "本地交付", experience: "体验验收", release: "发布准备", operate: "运行", learn: "经验沉淀" }[value] || "状态核对";
  }

  function renderPmBrief(workspace) {
    const brief = workspace.pmBrief;
    if (!brief) return "";
    const card = brief.decisionCard;
    return `<section class="pm-brief-band ${statusClass(brief.productState)}" aria-label="产品状态">
      <div class="pm-brief-lead"><span class="section-kicker">产品状态</span><h2>${escapeHtml(brief.headline)}</h2><p>${escapeHtml(brief.userImpact)}</p></div>
      <div class="pm-brief-facts">
        <div><span>当前阶段</span><strong>${escapeHtml(stageLabel(brief.stage))}</strong></div>
        <div><span>是否需要你</span><strong>${escapeHtml(brief.actionRequired === "none" ? "不需要，Codex 会继续" : "需要你的判断")}</strong></div>
        <div><span>下一步</span><strong>${escapeHtml(brief.nextStep)}</strong></div>
      </div>
      ${card ? `<div class="pm-decision-block"><div><span class="section-kicker">需要你决定</span><h3>${escapeHtml(card.question)}</h3><p>${escapeHtml(card.whyNow)}</p><strong>建议：${escapeHtml(card.recommendation)}</strong></div><div class="pm-decision-options">${card.options.map((option) => `<div><b>${escapeHtml(option.label)}</b><span>${escapeHtml(option.outcome)}</span></div>`).join("")}<small>暂不决定：${escapeHtml(card.waitingImpact)}</small></div></div>` : ""}
      <details class="pm-evidence-boundary"><summary>这份结论证明了什么</summary><div><p><strong>已证明</strong>${escapeHtml((brief.evidenceBoundary?.proves || []).join("；"))}</p><p><strong>尚未证明</strong>${escapeHtml((brief.evidenceBoundary?.doesNotProve || []).join("；"))}</p></div></details>
    </section>`;
  }

  function renderWorkspaceRuntime(workspace) {
    const runtime = workspace.states?.runtime || {};
    const presentation = runtimePresentation(workspace.runtime || {}, localizeText(workspace.primaryAttention?.lane === "Runtime" ? workspace.primaryAttention.reason : runtime.summary || "运行证据不足"));
    return `<section class="runtime-banner compact ${statusClass(runtime.status)}"><div class="runtime-banner-icon">${icon("server", "icon")}</div><div class="runtime-banner-copy"><strong>${escapeHtml(presentation.title)}</strong><span>${escapeHtml(presentation.detail)}</span></div><button class="secondary-button" type="button" data-action="shortcut" data-kind="runtime-status" data-workspace-id="${escapeHtml(workspace.workspaceId)}">检查状态</button></section>`;
  }

  function renderDeliveryEvidence(workspace) {
    const git = workspace.gitBaseline;
    const runtime = workspace.runtimeDelivery;
    if (!git && !runtime) return "";
    const gitDetails = git?.details || {};
    const runtimeDetails = runtime?.details || {};
    const runtimeBaseline = runtimeDetails.baseline || {};
    const runtimeState = runtimeDetails.runtime || {};
    const driftCount = Array.isArray(runtimeDetails.drift) ? runtimeDetails.drift.length : 0;
    const rows = [];
    if (git) rows.push(
      '<div class="evidence-row"><span class="evidence-module">Git 基线</span><div><strong>'
      + escapeHtml(git.status || "unknown")
      + '</strong><small>'
      + escapeHtml(git.relativePath || "")
      + '</small></div><span>'
      + String((gitDetails.taskOwned || []).length) + " 项纳入 · " + String((gitDetails.mixedOrUnknown || []).length) + " 项待处理"
      + '</span></div>'
    );
    if (runtime) rows.push(
      '<div class="evidence-row"><span class="evidence-module">Runtime</span><div><strong>'
      + escapeHtml(runtime.status || "unknown")
      + '</strong><small>'
      + escapeHtml(String(runtimeBaseline.baselineId || "") + " · drift " + driftCount)
      + '</small></div><span>'
      + escapeHtml(runtimeDetails.authorizationRequired ? "需要授权" : runtimeState.resolutionSource || "未记录入口")
      + '</span></div>'
    );
    if (runtimeState.installedRoot || runtimeState.actualEntrypoint) rows.push(
      '<div class="evidence-row"><span class="evidence-module">运行入口</span><div><strong>'
      + escapeHtml(runtimeState.resolutionSource || "unknown")
      + '</strong><small>'
      + escapeHtml(runtimeState.installedRoot || "未记录 installed root")
      + '</small></div><span>'
      + escapeHtml(runtimeState.actualEntrypoint || "未记录 entrypoint")
      + '</span></div>'
    );
    const recovery = runtimeDetails.recoveryEntry || gitDetails.recoveryEntry || "";
    return '<section class="section-band delivery-evidence-panel">'
      + '<div class="section-header"><div><span class="section-kicker">交付预检</span><h2>当前验收基线</h2></div>'
      + chip(runtime?.status || git?.status || "unknown")
      + '</div><div class="evidence-list">'
      + rows.join("")
      + '</div>'
      + (recovery ? '<p class="delivery-profile-copy">恢复入口：' + escapeHtml(localizeText(recovery)) + '</p>' : "")
      + '</section>';
  }

  function renderDetailTab(workspace) {
    if (state.detailTab === "evidence") return `${renderDeliveryEvidence(workspace)}<div class="lane-grid">${Object.entries(workspace.lanes || {}).map(([name, lane]) => renderLanePanel(name, lane)).join("")}</div>${renderExecutionLanes(workspace)}${renderDeliveryProfile(workspace.effectiveDeliveryProfile, workspace.executionTiming, workspace.capabilityRoutes)}${renderEvidence(workspace)}`;
    if (state.detailTab === "timeline") return renderTimeline(workspace);
    if (state.detailTab === "actions") return renderActions(workspace);
    return `
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">下一步</span><h2>${escapeHtml(workspace.pmBrief?.actionRequired === "none" ? "Codex 会继续" : "等待你的判断")}</h2></div></div>
        <div class="recommendation-list"><div class="recommendation-row"><div>${icon(workspace.pmBrief?.actionRequired === "none" ? "chevron-right" : "circle-help", "recommendation-icon")}</div><div><strong>${escapeHtml(workspace.pmBrief?.nextStep || "Codex 将继续核对当前状态。")}</strong><p>${escapeHtml(workspace.pmBrief?.userImpact || "现有产品和使用环境保持不变。")}</p></div></div></div>
      </section>`;
  }

  function renderExecutionLanes(workspace) {
    const lanes = workspace.executionLanes || {};
    const entries = [["开发", lanes.development], ["验收", lanes.acceptance], ["恢复", lanes.recovery]].filter(([, lane]) => lane);
    if (!entries.length && !(workspace.blockers || []).length) return "";
    return `<section class="section-band"><div class="section-header"><div><span class="section-kicker">执行通道</span><h2>当前并行状态</h2></div></div><div class="evidence-list">
      ${entries.map(([label, lane]) => `<div class="evidence-row"><span class="evidence-module">${label}</span><div><strong>${escapeHtml(lane.milestoneRef || lane.blockerId || "未绑定")}</strong><small>${escapeHtml(lane.baselineRef || lane.acceptanceArtifact || lane.nextStep || "")}</small></div>${chip(lane.status || "unknown")}</div>`).join("")}
      ${(workspace.blockers || []).map((blocker) => `<div class="evidence-row"><span class="evidence-module">阻塞</span><div><strong>${escapeHtml(blocker.title || blocker.id)}</strong><small>${escapeHtml(`${ownerLabel(blocker.owner)} · 尝试 ${blocker.attemptBudget?.used || 0}/${blocker.attemptBudget?.hardCeiling || 4} · ${blocker.recoveryEntry || "无恢复入口"}`)}</small></div>${chip(blocker.executionStatus || "blocked")}</div>`).join("")}
    </div></section>`;
  }

  function deliveryProfileLabel(value) {
    return {
      rapid: "快速形成可验收候选",
      balanced: "平衡交付速度与复核",
      strict: "严格交付与复核"
    }[value] || "未记录交付方式";
  }

  function deliveryProfileSourceLabel(value) {
    return {
      default: "默认设置",
      user: "用户设置",
      workspace: "工作区设置",
      spec: "规格书要求",
      safety_elevation: "风险提高"
    }[value] || value || "未记录";
  }

  function recordedMinutes(value) {
    return Number.isFinite(value) ? `${Math.round(value)} 分钟` : "未记录";
  }

  function routingSummary(route) {
    if (!route) return "当前没有需要分派的独立子任务";
    if (route.enforcement === "applied") return "已按当前能力档位执行";
    if (route.enforcement === "advisory_only") return "当前环境仅提供能力档位建议";
    return "当前能力档位不可直接应用";
  }

  function renderDeliveryProfile(profile, timing = {}, routes = []) {
    if (!profile || typeof profile !== "object" || !profile.profile) return "";
    const budgets = profile.budgets || {};
    const route = Array.isArray(routes) && routes.length ? routes[routes.length - 1] : null;
    const deadline = profile.deadlineAt ? formatDate(profile.deadlineAt, true) : "未记录";
    return `<section class="section-band delivery-profile-panel">
      <div class="section-header"><div><span class="section-kicker">交付节奏</span><h2>当前执行方式</h2></div>${chip(profile.profile)}</div>
      <div class="update-summary delivery-profile-summary">
        <div><span>目标</span><strong>${escapeHtml(deliveryProfileLabel(profile.profile))}</strong></div>
        <div><span>计划收口时间</span><strong>${escapeHtml(deadline)}</strong></div>
        <div><span>已记录周期</span><strong>${escapeHtml(recordedMinutes(timing?.calendarMinutes))}</strong></div>
        <div><span>子任务分工</span><strong>${escapeHtml(routingSummary(route))}</strong></div>
      </div>
      <p class="delivery-profile-copy">当前设置减少重复治理，不降低规格书要求的安全、验证或验收标准。</p>
      <details class="delivery-profile-details"><summary>查看执行细节</summary><div>
        <span>来源：${escapeHtml(deliveryProfileSourceLabel(profile.profileSource))}</span>
        <span>可选 Review：${escapeHtml(budgets.reviewRunBudget ?? "未记录")} 次</span>
        <span>同基线证据：${escapeHtml(budgets.evidencePassBudget ?? "未记录")} 次</span>
        <span>子 Agent：${escapeHtml(budgets.subagentSpawnBudget ?? "未记录")} 个</span>
        <span>阻塞尝试：${escapeHtml(budgets.blockerAttemptBudget ?? "未记录")} 次</span>
        ${route ? `<span>最近路由：${escapeHtml(`${route.taskClass || "未分类"} · ${route.tier || "未记录"} · ${route.enforcement || "unknown"}`)}</span>` : ""}
      </div></details>
    </section>`;
  }

  function ownerLabel(value) {
    return { main_agent: "主 Agent", subagent: "子 Agent", user: "用户", external_party: "外部责任人", codex: "Codex" }[value] || value || "未指定";
  }

  function renderEvidence(workspace) {
    const pendingCodex = workspace.pendingCodexVerification || [];
    const pendingPm = workspace.pendingPmVerification || [];
    const artifacts = workspace.artifacts || [];
    return `
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">事实关系</span><h2>当前选择</h2></div></div>
        <div class="evidence-list">
          ${renderLineageRow("工作流", workspace.authoritativeWorkstream)}
          ${renderLineageRow("版本验收", workspace.selectedAcceptance)}
          ${renderLineageRow("版本 Review", workspace.releaseReview)}
          ${(workspace.openAnalysisReviews || []).map((item) => renderLineageRow("分析 Review", {
            artifactPath: item.reviewArtifact || item.analysisArtifact,
            selectionReason: item.selectionReason,
            relationStatus: item.relationStatus,
            status: item.status
          })).join("")}
        </div>
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">验证</span><h2>待验证</h2></div></div>
        <div class="verification-columns">
          <div><h3>Codex 补证 <span>${pendingCodex.length}</span></h3>${renderVerificationItems(pendingCodex, "Codex 暂无待补证项")}</div>
          <div><h3>PM 验收 <span>${pendingPm.length}</span></h3>${renderVerificationItems(pendingPm, "PM 暂无待验收项")}</div>
        </div>
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">证据</span><h2>Artifact 索引</h2></div><span class="section-meta">${artifacts.length} 条</span></div>
        <div class="evidence-list">${artifacts.slice(0, 80).map((artifact) => `<div class="evidence-row"><span class="evidence-module">${escapeHtml(artifact.module)}</span><div><strong>${escapeHtml(artifact.title || artifact.id)}</strong><small>${escapeHtml(artifact.relativePath)}</small></div>${chip(artifact.status)}<time>${formatDate(artifact.updatedAt, true)}</time><button class="icon-button" type="button" data-action="copy" data-copy="${escapeHtml(artifact.relativePath)}" title="复制路径">${icon("copy", "icon")}</button></div>`).join("")}</div>
      </section>`;
  }

  function renderLineageRow(label, item) {
    const artifactPath = item?.artifactPath || item?.relativePath || "";
    const reason = SELECTION_REASON_LABELS[item?.selectionReason] || item?.selectionReason || "未记录选择原因";
    const relation = item?.relationStatus || "unknown";
    return `<div class="evidence-row"><span class="evidence-module">${escapeHtml(label)}</span><div><strong>${escapeHtml(artifactPath ? artifactPath.split("/").pop() : "未选择")}</strong><small>${escapeHtml(reason)}${artifactPath ? ` · ${escapeHtml(artifactPath)}` : ""}</small></div>${chip(item?.reviewStatus || item?.status || relation)}${chip(relation)}</div>`;
  }

  function renderVerificationItems(items, emptyText) {
    if (!items.length) return `<div class="inline-empty">${escapeHtml(emptyText)}</div>`;
    return `<div class="verification-list">${items.map((item) => `<article><header><strong>${escapeHtml(item.name || item.id)}</strong>${chip(item.verificationStatus)}</header><p>${escapeHtml(item.verificationReason || item.expected || "")}</p>${(item.verificationTasks || []).slice(0, 2).map((task) => `<div class="verification-task"><b>${escapeHtml(task.claim || task.id)}</b><ol>${(task.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><small>预期：${escapeHtml(task.expectedResult || "")}</small></div>`).join("")}</article>`).join("")}</div>`;
  }

  function renderTimeline(workspace) {
    const items = [...(workspace.timeline || []).map((item) => ({ ...item, timelineType: "artifact" })), ...(workspace.sessions || []).map((item) => ({ ...item, timelineType: "session", updatedAt: item.updatedAt || item.createdAt }))]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    if (!items.length) return renderEmpty("没有可用时间线");
    return `<section class="section-band"><div class="timeline-list">${items.slice(0, 120).map((item) => `<div class="timeline-row"><div class="timeline-marker">${icon(item.timelineType === "session" ? "terminal" : "file-text", "timeline-icon")}</div><time>${formatDate(item.updatedAt || item.createdAt)}</time><div><strong>${escapeHtml(item.title || item.id)}</strong><small>${escapeHtml(item.timelineType === "session" ? `Session · ${item.id}` : `${item.module || item.kind} · ${item.relativePath || ""}`)}</small></div>${item.status ? chip(item.status) : ""}</div>`).join("")}</div></section>`;
  }

  function renderActions(workspace) {
    const fallback = SHORTCUTS.slice(0, 4).map(([kind, iconName, label]) => ({ kind, icon: iconName, label, reason: "基于当前证据生成。" }));
    const primary = (workspace.shortcutActions?.length ? workspace.shortcutActions : fallback).slice(0, 4);
    const secondary = workspace.shortcutMenuActions || [];
    const actionButton = (item, className = "action-command") => `<button class="${className}" type="button" data-action="shortcut" data-kind="${escapeHtml(item.kind)}" data-workspace-id="${escapeHtml(workspace.workspaceId)}">${icon(item.icon || "chevron-right", className === "action-command" ? "action-icon" : "menu-icon")}<span><strong>${escapeHtml(item.label || item.kind)}</strong><small>${escapeHtml(item.reason || workspace.suggestions?.[0]?.reason || workspace.primaryAttention?.reason || "基于当前证据生成")}</small></span>${className === "action-command" ? icon("chevron-right", "row-chevron") : ""}</button>`;
    return `
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">快捷指令</span><h2>下一步</h2></div></div>
        <div class="action-grid">${primary.map((item) => actionButton(item)).join("")}</div>
        ${secondary.length ? `<details class="shortcut-more"><summary>${icon("ellipsis", "button-icon")}更多指令 <span>${secondary.length}</span></summary><div class="shortcut-menu">${secondary.map((item) => actionButton(item, "shortcut-menu-item")).join("")}</div></details>` : ""}
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">来源</span><h2>数据缺口</h2></div></div>
        ${workspace.dataGaps?.length ? `<div class="gap-list">${workspace.dataGaps.map((gap) => chip("unknown", gap)).join("")}</div>` : renderEmpty("当前未记录数据缺口")}
      </section>`;
  }

  function renderConfigPage() {
    if (state.configLoading && !state.configView) return renderLoading("正在读取配置契约");
    return `
      <div class="page-header"><div><span class="section-kicker">配置中心</span><h1>RAVO 配置</h1><p>当前生效值、来源和校验状态</p></div></div>
      ${renderConfigIntegrity()}
      <div class="settings-layout">
        <aside class="settings-nav">${state.configModules.map((module) => `<button type="button" class="settings-nav-item ${state.configModuleId === module.moduleId ? "is-active" : ""}" data-action="config-module" data-module="${escapeHtml(module.moduleId)}"><span>${escapeHtml(module.displayName)}</span><small>${module.configurable ? `${module.fieldCount} 项` : "无配置项"}</small></button>`).join("")}</aside>
        <section class="settings-content">${renderConfigModule()}</section>
      </div>`;
  }

  function integrityReason(value) {
    return INTEGRITY_REASON_LABELS[value] || value || "未说明";
  }

  function pluginIdFromSection(value) {
    const match = String(value || "").match(/^plugins\."([^"]+)"$/);
    return match ? match[1] : "";
  }

  function renderConfigIntegrity() {
    const value = state.configIntegrity;
    if (state.integrityLoading && !value) return `<section class="section-band">${renderLoading("正在检查 Codex 配置完整性")}</section>`;
    if (!value) return "";
    if (value.error) return `<section class="section-band"><div class="section-header"><div><span class="section-kicker">Codex 配置</span><h2>配置完整性</h2></div><button class="secondary-button" type="button" data-action="integrity-refresh">${icon("refresh-cw", "button-icon")}重新检查</button></div><div class="inline-warning">${icon("triangle-alert", "inline-icon")}${escapeHtml(value.error)}</div></section>`;
    const snapshots = value.snapshots || [];
    const selected = value.selectedSnapshotId || snapshots[0]?.snapshotId || "";
    const unresolvedPlugins = (value.unresolvedRequired || []).map((entry) => ({ ...entry, pluginId: pluginIdFromSection(entry.section) })).filter((entry) => entry.pluginId);
    const journals = value.journals || [];
    return `<section class="section-band integrity-panel">
      <div class="section-header"><div><span class="section-kicker">Codex 配置</span><h2>配置完整性</h2></div><div class="button-row"><button class="secondary-button" type="button" data-action="integrity-refresh" ${state.integrityLoading ? "disabled" : ""}>${icon("refresh-cw", "button-icon")}检查</button><button class="secondary-button" type="button" data-action="integrity-snapshot" ${state.integrityLoading ? "disabled" : ""}>${icon("archive", "button-icon")}保存快照</button><button class="primary-button" type="button" data-action="integrity-preview" ${state.integrityLoading ? "disabled" : ""}>${icon("shield-check", "button-icon")}修复预览</button></div></div>
      <div class="update-summary integrity-summary"><div><span>状态</span><strong>${escapeHtml(statusLabel(value.configIntegrityStatus))}</strong></div><div><span>当前 Hash</span><strong class="mono">${escapeHtml(truncate(value.currentHash, 24))}</strong></div><div><span>受保护 Section</span><strong>${escapeHtml(value.protectedSectionCount || 0)}</strong></div><div><span>快照</span><strong>${escapeHtml(snapshots.length)}</strong></div></div>
      ${value.repairRequired ? `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}检测到 ${escapeHtml((value.driftSections || []).length)} 个 RAVO 注册差异。</div>` : ""}
      ${(value.approvalRequired || []).length ? `<div class="field-errors">${value.approvalRequired.map((entry) => `<span>${escapeHtml(entry.section)} · ${escapeHtml(integrityReason(entry.reason))}</span>`).join("")}</div>` : ""}
      <div class="integrity-options">
        <label>基准快照<select data-role="integrity-snapshot"><option value="">不使用快照</option>${snapshots.map((snapshot) => `<option value="${escapeHtml(snapshot.snapshotId)}" ${snapshot.snapshotId === selected ? "selected" : ""}>${escapeHtml(formatDate(snapshot.createdAt, true))} · ${escapeHtml(statusLabel(snapshot.trustLevel))}</option>`).join("")}</select></label>
        ${(value.externalCandidates || []).length ? `<fieldset><legend>可选第三方注册</legend>${value.externalCandidates.map((section) => `<label class="check-row"><input type="checkbox" data-role="integrity-external" value="${escapeHtml(section)}" ${value.preserveExternalRegistrationsDefault ? "checked" : ""}><span>${escapeHtml(section)}</span></label>`).join("")}</fieldset>` : ""}
        ${unresolvedPlugins.length ? `<fieldset><legend>已停用的必需插件</legend>${unresolvedPlugins.map((entry) => `<label class="check-row"><input type="checkbox" data-role="integrity-reenable" value="${escapeHtml(entry.pluginId)}"><span>${escapeHtml(entry.pluginId)}</span></label>`).join("")}</fieldset>` : ""}
      </div>
      ${journals.length ? `<div class="journal-list integrity-journals">${journals.slice(0, 6).map((journal) => `<div class="journal-row"><div><strong>${escapeHtml(journal.repairId)}</strong><small>${formatDate(journal.updatedAt || journal.createdAt)}</small></div>${chip(journal.status)}<span>${escapeHtml(journal.managedChangeCount || 0)} 项</span>${["partial", "failed", "manual_recovery_required", "succeeded"].includes(journal.status) ? `<button class="secondary-button" type="button" data-action="integrity-recover" data-repair-id="${escapeHtml(journal.repairId)}">${icon("rotate-ccw", "button-icon")}恢复</button>` : ""}</div>`).join("")}</div>` : ""}
    </section>`;
  }

  function renderConfigModule() {
    const view = state.configView;
    if (state.configLoading) return renderLoading("正在读取模块配置");
    if (!view) return renderEmpty("请选择配置模块");
    const module = state.configModules.find((item) => item.moduleId === state.configModuleId) || {};
    if (!view.configurable) return `<div class="config-empty"><h2>${escapeHtml(view.displayName || module.displayName)}</h2>${renderEmpty("此模块没有公开配置项")}</div>`;
    const workspaceOptions = state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.workspaceId)}" ${state.configWorkspaceId === workspace.workspaceId ? "selected" : ""}>${escapeHtml(workspace.displayName)}</option>`).join("");
    const fields = view.fields || [];
    return `
      <div class="config-header">
        <div><h2>${escapeHtml(view.displayName)}</h2><p>${chip(view.status)}${view.valid === false ? chip("error", "配置无效") : ""}${view.migrationStatus === "available" ? chip("attention", "可迁移") : ""}</p><small class="config-target mono">目标文件：${escapeHtml(view.targetPath || "未解析")} · 来源优先级：${escapeHtml((view.sourcePrecedence || []).map(sourceLabel).join(" > ") || "未解析")}</small></div>
        <div class="scope-controls">
          ${module.workspaceConfigurable ? `<label>作用域<select data-role="config-scope"><option value="user" ${state.configScope === "user" ? "selected" : ""}>用户级</option><option value="workspace" ${state.configScope === "workspace" ? "selected" : ""}>工作区</option></select></label>` : ""}
          ${state.configScope === "workspace" ? `<label>工作区<select data-role="config-workspace"><option value="">选择工作区</option>${workspaceOptions}</select></label>` : ""}
        </div>
      </div>
      ${(view.warnings || []).length ? `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}${escapeHtml(view.warnings.join(" "))}</div>` : ""}
      ${(view.errors || []).length ? `<div class="field-errors">${view.errors.map((error) => `<span>${escapeHtml(error.path)} · ${escapeHtml(error.message)}</span>`).join("")}</div>` : ""}
      ${state.configModuleId === "core" ? renderDeliveryProfile(view.effectiveDeliveryProfile) : ""}
      <form class="config-form" data-role="config-form">
        ${fields.filter((field) => field.path !== "providers").map(renderField).join("")}
        ${state.configModuleId === "review" ? renderProviderEditor(view) : ""}
        <div class="form-actions"><button class="secondary-button" type="button" data-action="config-validate">${icon("check", "button-icon")}校验</button><button class="primary-button" type="button" data-action="config-save">${icon("save", "button-icon")}保存</button></div>
      </form>
      ${renderBackups(view)}`;
  }

  function renderField(field) {
    const value = field.effectiveValue;
    const meta = `<small class="field-meta"><span>来源：${escapeHtml(sourceLabel(field.source || "default"))}</span><span>默认：${escapeHtml(typeof field.default === "object" ? toJson(field.default) : field.default)}</span></small>`;
    if (field.type === "boolean") return `<div class="field-row"><div class="field-label"><label for="field-${escapeHtml(field.path)}">${escapeHtml(field.label)}</label><p>${escapeHtml(field.description)}</p>${meta}</div><label class="toggle-control"><input id="field-${escapeHtml(field.path)}" type="checkbox" data-config-path="${escapeHtml(field.path)}" data-field-type="boolean" ${value ? "checked" : ""}><span></span></label></div>`;
    if (field.type === "enum") return `<div class="field-row"><div class="field-label"><label for="field-${escapeHtml(field.path)}">${escapeHtml(field.label)}</label><p>${escapeHtml(field.description)}</p>${meta}</div><select class="field-control" id="field-${escapeHtml(field.path)}" data-config-path="${escapeHtml(field.path)}" data-field-type="enum">${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></div>`;
    if (field.type === "string-array") return `<div class="field-row field-row-stack"><div class="field-label"><label for="field-${escapeHtml(field.path)}">${escapeHtml(field.label)}</label><p>${escapeHtml(field.description)}</p>${meta}</div><textarea class="field-control mono" id="field-${escapeHtml(field.path)}" rows="4" data-config-path="${escapeHtml(field.path)}" data-field-type="string-array">${escapeHtml((value || []).join("\n"))}</textarea></div>`;
    if (field.type === "object-list") return `<div class="field-row field-row-stack"><div class="field-label"><label for="field-${escapeHtml(field.path)}">${escapeHtml(field.label)}</label><p>${escapeHtml(field.description)}</p>${meta}</div><textarea class="field-control mono" id="field-${escapeHtml(field.path)}" rows="8" data-config-path="${escapeHtml(field.path)}" data-field-type="object-list">${escapeHtml(toJson(value || field.default || {}))}</textarea></div>`;
    const inputType = field.type === "integer" ? "number" : "text";
    return `<div class="field-row"><div class="field-label"><label for="field-${escapeHtml(field.path)}">${escapeHtml(field.label)}</label><p>${escapeHtml(field.description)}</p>${meta}</div><input class="field-control" id="field-${escapeHtml(field.path)}" type="${inputType}" data-config-path="${escapeHtml(field.path)}" data-field-type="${escapeHtml(field.type)}" value="${escapeHtml(value == null ? "" : value)}" ${field.min != null ? `min="${field.min}"` : ""} ${field.max != null ? `max="${field.max}"` : ""}></div>`;
  }

  function providerSource(view) {
    if (state.providersDraft) return state.providersDraft;
    if (Array.isArray(view.values?.providers)) return view.values.providers.map(normalizeProviderDraft);
    if (view.values?.legacyProvider) return [normalizeProviderDraft(view.values.legacyProvider)];
    return [];
  }

  function normalizeProviderDraft(provider) {
    return {
      id: provider.id || "provider",
      label: provider.label || provider.id || "Provider",
      enabled: provider.enabled !== false,
      apiBase: provider.apiBase || "",
      apiMode: provider.apiMode || "responses",
      maxTokensMode: provider.maxTokensMode || "auto",
      maxTokens: provider.maxTokens == null ? "" : provider.maxTokens,
      autoFallbackMaxTokens: provider.autoFallbackMaxTokens == null ? 48000 : provider.autoFallbackMaxTokens,
      apiKeyConfigured: Boolean(provider.apiKey?.configured),
      secretAction: "keep",
      secretValue: "",
      models: (provider.models || []).map((model) => ({ id: model.id || model.modelId || "", enabled: model.enabled !== false }))
    };
  }

  function renderProviderEditor(view) {
    const providers = providerSource(view);
    const legacy = view.configShape === "legacy_flat" && !state.providersDirty;
    return `<section class="provider-editor">
      <div class="section-header"><div><span class="section-kicker">提供方</span><h3>Review Provider 与模型</h3></div>${legacy ? `<button class="secondary-button" type="button" data-action="provider-migrate">迁移为 Provider 配置</button>` : `<button class="secondary-button" type="button" data-action="provider-add">${icon("plus", "button-icon")}添加 Provider</button>`}</div>
      ${legacy ? `<div class="inline-warning">${icon("info", "inline-icon")}当前为 legacy flat 配置，只有确认保存后才会迁移。</div>` : ""}
      <div class="provider-table">${providers.length ? providers.map((provider, index) => renderProvider(provider, index, legacy)).join("") : renderEmpty("尚未配置 Review Provider")}</div>
    </section>`;
  }

  function renderProvider(provider, index, readonly) {
    return `<article class="provider-row" data-provider-index="${index}">
      <header><div><strong>${escapeHtml(provider.label || provider.id)}</strong><small>${escapeHtml(provider.id)} · ${escapeHtml(provider.apiMode)} · ${provider.models.length} 个模型</small></div>${provider.apiKeyConfigured ? chip("healthy", "凭证已配置") : chip("missing", "凭证缺失")}${readonly ? "" : `<button class="icon-button danger-ghost" type="button" data-action="provider-remove" data-index="${index}" title="删除 Provider">${icon("trash-2", "icon")}</button>`}</header>
      <div class="provider-fields">
        <label>Provider ID<input type="text" data-provider-field="id" value="${escapeHtml(provider.id)}" ${readonly ? "disabled" : ""}></label>
        <label>显示名称<input type="text" data-provider-field="label" value="${escapeHtml(provider.label)}" ${readonly ? "disabled" : ""}></label>
        <label>API 模式<select data-provider-field="apiMode" ${readonly ? "disabled" : ""}><option value="responses" ${provider.apiMode === "responses" ? "selected" : ""}>responses</option><option value="chat" ${provider.apiMode === "chat" ? "selected" : ""}>chat</option><option value="fake" ${provider.apiMode === "fake" ? "selected" : ""}>fake</option></select></label>
        <label class="provider-endpoint">API Base<input type="url" data-provider-field="apiBase" value="${escapeHtml(provider.apiBase)}" ${readonly ? "disabled" : ""}></label>
        <label>启用<span class="toggle-control inline"><input type="checkbox" data-provider-field="enabled" ${provider.enabled ? "checked" : ""} ${readonly ? "disabled" : ""}><span></span></span></label>
        <label>输出预算<select data-provider-field="maxTokensMode" ${readonly ? "disabled" : ""}><option value="auto" ${provider.maxTokensMode === "auto" ? "selected" : ""}>auto</option><option value="fixed" ${provider.maxTokensMode === "fixed" ? "selected" : ""}>fixed</option></select></label>
        <label>固定 Token<input type="number" min="1" max="2000000" data-provider-field="maxTokens" value="${escapeHtml(provider.maxTokens)}" ${readonly ? "disabled" : ""}></label>
        <label>Auto 补偿<input type="number" min="0" max="2000000" data-provider-field="autoFallbackMaxTokens" value="${escapeHtml(provider.autoFallbackMaxTokens)}" ${readonly ? "disabled" : ""}></label>
        <label>凭证动作<select data-provider-field="secretAction" ${readonly ? "disabled" : ""}><option value="keep" ${provider.secretAction === "keep" ? "selected" : ""}>保留</option><option value="replace" ${provider.secretAction === "replace" ? "selected" : ""}>替换</option><option value="clear" ${provider.secretAction === "clear" ? "selected" : ""}>清除</option></select></label>
        <label class="provider-secret">新凭证<input type="password" data-provider-field="secretValue" value="${escapeHtml(provider.secretValue || "")}" autocomplete="new-password" placeholder="仅替换时填写" ${readonly ? "disabled" : ""}></label>
      </div>
      <div class="model-list"><div class="model-list-head"><strong>模型</strong>${readonly ? "" : `<button class="icon-button" type="button" data-action="model-add" data-index="${index}" title="添加模型">${icon("plus", "icon")}</button>`}</div>${provider.models.length ? provider.models.map((model, modelIndex) => `<div class="model-row" data-model-index="${modelIndex}"><input type="text" data-model-field="id" value="${escapeHtml(model.id)}" ${readonly ? "disabled" : ""}><label class="toggle-control inline"><input type="checkbox" data-model-field="enabled" ${model.enabled ? "checked" : ""} ${readonly ? "disabled" : ""}><span></span></label>${readonly ? "" : `<button class="icon-button danger-ghost" type="button" data-action="model-remove" data-index="${index}" data-model-index="${modelIndex}" title="删除模型">${icon("x", "icon")}</button>`}</div>`).join("") : `<div class="inline-empty">没有模型</div>`}</div>
    </article>`;
  }

  function renderBackups(view) {
    const backups = view.backups || [];
    if (!backups.length) return "";
    return `<section class="backup-section"><div class="section-header"><div><span class="section-kicker">备份</span><h3>可恢复版本</h3></div></div><div class="backup-list">${backups.slice(0, 8).map((backup) => `<div><span><strong>${formatDate(backup.createdAt)}</strong><small>${escapeHtml(backup.backupId)}</small></span><button class="secondary-button" type="button" data-action="config-restore" data-backup-id="${escapeHtml(backup.backupId)}">${icon("rotate-ccw", "button-icon")}恢复</button></div>`).join("")}</div></section>`;
  }

  function renderReviewPage() {
    const config = state.reviewConfig;
    if (!config) return renderLoading("正在读取 Review 配置");
    const providers = Array.isArray(config.values?.providers) ? config.values.providers : config.values?.legacyProvider ? [config.values.legacyProvider] : [];
    const pairs = providers.flatMap((provider) => (provider.models || []).filter((model) => provider.enabled !== false && model.enabled !== false).map((model) => `${provider.id}/${model.id}`));
    return `
      <div class="page-header"><div><span class="section-kicker">RAVO Review</span><h1>对抗式评审</h1><p>${config.counts?.enabledProviderCount || 0} 个 Provider · ${config.counts?.enabledModelCount || 0} 个模型 · ${config.fields?.find((field) => field.path === "rounds")?.effectiveValue || 2} 轮</p></div><button class="secondary-button" type="button" data-action="config-module" data-module="review" data-navigate-config="true">${icon("settings", "button-icon")}管理 Provider</button></div>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">运行</span><h2>发起评审</h2></div>${config.valid ? chip("healthy", "配置有效") : chip("error", "配置无效")}</div>
        <form class="review-form" data-role="review-form">
          <label>工作区<select name="workspaceId">${state.workspaces.map((workspace) => `<option value="${escapeHtml(workspace.workspaceId)}">${escapeHtml(workspace.displayName)}</option>`).join("")}</select></label>
          <label>领域<input type="text" name="domain" value="implementation" placeholder="implementation"></label>
          <label>数据边界<select name="dataBoundary"><option value="safe_sanitized">已脱敏，可外发</option><option value="sensitive_requires_consent">敏感，需确认</option><option value="prohibited">禁止外发</option></select></label>
          <label>轮次<input type="number" name="rounds" min="1" max="3" value="${escapeHtml(config.fields?.find((field) => field.path === "rounds")?.effectiveValue || 2)}"></label>
          <label class="review-consent"><input type="checkbox" name="confirmSensitive"><span>确认本次敏感内容已进一步脱敏并授权当前调用</span></label>
          <fieldset class="pair-selector"><legend>Provider / 模型</legend>${pairs.length ? pairs.map((pair, index) => `<label><input type="checkbox" name="pairs" value="${escapeHtml(pair)}" ${index < Math.max(1, pairs.length) ? "checked" : ""}><span>${escapeHtml(pair)}</span></label>`).join("") : `<div class="inline-empty">没有可用 Provider/模型</div>`}</fieldset>
          <label class="review-subject">评审对象<textarea name="subject" rows="9" placeholder="输入已脱敏的需求、方案、实现或验收对象"></textarea></label>
          <div class="form-actions"><button class="secondary-button" type="button" data-action="review-test" ${pairs.length ? "" : "disabled"}>${icon("flask-conical", "button-icon")}连通性测试</button><button class="primary-button" type="button" data-action="review-preview" ${pairs.length ? "" : "disabled"}>${icon("play", "button-icon")}预览并发起</button></div>
        </form>
      </section>
      <section class="section-band">
        <div class="section-header"><div><span class="section-kicker">提供方</span><h2>当前 Provider</h2></div></div>
        <div class="data-table provider-summary-table"><div class="data-table-head"><span>Provider</span><span>模式</span><span>凭证</span><span>模型</span><span>状态</span></div>${providers.map((provider) => `<div class="data-table-row"><span><strong>${escapeHtml(provider.label || provider.id)}</strong><small>${escapeHtml(provider.id)}</small></span><span data-label="模式">${escapeHtml(provider.apiMode)}</span><span data-label="凭证">${provider.apiKey?.configured ? chip("healthy", "已配置") : chip("missing", "缺失")}</span><span data-label="模型">${escapeHtml((provider.models || []).filter((model) => model.enabled !== false).length)}</span><span data-label="状态">${provider.enabled === false ? chip("paused", "停用") : chip("active", "启用")}</span></div>`).join("")}</div>
      </section>
      ${renderReviewRun()}`;
  }

  function renderReviewRun() {
    const run = state.reviewRun;
    if (!run) return "";
    const pairs = Object.entries(run.progress?.pairs || {});
    return `<section class="section-band"><div class="section-header"><div><span class="section-kicker">运行</span><h2>${escapeHtml(run.reviewRunId)}</h2></div>${chip(run.status)}</div><div class="review-progress"><div class="progress-summary"><span>当前轮次 <strong>${escapeHtml(run.progress?.currentRound || 0)}</strong></span><span>事件 <strong>${escapeHtml(run.progress?.lastEvent || "queued")}</strong></span><span>更新时间 <strong>${formatDate(run.progress?.updatedAt, true)}</strong></span></div>${pairs.length ? `<div class="data-table"><div class="data-table-head"><span>Provider / 模型</span><span>轮次</span><span>尝试</span><span>类型</span><span>结果</span></div>${pairs.map(([pair, progress]) => `<div class="data-table-row"><span>${escapeHtml(pair)}</span><span data-label="轮次">${escapeHtml(progress.round)}</span><span data-label="尝试">${escapeHtml(progress.attempt)}</span><span data-label="类型">${escapeHtml(progress.attemptType)}</span><span data-label="结果">${chip(progress.result)}</span></div>`).join("")}</div>` : renderLoading("等待 Provider 响应")}${run.result ? `<div class="run-result"><strong>覆盖范围 ${escapeHtml(run.result.workflowCoverage || run.result.coverage || "unknown")}</strong><span>解析状态 ${escapeHtml(run.result.parserStatus || "unknown")}</span><span>可用模型 ${(run.result.modelsUsable || []).length}</span>${run.result.artifactPath ? `<button class="text-button" type="button" data-action="copy" data-copy="${escapeHtml(run.result.artifactPath)}">复制 Artifact 路径</button>` : ""}</div>` : ""}</div></section>`;
  }

  function renderUpdatesPage() {
    if (!state.updateView) return renderLoading("正在读取 RAVO 更新状态");
    const check = state.updateView.check || {};
    const journals = state.updateView.journals || [];
    return `
      <div class="page-header"><div><span class="section-kicker">更新</span><h1>RAVO 更新</h1><p>当前 ${escapeHtml(check.currentVersion || "未知")} · 可用 ${escapeHtml(check.availableVersion || "未知")}</p></div><button class="primary-button" type="button" data-action="update-check" ${state.updateLoading ? "disabled" : ""}>${icon("refresh-cw", "button-icon")}检查更新</button></div>
      <section class="section-band">
        <div class="update-summary"><div><span>Marketplace</span><strong>${escapeHtml(sourceLabel(check.sourceType))}</strong></div><div><span>状态</span><strong>${escapeHtml(statusLabel(check.status))}</strong></div><div><span>必需插件</span><strong>${escapeHtml((check.requiredPlugins || []).length)}</strong></div><div><span>新 Session</span><strong>${check.freshSessionRequired ? "需要" : "否"}</strong></div></div>
        <div class="data-table update-table"><div class="data-table-head"><span>插件</span><span>当前</span><span>可用</span><span>缓存</span><span>状态</span></div>${(check.plugins || []).map((plugin) => `<div class="data-table-row"><span><strong>${escapeHtml(plugin.pluginId)}</strong></span><span data-label="当前">${escapeHtml(plugin.installedVersion || "缺失")}</span><span data-label="可用">${escapeHtml(plugin.sourceVersion || "未知")}</span><span data-label="缓存">${escapeHtml(plugin.cacheVersion || "缺失")}</span><span data-label="状态">${chip(plugin.status)}</span></div>`).join("")}</div>
      </section>
      <section class="section-band"><div class="section-header"><div><span class="section-kicker">记录</span><h2>升级记录</h2></div></div>${journals.length ? `<div class="journal-list">${journals.slice(0, 12).map((journal) => `<div class="journal-row"><div><strong>${escapeHtml(journal.journalId)}</strong><small>${formatDate(journal.updatedAt || journal.createdAt)}</small></div>${chip(journal.status)}<span>${escapeHtml((journal.pluginResults || []).filter((item) => item.status === "succeeded").length)}/${escapeHtml((journal.pluginResults || []).length)} 个插件</span>${["partial", "failed", "indeterminate"].includes(journal.status) ? `<button class="secondary-button" type="button" data-action="update-recover" data-journal-id="${escapeHtml(journal.journalId)}">${icon("rotate-ccw", "button-icon")}恢复配置</button>` : ""}</div>`).join("")}</div>` : renderEmpty("暂无升级记录")}</section>`;
  }

  function renderCurrentView() {
    if (state.loading) return renderLoading();
    if (state.error) return renderError(state.error);
    if (state.view === "attention") return renderAttentionPage();
    if (state.view === "workspaces") return renderWorkspacesPage();
    if (state.view === "requirements") return renderPoolPage("requirements");
    if (state.view === "knowledge") return renderPoolPage("knowledge");
    if (state.view === "workspace-detail") return renderWorkspaceDetail();
    if (state.view === "config") return renderConfigPage();
    if (state.view === "review") return renderReviewPage();
    if (state.view === "updates") return renderUpdatesPage();
    return renderOverview();
  }

  function render() {
    renderShell(renderCurrentView());
  }

  async function loadOverview() {
    const params = new URLSearchParams();
    if (state.search) params.set("q", state.search);
    if (state.lifecycle) params.set("lifecycle", state.lifecycle);
    if (state.priority) params.set("priority", state.priority);
    if (state.lane) params.set("lane", state.lane);
    const query = params.toString() ? `?${params.toString()}` : "";
    const [workspaceResult, attentionResult, runtimeResult] = await Promise.all([
      api(`/api/workspaces${query}`),
      api("/api/attention"),
      api("/api/runtime")
    ]);
    state.workspaces = workspaceResult.workspaces || [];
    state.metrics = workspaceResult.metrics || {};
    state.attention = attentionResult.attention || [];
    state.runtime = runtimeResult;
  }

  async function loadPool(kind = state.poolKind, renderNow = true) {
    if (state.poolKind !== kind) {
      state.poolStatus = "";
      state.poolItemType = "";
    }
    state.poolKind = kind;
    if (!state.poolWorkspaceId) state.poolWorkspaceId = state.workspaces[0]?.workspaceId || "";
    if (!state.poolWorkspaceId) {
      state.pool = { entries: [], total: 0 };
      return;
    }
    state.poolLoading = true;
    if (renderNow) render();
    try {
      const params = new URLSearchParams({
        q: state.poolQuery,
        status: state.poolStatus,
        priority: kind === "requirements" ? state.poolPriority : "",
        itemType: kind === "requirements" ? state.poolItemType : "",
        limit: "100"
      });
      state.pool = await api(`/api/workspaces/${encodeURIComponent(state.poolWorkspaceId)}/pool/${kind}?${params.toString()}`);
    } finally {
      state.poolLoading = false;
      if (renderNow) render();
    }
  }

  function poolFormValues() {
    const form = document.querySelector('[data-role="pool-form"]');
    if (!form) throw new Error("记录表单不可用");
    const result = {};
    form.querySelectorAll("[data-pool-field]").forEach((control) => {
      const name = control.dataset.poolField;
      if (name === "expectedRevision" || name === "mergeTargetId") return;
      let value = control.value;
      if (["sourceRefs", "candidateVersions", "applicability", "nonApplicability"].includes(name)) value = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (name === "confidence") value = value === "" ? undefined : Number(value);
      result[name] = value;
    });
    const expectedRevision = Number(form.querySelector('[data-pool-field="expectedRevision"]')?.value || 0);
    const mergeTargetId = form.querySelector('[data-pool-field="mergeTargetId"]')?.value.trim() || "";
    return { result, expectedRevision: expectedRevision || undefined, mergeTargetId };
  }

  async function createPoolRecord() {
    const pending = state.pendingConfirmation;
    if (pending?.type !== "pool-create") return;
    let values;
    try { values = poolFormValues().result; } catch (error) { return toast(error.message, "error"); }
    closeDialog();
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.poolWorkspaceId)}/pool/${pending.kind}`, { method: "POST", body: values });
      toast("记录已创建", "success");
      await loadPool(pending.kind, false);
      render();
    } catch (error) { toast(error.message, "error"); }
  }

  async function savePoolRecord() {
    const pending = state.pendingConfirmation;
    if (pending?.type !== "pool-edit") return;
    let values;
    try { values = poolFormValues(); } catch (error) { return toast(error.message, "error"); }
    if (values.mergeTargetId && pending.kind === "requirements") return mergePoolRecord(values.mergeTargetId, values.expectedRevision);
    closeDialog();
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.poolWorkspaceId)}/pool/${pending.kind}/${encodeURIComponent(pending.id)}`, { method: "PUT", body: { ...values.result, expectedRevision: values.expectedRevision } });
      toast("记录已保存", "success");
      await loadPool(pending.kind, false);
      render();
    } catch (error) { toast(error.message, "error"); }
  }

  async function mergePoolRecord(targetId, sourceRevision) {
    const pending = state.pendingConfirmation;
    if (pending?.kind !== "requirements") return;
    closeDialog();
    try {
      await api(`/api/workspaces/${encodeURIComponent(state.poolWorkspaceId)}/pool/requirements/merge`, { method: "POST", body: { sourceId: pending.id, targetId, sourceRevision } });
      toast("需求已合并，原记录保留为重复项", "success");
      await loadPool("requirements", false);
      render();
    } catch (error) { toast(error.message, "error"); }
  }

  async function refreshAll(reason = "manual") {
    state.refreshing = true;
    render();
    try {
      if (reason === "manual") await api("/api/refresh", { method: "POST", body: {} });
      await loadOverview();
      if (state.view === "workspace-detail" && state.workspaceId) await loadWorkspace(state.workspaceId, false);
      if (state.view === "config") {
        await loadConfigModule(false);
        await loadConfigIntegrity(false);
      }
      if (state.view === "review") await loadReview(false);
      if (state.view === "updates") await loadUpdates(false);
      if (["requirements", "knowledge"].includes(state.view)) await loadPool(state.view, false);
      toast("本地索引已刷新", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      state.refreshing = false;
      render();
    }
  }

  async function navigate(view) {
    state.sidebarOpen = false;
    state.view = view;
    state.error = "";
    if (view !== "workspace-detail") state.workspaceId = "";
    render();
    try {
      if (view === "config") await loadConfig();
      else if (view === "review") await loadReview();
      else if (view === "updates") await loadUpdates();
      else if (["overview", "attention", "workspaces"].includes(view)) await loadOverview();
      else if (view === "requirements") await loadPool("requirements");
      else if (view === "knowledge") await loadPool("knowledge");
    } catch (error) {
      state.error = error.message;
    }
    render();
  }

  async function loadWorkspace(id, changeView = true) {
    if (changeView) {
      state.view = "workspace-detail";
      state.workspaceId = id;
      state.workspace = null;
      render();
    }
    const result = await api(`/api/workspaces/${encodeURIComponent(id)}`);
    state.workspace = result.workspace;
    state.workspaceId = id;
    render();
  }

  async function loadConfig() {
    state.configLoading = true;
    render();
    const [result, workspaceResult] = await Promise.all([api("/api/config"), api("/api/workspaces?lifecycle=all"), loadConfigIntegrity(false)]);
    state.workspaces = workspaceResult.workspaces || state.workspaces;
    state.configModules = result.modules || [];
    if (!state.configModules.some((module) => module.moduleId === state.configModuleId)) state.configModuleId = state.configModules[0]?.moduleId || "core";
    await loadConfigModule(false);
  }

  async function loadConfigIntegrity(renderNow = true) {
    state.integrityLoading = true;
    if (renderNow) render();
    try { state.configIntegrity = await api("/api/config-integrity/status"); }
    catch (error) { state.configIntegrity = { error: error.message }; }
    finally {
      state.integrityLoading = false;
      if (renderNow) render();
    }
    return state.configIntegrity;
  }

  function configQuery() {
    const params = new URLSearchParams({ scope: state.configScope });
    if (state.configScope === "workspace" && state.configWorkspaceId) params.set("workspaceId", state.configWorkspaceId);
    return `?${params.toString()}`;
  }

  async function loadConfigModule(renderLoadingState = true) {
    if (state.configScope === "workspace" && !state.configWorkspaceId) {
      state.configView = null;
      state.configLoading = false;
      render();
      return;
    }
    state.configLoading = true;
    if (renderLoadingState) render();
    state.configView = await api(`/api/config/${encodeURIComponent(state.configModuleId)}${configQuery()}`);
    state.configInitial = Object.fromEntries((state.configView.fields || []).map((field) => [field.path, field.effectiveValue]));
    state.providersDraft = null;
    state.providersDirty = false;
    state.configLoading = false;
    render();
  }

  function setPath(object, dottedPath, value) {
    const parts = dottedPath.split(".");
    let current = object;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) current[part] = value;
      else {
        if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
        current = current[part];
      }
    });
  }

  function collectConfigValues() {
    const values = {};
    document.querySelectorAll("[data-config-path]").forEach((control) => {
      const type = control.dataset.fieldType;
      let value;
      if (type === "boolean") value = control.checked;
      else if (type === "integer") {
        if (control.value === "") return;
        value = Number(control.value);
      } else if (type === "string-array") value = control.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      else if (type === "object-list") {
        try { value = JSON.parse(control.value || "{}"); } catch (_error) { throw new Error(`${control.dataset.configPath} 不是有效 JSON`); }
      } else value = control.value;
      if (stableJson(value) === stableJson(state.configInitial[control.dataset.configPath])) return;
      setPath(values, control.dataset.configPath, value);
    });
    if (state.configModuleId === "review" && state.providersDirty) values.providers = collectProviders();
    return values;
  }

  function collectProviders() {
    return [...document.querySelectorAll("[data-provider-index]")].map((row) => {
      const value = {};
      row.querySelectorAll("[data-provider-field]").forEach((control) => {
        const key = control.dataset.providerField;
        if (["apiKeyConfigured", "secretValue"].includes(key)) return;
        if (key === "apiBase" && (control.disabled || state.configView?.configShape === "legacy_flat")) return;
        value[key] = control.type === "checkbox" ? control.checked : control.value;
      });
      for (const key of ["maxTokens", "autoFallbackMaxTokens"]) {
        if (value[key] === "" || value[key] === undefined) delete value[key];
        else value[key] = Number(value[key]);
      }
      const action = row.querySelector('[data-provider-field="secretAction"]')?.value || "keep";
      const secretValue = row.querySelector('[data-provider-field="secretValue"]')?.value || "";
      value.apiKey = action === "replace" ? { action, value: secretValue } : { action };
      delete value.secretAction;
      value.models = [...row.querySelectorAll(".model-row[data-model-index]")].map((modelRow) => ({
        id: modelRow.querySelector('[data-model-field="id"]')?.value || "",
        enabled: modelRow.querySelector('[data-model-field="enabled"]')?.checked !== false
      }));
      return value;
    });
  }

  function configMutationBody(values) {
    return {
      values,
      scope: state.configScope,
      ...(state.configScope === "workspace" ? { workspaceId: state.configWorkspaceId } : {})
    };
  }

  function showConfigMigrationPreview(result, values) {
    const preview = result.migrationPreview || {};
    state.pendingConfirmation = {
      type: "config-migration",
      token: result.confirmationToken,
      moduleId: state.configModuleId,
      body: configMutationBody(values),
      preview
    };
    const checks = preview.semanticChecks || {};
    const changes = preview.changes || [];
    showDialog("确认 Review 配置迁移", `
      <div class="confirmation-grid"><div><span>配置形态</span><strong>${escapeHtml(preview.sourceShape || "unknown")} → ${escapeHtml(preview.targetShape || "unknown")}</strong></div><div><span>Provider</span><strong>${checks.providerCountPreserved ? "保持" : "变化"}</strong></div><div><span>模型</span><strong>${checks.modelCountPreserved ? "保持" : "变化"}</strong></div><div><span>凭证</span><strong>${checks.credentialConfigurationPreserved ? "保留" : "需检查"}</strong></div></div>
      <div class="confirmation-list">${changes.map((entry) => `<div><span>${escapeHtml(entry.path)}</span><small>${escapeHtml(entry.reason || entry.change)}</small></div>`).join("")}</div>
      ${checks.nonTimeoutSemanticsPreserved ? "" : `<div class="field-errors"><span>非 timeout 语义发生变化，禁止迁移。</span></div>`}
      <div class="inline-warning">${icon("shield-check", "inline-icon")}写入前创建验证备份；凭证只执行 keep，不在预览中回显。</div>`,
    [{ action: "config-migration-confirm", label: "备份并迁移", icon: "save", disabled: !result.confirmationToken || !checks.nonTimeoutSemanticsPreserved }]);
  }

  async function validateConfigForm() {
    try {
      const values = collectConfigValues();
      if (!Object.keys(values).length) return toast("没有需要校验的变更", "info");
      const result = await api(`/api/config/${encodeURIComponent(state.configModuleId)}/validate`, { method: "POST", body: configMutationBody(values) });
      if (result.migrationPreview?.confirmationRequired) return showConfigMigrationPreview(result, values);
      toast(result.valid ? "配置校验通过" : "配置需要修正", result.valid ? "success" : "error");
    } catch (error) {
      toast(error.fieldErrors?.[0] ? `${error.fieldErrors[0].path}: ${error.fieldErrors[0].message}` : error.message, "error");
    }
  }

  async function saveConfigForm() {
    let values;
    try { values = collectConfigValues(); } catch (error) { toast(error.message, "error"); return; }
    if (!Object.keys(values).length) return toast("没有需要保存的变更", "info");
    try {
      if (state.configModuleId === "review") {
        const validation = await api(`/api/config/${encodeURIComponent(state.configModuleId)}/validate`, { method: "POST", body: configMutationBody(values) });
        if (validation.migrationPreview?.confirmationRequired) return showConfigMigrationPreview(validation, values);
      }
      const result = await api(`/api/config/${encodeURIComponent(state.configModuleId)}`, { method: "PUT", body: configMutationBody(values) });
      toast("配置已保存并完成重读", "success");
      if (result.restartHandoff?.required && result.restartHandoff?.scheduled) watchServiceRestart();
      else if (result.restartHandoff?.required) toast("配置已保存；请运行 ravo-solodesk restart 应用启动方式。", "info");
      else await loadConfigModule(false);
    } catch (error) {
      toast(error.fieldErrors?.[0] ? `${error.fieldErrors[0].path}: ${error.fieldErrors[0].message}` : error.message, "error");
    }
  }

  async function applyConfigMigration() {
    const pending = state.pendingConfirmation;
    if (pending?.type !== "config-migration" || !pending.token || !pending.moduleId || !pending.body) return;
    closeDialog();
    try {
      await api(`/api/config/${encodeURIComponent(pending.moduleId)}`, {
        method: "PUT",
        body: { ...pending.body, confirmationToken: pending.token }
      });
      toast("Review 配置已备份、迁移并完成重读", "success");
      await loadConfigModule(false);
    } catch (error) {
      toast(error.fieldErrors?.[0] ? `${error.fieldErrors[0].path}: ${error.fieldErrors[0].message}` : error.message, "error");
    }
  }

  function snapshotProviderDraft() {
    try {
      const current = providerSource(state.configView);
      state.providersDraft = collectProviders().map((provider, index) => ({
        ...normalizeProviderDraft({ ...provider, apiKey: { configured: current[index]?.apiKeyConfigured === true } }),
        secretAction: provider.apiKey?.action || "keep",
        secretValue: provider.apiKey?.value || ""
      }));
    } catch (_error) { state.providersDraft = providerSource(state.configView); }
  }

  async function restoreConfigBackup(backupId) {
    try {
      await api(`/api/config/${encodeURIComponent(state.configModuleId)}/restore`, {
        method: "POST",
        body: { backupId, scope: state.configScope, ...(state.configScope === "workspace" ? { workspaceId: state.configWorkspaceId } : {}) }
      });
      toast("配置已恢复", "success");
      await loadConfigModule(false);
    } catch (error) { toast(error.message, "error"); }
  }

  function integritySelections() {
    return {
      snapshotId: document.querySelector('[data-role="integrity-snapshot"]')?.value || "",
      selectedExternalSections: [...document.querySelectorAll('[data-role="integrity-external"]:checked')].map((input) => input.value),
      reenablePlugins: [...document.querySelectorAll('[data-role="integrity-reenable"]:checked')].map((input) => input.value)
    };
  }

  async function createIntegritySnapshot() {
    state.integrityLoading = true;
    render();
    try {
      const result = await api("/api/config-integrity/snapshot", { method: "POST", body: {} });
      toast(`已保存 ${result.snapshot?.trustLevel === "runtime_verified" ? "Runtime 已验证" : "待 Runtime 验证"}快照`, "success");
      await loadConfigIntegrity(false);
    } catch (error) { toast(error.message, "error"); }
    finally { state.integrityLoading = false; render(); }
  }

  async function previewIntegrityRepair() {
    state.integrityLoading = true;
    render();
    try {
      const result = await api("/api/config-integrity/preview", { method: "POST", body: integritySelections() });
      const plan = result.plan;
      state.pendingConfirmation = { type: "integrity-apply", token: result.confirmationToken, plan };
      const changes = [...(plan.managedChanges || []), ...(plan.externalPreservedChanges || [])];
      showDialog("确认 Codex 配置修复", `
        <div class="confirmation-grid"><div><span>计划</span><strong>${escapeHtml(truncate(plan.planId, 24))}</strong></div><div><span>快照可信度</span><strong>${escapeHtml(statusLabel(plan.snapshotTrust))}</strong></div><div><span>受保护 Section</span><strong>${escapeHtml(plan.protectedSectionCount)}</strong></div><div><span>变更</span><strong>${escapeHtml(changes.length)}</strong></div></div>
        ${changes.length ? `<div class="confirmation-list">${changes.map((entry) => `<div><span>${escapeHtml(entry.section)}</span><small>${escapeHtml(integrityReason(entry.reason))}</small></div>`).join("")}</div>` : `<div class="inline-empty">当前无需写入配置。</div>`}
        ${(plan.conflicts || []).length ? `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}${escapeHtml(plan.conflicts.map((entry) => `${entry.section}：保留当前值`).join("；"))}</div>` : ""}
        ${(plan.approvalRequired || []).length ? `<div class="field-errors">${plan.approvalRequired.map((entry) => `<span>${escapeHtml(entry.section)} · ${escapeHtml(integrityReason(entry.reason))}</span>`).join("")}</div>` : ""}
        ${(plan.unresolvedRequired || []).length ? `<div class="field-errors">${plan.unresolvedRequired.map((entry) => `<span>${escapeHtml(entry.section)} · ${escapeHtml(integrityReason(entry.reason))}</span>`).join("")}</div>` : ""}`,
      result.confirmationToken ? [{ action: "integrity-apply-confirm", label: "备份并修复", icon: "shield-check" }] : []);
    } catch (error) { toast(error.message, "error"); }
    finally { state.integrityLoading = false; render(); }
  }

  async function applyIntegrityRepair() {
    const pending = state.pendingConfirmation;
    if (pending?.type !== "integrity-apply" || !pending.token || !pending.plan) return;
    closeDialog();
    state.integrityLoading = true;
    render();
    try {
      const result = await api("/api/config-integrity/apply", { method: "POST", body: { planId: pending.plan.planId, confirmationToken: pending.token } });
      toast(result.status === "succeeded" ? "配置修复完成，仍需 fresh Task 验证" : "配置已部分修复，请处理剩余批准或阻塞", result.status === "succeeded" ? "success" : "info");
      await loadConfigIntegrity(false);
      await loadOverview();
    } catch (error) { toast(error.message, "error"); }
    finally { state.integrityLoading = false; render(); }
  }

  function confirmIntegrityRecovery(repairId) {
    state.pendingConfirmation = { type: "integrity-recover", repairId };
    showDialog("恢复修复前配置", `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}将恢复 repair ${escapeHtml(repairId)} 的已验证修复前备份；当前配置会先另存。</div>`, [{ action: "integrity-recover-confirm", label: "恢复备份", icon: "rotate-ccw" }]);
  }

  async function recoverIntegrityRepair() {
    const pending = state.pendingConfirmation;
    if (pending?.type !== "integrity-recover" || !pending.repairId) return;
    closeDialog();
    try {
      const result = await api("/api/config-integrity/recover", { method: "POST", body: { repairId: pending.repairId } });
      toast(result.status === "recovered" ? "已恢复修复前配置" : "恢复未完成", result.status === "recovered" ? "success" : "error");
      await loadConfigIntegrity(false);
      render();
    } catch (error) { toast(error.message, "error"); }
  }

  async function loadReview(renderNow = true) {
    if (renderNow) render();
    state.reviewConfig = await api("/api/config/review?scope=user");
    render();
  }

  function reviewFormValue() {
    const form = document.querySelector('[data-role="review-form"]');
    if (!form) throw new Error("Review 表单不可用");
    const pairs = [...form.querySelectorAll('input[name="pairs"]:checked')].map((input) => input.value);
    return {
      workspaceId: form.elements.workspaceId.value,
      domain: form.elements.domain.value || "general",
      dataBoundary: form.elements.dataBoundary.value,
      rounds: Number(form.elements.rounds.value || 2),
      confirmSensitive: form.elements.confirmSensitive.checked,
      subject: form.elements.subject.value,
      providerModelKeys: pairs
    };
  }

  async function previewReview(mode) {
    let form;
    try { form = reviewFormValue(); } catch (error) { toast(error.message, "error"); return; }
    if (!form.providerModelKeys.length) return toast("至少选择一个 Provider/Model", "error");
    if (mode === "run" && !form.subject.trim()) return toast("请输入评审对象", "error");
    const body = mode === "test"
      ? { workspaceId: form.workspaceId, mode: "test", providerModelKey: form.providerModelKeys[0] }
      : { ...form, mode: "run", subjectRef: `solodesk-${Date.now()}` };
    try {
      const result = await api("/api/review/preview", { method: "POST", body });
      const plan = result.preview?.callPlan || {};
      state.pendingConfirmation = { type: mode === "test" ? "review-test" : "review-run", token: result.confirmationToken, body, preview: result.preview };
      const endpoints = plan.endpointStatus || [];
      showDialog(mode === "test" ? "Provider 连通性测试" : "确认 Review 调用", `
        <div class="confirmation-grid"><div><span>数据边界</span><strong>${escapeHtml(plan.dataBoundary?.decision || "unknown")}</strong></div><div><span>Provider / Model</span><strong>${escapeHtml(plan.modelCount || form.providerModelKeys.length)}</strong></div><div><span>轮次</span><strong>${escapeHtml(plan.rounds || 1)}</strong></div><div><span>最大请求数</span><strong>${escapeHtml(mode === "test" ? plan.maxAttempts || 1 : plan.maximumRequests || 0)}</strong></div></div>
        <div class="confirmation-list">${(plan.requestedPairs || form.providerModelKeys).map((pair) => `<div><span>${escapeHtml(pair)}</span>${chip(endpoints.find((item) => item.providerModelKey === pair)?.credentialStatus === "missing" ? "missing" : "healthy", endpoints.find((item) => item.providerModelKey === pair)?.credentialStatus || "configured")}</div>`).join("")}</div>
        ${!result.confirmationToken ? `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}当前数据边界或配置不允许外部调用。</div>` : ""}`,
      [{ action: mode === "test" ? "review-test-confirm" : "review-run-confirm", label: mode === "test" ? "开始测试" : "发起 Review", icon: mode === "test" ? "flask-conical" : "play", disabled: !result.confirmationToken }]);
    } catch (error) { toast(error.message, "error"); }
  }

  async function confirmReview(mode) {
    const pending = state.pendingConfirmation;
    if (!pending?.token) return;
    closeDialog();
    try {
      if (mode === "test") {
        const result = await api("/api/review/test", { method: "POST", body: { confirmationToken: pending.token } });
        toast(result.status === "pass" ? `${result.providerModelKey} 连通性通过` : `${result.providerModelKey} 测试失败`, result.status === "pass" ? "success" : "error");
      } else {
        state.reviewRun = await api("/api/review/run", { method: "POST", body: { confirmationToken: pending.token } });
        render();
        startReviewPolling(state.reviewRun.reviewRunId);
      }
    } catch (error) { toast(error.message, "error"); }
  }

  function startReviewPolling(runId) {
    if (state.reviewPolling) clearInterval(state.reviewPolling);
    state.reviewPolling = setInterval(async () => {
      try {
        state.reviewRun = await api(`/api/review/runs/${encodeURIComponent(runId)}`);
        render();
        if (["completed", "failed"].includes(state.reviewRun.status)) {
          clearInterval(state.reviewPolling);
          state.reviewPolling = null;
          toast(state.reviewRun.status === "completed" ? "Review 已完成" : "Review 运行失败", state.reviewRun.status === "completed" ? "success" : "error");
        }
      } catch (error) {
        clearInterval(state.reviewPolling);
        state.reviewPolling = null;
        toast(error.message, "error");
      }
    }, 1000);
  }

  async function loadUpdates(renderNow = true) {
    if (renderNow) render();
    state.updateView = await api("/api/updates");
    render();
  }

  async function checkUpdates() {
    state.updateLoading = true;
    render();
    try {
      const result = await api("/api/updates/check", { method: "POST", body: {} });
      state.pendingConfirmation = { type: "update-apply", token: result.confirmationToken, plan: result.plan };
      const plan = result.plan;
      showDialog("确认 RAVO 升级", plan ? `
        <div class="confirmation-grid"><div><span>目标版本</span><strong>${escapeHtml(plan.targetVersion)}</strong></div><div><span>必需插件</span><strong>${escapeHtml(plan.requiredPlugins.length)}</strong></div><div><span>新 Session</span><strong>需要</strong></div><div><span>配置备份</span><strong>升级前执行</strong></div></div>
        <div class="confirmation-list">${plan.pluginActions.map((item) => `<div><span>${escapeHtml(item.pluginId)}</span><small>${escapeHtml(item.fromVersion)} → ${escapeHtml(item.toVersion)}</small></div>`).join("")}</div>` : `<div class="inline-warning">当前无法生成升级计划。</div>`,
      [{ action: "update-apply-confirm", label: "备份并升级", icon: "download", disabled: !result.confirmationToken || !plan }]);
    } catch (error) { toast(error.message, "error"); }
    finally { state.updateLoading = false; render(); }
  }

  async function applyUpdate() {
    const pending = state.pendingConfirmation;
    if (!pending?.token || !pending.plan) return;
    closeDialog();
    state.updateLoading = true;
    render();
    try {
      const result = await api("/api/updates/apply", { method: "POST", body: { confirmationToken: pending.token, planId: pending.plan.planId } });
      toast(`升级结果：${statusLabel(result.status)}`, result.status === "succeeded" ? "success" : "error");
      if (result.restartHandoff?.required && result.restartHandoff?.scheduled) watchServiceRestart();
      else if (result.restartHandoff?.required) toast("升级已写入；请运行 ravo-solodesk restart 切换到当前插件。", "info");
      else await loadUpdates(false);
    } catch (error) { toast(error.message, "error"); }
    finally { state.updateLoading = false; render(); }
  }

  function watchServiceRestart() {
    toast("SoloDesk 正在切换到当前插件版本", "info");
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const health = await api("/api/health");
        if (health.instanceId && health.instanceId !== state.health?.instanceId) {
          clearInterval(timer);
          window.location.reload();
        }
      } catch (_error) {
        if (attempts >= 20) {
          clearInterval(timer);
          state.error = "SoloDesk 服务地址可能已变化，请重新运行 ravo-solodesk open。";
          render();
        }
      }
    }, 500);
  }

  async function recoverUpdate(journalId) {
    try {
      const result = await api("/api/updates/recover-config", { method: "POST", body: { journalId } });
      toast(`配置恢复：${statusLabel(result.status)}`, result.status === "recovered" ? "success" : "error");
      await loadUpdates(false);
    } catch (error) { toast(error.message, "error"); }
  }

  async function runShortcut(workspaceId, kind) {
    try {
      const result = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/shortcuts/${encodeURIComponent(kind)}`);
      showDialog(SHORTCUTS.find((item) => item[0] === kind)?.[2] || "Prompt", `${result.blocked ? `<div class="inline-warning">${icon("triangle-alert", "inline-icon")}当前指令被 Spec、生命周期或数据状态门禁阻断，请先处理预览中的建议动作。</div>` : ""}<pre class="prompt-preview">${escapeHtml(result.prompt || "")}</pre>${result.dataGaps?.length ? `<div class="gap-list">${result.dataGaps.map((gap) => chip("unknown", gap)).join("")}</div>` : ""}`, [{ action: "shortcut-copy", label: "复制 Prompt", icon: "copy" }]);
      state.pendingConfirmation = { type: "shortcut", prompt: result.prompt || "" };
    } catch (error) { toast(error.message, "error"); }
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  const applySearch = debounce(async (value) => {
    state.search = value;
    try { await loadOverview(); render(); } catch (error) { toast(error.message, "error"); }
  }, 250);

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "navigate") return navigate(button.dataset.view);
    if (action === "toggle-sidebar") { state.sidebarOpen = !state.sidebarOpen; return render(); }
    if (action === "refresh") return refreshAll("manual");
    if (action === "open-workspace") return loadWorkspace(button.dataset.workspaceId);
    if (action === "pool-refresh") return loadPool(state.poolKind);
    if (action === "pool-create") return openPoolCreate(button.dataset.poolKind || state.poolKind);
    if (action === "pool-open") return openPoolRecord(button.dataset.poolKind || state.poolKind, button.dataset.recordId);
    if (action === "pool-create-confirm") return createPoolRecord();
    if (action === "pool-save-confirm") return savePoolRecord();
    if (action === "pool-merge-confirm") {
      try {
        const values = poolFormValues();
        if (!values.mergeTargetId) return toast("请先填写合并目标 ID", "error");
        return mergePoolRecord(values.mergeTargetId, values.expectedRevision);
      } catch (error) { return toast(error.message, "error"); }
    }
    if (action === "detail-tab") { state.detailTab = button.dataset.tab; return render(); }
    if (action === "copy") return copyText(button.dataset.copy || "");
    if (action === "dialog-close") return closeDialog();
    if (action === "shortcut") return runShortcut(button.dataset.workspaceId, button.dataset.kind);
    if (action === "shortcut-copy") { const prompt = state.pendingConfirmation?.prompt || ""; closeDialog(); return copyText(prompt, "Prompt 已复制"); }
    if (action === "config-module") {
      state.configModuleId = button.dataset.module;
      state.configScope = "user";
      state.configWorkspaceId = "";
      if (button.dataset.navigateConfig) state.view = "config";
      render();
      return state.configModules.length ? loadConfigModule(false) : loadConfig();
    }
    if (action === "config-validate") return validateConfigForm();
    if (action === "config-save") return saveConfigForm();
    if (action === "config-migration-confirm") return applyConfigMigration();
    if (action === "config-restore") return restoreConfigBackup(button.dataset.backupId);
    if (action === "integrity-refresh") return loadConfigIntegrity();
    if (action === "integrity-snapshot") return createIntegritySnapshot();
    if (action === "integrity-preview") return previewIntegrityRepair();
    if (action === "integrity-apply-confirm") return applyIntegrityRepair();
    if (action === "integrity-recover") return confirmIntegrityRecovery(button.dataset.repairId);
    if (action === "integrity-recover-confirm") return recoverIntegrityRepair();
    if (action === "provider-migrate") { state.providersDraft = providerSource(state.configView); state.providersDirty = true; return render(); }
    if (action === "provider-add") { snapshotProviderDraft(); state.providersDraft.push(normalizeProviderDraft({ id: `provider-${state.providersDraft.length + 1}`, label: "New Provider", enabled: true, models: [] })); state.providersDirty = true; return render(); }
    if (action === "provider-remove") { snapshotProviderDraft(); state.providersDraft.splice(Number(button.dataset.index), 1); state.providersDirty = true; return render(); }
    if (action === "model-add") { snapshotProviderDraft(); state.providersDraft[Number(button.dataset.index)].models.push({ id: "model", enabled: true }); state.providersDirty = true; return render(); }
    if (action === "model-remove") { snapshotProviderDraft(); state.providersDraft[Number(button.dataset.index)].models.splice(Number(button.dataset.modelIndex), 1); state.providersDirty = true; return render(); }
    if (action === "review-test") return previewReview("test");
    if (action === "review-preview") return previewReview("run");
    if (action === "review-test-confirm") return confirmReview("test");
    if (action === "review-run-confirm") return confirmReview("run");
    if (action === "update-check") return checkUpdates();
    if (action === "update-apply-confirm") return applyUpdate();
    if (action === "update-recover") return recoverUpdate(button.dataset.journalId);
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches('[data-role="workspace-search"]')) applySearch(event.target.value);
    if (event.target.matches('[data-role="pool-search"]')) {
      state.poolQuery = event.target.value;
      clearTimeout(state.poolSearchTimer);
      state.poolSearchTimer = setTimeout(() => loadPool(state.poolKind, false).then(render).catch((error) => toast(error.message, "error")), 250);
    }
    if (event.target.closest("[data-provider-index]")) state.providersDirty = true;
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches('[data-role="lifecycle-filter"]')) { state.lifecycle = event.target.value; await loadOverview(); render(); }
    if (event.target.matches('[data-role="priority-filter"]')) { state.priority = event.target.value; await loadOverview(); render(); }
    if (event.target.matches('[data-role="pool-workspace"]')) { state.poolWorkspaceId = event.target.value; await loadPool(state.poolKind); }
    if (event.target.matches('[data-role="pool-status"]')) { state.poolStatus = event.target.value; await loadPool(state.poolKind); }
    if (event.target.matches('[data-role="pool-priority"]')) { state.poolPriority = event.target.value; await loadPool(state.poolKind); }
    if (event.target.matches('[data-role="pool-item-type"]')) { state.poolItemType = event.target.value; await loadPool(state.poolKind); }
    if (event.target.matches('[data-role="config-scope"]')) {
      state.configScope = event.target.value;
      if (state.configScope === "workspace" && !state.configWorkspaceId) state.configWorkspaceId = state.workspaces[0]?.workspaceId || "";
      await loadConfigModule();
    }
    if (event.target.matches('[data-role="config-workspace"]')) { state.configWorkspaceId = event.target.value; await loadConfigModule(); }
    if (event.target.closest("[data-provider-index]")) state.providersDirty = true;
  });

  async function boot() {
    try {
      state.health = await api("/api/health");
      state.csrfToken = state.health.csrfToken;
      await loadOverview();
      state.loading = false;
    } catch (error) {
      state.loading = false;
      state.error = error.message;
    }
    render();
  }

  boot();
})();
