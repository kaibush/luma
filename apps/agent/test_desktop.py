"""Capture regressions; no X11 session required."""
import asyncio
import unittest
from fractions import Fraction
from types import SimpleNamespace

from av import VideoFrame
from aiortc.mediastreams import MediaStreamError
from desktop import DesktopVideo, PROFILES
from main import h264


class VideoTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_encoder_gets_latest_frame_and_stop_wakes_receiver(self):
        track = DesktopVideo('ultrafast')
        count = 0
        def capture():
            nonlocal count
            count += 1
            return VideoFrame(64, 36, 'yuv420p')
        track.capture = capture
        try:
            first = await track.recv()
            await asyncio.sleep(.12)  # Simulate a slow encoder.
            latest = await track.recv()
            self.assertGreater(count, 2)
            self.assertGreater(latest.pts - first.pts, 4500)
            self.assertLessEqual(track.frames.qsize(), 1)
            pending = asyncio.create_task(track.recv())
            track.stop()
            with self.assertRaises(MediaStreamError):
                await pending
        finally:
            track.stop()

    async def test_capture_failure_reaches_consumer(self):
        track = DesktopVideo('smooth')
        def fail():
            raise RuntimeError('capture failed')
        track.capture = fail
        with self.assertRaisesRegex(RuntimeError, 'capture failed'):
            await asyncio.wait_for(track.recv(), 1)
        self.assertEqual(track.readyState, 'ended')

    async def test_capture_fits_landscape_and_portrait_without_upscaling(self):
        for quality, profile in PROFILES.items():
            for width, height in ((1920, 1080), (900, 1600), (321, 241)):
                track = DesktopVideo(quality)
                shot = SimpleNamespace(width=width, height=height, raw=bytearray(width * height * 4))
                track.screen = SimpleNamespace(monitors=[{}], grab=lambda _: shot, close=lambda: None)
                try:
                    frame = track.capture()
                    self.assertLessEqual(frame.width, min(width, profile['width']))
                    self.assertLessEqual(frame.height, min(height, profile['height']))
                    self.assertEqual(frame.width % 2, 0)
                    self.assertEqual(frame.height % 2, 0)
                    self.assertEqual(track.fps, profile['fps'])
                finally:
                    track.stop()

    async def test_h264_preserves_distinct_60fps_timestamps(self):
        encoder = h264.H264Encoder()
        timestamps = []
        for i in range(6):
            frame = VideoFrame(64, 36, 'yuv420p')
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            frame.pts = i * 1500
            frame.time_base = Fraction(1, 90000)
            packets, timestamp = encoder.encode(frame)
            self.assertTrue(packets)
            timestamps.append(timestamp)
        self.assertEqual(timestamps, [i * 1500 for i in range(6)])


if __name__ == '__main__':
    unittest.main()
