import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHmac, randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createApp } from './server.js'

const controlToken = 'c'.repeat(64), hostToken = 'h'.repeat(64)
const headers = { authorization: `Bearer ${controlToken}` }
const message = (ws: WebSocket) => once(ws, 'message').then(([raw]) => JSON.parse(raw.toString()))

test('authentication, exclusive sessions, signal routing, disconnect cleanup', { timeout: 15000 }, async () => {
  const app = await createApp({ controlToken, hostToken, origins: ['http://localhost:5173'], logger: false, turnUrl: 'turn:localhost:3478', turnSecret: 'test-secret' })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as {port: number}
  const url = `ws://127.0.0.1:${address.port}/ws`
  const clients: WebSocket[] = []
  try {
    assert.equal((await app.inject('/api/hosts')).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/hosts', headers: {authorization: `Bearer ${hostToken}`} })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: {} })).statusCode, 400)
    const invalid = new WebSocket(url); clients.push(invalid); await once(invalid, 'open')
    const denied = once(invalid, 'close'); invalid.send(JSON.stringify({type: 'auth', role: 'host', name: 'test', token: controlToken})); assert.equal((await denied)[0], 1008)
    const host = new WebSocket(url); clients.push(host); await once(host, 'open')
    const registered = message(host); host.send(JSON.stringify({type: 'auth', role: 'host', name: 'test', token: hostToken}))
    const {hostId} = await registered
    assert.equal((await app.inject({url: '/api/hosts', headers})).json().hosts[0].capabilities.systemInput, false)
    const reservation = await app.inject({method: 'POST', url: '/api/sessions', headers, payload: {hostId, quality: 'responsive'}})
    assert.equal(reservation.statusCode, 201)
    const { session, iceServers } = reservation.json()
    assert.equal(iceServers[0].urls, 'turn:localhost:3478')
    assert.equal(iceServers[1].urls, 'turn:localhost:3478?transport=tcp')
    assert.equal(iceServers[1].credential, iceServers[0].credential)
    assert.equal(iceServers[1].username, iceServers[0].username)
    assert.equal(iceServers[0].credential, createHmac('sha1', 'test-secret').update(iceServers[0].username).digest('base64'))
    const expiry = Number(iceServers[0].username.split(':')[0])
    assert.ok(expiry > Date.now() / 1000 + 4 * 3600 && expiry <= Date.now() / 1000 + 5 * 3600)
    assert.equal((await app.inject({method: 'POST', url: '/api/sessions', headers, payload: {hostId}})).statusCode, 409)
    const controller = new WebSocket(url); clients.push(controller); await once(controller, 'open')
    const invited = message(host); controller.send(JSON.stringify({type: 'auth', role: 'controller', token: controlToken, sessionId: session.id}))
    assert.equal((await invited).session.id, session.id)
    const ready = message(controller); host.send(JSON.stringify({type: 'ready', sessionId: session.id})); assert.equal((await ready).type, 'ready')
    controller.send(JSON.stringify({type: 'offer', sdp: 'stale-session', sessionId: randomUUID()}))
    const offer = message(host); controller.send(JSON.stringify({type: 'offer', sdp: 'test-offer', sessionId: session.id})); assert.equal((await offer).sdp, 'test-offer')
    const answer = message(controller); host.send(JSON.stringify({type: 'answer', sdp: 'test-answer', sessionId: session.id})); assert.equal((await answer).sdp, 'test-answer')
    const ended = message(host); controller.close(); assert.equal((await ended).type, 'ended')
    assert.equal((await app.inject({url: '/api/hosts', headers})).json().hosts[0].busy, false)
    const closed = once(host, 'close'); host.close(); await closed
    // Closing TCP can precede the server's close event by one event-loop turn.
    for (let i = 0; i < 20; i++) {
      if ((await app.inject({url: '/api/hosts', headers})).json().hosts.length === 0) break
      await new Promise(r => setTimeout(r, 10))
    }
    assert.deepEqual((await app.inject({url: '/api/hosts', headers})).json().hosts, [])
  } finally { clients.forEach(ws => ws.terminate()); await app.close() }
})

test('session creation requires controller authentication', async () => {
  const app = await createApp({controlToken, hostToken, origins: [], logger: false, turnUrl: 'turn:localhost:3478', turnSecret: 'test-secret'})
  try { assert.equal((await app.inject({method: 'POST', url: '/api/sessions', payload: {hostId: 'x'}})).statusCode, 401) }
  finally { await app.close() }
})
