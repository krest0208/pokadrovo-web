"""Extract only source files from one pinned public GitHub archive, without tar extraction primitives."""
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

ROOT_FILES = {'AGENTS.md', 'Dockerfile', '.gitignore', '.dockerignore', '.env.example', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'compose.yaml', 'compose.domain.yaml', 'start-local.sh', 'start-local.bat', 'start-standalone.sh', 'start-standalone.bat'}
DIRECTORIES = {'src', 'public', 'server', 'shared', 'tools', 'tests', 'docs', 'deploy', '.github'}

def relative_name(name, sha):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid release commit')
    if '\\' in name or '\x00' in name or name.startswith('/'):
        raise ValueError('Invalid archive path')
    parts = name.rstrip('/').split('/')
    if not parts or parts[0] != 'pokadrovo-web-' + sha or any(p in ('', '.', '..') for p in parts):
        raise ValueError('Archive does not match the selected commit')
    parts = parts[1:]
    if not parts:
        return None
    if len(parts) == 1:
        if parts[0] not in ROOT_FILES and not parts[0].endswith('.md') and parts[0] not in DIRECTORIES:
            raise ValueError('Unexpected source root')
    elif parts[0] not in DIRECTORIES:
        raise ValueError('Unexpected source directory')
    for p in parts:
        if p.startswith('.') and p not in ('.github', '.gitignore', '.dockerignore', '.env.example'):
            raise ValueError('Private or hidden input refused')
        if p in ('node_modules', '__pycache__') or re.search(r'\.(sqlite\w*|db\w*|key|pem|pfx)$', p, re.I):
            raise ValueError('Private or runtime input refused')
    return '/'.join(parts)

def unpack(archive, destination, sha):
    destination = Path(destination)
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError('Destination must be an empty real directory')
    total, files = 0, set()
    with tarfile.open(archive, 'r:gz') as source:
        for item in source:
            relative = relative_name(item.name, sha)
            if item.isdir():
                continue
            if not item.isfile() or item.size > 8 * 1024 * 1024 or relative is None:
                raise ValueError('Linked, special or oversized member refused')
            if relative in files:
                raise ValueError('Duplicate archive member')
            total += item.size
            if total > 64 * 1024 * 1024 or len(files) >= 5000:
                raise ValueError('Archive limits exceeded')
            files.add(relative)
            path = destination.joinpath(*PurePosixPath(relative).parts)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with source.extractfile(item) as incoming, path.open('xb') as outgoing:
                remaining = item.size
                while remaining:
                    chunk = incoming.read(min(65536, remaining))
                    if not chunk:
                        raise ValueError('Truncated archive member')
                    outgoing.write(chunk)
                    remaining -= len(chunk)
            path.chmod(0o644)
    for required in ('package-lock.json', 'src/AiHome.tsx', 'server/app.mjs', 'shared/coin-pricing.json'):
        if required not in files:
            raise ValueError('Incomplete application archive')
    return len(files)

if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: unpack.py ARCHIVE EMPTY_DIRECTORY COMMIT')
    print('Validated source files:', unpack(*sys.argv[1:]))
