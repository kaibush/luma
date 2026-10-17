"""Build public, credential-free desktop client archives."""
import hashlib
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/web/public/downloads'
OUT.mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / 'docs/CLIENTS.md', OUT / 'client-guide.md')
FILES = ['client.py', 'client_config.py', 'main.py', 'desktop.py', 'windows_input.py', 'requirements.lock']
with tempfile.TemporaryDirectory() as temp:
    package = Path(temp) / 'remote-console-agent'
    package.mkdir()
    for name in FILES:
        shutil.copy2(ROOT / 'apps/agent' / name, package / name)
    shutil.copy2(ROOT / 'packages/protocol/src/quality-profiles.json', package / 'quality-profiles.json')
    shutil.copy2(ROOT / 'docs/CLIENTS.md', package / 'README.md')
    for name in ['install-linux.sh', 'install-windows.ps1', 'install-windows.cmd']:
        shutil.copy2(ROOT / 'apps/agent/install' / name, package / name)
    (package / 'install-linux.sh').chmod(0o755)
    with tarfile.open(OUT / 'remote-console-linux.tar.gz', 'w:gz') as archive:
        archive.add(package, arcname=package.name)
    with zipfile.ZipFile(OUT / 'remote-console-windows.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(package.iterdir()):
            archive.write(file, f'{package.name}/{file.name}')
files = ['remote-console-linux.tar.gz', 'remote-console-windows.zip']
(OUT / 'SHA256SUMS.txt').write_text(''.join(hashlib.sha256((OUT / name).read_bytes()).hexdigest() + '  ' + name + '\n' for name in files))
print('Packaged Linux and Windows clients (no credentials).')
