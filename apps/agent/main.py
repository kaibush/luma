"""Persistent Linux X11 host using the same signaling protocol as BrowserHost."""
import asyncio
import json
import logging
import os
import signal
import time

import websockets
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.sdp import candidate_from_sdp
from desktop import DesktopInput, DesktopVideo

logging.basicConfig(level=logging.WARNING, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('remote-agent')
log.setLevel(logging.INFO)


class Agent:
    def __init__(self):
        self.pc = None
        self.track = None
        self.input = None
        self.session = None
        self.session_task = None
        self.ws = None
        self.count = 0
        self.window = time.monotonic()
        self.queue = asyncio.Queue(maxsize=128)
        self.motion = None

    async def send(self, message):
        await self.ws.send(json.dumps(message))

    async def stop_session(self):
        self.session = None
        if self.session_task:
            self.session_task.cancel()
            self.session_task = None
        if self.input:
            self.input.release()
        if self.pc:
            await self.pc.close()
            self.pc = None
        if self.track:
            self.track.stop()
            self.track = None
        if self.input:
            self.input.close()
            self.input = None
        self.motion = None
        while not self.queue.empty(): self.queue.get_nowait()

    async def start_session(self, message):
        await self.stop_session()
        self.input = DesktopInput()
        self.session = message['session']['id']
        self.track = DesktopVideo(message['session']['quality'])
        ice = [RTCIceServer(**server) for server in message['iceServers']]
        self.pc = pc = RTCPeerConnection(RTCConfiguration(iceServers=ice))
        pc.addTrack(self.track)
        session_id = self.session

        @pc.on('connectionstatechange')
        async def state():
            log.info('Peer state: %s', pc.connectionState)
            if pc.connectionState in ('closed', 'failed', 'disconnected') and self.input:
                self.input.release()
            if pc.connectionState == 'failed' and self.session == session_id:
                await self.send({'type': 'end', 'sessionId': session_id})

        @pc.on('datachannel')
        def channel_open(channel):
            if channel.label not in ('input', 'motion'):
                channel.close()
                return

            @channel.on('message')
            def receive(raw):
                if self.session != session_id or not isinstance(raw, str) or len(raw) > 8192: return
                now = time.monotonic()
                if now - self.window > 1: self.window = now; self.count = 0
                self.count += 1
                if self.count > 500:
                    if self.input: self.input.release()
                    channel.close()
                    return
                try:
                    event = json.loads(raw)
                    if not isinstance(event, dict): return
                    if channel.label == 'motion':
                        if event.get('type') == 'move': self.motion = event
                    else:
                        if event.get('type') == 'button': self.motion = None
                        self.queue.put_nowait(event)
                except (ValueError, asyncio.QueueFull):
                    if self.input: self.input.release()
                    channel.close()

            @channel.on('close')
            def closed():
                if self.input: self.input.release()

        async def input_loop():
            while self.session == session_id:
                for _ in range(32):
                    if self.queue.empty(): break
                    event = self.queue.get_nowait()
                    try: self.input.apply(event)
                    except (ValueError, TypeError, OverflowError): pass
                if self.motion:
                    event, self.motion = self.motion, None
                    try: self.input.apply(event)
                    except (ValueError, TypeError, OverflowError): pass
                await asyncio.sleep(1 / 120)

        self.session_task = asyncio.create_task(input_loop())
        def input_done(task):
            if not task.cancelled() and task.exception() and self.session == session_id:
                log.warning('Input worker failed; resetting host connection')
                asyncio.create_task(self.ws.close())
        self.session_task.add_done_callback(input_done)
        await self.send({'type': 'ready', 'sessionId': self.session})

    async def run(self):
        retry = 1
        while True:
            try:
                # Verify the desktop is accessible before advertising it as online.
                probe = DesktopInput(); probe.close()
                async with websockets.connect(os.environ.get('SIGNAL_URL', 'ws://127.0.0.1:8798/ws'), max_size=65536, ping_interval=20, open_timeout=10) as ws:
                    self.ws = ws
                    await self.send({'type': 'auth', 'role': 'host', 'token': os.environ['HOST_TOKEN'], 'name': os.environ.get('HOST_NAME', '本机 Linux 桌面'), 'kind': 'linux-x11'})
                    async for raw in ws:
                        message = json.loads(raw)
                        kind = message['type']
                        if kind == 'ready':
                            retry = 1
                            log.info('Desktop registered on DISPLAY=%s', os.environ.get('DISPLAY'))
                        elif kind == 'session':
                            await self.start_session(message)
                        elif kind in ('ended', 'end'):
                            await self.stop_session()
                        elif self.pc and message.get('sessionId') == self.session:
                            if kind == 'offer':
                                await self.pc.setRemoteDescription(RTCSessionDescription(sdp=message['sdp'], type='offer'))
                                answer = await self.pc.createAnswer()
                                await self.pc.setLocalDescription(answer)
                                await self.send({'type': 'answer', 'sessionId': self.session, 'sdp': self.pc.localDescription.sdp})
                            elif kind == 'ice' and message['candidate'].get('candidate'):
                                raw_candidate = message['candidate']
                                candidate = candidate_from_sdp(raw_candidate['candidate'].removeprefix('candidate:'))
                                candidate.sdpMid = raw_candidate.get('sdpMid')
                                candidate.sdpMLineIndex = raw_candidate.get('sdpMLineIndex')
                                await self.pc.addIceCandidate(candidate)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning('Host reconnecting (%s)', type(error).__name__)
            finally:
                await self.stop_session()
            await asyncio.sleep(retry)
            retry = min(retry * 2, 15)


async def main():
    agent = Agent()
    task = asyncio.create_task(agent.run())
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, task.cancel)
    try: await task
    except asyncio.CancelledError: pass


if __name__ == '__main__':
    asyncio.run(main())
