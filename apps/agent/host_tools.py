"""Bounded, session-scoped desktop tools. Never uses shell command interpolation."""
import asyncio
import base64
import codecs
import json
import os
from pathlib import Path
import platform
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time

import psutil
import pyperclip

VERSION = '0.2.0'
CHUNK = 12 * 1024
MAX_FILE = 256 * 1024 * 1024


def features():
    return {key: os.environ.get('RC_' + key.upper(), '0') == '1' for key in ('terminal', 'files', 'clipboard', 'audio')}


def device_stats(encoder='idle'):
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(Path.home()))
    return dict(cpu=psutil.cpu_percent(interval=.1), memoryUsed=memory.total-memory.available, memoryTotal=memory.total,
                diskUsed=disk.used, diskTotal=disk.total, uptime=max(0, time.time()-psutil.boot_time()),
                platform=platform.platform()[:160], version=VERSION, encoder=encoder[:80])


class HostTools:
    def __init__(self, channel, allowed, root=None):
        self.channel = channel
        self.allowed = allowed
        self.root = Path(root or os.environ.get('RC_FILE_ROOT') or Path.home()).resolve()
        self.queue = asyncio.Queue(maxsize=32)
        self.worker = asyncio.create_task(self.run())
        self.terminal = None
        self.reader = None
        self.upload = None
        self.download = None
        self.closed = False
        channel.on('message', self.receive)
        channel.on('close', lambda: asyncio.create_task(self.close()))

    def receive(self, raw):
        if self.closed: return
        if not isinstance(raw, str) or len(raw) > 24000:
            self.channel.close(); return
        try:
            data = json.loads(raw)
            if not isinstance(data, dict) or not isinstance(data.get('id'), str) or len(data['id']) > 64: raise ValueError()
            self.queue.put_nowait(data)
        except (ValueError, asyncio.QueueFull): self.channel.close()

    async def send(self, data):
        raw = json.dumps(data, ensure_ascii=True)
        if len(raw) > 60000: raise ValueError('响应过大')
        deadline = time.monotonic() + 10
        while self.channel.bufferedAmount > 65536:
            if self.closed or time.monotonic() > deadline: raise ConnectionError('工具通道超时')
            await asyncio.sleep(.02)
        if not self.closed and self.channel.readyState == 'open': self.channel.send(raw)

    async def run(self):
        try:
            while True:
                data = await self.queue.get()
                try:
                    value = await self.dispatch(data)
                    await self.send(dict(id=data['id'], result=value))
                except (OSError, ValueError, KeyError, TypeError, RuntimeError) as e:
                    await self.send(dict(id=data['id'], error=str(e)[:200]))
        except (asyncio.CancelledError, ConnectionError): pass
        finally:
            if not self.closed: self.channel.close()

    def path(self, raw):
        if not isinstance(raw, str) or len(raw) > 2048 or '\x00' in raw: raise ValueError('路径无效')
        path = (self.root / raw).resolve()
        if not path.is_relative_to(self.root): raise ValueError('只能访问共享目录内的文件')
        # Reject all symlink components, including Windows junctions.
        current = self.root
        for part in Path(raw).parts:
            current = current / part
            if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()): raise ValueError('不支持符号链接')
        return path

    async def dispatch(self, data):
        op = data.get('op', '')
        if not isinstance(op, str) or len(op) > 64: raise ValueError('操作无效')
        family = op.split('.')[0]
        if family not in self.allowed or not self.allowed[family]: raise ValueError('本次会话未授权此能力，请检查客户端权限')
        if family == 'files':
            task = asyncio.create_task(asyncio.to_thread(self.file_op, op, data))
            try: return await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
        if op == 'clipboard.read':
            value = await asyncio.to_thread(pyperclip.paste)
            if len(value) > 8192: raise ValueError('剪贴板文本超过 8192 字符')
            return value
        if op == 'clipboard.write':
            value = data.get('text')
            if not isinstance(value, str) or len(value) > 8192: raise ValueError('剪贴板文本无效')
            await asyncio.to_thread(pyperclip.copy, value); return True
        if op == 'terminal.open':
            if self.terminal: return True
            cols, rows = self.size(data)
            # Do not pass deployment credentials to an interactive shell.
            env = {k: v for k, v in os.environ.items() if k not in ('HOST_TOKEN', 'CONTROL_TOKEN', 'TURN_SECRET')}
            env.update(TERM='xterm-256color', COLORTERM='truecolor')
            if os.name == 'nt':
                from winpty import PtyProcess
                self.terminal = PtyProcess.spawn('powershell.exe -NoLogo', cwd=str(Path.home()), env=env, dimensions=(rows, cols))
            else:
                import pty, fcntl, termios
                master, slave = pty.openpty()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                try:
                    process = subprocess.Popen([sys.executable, '-c', 'import os,fcntl,termios,sys; fcntl.ioctl(0,termios.TIOCSCTTY,0); os.execv(sys.argv[1],[sys.argv[1],"-i"])', os.environ.get('SHELL', '/bin/sh')], stdin=slave, stdout=slave, stderr=slave, cwd=Path.home(), env=env, start_new_session=True)
                except BaseException:
                    os.close(master); raise
                finally: os.close(slave)
                os.set_blocking(master, False)
                self.terminal = (process, master)
            self.reader = asyncio.create_task(self.read_terminal())
            return True
        if op == 'terminal.close': await self.stop_terminal(); return True
        if not self.terminal: raise ValueError('请先打开终端')
        if op == 'terminal.input':
            text = data.get('text')
            if not isinstance(text, str) or len(text.encode()) > 8192: raise ValueError('输入过长')
            if os.name == 'nt': await asyncio.to_thread(self.terminal.write, text)
            else:
                raw = text.encode()
                while raw:
                    try: raw = raw[os.write(self.terminal[1], raw):]
                    except BlockingIOError: await asyncio.sleep(.01)
            return True
        if op == 'terminal.resize':
            cols, rows = self.size(data)
            if os.name == 'nt': self.terminal.setwinsize(rows, cols)
            else:
                import fcntl, termios
                fcntl.ioctl(self.terminal[1], termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
            return True
        raise ValueError('未知操作')

    @staticmethod
    def size(data):
        cols, rows = data.get('cols', 80), data.get('rows', 24)
        if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 400 or not 2 <= rows <= 200: raise ValueError('终端尺寸无效')
        return cols, rows

    async def read_terminal(self):
        decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
        try:
            while self.terminal and not self.closed:
                if os.name == 'nt':
                    text = await asyncio.to_thread(self.terminal.read, 4096)
                else:
                    try: raw = os.read(self.terminal[1], 4096)
                    except BlockingIOError: await asyncio.sleep(.02); continue
                    if not raw: break
                    text = decoder.decode(raw)
                if text: await self.send(dict(event='terminal', text=text))
        except (EOFError, OSError, ConnectionError): pass
        finally:
            if not self.closed: await self.send(dict(event='terminal-exit'))

    def file_op(self, op, data):
        if op == 'files.list':
            path = self.path(data.get('path', ''))
            offset = data.get('offset', 0)
            if type(offset) is not int or offset < 0: raise ValueError('分页无效')
            entries = []
            # Bounded response, no unbounded directory allocation.
            with os.scandir(path) as scan:
                skipped = 0
                for entry in scan:
                    if entry.is_symlink(): continue
                    if skipped < offset: skipped += 1; continue
                    if len(entries) == 50: break
                    try:
                        info = entry.stat(follow_symlinks=False)
                        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)): continue
                        entries.append(dict(name=entry.name, directory=stat.S_ISDIR(info.st_mode), size=info.st_size))
                    except OSError: continue
                else: return dict(entries=entries, next=None)
            return dict(entries=entries, next=offset+len(entries))
        if op == 'files.cancel': self.cancel_files(); return True
        if op == 'files.upload':
            self.cancel_files()
            target = self.path(data['path'])
            size = data['size']
            if type(size) is not int or not 0 <= size <= MAX_FILE: raise ValueError('单文件上限 256 MiB')
            if target.exists(): raise ValueError('文件已存在，请先更改文件名')
            fd, temporary = tempfile.mkstemp(prefix='.remote-upload-', dir=target.parent)
            self.upload = [os.fdopen(fd, 'wb'), Path(temporary), target, size, 0]
            return True
        if op == 'files.chunk':
            if not self.upload: raise ValueError('没有上传任务')
            raw = base64.b64decode(data['data'], validate=True)
            stream, temporary, target, size, received = self.upload
            if len(raw) > CHUNK or received + len(raw) > size: raise ValueError('分块大小无效')
            stream.write(raw); self.upload[4] += len(raw)
            return self.upload[4]
        if op == 'files.finish':
            if not self.upload or self.upload[3] != self.upload[4]: raise ValueError('上传尚未完成')
            stream, temporary, target, _, _ = self.upload
            stream.flush(); os.fsync(stream.fileno()); stream.close()
            # Atomic, refuses to overwrite a file created during the transfer.
            os.link(temporary, target); temporary.unlink(); self.upload = None
            return True
        if op == 'files.download':
            self.cancel_files()
            path = self.path(data['path'])
            fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
                os.close(fd); raise ValueError('仅支持 256 MiB 内的普通文件')
            self.download = os.fdopen(fd, 'rb')
            return dict(size=info.st_size)
        if op == 'files.read':
            if not self.download: raise ValueError('没有下载任务')
            raw = self.download.read(CHUNK)
            if not raw: self.download.close(); self.download = None
            return dict(data=base64.b64encode(raw).decode(), done=not raw)
        raise ValueError('未知文件操作')

    def cancel_files(self):
        if self.upload:
            self.upload[0].close(); self.upload[1].unlink(missing_ok=True); self.upload = None
        if self.download: self.download.close(); self.download = None

    async def stop_terminal(self):
        if self.terminal:
            terminal, self.terminal = self.terminal, None
            if os.name == 'nt': terminal.close(force=True)
            else:
                process, master = terminal
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                os.close(master)
                await asyncio.to_thread(process.wait)
        if self.reader:
            self.reader.cancel()
            await asyncio.gather(self.reader, return_exceptions=True)
            self.reader = None

    async def close(self):
        if self.closed: return
        self.closed = True
        # Let a pending disk operation finish before deleting its temporary file.
        self.channel.close()
        await self.stop_terminal()
        if self.worker is not asyncio.current_task():
            self.worker.cancel(); await asyncio.gather(self.worker, return_exceptions=True)
        self.cancel_files()
