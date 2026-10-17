import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createApp } from './server.js'

const controlToken = 'c'.repeat(64), hostToken = 'h'.repeat(64)
const origin = 'http://localhost:5173'
const headers = { authorization: `Bearer ${controlToken}`, 'x-remote-request': '1' }
const message = (ws: WebSocket) => once(ws, 'message').then(([raw]) => JSON.parse(raw.toString()))
test('stable device identity, status validation, metadata and tool authorization', { timeout: 30000 }, async () => {
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`
  const clients: WebSocket[] = []
  const deviceId = randomUUID()
  const register = async () => {
    const ws = new WebSocket(url); clients.push(ws); await once(ws, 'open')
    const ready = message(ws)
    ws.send(JSON.stringify({ type: 'auth', role: 'host', name: 'device', kind: 'linux-x11', token: hostToken, deviceId, features: { terminal: true, files: true, clipboard: true, audio: false } }))
    return { ws, hostId: (await ready).hostId }
  }
  try {
    const first = await register()
    assert.equal((await app.inject({ method: 'PUT', url: `/api/hosts/${first.hostId}`, headers, payload: { group: '办公室', note: '测试电脑' } })).statusCode, 200)
    const closed = once(first.ws, 'close'); first.ws.close(); await closed
    await new Promise(resolve => setTimeout(resolve, 30))
    const second = await register(); assert.equal(second.hostId, first.hostId)
    const stats = { cpu: 25, memoryUsed: 100, memoryTotal: 200, diskUsed: 300, diskTotal: 400, uptime: 50, platform: 'Linux', version: '0.2.0', encoder: 'idle' }
    second.ws.send(JSON.stringify({ type: 'stats', stats }))
    await new Promise(resolve => setTimeout(resolve, 30))
    let host = (await app.inject({ url: '/api/hosts', headers })).json().hosts[0]
    assert.equal(host.group, '办公室'); assert.equal(host.stats.cpu, 25); assert.equal(host.capabilities.textInput, 'unicode')
    second.ws.send(JSON.stringify({ type: 'stats', stats: { ...stats, cpu: -1 } }))
    await new Promise(resolve => setTimeout(resolve, 30))
    host = (await app.inject({ url: '/api/hosts', headers })).json().hosts[0]
    assert.equal(host.stats.cpu, 25)
    assert.equal((await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { hostId: first.hostId, mode: 'tools' } })).statusCode, 403)
    const unlocked = await app.inject({ method: 'POST', url: '/api/auth/setup/unlock', headers, payload: { key: controlToken } })
    const setupCookie = unlocked.headers['set-cookie']!.toString().split(';')[0]
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup/complete', headers: { ...headers, cookie: setupCookie }, payload: { username: 'admin', password: 'test-password-1234', settings: { workspaceName: 'Test', defaultQuality: 'responsive', sessionMinutes: 15, stunUrl: '', turnUrl: '' } } })
    assert.equal(setup.statusCode, 200)
    const cookie = setup.headers['set-cookie']!.toString().split(';')[0]
    const reserved = await app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie, 'x-remote-request': '1' }, payload: { hostId: first.hostId, mode: 'tools' } })
    assert.equal(reserved.statusCode, 201)
    const session = reserved.json().session
    assert.equal(session.tools, true); assert.equal(session.mode, 'tools')
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}`, headers })).statusCode, 403)
    const controller = new WebSocket(url, { origin, headers: { cookie } }); clients.push(controller); await once(controller, 'open')
    const invitation = message(second.ws)
    controller.send(JSON.stringify({ type: 'auth', role: 'controller', token: '', sessionId: session.id }))
    assert.equal((await invitation).session.mode, 'tools')
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}`, headers: { cookie, 'x-remote-request': '1' } })).statusCode, 204)
  } finally { for (const ws of clients) ws.terminate(); await app.close() }
})
