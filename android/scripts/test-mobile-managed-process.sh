#!/usr/bin/env bash
# Real process death before/after native offline-folder publication commits.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  serial="$(adb devices | awk 'NR>1 && $2=="device" { print $1 }')"
  [[ -n "$serial" && "$serial" != *$'\n'* ]] || { echo 'Set ANDROID_SERIAL to one connected test device.' >&2; exit 1; }
fi
origin="${THINGTIME_WEB_URL:-https://thingtime.com}"
"$root/gradlew" -p "$root" assembleDebug assembleDebugAndroidTest testDebugUnitTest lintDebug "-PthingtimeWebUrl=$origin"
adb -s "$serial" install -r "$root/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$serial" install -r "$root/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
logs="$root/build/managed-process"
mkdir -p "$logs"
for scenario in before after replace; do
  run_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  adb -s "$serial" shell am instrument -w -e class com.thingtime.mobile.ManagedFileStoreProcessTest \
    -e managedPhase prepare -e managedScenario "$scenario" -e managedRunId "$run_id" \
    com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner > "$logs/$scenario-prepare.log" 2>&1 || true
  grep -q 'shortMsg=Process crashed' "$logs/$scenario-prepare.log"
  adb -s "$serial" shell run-as com.thingtime.mobile.dev cat no_backup/ManagedFileProcessAcceptance/proof.json > "$logs/$scenario-proof.json"
  python3 - "$logs/$scenario-proof.json" "$scenario" "$run_id" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
assert p['scenario']==sys.argv[2] and p['run']==sys.argv[3] and isinstance(p['pid'],int) and p['pid']>0
PY
  adb -s "$serial" shell am instrument -w -e class com.thingtime.mobile.ManagedFileStoreProcessTest \
    -e managedPhase verify -e managedScenario "$scenario" -e managedRunId "$run_id" \
    com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner > "$logs/$scenario-verify.log" 2>&1
  cat "$logs/$scenario-verify.log"
  grep -q '^OK (1 test)' "$logs/$scenario-verify.log"
  adb -s "$serial" shell run-as com.thingtime.mobile.dev cat files/native-managed-contract.json > "$logs/$scenario-contract.json"
  adb -s "$serial" shell run-as com.thingtime.mobile.dev rm files/native-managed-contract.json
done
(cd "$root/../remix" && node --import tsx scripts/validate-mobile-managed.mts "$logs/before-contract.json" "$logs/after-contract.json" "$logs/replace-contract.json")
echo "All three native publication process-exit scenarios passed: $logs"
