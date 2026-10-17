"""Per-user client configuration; no server deployment files required."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def config_dir():
    if os.name == 'nt':
        return Path(os.environ['LOCALAPPDATA']) / 'RemoteConsole'
    return Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'remote-console'


def validate_config(value):
    url = value.get('url', '').strip().rstrip('/')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise ValueError('控制台地址必须是 HTTPS 根地址，例如 https://rc.lvyrix.com')
    try: parsed.port
    except ValueError: raise ValueError('控制台端口无效')
    name = value.get('name', '').strip()
    token = value.get('token', '').strip()
    if not 1 <= len(name) <= 64 or any(ord(c) < 32 for c in name):
        raise ValueError('主机名称须为 1–64 个字符，不能包含换行')
    if not token or len(token) > 256 or any(c.isspace() for c in token):
        raise ValueError('请输入有效的主机密钥（Token），不要使用管理员密码')
    return {'url': url, 'name': name, 'token': token, 'autostart': bool(value.get('autostart', True))}


def signal_url(config):
    p = urlsplit(config['url'])
    return urlunsplit(('wss', p.netloc, '/ws', '', ''))


def save_config(path, value):
    value = validate_config(value)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
    temporary.chmod(0o600)
    temporary.replace(path)
    return value


def load_config(path):
    return validate_config(json.loads(Path(path).read_text(encoding='utf-8')))
