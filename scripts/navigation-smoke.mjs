// Isolated navigation, guide access, and management deep-link verification.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../apps/server/src/server.ts";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const controlToken = randomBytes(32).toString("hex"),
  port = 22987,
  webPort = 22988,
  base = `http://localhost:${webPort}`;
const app = await createApp({
  controlToken,
  hostToken: randomBytes(32).toString("hex"),
  origins: [base],
  logger: false,
});
let vite, browser;
try {
  await app.listen({ host: "127.0.0.1", port });
  vite = spawn(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "apps/web",
      "--config",
      "apps/web/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    { env: { ...process.env, API_PORT: String(port) }, stdio: "ignore" },
  );
  const until = Date.now() + 120000;
  while (true) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (Date.now() > until) throw new Error("Vite timeout");
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const owner = await browser.newContext({
      viewport: { width: 1100, height: 800 },
    }),
    guest = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    headers = { "X-Remote-Request": "1" };
  await owner.request.post(`${base}/api/auth/setup/unlock`, {
    headers,
    data: { key: controlToken },
  });
  assert.equal(
    (
      await owner.request.post(`${base}/api/auth/setup/complete`, {
        headers,
        data: {
          username: "testadmin",
          password: "navigation-test-password",
          settings: {
            workspaceName: "导航验证",
            defaultQuality: "balanced",
            sessionMinutes: 15,
            stunUrl: "",
            turnUrl: "",
          },
        },
      })
    ).status(),
    200,
  );
  const page = await owner.newPage(),
    publicPage = await guest.newPage(),
    errors = [];
  for (const p of [page, publicPage]) {
    p.setDefaultTimeout(45000);
    p.on("pageerror", (e) => errors.push(e.message));
  }
  await publicPage.goto(`${base}/guide/install`);
  await publicPage
    .getByRole("heading", { name: "客户端接入", exact: true })
    .waitFor();
  assert.ok(publicPage.url().endsWith("/guide/install"));
  assert.equal(
    (await guest.request.get(`${base}/api/manage/tokens`)).status(),
    401,
  );
  await publicPage
    .getByRole("button", { name: "Toggle Sidebar", exact: true })
    .click();
  const drawer = publicPage.getByRole("dialog");
  await drawer.getByRole("link", { name: "终端与文件", exact: true }).click();
  await publicPage
    .getByRole("heading", { name: "终端与文件", exact: true })
    .waitFor();
  await drawer.waitFor({ state: "hidden" });
  assert.ok(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await publicPage
    .getByRole("button", { name: "Toggle Sidebar", exact: true })
    .click();
  await publicPage.waitForTimeout(350);
  await publicPage.screenshot({
    path: "/tmp/remote-console-grouped-sidebar-mobile.png",
    fullPage: false,
  });
  await publicPage
    .getByRole("dialog")
    .getByRole("link", { name: "快速开始", exact: true })
    .click();
  await publicPage.getByLabel("搜索使用指南", { exact: true }).fill("文件");
  await publicPage.locator('main a[href="/guide/tools"]').waitFor();
  console.log(
    "PASS: public guides require no login; mobile grouped navigation closes after selection and fits viewport",
  );
  await page.goto(`${base}/management/tokens`);
  await page.getByText("已有 Token", { exact: true }).waitFor();
  await page.getByLabel("名称", { exact: true }).fill("导航测试主机");
  await page.getByRole("button", { name: "创建 Token", exact: true }).click();
  await page.getByRole("row").filter({ hasText: "导航测试主机" }).waitFor();
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await sidebar
    .getByRole("link", { name: "Token 管理", exact: true })
    .waitFor();
  assert.equal(
    await sidebar
      .getByRole("link", { name: "Token 管理", exact: true })
      .getAttribute("data-active"),
    "true",
  );
  await page.getByRole("tab", { name: "账号安全", exact: true }).click();
  await page.waitForURL(`${base}/management/account`);
  await page.reload();
  await page.getByLabel("当前密码", { exact: true }).waitFor();
  await sidebar.getByRole("link", { name: "连接设置", exact: true }).click();
  await page.waitForURL(/\/management\/?$/);
  await page.getByLabel("工作空间名称", { exact: true }).waitFor();
  await sidebar.getByRole("link", { name: "Token 管理", exact: true }).click();
  const tokenRow = page.getByRole("row").filter({ hasText: "导航测试主机" });
  await tokenRow.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "确认撤销", exact: true }).click();
  await tokenRow.getByText("已撤销", { exact: true }).waitFor();
  console.log(
    "PASS: Token creation and revocation still work after navigating between management submenus",
  );
  await page.getByRole("button", { name: "设备管理", exact: true }).click();
  await sidebar.getByRole("link", { name: "接入此电脑", exact: true }).click();
  await page.waitForURL(`${base}/connect`);
  await page.getByRole("button", { name: "下载与安装", exact: true }).waitFor();
  await page.getByRole("button", { name: "使用指南", exact: true }).click();
  await sidebar.getByRole("link", { name: "客户端接入", exact: true }).click();
  await page
    .getByRole("heading", { name: "客户端接入", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/remote-console-guide-desktop.png",
    fullPage: false,
  });
  await page.locator('[data-sidebar="trigger"]').click();
  await page.getByRole("button", { name: "系统管理", exact: true }).click();
  await page.getByRole("menuitem", { name: "Token 管理", exact: true }).click();
  await page.waitForURL(`${base}/management/tokens`);
  await page.getByText("已有 Token", { exact: true }).waitFor();
  await publicPage.goto(`${base}/management/tokens`);
  await publicPage.waitForURL(`${base}/login`);
  console.log(
    "PASS: collapsed sidebar dropdown navigates; anonymous management route still requires login",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: management submenus deep-link, tab changes update URL, refresh preserves section, connection page retains navigation",
  );
} finally {
  await browser?.close();
  vite?.kill("SIGTERM");
  await app.close();
}
