#!/usr/bin/env bash
# Real local API acceptance using an API-created disposable account fixture.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEST:?Set DEST to a concrete iOS simulator destination}"
fixture="${1:?Pass a disposable account fixture JSON path (base, username, password)}"
fixture="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$fixture")"
derived="${MOBILE_DEVICE_DERIVED_DATA:-$PWD/build/mobile-device-tests}"
origin="$(python3 - "$fixture" <<'PY'
import json,sys,urllib.parse
v=json.load(open(sys.argv[1])); u=urllib.parse.urlparse(v['base'])
assert u.scheme=='http' and u.hostname in ('localhost','127.0.0.1') and not u.username and not u.password
assert v['username'] and v['password']
print(v['base'])
PY
)"
xcodegen generate
xcodebuild -project Thingtime.xcodeproj -scheme Thingtime -destination "$DEST" -derivedDataPath "$derived" \
  THINGTIME_WEB_URL="$origin" build-for-testing
runfile="$derived/Build/Products/MobileDeviceAcceptance.xctestrun"
trap 'rm -f "$runfile"' EXIT
python3 - "$fixture" "$derived" "$runfile" <<'PY'
import json,plistlib,pathlib,sys,os
fixture=json.load(open(sys.argv[1])); root=pathlib.Path(sys.argv[2])/'Build/Products'
source=max(root.glob('Thingtime_iphonesimulator*.xctestrun'),key=lambda p:p.stat().st_mtime)
data=plistlib.load(source.open('rb'))
data['ThingtimeTests'].setdefault('EnvironmentVariables',{}).update({
 'THINGTIME_DEVICE_TEST_ORIGIN':fixture['base'], 'THINGTIME_DEVICE_TEST_USERNAME':fixture['username'],
 'THINGTIME_DEVICE_TEST_PASSWORD':fixture['password']})
fd=os.open(sys.argv[3],os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
os.fchmod(fd,0o600)
with os.fdopen(fd,'wb') as out: plistlib.dump(data,out)
PY
xcodebuild test-without-building -xctestrun "$runfile" -destination "$DEST" \
  -only-testing:ThingtimeTests/MobileDevicePairingTests \
  -only-testing:ThingtimeTests/MobileDeviceLiveTests \
  -only-testing:ThingtimeTests/ThingtimeWebDestinationTests
