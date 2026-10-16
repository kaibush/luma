import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { qualitySchema } from '@remote/protocol';
import { z } from 'zod';

const iceUrl = z.string().max(512).refine(v => !v || /^(stun|stuns|turn|turns):[^\s]+$/.test(v), '请输入有效的 STUN / TURN 地址');
export const settingsSchema = z.object({
  workspaceName: z.string().trim().min(1).max(60), defaultQuality: qualitySchema,
  sessionMinutes: z.number().int().min(15).max(240),
  stunUrl: iceUrl.refine(v => !v || /^stuns?:/.test(v)), turnUrl: iceUrl.refine(v => !v || /^turns?:/.test(v)),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Principal = { kind: 'session' | 'token'; id: string; scope: 'admin' | 'control' | 'host'; name: string };
type Credentials = Settings & { turnSecret: string };
type Account = { username: string; salt: string; passwordHash: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, value) => error ? reject(error) : resolve(value)));
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, defaults: { controlToken: string; hostToken: string; stunUrl?: string; turnUrl?: string; turnSecret?: string }) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, suffix TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER, revokedAt INTEGER, lastUsedAt INTEGER);
      CREATE TABLE IF NOT EXISTS logins (id TEXT PRIMARY KEY, username TEXT NOT NULL, purpose TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);`);
    if (!this.get('seeded')) {
      this.transaction(() => {
        this.set('settings', { workspaceName: 'Remote Console', defaultQuality: 'responsive', sessionMinutes: 240, stunUrl: defaults.stunUrl || '', turnUrl: defaults.turnUrl || '', turnSecret: defaults.turnSecret || '' });
        this.addToken('原有控制端 Token', 'control', defaults.controlToken);
        this.addToken('本机主机 Token（迁移保留）', 'host', defaults.hostToken);
        this.set('seeded', true);
      });
    }
  }
  private get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key) as { value: string } | undefined; return row && JSON.parse(row.value); }
  private set(key: string, value: unknown) { this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  private transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  initialized() { return !!this.get<Account>('account'); }
  account() { const account = this.get<Account>('account'); return account ? { username: account.username } : null; }
  credentials() { return this.get<Credentials>('settings')!; }
  settings() { const { turnSecret, ...settings } = this.credentials(); return { ...settings, turnSecretSet: !!turnSecret, turnConfigured: !!(settings.turnUrl && turnSecret) }; }
  saveSettings(settings: Settings, turnSecret?: string) { this.set('settings', { ...settings, turnSecret: turnSecret ?? this.credentials().turnSecret }); }
  async initialize(username: string, password: string, settings: Settings, turnSecret?: string) {
    const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt);
    this.transaction(() => {
      if (this.initialized()) throw new Error('ALREADY_INITIALIZED');
      this.set('account', { username, salt, passwordHash: hash.toString('hex') });
      this.saveSettings(settings, turnSecret);
      this.db.exec("DELETE FROM logins WHERE purpose='setup'");
      this.audit(username, 'setup.complete', '管理员已创建');
    });
  }
  async verifyPassword(username: string, password: string) {
    const account = this.get<Account>('account');
    const hash = await derive(password, account?.salt || '00000000000000000000000000000000');
    return !!account && account.username === username && timingSafeEqual(hash, Buffer.from(account.passwordHash, 'hex'));
  }
  async changePassword(password: string) {
    const account = this.get<Account>('account')!;
    const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt);
    this.transaction(() => { this.set('account', { username: account.username, salt, passwordHash: hash.toString('hex') }); this.db.exec('DELETE FROM logins'); });
  }
  login(purpose: 'setup' | 'admin', username = '') {
    const value = randomBytes(32).toString('base64url'), ttl = purpose === 'setup' ? 600 : 43200;
    this.db.prepare('DELETE FROM logins WHERE expiresAt<=?').run(Date.now());
    this.db.prepare('INSERT INTO logins VALUES(?,?,?,?)').run(digest(value), username, purpose, Date.now() + ttl * 1000);
    return { value, ttl };
  }
  session(value: string, purpose = 'admin'): Principal | null {
    if (!value || value.length > 256) return null;
    const row = this.db.prepare('SELECT username FROM logins WHERE id=? AND purpose=? AND expiresAt>?').get(digest(value), purpose, Date.now()) as {username: string} | undefined;
    return row ? { kind: 'session', id: digest(value), scope: 'admin', name: row.username } : null;
  }
  logout(id: string) { this.db.prepare('DELETE FROM logins WHERE id=?').run(id); }
  addToken(name: string, scope: 'control' | 'host', supplied?: string, days?: number) {
    const value = supplied || `rc_${scope}_${randomBytes(32).toString('base64url')}`, id = randomUUID();
    this.db.prepare('INSERT INTO tokens(id,name,scope,hash,suffix,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?)').run(id, name, scope, digest(value), value.slice(-4), Date.now(), days ? Date.now() + days * 86400_000 : null);
    return { id, value };
  }
  token(value: string, scope: 'control' | 'host'): Principal | null {
    if (!value || value.length > 256) return null;
    const row = this.db.prepare('SELECT id,name,lastUsedAt FROM tokens WHERE hash=? AND scope=? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)').get(digest(value), scope, Date.now()) as {id: string; name: string; lastUsedAt: number | null} | undefined;
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt > 60000) this.db.prepare('UPDATE tokens SET lastUsedAt=? WHERE id=?').run(Date.now(), row.id);
    return { kind: 'token', id: row.id, scope, name: row.name };
  }
  valid(principal: Principal) {
    const row = principal.kind === 'session'
      ? this.db.prepare("SELECT id FROM logins WHERE id=? AND purpose='admin' AND expiresAt>?").get(principal.id, Date.now())
      : this.db.prepare('SELECT id FROM tokens WHERE id=? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)').get(principal.id, Date.now());
    return !!row;
  }
  tokens() { return this.db.prepare('SELECT id,name,scope,suffix,createdAt,expiresAt,revokedAt,lastUsedAt FROM tokens ORDER BY createdAt DESC').all(); }
  revoke(id: string) { return this.db.prepare('UPDATE tokens SET revokedAt=? WHERE id=? AND revokedAt IS NULL').run(Date.now(), id).changes; }
  audit(actor: string, action: string, detail: string) {
    this.db.prepare('INSERT INTO audit(time,actor,action,detail) VALUES(?,?,?,?)').run(Date.now(), actor, action, detail);
    this.db.exec('DELETE FROM audit WHERE id < (SELECT MAX(id)-1000 FROM audit)');
  }
  events() { return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 50').all(); }
  close() { this.db.close(); }
}
