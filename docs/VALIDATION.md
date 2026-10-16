# 验证记录

2026-10-16，Linux / Node.js 24 / Playwright Chromium，无物理桌面采集和真实手机。

- `npm run typecheck`：所有工作区通过；后续前端生产构建也重新通过 TypeScript 检查。
- `npm test`：4 项通过。覆盖控制/主机密钥隔离、参数校验、独占会话、短期 TURN 凭据、信令转发与旧 sessionId 丢弃、断线清理、画面黑边坐标和输入边界。
- `npm run build -w @remote/server`：通过；编译产物实际启动，健康检查返回 200，未认证 API 返回 401。
- `npm run build -w @remote/web`：通过。
- `node scripts/smoke.mjs`：通过。两个 Chromium 页面之间真实建立 WebRTC，接收到合成 Canvas 视频和可靠文本输入；844×390 横屏无水平溢出；会话结束后重连成功；停止共享后主机下线；390×844 主机列表空状态正常；无浏览器运行时错误。

边界：合成视频仅验证端到端协议、浏览器解码和界面生命周期，不代表原生采集/硬件编码性能。未验证 Windows/Linux/macOS 系统输入、真实手机触控、Safari、跨公网 TURN、后台恢复、实际操作到显示延迟或稳定 60 FPS。对应验收方法见 ARCHITECTURE.md。

## rc.lvyrix.com 部署验证

- `npm run build` 与 `npm test` 再次通过。
- systemd 服务 `remote-console-api` 已启用并运行，生产 API 监听回环端口 8798。
- Caddy 完整配置校验通过，域名证书已成功签发；HTTP 自动重定向 HTTPS。
- 公网 `/`、`/host`、`/health` 返回 200；未认证 `/api/hosts` 返回 401；`/.env`、`/.git/config` 返回 404；哈希资源返回 200 并使用 immutable 缓存。
- `SMOKE_BASE_URL=https://rc.lvyrix.com npm run test:e2e` 通过：公网 HTTPS/WSS 入口上的双浏览器视频、可靠输入、重连、主机退出与手机尺寸布局均通过，无浏览器运行时错误。
- 前端构建产物和暂存文件扫描未包含生产控制/主机密钥；生产环境文件权限 0600，位于 Git 仓库外。

公网测试的两个浏览器仍运行在同一测试机器上，因此仅证明域名与代理链路可用，不代表异地 NAT 穿透或真实移动网络性能验收。
