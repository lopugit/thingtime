import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path('/workspace/thingtime')
paths = subprocess.check_output([
    'git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
    'remix', 'MCP', 'electron', 'docs/design', 'package.json', 'pnpm-lock.yaml'
], cwd=root).decode().split('\0')
files = {}
for name in sorted(set(paths)):
    if not name:
        continue
    file = root / name
    # Generated outputs and dependencies are already excluded by Git. Record
    # production source, configuration and consumed design assets. Test-only
    # fixture/report edits may continue while a production build is running.
    if file.name.startswith('.env') or file.suffix == '.md':
        continue
    if any(part in {'test', 'tests', '__tests__', '__fixtures__'} for part in file.parts):
        continue
    if re.search(r'\.(test|spec|browser|fixture|integration)\.', file.name):
        continue
    if not file.is_file():
        continue
    files[name] = hashlib.sha256(file.read_bytes()).hexdigest()
digest = hashlib.sha256()
for name, content in files.items():
    digest.update((name + '\0' + content + '\0').encode())
record = {
    'format': 'thingtime.build-input-snapshot.v1',
    'scope': 'Git-visible production files in remix, MCP, electron, docs/design and root package/lock; excludes dotenv, Markdown and test fixtures',
    'sha256': digest.hexdigest(),
    'fileCount': len(files),
    'files': files
}
Path(sys.argv[1]).write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'sha256': record['sha256'], 'fileCount': len(files)}))
