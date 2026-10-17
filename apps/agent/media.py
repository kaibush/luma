"""Low-latency H.264 with runtime hardware probing and software fallback."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import logging
import os
import time

import av
from aiortc import AudioStreamTrack
from aiortc.codecs import h264
from aiortc.mediastreams import MediaStreamError

log = logging.getLogger('remote-agent')
ENCODER = 'idle'
BITRATE_LIMIT = 4_000_000


def make_codec(name, width, height, bitrate):
    codec = av.CodecContext.create(name, 'w')
    codec.width, codec.height, codec.bit_rate = width, height, bitrate
    codec.pix_fmt = 'yuv420p'
    codec.framerate, codec.time_base = Fraction(60), Fraction(1, 60)
    codec.gop_size = 120
    codec.max_b_frames = 0
    codec.options = ({'preset': 'p1', 'tune': 'ull', 'zerolatency': '1', 'profile': 'baseline'} if name == 'h264_nvenc'
                     else {'preset': 'ultrafast', 'tune': 'zerolatency', 'profile': 'baseline'})
    return codec


class DesktopEncoder(h264.H264Encoder):
    def __init__(self):
        super().__init__()
        self.selected = None
        self.failed = set()
        self.target_bitrate = 4_000_000

    @h264.H264Encoder.target_bitrate.setter
    def target_bitrate(self, bitrate):
        h264.H264Encoder.target_bitrate.fset(self, min(bitrate, BITRATE_LIMIT))

    def _encode_frame(self, frame, force_keyframe):
        global ENCODER
        if self.codec and (frame.width != self.codec.width or frame.height != self.codec.height or abs(self.target_bitrate-self.codec.bit_rate)/self.codec.bit_rate > .2): self.codec = None
        frame.pict_type = av.video.frame.PictureType.I if force_keyframe else av.video.frame.PictureType.NONE
        preference = os.environ.get('RC_ENCODER', 'auto')
        candidates = ['h264_nvenc', 'libx264'] if preference in ('auto', 'h264_nvenc') else ['libx264']
        for name in candidates:
            if name in self.failed: continue
            try:
                if self.codec is None or self.selected != name:
                    self.codec = make_codec(name, frame.width, frame.height, self.target_bitrate)
                    self.selected = name
                    frame.pict_type = av.video.frame.PictureType.I
                packets = self.codec.encode(frame)
                ENCODER = name
                data = b''.join(bytes(p) for p in packets)
                if data: yield from self._split_bitstream(data)
                return
            except Exception:
                self.failed.add(name); self.codec = None
                if name == 'libx264': raise
                log.info('硬件编码不可用，使用软件编码')


def install_encoder():
    # aiortc is pinned; only replace its H.264 encoder factory binding.
    import aiortc.codecs
    aiortc.codecs.H264Encoder = DesktopEncoder
    h264.MAX_FRAME_RATE = 60
    h264.MAX_BITRATE = 10_000_000


class SystemAudio(AudioStreamTrack):
    def __init__(self):
        super().__init__()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='audio')
        self.recorder = None
        self.pts = 0

    def capture(self):
        import soundcard as sc
        import numpy as np
        if self.recorder is None:
            speaker = sc.default_speaker()
            if speaker is None: raise RuntimeError('没有系统音频输出设备')
            mic = sc.get_microphone(id=str(speaker.id) + ('.monitor' if os.name != 'nt' else ''), include_loopback=True)
            if not mic.isloopback: raise RuntimeError('没有系统回环音频设备')
            self.recorder = mic.recorder(samplerate=48000, channels=2, blocksize=960)
            self.recorder.__enter__()
        samples = self.recorder.record(numframes=960)
        pcm = (np.clip(samples, -1, 1) * 32767).astype('int16').reshape(1, -1)
        return av.AudioFrame.from_ndarray(pcm, format='s16', layout='stereo')

    async def recv(self):
        if self.readyState != 'live': raise MediaStreamError
        try: frame = await asyncio.get_running_loop().run_in_executor(self.executor, self.capture)
        except Exception:
            log.warning('系统音频不可用；桌面视频继续运行')
            self.stop(); raise MediaStreamError
        frame.sample_rate, frame.time_base, frame.pts = 48000, Fraction(1, 48000), self.pts
        self.pts += frame.samples
        return frame

    def stop(self):
        if self.readyState == 'ended': return
        super().stop()
        self.executor.submit(lambda: self.recorder.__exit__(None, None, None) if self.recorder else None)
        self.executor.shutdown(wait=False)
