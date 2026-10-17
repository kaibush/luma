"""X11 capture and input. Does not create or replace the user's desktop session."""
import asyncio
import json
import math
import os
import time
import sys
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import mss
from av import VideoFrame
from aiortc import VideoStreamTrack
from aiortc.mediastreams import MediaStreamError
if sys.platform != 'win32':
    from Xlib import X, XK, display
    from Xlib.ext import xtest


# Shared with the UI and API so advertised capture limits stay in sync.
_profiles = Path(__file__).with_name('quality-profiles.json')
if not _profiles.exists():
    _profiles = Path(__file__).resolve().parents[2] / 'packages/protocol/src/quality-profiles.json'
PROFILES = json.loads(_profiles.read_text())


class DesktopVideo(VideoStreamTrack):
    def __init__(self, quality):
        super().__init__()
        profile = PROFILES[quality]
        self.profile = profile
        self.level = 0
        self.good_samples = 0
        self.last_feedback = 0
        self.capture_ms = 0
        self.max_width = profile['width']
        self.max_height = profile['height']
        self.fps = profile['fps']
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='capture')
        self.screen = None
        self.started = time.monotonic()
        self.due = self.started
        self.frames = asyncio.Queue(maxsize=1)
        self.producer = None

    def capture(self):
        if self.screen is None:
            self.screen = mss.mss(**({'display': os.environ.get('DISPLAY', ':0')} if sys.platform != 'win32' else {}), with_cursor=True)
        shot = self.screen.grab(self.screen.monitors[0])
        frame = VideoFrame(shot.width, shot.height, 'bgra')
        data = shot.raw
        stride = frame.planes[0].line_size
        if stride != shot.width * 4:
            data = b''.join(data[y*shot.width*4:(y+1)*shot.width*4] + bytes(stride-shot.width*4) for y in range(shot.height))
        frame.planes[0].update(data)
        scale = min(1, self.max_width / shot.width, self.max_height / shot.height)
        width = max(2, int(shot.width * scale) // 2 * 2)
        height = max(2, int(shot.height * scale) // 2 * 2)
        return frame.reformat(width=width, height=height, format='yuv420p', interpolation='BILINEAR')

    def feedback(self, event):
        now = time.monotonic()
        if now - self.last_feedback < 5: return
        rtt, fps = event.get('rtt'), event.get('fps')
        if not all(type(v) in (float, int) and math.isfinite(v) and v >= 0 for v in (rtt, fps)): return
        self.last_feedback = now
        overloaded = rtt > 250 or (fps > 0 and fps < self.fps * .65) or self.capture_ms > 1000 / self.fps
        if overloaded:
            self.level = min(2, self.level + 1); self.good_samples = 0
        elif rtt < 120 and fps >= self.fps * .85:
            self.good_samples += 1
            if self.good_samples >= 6:
                self.level = max(0, self.level - 1); self.good_samples = 0
        else: self.good_samples = 0
        scale = (1, .75, .5)[self.level]
        self.max_width, self.max_height = int(self.profile['width'] * scale), int(self.profile['height'] * scale)
        self.fps = self.profile['fps'] if self.level == 0 else min(30, self.profile['fps'])

    async def produce(self):
        try:
            while self.readyState == 'live':
                await asyncio.sleep(max(0, self.due - time.monotonic()))
                self.due = max(self.due + 1 / self.fps, time.monotonic())
                capture_started = time.monotonic()
                frame = await asyncio.get_running_loop().run_in_executor(self.executor, self.capture)
                self.capture_ms = (time.monotonic() - capture_started) * 1000
                frame.pts = round((time.monotonic() - self.started) * 90000)
                frame.time_base = Fraction(1, 90000)
                # Capture overlaps encoding. Slow consumers get the newest frame,
                # never a growing backlog of stale desktop images.
                if self.frames.full():
                    self.frames.get_nowait()
                self.frames.put_nowait(frame)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            if self.frames.full():
                self.frames.get_nowait()
            self.frames.put_nowait(error)

    async def recv(self):
        if self.readyState != 'live':
            raise MediaStreamError
        if self.producer is None:
            self.producer = asyncio.create_task(self.produce())
        frame = await self.frames.get()
        if isinstance(frame, Exception):
            self.stop()
            raise frame
        return frame

    def stop(self):
        if self.readyState == 'ended':
            return
        super().stop()
        if self.producer:
            self.producer.cancel()
        if self.frames.full():
            self.frames.get_nowait()
        self.frames.put_nowait(MediaStreamError())
        self.executor.submit(lambda: self.screen.close() if self.screen else None)
        self.executor.shutdown(wait=False)


KEYS = {'Enter': 'Return', 'Escape': 'Escape', 'Backspace': 'BackSpace', 'Tab': 'Tab', 'Space': 'space',
        'ShiftLeft': 'Shift_L', 'ShiftRight': 'Shift_R', 'ControlLeft': 'Control_L', 'ControlRight': 'Control_R',
        'AltLeft': 'Alt_L', 'AltRight': 'Alt_R', 'MetaLeft': 'Super_L', 'MetaRight': 'Super_R',
        'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
        'Delete': 'Delete', 'Insert': 'Insert', 'Home': 'Home', 'End': 'End', 'PageUp': 'Page_Up', 'PageDown': 'Page_Down',
        'Minus': 'minus', 'Equal': 'equal', 'BracketLeft': 'bracketleft', 'BracketRight': 'bracketright',
        'Backslash': 'backslash', 'Semicolon': 'semicolon', 'Quote': 'apostrophe', 'Comma': 'comma',
        'Period': 'period', 'Slash': 'slash', 'Backquote': 'grave', 'CapsLock': 'Caps_Lock'}


class DesktopInput:
    def __init__(self):
        self.d = display.Display()
        self.root = self.d.screen().root
        self.keys = set()
        self.buttons = set()
        self.scroll = [0., 0.]

    def release(self):
        for code in self.keys:
            xtest.fake_input(self.d, X.KeyRelease, code)
        for button in self.buttons:
            xtest.fake_input(self.d, X.ButtonRelease, button)
        self.keys.clear()
        self.buttons.clear()
        self.scroll = [0., 0.]
        self.d.sync()

    def move(self, event):
        x, y = event.get('x'), event.get('y')
        if not all(isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in (x, y)):
            raise ValueError('Invalid coordinates')
        geometry = self.root.get_geometry()
        xtest.fake_input(self.d, X.MotionNotify, x=round(x*(geometry.width-1)), y=round(y*(geometry.height-1)))

    def keycode(self, code):
        name = KEYS.get(code)
        if len(code) == 4 and code.startswith('Key') and code[3].isalpha(): name = code[3].lower()
        if len(code) == 6 and code.startswith('Digit') and code[5].isdigit(): name = code[5]
        if code.startswith('F') and code[1:].isdigit() and 1 <= int(code[1:]) <= 12: name = code
        return self.d.keysym_to_keycode(XK.string_to_keysym(name)) if name else 0

    def apply(self, event):
        kind = event.get('type')
        if kind == 'release-all':
            self.release()
        elif kind == 'move':
            self.move(event)
        elif kind == 'button':
            if event.get('button') not in ('left', 'right') or not isinstance(event.get('down'), bool): return
            self.move(event)
            button = 1 if event['button'] == 'left' else 3
            xtest.fake_input(self.d, X.ButtonPress if event['down'] else X.ButtonRelease, button)
            (self.buttons.add if event['down'] else self.buttons.discard)(button)
        elif kind == 'key':
            code = event.get('code')
            if not isinstance(code, str) or len(code) > 64 or not isinstance(event.get('down'), bool): return
            key = self.keycode(code)
            if key:
                xtest.fake_input(self.d, X.KeyPress if event['down'] else X.KeyRelease, key)
                (self.keys.add if event['down'] else self.keys.discard)(key)
        elif kind == 'wheel':
            for index, name in enumerate(('dx', 'dy')):
                delta = event.get(name)
                if not isinstance(delta, (float, int)) or not math.isfinite(delta) or abs(delta) > 2000: return
                self.scroll[index] += delta
                steps = int(self.scroll[index] / 60)
                self.scroll[index] -= steps * 60
                button = (7 if steps > 0 else 6) if index == 0 else (5 if steps > 0 else 4)
                for _ in range(abs(steps)):
                    xtest.fake_input(self.d, X.ButtonPress, button)
                    xtest.fake_input(self.d, X.ButtonRelease, button)
        elif kind == 'text':
            text = event.get('text')
            if not isinstance(text, str) or len(text) > 2048: return
            # Text is clipboard-independent. Unsupported layouts / Unicode are skipped.
            # Do not synthesize shell commands or change the global keyboard mapping.
            self.release()
            shift = self.d.keysym_to_keycode(XK.string_to_keysym('Shift_L'))
            for char in text:
                symbol = ord(char) if 32 <= ord(char) <= 126 else 0
                if char == '\n': symbol = XK.string_to_keysym('Return')
                if not symbol: continue
                key = self.d.keysym_to_keycode(symbol)
                if not key: continue
                shifted = self.d.keycode_to_keysym(key, 0) != symbol
                if shifted: xtest.fake_input(self.d, X.KeyPress, shift)
                xtest.fake_input(self.d, X.KeyPress, key)
                xtest.fake_input(self.d, X.KeyRelease, key)
                if shifted: xtest.fake_input(self.d, X.KeyRelease, shift)
        self.d.flush()

    def close(self):
        self.release()
        self.d.close()


if sys.platform == 'win32':
    from windows_input import WindowsInput as DesktopInput
