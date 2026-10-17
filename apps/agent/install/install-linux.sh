#!/usr/bin/env bash
set -euo pipefail
# Run from an X11 desktop terminal as the desktop user, not through sudo.
[[ $(id -u) -ne 0 ]] || { echo '请使用桌面用户运行，不要 sudo bash。'; exit 1; }
[[ -n ${DISPLAY:-} && ${XDG_SESSION_TYPE:-x11} != wayland ]] || { echo '请在 X11/Xorg 图形桌面的终端中运行，暂不支持 Wayland。'; exit 1; }
if ! python3 -c 'import venv, tkinter, ensurepip; import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
  if command -v apt-get >/dev/null; then
    echo '安装 Python 运行环境（需要本机 sudo 权限）…'
    sudo apt-get update
    sudo apt-get install -y python3 python3-venv python3-tk libx11-6 libxtst6 xclip libpulse0
  else
    echo '请先安装 Python 3.10+、venv、Tk、X11 和 XTest 运行库，再重试。'; exit 1
  fi
fi
if ! command -v xclip >/dev/null || ! python3 -c 'import ctypes; ctypes.CDLL("libpulse.so.0")' 2>/dev/null; then
  if command -v apt-get >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y xclip libpulse0
  else
    echo '剪贴板与系统声音需要 xclip、libpulse；请用系统包管理器安装。'
  fi
fi
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
app_dir="$HOME/.local/share/remote-console-agent"
mkdir -p "$app_dir"
chmod 700 "$app_dir"
cp "$source_dir"/*.py "$source_dir"/requirements.lock "$source_dir"/quality-profiles.json "$app_dir/"
python3 -m venv "$app_dir/.venv"
"$app_dir/.venv/bin/python" -m pip install --disable-pip-version-check -r "$app_dir/requirements.lock"
APP_DIR="$app_dir" "$app_dir/.venv/bin/python" - <<'PY'
import os
from pathlib import Path
app=Path(os.environ['APP_DIR'])
path=Path.home()/'.local/share/applications/remote-console.desktop'
path.parent.mkdir(parents=True,exist_ok=True)
def quote(v): return '"'+str(v).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'
path.write_text('[Desktop Entry]\nType=Application\nName=Remote Console\nComment=远程控制台客户端\nExec='+quote(app/'.venv/bin/python')+' '+quote(app/'client.py')+'\nTerminal=false\nCategories=Network;RemoteAccess;\n',encoding='utf-8')
PY
echo '安装完成。在应用菜单打开 Remote Console，或使用下面的配置窗口。'
exec "$app_dir/.venv/bin/python" "$app_dir/client.py"
