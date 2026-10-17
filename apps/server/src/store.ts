import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
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
  private readonly tokenKey: Buffer;
  constructor(path: string, defaults: { controlToken: string; hostToken: string; stunUrl?: string; turnUrl?: string; turnSecret?: string }) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const keyPath = `${path}.token-key`;
    if (path === ':memory:') this.tokenKey = randomBytes(32);
    else {
      if (!existsSync(keyPath)) {
        const columns = this.db.prepare('PRAGMA table_info(tokens)').all() as {name: string}[];
        if (columns.some(c => c.name === 'sealed') && this.db.prepare('SELECT 1 FROM tokens WHERE sealed IS NOT NULL LIMIT 1').get()) {
          this.db.close();
          throw new Error('Token encryption key missing; restore the .token-key file from backup');
        }
        writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
      }
      this.tokenKey = readFileSync(keyPath);
      if (this.tokenKey.length !== 32) throw new Error('Invalid token encryption key');
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, suffix TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER, revokedAt INTEGER, lastUsedAt INTEGER);
      CREATE TABLE IF NOT EXISTS logins (id TEXT PRIMARY KEY, username TEXT NOT NULL, purpose TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);`);
    const columns = this.db.prepare('PRAGMA table_info(tokens)').all() as {name: string}[];
    if (!columns.some(c => c.name === 'sealed')) this.db.exec('ALTER TABLE tokens ADD COLUMN sealed TEXT');
    // Recover only deployment tokens whose original value still exists in config.
    for (const value of [defaults.controlToken, defaults.hostToken]) {
      const row = this.db.prepare('SELECT id FROM tokens WHERE hash=? AND sealed IS NULL AND revokedAt IS NULL').get(digest(value)) as {id: string} | undefined;
      if (row) this.db.prepare('UPDATE tokens SET sealed=? WHERE id=?').run(this.seal(row.id, value), row.id);
    }
    if (!this.get('seeded')) {
      this.transaction(() => {
        this.set('settings', { workspaceName: 'Remote Console', defaultQuality: 'responsive', sessionMinutes: 240, stunUrl: defaults.stunUrl || '', turnUrl: defaults.turnUrl || '', turnSecret: defaults.turnSecret || '' });
        this.addToken('原有控制端 Token', 'control', defaults.controlToken);
        this.addToken('本机主机 Token（迁移保留）', 'host', defaults.hostToken);
        this.set('seeded', true);
      });
    }
  }
  private seal(id: string, value: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.tokenKey, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  revealToken(id: string) {
    const row = this.db.prepare('SELECT sealed FROM tokens WHERE id=? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)').get(id, Date.now()) as {sealed: string | null} | undefined;
    if (!row?.sealed) return null;
    const data = Buffer.from(row.sealed, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.tokenKey, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
  private get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key) as { value: string } | undefined; return row && JSON.parse(row.value); }
  private set(key: string, value: unknown) { this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  private transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  hostMetadata(id: string) { return this.get<{ group: string; note: string; lastConnectedAt?: number }>(`host:${id}`) || { group: '', note: '' }; }
  saveHostMetadata(id: string, value: { group: string; note: string; lastConnectedAt?: number }) { this.set(`host:${id}`, value); }
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
    this.db.prepare('INSERT INTO tokens(id,name,scope,hash,suffix,createdAt,expiresAt,sealed) VALUES(?,?,?,?,?,?,?,?)').run(id, name, scope, digest(value), value.slice(-4), Date.now(), days ? Date.now() + days * 86400_000 : null, this.seal(id, value));
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
  tokens() { return this.db.prepare('SELECT id,name,scope,suffix,createdAt,expiresAt,revokedAt,lastUsedAt,(sealed IS NOT NULL) AS revealable FROM tokens ORDER BY createdAt DESC').all(); }
  revoke(id: string) { return this.db.prepare('UPDATE tokens SET revokedAt=? WHERE id=? AND revokedAt IS NULL').run(Date.now(), id).changes; }
  audit(actor: string, action: string, detail: string) {
    this.db.prepare('INSERT INTO audit(time,actor,action,detail) VALUES(?,?,?,?)').run(Date.now(), actor, action, detail);
    this.db.exec('DELETE FROM audit WHERE id < (SELECT MAX(id)-1000 FROM audit)');
  }
  events() { return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 50').all(); }
  close() { this.db.close(); }
}
