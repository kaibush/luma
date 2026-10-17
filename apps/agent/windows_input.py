"""Windows interactive-session input via SendInput (no elevated/secure desktop)."""
import ctypes
import math
import sys

# Fixed-width Windows ABI types, including pointer-sized dwExtraInfo.
DWORD, LONG, WORD = ctypes.c_uint32, ctypes.c_int32, ctypes.c_uint16
ULONG_PTR = ctypes.c_size_t
class MOUSEINPUT(ctypes.Structure):
    _fields_ = [('dx', LONG), ('dy', LONG), ('mouseData', DWORD), ('dwFlags', DWORD), ('time', DWORD), ('dwExtraInfo', ULONG_PTR)]
class KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', WORD), ('wScan', WORD), ('dwFlags', DWORD), ('time', DWORD), ('dwExtraInfo', ULONG_PTR)]
class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [('uMsg', DWORD), ('wParamL', WORD), ('wParamH', WORD)]
class INPUTUNION(ctypes.Union):
    _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('hi', HARDWAREINPUT)]
class INPUT(ctypes.Structure):
    _anonymous_ = ('value',)
    _fields_ = [('type', DWORD), ('value', INPUTUNION)]

KEYS = {'Enter': 0x0d, 'Escape': 0x1b, 'Backspace': 8, 'Tab': 9, 'Space': 0x20,
        'ShiftLeft': 0xa0, 'ShiftRight': 0xa1, 'ControlLeft': 0xa2, 'ControlRight': 0xa3,
        'AltLeft': 0xa4, 'AltRight': 0xa5, 'MetaLeft': 0x5b, 'MetaRight': 0x5c,
        'ArrowLeft': 0x25, 'ArrowUp': 0x26, 'ArrowRight': 0x27, 'ArrowDown': 0x28,
        'Delete': 0x2e, 'Insert': 0x2d, 'Home': 0x24, 'End': 0x23, 'PageUp': 0x21, 'PageDown': 0x22,
        'Minus': 0xbd, 'Equal': 0xbb, 'BracketLeft': 0xdb, 'BracketRight': 0xdd,
        'Backslash': 0xdc, 'Semicolon': 0xba, 'Quote': 0xde, 'Comma': 0xbc,
        'Period': 0xbe, 'Slash': 0xbf, 'Backquote': 0xc0, 'CapsLock': 0x14}
EXTENDED = {'ControlRight', 'AltRight', 'MetaLeft', 'MetaRight', 'ArrowLeft', 'ArrowRight',
            'ArrowUp', 'ArrowDown', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'}

def keycode(code):
    if len(code) == 4 and code.startswith('Key') and 'A' <= code[3] <= 'Z': return ord(code[3])
    if len(code) == 6 and code.startswith('Digit') and code[5].isascii() and code[5].isdigit(): return ord(code[5])
    if code.startswith('F') and code[1:].isdigit() and 1 <= int(code[1:]) <= 12: return 0x70 + int(code[1:]) - 1
    return KEYS.get(code, 0)

def enable_dpi_awareness():
    if sys.platform == 'win32':
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        try: user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        except AttributeError: user32.SetProcessDPIAware()

class WindowsInput:
    def __init__(self, user32=None):
        self.user32 = user32 if user32 is not None else ctypes.WinDLL('user32', use_last_error=True)
        if user32 is None:
            self.user32.SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(INPUT), ctypes.c_int]
            self.user32.SendInput.restype = ctypes.c_uint
        self.keys, self.buttons = set(), set()

    def send(self, event):
        if self.user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT)) != 1:
            raise OSError('Windows refused input; use an unlocked desktop at the same privilege level')

    def mouse(self, flags, data=0, x=0, y=0):
        self.send(INPUT(type=0, mi=MOUSEINPUT(x, y, data & 0xffffffff, flags, 0, 0)))

    def key(self, code, down):
        self.send(INPUT(type=1, ki=KEYBDINPUT(keycode(code), 0, (1 if code in EXTENDED else 0) | (0 if down else 2), 0, 0)))

    def release(self):
        # Try all releases even when the desktop has become locked.
        for code in list(self.keys):
            try: self.key(code, False)
            except OSError: pass
        for button in list(self.buttons):
            try: self.mouse(4 if button == 'left' else 16)
            except OSError: pass
        self.keys.clear(); self.buttons.clear()

    def move(self, event):
        x, y = event.get('x'), event.get('y')
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 1 for v in (x, y)):
            raise ValueError('Invalid coordinates')
        # MSS monitor 0 and MOUSEEVENTF_VIRTUALDESK both cover the virtual desktop.
        self.mouse(0x8000 | 0x4000 | 1, x=round(x * 65535), y=round(y * 65535))

    def apply(self, event):
        kind = event.get('type')
        if kind == 'release-all': self.release()
        elif kind == 'move': self.move(event)
        elif kind == 'button':
            button, down = event.get('button'), event.get('down')
            if button not in ('left', 'right') or not isinstance(down, bool): return
            self.move(event)
            self.mouse((2 if down else 4) if button == 'left' else (8 if down else 16))
            (self.buttons.add if down else self.buttons.discard)(button)
        elif kind == 'key':
            code, down = event.get('code'), event.get('down')
            if not isinstance(code, str) or len(code) > 64 or not isinstance(down, bool) or not keycode(code): return
            self.key(code, down)
            (self.keys.add if down else self.keys.discard)(code)
        elif kind == 'wheel':
            values = [event.get('dx'), event.get('dy')]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 2000 for v in values): return
            if values[0]: self.mouse(0x1000, round(values[0] * 2))
            if values[1]: self.mouse(0x0800, -round(values[1] * 2))
        elif kind == 'text':
            text = event.get('text')
            if not isinstance(text, str) or len(text) > 2048: return
            self.release()
            raw = text.replace('\n', '\r').encode('utf-16-le', errors='replace')
            for i in range(0, len(raw), 2):
                unit = int.from_bytes(raw[i:i+2], 'little')
                for flags in (4, 6):
                    self.send(INPUT(type=1, ki=KEYBDINPUT(0, unit, flags, 0, 0)))

    def close(self): self.release()
