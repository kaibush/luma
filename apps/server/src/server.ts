import Fastify from 'fastify';
import { registerShares } from './shares.js';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { Store, type Principal } from './store.js';
import { cookieValue, registerAdmin } from './admin.js';
import { authSchema, deviceStatsSchema, hostMetadataSchema, signalSchema, qualitySchema, type Host, type Session, type IceServer, type ServerMessage } from '@remote/protocol';

export interface Config { controlToken: string; hostToken: string; origins: string[]; turnUrl?: string; turnSecret?: string; stunUrl?: string; logger?: boolean; dataPath?: string; secureCookies?: boolean }
type HostEntry = { info: Host; ws: WebSocket };
type SessionEntry = { info: Session; controller?: WebSocket; started: boolean; owner: Principal };


export async function createApp(config: Config) {
  const app = Fastify({ logger: config.logger ?? true, bodyLimit: 16384 });
  const store = new Store(config.dataPath || ':memory:', config);
  await app.register(cors, { origin: config.origins, methods: ['GET', 'POST', 'PUT', 'DELETE'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const hosts = new Map<string, HostEntry>(), sessions = new Map<string, SessionEntry>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const principals = new Map<WebSocket, Principal>();
  const send = (ws: WebSocket | undefined, data: ServerMessage) => { if (ws?.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 256 * 1024) ws.close(1013, 'Slow connection'); else ws.send(JSON.stringify(data)); } };
  const iceServers = (sessionId: string): IceServer[] => {
    const connection = store.credentials();
    const result: IceServer[] = connection.stunUrl ? [{ urls: connection.stunUrl }] : [];
    if (connection.turnUrl && connection.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 5 * 3600}:${sessionId}`;
      result.push({ urls: connection.turnUrl, username, credential: createHmac('sha1', connection.turnSecret).update(username).digest('base64') });
      // A bare TURN URI defaults to UDP. Offer TCP too for cellular / Wi-Fi
      // networks that filter UDP. Preserve explicitly configured transports.
      if (connection.turnUrl.startsWith('turn:') && !connection.turnUrl.includes('?')) {
        result.push({ ...result[result.length - 1], urls: `${connection.turnUrl}?transport=tcp` });
      }
    }
    return result;
  };
  const end = (id: string, reason: string) => {
    const s = sessions.get(id); if (!s) return;
    sessions.delete(id);
    const host = hosts.get(s.info.hostId);
    if (host) { host.info.busy = false; send(host.ws, { type: 'ended', reason, sessionId: id }); }
    send(s.controller, { type: 'ended', reason });
    s.controller?.close(1000, reason);
  };
  const hostList = (): Host[] => store.hosts().map(record => {
    const live = hosts.get(record.id);
    if (!live || live.ws.readyState !== WebSocket.OPEN || record.accessToken?.status !== 'active') return record;
    return { ...record, ...live.info, ...store.hostMetadata(record.id), name: record.name, reportedName: record.reportedName, accessToken: record.accessToken, online: true };
  });
  registerAdmin(app, store, config, principal => {
    for (const [id, session] of sessions) if (principal ? session.owner.kind === principal.kind && session.owner.id === principal.id : session.owner.kind === 'session') end(id, '授权已撤销');
    for (const [id, host] of hosts) {
      const auth = principals.get(host.ws);
      if (principal && auth?.kind === principal.kind && auth.id === principal.id) offlineHost(id, host.ws);
    }
    for (const [ws, auth] of principals) if (principal ? auth.kind === principal.kind && auth.id === principal.id : auth.kind === 'session') ws.close(1008, 'Authorization revoked');
  }, () => [...sessions.values()].map(s => ({ ...s.info, hostName: store.hostName(s.info.hostId, hosts.get(s.info.hostId)?.info.name || '离线主机'), connected: !!s.controller })), hostList);
  const shares = registerShares(app, store, config.origins, iceServers, hosts);
  const offlineHost = (id: string, ws: WebSocket) => {
    const host = hosts.get(id);
    // A delayed close from an old socket must not remove its replacement.
    if (!host || host.ws !== ws) return;
    store.observeHost(host.info, true);
    hosts.delete(id);
    shares.offline(id);
    for (const [sessionId, session] of sessions) if (session.info.hostId === id) end(sessionId, '主机已离线');
  };
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/hosts', async () => ({ hosts: hostList() }));
  app.put<{ Params: { id: string } }>('/api/hosts/:id', async (req, reply) => {
    const parsed = hostMetadataSchema.safeParse(req.body), host = hostList().find(host => host.id === req.params.id);
    if (!parsed.success) return reply.code(400).send({ error: '分组或备注无效' });
    if (!host) return reply.code(404).send({ error: '主机不存在' });
    const meta = { ...store.hostMetadata(host.id), ...parsed.data };
    store.saveHostMetadata(host.id, meta);
    const live = hosts.get(host.id); if (live) Object.assign(live.info, meta);
    return { host: { ...host, ...meta } };
  });
  app.post<{ Body: { hostId?: string; quality?: string; mode?: string; audio?: boolean } }>('/api/sessions', async (req, reply) => {
    const quality = qualitySchema.safeParse(req.body?.quality ?? store.settings().defaultQuality);
    if (!quality.success || typeof req.body?.hostId !== 'string') return reply.code(400).send({ error: '会话参数无效' });
    const host = hosts.get(req.body.hostId);
    if (!host || host.ws.readyState !== WebSocket.OPEN || !store.valid(principals.get(host.ws)!)) return reply.code(404).send({ error: '主机已离线，请检查客户端连接及主机密钥状态' });
    if (host.info.busy) return reply.code(409).send({ error: '主机正在使用中' });
    const mode = req.body.mode ?? 'desktop';
    if (!['desktop', 'tools'].includes(mode) || (req.body.audio !== undefined && typeof req.body.audio !== 'boolean')) return reply.code(400).send({ error: '会话模式无效' });
    if (mode === 'tools' && req.principal?.scope !== 'admin') return reply.code(403).send({ error: '终端和文件需要管理员登录' });
    if (mode === 'tools' && !host.info.capabilities.terminal && !host.info.capabilities.files) return reply.code(400).send({ error: '请先在客户端启用终端或文件访问' });
    const info: Session = { id: randomUUID(), hostId: host.info.id, quality: quality.data, expiresAt: Date.now() + 30_000, mode: mode as 'desktop' | 'tools', tools: req.principal?.scope === 'admin', audio: !!req.body.audio && !!host.info.capabilities.audio };
    host.info.busy = true;
    sessions.set(info.id, { info, started: false, owner: req.principal! });
    const metadata = { ...store.hostMetadata(host.info.id), lastConnectedAt: Date.now() };
    store.saveHostMetadata(host.info.id, metadata); Object.assign(host.info, metadata);
    store.audit(req.principal!.name, 'session.start', `${store.hostName(host.info.id, host.info.name)} (${mode})`);
    return reply.code(201).send({ session: info, iceServers: iceServers(info.id) });
  });
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => { const s = sessions.get(req.params.id); if (s && (s.owner.id !== req.principal?.id || s.owner.kind !== req.principal?.kind)) return reply.code(403).send({ error: '非当前会话所有者' }); end(req.params.id, '会话已结束'); return reply.code(204).send(); });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url === '/share-ws') return;
    if (req.url !== '/ws' || (req.headers.origin && !config.origins.includes(req.headers.origin)) || wss.clients.size >= 100) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, request) => {
    let role: 'host' | 'controller' | undefined, hostId: string | undefined, sessionId: string | undefined;
    let alive = true, count = 0, windowStart = Date.now(), lastPersistedAt = Date.now();
    const timeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
    ws.on('pong', () => {
      alive = true;
      const host = hostId && hosts.get(hostId);
      if (host && host.ws === ws) {
        host.info.lastSeenAt = Date.now();
        if (Date.now() - lastPersistedAt >= 60000) { store.observeHost(host.info); lastPersistedAt = Date.now(); }
      }
    });
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15_000);
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
      if (++count > 100) { ws.close(1008, 'Rate limit'); return; }
      let data: unknown; try { data = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!role) {
        const parsed = authSchema.safeParse(data);
        if (!parsed.success) { ws.close(1008, 'Unauthorized'); return; }
        const auth = parsed.data;
        const principal = store.token(auth.token, auth.role === 'host' ? 'host' : 'control') || (auth.role === 'controller' && request.headers.origin && config.origins.includes(request.headers.origin) ? store.session(cookieValue(request.headers.cookie)) : null);
        if (!principal) { ws.close(1008, 'Unauthorized'); return; }
        principals.set(ws, principal);
        clearTimeout(timeout);
        if (auth.role === 'host') {
          if (auth.resumeHostId) {
            const archived = store.hosts().find(host => host.id === auth.resumeHostId);
            if (auth.kind !== 'browser' || archived?.kind !== 'browser' || archived.accessToken?.id !== principal.id) {
              ws.close(1008, 'Host unavailable'); return;
            }
          }
          role = 'host'; hostId = auth.deviceId ? createHash('sha256').update(`${principal.id}:${auth.deviceId}`).digest('hex') : randomUUID();
          if (auth.resumeHostId) hostId = auth.resumeHostId;
          const previous = hosts.get(hostId);
          if (previous && previous.ws.readyState !== WebSocket.OPEN) offlineHost(hostId, previous.ws);
          if (hosts.has(hostId)) { ws.close(1008, 'Device already connected'); hostId = undefined; return; }
          const info: Host = { id: hostId, name: auth.name, online: true, busy: false, kind: auth.kind, lastSeenAt: Date.now(), ...store.hostMetadata(hostId), capabilities: { video: true, systemInput: auth.kind !== 'browser', ...auth.kind !== 'browser' ? auth.features : {}, textInput: auth.kind === 'browser' ? 'test' : auth.features?.clipboard || auth.kind === 'windows' ? 'unicode' : 'ascii', maxFps: auth.kind !== 'browser' ? 60 : undefined } };
          store.registerHost(info, principal.id);
          hosts.set(hostId, { ws, info });
          send(ws, { type: 'ready', hostId, protocol: 2 });
        } else {
          const s = sessions.get(auth.sessionId), host = s && hosts.get(s.info.hostId);
          if (!s || s.owner.id !== principal.id || s.owner.kind !== principal.kind || !host || s.controller || s.info.expiresAt <= Date.now()) { ws.close(1008, 'Session unavailable'); return; }
          role = 'controller'; sessionId = auth.sessionId; s.controller = ws;
          s.info.expiresAt = Date.now() + store.settings().sessionMinutes * 60_000;
          send(host.ws, { type: 'session', session: s.info, iceServers: iceServers(sessionId) });
          // Host prepares its peer before acknowledging ready; controller offers afterward.
        }
        return;
      }
      if (!store.valid(principals.get(ws)!)) { ws.close(1008, 'Authorization expired'); return; }
      if (role === 'host' && data && typeof data === 'object' && 'type' in data && data.type === 'stats') {
        const stats = deviceStatsSchema.safeParse('stats' in data ? data.stats : null);
        const host = hosts.get(hostId!);
        if (stats.success && host) { host.info.lastSeenAt = Date.now(); host.info.stats = { ...stats.data, sampledAt: Date.now() }; }
        return;
      }
      if (role === 'host' && shares.fromHost(hostId!, data)) return;
      const parsed = signalSchema.safeParse(data);
      // A host acknowledges setup using ready, outside SDP/ICE signals.
      if (role === 'host' && typeof data === 'object' && data !== null && 'type' in data && data.type === 'ready') {
        const s = [...sessions.values()].find(s => s.info.hostId === hostId);
        if (s?.controller && !s.started && 'sessionId' in data && data.sessionId === s.info.id) { s.started = true; send(s.controller, { type: 'ready' }); }
        return;
      }
      if (!parsed.success) { ws.close(1008, 'Invalid signal'); return; }
      const s = role === 'host' ? [...sessions.values()].find(s => s.info.hostId === hostId) : sessions.get(sessionId!);
      if (!s) return;
      const signal = parsed.data;
      if (signal.sessionId !== s.info.id) return;
      if (signal.type === 'end') { end(s.info.id, '对端结束了会话'); return; }
      if (!s.started || (signal.type === 'offer' && role !== 'controller') || (signal.type === 'answer' && role !== 'host')) { ws.close(1008, 'Invalid signal direction'); return; }
      send(role === 'host' ? s.controller : hosts.get(s.info.hostId)?.ws, signal);
    });
    ws.on('close', () => {
      principals.delete(ws);
      clearTimeout(timeout); clearInterval(heartbeat);
      if (hostId) offlineHost(hostId, ws);
      if (sessionId) end(sessionId, '控制端已断开');
    });
  });
  const reap = setInterval(() => { for (const [id, host] of hosts) if (!store.valid(principals.get(host.ws)!)) offlineHost(id, host.ws); for (const [ws, principal] of principals) if (!store.valid(principal)) ws.close(1008, 'Authorization expired'); for (const [id, s] of sessions) if (s.info.expiresAt <= Date.now()) end(id, '会话已过期'); }, 5000);
  app.addHook('preClose', async () => { clearInterval(reap); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  app.addHook('onClose', async () => { store.close(); });
  return app;
}
