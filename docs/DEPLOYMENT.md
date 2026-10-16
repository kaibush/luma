# 部署

前后端独立进程/产物。推荐由同一 HTTPS 域名代理两者，避免把密钥与 WebSocket 鉴权设计复杂化；这不影响前后端分离。生产不要直接暴露 Vite 开发服务器。

## 构建与运行

```sh
npm ci
npm run setup
npm run build
npm start
```

API 默认只监听 `127.0.0.1:8787`。在反向代理可访问的机器上运行，使用进程管理器维持运行。前端静态文件为 `apps/web/dist`。项目根 `.env` 必须随运行目录保留，或通过环境变量注入密钥；不复制进静态目录。

Caddy 配置参考 `deploy/Caddyfile.example`，替换域名和静态文件绝对路径。域名解析、HTTPS 证书、手机信任与防火墙由部署环境提供。

```env
ALLOWED_ORIGINS=https://remote.example.com
STUN_URL=stun:turn.example.com:3478
TURN_URL=turn:turn.example.com:3478
TURN_SECRET=与coturn共享的随机密钥
```

更新 `.env` 后重启 API。若修改 `API_PORT`，生产反向代理的端口也必须同步调整；Vite 开发代理自动读取项目根 `.env` 的 `API_PORT`。仅设置 TURN_URL 而没有 TURN_SECRET 不会产生 TURN 凭据。默认不使用外部公共 STUN，以免隐式依赖第三方服务。没有 STUN/TURN 时仅适合能交换可达主机候选的本地/VPN 网络，具体还受浏览器 mDNS 候选实现影响。

## TURN

使用 coturn `use-auth-secret` 模式，`static-auth-secret` 与 API 的 TURN_SECRET 一致。不要使用长期用户名密码写入前端。

```conf
# 示例，替换域名、公网IP、密钥后使用
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=REPLACE_WITH_RANDOM_SECRET
realm=turn.example.com
# 云主机一对一NAT时配置 external-ip=公网IP/内网IP
min-port=49160
max-port=49200
no-cli
no-multicast-peers
no-loopback-peers
```

开放 3478 UDP/TCP 和所选 relay UDP 端口范围，按需求限制可访问的 peer 网络和总带宽。不同 coturn 版本选项有差异，启动时检查日志。受限网络可另配 `turns:turn.example.com:443?transport=tcp`，需要独立 IP 或适当的入口分流和受信 TLS 证书。当前 `TURN_URL` 配置单个 URL；多区域/多协议列表可扩展 IceServer 配置。

服务端生成 HMAC-SHA1 REST 凭据，寿命 5 小时，单次会话上限 4 小时；后续长会话应增加授权后的凭据刷新与 ICE restart。TURN 是加密媒体的转发者，不在 API 中转码。

## 运行边界

- 控制密钥是单管理员原型凭据，持有者可以创建/结束所有会话。生产多用户先实现资源授权，不要把前端模板的演示登录当成认证。
- 主机注册接受浏览器测试端和 Linux X11 系统主机端，均使用主机密钥。多设备生产扩展仍需设备级令牌/证书与资源授权。
- API 使用进程内状态，只运行单实例；直接多副本负载均衡会导致找不到会话。扩容方式见架构文档。
- WSS 首帧传认证令牌，不放查询串。WebSocket Origin 只接受配置的浏览器来源；无 Origin 连接仍必须令牌认证，给将来的原生端留接入路径。
- 服务重启、关闭页面/共享、网络断开将清理会话。当前手动重连；尚未实现断网无感恢复。
- 生产需进程管理、可用性监控与日志保留策略。HTTP 日志不记录请求正文/认证头，后续审计也不能记录输入正文或屏幕内容。

## 本机生产部署：rc.lvyrix.com

沿用同服务器 codex-omni / grok-ops 的部署方式：

- 域名入口：`https://rc.lvyrix.com`，Caddy 自动管理 TLS。
- 静态目录：`/var/www/remote-console`，仅复制 `apps/web/dist`。
- API：`remote-console-api.service`，运行编译产物，监听 `127.0.0.1:8798`。
- Caddy 站点：`/etc/caddy/conf.d/remote-console.caddy`。
- 生产配置：`/etc/remote-console/environment`，root 所有、0600 权限，包含 `CONTROL_TOKEN`、`HOST_TOKEN`、`API_HOST=127.0.0.1`、`API_PORT=8798`、`ALLOWED_ORIGINS=https://rc.lvyrix.com`。可按需追加 TURN 配置。首次部署沿用本地初始化的随机密钥，此文件不会提交 Git。
- 本地开发保持独立配置，生产不会依赖 Vite 或交互终端。

