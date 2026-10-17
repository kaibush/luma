"""Exercise the actual launcher in an isolated config directory and X display."""
import os
from pathlib import Path
import sys
import tempfile
import time

with tempfile.TemporaryDirectory() as directory:
    os.environ['XDG_CONFIG_HOME'] = directory
    os.environ['XDG_SESSION_TYPE'] = 'x11'
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/agent'))
    import client
    import tkinter as tk
    import mss
    import mss.tools
    root = tk.Tk()
    app = client.Client(root)
    lock = client.acquire_lock()
    assert lock is not None and client.acquire_lock() is None
    app.fields['url'].set('https://localhost:1')
    app.fields['token'].set('test-only-not-a-real-key')
    app.fields['name'].set('测试电脑')
    app.start()
    assert app.process is not None
    assert client.CONFIG.exists() and client.startup_path().exists()
    for _ in range(10): root.update(); time.sleep(.1)
    app.stop()
    assert app.process is None
    app.autostart.set(False)
    app.start()
    assert not client.startup_path().exists()
    app.stop()
    root.update()
    with mss.mss() as screen:
        shot = screen.grab({'left': root.winfo_rootx(), 'top': root.winfo_rooty(), 'width': root.winfo_width(), 'height': root.winfo_height()})
        mss.tools.to_png(shot.rgb, shot.size, output='/tmp/agent-client-window.png')
    app.close(); lock.close()
    print('PASS client GUI: configuration save, private storage, single instance, start/stop, enable/disable autostart')
