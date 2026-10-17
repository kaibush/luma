"""Validate the exact public file list, checksums and Python sources in both archives."""
import argparse
import hashlib
from pathlib import Path
import tarfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
root = parser.parse_args().directory
names = ['remote-console-linux.tar.gz', 'remote-console-windows.zip']
checksums = {}
for line in (root / 'SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split()
    assert name in names and name not in checksums, 'Unexpected or duplicate checksum entry'
    checksums[name] = digest
assert set(checksums) == set(names), 'Missing archive checksums'
for name, digest in checksums.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name

expected = {f'remote-console-agent/{name}' for name in [
    'client.py', 'client_config.py', 'main.py', 'desktop.py', 'windows_input.py', 'host_tools.py', 'media.py',
    'requirements.lock', 'quality-profiles.json', 'README.md',
    'install-linux.sh', 'install-windows.ps1', 'install-windows.cmd',
]}
with tarfile.open(root / names[0]) as archive:
    members = archive.getmembers()
    files = [member for member in members if member.isfile()]
    assert len(files) == len(expected) and {member.name for member in files} == expected
    assert all(member.isfile() or (member.isdir() and member.name == 'remote-console-agent') for member in members)
    assert archive.getmember('remote-console-agent/install-linux.sh').mode & 0o111
    linux = {member.name: archive.extractfile(member).read() for member in files}
with zipfile.ZipFile(root / names[1]) as archive:
    assert len(archive.namelist()) == len(expected) and set(archive.namelist()) == expected
    windows = {name: archive.read(name) for name in archive.namelist()}
assert linux == windows, 'Archives must contain the same source version'
for name, data in linux.items():
    if name.endswith('.py'): compile(data, name, 'exec')
assert (root / 'client-guide.md').read_bytes() == linux['remote-console-agent/README.md']
print('PASS: archive contents, Python syntax, installer permission, guide and SHA-256 checksums')
