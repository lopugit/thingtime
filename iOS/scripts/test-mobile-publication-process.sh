#!/usr/bin/env bash
# Deliberately exits only the simulator TEST HOST after native publication.
# Does not use an account, cloud service, user-selected folder or production data.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEST:?Set DEST to a concrete iOS simulator destination}"
derived="${MOBILE_DEVICE_DERIVED_DATA:-$PWD/build/mobile-device-tests}"
case "$DEST" in platform=iOS\ Simulator,id=*) ;; *) echo 'Use a concrete simulator UUID destination.' >&2; exit 2 ;; esac
simulator="${DEST#platform=iOS Simulator,id=}"
xcodegen generate
xcodebuild -project Thingtime.xcodeproj -scheme Thingtime -destination "$DEST" -derivedDataPath "$derived" \
  THINGTIME_WEB_URL="${THINGTIME_WEB_URL:-http://localhost:9999}" build-for-testing
app="$derived/Build/Products/Debug-iphonesimulator/Thingtime.app"
bundle="$(python3 - "$app/Info.plist" <<'INFO'
import plistlib,sys
print(plistlib.load(open(sys.argv[1],'rb'))['CFBundleIdentifier'])
INFO
)"
xcrun simctl install "$simulator" "$app"
runfile="$derived/Build/Products/MobilePublicationProcessAcceptance.xctestrun"
trap 'rm -f "$runfile"' EXIT
for scenario in create replace edit; do
  # Remove only this test suite's prior fixture. The app's user data is retained.
  container="$(xcrun simctl get_app_container "$simulator" "$bundle" data)"
  python3 - "$container" <<'PY'
from pathlib import Path
import shutil,sys
root=Path(sys.argv[1])/'Library/Application Support/MobilePublicationProcessAcceptance'
if root.exists(): shutil.rmtree(root)
PY
  for phase in prepare verify; do
    python3 - "$derived" "$runfile" "$phase" "$scenario" <<'PY'
import os,pathlib,plistlib,sys
products=pathlib.Path(sys.argv[1])/'Build/Products'
source=max(products.glob('Thingtime_iphonesimulator*.xctestrun'),key=lambda p:p.stat().st_mtime)
data=plistlib.load(source.open('rb'))
data['ThingtimeTests'].setdefault('EnvironmentVariables',{}).update({
 'THINGTIME_PUBLICATION_PROCESS_PHASE':sys.argv[3], 'THINGTIME_PUBLICATION_PROCESS_SCENARIO':sys.argv[4]})
fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.fchmod(fd,0o600)
with os.fdopen(fd,'wb') as out:plistlib.dump(data,out)
PY
    logfile="$derived/publication-process-$scenario-$phase.log"
    set +e
    python3 - "$runfile" "$DEST" "$logfile" "$phase" "$simulator" "$bundle" <<'RUN'
import json,os,pathlib,signal,subprocess,sys,time
runfile,destination,logfile,phase,simulator,bundle=sys.argv[1:]
with open(logfile,'w') as out:
 process=subprocess.Popen(['xcodebuild','test-without-building','-xctestrun',runfile,'-destination',destination,
  '-parallel-testing-enabled','NO','-only-testing:ThingtimeTests/MobilePublicationProcessTests'],stdout=out,stderr=subprocess.STDOUT)
 if phase=='prepare':
  # Xcode occasionally stalls while collecting diagnostics from an intentionally
  # exited host. The host PID and durable proof, not a timeout, prove this phase.
  while process.poll() is None:
   try:
    container=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',simulator,bundle,'data'],text=True).strip())
    root=container/'Library/Application Support/MobilePublicationProcessAcceptance'
    proof=json.loads((root/'after-rename.json').read_text());fixture=json.loads((root/'fixture.json').read_text())
    assert proof['renamed'] is True and proof['pid']==fixture['process']
    try: os.kill(proof['pid'],0); exited=False
    except ProcessLookupError: exited=True
    if exited:
     out.write('Controller stopped after verified publishing process exit.\n');out.flush()
     process.send_signal(signal.SIGINT)
     try: process.wait(timeout=5)
     except subprocess.TimeoutExpired: process.kill();process.wait()
     break
   except (FileNotFoundError,KeyError,json.JSONDecodeError,subprocess.CalledProcessError): pass
   time.sleep(.5)
 sys.exit(process.wait())
RUN
    status=$?
    set -e
    if [ "$phase" = prepare ]; then
      container="$(xcrun simctl get_app_container "$simulator" "$bundle" data)"
      python3 - "$container" "$logfile" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])/'Library/Application Support/MobilePublicationProcessAcceptance'
fixture=json.loads((root/'fixture.json').read_text());proof=json.loads((root/'after-rename.json').read_text())
assert proof['renamed'] is True and proof['pid']==fixture['process']
record=json.loads((root/'private'/fixture['stage']['token']/'record.json').read_text())
assert not record['publication'].get('receipt'), 'Preparation must leave an unacknowledged rename'
log=pathlib.Path(sys.argv[2]).read_text()
assert 'Restarting after unexpected exit' in log or 'crash' in log.lower() or 'exited' in log.lower() or 'verified publishing process exit' in log, 'Xcode must observe actual process exit'
print('Verified actual test-host exit after rename, before receipt:',fixture['scenario'])
PY
    elif [ "$status" -ne 0 ]; then
      tail -50 "$logfile"; exit "$status"
    else
      echo "Verified fresh-process recovery: $scenario"
    fi
  done
done
