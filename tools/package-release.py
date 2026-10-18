"""Package the built public application; never traverse private/runtime directories."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / 'Pokadrovo-unified.zip'
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build before packaging.')
directories = ['dist', 'src', 'public', 'server', 'tools', 'tests', 'docs', 'deploy']
names = ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts',
         'Dockerfile', '.dockerignore', 'compose.yaml', 'compose.domain.yaml', '.env.example',
         'start-local.sh', 'start-local.bat', 'start-standalone.sh', 'start-standalone.bat']
files = {p for p in root.glob('*.md') if p.is_file()}
files.update(root / name for name in names)
for directory in directories:
    files.update(p for p in (root / directory).rglob('*') if p.is_file())
manifest = {}
for path in sorted(files):
    relative = path.relative_to(root)
    if path.is_symlink() or any(part.startswith('.') and part not in ['.env.example', '.dockerignore'] for part in relative.parts):
        raise SystemExit(f'Unexpected hidden or linked input: {relative}')
    if any(part in ['node_modules', '__pycache__'] for part in relative.parts):
        continue
    if any(extension in path.name.lower() for extension in ['.sqlite', '.key', '.pem', '.pfx', '.db', '.zip']):
        raise SystemExit(f'Private or nested archive input refused: {relative}')
    if not path.is_file():
        raise SystemExit(f'Missing release input: {relative}')
    manifest[relative.as_posix()] = sha256(path.read_bytes()).hexdigest()
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for name in manifest:
        archive.write(root / name, 'Pokadrovo-unified/' + name)
    archive.writestr('Pokadrovo-unified/RELEASE-MANIFEST.json', json.dumps({
        'release': 'unified-2026-10-18', 'published': False,
        'accounts_default': 'disabled', 'ai_requests_connected': False,
        'files_sha256': manifest,
    }, ensure_ascii=False, indent=2))
print(json.dumps({'output': str(output), 'files': len(manifest) + 1, 'bytes': output.stat().st_size}))
