import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { authSchema, signalSchema, qualitySchema, type Host, type Session, type IceServer, type ServerMessage } from '@remote/protocol';

export interface Config { controlToken: string; hostToken: string; origins: string[]; turnUrl?: string; turnSecret?: string; stunUrl?: string; logger?: boolean }
type HostEntry = { info: Host; ws: WebSocket };
type SessionEntry = { info: Session; controller?: WebSocket; started: boolean };
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

export async function createApp(config: Config) {
  const app = Fastify({ logger: config.logger ?? true, bodyLimit: 8192 });
  await app.register(cors, { origin: config.origins, methods: ['GET', 'POST', 'DELETE'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const hosts = new Map<string, HostEntry>(), sessions = new Map<string, SessionEntry>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const send = (ws: WebSocket | undefined, data: ServerMessage) => { if (ws?.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 256 * 1024) ws.close(1013, 'Slow connection'); else ws.send(JSON.stringify(data)); } };
  const iceServers = (sessionId: string): IceServer[] => {
    const result: IceServer[] = config.stunUrl ? [{ urls: config.stunUrl }] : [];
    if (config.turnUrl && config.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 5 * 3600}:${sessionId}`;
      result.push({ urls: config.turnUrl, username, credential: createHmac('sha1', config.turnSecret).update(username).digest('base64') });
    }
    return result;
  };
  const end = (id: string, reason: string) => {
    const s = sessions.get(id); if (!s) return;
    sessions.delete(id);
    const host = hosts.get(s.info.hostId);
    if (host) { host.info.busy = false; send(host.ws, { type: 'ended', reason }); }
    send(s.controller, { type: 'ended', reason });
    s.controller?.close(1000, reason);
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!equal(req.headers.authorization?.replace(/^Bearer /, '') || '', config.controlToken)) return reply.code(401).send({ error: '控制端密钥无效' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/hosts', async () => ({ hosts: [...hosts.values()].map(h => h.info) }));
  app.post<{ Body: { hostId?: string; quality?: string } }>('/api/sessions', async (req, reply) => {
    const quality = qualitySchema.safeParse(req.body?.quality ?? 'responsive');
    if (!quality.success || typeof req.body?.hostId !== 'string') return reply.code(400).send({ error: '会话参数无效' });
    const host = hosts.get(req.body.hostId);
    if (!host) return reply.code(404).send({ error: '主机已离线' });
    if (host.info.busy) return reply.code(409).send({ error: '主机正在使用中' });
    const info: Session = { id: randomUUID(), hostId: host.info.id, quality: quality.data, expiresAt: Date.now() + 30_000 };
    host.info.busy = true;
    sessions.set(info.id, { info, started: false });
    return reply.code(201).send({ session: info, iceServers: iceServers(info.id) });
  });
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => { end(req.params.id, '会话已结束'); return reply.code(204).send(); });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || (req.headers.origin && !config.origins.includes(req.headers.origin)) || wss.clients.size >= 100) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let role: 'host' | 'controller' | undefined, hostId: string | undefined, sessionId: string | undefined;
    let alive = true, count = 0, windowStart = Date.now();
    const timeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15_000);
    ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
      if (++count > 100) { ws.close(1008, 'Rate limit'); return; }
      let data: unknown; try { data = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!role) {
        const parsed = authSchema.safeParse(data);
        if (!parsed.success || !equal(parsed.data.token, parsed.data.role === 'host' ? config.hostToken : config.controlToken)) { ws.close(1008, 'Unauthorized'); return; }
        clearTimeout(timeout);
        const auth = parsed.data;
        if (auth.role === 'host') {
          role = 'host'; hostId = randomUUID();
          hosts.set(hostId, { ws, info: { id: hostId, name: auth.name, busy: false, kind: 'browser', capabilities: { video: true, systemInput: false } } });
          send(ws, { type: 'ready', hostId });
        } else {
          const s = sessions.get(auth.sessionId), host = s && hosts.get(s.info.hostId);
          if (!s || !host || s.controller || s.info.expiresAt <= Date.now()) { ws.close(1008, 'Session unavailable'); return; }
          role = 'controller'; sessionId = auth.sessionId; s.controller = ws;
          s.info.expiresAt = Date.now() + 4 * 3600_000;
          send(host.ws, { type: 'session', session: s.info, iceServers: iceServers(sessionId) });
          // Host prepares its peer before acknowledging ready; controller offers afterward.
        }
        return;
      }
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
      clearTimeout(timeout); clearInterval(heartbeat);
      if (hostId) { const s = [...sessions.values()].find(s => s.info.hostId === hostId); hosts.delete(hostId); if (s) end(s.info.id, '主机已离线'); }
      if (sessionId) end(sessionId, '控制端已断开');
    });
  });
  const reap = setInterval(() => { for (const [id, s] of sessions) if (s.info.expiresAt <= Date.now()) end(id, '会话已过期'); }, 5000);
  app.addHook('preClose', async () => { clearInterval(reap); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  return app;
}
