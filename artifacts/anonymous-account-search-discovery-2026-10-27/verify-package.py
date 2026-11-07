"""Verify relevant client source contents, not whole-package equivalence."""
from pathlib import Path
import hashlib
import json
import sys
import tarfile

root = Path(__file__).resolve().parents[2]
archive = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
targets = [
    'remix/app/components/Search/SearchPage.tsx',
    'remix/app/components/Search/searchResultSnapshot.ts',
    'remix/app/local-workspace/accountApi.client.ts',
    'remix/app/local-workspace/runtime.client.ts',
    'remix/app/utils/mediaCache.client.ts',
]
found = {}
with tarfile.open(archive) as package:
    for member in package:
        if not member.name.startswith('app/public/') or not member.name.endswith('.map'):
            continue
        data = json.load(package.extractfile(member))
        for source, content in zip(data.get('sources', []), data.get('sourcesContent', [])):
            for target in targets:
                if source.endswith(target.removeprefix('remix/')) and content is not None:
                    found[target] = {'map': member.name, 'source': source, 'sha256': hashlib.sha256(content.encode()).hexdigest(), 'matches': content == (root / target).read_text()}
result = {'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'archiveBasename': archive.name, 'modules': found, 'missing': sorted(set(targets) - found.keys()), 'boundary': 'Exact relevant client sources only; no server-source or whole-package equivalence claim.'}
output.write_text(json.dumps(result, indent=2))
print(json.dumps({'archiveSha256': result['archiveSha256'], 'modules': len(found), 'missing': result['missing'], 'mismatches': [k for k, v in found.items() if not v['matches']]}))
assert set(found) == set(targets)
assert all(value['matches'] for value in found.values())
