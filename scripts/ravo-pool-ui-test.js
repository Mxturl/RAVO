#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../plugins/ravo/modules/ravo-core/scripts/ravo-record-store");
const { createSoloDesk } = require("../plugins/ravo/modules/ravo-dashboard/scripts/ravo-dashboard");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function loadPlaywright() {
  const candidates = [
    process.env.RAVO_PLAYWRIGHT_NODE_PATH,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules")
  ].filter(Boolean);
  try { return require("playwright"); } catch (_error) {}
  for (const candidate of candidates) {
    try { return require(path.join(candidate, "playwright")); } catch (_error) {}
  }
  return null;
}

function chromeExecutable(playwright) {
  if (process.env.RAVO_CHROME_PATH) {
    return fs.existsSync(process.env.RAVO_CHROME_PATH) ? process.env.RAVO_CHROME_PATH : "";
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    playwright?.chromium?.executablePath?.()
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function main() {
  const playwright = loadPlaywright();
  const executablePath = chromeExecutable(playwright);
  if (!playwright || !executablePath) {
    const result = { status: "skipped", reason: !playwright ? "playwright_unavailable" : "browser_unavailable" };
    if (process.env.RAVO_UI_TEST_REQUIRED === "1") throw new Error(result.reason);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ravo-pool-ui-")));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  const workspaceId = "pool_ui_workspace_01";
  store.createWorkItem(workspace, { title: "UI 需求", itemType: "feature", summary: "桌面和移动端可扫描", sourceRefs: ["ui-test"], captureMode: "explicit", confirmationStatus: "confirmed" });
  store.createWorkItem(workspace, { title: "UI 已拒绝需求", itemType: "feature", summary: "默认隐藏但可筛选", sourceRefs: ["ui-test-rejected"], captureMode: "explicit", confirmationStatus: "confirmed", decisionStatus: "rejected", decisionReason: "当前不采纳", decisionOwner: "pm", decisionAt: new Date().toISOString() });
  store.createKnowledge(workspace, { kind: "lesson", title: "UI 知识", summary: "候选经验", content: "详情中可查看适用场景", applicability: ["SoloDesk UI"], sourceRefs: ["ui-test"], status: "candidate" });
  store.createKnowledge(workspace, { kind: "lesson", title: "UI 已拒绝知识", summary: "默认隐藏", content: "仅供历史筛选", applicability: ["SoloDesk UI"], sourceRefs: ["ui-test-rejected"], status: "rejected" });
  const data = {
    discoverWorkspaces: () => [{ workspaceId, canonicalPath: workspace, path: workspace, name: "Pool UI", displayName: "Pool UI", lifecycle: "active", priority: "normal", ravoPresent: true, dataStatus: "complete" }],
    buildDashboardIndex: () => ({ workspaces: [{ workspaceId, canonicalPath: workspace, path: workspace, name: "Pool UI", displayName: "Pool UI", lifecycle: "active", priority: "normal", ravoPresent: true, dataStatus: "complete", artifacts: [], timeline: [], sessions: [], warnings: [], lanes: {}, attentionItems: [], suggestions: [], blockers: [], pendingCodexVerification: [], pendingPmVerification: [], states: {}, summary: {} }], attention: [], metrics: {}, sessions: [], sessionDataStatus: "available", warnings: [], generatedAt: new Date().toISOString() })
  };
  const coreStatus = { buildStatus: () => ({ runtimeHealth: "healthy", status: "ok", warnings: [], recoverySteps: [] }) };
  const { state, server } = createSoloDesk({ home, cwd: workspace, workspaceRoots: [workspace], data, coreStatus, refreshSeconds: 3600 });
  await state.refresh("pool_ui_test_startup");
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  state.port = server.address().port;
  const url = `http://127.0.0.1:${state.port}/`;
  const outputDir = path.resolve(argument("--output-dir", path.join(root, "screenshots")));
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  const errors = [];
  try {
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport });
      page.on("console", (message) => { if (message.type() === "error") errors.push(`${name}:console:${message.text()}`); });
      page.on("pageerror", (error) => errors.push(`${name}:page:${error.message}`));
      await page.goto(url, { waitUntil: "networkidle" });
      if (name === "mobile") await page.locator(".mobile-menu-button").click();
      await page.locator('[data-action="navigate"][data-view="requirements"]').click();
      await page.waitForSelector('[data-role="pool-search"]');
      assert.match(await page.locator("h1").textContent(), /需求与问题/);
      const requirementHead = await page.locator(".pool-table .data-table-head").textContent();
      assert.match(requirementHead, /问题\/标题.*用户价值或影响.*优先级.*版本归属.*下一步/);
      assert.doesNotMatch(requirementHead, /类型|状态/);
      assert.equal(await page.locator('[data-role="pool-item-type"]').count(), 1);
      assert.equal(await page.locator('[data-role="pool-status"]').count(), 1);
      assert.equal(await page.locator(".pool-row").count(), 1);
      assert.doesNotMatch(await page.locator(".pool-row").first().textContent(), /ui-test|feature|candidate/);
      await page.locator('[data-role="pool-status"]').selectOption("rejected");
      await page.waitForFunction(() => document.body.textContent.includes("UI 已拒绝需求"));
      assert.equal(await page.locator(".pool-row").count(), 1);
      await page.locator('[data-role="pool-status"]').selectOption("");
      await page.waitForFunction(() => document.body.textContent.includes("UI 需求") && !document.body.textContent.includes("UI 已拒绝需求"));
      await page.locator('[data-role="pool-item-type"]').selectOption("feature");
      assert.equal(await page.locator(".pool-row").count(), 1);
      await page.locator(".pool-row").first().click();
      await page.waitForSelector('#solodesk-dialog[open] [data-role="pool-form"]');
      await page.locator('#solodesk-dialog[open] [data-pool-field="priority"]').selectOption("P1");
      await page.locator('#solodesk-dialog[open] [data-action="pool-save-confirm"]').click();
      await page.waitForTimeout(80);
      if (name === "mobile") await page.locator(".mobile-menu-button").click();
      await page.locator('[data-action="navigate"][data-view="knowledge"]').click();
      await page.waitForFunction(() => document.body.textContent.includes("UI 知识"));
      assert.match(await page.locator("h1").textContent(), /精华知识/);
      assert.match(await page.locator(".pool-row").first().textContent(), /UI 知识/);
      assert.equal(await page.locator(".pool-row").count(), 1);
      assert.doesNotMatch(await page.locator("main").textContent(), /UI 已拒绝知识/);
      const dimensions = await page.evaluate(() => ({ viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert.ok(dimensions.documentWidth <= dimensions.viewportWidth + 1, `${name} has horizontal overflow`);
      await page.screenshot({ path: path.join(outputDir, `${name}-requirements-knowledge.png`), fullPage: true });
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "pass", browser: executablePath, outputDir, checks: ["requirements table", "requirement type/status filters", "inactive records hidden by default", "knowledge table", "detail edit", "desktop/mobile", "no horizontal overflow", "no browser errors"] }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
