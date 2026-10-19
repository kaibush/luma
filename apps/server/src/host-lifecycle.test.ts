import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { DatabaseSync } from 'node:sqlite'
import type { Host, AccessToken } from '@remote/protocol'
import { createApp } from './server.js'

const controlToken = 'c'.repeat(64), hostToken = 'h'.repeat(64), origin = 'http://localhost:5173'
const browser = { 'x-remote-request': '1', origin }
const settings = { workspaceName: 'Test', defaultQuality: 'responsive', sessionMinutes: 30, stunUrl: '', turnUrl: '' }
const cookie = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]

test('host archives survive disconnect/restart, token restore reconnects, purge retains diagnostics', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-lifecycle-')), dataPath = join(dir, 'state.sqlite')
  const config = { controlToken, hostToken, origins: [origin], dataPath, logger: false }
  let app = await createApp(config)
  const sockets: WebSocket[] = []
  const deviceId = randomUUID()
  const open = async (token = hostToken, id = deviceId, accepted = true) => {
    const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`)
    sockets.push(ws); await once(ws, 'open')
    const reply = once(ws, accepted ? 'message' : 'close')
    ws.send(JSON.stringify({ type: 'auth', role: 'host', token, deviceId: id, name: '办公室电脑', kind: 'windows' }))
    const result = await reply
    if (!accepted) { assert.equal(result[0], 1008); return { ws, hostId: '' } }
    return { ws, hostId: JSON.parse(result[0].toString()).hostId as string }
  }
  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const unlock = await app.inject({ method: 'POST', url: '/api/auth/setup/unlock', headers: browser, payload: { key: controlToken } })
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup/complete', headers: { ...browser, cookie: cookie(unlock) }, payload: { username: 'admin', password: 'test-password-1234', settings } })
    const headers = { ...browser, cookie: cookie(setup) }
    const list = async (): Promise<Host[]> => (await app.inject({ url: '/api/hosts', headers })).json().hosts
    const tokens = async (): Promise<AccessToken[]> => (await app.inject({ url: '/api/manage/tokens', headers })).json().tokens
    const token = (await tokens()).find(t => t.scope === 'host')!
    const mutate = (suffix: string, method: 'POST' | 'DELETE' = 'POST') => app.inject({ method, url: `/api/manage/tokens/${token.id}/${suffix}`, headers })
    const first = await open()
    assert.equal((await list())[0].online, true)
    assert.equal((await tokens()).find(t => t.id === token.id)!.hosts[0].online, true)
    const nameUrl = `/api/manage/hosts/${first.hostId}/name`
    const rename = (displayName: string) => app.inject({ method: 'PUT', url: nameUrl, headers, payload: { displayName } })
    assert.equal((await app.inject({ method: 'PUT', url: nameUrl, headers: { ...browser, authorization: `Bearer ${controlToken}` }, payload: { displayName: 'not allowed' } })).statusCode, 401)
    assert.equal((await app.inject({ method: 'PUT', url: nameUrl, headers: { ...headers, origin: 'https://evil.test' }, payload: { displayName: 'not allowed' } })).statusCode, 403)
    assert.equal((await rename('a'.repeat(65))).statusCode, 400)
    assert.equal((await rename('invalid\nname')).statusCode, 400)
    assert.equal((await rename('  部署服务器  ')).statusCode, 200)
    let named = (await list())[0]
    assert.equal(named.name, '部署服务器'); assert.equal(named.reportedName, '办公室电脑')
    assert.equal(named.id, first.hostId); assert.equal(named.accessToken?.id, token.id)
    assert.equal((await tokens()).find(t => t.id === token.id)!.hosts[0].name, '部署服务器')
    await open(hostToken, deviceId, false) // Reject duplicates without taking the first connection offline.
    assert.equal((await list())[0].online, true)
    assert.equal((await mutate('purge', 'DELETE')).statusCode, 409)
    const metadata = { group: '办公室', note: '保留我的备注' }
    assert.equal((await app.inject({ method: 'PUT', url: `/api/hosts/${first.hostId}`, headers, payload: metadata })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { hostId: first.hostId } })).statusCode, 201)
    assert.equal((await app.inject({ url: '/api/manage/connections', headers })).json().connections[0].hostName, '部署服务器')
    const closed = once(first.ws, 'close'); first.ws.close(); await closed
    // Wait for the server to observe the close, independent of client close event ordering.
    for (let i = 0; i < 100 && (await list())[0].online; i++) await new Promise(resolve => setTimeout(resolve, 10))
    let host = (await list())[0]
    assert.equal(host.online, false); assert.equal(host.busy, false)
    assert.ok(host.firstSeenAt && host.lastSeenAt && host.lastOfflineAt)
    assert.equal(host.note, metadata.note)
    assert.equal((await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { hostId: first.hostId } })).statusCode, 404)
    assert.equal((await app.inject({ method: 'PUT', url: `/api/hosts/${first.hostId}`, headers, payload: { ...metadata, note: '离线编辑成功' } })).statusCode, 200)
    assert.equal((await rename('服务器（离线修改）')).statusCode, 200)
    await app.close(); app = await createApp(config); await app.listen({ host: '127.0.0.1', port: 0 })
    host = (await list())[0]
    assert.equal(host.online, false); assert.equal(host.note, '离线编辑成功')
    assert.equal(host.id, first.hostId)
    assert.equal(host.name, '服务器（离线修改）')
    const second = await open(); assert.equal(second.hostId, first.hostId)
    assert.equal((await list()).length, 1)
    named = (await list())[0]
    assert.equal(named.name, '服务器（离线修改）'); assert.equal(named.reportedName, '办公室电脑')
    assert.equal((await rename('')).statusCode, 200)
    assert.equal((await list())[0].name, '办公室电脑')
    assert.equal((await list())[0].note, '离线编辑成功')
    assert.equal((await mutate('revoke')).statusCode, 200)
    host = (await list())[0]
    assert.equal(host.online, false); assert.equal(host.accessToken?.status, 'revoked')
    await open(hostToken, deviceId, false)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/host-token/verify', headers: browser, payload: { token: hostToken } })).statusCode, 400)
    // Revocation survives a restart, restoration preserves identity and metadata.
    await app.close(); app = await createApp(config); await app.listen({ host: '127.0.0.1', port: 0 })
    assert.equal((await list())[0].accessToken?.status, 'revoked')
    assert.equal((await mutate('restore')).statusCode, 200)
    const restored = await open(); assert.equal(restored.hostId, first.hostId)
    assert.equal((await list())[0].note, '离线编辑成功')
    assert.equal((await app.inject({ method: 'PUT', url: `/api/manage/tokens/${token.id}`, headers, payload: { name: '办公室专用密钥' } })).statusCode, 200)
    assert.equal((await list())[0].accessToken?.name, '办公室专用密钥')
    await mutate('revoke')
    assert.equal((await mutate('purge', 'DELETE')).statusCode, 200)
    host = (await list())[0]
    assert.equal(host.online, false); assert.equal(host.accessToken?.status, 'deleted')
    assert.equal(host.id, first.hostId); assert.equal(host.note, '离线编辑成功')
    assert.equal((await mutate('restore')).statusCode, 404)
    assert.equal((await mutate('reveal')).statusCode, 404)
    assert.ok(!(await tokens()).some(t => t.id === token.id))
    await app.close(); app = await createApp(config); await app.listen({ host: '127.0.0.1', port: 0 })
    await open(hostToken, deviceId, false) // Deployment seeding must not resurrect deleted credentials.
    assert.equal((await list())[0].accessToken?.status, 'deleted')
    const audit = (await app.inject({ url: '/api/manage/audit', headers })).json().events
    for (const action of ['token.revoke', 'token.restore', 'token.delete']) assert.ok(audit.some((event: { action: string }) => event.action === action))
    assert.ok(!JSON.stringify(audit).includes(hostToken))
  } finally { sockets.forEach(ws => ws.terminate()); await app.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('key verification explains scope/expiry and restoration cannot bypass expiry or admin authorization', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-expiry-')), dataPath = join(dir, 'state.sqlite')
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false, dataPath })
  try {
    const verify = (token: string) => app.inject({ method: 'POST', url: '/api/auth/host-token/verify', headers: browser, payload: { token } })
    assert.equal((await verify(hostToken)).statusCode, 200)
    assert.match((await verify(controlToken)).json().error, /控制 API/)
    assert.equal((await verify('invalid')).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/host-token/verify', payload: { token: hostToken } })).statusCode, 403)
    const unlock = await app.inject({ method: 'POST', url: '/api/auth/setup/unlock', headers: browser, payload: { key: controlToken } })
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup/complete', headers: { ...browser, cookie: cookie(unlock) }, payload: { username: 'admin', password: 'test-password-1234', settings } })
    const headers = { ...browser, cookie: cookie(setup) }
    const token = (await app.inject({ url: '/api/manage/tokens', headers })).json().tokens.find((t: AccessToken) => t.scope === 'host')
    const url = `/api/manage/tokens/${token.id}`
    for (const [method, suffix] of [['POST', 'revoke'], ['POST', 'restore'], ['DELETE', 'purge']] as const) {
      assert.equal((await app.inject({ method, url: `${url}/${suffix}`, headers: { ...browser, authorization: `Bearer ${controlToken}` } })).statusCode, 401)
      assert.equal((await app.inject({ method, url: `${url}/${suffix}`, headers: { ...headers, origin: 'https://evil.test' } })).statusCode, 403)
    }
    const db = new DatabaseSync(dataPath)
    db.prepare('UPDATE tokens SET expiresAt=? WHERE id=?').run(Date.now() - 1, token.id); db.close()
    assert.match((await verify(hostToken)).json().error, /过期/)
    await app.inject({ method: 'POST', url: `${url}/revoke`, headers })
    assert.equal((await app.inject({ method: 'POST', url: `${url}/restore`, headers })).statusCode, 409)
    const current = (await app.inject({ url: '/api/manage/tokens', headers })).json().tokens.find((t: AccessToken) => t.id === token.id)
    assert.ok(current.revokedAt); assert.ok(current.expiresAt < Date.now())
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})
