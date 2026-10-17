import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './store.js'

test('encrypted token recovery, legacy records, tamper detection and missing key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-vault-')), path = join(dir, 'state.sqlite')
  const config = { controlToken: 'c'.repeat(64), hostToken: 'h'.repeat(64) }
  let store = new Store(path, config)
  try {
    const token = store.addToken('new', 'control')
    const legacy = store.addToken('legacy', 'host')
    store.db.prepare('UPDATE tokens SET sealed=NULL WHERE id=?').run(legacy.id)
    store.db.prepare('UPDATE tokens SET sealed=NULL WHERE name=?').run('原有控制端 Token')
    store.db.close()
    store = new Store(path, config)
    assert.equal(store.revealToken(token.id), token.value)
    assert.equal(store.revealToken(legacy.id), null)
    const bootstrap = store.tokens().find(t => t.name === '原有控制端 Token')!
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
