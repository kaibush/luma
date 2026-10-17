"""Persistent Linux X11 host using the same signaling protocol as BrowserHost."""
import asyncio
import argparse
import sys
import json
import logging
import os
import signal
import time

import websockets
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.sdp import candidate_from_sdp
from aiortc.codecs import h264
if sys.platform == 'win32':
    from windows_input import enable_dpi_awareness
    enable_dpi_awareness()
from desktop import DesktopInput, DesktopVideo
from host_tools import HostTools, features, device_stats
from client_config import device_id
import media
media.install_encoder()

# aiortc 1.14 defaults to a 1/30 encoder time base, which collapses 60 FPS
# timestamps. Use 1/60 for all profiles, including 30 FPS sessions.
h264.MAX_FRAME_RATE = 60

logging.basicConfig(level=logging.WARNING, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('remote-agent')
log.setLevel(logging.INFO)


class Agent:
    def __init__(self):
        self.children = {}
        self.tools = None
        self.audio = None
        self.pc = None
        self.track = None
        self.input = None
        self.session = None
        self.session_task = None
        self.ws = None
        self.protocol = 0
        self.count = 0
        self.window = time.monotonic()
        self.queue = asyncio.Queue(maxsize=128)
        self.motion = None

    async def send(self, message):
        await self.ws.send(json.dumps(message))

    async def stop_session(self):
        self.session = None
        if self.tools:
            await self.tools.close(); self.tools = None
        if self.audio:
            self.audio.stop(); self.audio = None
        if self.session_task:
            self.session_task.cancel()
            await asyncio.gather(self.session_task, return_exceptions=True)
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
        log.info('正在建立远程桌面会话')
        desktop = message['session'].get('mode', 'desktop') == 'desktop'
        read_only = message['session'].get('readOnly', False)
        self.input = DesktopInput() if desktop and not read_only else None
        self.session = message['session']['id']
        self.track = DesktopVideo(message['session']['quality']) if desktop else None
        ice = [RTCIceServer(**server) for server in message['iceServers']]
        self.pc = pc = RTCPeerConnection(RTCConfiguration(iceServers=ice))
        if self.track:
            media.BITRATE_LIMIT = self.track.profile['maxBitrate']
            pc.addTrack(self.track)
        if desktop and message['session'].get('audio') and features()['audio']:
            self.audio = media.SystemAudio(); pc.addTrack(self.audio)
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
            if read_only:
                channel.close(); return
            if channel.label == 'tools' and not self.tools and message['session'].get('tools'):
                self.tools = HostTools(channel, features()); return
            if channel.label not in ('input', 'motion') or not desktop:
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
                    try:
                        if event.get('type') == 'feedback' and self.track:
                            self.track.feedback(event)
                        elif sys.platform != 'win32' and event.get('type') == 'text' and features()['clipboard'] and isinstance(event.get('text'), str) and any(ord(c) > 127 for c in event['text']) and len(event['text']) <= 2048:
                            import pyperclip
                            await asyncio.to_thread(pyperclip.copy, event['text'])
                            self.input.release()
                            for code, down in [('ControlLeft', True), ('KeyV', True), ('KeyV', False), ('ControlLeft', False)]: self.input.apply(dict(type='key', code=code, down=down))
                        else: self.input.apply(event)
                    except (ValueError, TypeError, OverflowError, RuntimeError): pass
                if self.motion:
                    event, self.motion = self.motion, None
                    try: self.input.apply(event)
                    except (ValueError, TypeError, OverflowError, RuntimeError): pass
                await asyncio.sleep(1 / 120)

        self.session_task = asyncio.create_task(input_loop())
        def input_done(task):
            if not task.cancelled() and task.exception() and self.session == session_id:
                log.warning('Input worker failed; resetting host connection')
                asyncio.create_task(self.ws.close())
        self.session_task.add_done_callback(input_done)
        await self.send({'type': 'ready', 'sessionId': self.session})

    async def run(self):
        self.retry = 1
        while True:
            try:
                # Verify the desktop is accessible before advertising it as online.
                probe = DesktopInput(); probe.close()
                async with websockets.connect(os.environ.get('SIGNAL_URL', 'ws://127.0.0.1:8798/ws'), max_size=65536, ping_interval=20, open_timeout=10) as ws:
                    self.ws = ws
                    self.protocol = 0
                    await self.send({'type': 'auth', 'role': 'host', 'token': os.environ['HOST_TOKEN'], 'name': os.environ.get('HOST_NAME', '本机 Linux 桌面'), 'kind': 'windows' if sys.platform == 'win32' else 'linux-x11', 'deviceId': device_id(), 'features': {**features(), 'remoteSharing': True}})
                    async def report_stats():
                        while True:
                            if self.protocol >= 2:
                                stats = await asyncio.to_thread(device_stats, media.ENCODER if self.track or any(c.track for c in self.children.values()) else 'idle')
                                await ws.send(json.dumps(dict(type='stats', stats=stats)))
                            await asyncio.sleep(5)
                    reporter = asyncio.create_task(report_stats())
                    try:
                        await self.receive_messages(ws)
                    finally:
                        reporter.cancel(); await asyncio.gather(reporter, return_exceptions=True)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning('连接断开，正在重试；请检查网络、主机密钥和桌面会话 (%s)', type(error).__name__)
            finally:
                for child in list(self.children.values()): await child.stop_session()
                self.children.clear()
                await self.stop_session()
            await asyncio.sleep(self.retry)
            self.retry = min(self.retry * 2, 15)

    async def receive_messages(self, ws):
        async for raw in ws:
            message = json.loads(raw)
            kind = message['type']
            if kind == 'ready':
                self.protocol = message.get('protocol', 0)
                self.retry = 1
                log.info('在线，等待远程连接')
            elif kind == 'session':
                sid = message['session']['id']
                if sid in self.children: continue
                if len(self.children) >= 4:
                    await self.send({'type': 'end', 'sessionId': sid}); continue
                child = Agent(); child.ws = ws
                self.children[sid] = child
                try: await child.start_session(message)
                except Exception:
                    self.children.pop(sid, None)
                    await child.stop_session()
                    await self.send({'type': 'end', 'sessionId': sid})
            elif kind in ('ended', 'end'):
                sid = message.get('sessionId')
                targets = [sid] if sid else list(self.children)
                for target in targets:
                    child = self.children.pop(target, None)
                    if child: await child.stop_session()
            else:
                child = self.children.get(message.get('sessionId'))
                if child and child.pc:
                    try: await child.handle_signal(message)
                    except Exception:
                        # An untrusted guest's malformed SDP must not reset other sessions.
                        sid = message.get('sessionId')
                        self.children.pop(sid, None)
                        await child.stop_session()
                        await self.send({'type': 'end', 'sessionId': sid})

    async def handle_signal(self, message):
        kind = message['type']
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



async def main():
    agent = Agent()
    task = asyncio.create_task(agent.run())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try: loop.add_signal_handler(sig, task.cancel)
        except NotImplementedError: pass  # Windows ProactorEventLoop.
    if '--managed' in sys.argv:
        # The configuration window owns this process. EOF also ends sharing.
        import threading
        def parent_input():
            sys.stdin.readline()
            loop.call_soon_threadsafe(task.cancel)
        threading.Thread(target=parent_input, daemon=True).start()
    try: await task
    except asyncio.CancelledError: pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config')
    parser.add_argument('--managed', action='store_true')
    args = parser.parse_args()
    if args.config:
        from client_config import load_config, signal_url
        config = load_config(args.config)
        os.environ.update(HOST_TOKEN=config['token'], HOST_NAME=config['name'], SIGNAL_URL=signal_url(config))
        os.environ.update({'RC_' + k.upper(): '1' if config[k] else '0' for k in ('terminal', 'files', 'clipboard', 'audio')})
    if sys.platform != 'win32' and os.environ.get('XDG_SESSION_TYPE') == 'wayland':
        raise SystemExit('暂不支持 Wayland，请注销后选择 Xorg/X11 桌面会话')
    if not os.environ.get('HOST_TOKEN'):
        raise SystemExit('请先打开客户端填写主机密钥')
    asyncio.run(main())
