# Remote Console

基于 **satnaing/shadcn-admin** 二次开发的前后端分离远控基础项目。面向手机横屏，采用 WebRTC 视频 + DataChannel 输入，不走 VNC/RFB 或 Guacamole 图片更新链路。

**现在可以访问服务器上的真实 Linux 桌面。** 已部署 X11 主机端，直接采集现有 XFCE `:10` 桌面，通过 WebRTC 提供画面与系统鼠标、键盘控制；无需先打开浏览器共享页。当前服务器无可用硬件编码，主机端使用软件编码、最高 30 FPS。英文/数字文本输入已支持，中文文本提交暂不支持。

已部署入口：**https://rc.lvyrix.com**；电脑共享端：https://rc.lvyrix.com/host 。生产密钥保存在服务器 `/etc/remote-console/environment`，部署维护见 [部署说明](docs/DEPLOYMENT.md)。

## 通过域名访问本机桌面

1. 打开 https://rc.lvyrix.com ，首次使用按向导验证服务器 `CONTROL_TOKEN`，创建自己的管理员账号并确认连接参数；以后使用账号密码登录。
2. 在主机列表找到 **本机 Linux 桌面**，点击 **连接桌面**。
3. 手机横屏后可点击、拖动、右键、打开键盘发送英文文本；工具栏可全屏或结束会话。
4. 点击底部「直接触控」切换为「触控板」：按住滑动移动光标，抬手后在画面任意位置轻点执行左键单击、快速连点两次执行双击。长按松手不会点击；再次点击模式按钮恢复原来的直接触控与拖拽。

主机端和 TURN 均由 systemd 常驻。这里访问的是此服务器现有 XFCE 桌面，原有 Guacamole 仍可使用。若 XFCE 会话退出或显示编号改变，需恢复桌面并更新主机端配置。TURN 中继已做强制中继测试，但未拿真实手机蜂窝网络完成性能验收。

## 启动

需要 Node.js 24+、npm。电脑共享推荐 Chrome / Edge。安装目录同时包含前后端，但可独立构建部署。

```sh
npm install
npm run setup
npm run dev
```

1. 打开 `http://localhost:5173/host`，输入 `.env` 中的 `HOST_TOKEN`，选择共享的屏幕/窗口。
2. 另一个页面打开 `http://localhost:5173`，输入 `.env` 中的 `CONTROL_TOKEN`。
3. 点击在线主机的「连接桌面」，查看视频及实时 FPS、Mbps、RTT；在共享端的「输入协议测试」检查触控/键盘事件。
4. 结束会话后主机可再次连接；停止共享或关闭共享页后主机离线。

`npm run setup` 只在 `.env` 不存在时生成两枚独立随机密钥，不会覆盖现有配置。密钥只保存在页面内存，不写入 URL/localStorage，不编译到前端。

手机访问需要可被手机信任的 **HTTPS** 域名与证书，并将该域名加入 `ALLOWED_ORIGINS`。`http://电脑IP` 不等同于 localhost 安全上下文，不能用它验证完整浏览器远控能力。开发服务器对局域网监听，但不替代 HTTPS 生产入口。公网跨 NAT 需要配置 STUN/TURN，参考 [部署说明](docs/DEPLOYMENT.md)。

## 项目结构

```text
apps/web/                  克隆的 shadcn-admin，React / Vite / TanStack Router
  src/features/remote/     主机列表、浏览器主机端、横屏控制台、WebRTC 客户端
apps/server/               Fastify API、鉴权、WebSocket 信令、会话生命周期
packages/protocol/         输入/信令运行时校验、共享类型、画质档位、坐标映射
apps/agent/                Linux X11 实际桌面采集、软件编码、系统输入与自动重连
scripts/setup.mjs          本地密钥配置初始化
docs/                      架构、部署、协议与上游来源
```

前端保留上游模板源代码和演示路由以便二次开发；侧栏展示远控与管理设置。新增 `/setup`、`/login`、`/management` 是实际业务页面。模板内原有登录、用户、任务、设置页仍是演示代码，**不作为本项目鉴权或业务后台使用**。上游来源与固定提交见 [UPSTREAM.md](docs/UPSTREAM.md)，MIT 许可在 `apps/web/LICENSE`。

## 已实现

- 控制端/主机端独立密钥、API 鉴权、WS 首帧鉴权、Origin 白名单、速率与消息大小限制。
- 实时主机注册、单主机独占会话、断线释放、心跳、预约和会话过期回收。
- WebRTC SDP/ICE 协商、H.264 优先且保留回退、发送端码率/FPS 限制、可选短期 TURN 凭据。
- `<video playsInline>` 播放、手机安全区、独立横屏界面、全屏能力降级。
- 画面黑边坐标校正、拖动/点击/右键、文本与键盘事件、释放按键、鼠标移动 rAF 合并和背压丢弃。
- 可靠输入与无重传移动双通道，信令会话隔离。视频不经过 Fastify。
- 实测链路 FPS / Mbps / 网络 RTT / 分辨率 / 直连或 TURN 状态展示。RTT 不代表完整操作到显示延迟。

## 检查与构建

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 只启动 API（默认 `127.0.0.1:8787`）；前端产物 `apps/web/dist` 交给 Caddy/Nginx。模板自带的浏览器单测可通过 `npm run test -w @remote/web` 单独执行。新增远控端到端测试见 `scripts/smoke.mjs`（需要运行开发服务和安装 Playwright Chromium）。

## 当前边界

单管理员原型：持有控制密钥可访问全部主机；已实现管理员登录、SQLite 配置与操作记录、分用途 Token 撤销；尚无多账号隔离、设备证书或分布式会话存储。服务重启会清空在线列表/会话；客户端需手动重连。默认不配置第三方 STUN。Linux X11 系统主机端已接入；Windows/macOS/Wayland、硬件编码、音频、多屏切换、文件传输、中文文本、双指缩放和真机延迟验收属于后续工作。请按 [架构中的阶段划分](docs/ARCHITECTURE.md) 扩展。
