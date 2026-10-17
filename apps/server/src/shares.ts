import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { signalSchema, type IceServer } from '@remote/protocol';
import { Store, type Principal } from './store.js';
import { cookieValue } from './admin.js';

type ShareRow = { id: string; name: string; keyHash: string; sealed: string; enabled: number; epoch: number; createdAt: number };
type Publisher = { ws: WebSocket; principal: Principal };
type Viewer = { id: string; shareId: string; epoch: number; ws: WebSocket; expiresAt: number; ready: boolean };
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const idSchema = z.string().uuid();
const keySchema = z.string().min(16).max(128);
const authSchema = z.discriminatedUnion('role', [
  z.object({ type: z.literal('auth'), role: z.literal('publisher'), shareId: idSchema }),
  z.object({ type: z.literal('auth'), role: z.literal('viewer'), ticket: z.string().length(43) }),
]);

export function registerShares(app: FastifyInstance, store: Store, origins: string[], iceServers: (id: string) => IceServer[]) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS screen_shares (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, keyHash TEXT NOT NULL, sealed TEXT NOT NULL,
    enabled INTEGER NOT NULL, epoch INTEGER NOT NULL, createdAt INTEGER NOT NULL
  )`);
  const publishers = new Map<string, Publisher>(), viewers = new Map<string, Viewer>();
  const tickets = new Map<string, { shareId: string; epoch: number; expiresAt: number }>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const row = (id: string) => store.db.prepare('SELECT * FROM screen_shares WHERE id=?').get(id) as ShareRow | undefined;
  const send = (ws: WebSocket | undefined, value: object) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 262144) ws.close(1013, 'Connection too slow');
    else ws.send(JSON.stringify(value));
  };
  const finish = (id: string, reason: string) => {
    const viewer = viewers.get(id); if (!viewer) return;
    viewers.delete(id);
    send(viewer.ws, { type: 'ended', reason }); viewer.ws.close(1000, 'Sharing ended');
    send(publishers.get(viewer.shareId)?.ws, { type: 'ended', sessionId: id, reason });
  };
  const revoke = (id: string, reason: string, stopPublisher: boolean) => {
    for (const [ticket, grant] of tickets) if (grant.shareId === id) tickets.delete(ticket);
    for (const viewer of [...viewers.values()]) if (viewer.shareId === id) finish(viewer.id, reason);
    if (stopPublisher) {
      const publisher = publishers.get(id); publishers.delete(id);
      send(publisher?.ws, { type: 'ended', reason }); publisher?.ws.close(1000, 'Sharing stopped');
    }
  };
  const describe = (share: ShareRow) => ({ id: share.id, name: share.name, key: store.unsealShare(share.id, share.sealed), enabled: !!share.enabled,
    online: publishers.has(share.id), viewers: [...viewers.values()].filter(v => v.shareId === share.id).length, createdAt: share.createdAt });
  const rotate = (id: string, key = randomBytes(32).toString('base64url')) => {
    store.db.prepare('UPDATE screen_shares SET keyHash=?, sealed=?, epoch=epoch+1 WHERE id=?').run(hash(key), store.sealShare(id, key), id);
  };
  app.get('/api/manage/shares', async () => ({ shares: (store.db.prepare('SELECT * FROM screen_shares ORDER BY createdAt DESC').all() as ShareRow[]).map(describe) }));
  app.post('/api/manage/shares', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '请填写共享名称（1–64 字符）' });
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM screen_shares').get() as { count: number };
    if (count.count >= 50) return reply.code(409).send({ error: '最多保留 50 个共享，请先删除不用的共享' });
    const id = randomUUID(), key = randomBytes(32).toString('base64url');
    store.db.prepare('INSERT INTO screen_shares VALUES(?,?,?,?,1,1,?)').run(id, parsed.data.name, hash(key), store.sealShare(id, key), Date.now());
    store.audit(req.principal!.name, 'share.create', id);
    return reply.code(201).send({ share: describe(row(id)!) });
  });
  app.post<{ Params: { id: string } }>('/api/manage/shares/:id/rotate', async (req, reply) => {
    const share = row(req.params.id); if (!share) return reply.code(404).send({ error: '共享不存在' });
    const parsed = z.object({ key: keySchema.optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: '新密钥须为 16–128 个字符，也可以留空自动生成' });
    if (parsed.data.key && hash(parsed.data.key) === share.keyHash) return reply.code(400).send({ error: '新密钥不能与原密钥相同' });
    rotate(share.id, parsed.data.key);
    revoke(share.id, '共享密钥已更换，请向共享者索取新链接', false);
    store.audit(req.principal!.name, 'share.rotate', share.id);
    return { share: describe(row(share.id)!) };
  });
  app.post<{ Params: { id: string } }>('/api/manage/shares/:id/stop', async (req, reply) => {
    if (!row(req.params.id)) return reply.code(404).send({ error: '共享不存在' });
    store.db.prepare('UPDATE screen_shares SET enabled=0, epoch=epoch+1 WHERE id=?').run(req.params.id);
    revoke(req.params.id, '共享者已停止共享', true);
    store.audit(req.principal!.name, 'share.stop', req.params.id);
    return { share: describe(row(req.params.id)!) };
  });
  app.post<{ Params: { id: string } }>('/api/manage/shares/:id/enable', async (req, reply) => {
    const share = row(req.params.id); if (!share) return reply.code(404).send({ error: '共享不存在' });
    if (!share.enabled) {
      rotate(share.id); store.db.prepare('UPDATE screen_shares SET enabled=1 WHERE id=?').run(share.id);
      store.audit(req.principal!.name, 'share.enable', share.id);
    }
    return { share: describe(row(share.id)!) };
  });
  app.delete<{ Params: { id: string } }>('/api/manage/shares/:id', async (req, reply) => {
    if (!row(req.params.id)) return reply.code(404).send({ error: '共享不存在' });
    store.db.prepare('DELETE FROM screen_shares WHERE id=?').run(req.params.id);
    revoke(req.params.id, '共享已删除', true); store.audit(req.principal!.name, 'share.delete', req.params.id);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/public/shares/:id/join', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ key: keySchema }).safeParse(req.body);
    const share = row(req.params.id);
    if (!parsed.success || !share || !share.enabled || !timingSafeEqual(Buffer.from(hash(parsed.data.key)), Buffer.from(share.keyHash))) return reply.code(403).send({ error: '共享链接或密钥无效，可能已更换、停止或删除，请向共享者索取新链接' });
    if (!publishers.has(share.id)) return reply.code(409).send({ error: '共享者尚未开始共享，或已关闭共享页面，请稍后重试' });
    for (const [ticket, grant] of tickets) if (grant.expiresAt <= Date.now()) tickets.delete(ticket);
    const count = [...viewers.values()].filter(v => v.shareId === share.id).length + [...tickets.values()].filter(t => t.shareId === share.id).length;
    if (count >= 3) return reply.code(409).send({ error: '当前观看人数已满（最多 3 人），请稍后重试' });
    const ticket = randomBytes(32).toString('base64url');
    tickets.set(hash(ticket), { shareId: share.id, epoch: share.epoch, expiresAt: Date.now() + 30000 });
    return { ticket, name: share.name };
  });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/share-ws') return;
    if (!req.headers.origin || !origins.includes(req.headers.origin) || wss.clients.size >= 100) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    let publisherId: string | undefined, viewerId: string | undefined, alive = true, count = 0, window = Date.now();
    const timeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15000);
    ws.on('pong', () => { alive = true; }); ws.on('error', () => ws.terminate());
    ws.on('message', raw => {
      if (Date.now() - window > 1000) { window = Date.now(); count = 0; }
      if (++count > 100) { ws.close(1008, 'Rate limit'); return; }
      let data: unknown; try { data = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!publisherId && !viewerId) {
        const parsed = authSchema.safeParse(data); if (!parsed.success) { ws.close(1008, 'Unauthorized'); return; }
        const auth = parsed.data;
        if (auth.role === 'publisher') {
          const principal = store.session(cookieValue(req.headers.cookie)), share = row(auth.shareId);
          if (!principal || !share?.enabled || publishers.has(share.id)) { ws.close(1008, 'Sharing unavailable'); return; }
          publisherId = share.id; publishers.set(share.id, { ws, principal }); send(ws, { type: 'ready' });
        } else {
          const grant = tickets.get(hash(auth.ticket)); tickets.delete(hash(auth.ticket));
          const share = grant && row(grant.shareId), publisher = grant && publishers.get(grant.shareId);
          if (!grant || grant.expiresAt <= Date.now() || !share?.enabled || share.epoch !== grant.epoch || !publisher || !store.valid(publisher.principal)) { ws.close(1008, 'Sharing unavailable'); return; }
          viewerId = randomUUID();
          const session = { id: viewerId, hostId: share.id, quality: 'balanced', expiresAt: Date.now() + 4 * 3600000 };
          viewers.set(viewerId, { id: viewerId, shareId: share.id, epoch: grant.epoch, ws, expiresAt: Date.now() + 30000, ready: false });
          const message = { type: 'session', session, iceServers: iceServers(viewerId) };
          send(ws, message); send(publisher.ws, message);
        }
        clearTimeout(timeout); return;
      }
      const publisher = publisherId && publishers.get(publisherId);
      if (publisherId && (!publisher || publisher.ws !== ws || !store.valid(publisher.principal))) { ws.close(1008, 'Authorization expired'); return; }
      const ready = z.object({ type: z.literal('ready'), sessionId: idSchema }).safeParse(data);
      if (publisherId && ready.success) {
        const viewer = viewers.get(ready.data.sessionId);
        if (viewer?.shareId === publisherId && !viewer.ready) { viewer.ready = true; viewer.expiresAt = Date.now() + 4 * 3600000; send(viewer.ws, { type: 'ready' }); }
        return;
      }
      const parsed = signalSchema.safeParse(data); if (!parsed.success) { ws.close(1008, 'Invalid signal'); return; }
      const signal = parsed.data, viewer = viewers.get(signal.sessionId);
      if (!viewer || (publisherId ? viewer.shareId !== publisherId : viewer.id !== viewerId)) { ws.close(1008, 'Wrong session'); return; }
      const share = row(viewer.shareId);
      if (!share?.enabled || share.epoch !== viewer.epoch) { finish(viewer.id, '共享链接已失效'); return; }
      if (signal.type === 'end') { finish(viewer.id, '观看已结束'); return; }
      if (!viewer.ready || (signal.type === 'offer' && !viewerId) || (signal.type === 'answer' && !publisherId) || (signal.type === 'offer' && /^m=application\s/m.test(signal.sdp))) { ws.close(1008, 'Read-only sharing'); return; }
      send(publisherId ? viewer.ws : publishers.get(viewer.shareId)?.ws, signal);
    });
    ws.on('close', () => {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (viewerId) finish(viewerId, '观看者已离开');
      if (publisherId && publishers.get(publisherId)?.ws === ws) { publishers.delete(publisherId); revoke(publisherId, '共享者已离线', false); }
    });
  });
  const reap = setInterval(() => {
    for (const [ticket, grant] of tickets) if (grant.expiresAt <= Date.now()) tickets.delete(ticket);
    for (const [id, publisher] of publishers) if (!store.valid(publisher.principal)) revoke(id, '共享者登录已失效', true);
    for (const viewer of [...viewers.values()]) if (viewer.expiresAt <= Date.now()) finish(viewer.id, '观看会话已到期，请重新打开链接');
  }, 1000);
  app.addHook('preClose', async () => { clearInterval(reap); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
}
