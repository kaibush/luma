"""Receive real packaged-agent video and exercise input on an isolated Xvfb."""
import asyncio
import json
import os
from pathlib import Path
import time
import urllib.request

import websockets
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration

BASE = os.environ['TEST_API']
TOKEN = os.environ['TEST_CONTROL_TOKEN']
META = json.loads(os.environ['TEST_FIXTURE'])

def request(path, body=None):
    req = urllib.request.Request(BASE + '/api' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as response: return json.load(response)

async def until(check, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = check()
        if result: return result
        await asyncio.sleep(.1)
    raise AssertionError('Timed out waiting for expected state')

def events():
    path = Path(os.environ['FIXTURE_OUTPUT'])
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

async def main():
    hosts = await until(lambda: request('/hosts')['hosts'])
    assert hosts[0]['kind'] == 'linux-x11'
    result = request('/sessions', {'hostId': hosts[0]['id'], 'quality': 'responsive'})
    session_id = result['session']['id']
    pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    pc.addTransceiver('video', direction='recvonly')
    channel = pc.createDataChannel('input')
    received = asyncio.Event()
    @pc.on('track')
    def track(track):
        async def receive():
            frame = await track.recv()
            rgb = frame.reformat(format='rgb24')
            x, y = round(150 / META['width'] * rgb.width), round(150 / META['height'] * rgb.height)
            raw = bytes(rgb.planes[0]); offset = y * rgb.planes[0].line_size + x * 3
            r, g, b = raw[offset:offset + 3]
            assert b > r + 30 and g > r + 15, (r, g, b)
            received.set()
        asyncio.create_task(receive())
    try:
        async with websockets.connect(BASE.replace('http:', 'ws:') + '/ws') as ws:
            await ws.send(json.dumps({'type': 'auth', 'role': 'controller', 'token': TOKEN, 'sessionId': session_id}))
            async for raw in ws:
                message = json.loads(raw)
                if message['type'] == 'ready':
                    offer = await pc.createOffer(); await pc.setLocalDescription(offer)
                    await ws.send(json.dumps({'type': 'offer', 'sessionId': session_id, 'sdp': pc.localDescription.sdp}))
                elif message['type'] == 'answer':
                    await pc.setRemoteDescription(RTCSessionDescription(type='answer', sdp=message['sdp']))
                    break
            await asyncio.wait_for(received.wait(), 25)
            await until(lambda: channel.readyState == 'open')
            def send(event): channel.send(json.dumps(event))
            send({'type': 'button', 'button': 'left', 'down': True, 'x': 300 / META['width'], 'y': 210 / META['height']})
            send({'type': 'button', 'button': 'left', 'down': False, 'x': 300 / META['width'], 'y': 210 / META['height']})
            send({'type': 'text', 'text': 'abc123'})
            send({'type': 'key', 'code': 'ControlLeft', 'down': True})
            await until(lambda: any(e['type'] == 2 and e['detail'] == META['control'] for e in events()))
        await until(lambda: any(e['type'] == 3 and e['detail'] == META['control'] for e in events()))
        trace = events()
        assert any(e['type'] == 4 and e['detail'] == 1 for e in trace)
        assert any(e['type'] == 2 and e['detail'] == META['keyA'] for e in trace)
        assert len([e for e in trace if e['type'] == 2]) >= 7
        print('PASS packaged Linux agent: registration, actual video pixels, mouse/text/keys, disconnect releases modifiers')
    finally: await pc.close()

asyncio.run(main())
