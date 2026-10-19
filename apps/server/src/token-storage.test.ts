import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './store.js'
import type { Host } from '@remote/protocol'

test('encrypted token recovery, legacy records, tamper detection and missing key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-vault-')), path = join(dir, 'state.sqlite')
  const config = { controlToken: 'c'.repeat(64), hostToken: 'h'.repeat(64) }
  let store = new Store(path, config)
  try {
    const token = store.addToken('new', 'control')
    const legacy = store.addToken('legacy', 'host')
    store.db.prepare('UPDATE tokens SET sealed=NULL WHERE id=?').run(legacy.id)
    store.db.prepare('UPDATE tokens SET sealed=NULL WHERE name=?').run('部署控制 API 密钥')
    store.db.close()
    store = new Store(path, config)
    assert.equal(store.revealToken(token.id), token.value)
    store.db.prepare('UPDATE tokens SET expiresAt=? WHERE id=?').run(Date.now() - 1000, token.id)
    assert.equal(store.revealToken(token.id), token.value)
    assert.equal(store.token(token.value, 'control'), null)
    store.revoke(token.id)
    assert.equal(store.revealToken(token.id), token.value)
    assert.equal(store.token(token.value, 'control'), null)
    assert.equal(store.revealToken(legacy.id), null)
    const bootstrap = store.tokens().find(t => t.name === '部署控制 API 密钥')!
    assert.equal(store.revealToken(String(bootstrap.id)), config.controlToken)
    assert.equal(statSync(`${path}.token-key`).mode & 0o777, 0o600)
    // The encrypted value is bound to its record, preventing ciphertext swaps.
    store.db.prepare('UPDATE tokens SET sealed=(SELECT sealed FROM tokens WHERE id=?) WHERE id=?').run(token.id, legacy.id)
    assert.throws(() => store.revealToken(legacy.id))
    store.db.close()
    assert.ok(!readFileSync(path).includes(Buffer.from(token.value)))
    unlinkSync(`${path}.token-key`)
    assert.throws(() => new Store(path, config), /encryption key missing/)
  } finally {
    if (store.db.isOpen) store.db.close()
    rmSync(dir, {recursive: true, force: true})
  }
})

test('upgrading an existing database preserves credentials and legacy host metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-migration-')), path = join(dir, 'state.sqlite')
  const config = { controlToken: 'c'.repeat(64), hostToken: 'h'.repeat(64) }
  let store = new Store(path, config)
  try {
    const token = store.tokens().find(t => t.scope === 'host')!
    const created = store.addToken('自定义密钥', 'host')
    store.saveHostMetadata('legacy-device', { group: '原分组', note: '原备注', lastConnectedAt: 123 })
    store.revoke(token.id)
    // Match the schema before host persistence / token source migration.
    store.db.exec('DROP TABLE hosts; ALTER TABLE tokens DROP COLUMN source;')
    store.close()
    store = new Store(path, config)
    assert.equal(store.tokens().length, 3)
    const migrated = store.tokens().find(t => t.id === token.id)!
    assert.equal(migrated.source, 'deployment'); assert.equal(migrated.status, 'revoked')
    assert.equal(store.tokens().find(t => t.id === created.id)!.source, 'created')
    assert.equal(store.revealToken(created.id), created.value)
    assert.equal(store.revealToken(token.id), config.hostToken)
    const host: Host = { id: 'legacy-device', name: '原电脑', kind: 'windows', online: true, busy: false, capabilities: { video: true, systemInput: true } }
    store.registerHost(host, token.id)
    const archived = store.hosts()[0]
    assert.equal(archived.online, false)
    assert.equal(archived.group, '原分组'); assert.equal(archived.note, '原备注'); assert.equal(archived.lastConnectedAt, 123)
  } finally { if (store.db.isOpen) store.close(); rmSync(dir, { recursive: true, force: true }) }
})
