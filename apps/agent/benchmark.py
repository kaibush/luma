"""Local WebRTC decode benchmark on the existing desktop (does not send input).

DISPLAY=:10 XAUTHORITY=/root/.Xauthority .venv/bin/python benchmark.py
Results exclude the phone / internet path and depend on current desktop motion.
"""
import asyncio
import time

from aiortc import RTCConfiguration, RTCPeerConnection, RTCRtpSender
from desktop import DesktopVideo
from main import h264  # Apply the same encoder time base as the production agent.


async def measure(quality, codec):
    sender = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    receiver = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    track = DesktopVideo(quality)
    sender.addTrack(track)
    sender.getTransceivers()[0].setCodecPreferences([
        c for c in RTCRtpSender.getCapabilities('video').codecs
        if c.mimeType == codec
    ])
    result = asyncio.get_running_loop().create_future()
    consumer = None

    @receiver.on('track')
    def received(remote):
        nonlocal consumer
        async def consume():
            try:
                # Warm up the encoder / decoder.
                for _ in range(10):
                    await remote.recv()
                start = time.monotonic()
                frames = 0
                while time.monotonic() - start < 5:
                    frame = await remote.recv()
                    frames += 1
                result.set_result((frame.width, frame.height, round(frames / (time.monotonic() - start), 1)))
            except Exception as error:
                if not result.done():
                    result.set_exception(error)
        consumer = asyncio.create_task(consume())

    try:
        await sender.setLocalDescription(await sender.createOffer())
        await receiver.setRemoteDescription(sender.localDescription)
        await receiver.setLocalDescription(await receiver.createAnswer())
        await sender.setRemoteDescription(receiver.localDescription)
        print(quality, codec, await asyncio.wait_for(result, 30), flush=True)
    finally:
        if consumer:
            consumer.cancel()
        await sender.close()
        await receiver.close()
        track.stop()


async def main():
    for codec in ('video/VP8', 'video/H264'):
        for quality in ('responsive', 'smooth', 'ultrafast'):
            await measure(quality, codec)


if __name__ == '__main__':
    asyncio.run(main())
