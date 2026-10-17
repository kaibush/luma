# Remote Console

基于 **satnaing/shadcn-admin** 二次开发的前后端分离远控基础项目。面向手机横屏，采用 WebRTC 视频 + DataChannel 输入，不走 VNC/RFB 或 Guacamole 图片更新链路。

**现在可以访问服务器上的真实 Linux 桌面。** 已部署 X11 主机端，直接采集现有 XFCE `:10` 桌面，通过 WebRTC 提供画面与系统鼠标、键盘控制；无需先打开浏览器共享页。当前服务器无可用硬件编码，主机端使用软件编码，支持 360p / 540p / 720p 最高 60 FPS、1080p 最高 30 或 60 FPS（实际受截图、编码与网络限制）。英文/数字文本输入已支持，Linux 启用客户端剪贴板权限后可通过粘贴提交中文。

流畅度优先时，在连接前选择「优先流畅 540p」或「极速流畅 360p」，重新连接生效。所有档位由 `packages/protocol/src/quality-profiles.json` 统一定义；采集和编码并行，只保留最新一帧。Linux Agent 的 H.264 编码时间基准设为 1/60，避免 60 FPS 时相邻帧时间戳合并。

采集回归测试：`apps/agent/.venv/bin/python -m unittest discover -s apps/agent -p 'test_*.py'`。本机 WebRTC 接收帧率诊断：`DISPLAY=:10 XAUTHORITY=/root/.Xauthority apps/agent/.venv/bin/python apps/agent/benchmark.py`（读取现有桌面、不发送输入；不代表手机网络下的帧率）。

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

单管理员原型：持有控制密钥可访问全部主机；已实现管理员登录、SQLite 配置与操作记录、分用途 Token 撤销；尚无多账号隔离、设备证书或分布式会话存储。服务重启会清空在线列表/会话；新版客户端和桌面控制端支持退避重连。默认不配置第三方 STUN。Linux X11 系统主机端已接入；macOS/Wayland、多屏切换、Intel/AMD 专用硬编、双指缩放和真机延迟验收属于后续工作。请按 [架构中的阶段划分](docs/ARCHITECTURE.md) 扩展。

## 手机操作与键盘

远控底栏保留「触控模式 / 键盘 / 右键 / 更多」。Esc、释放按键、滚动和连接统计在「更多」中。键盘包含常用组合、完整按键、文字输入；支持 Ctrl/Alt/Shift/Win 多选后发送一个组合，随后自动释放。复制粘贴使用远程电脑剪贴板。横屏时键盘位于桌面右侧，竖屏时位于底部，可滚动查看更多按键。Linux 中文粘贴需要在客户端启用剪贴板权限，目标应用需支持 Ctrl+V。

页面全屏不可用时自动使用「沉浸」隐藏页面工具栏，可点「显示工具」恢复；不会把系统全屏限制误报为连接错误。iPhone 浏览器地址栏无法由网页强制隐藏。如需独立窗口，在 Safari 打开本站，通过分享菜单添加到主屏幕（如有「作为 Web App 打开」选项，请开启）。站点提供 standalone manifest 和主屏幕图标；仍需在线连接。

## 安装到其他电脑

在 [接入此电脑](https://rc.lvyrix.com/host) 下载客户端。Linux X11 客户端提供当前用户安装脚本、配置窗口和登录桌面后自启动；Windows 10/11 x64 提供预览版安装器和普通桌面输入适配，尚需 Windows 真机验收。两者均填写主机 Token 后主动接入现有控制台，无需在被控电脑部署 API/TURN。详见 [客户端安装与卸载](docs/CLIENTS.md)。

运行 `npm run package:agent` 生成不含密钥的下载包，然后执行构建发布；`deploy/publish.sh` 已包含打包步骤。

客户端压缩包由脚本生成，不纳入 Git。本地默认输出目录是 `apps/web/public/downloads/`：

- `remote-console-linux.tar.gz`：Linux 安装包。
- `remote-console-windows.zip`：Windows 预览版安装包。
- `SHA256SUMS.txt`：压缩包校验值。
- `client-guide.md`：安装、停止与卸载说明。

生成方式（在项目根目录运行，需要 Python 3）：

```sh
npm run package:agent
```

打包脚本 `scripts/package-agent.py` 按明确的文件清单收集 `apps/agent/` 中的客户端源码、安装器和依赖版本，加入画质配置与安装文档，再生成 TAR.GZ / ZIP 和 SHA-256 校验值。这是源码加自动安装器的压缩包，不是编译后的独立可执行文件；不包含主机密钥、用户配置、虚拟环境或服务器数据库。

只提交客户端源码、打包脚本和 workflow，安装包通过下方 GitHub Actions 自动生成。本地发布前运行打包命令，网页构建会把下载目录复制到 `apps/web/dist/downloads/`，发布时再同步至服务器的 `/var/www/remote-console/downloads/`。

### GitHub 自动打包与发布

已配置 `.github/workflows/package-agent.yml`（Actions 中名称为 **Build desktop clients**）：

- 修改客户端源码、安装文档或打包脚本后，推送到 `main` 或提交 PR，会自动生成并校验两个安装包。
- 也可以在 GitHub 的 **Actions → Build desktop clients → Run workflow** 手动运行。
- 成功后在该次运行的 **Artifacts** 下载 `desktop-clients-<commit SHA>`，其中包含 Linux / Windows 包、校验值和安装说明；保留 30 天。
- 推送 `client-v*` 标签会将同一批构建产物发布到 GitHub Releases。例如：

  ```sh
  git tag client-v0.1.0
  git push origin client-v0.1.0
  ```

由于 Windows 仍为预览版，自动创建的 Release 标为 **Pre-release**。标签发布不需要额外设置密钥，使用 GitHub 自带的 `GITHUB_TOKEN`。同一标签重新运行时会更新对应的安装包附件。

CI 使用 `python scripts/package-agent.py --output-dir <临时目录>` 从当前提交重新生成压缩包，不依赖仓库里已有的压缩包，也不会自动提交生成文件或部署控制台。生成的下载目录已加入 `.gitignore`；本地发布仍使用 `npm run package:agent` 更新网页下载目录。


## 设备工作区

主机卡片的「状态 / 终端 / 文件」入口提供实时设备状态、服务端分组与备注、xterm.js 终端和分块文件传输。工具会话仅允许管理员账号使用，且受被控端权限开关控制；不启动视频采集。桌面「更多」提供双向文本剪贴板和系统声音播放开关。

新版 Agent 支持低开销软件编码、NVIDIA H.264 硬编探测与自动回退、自适应画质，以及基于稳定设备身份的桌面断线恢复。新能力默认在被控端关闭；启用方式、文件大小限制、平台验证范围见 [客户端说明](docs/CLIENTS.md#设备工具与性能02)。

## 远程主机分享

手机或电脑管理员可在主机卡片点击「分享远程主机」，设置自定义/随机分享码、有效期和仅观看/允许控制权限。访客打开链接输入分享码即可连接，无需登录。后台可编辑、停止或删除分享，立即撤销访客访问；无需手机采集屏幕或保持后台页面打开。仍保留当前电脑浏览器选屏分享。详见 [分享说明](docs/SHARING.md)。
