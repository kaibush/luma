#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
[[ "$EUID" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
command -v turnserver >/dev/null || { echo 'Install coturn first: apt-get install coturn' >&2; exit 1; }
[[ -f /etc/remote-console/environment ]] || { echo 'Deploy the API configuration first.' >&2; exit 1; }
python3 -m venv apps/agent/.venv
apps/agent/.venv/bin/pip install -r apps/agent/requirements.lock
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('/etc/remote-console/environment')
values=dict(line.split('=',1) for line in p.read_text().splitlines() if '=' in line)
values.setdefault('TURN_SECRET',secrets.token_hex(32))
values.setdefault('TURN_URL','turn:207.58.173.239:3478')
values.setdefault('STUN_URL','stun:207.58.173.239:3478')
p.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
p.chmod(0o600)
t=Path('/etc/remote-console/turnserver.conf')
if not t.exists():
 t.write_text(Path('deploy/turnserver.conf.example').read_text().replace('REPLACE_WITH_RANDOM_SECRET',values['TURN_SECRET']))
 t.chmod(0o600)
a=Path('/etc/remote-console/agent-environment')
if not a.exists():
 a.write_text('HOST_TOKEN='+values['HOST_TOKEN']+'\nDISPLAY=:10\nXAUTHORITY=/root/.Xauthority\nSIGNAL_URL=ws://127.0.0.1:8798/ws\nHOST_NAME="本机 Linux 桌面"\n')
 a.chmod(0o600)
PY
# On this server, remote-console-turn owns port 3478 instead of the package's default service.
systemctl disable --now coturn
install -m 644 deploy/remote-console-agent.service /etc/systemd/system/remote-console-agent.service
install -m 644 deploy/remote-console-turn.service /etc/systemd/system/remote-console-turn.service
systemctl daemon-reload
systemctl enable remote-console-agent remote-console-turn
systemctl restart remote-console-turn remote-console-api remote-console-agent
systemctl is-active remote-console-turn remote-console-api remote-console-agent
