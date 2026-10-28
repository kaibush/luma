import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store, settingsSchema, type Principal } from './store.js';
import type { Host } from '@remote/protocol';

export const cookieValue = (header: string | undefined, name = 'rc_session') => header?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || '';
export const passwordSchema = z.string().min(12, '密码至少 12 位').max(128, '密码最多 128 位');
const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/);
const secretSchema = z.string().min(16).max(256).optional();
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }

export function registerAdmin(app: FastifyInstance, store: Store, options: {controlToken: string; secureCookies?: boolean; origins: string[]}, disconnect: (principal?: Principal) => void, connections: () => unknown, hosts: () => Host[]) {
  const cookie = (reply: FastifyReply, name: string, value: string, ttl: number) => reply.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${options.secureCookies ? '; Secure' : ''}`);
  const admin = (req: FastifyRequest, reply: FastifyReply) => { if (req.principal?.kind !== 'session') { reply.code(401).send({error: '请使用管理员账号登录'}); return false; } return true; };
  const setup = (req: FastifyRequest, reply: FastifyReply) => {
    if (store.initialized()) { reply.code(409).send({error: '系统已初始化，不能重复创建管理员'}); return false; }
    if (!store.session(cookieValue(req.headers.cookie, 'rc_setup'), 'setup')) { reply.code(401).send({error: '请先验证部署密钥'}); return false; }
    return true;
  };
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const browser = store.session(cookieValue(req.headers.cookie));
    req.principal = browser || store.token(req.headers.authorization?.replace(/^Bearer /, '') || '', 'control');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (browser || path.startsWith('/api/auth/') || path.startsWith('/api/manage/'))) {
      if (req.headers['x-remote-request'] !== '1' || (req.headers.origin && !options.origins.includes(req.headers.origin))) return reply.code(403).send({error: '请求来源无效，请刷新页面重试'});
    }
    if (path.startsWith('/api/auth/')) return;
    if (/^\/api\/public\/shares\/[a-f0-9-]+\/join$/.test(path) && req.method === 'POST') return;
    if (!req.principal) return reply.code(401).send({error: '登录已失效或控制端 Token 无效'});
    if (path.startsWith('/api/manage/') && !admin(req, reply)) return;
  });
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.post('/api/auth/host-token/verify', limited, async (req, reply) => {
    const parsed = z.object({ token: z.string().trim().min(1).max(256), resumeHostId: z.string().min(1).max(128).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '请填写完整的主机密钥' });
    const principal = store.token(parsed.data.token, 'host');
    if (!principal) return reply.code(400).send({ error: store.hostTokenError(parsed.data.token) });
    if (parsed.data.resumeHostId) {
      const host = hosts().find(host => host.id === parsed.data.resumeHostId);
      if (!host || host.kind !== 'browser' || host.accessToken?.id !== principal.id) return reply.code(400).send({ error: '无法恢复此浏览器主机，请确认档案仍存在并使用原主机密钥' });
      if (host.online) return reply.code(409).send({ error: '此主机仍在共享，请先停止原页面的共享' });
      return { name: principal.name, host: { id: host.id, name: host.reportedName || host.name } };
    }
    return { name: principal.name };
  });
  app.get('/api/auth/me', async req => ({ initialized: store.initialized(), user: req.principal?.kind === 'session' ? store.account() : null, workspaceName: store.settings().workspaceName }));
  app.post<{Body: {key?: string}}>('/api/auth/setup/unlock', limited, async (req, reply) => {
    if (store.initialized()) return reply.code(409).send({error: '系统已初始化'});
    if (typeof req.body?.key !== 'string' || req.body.key.length > 256 || !equal(req.body.key, options.controlToken)) return reply.code(401).send({error: '部署密钥不正确'});
    const login = store.login('setup'); cookie(reply, 'rc_setup', login.value, login.ttl);
    return { settings: store.settings() };
  });
  app.get('/api/auth/setup/context', async (req, reply) => { if (!setup(req, reply)) return; return {settings: store.settings()}; });
  app.post('/api/auth/setup/complete', limited, async (req, reply) => {
    if (!setup(req, reply)) return;
    const parsed = z.object({username: usernameSchema, password: passwordSchema, settings: settingsSchema, turnSecret: secretSchema}).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error: '请检查账号、密码和连接参数'});
    const data = parsed.data;
    if (data.settings.turnUrl && !(data.turnSecret || store.credentials().turnSecret)) return reply.code(400).send({error:'启用 TURN 需要共享密钥'});
    try { await store.initialize(data.username, data.password, data.settings, data.turnSecret); }
    catch (e) { if ((e as Error).message === 'ALREADY_INITIALIZED') return reply.code(409).send({error: '系统已初始化'}); throw e; }
    const login = store.login('admin', data.username); cookie(reply, 'rc_session', login.value, login.ttl);
    return { user: { username: data.username } };
  });
  app.post('/api/auth/login', limited, async (req, reply) => {
    const parsed = z.object({username: usernameSchema, password: z.string().min(1).max(128)}).safeParse(req.body);
    if (!store.initialized()) return reply.code(409).send({error: '请先完成系统初始化'});
    if (!parsed.success || !await store.verifyPassword(parsed.data.username, parsed.data.password)) return reply.code(401).send({error: '账号或密码不正确'});
    const login = store.login('admin', parsed.data.username); cookie(reply, 'rc_session', login.value, login.ttl);
    store.audit(parsed.data.username, 'auth.login', '管理员登录');
    return {user: store.account()};
  });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.principal?.kind === 'session') { store.logout(req.principal.id); disconnect(req.principal); }
    cookie(reply, 'rc_session', '', 0); return {ok: true};
  });
  app.post('/api/auth/password', limited, async (req, reply) => {
    if (!admin(req, reply)) return;
    const parsed = z.object({currentPassword: z.string().max(128), password: passwordSchema}).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:'新密码至少 12 位，最多 128 位'});
    if (!await store.verifyPassword(req.principal!.name, parsed.data.currentPassword)) return reply.code(401).send({error:'当前密码不正确'});
    await store.changePassword(parsed.data.password); disconnect();
    store.audit(req.principal!.name, 'auth.password', '已修改密码并注销所有登录');
    cookie(reply, 'rc_session', '', 0); return {ok: true};
  });
  app.get('/api/manage/settings', async () => ({settings: store.settings()}));
  app.put('/api/manage/settings', async (req, reply) => {
    const parsed = z.object({settings: settingsSchema, turnSecret: secretSchema}).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:'连接参数无效'});
    if (parsed.data.settings.turnUrl && !(parsed.data.turnSecret || store.credentials().turnSecret)) return reply.code(400).send({error:'启用 TURN 需要共享密钥'});
    store.saveSettings(parsed.data.settings, parsed.data.turnSecret);
    store.audit(req.principal!.name, 'settings.update', '连接设置已更新，对新会话生效');
    return {settings: store.settings()};
  });
  app.get('/api/preferences', async () => ({workspaceName: store.settings().workspaceName, defaultQuality: store.settings().defaultQuality}));
  app.get('/api/manage/tokens', async () => {
    const devices = hosts();
    return { tokens: store.tokens().map(token => ({ ...token,
      hosts: devices.filter(host => host.accessToken?.id === token.id).map(({ id, name, online, lastSeenAt, reportedName, displayName }) => ({ id, name, online, lastSeenAt, reportedName, displayName })),
    })) };
  });
  app.put<{Params:{id:string}}>('/api/manage/hosts/:id/name', async (req, reply) => {
    const parsed = z.object({ displayName: z.string().trim().max(64).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '主机显示名称最多 64 个字符，不能包含换行或控制字符' });
    const host = hosts().find(host => host.id === req.params.id);
    if (!host) return reply.code(404).send({ error: '主机不存在' });
    store.saveHostMetadata(host.id, { ...store.hostMetadata(host.id), displayName: parsed.data.displayName });
    store.audit(req.principal!.name, 'host.rename', `${host.id}: ${parsed.data.displayName || '恢复客户端名称'}`);
    return { host: { ...host, displayName: parsed.data.displayName, name: parsed.data.displayName || host.reportedName || host.name } };
  });
  app.delete<{Params:{id:string}}>('/api/manage/hosts/:id', async (req, reply) => {
    const host = hosts().find(host => host.id === req.params.id);
    if (!host) return reply.code(404).send({ error: '主机不存在或已删除' });
    if (host.online || host.busy) return reply.code(409).send({ error: '主机仍在线，请先停止浏览器共享或断开客户端，再删除主机' });
    store.deleteHost(host.id);
    store.audit(req.principal!.name, 'host.delete', `${host.id}: ${host.name}`);
    return reply.code(204).send();
  });
  app.post('/api/manage/tokens', async (req, reply) => {
    const parsed = z.object({name: z.string().trim().min(1).max(64), scope: z.enum(['control','host']), days: z.number().int().min(1).max(365).optional()}).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:'Token 参数无效'});
    const token = store.addToken(parsed.data.name, parsed.data.scope, undefined, parsed.data.days);
    store.audit(req.principal!.name, 'token.create', parsed.data.name);
    return reply.code(201).send(token);
  });
  app.post<{Params:{id:string}}>('/api/manage/tokens/:id/reveal', async (req, reply) => {
    const value = store.revealToken(req.params.id);
    if (!value) return reply.code(404).send({error:'此密钥不存在或旧记录未保存可恢复的原文，请创建新密钥。'});
    store.audit(req.principal!.name, 'token.reveal', req.params.id);
    return {value};
  });
  app.post('/api/manage/settings/turn-secret/reveal', async (req) => {
    store.audit(req.principal!.name, 'turn-secret.reveal', '管理员查看 TURN 共享密钥');
    return {value: store.credentials().turnSecret};
  });
  app.put<{Params:{id:string}}>('/api/manage/tokens/:id', async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '名称应为 1–64 个字符' });
    if (!store.renameToken(req.params.id, parsed.data.name)) return reply.code(404).send({ error: 'Token 不存在' });
    store.audit(req.principal!.name, 'token.rename', `${req.params.id}: ${parsed.data.name}`);
    return { ok: true };
  });
  // Keep the original DELETE route as a revoke-only alias for older clients.
  for (const [method, url] of [['POST', '/api/manage/tokens/:id/revoke'], ['DELETE', '/api/manage/tokens/:id']] as const) {
    app.route<{Params:{id:string}}>({ method, url, handler: async (req, reply) => {
      if (!store.tokens().some(token => token.id === req.params.id)) return reply.code(404).send({ error: 'Token 不存在' });
      const changed = store.revoke(req.params.id);
      disconnect({kind:'token',id:req.params.id,scope:'control',name:''});
      if (changed) store.audit(req.principal!.name, 'token.revoke', req.params.id);
      return {ok:true};
    } });
  }
  app.post<{Params:{id:string}}>('/api/manage/tokens/:id/restore', async (req, reply) => {
    const token = store.tokens().find(token => token.id === req.params.id);
    if (!token) return reply.code(404).send({ error: 'Token 不存在' });
    if (token.expiresAt !== null && token.expiresAt <= Date.now()) return reply.code(409).send({ error: 'Token 已过期，请创建新密钥；恢复不会延长有效期' });
    if (store.restoreToken(token.id)) store.audit(req.principal!.name, 'token.restore', token.id);
    return { ok: true };
  });
  app.delete<{Params:{id:string}}>('/api/manage/tokens/:id/purge', async (req, reply) => {
    const token = store.tokens().find(token => token.id === req.params.id);
    if (!token) return reply.code(404).send({ error: 'Token 不存在' });
    if (!token.revokedAt) return reply.code(409).send({ error: '请先撤销 Token，再永久删除' });
    store.deleteToken(token.id);
    disconnect({kind:'token',id:token.id,scope:token.scope,name:token.name});
    store.audit(req.principal!.name, 'token.delete', `${token.id}: ${token.name}`);
    return { ok: true };
  });
  app.get('/api/manage/connections', async () => ({connections: connections()}));
  app.get('/api/manage/audit', async (req, reply) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      snapshot: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: '分页参数无效：页码从 1 开始，每页最多 100 条' });
    return store.events(parsed.data.page, parsed.data.pageSize, parsed.data.snapshot);
  });
}