首次创建生产配置后，执行 `sudo bash deploy/publish.sh`。脚本构建前后端、发布静态文件、重启 systemd、检查健康状态、校验完整 Caddy 配置后平滑重载。Caddy 片段依赖现有 `/etc/caddy/Caddyfile` 的 `access_log` 定义。systemd 中的工作目录和 Node 路径按此服务器固定，迁移服务器时需调整。

```sh
systemctl status remote-console-api --no-pager
journalctl -u remote-console-api -n 50 --no-pager
curl -fsS https://rc.lvyrix.com/health
```

前端不会显示密钥。由管理员在服务器本地读取 `/etc/remote-console/environment` 中对应密钥，分别填入工作空间和 `/host` 页。公网 HTTPS 解决页面和信令入口；不同网络之间的桌面视频仍可能需要 TURN，域名上线不代表 NAT 穿透已在真机验证。

验证公网 WebRTC：服务已发布后运行 `SMOKE_BASE_URL=https://rc.lvyrix.com npm run test:e2e`。该脚本默认使用根目录 `.env` 的密钥，适用于首次部署沿用同一组密钥的配置；轮换生产密钥后应同步测试凭据，避免在命令行参数中暴露令牌。


## Linux 本机桌面主机端

已部署 `remote-console-agent.service`，通过 `DISPLAY=:10`、`XAUTHORITY=/root/.Xauthority` 接入已有 XFCE 会话；不启动另一个桌面，不改动 Guacamole/RDP 配置。X11 socket 不可隔离到 PrivateTmp。`agent-environment` 仅含主机令牌、显示会话和本地信令 URL，不包含控制令牌。

依赖：Python 3.12 + venv、当前 X11 会话、XTest、coturn。安装/恢复脚本：`bash deploy/install-agent.sh`；依赖锁在 `apps/agent/requirements.lock`。该脚本按本服务器固定 IP/目录部署，迁移时修改 TURN 公网地址、relay-ip、Node/项目路径及桌面认证路径。`deploy/publish.sh` 发布更新后的 API/前端；修改 Python 主机端后单独重启 agent。

配置文件（均不提交 Git）：

- `/etc/remote-console/agent-environment`：HOST_TOKEN、DISPLAY、XAUTHORITY、SIGNAL_URL、HOST_NAME。
- `/etc/remote-console/turnserver.conf`：TURN HMAC 密钥、relay 地址与配额；systemd LoadCredential 向专用 turnserver 用户提供此文件。
- `/etc/remote-console/environment`：API 已配置 `TURN_URL=turn:207.58.173.239:3478`、STUN 和同一 TURN_SECRET。

TURN 使用真实服务器 IP（不走 Cloudflare 代理），监听 3478 UDP/TCP，relay 范围 49200–49300 UDP。禁止向私网和回环网络中继。媒体内容仍由 WebRTC 加密；当前默认使用 UDP；若网络仅允许 TCP，可将 API 的 TURN_URL 改为 `turn:207.58.173.239:3478?transport=tcp` 并重启 API。当前未自动切换 TCP，也未提供 TURN/TLS 443。

```sh
systemctl status remote-console-agent remote-console-turn --no-pager
journalctl -u remote-console-agent -n 30 --no-pager
npm run test:native
```

`test:native` 创建一个短暂的 X11 测试窗口，通过域名用 Chromium 强制 TURN 连接实际桌面，校验视频像素和系统输入，再关闭窗口并恢复之前焦点。会产生一次真实控制会话，请在主机空闲时运行。当前桌面宽高比例可能不是 16:9，流畅档按宽度缩放，测试时实际视频为 1280×608。

主机端断线会自动退避重连；系统桌面注销后应重新登录桌面，必要时修改 DISPLAY。无 GPU 硬编的 4 核服务器不保证持续 30 FPS；与 Guacamole 同时使用会共享同一个桌面焦点和输入状态。
