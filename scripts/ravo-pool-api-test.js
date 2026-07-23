#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createSoloDesk } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");
const pool = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-pool");

function request(port, method, pathname, csrf, body) {
  const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(csrf ? { "X-RAVO-CSRF-Token": csrf } : {}),
        ...(bytes ? { "Content-Type": "application/json", "Content-Length": bytes.length } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, value: text ? JSON.parse(text) : {} });
      });
    });
    req.on("error", reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}

async function main() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-api-home-")));
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-api-workspace-")));
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  const workspaceId = "pool_workspace_01";
  const data = {
    discoverWorkspaces: () => [{ workspaceId, canonicalPath: workspace, path: workspace, name: "Pool Fixture", displayName: "Pool Fixture", lifecycle: "active", priority: "normal", ravoPresent: true, dataStatus: "complete" }],
    buildDashboardIndex: () => ({
      workspaces: [{ workspaceId, canonicalPath: workspace, path: workspace, name: "Pool Fixture", displayName: "Pool Fixture", lifecycle: "active", priority: "normal", ravoPresent: true, dataStatus: "complete", artifacts: [], timeline: [], sessions: [], warnings: [], lanes: {}, attentionItems: [], suggestions: [], blockers: [], pendingCodexVerification: [], pendingPmVerification: [], states: {}, summary: {} }],
      attention: [],
      metrics: {},
      sessions: [],
      sessionDataStatus: "available",
      warnings: [],
      generatedAt: new Date().toISOString()
    })
  };
  const coreStatus = { buildStatus: () => ({ runtimeHealth: "healthy", status: "ok", warnings: [], recoverySteps: [] }) };
  const { state, server } = createSoloDesk({ home, cwd: workspace, workspaceRoots: [workspace], data, coreStatus, refreshSeconds: 3600 });
  await state.refresh("pool_test_startup");
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  state.port = server.address().port;
  const csrf = state.csrfToken;
  try {
    const missingCsrf = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements`, "", { title: "拒绝", itemType: "feature" });
    assert.equal(missingCsrf.status, 403);

    const created = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements`, csrf, {
      title: "API 需求",
      itemType: "feature",
      summary: "从 SoloDesk 创建",
      description: "详细描述不应出现在主表摘要中",
      sourceRefs: ["task:pool-api"],
      captureMode: "explicit",
      confirmationStatus: "confirmed"
    });
    assert.equal(created.status, 201);
    const id = created.value.record.id;
    const list = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements`, "");
    assert.equal(list.status, 200);
    assert.equal(list.value.total, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(list.value.entries[0], "description"), false);

    const rejectedRecord = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements`, csrf, {
      title: "API 已拒绝需求",
      itemType: "feature",
      sourceRefs: ["task:pool-api-rejected"],
      captureMode: "explicit",
      confirmationStatus: "confirmed",
      decisionStatus: "rejected",
      decisionReason: "当前不采纳",
      decisionOwner: "pm",
      decisionAt: new Date().toISOString()
    });
    assert.equal(rejectedRecord.status, 201);
    const defaultFiltered = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements`, "");
    assert.equal(defaultFiltered.value.total, 1);
    const explicitRejected = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements?status=rejected`, "");
    assert.equal(explicitRejected.value.total, 1);
    const agentAll = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements?view=agent`, "");
    assert.equal(agentAll.value.total, 2);
    const featureOnly = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements?itemType=feature`, "");
    assert.equal(featureOnly.value.total, 1);

    const detail = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements/${id}`, "");
    assert.equal(detail.status, 200);
    assert.equal(Object.hasOwn(detail.value.record, "description"), false);
    const agentDetail = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements/${id}?view=agent`, "");
    assert.equal(agentDetail.value.record.description, "详细描述不应出现在主表摘要中");
    const updated = await request(state.port, "PUT", `/api/workspaces/${workspaceId}/pool/requirements/${id}`, csrf, { expectedRevision: detail.value.record.revision, priority: "P1", deliveryStatus: "in_progress" });
    assert.equal(updated.status, 200);
    const conflict = await request(state.port, "PUT", `/api/workspaces/${workspaceId}/pool/requirements/${id}`, csrf, { expectedRevision: detail.value.record.revision, priority: "P0" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.value.error.code, "work_item_revision_conflict");

    const knowledge = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/knowledge`, csrf, {
      kind: "lesson",
      title: "API 知识",
      summary: "知识候选",
      content: "只保留可复用内容",
      applicability: ["API 测试"],
      sourceRefs: ["task:pool-api"],
      status: "candidate"
    });
    assert.equal(knowledge.status, 201);
    const active = await request(state.port, "PUT", `/api/workspaces/${workspaceId}/pool/knowledge/${knowledge.value.record.id}`, csrf, {
      expectedRevision: knowledge.value.record.revision,
      status: "active",
      source: "task:pool-api",
      confirmationStatus: "confirmed",
      confirmedBy: "pm"
    });
    assert.equal(active.status, 200);
    const knowledgeList = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/knowledge?status=active`, "");
    assert.equal(knowledgeList.value.total, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(knowledgeList.value.entries[0], "content"), false);
    const rejectedKnowledge = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/knowledge`, csrf, {
      kind: "lesson",
      title: "API 已拒绝知识",
      summary: "默认隐藏",
      content: "仅供历史查询",
      applicability: ["API 测试"],
      sourceRefs: ["task:pool-api-knowledge-rejected"],
      status: "rejected"
    });
    assert.equal(rejectedKnowledge.status, 201);
    const knowledgeDefault = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/knowledge`, "");
    assert.equal(knowledgeDefault.value.total, 1);
    const knowledgeRejected = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/knowledge?status=rejected`, "");
    assert.equal(knowledgeRejected.value.total, 1);

    const scenarioRecord = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements`, csrf, {
      title: "API 下一版本锁定需求",
      itemType: "feature",
      summary: "通过只读场景投影",
      userValue: "让 PM 直接看到候选",
      sourceRefs: ["task:pool-api-scenario"],
      captureMode: "explicit",
      confirmationStatus: "confirmed",
      decisionStatus: "approved",
      committedVersion: "v0.7.0",
      releaseSlice: "ravo-v0.7.0-api-fixture",
      nextAction: "Codex 执行已锁定范围",
      nextActionOwner: "codex"
    });
    assert.equal(scenarioRecord.status, 201);
    const scenarioApi = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/scenarios/next_version_candidates?version=v0.7.0`, "");
    assert.equal(scenarioApi.status, 200);
    const scenarioModule = pool.nextVersionCandidates(workspace, { version: "v0.7.0" });
    assert.deepEqual(scenarioApi.value.summary, scenarioModule.summary);
    assert.equal(scenarioApi.value.sections[0].items[0].title, "API 下一版本锁定需求");
    assert.equal(Object.hasOwn(scenarioApi.value.sections[0].items[0], "id"), false);

    const second = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements`, csrf, { title: "重复 API 需求", itemType: "bug", sourceRefs: ["task:pool-api-2"] });
    const merged = await request(state.port, "POST", `/api/workspaces/${workspaceId}/pool/requirements/merge`, csrf, { sourceId: second.value.record.id, targetId: id });
    assert.equal(merged.status, 200);
    const history = await request(state.port, "GET", `/api/workspaces/${workspaceId}/pool/requirements/${second.value.record.id}/history`, "");
    assert.ok(history.value.history.some((event) => event.type === "updated"));
    console.log(JSON.stringify({ status: "pass", checks: ["CSRF", "summary/detail boundary", "CRUD", "revision conflict", "PM default and explicit filters", "knowledge lifecycle", "scenario API and module parity", "merge and history"] }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
