"""Temporary X11 window for end-to-end input tests; restores focus on exit."""
import json
import os
import signal
import time
from Xlib import X, display
from Xlib.ext import xtest

d = display.Display()
root = d.screen().root
previous = d.get_input_focus().focus
pointer = root.query_pointer()
window = root.create_window(100, 100, 400, 220, 0, d.screen().root_depth, X.InputOutput, X.CopyFromParent,
                            background_pixel=0x336699, override_redirect=1,
                            event_mask=X.KeyPressMask | X.KeyReleaseMask | X.ButtonPressMask | X.ButtonReleaseMask)
window.set_wm_name('Remote Console input verification')
window.map()
window.configure(stack_mode=X.Above)
window.set_input_focus(X.RevertToParent, X.CurrentTime)
d.sync()
geometry = root.get_geometry()
print(json.dumps({'width':geometry.width,'height':geometry.height,'keyA':d.keysym_to_keycode(ord('a')),'control':d.keysym_to_keycode(0xffe3)}), flush=True)
running = True

def stop(*_):
    global running
    running = False

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    with open(os.environ['FIXTURE_OUTPUT'], 'w') as output:
        while running:
            while d.pending_events():
                event = d.next_event()
                if event.type in (X.KeyPress, X.KeyRelease, X.ButtonPress, X.ButtonRelease):
                    output.write(json.dumps({'type':event.type,'detail':event.detail})+'\n')
                    output.flush()
            time.sleep(.01)
finally:
    try:
        if hasattr(previous, 'set_input_focus'): previous.set_input_focus(X.RevertToParent, X.CurrentTime)
        xtest.fake_input(d, X.MotionNotify, x=pointer.root_x, y=pointer.root_y)
        window.destroy()
        d.sync()
    finally: d.close()
