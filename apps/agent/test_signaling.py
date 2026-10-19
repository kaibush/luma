"""Regression coverage for trickle ICE arriving ahead of the SDP offer."""
import asyncio
import unittest
from unittest.mock import AsyncMock
from aiortc import RTCConfiguration, RTCPeerConnection
from main import Agent


class Signaling(unittest.IsolatedAsyncioTestCase):
    async def test_early_candidate_survives_until_remote_description(self):
        agent = Agent()
        agent.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        agent.send = AsyncMock()
        agent.session = 'test'
        remote = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        try:
            remote.addTransceiver('video', direction='recvonly')
            offer = await remote.createOffer()
            await agent.handle_signal({'type': 'ice', 'candidate': {
                'candidate': 'candidate:1 1 udp 2130706431 192.0.2.1 5000 typ host',
                'sdpMid': '0', 'sdpMLineIndex': 0,
            }})
            self.assertEqual(len(agent.pending_ice), 1)
            await agent.handle_signal({'type': 'offer', 'sdp': offer.sdp})
            self.assertEqual(agent.pending_ice, [])
            self.assertIn('192.0.2.1 5000', agent.pc.remoteDescription.sdp)
            self.assertEqual(agent.send.call_args.args[0]['type'], 'answer')
        finally:
            await asyncio.sleep(0)  # Let aiortc's scheduled connect task start before closing.
            await agent.stop_session()
            await remote.close()

    async def test_stopping_discards_candidates_from_previous_session(self):
        agent = Agent()
        agent.pending_ice.append(object())
        await agent.stop_session()
        self.assertEqual(agent.pending_ice, [])


if __name__ == '__main__':
    unittest.main()
