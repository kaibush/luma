import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type { Host } from '@remote/protocol'
import { createApp } from './server.js'
import { Store } from './store.js'

const controlToken = 'c'.repeat(64), hostToken = 'h'.repeat(64), origin = 'http://localhost:5173'
const browser = { 'x-remote-request': '1', origin }
const settings = { workspaceName: 'Test', defaultQuality: 'responsive', sessionMinutes: 30, stunUrl: '', turnUrl: '' }
async function login(app: Awaited<ReturnType<typeof createApp>>) {
  const unlock = await app.inject({ method: 'POST', url: '/api/auth/setup/unlock', headers: browser, payload: { key: controlToken } })
  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup/complete', headers: { ...browser, cookie: String(unlock.headers['set-cookie']).split(';')[0] }, payload: { username: 'admin', password: 'test-password-1234', settings } })
  assert.equal(setup.statusCode, 200)
  return { ...browser, cookie: String(setup.headers['set-cookie']).split(';')[0] }
}

test('browser archives resume with their original key; deleting an offline host persists without revoking shared credentials', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-management-'))
  const config = { controlToken, hostToken, origins: [origin], dataPath: join(dir, 'state.sqlite'), logger: false }
  let app = await createApp(config)
  const sockets: WebSocket[] = []
  const deviceId = randomUUID()
  const open = async (extra: Record<string, unknown> = {}, accepted = true) => {
    const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`)
    sockets.push(ws)
    await once(ws, 'open')
    const response = once(ws, accepted ? 'message' : 'close')
    ws.send(JSON.stringify({ type: 'auth', role: 'host', token: hostToken, deviceId, name: '共享电脑', kind: 'browser', ...extra }))
    const [result] = await response
    if (!accepted) { assert.equal(result, 1008); return { ws, id: '' } }
    return { ws, id: JSON.parse(result.toString()).hostId as string }
  }
  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const headers = await login(app)
    const list = async (): Promise<Host[]> => (await app.inject({ url: '/api/hosts', headers })).json().hosts
    const offline = async (ws: WebSocket, id: string) => {
      const closed = once(ws, 'close'); ws.close(); await closed
      for (let i = 0; i < 100; i++) {
        if (!(await list()).find(host => host.id === id)?.online) return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.fail('host did not go offline')
    }
    const first = await open()
    const other = await open({ deviceId: randomUUID(), name: '另一台电脑' })
    const native = await open({ deviceId: randomUUID(), name: '桌面客户端', kind: 'windows' })
    const url = `/api/manage/hosts/${first.id}`
    const remove = (override = headers) => app.inject({ method: 'DELETE', url, headers: override })
    const verify = (id = first.id, token = hostToken) => app.inject({ method: 'POST', url: '/api/auth/host-token/verify', headers, payload: { token, resumeHostId: id } })
    assert.equal((await remove()).statusCode, 409)
    assert.equal((await app.inject({ method: 'DELETE', url, headers: { ...browser, authorization: `Bearer ${controlToken}` } })).statusCode, 401)
    assert.equal((await remove({ ...headers, origin: 'https://invalid.example' })).statusCode, 403)
    assert.equal((await verify()).statusCode, 409)
    await app.inject({ method: 'PUT', url: `/api/hosts/${first.id}`, headers, payload: { group: '办公室', note: '保留备注' } })
    await app.inject({ method: 'PUT', url: `${url}/name`, headers, payload: { displayName: '浏览器屏幕' } })
    await offline(first.ws, first.id)
    assert.equal((await verify()).statusCode, 200)
    assert.equal((await verify()).json().host.name, '共享电脑')
    const foreign = (await app.inject({ method: 'POST', url: '/api/manage/tokens', headers, payload: { name: '其他密钥', scope: 'host' } })).json()
    assert.equal((await verify(first.id, foreign.value)).statusCode, 400)
    await open({ deviceId: randomUUID(), token: foreign.value, resumeHostId: first.id }, false)
    await open({ deviceId: randomUUID(), kind: 'windows', resumeHostId: first.id }, false)
    await offline(native.ws, native.id)
    assert.equal((await verify(native.id)).statusCode, 400)
    await open({ deviceId: randomUUID(), resumeHostId: native.id }, false)
    const resumed = await open({ deviceId: randomUUID(), resumeHostId: first.id })
    assert.equal(resumed.id, first.id)
    await open({ deviceId: randomUUID(), resumeHostId: first.id }, false)
    const host = (await list()).find(host => host.id === first.id)!
    assert.equal(host.online, true); assert.equal(host.group, '办公室'); assert.equal(host.note, '保留备注'); assert.equal(host.name, '浏览器屏幕')
    assert.equal((await list()).length, 3)
    await offline(resumed.ws, first.id)
    assert.equal((await remove()).statusCode, 204)
    assert.equal((await remove()).statusCode, 404)
    assert.equal((await list()).some(host => host.id === first.id), false)
    assert.equal((await list()).find(host => host.id === other.id)!.online, true)
    assert.equal((await verify()).statusCode, 400)
    await open({ resumeHostId: first.id }, false)
    await offline(other.ws, other.id)
    await app.close(); app = await createApp(config); await app.listen({ host: '127.0.0.1', port: 0 })
    assert.equal((await list()).some(host => host.id === first.id), false)
    const rejoined = await open()
    assert.equal(rejoined.id, first.id)
    const fresh = (await list()).find(host => host.id === first.id)!
    assert.equal(fresh.group, ''); assert.equal(fresh.note, ''); assert.equal(fresh.name, '共享电脑')
    const audit = (await app.inject({ url: '/api/manage/audit', headers })).json()
    assert.ok(audit.events.some((event: { action: string }) => event.action === 'host.delete'))
    assert.ok(!JSON.stringify(audit).includes(hostToken))
  } finally {
    sockets.forEach(ws => ws.terminate())
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('audit pages cover retained history and keep a stable boundary when new events arrive', () => {
  const store = new Store(':memory:', { controlToken, hostToken })
  try {
    for (let i = 0; i < 125; i++) store.audit('admin', 'test.event', String(i))
    assert.equal(store.events().events.length, 50)
    const first = store.events(1, 20)
    assert.equal(first.total, 125); assert.equal(first.totalPages, 7)
    store.audit('admin', 'new.event', 'newest')
    const second = store.events(2, 20, first.snapshot)
    assert.equal(second.total, 125)
    const ids = (page: ReturnType<Store['events']>) => page.events.map(event => Number(event.id))
    assert.deepEqual(ids(first), Array.from({ length: 20 }, (_, i) => 125 - i))
    assert.deepEqual(ids(second), Array.from({ length: 20 }, (_, i) => 105 - i))
    const last = store.events(999, 20, first.snapshot)
    assert.equal(last.page, 7); assert.equal(last.events.length, 5)
    for (let i = 0; i < 1000; i++) store.audit('admin', 'test.event', String(i))
    const newest = store.events(1, 100)
    assert.equal(newest.total, 1000); assert.equal(newest.totalPages, 10)
    const all = Array.from({ length: 10 }, (_, i) => ids(store.events(i + 1, 100, newest.snapshot))).flat()
    assert.equal(new Set(all).size, 1000)
    const empty = store.events(1, 20, 0)
    assert.equal(empty.total, 0); assert.equal(empty.totalPages, 1); assert.deepEqual(empty.events, [])
  } finally { store.close() }
})

test('audit API validates pagination and restricts access to administrator sessions', async () => {
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false })
  try {
    const headers = await login(app)
    const page = (await app.inject({ url: '/api/manage/audit?page=1&pageSize=20', headers })).json()
    assert.equal(page.pageSize, 20); assert.equal(page.retentionLimit, 1000); assert.ok(page.total > 0)
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=wat', 'pageSize=101', 'pageSize=0', 'snapshot=-1']) {
      assert.equal((await app.inject({ url: `/api/manage/audit?${query}`, headers })).statusCode, 400, query)
    }
    assert.equal((await app.inject({ url: '/api/manage/audit', headers: { authorization: `Bearer ${controlToken}` } })).statusCode, 401)
  } finally { await app.close() }
})
