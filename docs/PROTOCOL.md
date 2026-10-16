# 协议 v0（开发版）

主机 auth 可带 `kind: "linux-x11"`，默认 `browser`。服务按 kind 返回 systemInput、textInput（ascii/test）和 maxFps 能力；系统主机当前使用共享 HOST_TOKEN，仅适合单管理员部署。

运行时 schema 和类型以 `packages/protocol/src/index.ts` 为准。协议当前没有版本协商；原生 Agent 实现之前应固定 v1 版本及 capability 握手。

## HTTP

除 `/health` 外所有 API 使用 `Authorization: Bearer CONTROL_TOKEN`。

| 请求 | 结果 |
| --- | --- |
| `GET /api/hosts` | `{ hosts: [{ id, name, busy, kind, capabilities }] }` |
| `POST /api/sessions` body `{ hostId, quality }` | 201 `{ session: { id, hostId, quality, expiresAt }, iceServers }` |
| `DELETE /api/sessions/:id` | 204，幂等结束 |

quality: `responsive` / `balanced` / `sharp`，默认 responsive。主机离线返回 404，占用返回 409，非法参数 400，鉴权失败 401。预约 30 秒内必须绑定控制端；活动会话最多 4 小时，回收扫描间隔 5 秒。

## WebSocket `/ws`

1. 5 秒内首帧 `{"type":"auth","role":"host","token":"HOST_TOKEN","name":"设备名称"}`，获得 `{"type":"ready","hostId":"UUID"}`。
2. 控制端通过 HTTP 预约后首帧 `{"type":"auth","role":"controller","token":"CONTROL_TOKEN","sessionId":"UUID"}`。
3. 服务向主机发送 `{ type: 'session', session, iceServers }`。主机初始化 RTCPeerConnection 后回 `{type:'ready',sessionId}`。
4. 服务通知控制端 `{type:'ready'}`；控制端创建 recvonly video、`input` 与 `motion` channels，发 offer。
5. SDP 消息 `{type:'offer'|'answer',sessionId,sdp}`；ICE 消息 `{type:'ice',sessionId,candidate}`。收到 remoteDescription 之前暂存 ICE，之后排队应用。服务拒绝错误角色的 offer/answer，丢弃旧 sessionId 的信令。
6. `{type:'end',sessionId}` 或 HTTP DELETE 结束会话。服务通知双方 `{type:'ended',reason}` 并关闭控制端 WebSocket；主机保持在线。

每连接消息上限 100/s，64KiB 最大帧，SDP 上限 48KB。服务器每 15s ping，未收到 pong 则在下次检查终止。WSS 只承载控制信令，不承载视频与高频输入。

## WebRTC 输入

`input` 通道 ordered/reliable，`motion` 通道 unordered/maxRetransmits=0。所有消息为 JSON，坐标是可见视频画面中的 [0,1] 归一值。按钮携带自身坐标，不能依赖另一通道的最后一次 move 顺序。

```json
{"type":"move","x":0.5,"y":0.5}
{"type":"button","button":"left","down":true,"x":0.5,"y":0.5}
{"type":"button","button":"left","down":false,"x":0.5,"y":0.5}
{"type":"wheel","dx":0,"dy":120}
{"type":"key","code":"KeyA","down":true}
{"type":"key","code":"KeyA","down":false}
{"type":"text","text":"中文输入"}
{"type":"release-all"}
```

`KeyboardEvent.code` 表示物理键位；原生端负责平台扫描码和布局映射。text 表示文本提交（最多 2048 字符），不等同于剪贴板授权。浏览器保留 Esc 以退出全屏，工具栏可发送远端 Esc。

浏览器共享端只验证/展示输入；原生 InputSink 必须额外执行允许键位映射、速率限制、会话租约检查和断线 releaseAll，不能执行任意字符串为 shell 命令。
