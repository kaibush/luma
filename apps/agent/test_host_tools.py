import asyncio
import base64
from fractions import Fraction
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from av import VideoFrame
from host_tools import HostTools, device_stats
from media import DesktopEncoder
from desktop import DesktopVideo


class Channel:
    bufferedAmount = 0
    readyState = 'open'
    def __init__(self): self.messages = []; self.callbacks = {}
    def on(self, name, fn): self.callbacks[name] = fn
    def send(self, raw): self.messages.append(json.loads(raw))
    def close(self): self.readyState = 'closed'


class ToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.channel = Channel()
        self.tools = HostTools(self.channel, dict(files=True, terminal=True, clipboard=False), self.directory.name)
    async def asyncTearDown(self):
        await self.tools.close(); self.directory.cleanup()

    async def call(self, op, **data): return await self.tools.dispatch(dict(op=op, **data))

    async def test_file_roundtrip_atomic_cancel_and_limits(self):
        content = '文件传输测试'.encode()
        await self.call('files.upload', path='result.txt', size=len(content))
        await self.call('files.chunk', data=base64.b64encode(content).decode())
        self.assertFalse((Path(self.directory.name) / 'result.txt').exists())
        await self.call('files.finish')
        self.assertEqual(await self.call('files.download', path='result.txt'), dict(size=len(content)))
        self.assertEqual(base64.b64decode((await self.call('files.read'))['data']), content)
        await self.call('files.cancel')
        await self.call('files.upload', path='cancel.txt', size=10)
        await self.call('files.chunk', data='YQ==')
        with self.assertRaises(ValueError): await self.call('files.finish')
        await self.call('files.cancel')
        self.assertEqual([p.name for p in Path(self.directory.name).iterdir()], ['result.txt'])
        with self.assertRaises(ValueError): await self.call('files.upload', path='result.txt', size=0)
        with self.assertRaises(ValueError): await self.call('files.upload', path='huge.txt', size=2**30)

    async def test_create_folder_stays_in_shared_root(self):
        await self.call('files.mkdir', path='new-folder')
        listing = await self.call('files.list', path='')
        self.assertEqual(listing['root'], self.directory.name)
        self.assertTrue(any(e['name'] == 'new-folder' and e['directory'] for e in listing['entries']))
        for invalid in ['', '../outside', '/tmp/outside']:
            with self.assertRaises(ValueError): await self.call('files.mkdir', path=invalid)
        with self.assertRaises(FileExistsError): await self.call('files.mkdir', path='new-folder')
        self.tools.allowed['files'] = False
        with self.assertRaises(ValueError): await self.call('files.mkdir', path='denied')

    async def test_file_boundary_and_permissions(self):
        for path in ['../outside', '/etc/passwd']:
            with self.assertRaises(ValueError): await self.call('files.download', path=path)
        (Path(self.directory.name) / 'link').symlink_to('/etc')
        with self.assertRaises(ValueError): await self.call('files.download', path='link/passwd')
        with self.assertRaises(ValueError): await self.call('clipboard.read')
        self.tools.allowed['files'] = False
        with self.assertRaises(ValueError): await self.call('files.list', path='')

    @unittest.skipIf(os.name == 'nt', 'Linux PTY integration')
    async def test_terminal_unicode_resize_and_cleanup(self):
        with patch.dict(os.environ, {'SHELL': '/bin/sh'}):
            await self.call('terminal.open', cols=90, rows=30)
        process, fd = self.tools.terminal
        await self.call('terminal.resize', cols=100, rows=35)
        await self.call('terminal.input', text="printf '你好\\n'; stty size\n")
        async def output():
            while '35 100' not in ''.join(m.get('text', '') for m in self.channel.messages): await asyncio.sleep(.02)
        await asyncio.wait_for(output(), 15)
        self.assertIn('你好', ''.join(m.get('text', '') for m in self.channel.messages))
        await self.tools.close()
        self.assertIsNotNone(process.poll())
        with self.assertRaises(OSError): os.fstat(fd)

    async def test_adaptive_capture_recovery_has_hysteresis(self):
        track = DesktopVideo('responsive')
        try:
            track.feedback(dict(rtt=400, fps=10))
            self.assertEqual(track.level, 1)
            track.last_feedback = 0
            track.feedback(dict(rtt=400, fps=10))
            self.assertEqual(track.level, 2)
            for _ in range(5):
                track.last_feedback = 0; track.feedback(dict(rtt=20, fps=30))
            self.assertEqual(track.level, 2)
            track.last_feedback = 0; track.feedback(dict(rtt=20, fps=30))
            self.assertEqual(track.level, 1)
        finally: track.stop()

    async def test_encoder_hardware_failure_falls_back(self):
        import media
        original = media.make_codec
        def make(name, *args):
            if name == 'h264_nvenc': raise RuntimeError('no GPU')
            return original(name, *args)
        encoder = DesktopEncoder()
        with patch('media.make_codec', side_effect=make):
            frame = VideoFrame(64, 36, 'yuv420p')
            for plane in frame.planes: plane.update(bytes(plane.buffer_size))
            frame.pts, frame.time_base = 0, Fraction(1, 90000)
            packets, timestamp = encoder.encode(frame)
        self.assertTrue(packets)
        self.assertEqual(encoder.selected, 'libx264')
        self.assertEqual(timestamp, 0)

    async def test_status(self):
        value = device_stats()
        self.assertGreater(value['memoryTotal'], 0)
        self.assertGreater(value['diskTotal'], 0)
        self.assertGreaterEqual(value['cpu'], 0)
        self.assertLessEqual(value['cpu'], 100)
