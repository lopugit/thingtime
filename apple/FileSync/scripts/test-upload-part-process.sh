#!/usr/bin/env bash
# Exits only disposable child fixtures; never opens installed apps or user files.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --product FileSyncRecoveryFixture
binary="$(swift build --show-bin-path)/FileSyncRecoveryFixture"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-upload-process.XXXXXXXX")"
trap 'rm -rf "$fixture"' EXIT
for scenario in upload-part-ready upload-part-incomplete; do
  root="$fixture/$scenario"
  set +e
  "$binary" prepare "$scenario" "$root"
  result=$?
  set -e
  [[ "$result" == 77 ]] || { echo "Expected fixture exit 77, received $result" >&2; exit 1; }
  python3 - "$root" "$scenario" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
fixture=json.loads((root/'fixture.json').read_text())
assert json.loads((root/'exit.json').read_text())['pid']==fixture['process']
records=list((root/'private').glob('*/record.json'));assert len(records)==1
record=json.loads(records[0].read_text())
assert bool(record.get('sha256')) == (sys.argv[2]=='upload-part-ready')
assert records[0].with_name('payload').stat().st_size == fixture['request']['length']
PY
  "$binary" verify "$scenario" "$root"
done
