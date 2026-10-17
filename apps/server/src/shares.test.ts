import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createApp } from './server.js'

const controlToken = 'c'.repeat(64), hostToken = 'h'.repeat(64), origin = 'http://localhost:5173';
const message = (ws: WebSocket) => once(ws, 'message').then(([raw]) => JSON.parse(raw.toString()));
async function setup(app: Awaited<ReturnType<typeof createApp>>) {
  const headers = { 'x-remote-request': '1' };
  const unlocked = await app.inject({ method: 'POST', url: '/api/auth/setup/unlock', headers, payload: { key: controlToken } });
  const result = await app.inject({ method: 'POST', url: '/api/auth/setup/complete', headers: { ...headers, cookie: unlocked.headers['set-cookie']!.toString().split(';')[0] }, payload: { username: 'admin', password: 'test-password-1234', settings: { workspaceName: 'Test', defaultQuality: 'balanced', sessionMinutes: 15, stunUrl: '', turnUrl: '' } } });
  assert.equal(result.statusCode, 200);
  return { ...headers, cookie: result.headers['set-cookie']!.toString().split(';')[0] };
}
test('guest links are isolated, read-only, single-use tickets and revoked immediately', { timeout: 30000 }, async () => {
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `ws://127.0.0.1:${(app.server.address() as {port: number}).port}/share-ws`;
  const sockets: WebSocket[] = [];
  const socket = async (cookie?: string) => { const ws = new WebSocket(url, { origin, headers: cookie ? { cookie } : {} }); sockets.push(ws); await once(ws, 'open'); return ws; };
  try {
    const headers = await setup(app);
    assert.equal((await app.inject('/api/manage/shares')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/manage/shares', headers: { authorization: `Bearer ${controlToken}` } })).statusCode, 401);
    const created = await app.inject({ method: 'POST', url: '/api/manage/shares', headers, payload: { name: 'Demo' } });
    assert.equal(created.statusCode, 201);
    const { share } = created.json(); assert.equal(share.key.length, 43);
    const join = (key: string) => app.inject({ method: 'POST', url: `/api/public/shares/${share.id}/join`, payload: { key } });
    assert.equal((await join('wrong-key-123456789')).statusCode, 403);
    assert.equal((await join(share.key)).statusCode, 409);
    const badPublisher = await socket(); const denied = once(badPublisher, 'close');
    badPublisher.send(JSON.stringify({ type: 'auth', role: 'publisher', shareId: share.id })); assert.equal((await denied)[0], 1008);
    const publisher = await socket(headers.cookie), registered = message(publisher);
    publisher.send(JSON.stringify({ type: 'auth', role: 'publisher', shareId: share.id })); assert.equal((await registered).type, 'ready');
    const admission = await join(share.key); assert.equal(admission.statusCode, 200);
    const ticket = admission.json().ticket;
    const guest = await socket(), invitation = message(publisher), sessionMessage = message(guest);
    guest.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket }));
    const session = (await sessionMessage).session; assert.equal((await invitation).session.id, session.id);
    const replay = await socket(), replayDenied = once(replay, 'close');
    replay.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket })); assert.equal((await replayDenied)[0], 1008);
    const ready = message(guest); publisher.send(JSON.stringify({ type: 'ready', sessionId: session.id })); assert.equal((await ready).type, 'ready');
    const rejectedChannel = once(guest, 'close');
    guest.send(JSON.stringify({ type: 'offer', sessionId: session.id, sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' }));
    assert.equal((await rejectedChannel)[0], 1008);
    await new Promise(resolve => setTimeout(resolve, 30));
    const guest2 = await socket(), invitation2 = message(publisher), session2 = message(guest2);
    const ticket2 = (await join(share.key)).json().ticket;
    guest2.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket: ticket2 }));
    const sid = (await session2).session.id; await invitation2;
    const ready2 = message(guest2); publisher.send(JSON.stringify({ type: 'ready', sessionId: sid })); await ready2;
    const forward = message(publisher);
    guest2.send(JSON.stringify({ type: 'offer', sessionId: sid, sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' })); assert.equal((await forward).type, 'offer');
    const revoked = message(guest2);
    const changed = await app.inject({ method: 'POST', url: `/api/manage/shares/${share.id}/rotate`, headers, payload: { key: 'new-private-sharing-key' } });
    assert.equal(changed.statusCode, 200); assert.match((await revoked).reason, /密钥已更换/);
    assert.equal((await join(share.key)).statusCode, 403);
    assert.equal(publisher.readyState, WebSocket.OPEN);
    const newKey = changed.json().share.key;
    const admitted = (await join(newKey)).json().ticket;
    const stopped = message(publisher);
    assert.equal((await app.inject({ method: 'POST', url: `/api/manage/shares/${share.id}/stop`, headers })).statusCode, 200);
    // A per-viewer ended message from rotation may precede the whole-share stop.
    let event = await stopped; if (event.sessionId) event = await message(publisher);
    assert.equal(event.type, 'ended');
    assert.equal((await join(newKey)).statusCode, 403);
    const stale = await socket(), staleDenied = once(stale, 'close');
    stale.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket: admitted })); assert.equal((await staleDenied)[0], 1008);
    const enabled = await app.inject({ method: 'POST', url: `/api/manage/shares/${share.id}/enable`, headers });
    assert.notEqual(enabled.json().share.key, newKey);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/manage/shares/${share.id}`, headers })).statusCode, 204);
    assert.equal((await app.inject({ url: '/api/manage/shares', headers })).json().shares.length, 0);
    assert.equal((await join(enabled.json().share.key)).statusCode, 403);
  } finally { for (const ws of sockets) ws.terminate(); await app.close(); }
});

test('share keys survive restart encrypted at rest, not exposed by anonymous APIs', async () => {
  const directory = mkdtempSync(`${tmpdir()}/screen-share-store-`), dataPath = `${directory}/control.sqlite`;
  let app = await createApp({ controlToken, hostToken, origins: [origin], logger: false, dataPath });
  try {
    const headers = await setup(app);
    const share = (await app.inject({ method: 'POST', url: '/api/manage/shares', headers, payload: { name: 'Persistent' } })).json().share;
    await app.close();
    assert.equal(readFileSync(dataPath).includes(Buffer.from(share.key)), false);
    app = await createApp({ controlToken, hostToken, origins: [origin], logger: false, dataPath });
    const list = (await app.inject({ url: '/api/manage/shares', headers })).json().shares;
    assert.equal(list[0].key, share.key); assert.equal(list[0].online, false);
    assert.equal((await app.inject({ url: `/api/public/shares/${share.id}` })).statusCode, 401);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('share expiry disconnects viewers and publisher, rejects tickets, and renewal changes key', { timeout: 15000 }, async () => {
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false });
  const sockets: WebSocket[] = [];
  try {
    const headers = await setup(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/share-ws`;
    const socket = async (cookie?: string) => { const ws = new WebSocket(url, { origin, headers: cookie ? { cookie } : {} }); sockets.push(ws); await once(ws, 'open'); return ws; };
    assert.equal((await app.inject({ method: 'POST', url: '/api/manage/shares', headers, payload: { name: 'Past', expiresAt: Date.now() - 1 } })).statusCode, 400);
    const share = (await app.inject({ method: 'POST', url: '/api/manage/shares', headers, payload: { name: 'Timed', expiresAt: Date.now() + 60000 } })).json().share;
    assert.ok(share.expiresAt > Date.now());
    const expiry = `/api/manage/shares/${share.id}/expiry`;
    assert.equal((await app.inject({ method: 'POST', url: expiry, payload: { expiresAt: null } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: expiry, headers, payload: { expiresAt: -1 } })).statusCode, 400);
    const pub = await socket(headers.cookie), ready = message(pub);
    pub.send(JSON.stringify({ type: 'auth', role: 'publisher', shareId: share.id })); await ready;
    const join = () => app.inject({ method: 'POST', url: `/api/public/shares/${share.id}/join`, payload: { key: share.key } });
    const ticket = (await join()).json().ticket;
    const viewer = await socket(), invitation = message(pub), session = message(viewer);
    viewer.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket })); await session; await invitation;
    const staleTicket = (await join()).json().ticket;
    const ended = message(viewer), pubClosed = once(pub, 'close');
    assert.equal((await app.inject({ method: 'POST', url: expiry, headers, payload: { expiresAt: Date.now() + 100 } })).statusCode, 200);
    assert.match((await ended).reason, /到期/); await pubClosed;
    assert.equal((await join()).statusCode, 403);
    const stale = await socket(), denied = once(stale, 'close');
    stale.send(JSON.stringify({ type: 'auth', role: 'viewer', ticket: staleTicket })); assert.equal((await denied)[0], 1008);
    assert.equal((await app.inject({ method: 'POST', url: `/api/manage/shares/${share.id}/enable`, headers })).statusCode, 400);
    const renewed = (await app.inject({ method: 'POST', url: expiry, headers, payload: { expiresAt: null } })).json().share;
    assert.equal(renewed.expiresAt, null); assert.notEqual(renewed.key, share.key);
    assert.equal((await app.inject({ method: 'POST', url: `/api/manage/shares/${share.id}/enable`, headers })).statusCode, 200);
    assert.equal((await join()).statusCode, 403);
  } finally { for (const ws of sockets) ws.terminate(); await app.close(); }
});

