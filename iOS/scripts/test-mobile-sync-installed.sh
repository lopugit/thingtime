#!/usr/bin/env bash
# Prepare normal authentication for visible CUA/manual installed-app acceptance.
# The default mode prepares authentication; opt-in export/photo scenarios exercise
# their documented disposable fixtures and visible native permission prompts.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEST:?Set DEST to a concrete iOS simulator destination}"
fixture="${1:?Pass a mode-0600 disposable loopback account JSON fixture}"
fixture="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$fixture")"
derived="${MOBILE_DEVICE_DERIVED_DATA:-$PWD/build/mobile-device-tests}"
origin="$(python3 - "$fixture" <<'PY'
import json,pathlib,sys,urllib.parse
path=pathlib.Path(sys.argv[1]);assert path.stat().st_mode & 0o077 == 0
f=json.loads(path.read_text());u=urllib.parse.urlparse(f['base'])
assert u.scheme=='http' and u.hostname in ('localhost','127.0.0.1') and not u.username and not u.password
assert f['username'] and f['password'];print(f['base'])
PY
)"
test_class="MobileSyncInstalledTests"
if [ "${THINGTIME_FILE_EXPORT_TEST:-0}" = "1" ]; then test_class="FileExportInstalledTests"; fi
if [ "${THINGTIME_PHOTO_BACKUP_TEST:-0}" = "1" ]; then test_class="PhotoBackupInstalledTests"; fi
xcodegen generate
xcodebuild -project Thingtime.xcodeproj -scheme Thingtime -destination "$DEST" -derivedDataPath "$derived" \
  THINGTIME_WEB_URL="$origin" build-for-testing
runfile="$derived/Build/Products/MobileSyncInstalledAcceptance.xctestrun"
trap 'rm -f "$runfile"' EXIT
python3 - "$fixture" "$derived" "$runfile" <<'PY'
import json,os,pathlib,plistlib,sys
fixture=json.load(open(sys.argv[1]));products=pathlib.Path(sys.argv[2])/'Build/Products'
source=max(products.glob('Thingtime_iphonesimulator*.xctestrun'),key=lambda p:p.stat().st_mtime)
data=plistlib.load(source.open('rb'))
data['ThingtimeTests'].setdefault('EnvironmentVariables',{}).update({
 'THINGTIME_PHOTO_RESUME_GRANT':os.environ.get('THINGTIME_PHOTO_RESUME_GRANT',''),'THINGTIME_SYNC_INSTALLED_ACCEPTANCE':'1','THINGTIME_PHOTO_BACKUP_TEST':os.environ.get('THINGTIME_PHOTO_BACKUP_TEST','0'),'THINGTIME_FILE_EXPORT_TEST':os.environ.get('THINGTIME_FILE_EXPORT_TEST','0'),'THINGTIME_DEVICE_TEST_ORIGIN':fixture['base'],
 'THINGTIME_DEVICE_TEST_USERNAME':fixture['username'],'THINGTIME_DEVICE_TEST_PASSWORD':fixture['password']})
fd=os.open(sys.argv[3],os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.fchmod(fd,0o600)
with os.fdopen(fd,'wb') as out:plistlib.dump(data,out)
PY
xcodebuild test-without-building -xctestrun "$runfile" -destination "$DEST" \
  -parallel-testing-enabled NO -only-testing:"ThingtimeTests/$test_class"
