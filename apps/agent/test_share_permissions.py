"""Permission enforcement happens at the Agent, including malicious channels."""
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from main import Agent

class Peer:
    def __init__(self, *_): self.callbacks = {}
    def on(self, event):
        def register(fn): self.callbacks[event] = fn; return fn
        return register
    async def close(self): pass

class SharePermissions(unittest.IsolatedAsyncioTestCase):
    async def test_read_only_never_opens_system_input_or_tools(self):
        agent = Agent(); agent.ws = MagicMock()
        async def send(_): pass
        agent.send = send
        with patch('main.DesktopInput') as desktop_input, patch('main.DesktopVideo', return_value=None), patch('main.RTCPeerConnection', Peer), patch('main.HostTools') as tools:
            await agent.start_session({'session': {'id': 'view', 'quality': 'balanced', 'readOnly': True, 'tools': True}, 'iceServers': []})
            for label in ['input', 'motion', 'tools']:
                channel = MagicMock(); channel.label = label
                agent.pc.callbacks['datachannel'](channel)
                channel.close.assert_called_once()
            desktop_input.assert_not_called(); tools.assert_not_called()
            await agent.stop_session()

    async def test_guest_control_cannot_open_tools(self):
        agent = Agent()
        async def send(_): pass
        agent.send = send
        with patch('main.DesktopInput'), patch('main.DesktopVideo', return_value=None), patch('main.RTCPeerConnection', Peer), patch('main.HostTools') as tools:
            await agent.start_session({'session': {'id': 'control', 'quality': 'balanced', 'readOnly': False, 'tools': False}, 'iceServers': []})
            channel = MagicMock(); channel.label = 'tools'
            agent.pc.callbacks['datachannel'](channel)
            channel.close.assert_called_once(); tools.assert_not_called()
            await agent.stop_session()

    async def test_malformed_guest_signal_does_not_close_other_sessions(self):
        agent = Agent(); agent.send = AsyncMock()
        bad = MagicMock(); bad.pc = True
        bad.handle_signal = AsyncMock(side_effect=ValueError('invalid SDP'))
        bad.stop_session = AsyncMock()
        good = MagicMock(); good.stop_session = AsyncMock()
        agent.children = {'bad': bad, 'admin': good}
        async def messages():
            yield '{"type":"offer","sessionId":"bad","sdp":"malformed"}'
        await agent.receive_messages(messages())
        bad.stop_session.assert_awaited_once()
        good.stop_session.assert_not_awaited()
        self.assertEqual(list(agent.children), ['admin'])
        agent.send.assert_awaited_once_with({'type': 'end', 'sessionId': 'bad'})

if __name__ == '__main__': unittest.main()
