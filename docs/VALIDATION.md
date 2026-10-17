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

## 实际 Linux 桌面接入

- `apps/agent` 已接入现有 XFCE `:10`，直接 X11 采集与 XTest 输入，不使用 VNC/Guacamole 画面链路。
- Python 模块编译检查、API TypeScript 检查、后端构建、4 项后端/协议测试、前端生产构建通过。
- `node scripts/native-smoke.mjs` 通过域名强制使用 TURN；浏览器实际解码到 X11 测试窗口的颜色像素，分辨率 1280×608；测试窗口收到系统鼠标按钮、物理按键和 ASCII 文本；关闭控制页面后 Ctrl 按键已释放。
- 测试创建独立临时窗口，结束后销毁窗口并恢复之前的焦点与鼠标位置。
- API、Linux Agent 和 TURN 均设置为 systemd 常驻、开机自启。当前机器无硬件编码，主机端软件编码最高 30 FPS；尚未完成真实手机蜂窝网络、跨地区延迟及中文文本输入验收。

## 初始化与管理（2026-10-16）

- 后端 6 项测试通过：初始化仅一次、部署密钥校验、CSRF、管理员与 Token 权限分离、重启后设置/登录/撤销状态保留、密码不明文存储、Cookie WS 登录与注销断连、主机 Token 撤销断连。
- 独立内存数据库上运行 `scripts/auth-smoke.mjs`：390×844 手机视口完成四步向导、密码确认校验、连接设置保存与重载、Token 一次显示及撤销、修改密码后重新登录、刷新保持登录、退出。无浏览器运行错误，无页面横向溢出。
- 生产管理员账号留给部署所有者通过向导创建；测试账号仅存在于独立测试进程内存中。
- 新账号 Cookie 登录下，浏览器 WebRTC 回归通过：视频、可靠文本输入、横屏适配、断开重连、主机下线清理。生产构建在独立内存数据库启动并完成初始化验证通过。
- 部署后 https://rc.lvyrix.com/health 和 /api/auth/me 返回 200，手机浏览器自动进入 /setup；保留未初始化状态。原有控制 Token 可查询到「本机 Linux 桌面」在线，API/Agent/TURN/Caddy 服务均正常；SQLite 文件权限 0600，状态目录 0700。
- 独立测试 API + 真实本机 X11 Agent + 新管理员 Cookie 登录，强制经生产 TURN 中继，验证 1280×608 桌面画面像素、系统鼠标/键盘/ASCII 文本输入和断连释放修饰键全部通过；未创建或修改线上管理员账号。

## 触控板模式（2026-10-17）

浏览器组件回归覆盖：滑动只移动不按住左键；异地轻点仍点击当前光标位置；连续两次轻点输出两组左键按下/释放；长按松手、取消和多指不误点击；边缘坐标限制；切回直接触控后保留按下拖动行为。使用 `npm run test -w @remote/web -- src/features/remote/viewer.test.tsx`。

已检查 844×390 横屏与 390×844 竖屏：无横向溢出，工具栏在视口内。测试使用模拟 WebRTC 输入端检查真实浏览器 PointerEvent 处理，不代表已完成手机真机网络延迟验收。

## 手机界面与扩展键盘（2026-10-17）

Chromium 浏览器 4 项测试通过：触控模式回归；全屏能力缺失/权限拒绝自动使用沉浸模式；横屏锁定失败不误报全屏失败；快捷组合与自定义修饰键的按下/释放顺序、F5、文字校验、收起键盘及释放按键。检查 844×390、390×844 和 390×380 布局，横屏键盘采用侧边布局。生产构建通过。测试模拟浏览器权限限制，不等同于 iOS 26 真机验收。

同一组 4 项测试也已在 WebKit 中通过（`TEST_BROWSER=webkit npm run test -w @remote/web -- src/features/remote/viewer.test.tsx src/features/remote/display-mode.test.ts`）。发布后确认域名返回新键盘/沉浸模式资源、standalone manifest、主屏幕图标，API 健康检查通过。WebKit 自动化仍不能替代 iOS 26 真机的浏览器栏行为验收。
