"""Visible, per-user Agent launcher for Linux X11 and Windows desktops."""
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox

from client_config import config_dir, load_config, save_config

APP = Path(__file__).resolve().parent
DIRECTORY = config_dir()
CONFIG = DIRECTORY / 'client.json'


def startup_path():
    if os.name == 'nt':
        return Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup/RemoteConsole.vbs'
    return Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'autostart/remote-console.desktop'


def set_autostart(enabled):
    path = startup_path()
    if not enabled:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    python = Path(sys.executable)
    if os.name == 'nt':
        python = python.with_name('pythonw.exe')
        command = subprocess.list2cmdline([str(python), str(APP / 'client.py'), '--start'])
        path.write_text('Set shell = CreateObject("WScript.Shell")\r\nshell.Run "' + command.replace('"', '""') + '", 0, False\r\n', encoding='utf-16')
    else:
        def quote(value):
            return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'
        path.write_text('[Desktop Entry]\nType=Application\nName=Remote Console\nComment=远程控制台客户端\nExec=' + quote(python) + ' ' + quote(APP / 'client.py') + ' --start\nTerminal=false\nX-GNOME-Autostart-enabled=true\n', encoding='utf-8')


def acquire_lock():
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = open(DIRECTORY / 'client.lock', 'a+b')
    lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return None
    return lock


class Client:
    def __init__(self, root):
        self.root, self.process = root, None
        self.messages = queue.Queue()
        root.title('Remote Console · 被控客户端')
        root.geometry('570x510'); root.minsize(500, 460)
        body = ttk.Frame(root, padding=24); body.pack(fill='both', expand=True)
        ttk.Label(body, text='连接你的远程控制台', font=('', 18, 'bold')).pack(anchor='w')
        ttk.Label(body, text='安装在被控电脑上 · 登录桌面后自动接入', padding=(0, 8)).pack(anchor='w')
        initial = {'url': 'https://rc.lvyrix.com', 'name': socket.gethostname()[:64], 'token': '', 'autostart': True}
        try: initial = load_config(CONFIG)
        except (OSError, ValueError): pass
        self.fields = {}
        for key, title in [('url', '控制台地址'), ('name', '主机名称'), ('token', '主机密钥（管理设置 → Token 管理 → 主机）')]:
            ttk.Label(body, text=title).pack(anchor='w', pady=(10, 3))
            value = tk.StringVar(value=initial[key]); self.fields[key] = value
            ttk.Entry(body, textvariable=value, show='•' if key == 'token' else '').pack(fill='x')
        self.autostart = tk.BooleanVar(value=initial['autostart'])
        ttk.Checkbutton(body, text='登录本机桌面后自动连接', variable=self.autostart).pack(anchor='w', pady=12)
        actions = ttk.Frame(body); actions.pack(fill='x')
        self.start_button = ttk.Button(actions, text='保存并连接', command=self.start); self.start_button.pack(side='left')
        self.stop_button = ttk.Button(actions, text='停止远控', command=self.stop, state='disabled'); self.stop_button.pack(side='left', padx=8)
        self.status = tk.StringVar(value='未连接')
        ttk.Label(body, textvariable=self.status, wraplength=510).pack(anchor='w', pady=18)
        ttk.Label(body, text='关闭本窗口会停止远控。移除客户端前请先取消自动连接并保存。\nLinux 需要 X11 桌面；Windows 不支持锁屏、UAC 安全桌面。', wraplength=510).pack(anchor='w')
        root.protocol('WM_DELETE_WINDOW', self.close)
        root.after(200, self.poll)
        if '--start' in sys.argv:
            root.after(300, self.start)
            root.after(600, root.iconify)

    def start(self):
        try:
            if sys.platform != 'win32' and (os.environ.get('XDG_SESSION_TYPE') == 'wayland' or not os.environ.get('DISPLAY')):
                raise ValueError('请在 Linux 的 X11/Xorg 图形桌面内启动客户端；暂不支持 Wayland 和纯命令行服务器。')
            save_config(CONFIG, {**{k: v.get() for k, v in self.fields.items()}, 'autostart': self.autostart.get()})
            set_autostart(self.autostart.get())
            self.stop()
            python = Path(sys.executable)
            if os.name == 'nt': python = python.with_name('python.exe')
            self.process = subprocess.Popen([str(python), '-u', str(APP / 'main.py'), '--config', str(CONFIG), '--managed'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))
            process = self.process
            def read_output():
                for line in process.stdout:
                    # Keep GUI output short; never echo configuration or traceback values.
                    if ' INFO ' in line or ' WARNING ' in line:
                        self.messages.put((process, line.strip().split(' ', 3)[-1]))
            threading.Thread(target=read_output, daemon=True).start()
            self.status.set('正在连接…'); self.stop_button.configure(state='normal')
        except (OSError, ValueError) as error:
            messagebox.showerror('无法连接', str(error))

    def stop(self):
        if self.process:
            process, self.process = self.process, None
            try:
                process.stdin.write('stop\n'); process.stdin.flush()
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                process.kill(); process.wait(timeout=5)
            process.stdin.close(); process.stdout.close()
        self.stop_button.configure(state='disabled'); self.status.set('已停止远控')

    def poll(self):
        while not self.messages.empty():
            process, message = self.messages.get_nowait()
            if process is self.process: self.status.set(message)
        if self.process and self.process.poll() is not None:
            self.status.set('客户端已停止，请检查主机密钥、网络和桌面环境后重新连接。')
        self.root.after(250, self.poll)

    def close(self):
        self.stop(); self.root.destroy()


if __name__ == '__main__':
    root = tk.Tk()
    lock = acquire_lock()
    if lock is None:
        root.withdraw()
        messagebox.showinfo('客户端已运行', '请打开任务栏中的 Remote Console 窗口；如已最小化，请先恢复窗口。')
        root.destroy()
    else:
        Client(root)
        try: root.mainloop()
        finally: lock.close()
