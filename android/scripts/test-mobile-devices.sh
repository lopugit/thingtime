#!/usr/bin/env bash
# Reproducible Android debug acceptance; fixture credentials never enter adb arguments or build outputs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="${1:-}"
serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  serial="$(adb devices | awk 'NR>1 && $2=="device" { print $1 }')"
  [[ -n "$serial" && "$serial" != *$'\n'* ]] || { echo 'Set ANDROID_SERIAL to one connected test device.' >&2; exit 1; }
fi
origin='https://thingtime.com'
if [[ -n "$fixture" ]]; then
  origin="$(python3 - "$fixture" <<'PY'
import json,os,stat,sys,urllib.parse
p=sys.argv[1]
if stat.S_IMODE(os.stat(p).st_mode)&0o077: raise SystemExit('Test fixture must be mode 0600')
c=json.load(open(p)); u=urllib.parse.urlparse(c['base'])
if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost') or u.username or u.password or u.path not in ('','/') or u.query or u.fragment or not u.port: raise SystemExit('Use an explicit loopback test origin with a port')
if not all(isinstance(c.get(k),str) and c[k] for k in ('username','password','userId')): raise SystemExit('Missing disposable test account fields')
print(c['base'].rstrip('/'))
PY
)"
fi
"$root/gradlew" -p "$root" assembleDebug assembleDebugAndroidTest testDebugUnitTest lintDebug "-PthingtimeWebUrl=$origin"
adb -s "$serial" install -r "$root/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$serial" install -r "$root/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
cleanup() { adb -s "$serial" shell run-as com.thingtime.mobile.dev rm -f files/device-test-fixture.json >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ -n "$fixture" ]]; then
  port="${origin##*:}"
  adb -s "$serial" reverse "tcp:$port" "tcp:$port"
  adb -s "$serial" shell run-as com.thingtime.mobile.dev mkdir -p files
  adb -s "$serial" shell run-as com.thingtime.mobile.dev sh -c '"cat > files/device-test-fixture.json"' < "$fixture"
fi
result="$(mktemp)"
adb -s "$serial" shell am instrument -w com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner > "$result"
cat "$result"
if ! grep -q '^OK (' "$result"; then rm -f "$result"; exit 1; fi
rm -f "$result"
adb -s "$serial" shell am start -n com.thingtime.mobile.dev/com.thingtime.mobile.MainActivity
