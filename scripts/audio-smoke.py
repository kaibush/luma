"""Capture a generated tone from a private PulseAudio null sink (no microphone)."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/agent'))
with tempfile.TemporaryDirectory(prefix='remote-audio-') as temp:
    socket = str(Path(temp) / 'native')
    server = subprocess.Popen(['pulseaudio', '-n', '--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1', '--load=module-native-protocol-unix socket=' + socket + ' auth-anonymous=1', '--load=module-null-sink sink_name=rc_test', '--log-target=stderr'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            if Path(socket).exists(): break
            time.sleep(.1)
        os.environ['PULSE_SERVER'] = 'unix:' + socket
        import soundcard as sc
        import numpy as np
        from media import SystemAudio
        async def run():
            track = SystemAudio()
            tone = (np.sin(2 * np.pi * 440 * np.arange(48000 * 3) / 48000) * .2).astype('float32')
            playback = asyncio.create_task(asyncio.to_thread(sc.default_speaker().play, np.column_stack([tone, tone]), 48000))
            peak = 0
            try:
                for _ in range(100):
                    frame = await asyncio.wait_for(track.recv(), 5)
                    assert frame.sample_rate == 48000 and frame.samples == 960
                    peak = max(peak, int(np.abs(frame.to_ndarray()).max()))
                assert peak > 1000, f'No system tone captured: {peak}'
                print(f'PASS: system loopback audio, 48 kHz stereo, 20 ms frames, peak {peak}')
            finally:
                track.stop()
                await playback
        asyncio.run(run())
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill(); server.wait()
