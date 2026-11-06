#!/usr/bin/env bash
# Exits only a child fixture process. Never opens the installed app or user files.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --product FileSyncRecoveryFixture
binary="$(swift build --show-bin-path)/FileSyncRecoveryFixture"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-apple-sync-process.XXXXXXXX")"
trap 'rm -rf "$fixture"' EXIT
for scenario in create replace edit; do
  root="$fixture/$scenario"
  set +e
  "$binary" prepare "$scenario" "$root"
  result=$?
  set -e
  [[ "$result" == 77 ]] || { echo "Expected fixture exit 77, received $result" >&2; exit 1; }
  python3 - "$root" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);fixture=json.loads((root/'fixture.json').read_text());proof=json.loads((root/'after-rename.json').read_text())
assert proof['renamed'] is True and proof['pid']==fixture['process']
record=json.loads((root/'private'/fixture['stage']['token']/'record.json').read_text())
assert not record['publication'].get('receipt'), 'Exit must precede receipt persistence'
PY
  "$binary" verify "$scenario" "$root"
done
