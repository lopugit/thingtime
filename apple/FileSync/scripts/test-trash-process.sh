#!/usr/bin/env bash
# Exits only disposable child fixtures; never opens installed apps or user files.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --product FileSyncRecoveryFixture
binary="$(swift build --show-bin-path)/FileSyncRecoveryFixture"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-trash-process.XXXXXXXX")"
trap 'rm -rf "$fixture"' EXIT
for scenario in trash-file trash-folder trash-recreated trash-restore; do
  root="$fixture/$scenario"
  set +e
  "$binary" prepare "$scenario" "$root"
  result=$?
  set -e
  [[ "$result" == 79 ]] || { echo "Expected fixture exit 79, received $result" >&2; exit 1; }
  python3 - "$root" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
fixture=json.loads((root/'fixture.json').read_text())
proof=json.loads((root/'after-rename.json').read_text())
assert proof['renamed'] is True and proof['pid']==fixture['process']
records=list((root/'private').glob('*/record.json'));assert len(records)==1
record=json.loads(records[0].read_text())
if fixture.get('restore'): assert not record['restoration'].get('receipt')
else: assert not record.get('receipt')
PY
  "$binary" verify "$scenario" "$root"
done
