"""Package a sanitized build and prove the native vault sources match it."""
from pathlib import Path
import hashlib
import io
import json
import tarfile
import time

root = Path(__file__).resolve().parents[2]
out = root / 'tmp/continuation/vault-status-app.tar.gz'
build = root / 'remix/.output'
prior = json.loads((root / 'artifacts/anonymous-local-first-2026-10-27-vault-identity-final/vault-identity/source-parity.json').read_text())
wanted = {row['file']: (root / row['file']).read_text() for row in prior['checks']}
for source in (root / 'remix/app/components/Passwords').glob('*'):
    if source.suffix in ('.ts', '.tsx') and 'test' not in source.name and 'Status' in source.name:
        wanted[str(source.relative_to(root))] = source.read_text()
matches = {}
for path in (build / 'public/assets').glob('*.js.map'):
    data = json.loads(path.read_text())
    for source, content in zip(data.get('sources', []), data.get('sourcesContent', [])):
        for name, expected in wanted.items():
            if source.endswith(name.removeprefix('remix/')):
                if content != expected:
                    raise SystemExit('Stale packaged source: ' + name)
                matches[name] = {'file': name, 'map': path.name, 'equal': True, 'sha256': hashlib.sha256(expected.encode()).hexdigest()}
missing = sorted(set(wanted) - set(matches))
if missing:
    raise SystemExit('Missing packaged sources: ' + ', '.join(missing))

def allowed(info):
    parts = Path(info.name).parts
    if any(p == '.DS_Store' or p.startswith('.env') for p in parts):
        return None
    if info.issym() and Path(info.linkname).is_absolute():
        raise RuntimeError('Absolute build symlink: ' + info.name)
    return info

with tarfile.open(out, 'w:gz') as tar:
    for name in ('public', 'server'):
        tar.add(build / name, arcname='app/' + name, filter=allowed)
    for name in ('check', 'check/MCP'):
        info = tarfile.TarInfo(name)
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
        info.mtime = int(time.time())
        tar.addfile(info)
with tarfile.open(out) as tar:
    entries = len(tar.getmembers())
digest = hashlib.sha256(out.read_bytes()).hexdigest()
result = {'archive': str(out), 'sha256': digest, 'bytes': out.stat().st_size, 'entries': entries, 'source': 'Fresh sanitized complete client/server build; no account configuration', 'checks': list(matches.values())}
(root / 'tmp/continuation/vault-status-package.json').write_text(json.dumps(result, indent=2))
print(json.dumps({'sha256': digest, 'bytes': result['bytes'], 'entries': entries, 'sourceMatches': len(matches)}))
