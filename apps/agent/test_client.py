import ctypes
import json
import os
from pathlib import Path
import tempfile
import unittest

from client_config import validate_config, signal_url, save_config, load_config
from windows_input import WindowsInput, INPUT, keycode

class ConfigTests(unittest.TestCase):
    def test_roundtrip_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'client.json'
            save_config(path, {'url': 'https://rc.lvyrix.com/', 'name': 'My PC', 'token': 'test-host-token'})
            value = load_config(path)
            self.assertEqual(signal_url(value), 'wss://rc.lvyrix.com/ws')
            self.assertEqual(value['name'], 'My PC')
            if os.name != 'nt': self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_suffix('.tmp').exists())

    def test_reject_untrusted_transport_or_embedded_credentials(self):
        for url in ['http://example.com', 'https://u:p@example.com', 'https://example.com/api', 'https://example.com?token=x', 'https://example.com#x']:
            with self.assertRaises(ValueError): validate_config({'url': url, 'name': 'PC', 'token': 'token'})

class FakeUser32:
    def __init__(self): self.events = []
    def SendInput(self, count, pointer, size):
        self.events.append(INPUT.from_buffer_copy(ctypes.string_at(pointer, size)))
        return 1

class WindowsTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeUser32(); self.input = WindowsInput(self.api)

    def test_abi_and_unicode_surrogates(self):
        self.assertEqual(ctypes.sizeof(INPUT), 40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28)
        self.input.apply({'type': 'text', 'text': '中😀'})
        self.assertEqual([e.ki.wScan for e in self.api.events[::2]], [0x4e2d, 0xd83d, 0xde00])
        self.assertEqual([e.ki.dwFlags for e in self.api.events], [4, 6] * 3)

    def test_release_held_keys_and_mouse(self):
        self.input.apply({'type': 'key', 'code': 'ControlRight', 'down': True})
        self.input.apply({'type': 'button', 'button': 'left', 'down': True, 'x': .5, 'y': 1})
        self.input.release()
        self.assertEqual(self.api.events[0].ki.dwFlags, 1)
        self.assertEqual(self.api.events[-2].ki.dwFlags, 3)
        self.assertEqual(self.api.events[-1].mi.dwFlags, 4)
        self.assertFalse(self.input.keys or self.input.buttons)

    def test_motion_validation_and_scroll_direction(self):
        for x in [-1, 2, float('nan'), True]:
            with self.assertRaises(ValueError): self.input.apply({'type': 'move', 'x': x, 'y': 0})
        self.assertEqual(len(self.api.events), 0)
        self.input.apply({'type': 'wheel', 'dx': 0, 'dy': 60})
        self.assertEqual(self.api.events[0].mi.mouseData, (-120) & 0xffffffff)
        self.assertEqual(keycode('KeyA'), 65)
        self.assertEqual(keycode('F12'), 0x7b)
        self.assertEqual(keycode('Bogus'), 0)

if __name__ == '__main__': unittest.main()