test('remote sharing binds to host and server-side permission, revokes tickets on edits', { timeout: 20000 }, async () => {
  const app = await createApp({ controlToken, hostToken, origins: [origin], logger: false });
  const sockets: WebSocket[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `ws://127.0.0.1:${(app.server.address() as {port: number}).port}`;
    const socket = async (path: string) => { const ws = new WebSocket(base + path, {origin}); sockets.push(ws); await once(ws, 'open'); return ws; };
    const host = await socket('/ws'), registered = message(host);
    host.send(JSON.stringify({type:'auth',role:'host',token:hostToken,name:'Remote',kind:'linux-x11',features:{terminal:true,files:true,audio:false,clipboard:false,remoteSharing:true}}));
    const hostId = (await registered).hostId;
    const headers = await setup(app);
    const create = await app.inject({method:'POST',url:'/api/manage/shares',headers,payload:{name:'Shared host',hostId,key:'code123',permission:'control'}});
    assert.equal(create.statusCode,201); const share = create.json().share;
    assert.equal(share.hostId,hostId); assert.equal(share.permission,'control'); assert.equal(share.key,'code123');
    const join = () => app.inject({method:'POST',url:`/api/public/shares/${share.id}/join`,payload:{key:'code123',tools:true,readOnly:false}});
    const first = (await join()).json().ticket, stale = (await join()).json().ticket;
    const guest = await socket('/share-ws'), offered = message(host), admitted = message(guest);
    guest.send(JSON.stringify({type:'auth',role:'viewer',ticket:first}));
    const session = (await admitted).session;
    assert.equal((await offered).session.id,session.id); assert.equal(session.readOnly,false); assert.equal(session.tools,false);
    const ready = message(guest); host.send(JSON.stringify({type:'ready',sessionId:session.id})); await ready;
    const forwarded = message(host); guest.send(JSON.stringify({type:'offer',sessionId:session.id,sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'})); assert.equal((await forwarded).type,'offer');
    const revoked = message(guest), hostEnd = message(host);
    assert.equal((await app.inject({method:'POST',url:`/api/manage/shares/${share.id}/permission`,headers,payload:{permission:'view'}})).statusCode,200);
    assert.match((await revoked).reason,/权限/); assert.equal((await hostEnd).sessionId,session.id);
    const replay = await socket('/share-ws'), rejected = once(replay,'close'); replay.send(JSON.stringify({type:'auth',role:'viewer',ticket:stale})); assert.equal((await rejected)[0],1008);
    const guest2 = await socket('/share-ws'), session2 = message(guest2), host2 = message(host);
    guest2.send(JSON.stringify({type:'auth',role:'viewer',ticket:(await join()).json().ticket,readOnly:false}));
    const read = (await session2).session; await host2; assert.equal(read.readOnly,true); assert.equal(read.tools,false);
    const ready2 = message(guest2); host.send(JSON.stringify({type:'ready',sessionId:read.id})); await ready2;
    const denied = once(guest2,'close'); guest2.send(JSON.stringify({type:'offer',sessionId:read.id,sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'})); assert.equal((await denied)[0],1008);
    const count = (await app.inject({url:'/api/manage/shares',headers})).json().shares;
    assert.equal(count[0].key,'code123');
  } finally { for (const ws of sockets) ws.terminate(); await app.close(); }
});
