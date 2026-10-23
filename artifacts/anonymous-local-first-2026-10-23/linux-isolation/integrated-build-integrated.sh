#!/usr/bin/env bash
set -u
cd /workspace/thingtime
fixture_build_root=/tmp/thingtime-linux-runtime
python3 "$fixture_build_root/capture-build-inputs.py" "$fixture_build_root/integrated-source-before.json" || exit $?
unshare --user --map-root-user --mount sh -c '
for fixture_env_file in /workspace/thingtime/.env* /workspace/thingtime/remix/.env*; do
  if [ -f "$fixture_env_file" ]; then mount --bind /dev/null "$fixture_env_file" || exit $?; fi
done
corepack pnpm --dir remix run build:client &&
corepack pnpm --dir remix run sync:nitro-template &&
NITRO_PRESET=node-server corepack pnpm --dir remix run build:server
'
fixture_build_status=$?
python3 "$fixture_build_root/capture-build-inputs.py" "$fixture_build_root/integrated-source-after.json" || exit $?
python3 - "$fixture_build_status" <<'PY'
from pathlib import Path
import json
import sys
root = Path('/tmp/thingtime-linux-runtime')
before = json.loads((root/'integrated-source-before.json').read_text())
after = json.loads((root/'integrated-source-after.json').read_text())
changes = [name for name in sorted(set(before['files']) | set(after['files'])) if before['files'].get(name) != after['files'].get(name)]
record = {'buildExitCode': int(sys.argv[1]), 'beforeSha256': before['sha256'], 'afterSha256': after['sha256'], 'sourceUnchangedDuringBuild': not changes, 'changedFiles': changes}
(root/'integrated-source-comparison.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
raise SystemExit(int(sys.argv[1]) or int(bool(changes)))
PY
